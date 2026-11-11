import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const require = createRequire(import.meta.url);
process.env.MINACO_WEBSITE_PREVIEW = '1';
const { modelProfiles, agentProfiles } = require('../src/lib/marketing/profiles.ts');
const { renderModelPage, creditRate } = require('../src/lib/marketing/models.ts');
const { marketingPaths } = require('../src/lib/marketing/content.ts');
const { GET } = require('../src/app/models/[[...slug]]/route.ts');
const root = path.resolve(import.meta.dirname, '../../altselfs-seo-review');
const catalog = JSON.parse(await readFile(path.join(root, 'catalog.json'), 'utf8'));
assert.equal(modelProfiles.length, new Set(modelProfiles.map(m => m.slug)).size);
for (const entry of catalog.models) assert.ok(modelProfiles.some(m => m.id === entry.model && m.provider === entry.provider), `Missing editorial page: ${entry.model}`);
for (const agent of catalog.agents) assert.ok(agentProfiles.some(a => a.id === agent.id));
assert.equal(creditRate({ input: 125000, unit: 'microUSD' }, 'input'), 125);
for (const slug of [['unknown'], ['kimi-k3', 'extra']]) assert.equal((await GET(new Request('https://minaco.ai/models'), { params: Promise.resolve({ slug }) })).status, 404);
const unavailable = renderModelPage('muse-ember', { ...catalog, models: [], sources: { ...catalog.sources, agentsAndModels: 'unavailable' } });
assert.ok(unavailable.includes('temporarily unknown'));
assert.ok(!unavailable.includes('data-model-estimator'));
assert.equal(renderModelPage('unknown', catalog), null);
const shots = path.join(root, 'content-screenshots'); await mkdir(shots, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    assert.ok(file.startsWith(root + '/') || file === root);
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(origin) || /^(data:|about:)/.test(req.url()) ? req.continue() : req.abort());
  let checked = 0;
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewport({ width, height: 960 });
    const routes = [1440, 320].includes(width) ? marketingPaths : ['/models', '/models/kimi-k3-1-pro', '/models/muse-ember', '/models/deepseek-v4-1-flash-1017', '/agents/kimi-code'];
    for (const route of routes) {
      await page.goto(origin + route + '/index.html', { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        h1: document.querySelectorAll('h1').length,
        title: document.title,
        canonical: document.querySelector('[rel=canonical]').href,
        placeholders: /__SERVER_|undefined|NaN/.test(document.body.innerText),
        broken: [...document.images].filter(i => !i.naturalWidth).map(i => i.src),
        schemas: [...document.querySelectorAll('[type="application/ld+json"]')].map(s => JSON.parse(s.textContent)),
      }));
      assert.ok(result.width <= width + 1, `${route} overflows at ${width}: ${result.width}`);
      assert.equal(result.h1, 1); assert.ok(result.title && result.schemas.length);
      assert.equal(result.canonical, 'https://minaco.ai' + route);
      assert.equal(result.placeholders, false, route); assert.deepEqual(result.broken, []);
      if (['/models', '/models/kimi-k3-1-pro', '/models/muse-ember', '/agents/kimi-code'].includes(route) && [1440, 768, 390].includes(width)) {
        await page.screenshot({ path: path.join(shots, route.slice(1).replaceAll('/', '-') + '-' + width + '.png'), fullPage: true });
      }
      checked++;
    }
  }
  await page.goto(origin + '/models/index.html');
  await page.select('#model-family', 'Kimi');
  assert.equal(await page.$$eval('[data-model-row]:not([hidden])', els => els.length), 2);
  await page.goto(origin + '/models/muse-ember/index.html');
  await page.$eval('input[name="input"]', el => { el.value = '1000000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.ok(await page.$eval('[data-calculated]', el => el.textContent.startsWith('201 Credits')));
  await page.$eval('input[name="input"]', el => { el.value = '-1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.ok(await page.$eval('[data-calculated]', el => el.textContent.includes('non-negative')));
  await page.click('#menubtn'); assert.equal(await page.$eval('#menubtn', el => el.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('Escape'); assert.equal(await page.$eval('#menubtn', el => el.getAttribute('aria-expanded')), 'false');
  await page.setJavaScriptEnabled(false);
  await page.goto(origin + '/models/muse-ember/index.html');
  assert.ok(await page.$eval('[data-estimate]', el => el.textContent.includes('3 Credits')));
  assert.deepEqual(errors, []);
  await writeFile(path.join(root, 'content-qa.json'), JSON.stringify({ checked, models: modelProfiles.length, agents: agentProfiles.length, javascriptErrors: errors, calculator: true, filter: true, noScriptFallback: true }, null, 2));
  console.log(`PASS: ${checked} responsive checks; all live models/agents covered; pricing units, unavailable state, 404, calculator, filters, mobile menu and no-script fallback.`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
