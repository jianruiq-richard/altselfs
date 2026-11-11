import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const { renderLanding } = createRequire(import.meta.url)('../src/lib/landing/render.ts');
const catalog = { generatedAt: '2026-11-11T00:00:00Z', plans: [], agents: [], models: [], release: null, sources: {} };
const homeScript = await readFile(new URL('../public/landing/home.js', import.meta.url), 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/landing/home.js') {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(homeScript);
    return;
  }
  if (req.url.startsWith('/?')) {
    const account = req.url.includes('signed-in') ? { name: 'Richard', imageUrl: 'https://avatar.invalid/missing.png' } : null;
    res.setHeader('Content-Type', 'text/html');
    res.end(renderLanding(catalog, '', account));
    return;
  }
  res.writeHead(204).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => request.url().startsWith(origin) || request.url().startsWith('data:') ? request.continue() : request.abort());
  for (const width of [1440, 768, 375, 320]) {
    await page.setViewport({ width, height: 900 });
    for (const state of ['signed-out', 'signed-in']) {
      // The account state is present in the original HTML, even without JavaScript.
      await page.setJavaScriptEnabled(false);
      await page.goto(`${origin}/?${state}`, { waitUntil: 'load' });
      const nav = await page.$eval('#nav-actions', el => el.textContent);
      assert.ok(nav.includes(state === 'signed-in' ? 'My account' : 'Log in'));
      assert.ok(!nav.includes(state === 'signed-in' ? 'Log in' : 'My account'));
      const controls = await page.$$eval('#nav-actions a, #menubtn', elements => elements.map(el => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
      }));
      for (const control of controls.filter(control => control.width)) {
        assert.ok(control.left >= 0 && control.right <= width, `${width}px ${state}: ${control.text} is outside the viewport`);
        assert.ok(control.bottom <= 86, `${width}px ${state}: header wrapped`);
      }
      await page.setJavaScriptEnabled(true);
      await page.reload({ waitUntil: 'networkidle0' });
      if (state === 'signed-in') {
        assert.equal(await page.$('.account-avatar img'), null, 'failed avatar falls back to the initial');
        assert.equal(await page.$eval('.account-avatar', el => el.textContent), 'R');
      }
      if (await page.$eval('#menubtn', el => el.getBoundingClientRect().width > 0)) {
        await page.click('#menubtn');
        const mobileLink = await page.$eval('.mobilelogin', el => ({ text: el.textContent, href: el.getAttribute('href'), visible: el.getBoundingClientRect().height > 0 }));
        assert.ok(mobileLink.visible);
        assert.equal(mobileLink.text, state === 'signed-in' ? 'My account' : 'Log in');
        assert.equal(mobileLink.href, state === 'signed-in' ? '/account' : '/sign-in?redirect_url=/account');
        await page.click('#menubtn');
      }
      if ([1440, 375].includes(width)) await page.screenshot({ path: `/tmp/minaco-account-${state}-${width}.png` });
    }
  }
  console.log('PASS: signed-in/out HTML, avatar failure, mobile menu and header bounds at 1440/768/375/320px. Sessions are fixtures; no vendor requests sent.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
