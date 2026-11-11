import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
process.env.MINACO_WEBSITE_PREVIEW = '1';
const require = createRequire(import.meta.url);
const { default: config } = require('../next.config.ts');
const { default: sitemap } = require('../src/app/sitemap.ts');
const { marketingPaths } = require('../src/lib/marketing/content.ts');
const { legacyMarketingPaths } = require('../src/lib/legacy-marketing-pages.ts');
const { jsonLd } = require('../src/lib/marketing/seo.ts');
const { GET: agents } = require('../src/app/agents/[[...slug]]/route.ts');
const { GET: guides } = require('../src/app/guides/[[...slug]]/route.ts');
const urls = sitemap().map(entry => entry.url);
for (const route of marketingPaths) assert.ok(urls.includes('https://minaco.ai' + route));
for (const route of legacyMarketingPaths) assert.ok(!urls.includes('https://minaco.ai' + route));
const headers = await config.headers();
for (const route of legacyMarketingPaths) assert.ok(headers.some(entry => entry.source === route && entry.headers.some(header => header.key === 'X-Robots-Tag' && header.value.includes('noindex'))));
for (const redirect of await config.redirects()) {
  assert.ok(!/^\/(api|account|sign-in|sign-up|desktop|connect)(\/|$)/.test(redirect.source));
  assert.ok(redirect.destination.startsWith('https://minaco.ai'));
}
for (const handler of [agents, guides]) {
  for (const slug of [['does-not-exist'], ['claude-code', 'extra']]) {
    const response = await handler(new Request('http://localhost/'), { params: Promise.resolve({ slug }) });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
  }
}
const guide = await guides(new Request('http://localhost/'), { params: Promise.resolve({ slug: ['agent-context-handoff'] }) });
assert.equal(guide.status, 200);
assert.equal(guide.headers.get('Cache-Control'), 'private, no-store');
assert.ok((await guide.text()).includes('Switch agents. Keep context.'));
const payload = { name: '</script><script>alert(1)</script>' };
const encoded = jsonLd(payload).replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
assert.ok(!encoded.includes('<'));
assert.deepEqual(JSON.parse(encoded), payload);
const output = path.resolve(import.meta.dirname, '../../altselfs-seo-review');
for (const route of ['/', ...marketingPaths]) {
  const file = path.join(output, route === '/' ? 'index.html' : route.slice(1) + '/index.html');
  const html = await readFile(file, 'utf8');
  assert.ok(!html.includes('src="/minaco-analytics.js"'));
  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (/^(https?:|data:|mailto:|#)/.test(href)) continue;
    await access(path.resolve(path.dirname(file), href.split(/[?#]/)[0]));
  }
}
console.log('PASS: sitemap/noindex separation, public-only redirects, 404 routes, private account-bearing responses, JSON-LD escaping and local preview links.');
