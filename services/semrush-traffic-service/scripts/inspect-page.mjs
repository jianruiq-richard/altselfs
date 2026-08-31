import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const reportUrl = process.env.SEMRUSH_BROWSER_REPORT_URL?.trim();
if (!reportUrl) throw new Error('SEMRUSH_BROWSER_REPORT_URL is required');

const profileDir = path.resolve(process.env.SEMRUSH_BROWSER_PROFILE_DIR || '/tmp/semrush-browser-profile-smoke');
const artifactDir = path.resolve(process.env.SEMRUSH_BROWSER_ARTIFACT_DIR || '/tmp/semrush-browser-artifacts-smoke');
const headless = !['0', 'false', 'no', 'off'].includes((process.env.SEMRUSH_BROWSER_HEADLESS || 'true').toLowerCase());
await fs.mkdir(profileDir, { recursive: true });
await fs.mkdir(artifactDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  headless,
  viewport: { width: 1440, height: 1000 },
  locale: 'en-US',
});
const page = context.pages()[0] || await context.newPage();
try {
  await page.goto(reportUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForTimeout(5_000);
  const inputs = await page.locator('input').evaluateAll((elements) => elements.slice(0, 50).map((element) => ({
    type: element.getAttribute('type'),
    placeholder: element.getAttribute('placeholder'),
    ariaLabel: element.getAttribute('aria-label'),
    name: element.getAttribute('name'),
    visible: Boolean(element.getClientRects().length),
  })));
  const controls = await page.locator('button, [role="tab"], a').evaluateAll((elements) => elements.slice(0, 300).map((element) => ({
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160),
    href: element instanceof HTMLAnchorElement ? element.href : null,
    visible: Boolean(element.getClientRects().length),
  })).filter((item) => item.visible && item.text));
  const rowCount = await page.locator('table tbody tr, [role="rowgroup"] [role="row"]').count();
  const screenshotPath = path.join(artifactDir, `inspect-${Date.now()}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({
    title: await page.title(),
    url: redact(page.url()),
    inputs,
    controls,
    rowCount,
    screenshotPath,
  }, null, 2));
} finally {
  await context.close();
}

function redact(value) {
  const url = new URL(value);
  for (const key of Array.from(url.searchParams.keys())) {
    if (key !== 'dateRange') url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}
