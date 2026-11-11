import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Local review only. Never emit production tracking into the exported artifacts.
delete process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
delete process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
const require = createRequire(import.meta.url);
const { renderLanding } = require('../src/lib/landing/render.ts');
const { renderAgentDirectory, renderAgentPage, renderGuideIndex, renderGuide } = require('../src/lib/marketing/render.ts');
const { renderModelDirectory, renderModelPage } = require('../src/lib/marketing/models.ts');
const { modelProfiles } = require('../src/lib/marketing/profiles.ts');
const { featuredAgents, guides } = require('../src/lib/marketing/content.ts');
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv[2] || '../altselfs-seo-review');
const catalog = JSON.parse(await readFile(path.join(output, 'catalog.json'), 'utf8'));
await mkdir(output, { recursive: true });
await cp(path.join(root, 'public/landing'), path.join(output, 'landing'), { recursive: true });
await cp(path.join(root, 'public/brand/minaco'), path.join(output, 'brand/minaco'), { recursive: true });
const pages = new Map([
  ['/', renderLanding(catalog, '')],
  ['/agents', renderAgentDirectory(catalog)],
  ...featuredAgents.map(a => ['/agents/' + a.slug, renderAgentPage(a.slug, catalog)]),
  ['/models', renderModelDirectory(catalog)],
  ...modelProfiles.map(m => ['/models/' + m.slug, renderModelPage(m.slug, catalog)]),
  ['/guides', renderGuideIndex()],
  ...guides.map(g => ['/guides/' + g.slug, renderGuide(g.slug)]),
]);
const filename = route => route === '/' ? 'index.html' : route.slice(1) + '/index.html';
const demo = await readFile(path.join(root, 'public/landing/workflow-demo.html'), 'utf8');
const attribute = s => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
for (const [route, source] of pages) {
  const file = filename(route);
  const relative = target => path.relative(path.dirname(file), target) || 'index.html';
  let html = source.replace(/<script[^>]*src="\/minaco-analytics.js"[^>]*><\/script>/g, '')
    .replace('</head>', '<meta name="robots" content="noindex,nofollow"></head>')
    .replace('src="/landing/workflow-demo.html"', () => `srcdoc="${attribute(demo)}"`)
    .replace(/(href|src)="(\/(?!\/)[^"]*)"/g, (all, attr, url) => {
      const [pathname, suffix = ''] = url.split(/(?=[?#])/);
      if (pages.has(pathname)) return `${attr}="${relative(filename(pathname))}${suffix}"`;
      if (/^\/(landing|brand)\//.test(pathname)) return `${attr}="${relative(pathname.slice(1))}${suffix}"`;
      return `${attr}="https://minaco.ai${url}"`;
    });
  // Pricing controls create account URLs after the initial render.
  html = html.replace('</body>', `<script>document.addEventListener('click',function(e){var a=e.target.closest('a');var h=a&&a.getAttribute('href');if(h&&h.startsWith('/')&&!h.startsWith('//')){e.preventDefault();location.href='https://minaco.ai'+h;}});</script></body>`);
  const target = path.join(output, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html);
  if (route === '/') {
    const css = (await readFile(path.join(root, 'public/landing/marketing.css'), 'utf8')).replace('/landing/minaco-sans.woff2', 'data:font/woff2;base64,' + (await readFile(path.join(root, 'public/landing/minaco-sans.woff2'))).toString('base64'));
    const js = await readFile(path.join(root, 'public/landing/home.js'), 'utf8');
    let standalone = html.replace('<link rel="stylesheet" href="landing/marketing.css">', () => `<style>${css}</style>`)
      .replace(/<script[^>]*src="landing\/home.js"[^>]*><\/script>/, () => `<script>${js}</script>`);
    standalone = standalone.replaceAll('src="landing/minaco-wordmark.svg"', 'src="data:image/svg+xml;base64,' + (await readFile(path.join(root, 'public/landing/minaco-wordmark.svg'))).toString('base64') + '"');
    await writeFile(path.join(output, 'minaco-homepage-preview.html'), standalone);
  }
}
await writeFile(path.join(output, 'README.txt'), `Minaco P0–P1 local review\nOpen minaco-homepage-preview.html for the homepage, or index.html for the linked content preview.\nKeep the entire folder together to follow the new agent/guide links.\nLogin, pricing, account, download and legal links open the real Minaco site.\nNo production analytics are included. All exported pages are noindex.\nCatalog snapshot: ${catalog.generatedAt}. No files have been pushed or deployed.\n`);
console.log(`Exported ${pages.size} pages and standalone homepage to ${output}`);
