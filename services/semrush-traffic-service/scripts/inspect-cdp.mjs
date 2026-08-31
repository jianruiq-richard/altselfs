import { chromium } from 'playwright';

const endpoint = process.env.SEMRUSH_BROWSER_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context?.pages().find((candidate) => /sem\.3ue\.com/i.test(candidate.url()));
if (!page) throw new Error('No sem.3ue.com page is open');

if (process.env.SEMRUSH_INSPECT_CLICK_ADD === '1') {
  await page.locator('button[data-ui-name="Button"]').first().click();
  await page.waitForTimeout(500);
}

const removeDomain = process.env.SEMRUSH_REMOVE_DOMAIN?.trim().toLowerCase();
if (removeDomain) {
  const tag = page.locator('button[data-ui-name="TagContainer.Tag"]')
    .filter({ hasText: removeDomain })
    .first();
  if (!await tag.isVisible()) throw new Error(`Selected-domain tag not found: ${removeDomain}`);
  await tag.locator('svg[data-ui-name="Tag.Addon"][role="button"]').click();
  await tag.waitFor({ state: 'detached', timeout: 10_000 });
  await page.waitForTimeout(1_000);
}

if (process.env.SEMRUSH_INSPECT_FIRST_PAGE === '1') {
  const first = page.locator('button[data-ui-name="Pagination.FirstPage"]').first();
  if (await first.isEnabled().catch(() => false)) {
    await first.click();
    await page.waitForTimeout(2_000);
  }
}

if (process.env.SEMRUSH_INSPECT_SCREENSHOT) {
  await page.screenshot({ path: process.env.SEMRUSH_INSPECT_SCREENSHOT, fullPage: true });
}

const details = await page.locator('button, input, [role="tab"]').evaluateAll((elements) => (
  elements.map((element, index) => ({
    index,
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    placeholder: element.getAttribute('placeholder'),
    dataUiName: element.getAttribute('data-ui-name'),
    visible: Boolean(element.getClientRects().length),
  })).filter((item) => item.visible)
));
const rowProbe = await page.getByText('stripe.com', { exact: true }).first().evaluate((element) => {
  const ancestors = [];
  let current = element;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    ancestors.push({
      depth,
      tag: current.tagName.toLowerCase(),
      role: current.getAttribute('role'),
      dataUiName: current.getAttribute('data-ui-name'),
      className: String(current.className || '').slice(0, 160),
      text: (current.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    });
  }
  return ancestors;
}).catch(() => []);
const structureCounts = await page.locator('body').evaluate(() => ({
  tableRows: document.querySelectorAll('table tr').length,
  ariaRows: document.querySelectorAll('[role="row"]').length,
  dataRows: document.querySelectorAll('[data-ui-name*="Row"], [data-ui-name*="row"]').length,
  gridCells: document.querySelectorAll('[role="gridcell"], [role="cell"]').length,
}));
const tagProbe = await page.locator('button[data-ui-name="TagContainer.Tag"]')
  .filter({ hasText: 'figurelabs.ai' })
  .first()
  .locator('*')
  .evaluateAll((elements) => elements.map((element, index) => ({
    index,
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    dataUiName: element.getAttribute('data-ui-name'),
    ariaLabel: element.getAttribute('aria-label'),
    text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
  })));
const stripeDescendants = await page.locator('[data-ui-name="Body.Row"]')
  .filter({ hasText: 'stripe.com' })
  .first()
  .locator('*')
  .evaluateAll((elements) => elements.map((element, index) => ({
    index,
    tag: element.tagName.toLowerCase(),
    role: element.getAttribute('role'),
    dataUiName: element.getAttribute('data-ui-name'),
    ariaLabel: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    className: String(element.className || '').slice(0, 160),
  })).filter((item) => (
    item.role || item.dataUiName || item.ariaLabel || item.title || item.text
  ))).catch(() => []);
const hoverResults = [];
let hoverTooltipStructure = [];
if (process.env.SEMRUSH_INSPECT_HOVER === '1') {
  const stripeRow = page.locator('[data-ui-name="Body.Row"]').filter({ hasText: 'stripe.com' }).first();
  const bars = stripeRow.locator('[data-ui-name="StackBar.HorizontalBar"]');
  for (let index = 0; index < await bars.count(); index += 1) {
    const bar = bars.nth(index);
    let hoverError = null;
    try {
      await bar.hover({ force: true });
      await page.waitForTimeout(300);
    } catch (error) {
      hoverError = error instanceof Error ? error.message.split('\n')[0] : String(error);
    }
    const tooltips = await page.locator('[role="tooltip"], [data-ui-name*="Tooltip"]')
      .evaluateAll((elements) => elements.filter((element) => element.getClientRects().length)
        .map((element) => ({
          dataUiName: element.getAttribute('data-ui-name'),
          role: element.getAttribute('role'),
          text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        })).filter((item) => item.text));
    hoverResults.push({
      index,
      fill: await bar.getAttribute('fill'),
      color: await bar.getAttribute('color'),
      d: await bar.getAttribute('d'),
      hoverError,
      tooltips,
    });
  }
  hoverTooltipStructure = await page.locator('[data-ui-name="HoverRect.Tooltip"]')
    .filter({ visible: true })
    .last()
    .locator('*')
    .evaluateAll((elements) => elements.map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      dataUiName: element.getAttribute('data-ui-name'),
      text: (element.textContent || '').replace(/\s+/g, ' ').trim(),
    })).filter((item) => item.text)).catch(() => []);
}
const output = {
  url: `${new URL(page.url()).origin}${new URL(page.url()).pathname}`,
  details,
  rowProbe,
  structureCounts,
  tagProbe,
  stripeDescendants,
  hoverResults,
  hoverTooltipStructure,
};
console.log(JSON.stringify(
  process.env.SEMRUSH_INSPECT_COMPACT === '1'
    ? { url: output.url, tagProbe, hoverResults, hoverTooltipStructure }
    : output,
  null,
  2,
));
