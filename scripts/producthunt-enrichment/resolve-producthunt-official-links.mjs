import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const [manifestPath, outputDir, concurrencyArg = '1', delayArg = '2500'] = process.argv.slice(2);
if (!manifestPath || !outputDir) {
  throw new Error('Usage: node resolve-producthunt-official-links.mjs <manifest.json> <output-dir> [concurrency=1] [delayMs=2500]');
}

const concurrency = Math.max(1, Math.min(3, Number(concurrencyArg) || 1));
const requestDelayMs = Math.max(1000, Number(delayArg) || 2500);
const rawPath = path.join(outputDir, 'producthunt-official-links.raw.jsonl');
const progressPath = path.join(outputDir, 'producthunt-official-links.progress.json');
const donePath = path.join(outputDir, 'producthunt-official-links.done.json');
const curlUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const terminalStatuses = new Set([
  'resolved_website_and_store',
  'resolved_website',
  'resolved_store_only',
  'no_official_link',
  'failed_exhausted',
]);
if (process.env.PRODUCTHUNT_RETRY_FAILED === '1') terminalStatuses.delete('failed_exhausted');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await fs.mkdir(outputDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const prior = await readJsonLines(rawPath);
const latestByProduct = new Map();
for (const record of prior) if (record.productKey) latestByProduct.set(record.productKey, record);
const productFilter = String(process.env.PRODUCTHUNT_PRODUCT_FILTER || '').trim().toLowerCase();
const selectedProducts = productFilter
  ? manifest.products.filter((product) => `${product.productKey} ${product.name}`.toLowerCase().includes(productFilter))
  : manifest.products;
const pending = selectedProducts.filter((product) => !terminalStatuses.has(latestByProduct.get(product.productKey)?.scanStatus));

let cursor = 0;
let completedThisRun = 0;
let appendChain = Promise.resolve();
let nextRequestAt = 0;
let throttleChain = Promise.resolve();
let consecutiveRateLimits = 0;
let rateLimitEvents = 0;
let nextRetryAt = null;
const runCounts = {
  resolved_website_and_store: 0,
  resolved_website: 0,
  resolved_store_only: 0,
  no_official_link: 0,
  failed_exhausted: 0,
};

await writeProgress('running');
await Promise.all(Array.from({ length: concurrency }, () => worker()));
await writeProgress('done');
const done = {
  completedAt: new Date().toISOString(),
  productCount: manifest.productCount,
  countsThisRun: runCounts,
};
await atomicWrite(donePath, `${JSON.stringify(done, null, 2)}\n`);

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= pending.length) return;
    const product = pending[index];
    let record;
    let nonRateLimitAttempts = 0;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await throttle();
        record = await resolveProduct(product);
        consecutiveRateLimits = 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isRateLimitError(message)) {
          consecutiveRateLimits += 1;
          rateLimitEvents += 1;
          const backoffMs = Math.min(15 * 60_000, 2 * 60_000 * (2 ** Math.min(3, consecutiveRateLimits - 1)));
          nextRetryAt = new Date(Date.now() + backoffMs).toISOString();
          record = {
            productKey: product.productKey,
            productHuntUrl: product.productHuntUrl,
            name: product.name,
            isNativeApp: Boolean(product.isNativeApp),
            scanStatus: 'rate_limited_waiting',
            error: message,
            attempt,
            backoffMs,
            nextRetryAt,
            fetchedAt: new Date().toISOString(),
          };
          await appendRecord(record);
          latestByProduct.set(product.productKey, record);
          await writeProgress('rate_limited_backoff');
          await sleep(backoffMs);
          nextRetryAt = null;
          continue;
        }
        nonRateLimitAttempts += 1;
        record = {
          productKey: product.productKey,
          productHuntUrl: product.productHuntUrl,
          name: product.name,
          isNativeApp: Boolean(product.isNativeApp),
          scanStatus: nonRateLimitAttempts >= 3 ? 'failed_exhausted' : 'failed_retryable',
          error: message,
        };
      }
      record.attempt = attempt;
      record.fetchedAt = new Date().toISOString();
      await appendRecord(record);
      if (record.scanStatus !== 'failed_retryable') break;
      await sleep(nonRateLimitAttempts * 15_000);
    }
    latestByProduct.set(product.productKey, record);
    if (Object.hasOwn(runCounts, record.scanStatus)) runCounts[record.scanStatus] += 1;
    completedThisRun += 1;
    if (completedThisRun % 10 === 0 || completedThisRun === pending.length) await writeProgress('running');
  }
}

async function resolveProduct(product) {
  const page = await curlPage(product.productHuntUrl);
  if (page.httpStatus === 404 || page.httpStatus === 410) {
    return {
      productKey: product.productKey,
      productHuntUrl: product.productHuntUrl,
      name: product.name,
      isNativeApp: Boolean(product.isNativeApp),
      platforms: product.platforms || [],
      scanStatus: 'no_official_link',
      officialUrl: null,
      officialDomain: null,
      officialUrlType: null,
      officialSource: null,
      storeIdentities: [],
      pageHttpStatus: page.httpStatus,
      pageFinalUrl: page.finalUrl,
      reason: 'producthunt_page_not_found',
    };
  }
  if (page.httpStatus !== 200 || /<title>Just a moment\.\.\.<\/title>/i.test(page.body)) {
    throw new Error(`Product Hunt page returned HTTP ${page.httpStatus}${/Just a moment/i.test(page.body) ? ' (Cloudflare challenge)' : ''}`);
  }

  const anchors = extractAnchors(page.body, product.productHuntUrl);
  const visit = anchors.find((anchor) => anchor.dataTest === 'visit-website-button');
  const storeIdentities = uniqueStoreIdentities(anchors.map(storeIdentityFromAnchor).filter(Boolean));
  const officialCandidates = [];
  const trackingResolutions = [];
  const resolvedTrackingUrls = new Map();

  if (visit?.href && isExternalUrl(visit.href)) {
    officialCandidates.push({ url: visit.href, source: 'visit_website_button' });
  } else if (visit?.href && isProductHuntTrackingUrl(visit.href)) {
    const resolution = await resolveTracking(visit.href, 'visit_website_button');
    const storeIdentity = storeIdentityFromUrl(resolution.targetUrl);
    if (storeIdentity) storeIdentities.push({ ...storeIdentity, source: 'producthunt_visit_website_redirect' });
    else if (isExternalUrl(resolution.targetUrl)) {
      officialCandidates.push({ url: resolution.targetUrl, source: 'producthunt_visit_website_redirect' });
    }
  }
  for (const anchor of anchors) {
    if (anchor.dataTest === 'visit-website-button') continue;
    if (/^(website|homepage|company website)$/i.test(anchor.text)) {
      officialCandidates.push({ url: anchor.href, source: 'company_info_link' });
    }
    if (/^(app store|mac app store|google play|play store)$/i.test(anchor.text) && isProductHuntTrackingUrl(anchor.href)) {
      const resolution = await resolveTracking(anchor.href, `store_link:${anchor.text}`);
      const storeIdentity = storeIdentityFromUrl(resolution.targetUrl);
      if (storeIdentity) storeIdentities.push({ ...storeIdentity, source: 'producthunt_product_page' });
    }
  }

  let official = firstIndependentOfficial(officialCandidates);
  let redirectResolution = null;
  if (!official && storeIdentities.length === 0 && !visit) {
    const trackingUrl = product.productHuntWebsiteRedirects?.[0];
    if (trackingUrl) {
      redirectResolution = await resolveTracking(trackingUrl, 'manifest_tracking_redirect');
      const storeIdentity = storeIdentityFromUrl(redirectResolution.targetUrl);
      if (storeIdentity) storeIdentities.push(storeIdentity);
      else if (isExternalUrl(redirectResolution.targetUrl)) {
        official = { url: redirectResolution.targetUrl, source: 'producthunt_tracking_redirect' };
      }
    }
  }

  const stores = uniqueStoreIdentities(storeIdentities);
  const scanStatus = official && stores.length
    ? 'resolved_website_and_store'
    : official
      ? 'resolved_website'
      : stores.length
        ? 'resolved_store_only'
        : 'no_official_link';

  return {
    productKey: product.productKey,
    productHuntUrl: product.productHuntUrl,
    name: product.name,
    isNativeApp: Boolean(product.isNativeApp),
    platforms: product.platforms || [],
    scanStatus,
    officialUrl: official?.url || null,
    officialDomain: official ? hostname(official.url) : null,
    officialUrlType: official ? classifyOfficialType(official.url) : null,
    officialSource: official?.source || null,
    storeIdentities: stores,
    pageHttpStatus: page.httpStatus,
    pageFinalUrl: page.finalUrl,
    redirectResolution,
    trackingResolutions,
    extractedLinks: anchors
      .filter((anchor) => anchor.dataTest === 'visit-website-button' || storeIdentityFromAnchor(anchor))
      .map((anchor) => ({ href: anchor.href, text: anchor.text, dataTest: anchor.dataTest || null })),
  };

  async function resolveTracking(url, label) {
    let resolution = resolvedTrackingUrls.get(url);
    if (!resolution) {
      await throttle();
      resolution = await curlRedirectTarget(url);
      resolvedTrackingUrls.set(url, resolution);
    }
    const labeled = { ...resolution, sourceUrl: url, label };
    trackingResolutions.push(labeled);
    return labeled;
  }
}

function isRateLimitError(message) {
  return /HTTP 429|Cloudflare challenge/i.test(String(message || ''));
}

function extractAnchors(html, baseUrl) {
  const anchors = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const rawHref = attrs.match(/\bhref=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean);
    if (!rawHref) continue;
    let href;
    try { href = new URL(decodeHtml(rawHref), baseUrl).toString(); } catch { continue; }
    const dataTest = attrs.match(/\bdata-test=(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean) || '';
    anchors.push({
      href,
      dataTest: decodeHtml(dataTest),
      text: cleanHtml(match[2]),
    });
  }
  return anchors;
}

function firstIndependentOfficial(candidates) {
  for (const candidate of candidates) {
    if (!candidate?.url || !isExternalUrl(candidate.url) || storeIdentityFromUrl(candidate.url)) continue;
    return { ...candidate, url: stripTrackingParameters(candidate.url) };
  }
  return null;
}

function storeIdentityFromAnchor(anchor) {
  const direct = storeIdentityFromUrl(anchor?.href);
  if (direct) return { ...direct, source: 'producthunt_product_page' };
  return null;
}

function storeIdentityFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');
    if (domain === 'apps.apple.com' && /\/app\//i.test(url.pathname)) {
      const appId = url.pathname.match(/\/id(\d+)(?:\/|$)/i)?.[1];
      return appId ? { platform: 'ios', appId, url: stripTrackingParameters(url.toString()) } : null;
    }
    if (domain === 'play.google.com' && url.pathname.startsWith('/store/apps/details')) {
      const appId = url.searchParams.get('id');
      return appId ? { platform: 'android', appId, url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}` } : null;
    }
    return null;
  } catch {
    return null;
  }
}

function uniqueStoreIdentities(values) {
  const seen = new Set();
  return values.filter((item) => {
    if (!item?.platform || !item?.appId) return false;
    const key = `${item.platform}|${String(item.appId).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isExternalUrl(value) {
  try {
    const domain = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return domain !== 'producthunt.com' && !domain.endsWith('.producthunt.com');
  } catch {
    return false;
  }
}

function isProductHuntTrackingUrl(value) {
  try {
    const url = new URL(value);
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');
    return (domain === 'producthunt.com' || domain.endsWith('.producthunt.com')) && url.pathname.startsWith('/r/');
  } catch {
    return false;
  }
}

function classifyOfficialType(value) {
  const domain = hostname(value);
  if (domain === 'github.com') return 'github';
  if (domain === 'gitlab.com') return 'gitlab';
  if (domain === 'huggingface.co') return 'huggingface';
  if (domain === 'chromewebstore.google.com') return 'browser_store';
  return 'website';
}

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

function stripTrackingParameters(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(ref|referrer|utm_.+|source)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function cleanHtml(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}

async function curlPage(url) {
  const marker = `__PH_META_${Date.now()}_${Math.random().toString(16).slice(2)}__`;
  const { stdout } = await execFileAsync('curl', [
    '-L', '--max-time', '35', '-sS', '--compressed',
    '-A', curlUserAgent,
    '-w', `\n${marker}%{http_code}\t%{url_effective}`,
    url,
  ], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 });
  const index = stdout.lastIndexOf(`\n${marker}`);
  if (index < 0) throw new Error('curl response metadata marker missing');
  const [httpStatus, finalUrl] = stdout.slice(index + marker.length + 1).trim().split('\t');
  return { body: stdout.slice(0, index), httpStatus: Number(httpStatus), finalUrl };
}

async function curlRedirectTarget(url) {
  const { stdout } = await execFileAsync('curl', [
    '--max-time', '35', '-sS', '--compressed',
    '-A', curlUserAgent,
    '-o', '/dev/null',
    '-w', '%{http_code}\t%{redirect_url}\t%{url_effective}',
    url,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const [httpStatus, redirectUrl, effectiveUrl] = stdout.trim().split('\t');
  return {
    httpStatus: Number(httpStatus),
    targetUrl: redirectUrl || effectiveUrl,
  };
}

async function throttle() {
  const current = throttleChain.then(async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs) await sleep(waitMs);
    nextRequestAt = Date.now() + requestDelayMs;
  });
  throttleChain = current.catch(() => {});
  await current;
}

async function appendRecord(record) {
  appendChain = appendChain.then(() => fs.appendFile(rawPath, `${JSON.stringify(record)}\n`, 'utf8'));
  await appendChain;
}

async function writeProgress(state) {
  const counts = {};
  for (const record of latestByProduct.values()) counts[record.scanStatus] = (counts[record.scanStatus] || 0) + 1;
  const progress = {
    phase: 'producthunt-official-links',
    state,
    totalProducts: manifest.productCount,
    selectedProducts: selectedProducts.length,
    pendingAtStart: pending.length,
    completedThisRun,
    remainingThisRun: pending.length - completedThisRun,
    concurrency,
    requestDelayMs,
    rateLimitEvents,
    nextRetryAt,
    statusCounts: counts,
    updatedAt: new Date().toISOString(),
  };
  await atomicWrite(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  console.log(JSON.stringify(progress));
}

async function readJsonLines(filePath) {
  try {
    return (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}
