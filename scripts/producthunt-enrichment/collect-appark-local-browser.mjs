import fs from 'node:fs/promises';
import path from 'node:path';

const [identityPath, outputDir, cdpEndpointArg = 'http://127.0.0.1:9333', delayArg = '8000'] = process.argv.slice(2);
if (!identityPath || !outputDir) {
  throw new Error('Usage: node collect-appark-local-browser.mjs <product-identities.jsonl> <output-dir> [cdp-endpoint] [delay-ms]');
}

const cdpEndpoint = cdpEndpointArg.replace(/\/$/, '');
const requestDelayMs = Math.max(3000, Number(delayArg) || 8000);
const rawPath = path.join(outputDir, 'appark-local-platform.raw.jsonl');
const productPath = path.join(outputDir, 'appark-local-products.jsonl');
const progressPath = path.join(outputDir, 'appark-local.progress.json');
const donePath = path.join(outputDir, 'appark-local.done.json');
const terminalStatuses = new Set([
  'success_value',
  'success_zero',
  'success_no_estimate',
  'no_match',
  'identity_mismatch',
  'failed_exhausted',
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    this.ws.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Local Chrome connection closed'));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    if (!this.isOpen()) return Promise.reject(new Error('Local Chrome connection is not open'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close() {
    this.ws?.close();
  }
}

await fs.mkdir(outputDir, { recursive: true });
const products = (await readJsonLines(identityPath))
  .filter((row) => row.is_native_app === 'Yes')
  .map((row) => ({
    productKey: row.product_hunt_url,
    productName: row.product_name,
    productHuntUrl: row.product_hunt_url,
    iosAppId: clean(row.ios_app_id),
    iosStoreUrl: clean(row.ios_store_url),
    androidPackage: clean(row.android_package),
    androidStoreUrl: clean(row.android_store_url),
    storeIdentitySource: clean(row.store_identity_source),
  }))
  .sort((left, right) => left.productKey.localeCompare(right.productKey));
const targets = products.flatMap((product) => [
  { ...product, platform: 'ios', platformNumber: 1, requestedStoreId: product.iosAppId },
  { ...product, platform: 'android', platformNumber: 2, requestedStoreId: product.androidPackage },
]);
const previousRecords = await readJsonLines(rawPath);
const latest = new Map();
for (const record of previousRecords) {
  if (record.productKey && record.platform) latest.set(targetKey(record), record);
}
const corrections = [];
for (const [key, record] of latest) {
  if (record.matchStatus !== 'name_contains' || record.queryStatus === 'identity_mismatch') continue;
  const corrected = {
    ...record,
    queryStatus: 'identity_mismatch',
    downloads30d: null,
    revenue30d: null,
    countryDistribution: [],
    correctedFromStatus: record.queryStatus,
    correctionReason: 'Search-only substring matches are not reliable enough for product identity.',
    correctedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  };
  delete corrected.raw;
  latest.set(key, corrected);
  corrections.push(corrected);
}
if (corrections.length) {
  await fs.appendFile(rawPath, `${corrections.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}
const pending = targets.filter((target) => !terminalStatuses.has(latest.get(targetKey(target))?.queryStatus));

let cdp;
let completedThisRun = 0;
let totalElapsedMs = 0;
let currentTarget = null;
let lastError = null;
let nextAllowedAt = 0;

await writeProgress('starting');
cdp = await connectToApparkPage(cdpEndpoint);
await writeProgress('running');

for (const target of pending) {
  currentTarget = { productKey: target.productKey, productName: target.productName, platform: target.platform };
  let finalRecord;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const startedAt = Date.now();
    try {
      await throttle();
      finalRecord = await collectTarget(cdp, target, attempt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const blocked = /HTTP (403|429)|cloudflare|rate.?limit/i.test(message);
      finalRecord = baseRecord(target, attempt, attempt === 3 ? 'failed_exhausted' : 'failed_retryable');
      finalRecord.error = message;
      finalRecord.rateLimited = blocked;
      lastError = message;
    }
    finalRecord.elapsedMs = Date.now() - startedAt;
    finalRecord.fetchedAt = new Date().toISOString();
    totalElapsedMs += finalRecord.elapsedMs;
    await fs.appendFile(rawPath, `${JSON.stringify(finalRecord)}\n`, 'utf8');
    latest.set(targetKey(target), finalRecord);
    if (finalRecord.queryStatus !== 'failed_retryable') break;
    await sleep(finalRecord.rateLimited ? 15 * 60_000 : attempt * 30_000);
    if (!cdp.isOpen()) cdp = await connectToApparkPage(cdpEndpoint);
  }
  completedThisRun += 1;
  if (completedThisRun % 5 === 0 || completedThisRun === pending.length) {
    await writeProductSnapshot();
    await writeProgress('running');
  }
}

currentTarget = null;
await writeProductSnapshot();
await writeProgress('done');
await atomicWrite(donePath, `${JSON.stringify({ completedAt: new Date().toISOString(), productCount: products.length, platformTargetCount: targets.length }, null, 2)}\n`);
cdp.close();

async function collectTarget(client, target, attempt) {
  const searchResponse = target.requestedStoreId
    ? null
    : await browserGet(client, '/api/app/search-suggest', {
        keyword: target.productName,
        page: '1',
        size: '20',
        platform: String(target.platformNumber),
        country: 'all',
      });
  const searchData = payloadData(searchResponse?.body);
  const candidates = Array.isArray(searchData?.list) ? searchData.list.map(normalizeCandidate).filter(Boolean) : [];
  const selected = target.requestedStoreId
    ? { appId: target.requestedStoreId, appName: null, country: 'us', matchReason: 'provided_store_id' }
    : selectCandidate(candidates, target.productName, target.platformNumber);
  if (!selected) {
    return {
      ...baseRecord(target, attempt, 'no_match'),
      matchStatus: 'no_match',
      searchCandidates: candidates,
      downloads30d: null,
      revenue30d: null,
      countryDistribution: [],
    };
  }

  const country = normalizeCountry(selected.country);
  const [detailResponse, clusterResponse] = await Promise.all([
    browserGet(client, '/api/app/app-detail', {
      app_id: selected.appId,
      platform: String(target.platformNumber),
      country,
    }),
    browserGet(client, '/api/app-cluster/app-cluster', {
      app_id: selected.appId,
      country,
    }),
  ]);
  const detail = payloadData(detailResponse.body);
  const cluster = payloadData(clusterResponse.body);
  const detailAppId = clean(detail?.app_id);
  const detailAppName = clean(detail?.app_name);
  if (detailAppId && detailAppId.toLowerCase() !== selected.appId.toLowerCase()) {
    return {
      ...baseRecord(target, attempt, 'identity_mismatch'),
      resolvedStoreId: detailAppId,
      resolvedAppName: detailAppName || null,
      matchStatus: 'store_id_mismatch',
      downloads30d: null,
      revenue30d: null,
      countryDistribution: [],
    };
  }
  const identitySource = target.storeIdentitySource.toLowerCase();
  const apparkOnlyIdentity = Boolean(target.requestedStoreId)
    && identitySource.includes('appark_verified_cluster')
    && !identitySource.includes('producthunt');
  if (apparkOnlyIdentity && !namesCompatible(target.productName, detailAppName)) {
    return {
      ...baseRecord(target, attempt, 'identity_mismatch'),
      resolvedStoreId: selected.appId,
      resolvedAppName: detailAppName || selected.appName || null,
      matchStatus: 'appark_only_name_mismatch',
      downloads30d: null,
      revenue30d: null,
      countryDistribution: [],
    };
  }

  const clusterId = clean(cluster?.cluster_id) || clean(selected.clusterId);
  const metricsResponse = clusterId
    ? await browserGet(client, '/api/app-cluster/cluster-download-revenue', { cluster_id: clusterId })
    : null;
  const metricRows = Array.isArray(payloadData(metricsResponse?.body))
    ? payloadData(metricsResponse.body).map(normalizeMetricRow).filter(Boolean)
    : [];
  const overall = metricRows.find((row) => row.country === 'all') || null;
  const downloads30d = overall?.downloads30d ?? null;
  const revenue30d = overall?.revenue30d ?? null;
  const hasEstimate = downloads30d !== null || revenue30d !== null;
  const queryStatus = hasEstimate
    ? ((downloads30d || 0) > 0 || (revenue30d || 0) > 0 ? 'success_value' : 'success_zero')
    : 'success_no_estimate';

  return {
    ...baseRecord(target, attempt, queryStatus),
    resolvedStoreId: selected.appId,
    resolvedAppName: detailAppName || selected.appName || null,
    resolvedCountry: country,
    clusterId: clusterId || null,
    matchStatus: selected.matchReason,
    downloads30d,
    revenue30d,
    countryDistribution: metricRows.filter((row) => row.country !== 'all'),
    sourceUrl: detailUrl(target.platform, selected.appId, country),
    raw: {
      search: searchResponse?.body || null,
      detail: detailResponse.body,
      cluster: clusterResponse.body,
      downloadRevenue30d: metricsResponse?.body || null,
    },
  };
}

function baseRecord(target, attempt, queryStatus) {
  return {
    productKey: target.productKey,
    productName: target.productName,
    productHuntUrl: target.productHuntUrl,
    platform: target.platform,
    requestedStoreId: target.requestedStoreId || null,
    requestedStoreUrl: target.platform === 'ios' ? target.iosStoreUrl || null : target.androidStoreUrl || null,
    storeIdentitySource: target.storeIdentitySource || null,
    attempt,
    queryStatus,
  };
}

async function browserGet(client, pathname, params) {
  const url = new URL(pathname, 'https://appark.ai');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const expression = `(async()=>{const r=await fetch(${JSON.stringify(url.toString())},{credentials:'include',headers:{accept:'application/json, text/plain, */*'}});const text=await r.text();return {status:r.status,ok:r.ok,url:r.url,contentType:r.headers.get('content-type'),text};})()`;
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Appark browser request failed');
  const response = result.result?.value;
  if (!response || typeof response.status !== 'number') throw new Error('Appark browser request returned no response');
  if (!response.ok) throw new Error(`Appark browser request failed with HTTP ${response.status}: ${String(response.text || '').slice(0, 500)}`);
  let body;
  try { body = JSON.parse(response.text); } catch { throw new Error(`Appark browser response was not JSON: ${String(response.text || '').slice(0, 500)}`); }
  return { ...response, body };
}

async function connectToApparkPage(endpoint) {
  const response = await fetch(`${endpoint}/json/list`);
  if (!response.ok) throw new Error(`Could not inspect local Chrome: HTTP ${response.status}`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === 'page' && /^https:\/\/appark\.ai\//.test(target.url));
  if (!page?.webSocketDebuggerUrl) throw new Error('Local Chrome has no open Appark page');
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Runtime.enable');
  const location = await client.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
  if (!/^https:\/\/appark\.ai\//.test(location.result?.value || '')) throw new Error('Local Chrome Appark page is unavailable');
  return client;
}

function selectCandidate(candidates, productName, platformNumber) {
  const compatible = candidates.filter((candidate) => candidate.platform === platformNumber);
  const wanted = comparable(productName);
  const exact = compatible.find((candidate) => comparable(candidate.appName) === wanted);
  if (exact) return { ...exact, matchReason: 'exact_name' };
  return null;
}

function namesCompatible(productName, appName) {
  const product = comparable(productName);
  const app = comparable(appName);
  if (!product || !app) return false;
  return product === app || (product.length >= 6 && app.includes(product)) || (app.length >= 6 && product.includes(app));
}

function normalizeCandidate(value) {
  if (!value || typeof value !== 'object') return null;
  const appId = clean(value.app_id);
  const platform = Number(value.platform);
  if (!appId || ![1, 2].includes(platform)) return null;
  return {
    appId,
    appName: clean(value.app_name),
    developerName: clean(value.developer_name || value.publisher_name),
    country: normalizeCountry(value.country),
    platform,
    clusterId: clean(value.cluster_id),
  };
}

function normalizeMetricRow(value) {
  if (!value || typeof value !== 'object') return null;
  const country = clean(value.Country);
  if (!country) return null;
  return {
    country,
    downloads30d: numberOrNull(value.Last30DaysDownloads),
    revenue30d: numberOrNull(value.Last30DaysRevenue),
    downloadsPercent: numberOrNull(value.Last30DaysDownloadsPercent),
    revenuePercent: numberOrNull(value.Last30DaysRevenuePercent),
  };
}

async function writeProductSnapshot() {
  const rows = products.map((product) => {
    const ios = latest.get(`${product.productKey}|ios`);
    const android = latest.get(`${product.productKey}|android`);
    const iosDownloads = metricValue(ios, 'downloads30d');
    const iosRevenue = metricValue(ios, 'revenue30d');
    const androidDownloads = metricValue(android, 'downloads30d');
    const androidRevenue = metricValue(android, 'revenue30d');
    return {
      product_key: product.productKey,
      product_name: product.productName,
      product_hunt_url: product.productHuntUrl,
      ios_app_id: ios?.resolvedStoreId || product.iosAppId || null,
      ios_downloads_30d: iosDownloads,
      ios_revenue_30d: iosRevenue,
      ios_country_distribution: ios?.countryDistribution || [],
      ios_query_status: ios?.queryStatus || 'pending',
      ios_checked_at: ios?.fetchedAt || null,
      android_package: android?.resolvedStoreId || product.androidPackage || null,
      android_downloads_30d: androidDownloads,
      android_revenue_30d: androidRevenue,
      android_country_distribution: android?.countryDistribution || [],
      android_query_status: android?.queryStatus || 'pending',
      android_checked_at: android?.fetchedAt || null,
      total_downloads_30d: sumAvailable(iosDownloads, androidDownloads),
      total_revenue_30d: sumAvailable(iosRevenue, androidRevenue),
      total_coverage_status: coverageStatus(ios, android),
    };
  });
  await atomicWrite(productPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

async function writeProgress(state) {
  const statusCounts = { ios: {}, android: {} };
  let completedTargets = 0;
  for (const target of targets) {
    const status = latest.get(targetKey(target))?.queryStatus || 'pending';
    statusCounts[target.platform][status] = (statusCounts[target.platform][status] || 0) + 1;
    if (terminalStatuses.has(status)) completedTargets += 1;
  }
  let crossPlatformCompleteProducts = 0;
  for (const product of products) {
    if (terminalStatuses.has(latest.get(`${product.productKey}|ios`)?.queryStatus)
      && terminalStatuses.has(latest.get(`${product.productKey}|android`)?.queryStatus)) {
      crossPlatformCompleteProducts += 1;
    }
  }
  const progress = {
    phase: 'appark-local-browser',
    state,
    productCount: products.length,
    platformTargetCount: targets.length,
    completedTargets,
    pendingTargets: targets.length - completedTargets,
    completedThisRun,
    crossPlatformCompleteProducts,
    concurrency: 1,
    requestDelayMs,
    statusCounts,
    currentTarget,
    averageElapsedMs: completedThisRun ? Math.round(totalElapsedMs / completedThisRun) : null,
    lastError,
    rawPath,
    productPath,
    updatedAt: new Date().toISOString(),
  };
  await atomicWrite(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  console.log(JSON.stringify(progress));
}

async function throttle() {
  const waitMs = Math.max(0, nextAllowedAt - Date.now());
  if (waitMs) await sleep(waitMs);
  nextAllowedAt = Date.now() + requestDelayMs;
}

function payloadData(value) {
  return value && typeof value === 'object' && Object.hasOwn(value, 'data') ? value.data : value;
}

function targetKey(value) {
  return `${value.productKey}|${value.platform}`;
}

function metricValue(record, key) {
  return record && ['success_value', 'success_zero'].includes(record.queryStatus) ? record[key] ?? null : null;
}

function sumAvailable(...values) {
  const available = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return available.length ? available.reduce((sum, value) => sum + value, 0) : null;
}

function coverageStatus(ios, android) {
  const iosAvailable = ios && ['success_value', 'success_zero'].includes(ios.queryStatus);
  const androidAvailable = android && ['success_value', 'success_zero'].includes(android.queryStatus);
  if (iosAvailable && androidAvailable) return 'both_platforms';
  if (iosAvailable) return 'ios_only';
  if (androidAvailable) return 'android_only';
  if (!ios || !android) return 'pending';
  return 'no_platform_estimate';
}

function detailUrl(platform, appId, country) {
  const store = platform === 'ios' ? 'app-store' : 'google-play';
  return `https://appark.ai/en/app-detail/${store}/${encodeURIComponent(appId)}/${country}`;
}

function comparable(value) {
  return clean(value).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeCountry(value) {
  const country = clean(value).toLowerCase();
  return /^[a-z]{2}$/.test(country) ? country : 'us';
}

function numberOrNull(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

async function readJsonLines(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      try { rows.push(JSON.parse(line)); } catch { /* preserve collection progress despite one malformed legacy line */ }
    }
    return rows;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}
