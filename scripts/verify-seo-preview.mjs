import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';
const require = createRequire(import.meta.url);
const { marketingPaths } = require('../src/lib/marketing/content.ts');
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, '../altselfs-seo-review');
const shots = path.join(output, 'screenshots');
await mkdir(shots, { recursive: true });
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  try {
    let file = path.join(output, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(output + '/')) throw Error('invalid path');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', request => /^(data:|about:|file:)/.test(request.url()) || request.url().startsWith(origin) ? request.continue() : request.abort());
  await page.setViewport({ width: 1440, height: 960 });
  await page.goto(origin + '/index.html', { waitUntil: 'networkidle0' });
  await page.$eval('#workflow-frame', el => el.scrollIntoView());
  await page.waitForFunction(() => typeof document.querySelector('#workflow-frame').contentWindow.renderDemo === 'function');
  await page.evaluate(() => window.previewWorkflow(1, 40));
  const frame = page.frames().find(frame => frame.parentFrame());
  await frame.evaluate(() => document.fonts.ready);
  const demoImage = await (await page.$('#workflow-frame')).screenshot({ type: 'webp' });
  await writeFile(path.join(root, 'public/landing/workflow-preview.webp'), demoImage);
  await writeFile(path.join(output, 'landing/workflow-preview.webp'), demoImage);
  // Social sharing image uses the same actual brand type and colors.
  const og = await browser.newPage();
  await og.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await og.goto(origin + '/agents/index.html');
  await og.setContent(`<style>@font-face{font-family:Minaco;src:url('${origin}/landing/minaco-sans.woff2')}*{box-sizing:border-box}body{margin:0;background:#11100d;color:#f8f2e7;font-family:Minaco,Arial}main{padding:65px 80px}img{width:170px;height:auto}h1{font-size:80px;line-height:1.06;letter-spacing:-4px;margin:70px 0 28px;font-weight:600}h1 span{color:#e7bd67}p{font-size:25px;color:#c4bdae;line-height:1.5;margin:0;max-width:950px}</style><main><img src='${origin}/landing/minaco-wordmark.svg'><h1>All your AI agents.<br><span>One subscription.</span></h1><p>Native AI agents. A shared workspace on your Mac.<br>Switch agents without starting over.</p></main>`);
  await og.evaluate(() => document.fonts.ready);
  const ogImage = await og.screenshot({ type: 'png' });
  await writeFile(path.join(root, 'public/landing/og-minaco.png'), ogImage);
  await writeFile(path.join(output, 'landing/og-minaco.png'), ogImage);
  await og.close();
  const checks = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewport({ width, height: 960 });
    for (const route of ['/', ...marketingPaths]) {
      const url = origin + (route === '/' ? '/index.html' : route + '/index.html');
      assert.equal((await page.goto(url, { waitUntil: 'networkidle0' })).status(), 200);
      const result = await page.evaluate(() => ({
        h1: document.querySelectorAll('h1').length,
        title: document.title,
        canonical: document.querySelector('[rel=canonical]')?.href,
        description: document.querySelector('meta[name=description]')?.content,
        width: document.documentElement.scrollWidth,
        schemas: [...document.querySelectorAll('script[type="application/ld+json"]')].map(e => JSON.parse(e.textContent)),
        images: [...document.images].filter(e => !e.complete || !e.naturalWidth).map(e => e.getAttribute('src')),
        placeholders: /__SERVER_|__CATALOG_/.test(document.body.innerText),
      }));
      assert.equal(result.h1, 1, route);
      assert.ok(result.title && result.description && result.canonical, route);
      assert.ok(result.schemas.length, route);
      assert.equal(result.placeholders, false, route);
      if(result.width > width + 1) console.log(await page.$$eval('body *', es => es.filter(e => {const r=e.getBoundingClientRect();return r.right>innerWidth+1 && getComputedStyle(e).position!=='absolute' && !e.closest('.agent-ribbon-track')}).slice(0,15).map(e=>({tag:e.tagName,cls:e.className,rect:e.getBoundingClientRect().toJSON()}))));
      assert.ok(result.width <= width + 1, `${route}: ${width}px overflow ${result.width}`);
      assert.deepEqual(result.images, [], `${route}: images`);
      if ([1440, 390].includes(width)) await page.screenshot({ path: path.join(shots, `${route === '/' ? 'home' : route.slice(1).replaceAll('/', '-')}-${width}.png`), fullPage: route !== '/' });
      checks.push({ route, width, title: result.title });
      if (route !== '/' && width === 390) {
        await page.click('#menubtn');
        assert.equal(await page.$eval('#menubtn', el => el.getAttribute('aria-expanded')), 'true');
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#menubtn', el => el.getAttribute('aria-expanded')), 'false');
      }
    }
  }
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto('file://' + path.join(output, 'minaco-homepage-preview.html'), { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(shots, 'home-laptop.png') });
  await page.$eval('#workflow-frame', el => el.scrollIntoView());
  await page.waitForFunction(() => typeof document.querySelector('#workflow-frame').contentWindow.renderDemo === 'function');
  await page.evaluate(() => window.previewWorkflow(1, 40));
  await page.click('[data-cycle="annual"]');
  assert.ok(await page.$eval('#plans', el => el.textContent.includes('billed yearly')));
  assert.ok(await page.$eval('#plans a', el => el.getAttribute('href').includes('cycle=annual')));
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'qa-results.json'), JSON.stringify({ checks, javascriptErrors: errors, standaloneDemo: true, annualPricing: true }, null, 2));
  console.log(`PASS: ${checks.length} responsive page checks, structured data, images, mobile menus, standalone HTML demo and annual pricing. Screenshots: ${shots}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
