import fs from 'node:fs/promises';
import path from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from 'playwright';
import { buildPaymentPlatformRegistry, matchPaymentPlatform } from './payment-platforms.js';
import type {
  DestinationObservation,
  DestinationProvider,
  DestinationProviderResult,
  QueryInput,
} from './types.js';

export type BrowserProviderConfig = {
  reportUrl: string;
  dashboardUrl: string;
  userDataDir: string;
  connectionMode: 'cdp' | 'launch';
  cdpEndpoint: string;
  channel?: string;
  headless: boolean;
  manageSelectedDomains: boolean;
  timeoutMs: number;
  artifactDir: string;
};

export class SemrushBrowserProvider implements DestinationProvider {
  private queue: Promise<void> = Promise.resolve();
  private cdpConnection?: Promise<{ browser: Browser; context: BrowserContext }>;

  constructor(private readonly config: BrowserProviderConfig) {}

  async query(input: QueryInput, displayDates: string[]): Promise<DestinationProviderResult> {
    const run = this.queue.then(
      () => this.querySerial(input, displayDates),
      () => this.querySerial(input, displayDates),
    );
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async querySerial(input: QueryInput, displayDates: string[]): Promise<DestinationProviderResult> {
    await fs.mkdir(this.config.userDataDir, { recursive: true });
    await fs.mkdir(this.config.artifactDir, { recursive: true });
    const { context, closeWhenDone } = await this.openContext();
    const page = await this.getReportPage(context);
    page.setDefaultTimeout(this.config.timeoutMs);
    try {
      const useWarmMonthlyPage = input.months === 6 && !input.rangeMode;
      let reportUrl = buildReportUrl(
        this.config.reportUrl,
        useWarmMonthlyPage ? [displayDates.at(-1) || displayDates[0]] : displayDates,
      );
      if (!isSourcesDestinationsPage(page.url())) {
        await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: this.config.timeoutMs });
      }
      await assertAuthenticated(page);
      await ensureReportForDomain(page, input.domain);
      reportUrl = buildReportUrl(
        preferActiveReportUrl(page.url(), this.config.reportUrl),
        useWarmMonthlyPage ? [displayDates.at(-1) || displayDates[0]] : displayDates,
      );
      if (!useWarmMonthlyPage && !isSameReportRange(page.url(), reportUrl)) {
        await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: this.config.timeoutMs });
        await assertAuthenticated(page);
        await ensureReportForDomain(page, input.domain);
      }
      await selectDestinationsTab(page);
      const previousRows = await destinationRowsFingerprint(page);
      const domainAdded = await enterDomain(page, input.domain);
      let domainsRemoved = false;
      if (this.config.manageSelectedDomains) {
        domainsRemoved = await removeExtraDomains(page, input.domain);
      }
      await assertExclusiveDomain(page, input.domain);
      if (useWarmMonthlyPage) {
        const monthlyResult = await this.readMonthlyOnWarmPage(
          page,
          displayDates,
          input,
        );
        return {
          provider: 'semrush-browser-ui',
          granularity: 'month',
          observations: monthlyResult.observations,
          warnings: [
            'Browser mode reads the rendered single-domain destination table and its absolute Visits column.',
            'Six completed months are queried sequentially through the date picker on one warmed report tab.',
            'Speed mode scans only the first destination-table page for each month; payment destinations on later pages are not counted.',
            'The browser parser must be revalidated after Semrush UI changes.',
            ...(monthlyResult.failedDisplayDates.length > 0
              ? [`Monthly queries that failed after two attempts were skipped instead of stopping the remaining months: ${monthlyResult.failedDisplayDates.join(', ')}. Failed months are unavailable, not zero.`]
              : []),
            ...(monthlyResult.rowsScanned === 0 && monthlyResult.failedDisplayDates.length === 0
              ? ['All requested monthly destination tables returned an explicit empty state.']
              : []),
            ...(monthlyResult.observations.length === 0
              ? ['No registered payment-platform destination appeared in the successfully scanned rows.']
              : []),
          ],
          failedDisplayDates: monthlyResult.failedDisplayDates,
          diagnostics: {
            reportUrl: redactQuery(reportUrl),
            parsedRows: monthlyResult.observations.length,
            rowsScanned: monthlyResult.rowsScanned,
            pagesScanned: monthlyResult.pagesScanned,
            monthlyConcurrency: 1,
            scanMode: 'single-warm-tab-first-page-only',
            monthlyPageLimit: 1,
            monthlyQueries: monthlyResult.monthlyQueries,
            browserElapsedMs: monthlyResult.elapsedMs,
            connectionMode: this.config.connectionMode,
          },
        };
      }
      if (domainAdded || domainsRemoved) {
        await waitForRowsToRefresh(page, previousRows);
      } else {
        await waitForRows(page);
      }
      await goToFirstPage(page);
      await waitForRows(page);
      const rangePageLimit = input.rangeMode ? 1 : 100;
      const readResult = await readPaymentDestinationRowsAcrossPages(
        page,
        displayDates,
        input,
        rangePageLimit,
      );
      const observations = readResult.observations;
      if (readResult.rowsScanned === 0) {
        const artifactPath = path.join(this.config.artifactDir, `empty-${Date.now()}.png`);
        await page.screenshot({ path: artifactPath, fullPage: true });
        throw new Error(`No destination rows could be parsed. Diagnostic screenshot: ${artifactPath}`);
      }
      return {
        provider: 'semrush-browser-ui',
        granularity: 'range',
        observations,
        warnings: [
          'Browser mode reads the rendered single-domain destination table and its absolute Visits column.',
          'The browser parser must be revalidated after Semrush UI changes.',
          ...(observations.length === 0 ? ['No registered payment-platform destination appeared in the scanned rows.'] : []),
        ],
        diagnostics: {
          reportUrl: redactQuery(reportUrl),
          parsedRows: observations.length,
          rowsScanned: readResult.rowsScanned,
          pagesScanned: readResult.pagesScanned,
          ...(input.rangeMode ? {
            scanMode: 'diagnostic-range-first-page-only',
            rangePageLimit,
          } : {}),
          connectionMode: this.config.connectionMode,
        },
      };
    } catch (error) {
      const artifactPath = path.join(this.config.artifactDir, `failure-${Date.now()}.png`);
      await page.screenshot({ path: artifactPath, fullPage: true }).catch(() => undefined);
      throw new Error(`${error instanceof Error ? error.message : String(error)}; screenshot=${artifactPath}`);
    } finally {
      if (closeWhenDone) await context.close();
    }
  }

  private async readMonthlyOnWarmPage(
    page: Page,
    displayDates: string[],
    input: QueryInput,
  ) {
    const startedAt = Date.now();
    const queryOrder = buildMonthlyQueryOrder(displayDates);
    const byDisplayDate = new Map<string, {
      displayDate: string;
      observations: DestinationObservation[];
      rowsScanned: number;
      pagesScanned: number;
      attempts: number;
      elapsedMs: number;
    }>();
    const failedByDisplayDate = new Map<string, {
      displayDate: string;
      attempts: number;
      elapsedMs: number;
      error: string;
      screenshot: string;
    }>();
    for (const displayDate of queryOrder) {
        const monthStartedAt = Date.now();
        const logStage = (stage: string, extra = '') => {
          const suffix = extra ? ` ${extra}` : '';
          console.log(`[semrush-traffic] month=${displayDate} stage=${stage} elapsedMs=${Date.now() - monthStartedAt}${suffix}`);
        };
        let lastError: unknown;
        let lastArtifactPath = '';
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            logStage('start', `attempt=${attempt}`);
            if (attempt > 1) {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: this.config.timeoutMs });
              await assertAuthenticated(page);
              await ensureReportForDomain(page, input.domain, 15_000);
              await selectDestinationsTab(page);
              await enterDomain(page, input.domain);
              if (this.config.manageSelectedDomains) {
                await removeExtraDomains(page, input.domain);
              }
              await assertExclusiveDomain(page, input.domain);
              logStage('recovered', `attempt=${attempt}`);
            }
            await switchToSingleMonth(page, displayDate);
            logStage('month-selected', `attempt=${attempt}`);
            await assertAuthenticated(page);
            const previousRows = await destinationRowsFingerprint(page);
            const domainAdded = await enterDomain(page, input.domain);
            let domainsRemoved = false;
            if (this.config.manageSelectedDomains) {
              domainsRemoved = await removeExtraDomains(page, input.domain);
            }
            await assertExclusiveDomain(page, input.domain);
            if (domainAdded || domainsRemoved) {
              await waitForRowsToRefresh(page, previousRows);
            }
            logStage('domain-verified', `attempt=${attempt}`);
            await goToFirstPage(page);
            logStage('rows-ready', `attempt=${attempt}`);
            const readResult = await readPaymentDestinationRowsAcrossPages(page, [displayDate], input, 1);
            logStage('done', `attempt=${attempt} rows=${readResult.rowsScanned} pages=${readResult.pagesScanned}`);
            byDisplayDate.set(displayDate, {
              displayDate,
              ...readResult,
              attempts: attempt,
              elapsedMs: Date.now() - monthStartedAt,
            });
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            lastArtifactPath = path.join(
              this.config.artifactDir,
              `month-${displayDate}-attempt-${attempt}-${Date.now()}.png`,
            );
            await page.screenshot({ path: lastArtifactPath, fullPage: true }).catch(() => undefined);
            logStage(
              attempt < 2 ? 'retrying' : 'failed',
              `attempt=${attempt} error=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
            );
            await page.keyboard.press('Escape').catch(() => undefined);
          }
        }
        if (lastError) {
          failedByDisplayDate.set(displayDate, {
            displayDate,
            attempts: 2,
            elapsedMs: Date.now() - monthStartedAt,
            error: lastError instanceof Error ? lastError.message : String(lastError),
            screenshot: lastArtifactPath,
          });
          logStage('continuing-after-failure', 'next=older-months');
        }
    }
    const results = displayDates.flatMap((displayDate) => {
      const result = byDisplayDate.get(displayDate);
      return result ? [result] : [];
    });
    if (results.length === 0) {
      const failures = displayDates
        .map((displayDate) => failedByDisplayDate.get(displayDate))
        .filter((failure) => failure !== undefined);
      throw new Error(`All requested monthly queries failed: ${failures
        .map((failure) => `${failure.displayDate}: ${failure.error}`)
        .join('; ')}`);
    }
    const failedDisplayDates = displayDates.filter((displayDate) => failedByDisplayDate.has(displayDate));
    return {
      observations: results.flatMap((result) => result.observations),
      rowsScanned: results.reduce((sum, result) => sum + result.rowsScanned, 0),
      pagesScanned: results.reduce((sum, result) => sum + result.pagesScanned, 0),
      failedDisplayDates,
      monthlyQueries: displayDates.map((displayDate) => {
        const result = byDisplayDate.get(displayDate);
        if (result) {
          const { rowsScanned, pagesScanned, attempts, elapsedMs } = result;
          return { displayDate, status: 'succeeded', rowsScanned, pagesScanned, attempts, elapsedMs };
        }
        const failure = failedByDisplayDate.get(displayDate);
        if (!failure) throw new Error(`Monthly query ${displayDate} did not produce a result or failure`);
        return {
          displayDate,
          status: 'failed',
          rowsScanned: null,
          pagesScanned: null,
          attempts: failure.attempts,
          elapsedMs: failure.elapsedMs,
          error: failure.error,
          screenshot: failure.screenshot,
        };
      }),
      elapsedMs: Date.now() - startedAt,
    };
  }

  private async openContext() {
    if (this.config.connectionMode === 'launch') {
      const context = await chromium.launchPersistentContext(this.config.userDataDir, {
        channel: this.config.channel,
        headless: this.config.headless,
        viewport: { width: 1440, height: 1000 },
        locale: 'en-US',
        args: ['--disable-popup-blocking'],
      });
      return { context, closeWhenDone: true };
    }
    const connection = await (this.cdpConnection ||= this.connectCdp());
    return { context: connection.context, closeWhenDone: false };
  }

  private async connectCdp() {
    try {
      const browser = await chromium.connectOverCDP(this.config.cdpEndpoint, {
        timeout: this.config.timeoutMs,
      });
      browser.on('disconnected', () => {
        this.cdpConnection = undefined;
      });
      const context = browser.contexts()[0];
      if (!context) throw new Error('The Chrome CDP endpoint has no browser context');
      return { browser, context };
    } catch (error) {
      this.cdpConnection = undefined;
      throw new Error(
        `Could not attach to the long-lived Chrome process at ${this.config.cdpEndpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getReportPage(context: BrowserContext) {
    const existingReport = context.pages().find((page) => (
      /sem\.3ue\.com/i.test(page.url()) && isSourcesDestinationsPage(page.url())
    ));
    if (this.config.connectionMode === 'launch') return existingReport || context.pages()[0] || context.newPage();

    const pages = [...context.pages()].reverse();
    const dashboard = pages.find((page) => (
      /dash\.3ue\.com/i.test(page.url()) && !/[/#]login/i.test(page.url())
    ))
      || pages.find((page) => /dash\.3ue\.com/i.test(page.url()))
      || await context.newPage();
    if (!/dash\.3ue\.com/i.test(dashboard.url())) {
      await dashboard.goto(this.config.dashboardUrl, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeoutMs,
      });
    }
    await assertAuthenticated(dashboard);
    const node = await selectUsableSemrushNode(dashboard);
    if (existingReport && !node.changed) return existingReport;
    const popupPromise = context.waitForEvent('page', { timeout: this.config.timeoutMs });
    const openButton = dashboard.getByRole('button', { name: '打开', exact: true }).first();
    if (!await openButton.isVisible()) {
      throw new Error('Could not find the Semrush Open button on the authenticated 3ue dashboard');
    }
    await openButton.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded', { timeout: this.config.timeoutMs }).catch(() => undefined);
    return popup;
  }
}

function isSourcesDestinationsPage(value: string) {
  try {
    return /\/analytics\/traffic\/sources-destinations\/?$/i.test(new URL(value).pathname);
  } catch {
    return false;
  }
}

function preferActiveReportUrl(currentValue: string, configuredValue: string) {
  try {
    const current = new URL(currentValue);
    if (isSourcesDestinationsPage(currentValue) && current.searchParams.get('lid')) return current.toString();
  } catch {
    // Fall back to the configured landing/report URL.
  }
  return configuredValue;
}

async function ensureReportForDomain(page: Page, domain: string, timeoutMs = 60_000) {
  const landingInput = page.getByPlaceholder(
    /输入域名|域名、子域名|enter.*domain|domain.*subdomain|website/i,
  ).first();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await findVisibleExactText(page, /^(destinations?|目标)$/i)) return;
    if (await landingInput.isVisible().catch(() => false)) break;
    await page.waitForTimeout(250);
  }
  if (!await landingInput.isVisible().catch(() => false)) {
    throw new Error('Semrush Sources & Destinations report did not expose its domain input or report tabs.');
  }
  await landingInput.fill(domain);
  const analyze = page.getByRole('button', { name: /^(分析|analy[sz]e)$/i }).first();
  if (!await analyze.isVisible()) throw new Error('Could not find the Sources & Destinations Analyze button.');
  await analyze.click();
  const destinationTab = await waitForVisibleExactText(page, /^(destinations?|目标)$/i, 60_000);
  if (!destinationTab) throw new Error('Sources & Destinations report tabs did not appear after Analyze.');
}

async function selectUsableSemrushNode(dashboard: Page) {
  const nodeButton = dashboard.locator('button.select-button')
    .filter({ hasText: /节点\d+.*(?:BUSINESS|GURU).*地区数据库/i })
    .first();
  await nodeButton.waitFor({ state: 'visible', timeout: 30_000 });
  const current = normalizeNodeText(await nodeButton.innerText());
  if (current.includes('✅')) return { text: current, changed: false };

  await nodeButton.click();
  const options = dashboard.locator('nb-option');
  await options.first().waitFor({ state: 'visible', timeout: 10_000 });
  const visibleOptions: Array<{ index: number; text: string }> = [];
  const count = await options.count();
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if (!await option.isVisible()) continue;
    visibleOptions.push({ index, text: normalizeNodeText(await option.innerText()) });
  }
  const selectedText = chooseUsableNodeText(current, visibleOptions.map((option) => option.text));
  if (!selectedText) throw new Error(`No available Semrush node is visible; current=${current}`);
  const selected = visibleOptions.find((option) => option.text === selectedText);
  if (!selected) throw new Error(`Could not resolve the selected Semrush node: ${selectedText}`);
  await options.nth(selected.index).click();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const next = normalizeNodeText(await nodeButton.innerText().catch(() => ''));
    if (next === selectedText) return { text: next, changed: true };
    await dashboard.waitForTimeout(250);
  }
  throw new Error(`Semrush node selector did not switch to ${selectedText}`);
}

export function chooseUsableNodeText(current: string, options: string[]) {
  const available = options.filter((option) => option.includes('✅'));
  if (available.length === 0) return null;
  const currentPlan = current.match(/\b(BUSINESS|GURU|PRO)\b/i)?.[1]?.toUpperCase();
  const currentMultiplier = current.match(/倍率\s*X\s*([\d.]+)/i)?.[1];
  const currentRegions = new Set(
    current.match(/地区数据库\s+([A-Z]{2})\s+([A-Z]{2})/i)?.slice(1).map((value) => value.toUpperCase()) || [],
  );
  return available
    .map((option, index) => {
      const plan = option.match(/\b(BUSINESS|GURU|PRO)\b/i)?.[1]?.toUpperCase();
      const multiplier = option.match(/倍率\s*X\s*([\d.]+)/i)?.[1];
      const regions = option.match(/地区数据库\s+([A-Z]{2})\s+([A-Z]{2})/i)?.slice(1)
        .map((value) => value.toUpperCase()) || [];
      const score = (plan === currentPlan ? 100 : 0)
        + (multiplier === currentMultiplier ? 20 : 0)
        + regions.filter((region) => currentRegions.has(region)).length * 10;
      return { option, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.option || null;
}

function normalizeNodeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function buildReportUrl(reportUrl: string, displayDates: string[]) {
  const url = new URL(reportUrl);
  url.searchParams.delete('__gmitm');
  url.searchParams.set('dateRange', `${displayDates[0]},${displayDates.at(-1)}`);
  return url.toString();
}

function isSameReportRange(currentValue: string, targetValue: string) {
  try {
    const current = new URL(currentValue);
    const target = new URL(targetValue);
    return current.origin === target.origin
      && current.pathname === target.pathname
      && normalizeDateRange(current.searchParams.get('dateRange'))
        === normalizeDateRange(target.searchParams.get('dateRange'));
  } catch {
    return false;
  }
}

function normalizeDateRange(value: string | null) {
  if (!value) return '';
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) return `${parts[0]},${parts[0]}`;
  return `${parts[0]},${parts.at(-1)}`;
}

export function singleMonthFromReportUrl(value: string) {
  try {
    const parts = (new URL(value).searchParams.get('dateRange') || '')
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 1 && /^\d{4}-\d{2}-01$/.test(parts[0])) return parts[0];
    if (parts.length === 2 && parts[0] === parts[1] && /^\d{4}-\d{2}-01$/.test(parts[0])) {
      return parts[0];
    }
    return null;
  } catch {
    return null;
  }
}

async function assertAuthenticated(page: Page) {
  const url = page.url();
  const passwordInputs = await page.locator('input[type="password"]').count();
  if (/sign[-_/]?in|login/i.test(url) || passwordInputs > 0) {
    throw new Error('Semrush browser session is not authenticated. Complete one-time login in the persistent profile.');
  }
}

async function selectDestinationsTab(page: Page) {
  await dismissTransientOverlays(page);
  const namedTab = await waitForVisibleExactText(page, /^(destinations?|目标)$/i, 60_000);
  if (namedTab) {
    await namedTab.click({ force: true });
    return;
  }
  // Fall through to a broader markup scan for Semrush UI variants.
  const candidates = page.locator('button, [role="tab"], a');
  const count = await candidates.count();
  for (let index = 0; index < Math.min(count, 300); index += 1) {
    const candidate = candidates.nth(index);
    const text = (await candidate.innerText().catch(() => '')).trim();
    if (/^(destinations?|目标|去向)$/i.test(text) && await candidate.isVisible()) {
      await candidate.click({ force: true });
      return;
    }
  }
  throw new Error('Could not find the Destinations tab in the rendered page.');
}

async function waitForVisibleExactText(page: Page, pattern: RegExp, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const candidate = await findVisibleExactText(page, pattern);
    if (candidate) return candidate;
    await page.waitForTimeout(250);
  }
  return undefined;
}

async function findVisibleExactText(page: Page, pattern: RegExp): Promise<Locator | undefined> {
  const candidates = page.getByText(pattern, { exact: true });
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return undefined;
}

async function enterDomain(page: Page, domain: string) {
  const existingDomains = await page.locator('button[data-ui-name="TagContainer.Tag"]')
    .allTextContents().catch(() => []);
  if (existingDomains.some((value) => value.trim().toLowerCase() === domain)) return false;
  let input = await findDomainInput(page);
  if (!input) {
    const addButton = page.locator('button[data-ui-name="Button"]').first();
    if (!await addButton.isVisible()) throw new Error('Could not find the Add website button.');
    await dismissTransientOverlays(page);
    await addButton.click({ force: true });
    await page.locator('input:not([type="hidden"]):not([type="password"])').first()
      .waitFor({ state: 'visible', timeout: 10_000 });
    input = await findDomainInput(page);
  }
  if (!input) throw new Error('Could not find a visible domain input.');
  await input.fill(domain);
  await input.press('Enter');
  await clickAnalyzeIfPresent(page);
  return true;
}

async function assertExclusiveDomain(page: Page, domain: string) {
  const selectedDomains = (await page.locator('button[data-ui-name="TagContainer.Tag"]')
    .allTextContents())
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const extraDomains = selectedDomains.filter((value) => value !== domain);
  if (!selectedDomains.includes(domain) || extraDomains.length > 0) {
    throw new Error(
      `Semrush filter must contain only ${domain}; selected=${selectedDomains.join(',') || 'none'}`,
    );
  }
}

async function removeExtraDomains(page: Page, domain: string) {
  const tags = page.locator('button[data-ui-name="TagContainer.Tag"]');
  const selectedDomains = (await tags.allTextContents())
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  let removed = false;
  for (let index = selectedDomains.length - 1; index >= 0; index -= 1) {
    if (selectedDomains[index] === domain) continue;
    const remove = tags.nth(index).locator('svg[data-ui-name="Tag.Addon"][role="button"]');
    if (!await remove.isVisible()) {
      throw new Error(`Could not find the remove control for ${selectedDomains[index]}`);
    }
    await remove.click({ force: true });
    removed = true;
    await page.waitForTimeout(250);
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const remaining = (await tags.allTextContents())
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (remaining.length === 1 && remaining[0] === domain) return removed;
    await page.waitForTimeout(250);
  }
  throw new Error(`Could not isolate ${domain} in the Semrush target filter`);
}

async function findDomainInput(page: Page): Promise<Locator | null> {
  const inputs = page.locator('input:not([type="hidden"]):not([type="password"])');
  const count = await inputs.count();
  let fallback: Locator | null = null;
  for (let index = 0; index < Math.min(count, 100); index += 1) {
    const input = inputs.nth(index);
    if (!await input.isVisible().catch(() => false)) continue;
    const metadata = (await Promise.all([
      input.getAttribute('placeholder', { timeout: 250 }).catch(() => null),
      input.getAttribute('aria-label', { timeout: 250 }).catch(() => null),
      input.getAttribute('name', { timeout: 250 }).catch(() => null),
      input.getAttribute('data-ui-name', { timeout: 250 }).catch(() => null),
    ])).filter(Boolean).join(' ');
    if (/pagination/i.test(metadata)) continue;
    fallback ||= input;
    if (/domain|website|site|competitor|网站|域名|竞争对手/i.test(metadata)) return input;
  }
  return fallback;
}

async function clickAnalyzeIfPresent(page: Page) {
  const candidates = page.locator('button');
  const count = await candidates.count();
  for (let index = 0; index < Math.min(count, 100); index += 1) {
    const candidate = candidates.nth(index);
    const text = (await Promise.all([
      candidate.innerText({ timeout: 250 }).catch(() => ''),
      candidate.getAttribute('aria-label', { timeout: 250 }).catch(() => null),
    ])).filter(Boolean).join(' ').trim();
    if (/^(analy[sz]e|search|save|add|应用|查询|分析|保存|添加)$/i.test(text)
      && await candidate.isVisible().catch(() => false)) {
      await dismissTransientOverlays(page);
      await candidate.click({ force: true });
      return;
    }
  }
}

type DestinationTableState = 'rows' | 'empty';

export function isDestinationEmptyStateText(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /(?:^|\s)(?:nothing found|no data|no results|未找到(?:任何)?(?:结果|数据)?|没有(?:找到)?(?:结果|数据)|暂无数据|无结果)(?:\s|$)/i.test(normalized);
}

export function isDestinationLoadErrorText(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return /^(?:something went wrong|出了点问题|出了问题|出错了|发生错误|加载失败)(?:[.!。！,，:：;；]|\s|$)/i.test(normalized);
}

async function visibleDestinationLoadErrorText(page: Page) {
  const errorState = page.getByText(
    /^(?:Something went wrong|出了点问题|出了问题|出错了|发生错误|加载失败)(?:[.!。！,，:：;；]|\s|$)/i,
  ).filter({ visible: true }).first();
  if (!await errorState.count().catch(() => 0)) return null;
  const text = await errorState.innerText({ timeout: 250 }).catch(() => 'Something went wrong');
  return isDestinationLoadErrorText(text) ? text.replace(/\s+/g, ' ').trim() : null;
}

export function buildMonthlyQueryOrder(displayDates: string[]) {
  return [...displayDates].reverse();
}

async function hasEmptyDestinationState(page: Page) {
  const emptyState = page.getByText(
    /^(?:Nothing found|No data|No results|未找到(?:任何)?(?:结果|数据)?|没有(?:找到)?(?:结果|数据)|暂无数据|无结果)$/i,
    { exact: true },
  ).filter({ visible: true }).first();
  if (await emptyState.count().catch(() => 0)) return true;
  const table = page.locator('[data-ui-name="Table"], table').first();
  if (!await table.count().catch(() => 0)) return false;
  const tableText = await table.innerText({ timeout: 250 }).catch(() => '');
  return isDestinationEmptyStateText(tableText);
}

async function waitForRows(page: Page, timeoutMs = 90_000): Promise<DestinationTableState> {
  const rows = page.locator('[data-ui-name="Body.Row"], table tbody tr');
  const deadline = Date.now() + timeoutMs;
  let emptySince = 0;
  while (Date.now() < deadline) {
    const loadError = await visibleDestinationLoadErrorText(page);
    if (loadError) throw new Error(`Semrush destination report displayed a load error: ${loadError}`);
    const texts = await rows.allTextContents().catch(() => []);
    if (texts.some((text) => /[a-z0-9-]+\.[a-z]{2,}/i.test(text))) return 'rows';
    if (await hasEmptyDestinationState(page)) {
      if (!emptySince) emptySince = Date.now();
      if (Date.now() - emptySince >= 500) return 'empty';
    } else {
      emptySince = 0;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('Destination table did not reach a rows or explicit-empty state.');
}

async function destinationRowsFingerprint(page: Page) {
  const rows = page.locator('[data-ui-name="Body.Row"], table tbody tr');
  return rows.evaluateAll((elements) => elements
    .map((element) => (element.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n'))
    .catch(() => '');
}

async function waitForRowsToRefresh(page: Page, previousFingerprint: string, timeoutMs = 60_000) {
  const startedAt = Date.now();
  let candidateFingerprint = '';
  let stableSince = 0;
  let emptySince = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const loadError = await visibleDestinationLoadErrorText(page);
    if (loadError) throw new Error(`Semrush destination report displayed a load error: ${loadError}`);
    const fingerprint = await destinationRowsFingerprint(page);
    if (fingerprint && fingerprint !== previousFingerprint) {
      if (fingerprint !== candidateFingerprint) {
        candidateFingerprint = fingerprint;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 500) {
        return;
      }
    } else if (fingerprint && Date.now() - startedAt >= 5_000) {
      // Adjacent months can legitimately render identical first pages. The URL
      // transition is already verified before this fallback can be reached.
      return;
    }
    if (await hasEmptyDestinationState(page)) {
      if (!emptySince) emptySince = Date.now();
      // Semrush can leave the previous empty state visible while a new filter
      // is loading. Require both a short stable period and the same five-second
      // settling window used for identical rendered rows.
      if (Date.now() - startedAt >= 5_000 && Date.now() - emptySince >= 500) return;
    } else {
      emptySince = 0;
    }
    await page.waitForTimeout(250);
  }
  throw new Error('Destination table did not refresh after the report filter changed.');
}

async function switchToSingleMonth(page: Page, displayDate: string) {
  if (singleMonthFromReportUrl(page.url()) === displayDate) {
    await waitForRows(page);
    return;
  }
  const match = displayDate.match(/^(\d{4})-(\d{2})-01$/);
  if (!match) throw new Error(`Invalid monthly display date: ${displayDate}`);
  const previousRows = await destinationRowsFingerprint(page);
  const year = Number(match[1]);
  const month = Number(match[2]);
  await dismissTransientOverlays(page);
  await page.getByTestId('history-selector-trigger').click({ force: true, timeout: 10_000 });
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const chineseLabel = `${year}年${month}月`;
  const englishLabel = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${displayDate}T00:00:00Z`));
  const localizedCell = dialog.getByRole('gridcell', {
    name: new RegExp(`^(?:${escapeRegExp(chineseLabel)}|${escapeRegExp(englishLabel)})$`, 'i'),
  }).first();
  await localizedCell.waitFor({ state: 'visible', timeout: 10_000 });
  const ariaDisabled = await localizedCell.getAttribute('aria-disabled', { timeout: 250 }).catch(() => null);
  const enabled = await localizedCell.isEnabled({ timeout: 250 }).catch(() => false);
  if (ariaDisabled === 'true' || !enabled) {
    throw new Error(`Semrush month ${displayDate} is unavailable in the date picker.`);
  }
  await localizedCell.click({ timeout: 10_000 });
  await page.getByTestId('selector-apply').click({ force: true, timeout: 10_000 });
  await page.waitForURL((url) => singleMonthFromReportUrl(url.toString()) === displayDate, {
    timeout: 30_000,
  });
  await waitForRowsToRefresh(page, previousRows, 30_000);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function dismissTransientOverlays(page: Page) {
  const onboardingDismiss = page.getByRole('button', {
    name: /^(?:明白了|知道了|Got it|Understood)$/i,
  }).filter({ visible: true }).first();
  if (await onboardingDismiss.count().catch(() => 0)) {
    await onboardingDismiss.click({ force: true }).catch(() => undefined);
  }
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.locator('[data-ui-name="Tooltip.Popper"]').evaluateAll((elements) => {
    for (const element of elements) {
      (element as HTMLElement).style.pointerEvents = 'none';
    }
  }).catch(() => undefined);
}

async function goToFirstPage(page: Page) {
  const pageInput = page.locator('input[data-ui-name="Pagination.PageInput.Value"]').first();
  if (await pageInput.count() === 0) return;
  const currentPage = Number(await pageInput.inputValue({ timeout: 1_000 }).catch(() => '1'));
  if (currentPage <= 1) return;
  const first = page.locator('button[data-ui-name="Pagination.FirstPage"]').first();
  if (!await first.isEnabled().catch(() => false)) return;
  await first.click();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (Number(await pageInput.inputValue().catch(() => currentPage)) === 1) return;
    await page.waitForTimeout(250);
  }
  throw new Error('Semrush table did not return to the first page.');
}

async function readPaymentDestinationRowsAcrossPages(
  page: Page,
  displayDates: string[],
  input: QueryInput,
  maxPages = 100,
) {
  const registry = buildPaymentPlatformRegistry(input.paymentDomains);
  const groupDomains = (await page.locator('button[data-ui-name="TagContainer.Tag"]')
    .allTextContents())
    .map((value) => value.trim().toLowerCase());
  const targetIndex = groupDomains.indexOf(input.domain);
  if (targetIndex < 0) throw new Error(`The Semrush comparison group does not contain ${input.domain}`);
  const observations: DestinationObservation[] = [];
  let rowsScanned = 0;
  let pagesScanned = 0;
  const rangeLabel = displayDates.length === 1
    ? displayDates[0]
    : `${displayDates[0]}..${displayDates.at(-1) || displayDates[0]}`;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const tableState = await waitForRows(page);
    if (tableState === 'empty') {
      pagesScanned += 1;
      break;
    }
    const rows = page.locator('[data-ui-name="Body.Row"], table tbody tr');
    const renderedRows = await rows.evaluateAll((elements) => elements.map((row, index) => ({
      index,
      text: (row.textContent || '').trim(),
      destinationLabel: row.querySelector('a[aria-label]')?.getAttribute('aria-label') || '',
      categories: Array.from(row.querySelectorAll(
        '[aria-label^="已指定类别："], [aria-label^="Assigned category:"]',
      )).map((element) => (element.getAttribute('aria-label') || '')
        .replace(/^[^:：]+[:：]\s*/, '').trim()).filter(Boolean),
    })));
    const count = renderedRows.length;
    rowsScanned += count;
    pagesScanned += 1;
    for (const renderedRow of renderedRows) {
      const row = rows.nth(renderedRow.index);
      const text = renderedRow.text;
      const destination = renderedRow.destinationLabel.toLowerCase()
        .match(/((?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63})/)?.[1]
        || text.toLowerCase().match(/((?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63})/)?.[1];
      if (!destination || !matchPaymentPlatform(destination, registry)) continue;
      const categories = renderedRow.categories;
      const chartTrigger = row.locator('rect[data-ui-name="Tooltip.Trigger"]').first();
      let traffic: number | null = null;
      if (await chartTrigger.count()) {
        await chartTrigger.hover({ force: true });
        const tooltip = page.locator('[data-ui-name="HoverRect.Tooltip"]')
          .filter({ visible: true })
          .last();
        await tooltip.waitFor({ state: 'visible', timeout: 5_000 });
        const metrics = await tooltip.locator('span[data-ui-name="Text"]').allTextContents();
        traffic = parseTargetTrafficFromTooltip(metrics, targetIndex);
        await dismissTransientOverlays(page);
      }
      if (traffic === null) {
        const cellTexts = await row.locator('[role="gridcell"]').allTextContents().catch(() => []);
        traffic = parseHumanNumber(cellTexts[3] || '');
      }
      if (traffic === null) {
        const parsed = parseRenderedDestinationRow(text);
        traffic = parsed?.traffic ?? null;
      }
      if (traffic === null) continue;
      observations.push({
        displayDate: rangeLabel,
        destination,
        traffic,
        trafficShare: null,
        categories,
      });
    }

    if (pageIndex + 1 >= maxPages) break;

    const pageInput = page.locator('input[data-ui-name="Pagination.PageInput.Value"]').first();
    const currentPage = Number(await pageInput.inputValue().catch(() => String(pageIndex + 1)));
    const totalLabel = await page.locator('button[data-ui-name="Pagination.TotalPages"]').first()
      .getAttribute('aria-label').catch(() => null);
    const totalPages = Number(totalLabel?.match(/(\d+)$/)?.[1] || currentPage);
    const next = page.locator('button[data-ui-name="Pagination.NextPage"]').first();
    if (currentPage >= totalPages || !await next.isEnabled().catch(() => false)) break;
    await next.click();
    const deadline = Date.now() + 30_000;
    let pageChanged = false;
    while (Date.now() < deadline) {
      const nextPage = Number(await pageInput.inputValue().catch(() => currentPage));
      if (nextPage !== currentPage) {
        pageChanged = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    if (!pageChanged) {
      throw new Error(`Semrush pagination did not advance from page ${currentPage} of ${totalPages}`);
    }
    await page.waitForTimeout(500);
  }
  return { observations, rowsScanned, pagesScanned };
}

export function parseTargetTrafficFromTooltip(metrics: string[], targetIndex: number) {
  const trafficText = metrics[targetIndex * 2 + 1];
  return trafficText === undefined ? null : parseHumanNumber(trafficText);
}

export function parseRenderedDestinationRow(text: string) {
  const domainMatch = text.toLowerCase().match(/(?:^|\s)((?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63})(?=\s|$|\/)/);
  if (!domainMatch) return null;
  const trafficCandidates = Array.from(text.matchAll(/(?:^|\s)(\d[\d,.]*\s*[kmb千万亿]?)(?![\d,.]*\s*%)/gi))
    .map((match) => parseHumanNumber(match[1]))
    .filter((value): value is number => value !== null);
  if (trafficCandidates.length === 0) return null;
  const shareMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const categoryMatch = text.match(/(?:category|分类)\s*[:：]?\s*([^\d%]+)/i);
  return {
    destination: domainMatch[1],
    traffic: Math.max(...trafficCandidates),
    trafficShare: shareMatch ? Number(shareMatch[1]) / 100 : null,
    categories: categoryMatch ? categoryMatch[1].split(/[|,>]/).map((value) => value.trim()).filter(Boolean) : [],
  };
}

export function parseHumanNumber(value: string) {
  const normalized = value.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  const match = normalized.match(/^<?(\d+(?:\.\d+)?)([kmb千万亿])?$/);
  if (!match) return null;
  const multiplier = match[2] === 'k' || match[2] === '千'
    ? 1_000
    : match[2] === 'm' || match[2] === '万'
      ? (match[2] === '万' ? 10_000 : 1_000_000)
      : match[2] === 'b' || match[2] === '亿'
        ? (match[2] === '亿' ? 100_000_000 : 1_000_000_000)
        : 1;
  return Number(match[1]) * multiplier;
}

function redactQuery(value: string) {
  const url = new URL(value);
  for (const key of Array.from(url.searchParams.keys())) {
    if (!['dateRange'].includes(key)) url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}
