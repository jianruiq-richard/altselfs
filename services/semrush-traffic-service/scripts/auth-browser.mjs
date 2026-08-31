import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const reportUrl = process.env.SEMRUSH_BROWSER_REPORT_URL?.trim();
if (!reportUrl) throw new Error('SEMRUSH_BROWSER_REPORT_URL is required');
const startUrl = process.env.SEMRUSH_AUTH_START_URL?.trim() || reportUrl;
const profileDir = path.resolve(process.env.SEMRUSH_BROWSER_PROFILE_DIR || '/tmp/semrush-browser-profile');
await fs.mkdir(profileDir, { recursive: true });

const context = await chromium.launchPersistentContext(profileDir, {
  channel: process.env.SEMRUSH_BROWSER_CHANNEL || 'chrome',
  headless: false,
  viewport: { width: 1440, height: 1000 },
  locale: 'en-US',
  args: ['--disable-popup-blocking'],
});
const page = context.pages()[0] || await context.newPage();
for (const openPage of context.pages()) attachPageDiagnostics(openPage);
context.on('page', (openPage) => {
  console.log(`[semrush-auth] Popup opened: ${redact(openPage.url())}`);
  attachPageDiagnostics(openPage);
});
console.log(`[semrush-auth] Browser profile: ${profileDir}`);
console.log('[semrush-auth] Sign in directly in the Chromium window. Credentials are never read by this script.');
await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
console.log('[semrush-auth] The window will stay open. Enter Semrush and open Sources & Destinations, then ask Codex to finish authentication.');
await new Promise((resolve) => process.stdin.once('data', resolve));

const candidate = context.pages().find((item) => (
  /sem\.3ue\.com\/analytics\/traffic\/sources-destinations/i.test(item.url())
)) || page;
const passwordCount = await candidate.locator('input[type="password"]').count().catch(() => 0);
const authenticated = /sem\.3ue\.com\/analytics\/traffic\/sources-destinations/i.test(candidate.url())
  && !/login|sign[-_/]?in/i.test(candidate.url())
  && passwordCount === 0;
if (!authenticated) {
  console.error(`[semrush-auth] Report page is not ready. Current page: ${redact(candidate.url())}`);
  await context.close();
  process.exit(1);
}
console.log(`[semrush-auth] Authenticated report loaded: ${await candidate.title()}`);
console.log('[semrush-auth] Persistent profile is ready for headless queries.');
await context.close();

function redact(value) {
  if (!value || value === 'about:blank') return value || 'about:blank';
  const url = new URL(value);
  for (const key of Array.from(url.searchParams.keys())) {
    if (key !== 'dateRange') url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}

function attachPageDiagnostics(openPage) {
  openPage.on('framenavigated', (frame) => {
    if (frame === openPage.mainFrame()) console.log(`[semrush-auth] Navigated: ${redact(frame.url())}`);
  });
  openPage.on('requestfailed', (request) => {
    console.log(`[semrush-auth] Request failed: ${request.failure()?.errorText || 'unknown'} ${redact(request.url())}`);
  });
  openPage.on('response', (response) => {
    if (response.status() >= 400) console.log(`[semrush-auth] HTTP ${response.status()}: ${redact(response.url())}`);
  });
  openPage.on('pageerror', (error) => {
    console.log(`[semrush-auth] Page error: ${error.message.slice(0, 300)}`);
  });
  openPage.on('close', () => console.log('[semrush-auth] Window closed'));
}
