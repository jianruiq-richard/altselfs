import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const startUrl = process.env.SEMRUSH_AUTH_START_URL?.trim()
  || 'https://dash.3ue.com/zh-Hans/#/page/m/home';
const profileDir = path.resolve(process.env.SEMRUSH_BROWSER_PROFILE_DIR || '/tmp/semrush-browser-profile-smoke');
const artifactDir = path.resolve(process.env.SEMRUSH_BROWSER_ARTIFACT_DIR || '/tmp/semrush-browser-artifacts-smoke');
await fs.mkdir(artifactDir, { recursive: true });

const events = [];
const context = await chromium.launchPersistentContext(profileDir, {
  channel: process.env.SEMRUSH_BROWSER_CHANNEL || 'chrome',
  headless: false,
  viewport: { width: 1440, height: 1000 },
  locale: 'en-US',
  args: ['--disable-popup-blocking'],
});
context.on('page', attach);
for (const openPage of context.pages()) attach(openPage);
const dashboard = context.pages()[0] || await context.newPage();
try {
  await dashboard.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await dashboard.waitForTimeout(3_000);
  const openButton = dashboard.getByRole('button', { name: '打开', exact: true }).first();
  if (!await openButton.isVisible()) throw new Error('Could not find the visible Semrush Open button on the 3ue dashboard.');
  const popupPromise = context.waitForEvent('page', { timeout: 30_000 });
  await openButton.click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded', { timeout: 90_000 }).catch(() => undefined);
  await popup.waitForTimeout(5_000);
  let reloadAttempted = false;
  if (/sem\.3ue\.com\/home\//i.test(popup.url())) {
    reloadAttempted = true;
    console.log('[3ue-diagnostic] Reloading the post-CacheClean /home/ URL');
    await popup.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 }).catch((error) => {
      record({ type: 'reload-error', message: scrub(error instanceof Error ? error.message : String(error)) });
    });
  }
  await popup.waitForTimeout(20_000);
  popup.setDefaultTimeout(5_000);
  const bodyText = await popup.locator('body').innerText().catch(() => '');
  console.log(JSON.stringify({
    url: safeUrl(popup.url()),
    reloadAttempted,
    bodyTextLength: bodyText.length,
    bodyTextPreview: bodyText.replace(/\s+/g, ' ').slice(0, 300),
    events,
  }, null, 2));
  process.exit(0);
} finally {
  await context.close();
}

function attach(openPage) {
  openPage.on('requestfailed', (request) => record({
    type: 'requestfailed',
    error: request.failure()?.errorText || 'unknown',
    url: safeUrl(request.url()),
  }));
  openPage.on('response', (response) => {
    if (response.status() >= 400) record({
      type: 'http',
      status: response.status(),
      url: safeUrl(response.url()),
    });
  });
  openPage.on('pageerror', (error) => record({ type: 'pageerror', message: scrub(error.message) }));
  openPage.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      record({
        type: `console-${message.type()}`,
        location: safeUrl(message.location().url || openPage.url()),
        message: scrub(message.text()),
      });
    }
  });
}

function record(event) {
  events.push(event);
  console.log(`[3ue-diagnostic] ${JSON.stringify(event)}`);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return String(value).slice(0, 200);
  }
}

function scrub(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"']+/g, (url) => safeUrl(url))
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .slice(0, 500);
}
