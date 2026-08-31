import { chromium } from 'playwright';

const endpoint = process.env.SEMRUSH_BROWSER_CDP_ENDPOINT || 'http://127.0.0.1:9222';
const targetDomain = process.env.SEMRUSH_TARGET_DOMAIN?.trim().toLowerCase();
if (!targetDomain) throw new Error('SEMRUSH_TARGET_DOMAIN is required');

const browser = await chromium.connectOverCDP(endpoint);
const context = browser.contexts()[0];
const page = context?.pages().find((candidate) => /sem\.3ue\.com/i.test(candidate.url()));
if (!page) throw new Error('No sem.3ue.com page is open');

const tags = page.locator('button[data-ui-name="TagContainer.Tag"]');
const before = (await tags.allTextContents()).map((value) => value.trim().toLowerCase()).filter(Boolean);
for (let index = before.length - 1; index >= 0; index -= 1) {
  if (before[index] === targetDomain) continue;
  const tag = tags.nth(index);
  const remove = tag.locator('svg[data-ui-name="Tag.Addon"][role="button"]');
  if (!await remove.isVisible()) throw new Error(`Remove control is not visible for ${before[index]}`);
  await remove.click({ force: true });
  await page.waitForTimeout(500);
}

const deadline = Date.now() + 15_000;
let after = [];
while (Date.now() < deadline) {
  after = (await tags.allTextContents()).map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (after.length === 1 && after[0] === targetDomain) break;
  await page.waitForTimeout(250);
}
console.log(JSON.stringify({ before, after }));
if (after.length !== 1 || after[0] !== targetDomain) {
  throw new Error(`Could not isolate ${targetDomain}; selected=${after.join(',') || 'none'}`);
}
