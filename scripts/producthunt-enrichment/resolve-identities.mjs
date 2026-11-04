import fs from 'node:fs/promises';
import path from 'node:path';

const [manifestPath, outputDir, concurrencyArg = '3'] = process.argv.slice(2);
if (!manifestPath || !outputDir) {
  throw new Error('Usage: node resolve-identities.mjs <manifest.json> <output-dir> [concurrency=3]');
}

const serverUrl = String(process.env.PERSONAL_AGENT_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const concurrency = Math.max(1, Math.min(8, Number(concurrencyArg) || 3));
const rawPath = path.join(outputDir, 'identity-resolution.raw.jsonl');
const progressPath = path.join(outputDir, 'identity-resolution.progress.json');
const donePath = path.join(outputDir, 'identity-resolution.done.json');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sharedOrDirectoryDomains = new Set([
  'producthunt.com', 'apps.apple.com', 'play.google.com', 'github.com', 'gitlab.com', 'huggingface.co',
  'npmjs.com', 'pypi.org', 'chromewebstore.google.com', 'microsoft.com', 'youtube.com', 'youtu.be',
  'x.com', 'twitter.com', 'linkedin.com', 'instagram.com', 'facebook.com', 'reddit.com', 'medium.com',
  'substack.com', 'dev.to', 'zhihu.com', 'alternativeto.net', 'crunchbase.com', 'g2.com', 'capterra.com',
  'futurepedia.io', 'theresanaiforthat.com', 'sourceforge.net', 'softonic.com', 'wikipedia.org',
  'nxgntools.com', 'saastool.site', 'apps112.com', 'foxdata.com', 'behance.net', 'webclaw.io',
  'postreads.co', 'mailbrew.com', 'muckrack.com',
  'soft112.com',
]);
const weakWords = new Set(['the', 'a', 'an', 'app', 'apps', 'ai', 'tool', 'tools', 'for', 'with', 'and', 'of', 'to', 'by']);

await fs.mkdir(outputDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const prior = await readJsonLines(rawPath);
const terminalStatuses = new Set([
  'resolved_independent_domain', 'resolved_store_only', 'no_candidate', 'ambiguous_candidate', 'failed_exhausted',
]);
const latestByProduct = new Map();
for (const record of prior) latestByProduct.set(record.productKey, record);

const pending = manifest.products.filter((product) => {
  if (product.knownIdentity?.status === 'resolved') return false;
  return !terminalStatuses.has(latestByProduct.get(product.productKey)?.scanStatus);
});

let cursor = 0;
let completedThisRun = 0;
let appendChain = Promise.resolve();
const runCounts = {
  resolved_independent_domain: 0,
  resolved_store_only: 0,
  no_candidate: 0,
  ambiguous_candidate: 0,
  failed_exhausted: 0,
};

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= pending.length) return;
    const product = pending[index];
    let record;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const rawSearch = await searchProduct(product);
        record = classifySearch(product, rawSearch);
      } catch (error) {
        record = {
          productKey: product.productKey,
          productHuntUrl: product.productHuntUrl,
          name: product.name,
          query: buildQuery(product),
          scanStatus: attempt === 3 ? 'failed_exhausted' : 'failed_retryable',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      record.attempt = attempt;
      record.fetchedAt = new Date().toISOString();
      await appendRecord(record);
      if (record.scanStatus !== 'failed_retryable') break;
      await sleep(attempt * 5000);
    }
    latestByProduct.set(product.productKey, record);
    if (Object.hasOwn(runCounts, record.scanStatus)) runCounts[record.scanStatus] += 1;
    completedThisRun += 1;
    if (completedThisRun % 10 === 0 || completedThisRun === pending.length) await writeProgress();
    await sleep(500);
  }
}

async function searchProduct(product) {
  const query = buildQuery(product);
  const response = await fetch(`${serverUrl}/internal/tools/web-search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(45_000),
  });
  const wrapperText = await response.text();
  let wrapper;
  try { wrapper = JSON.parse(wrapperText); } catch { throw new Error(`search bridge returned invalid JSON: ${wrapperText.slice(0, 300)}`); }
  const text = wrapper?.contentItems?.[0]?.text;
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error(`search tool returned invalid JSON: ${String(text).slice(0, 300)}`); }
  if (!response.ok || raw?.error) throw new Error(raw?.error || `search bridge returned HTTP ${response.status}`);
  return raw;
}

function buildQuery(product) {
  const name = String(product.name || '').replace(/["\r\n]+/g, ' ').trim();
  const intent = product.isNativeApp ? 'official app website' : 'official website';
  return (`"${name}" ${intent} -site:producthunt.com`).slice(0, 300);
}

function classifySearch(product, rawSearch) {
  const results = Array.isArray(rawSearch?.results) ? rawSearch.results : [];
  const storeIdentities = [];
  const candidates = [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const storeIdentity = extractStoreIdentity(result?.url);
    if (storeIdentity) storeIdentities.push({ ...storeIdentity, resultIndex: index, title: result.title || '' });
    const candidate = scoreIndependentCandidate(product, result, index);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) => b.score - a.score || a.resultIndex - b.resultIndex);
  const best = candidates[0] || null;
  const scanStatus = best?.eligible && best.score >= 30
    ? 'resolved_independent_domain'
    : storeIdentities.length
      ? 'resolved_store_only'
      : best
        ? 'ambiguous_candidate'
        : 'no_candidate';
  return {
    productKey: product.productKey,
    productHuntUrl: product.productHuntUrl,
    name: product.name,
    query: buildQuery(product),
    scanStatus,
    websiteUrl: scanStatus === 'resolved_independent_domain' ? best.url : null,
    websiteDomain: scanStatus === 'resolved_independent_domain' ? best.domain : null,
    candidateConfidence: !best || !best.eligible ? 'low' : best.score >= 55 ? 'high' : best.score >= 30 ? 'medium' : 'low',
    bestCandidate: best,
    storeIdentities: uniqueStoreIdentities(storeIdentities),
    rawSearch,
  };
}

function scoreIndependentCandidate(product, result, resultIndex) {
  let url;
  try { url = new URL(String(result?.url || '')); } catch { return null; }
  const domain = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!domain || isSharedOrDirectoryDomain(domain)) return null;
  const nameComparable = comparable(product.name);
  const titleComparable = comparable(result?.title);
  const snippetComparable = comparable(result?.snippet);
  const domainComparable = comparable(domainCore(domain));
  const tokens = String(product.name || '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((word) => word.length > 1 && !weakWords.has(word)) || [];
  let score = Math.max(0, 14 - resultIndex * 2);
  const signals = [];
  const exactTitle = Boolean(nameComparable && titleComparable.includes(nameComparable));
  const domainNameMatch = Boolean(nameComparable && domainComparable.includes(nameComparable));
  const rootOrProductPath = /^\/$|^\/(?:pricing|download|app)?\/?$/i.test(url.pathname);
  if (exactTitle) { score += 32; signals.push('title_contains_exact_name'); }
  if (domainNameMatch) { score += 35; signals.push('domain_contains_exact_name'); }
  const tokenMatches = tokens.filter((word) => titleComparable.includes(comparable(word)) || domainComparable.includes(comparable(word)));
  if (tokenMatches.length) { score += Math.min(24, tokenMatches.length * 8); signals.push(`name_tokens:${tokenMatches.join(',')}`); }
  const taglineComparable = comparable(String(product.tagline || '').slice(0, 55));
  if (taglineComparable.length >= 12 && snippetComparable.includes(taglineComparable)) { score += 25; signals.push('snippet_contains_tagline'); }
  if (rootOrProductPath) { score += 5; signals.push('root_or_product_path'); }
  const directoryLike = /\b(review|reviews|alternative|alternatives|news|article|directory|list|free download|apk|analytics)\b/i.test(`${result?.title || ''} ${result?.snippet || ''} ${url.pathname}`);
  if (directoryLike) {
    score -= 25;
    signals.push('editorial_or_directory_penalty');
  }
  return {
    resultIndex,
    score,
    eligible: domainNameMatch || (exactTitle && rootOrProductPath && resultIndex <= 1 && !directoryLike),
    signals,
    url: url.toString(),
    domain,
    title: String(result?.title || ''),
    snippet: String(result?.snippet || ''),
  };
}

function extractStoreIdentity(value) {
  try {
    const url = new URL(String(value || ''));
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');
    if (domain === 'apps.apple.com') {
      const match = url.pathname.match(/\/id(\d+)(?:\/|$)/i);
      return match ? { platform: 'ios', appId: match[1], url: url.toString() } : null;
    }
    if (domain === 'play.google.com' && url.pathname.startsWith('/store/apps/details')) {
      const appId = url.searchParams.get('id');
      return appId ? { platform: 'android', appId, url: url.toString() } : null;
    }
    return null;
  } catch {
    return null;
  }
}

function uniqueStoreIdentities(values) {
  const seen = new Set();
  return values.filter((item) => {
    const key = `${item.platform}|${String(item.appId).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSharedOrDirectoryDomain(domain) {
  return [...sharedOrDirectoryDomains].some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
}

function comparable(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

function domainCore(domain) {
  const parts = String(domain || '').split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  const commonSecondLevel = new Set(['co.uk', 'com.au', 'co.jp', 'com.cn', 'com.br', 'co.in', 'co.nz']);
  const tail = parts.slice(-2).join('.');
  return commonSecondLevel.has(tail) && parts.length >= 3 ? parts.at(-3) : parts.at(-2);
}

async function appendRecord(record) {
  appendChain = appendChain.then(() => fs.appendFile(rawPath, `${JSON.stringify(record)}\n`, 'utf8'));
  await appendChain;
}

async function writeProgress() {
  const progress = {
    phase: 'identity-resolution',
    totalProducts: manifest.productCount,
    knownIdentityProducts: manifest.knownIdentityProductCount,
    pendingAtStart: pending.length,
    completedThisRun,
    remainingThisRun: pending.length - completedThisRun,
    concurrency,
    countsThisRun: runCounts,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(progressPath, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(progress));
}

async function readJsonLines(filePath) {
  try {
    return (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

await writeProgress();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
await writeProgress();
const done = { completedAt: new Date().toISOString(), productCount: manifest.productCount, countsThisRun: runCounts };
await fs.writeFile(donePath, `${JSON.stringify(done, null, 2)}\n`, 'utf8');
