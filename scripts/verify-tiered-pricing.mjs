// Isolated pricing fixtures. No live account, payment, or provider request.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadMinacoProductCatalog } = require('../src/lib/minaco-product-catalog.ts');
const { renderLanding } = require('../src/lib/landing/render.ts');
const { renderModelPage } = require('../src/lib/marketing/models.ts');

const root = process.cwd(), out = '/tmp/minaco-tiered-pricing-ui';
await mkdir(out, { recursive: true });
const haiku = { provider: 'apiyi-claude', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', engines: ['claude'], version: 'tier-test', unit: 'credits', input: 200, cachedInput: 20, output: 1000, cacheWrite: 250, cacheWrite1h: 400, longContext: { threshold: 100000, input: 1000, cachedInput: 100, output: 5000, cacheWrite: 1250, cacheWrite1h: 2000 }, pricingNote: 'The prompt total includes input, cached reads and cache writes. Its tier applies to the entire request.' };
const catalog = await loadMinacoProductCatalog(async url => Response.json(String(url).endsWith('/models') ? [haiku] : { engines: [{ id: 'claude', name: 'Claude Code', vendor: 'Anthropic', description: 'Coding', status: 'experimental' }] }));
assert.deepEqual(catalog.models[0].longContext, haiku.longContext);
assert.equal(catalog.models[0].cacheWrite1h, 400);
const shim = `import React from '${root}/node_modules/react/index.js';
export function useSearchParams(){return new URLSearchParams(location.search)}
export function useRouter(){return {push(url){location.href=url}}}
export function useUser(){return {isLoaded:true,isSignedIn:true,user:{fullName:'Pricing Test',primaryEmailAddress:{emailAddress:'test@example.invalid'}}}}
export function UserButton(){return null}
export function useClerk(){return {signOut(){}}}
export async function getAnalyticsSessionContext(){return {}}
export default function Link({href,children,...rest}){return React.createElement('a',{...rest,href},children)}`;
await writeFile(out + '/shim.jsx', shim);
await build({ stdin: { contents: `import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import {PublicPricingPage} from '${root}/src/components/public-pricing-page.tsx';import {MinacoAccountPage} from '${root}/src/components/minaco-account-page.tsx';createRoot(document.getElementById('root')).render(location.pathname==='/account'?<MinacoAccountPage/>:<PublicPricingPage/>);`, resolveDir: root, loader: 'jsx' }, bundle: true, format: 'esm', outfile: out + '/app.js', alias: { '@': root + '/src', '@clerk/nextjs': out + '/shim.jsx', 'next/navigation': out + '/shim.jsx', 'next/link': out + '/shim.jsx', '@/lib/analytics/client': out + '/shim.jsx' }, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, loader: { '.woff2': 'file' }, logLevel: 'error' });
const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}button,input,select{font:inherit}</style><div id="root"></div><script type="module" src="/app.js"></script>';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (path.startsWith('/api/')) {
      const body = path === '/api/public/product-catalog' ? catalog : path === '/api/billing/summary' ? { account: { availableCredits: 20000, reservedCredits: 0, lifetimeGrantedCredits: 20000, lifetimeSpentCredits: 0 }, subscription: { planKey: 'STARTER', planName: 'Starter', monthlyCredits: 20000, status: 'active', concurrentTaskLimit: 3 }, capacity: { activeTaskCount: 0, availableTaskSlots: 3 } } : {};
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); return;
    }
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end(renderLanding(catalog, '')); return; }
    if (path === '/model') { res.setHeader('content-type', 'text/html'); res.end(renderModelPage('claude-haiku-5-5', catalog)); return; }
    if (path === '/pricing' || path === '/account') { res.setHeader('content-type', 'text/html'); res.end(html); return; }
    const file = ['/app.js', '/app.css'].includes(path) ? out + path : root + '/public' + path;
    assert(!path.includes('..'));
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on('request', r => r.url().startsWith(origin) || r.url().startsWith('data:') ? r.continue() : r.abort());
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 1000 });
    for (const [name, path] of [['pricing', '/pricing'], ['account', '/account?view=rates'], ['home', '/'], ['model', '/model']]) {
      await page.goto(origin + path, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.body.innerText.includes('> 100,000 prompt tokens'));
      const text = await page.evaluate(() => document.body.innerText);
      assert(text.includes('≤ 100,000 prompt tokens'), name);
      assert(text.includes('1,250') && text.includes('2,000'), name + ' long cache writes');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' overflows');
      if (name === 'model') {
        for (const [tokens, expected] of [[100000, '21 Credits'], [100001, '105.001 Credits']]) {
          await page.$eval('input[name="input"]', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, tokens);
          assert((await page.$eval('[data-calculated]', el => el.textContent)).includes(expected));
        }
      }
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, surfaces: ['pricing', 'account rates', 'homepage', 'model detail and estimator'], viewports: [1440, 390], screenshots: out }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
