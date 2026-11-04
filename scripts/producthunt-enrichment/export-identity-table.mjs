import fs from 'node:fs/promises';
import path from 'node:path';

const [manifestPath, outputDir, mode = 'once', classifiedPath, watchDoneFileName] = process.argv.slice(2);
if (!manifestPath || !outputDir) {
  throw new Error('Usage: node export-identity-table.mjs <manifest.json> <output-dir> [once|watch]');
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const classifiedRows = classifiedPath ? await readJsonLines(classifiedPath) : [];
const resolverRawPath = path.join(outputDir, 'identity-resolution.raw.jsonl');
const resolverDonePath = path.join(outputDir, 'identity-resolution.done.json');
const productHuntLinksRawPath = path.join(outputDir, 'producthunt-official-links.raw.jsonl');
const productHuntLinksDonePath = path.join(outputDir, 'producthunt-official-links.done.json');
const apparkRawPath = path.join(outputDir, 'appark.raw.jsonl');
const jsonlPath = path.join(outputDir, 'product-identities.jsonl');
const csvPath = path.join(outputDir, 'product-identities.csv');
const progressPath = path.join(outputDir, 'identity-table.progress.json');
const launchJsonlPath = path.join(outputDir, 'product-launches-with-identities.jsonl');
const launchCsvPath = path.join(outputDir, 'product-launches-with-identities.csv');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const watchDonePath = watchDoneFileName ? path.join(outputDir, watchDoneFileName) : resolverDonePath;

do {
  await exportSnapshot();
  if (mode !== 'watch' || await exists(watchDonePath)) break;
  await sleep(60_000);
} while (true);

async function exportSnapshot() {
  const resolverRecords = await readJsonLines(resolverRawPath);
  const latest = new Map();
  for (const record of resolverRecords) if (record.productKey) latest.set(record.productKey, record);
  const productHuntLinkRecords = await readJsonLines(productHuntLinksRawPath);
  const latestProductHuntLink = new Map();
  for (const record of productHuntLinkRecords) if (record.productKey) latestProductHuntLink.set(record.productKey, record);
  const apparkRecords = await readJsonLines(apparkRawPath);
  const latestAppark = new Map();
  for (const record of apparkRecords) if (record.productKey) latestAppark.set(record.productKey, record);
  const rows = manifest.products.map((product) => {
    const known = product.knownIdentity;
    const resolved = latest.get(product.productKey);
    const productHuntLink = latestProductHuntLink.get(product.productKey);
    const directWebsiteResolved = Boolean(productHuntLink?.officialUrl && productHuntLink?.officialDomain);
    const websiteUrl = productHuntLink?.officialUrl || resolved?.websiteUrl || known?.websiteUrl || '';
    const websiteDomain = productHuntLink?.officialDomain || resolved?.websiteDomain || known?.websiteDomain || '';
    const authoritativeStores = uniqueStoreIdentities([
      ...(Array.isArray(productHuntLink?.storeIdentities) ? productHuntLink.storeIdentities : []),
      ...(Array.isArray(known?.storeIdentities) ? known.storeIdentities : []),
      ...(Array.isArray(resolved?.storeIdentities) ? resolved.storeIdentities : []),
    ]);
    const apparkStores = verifiedApparkStoreIdentities(latestAppark.get(product.productKey), authoritativeStores);
    const storeIdentities = uniqueStoreIdentities([...authoritativeStores, ...apparkStores]);
    const ios = storeIdentities.find((item) => item.platform === 'ios');
    const android = storeIdentities.find((item) => item.platform === 'android');
    const identityStatus = productHuntLink?.scanStatus
      || resolved?.scanStatus
      || (known?.status === 'resolved' ? 'resolved_producthunt_page' : 'pending');
    return {
      product_name: product.name,
      product_hunt_url: product.productHuntUrl,
      first_launch_date: product.firstLaunchDate,
      last_launch_date: product.lastLaunchDate,
      launch_count: product.launchIds.length,
      is_native_app: product.isNativeApp ? 'Yes' : 'No',
      platforms: product.platforms.join(', '),
      product_types: product.productTypes.join(', '),
      website_url: websiteUrl,
      website_domain: websiteDomain,
      website_resolution_status: identityStatus,
      website_confidence: directWebsiteResolved ? 'authoritative' : resolved?.candidateConfidence || (known?.status === 'resolved' ? 'high' : ''),
      official_url_type: productHuntLink?.officialUrlType || (websiteUrl ? 'website' : ''),
      ios_app_id: ios?.appId || '',
      ios_store_url: ios?.url || '',
      ios_store_status: ios ? storeStatus(ios) : product.isNativeApp ? 'not_found' : 'not_applicable',
      android_package: android?.appId || '',
      android_store_url: android?.url || '',
      android_store_status: android ? storeStatus(android) : product.isNativeApp ? 'not_found' : 'not_applicable',
      store_identity_source: [...new Set(storeIdentities.map((item) => item.source).filter(Boolean))].join(', '),
      identity_source: productHuntLink?.officialSource || (resolved ? resolved.rawSearch?.source || 'web_search' : known ? known.source : ''),
      identity_checked_at: productHuntLink?.fetchedAt || resolved?.fetchedAt || '',
    };
  });
  const headers = Object.keys(rows[0] || {});
  await writeTable(rows, headers, csvPath, jsonlPath);
  if (classifiedRows.length) {
    const identityByProduct = new Map(rows.map((row) => [canonicalProductUrl(row.product_hunt_url), row]));
    const launchRows = classifiedRows.map((source) => {
      const identity = identityByProduct.get(canonicalProductUrl(source.url)) || {};
      return {
        ...source,
        website_url: identity.website_url || '',
        website_domain: identity.website_domain || '',
        website_resolution_status: identity.website_resolution_status || 'pending',
        website_confidence: identity.website_confidence || '',
        official_url_type: identity.official_url_type || '',
        ios_app_id: identity.ios_app_id || '',
        ios_store_url: identity.ios_store_url || '',
        ios_store_status: identity.ios_store_status || '',
        android_package: identity.android_package || '',
        android_store_url: identity.android_store_url || '',
        android_store_status: identity.android_store_status || '',
        store_identity_source: identity.store_identity_source || '',
        identity_source: identity.identity_source || '',
        identity_checked_at: identity.identity_checked_at || '',
      };
    });
    const launchHeaders = [...new Set(launchRows.flatMap((row) => Object.keys(row)))];
    await writeTable(launchRows, launchHeaders, launchCsvPath, launchJsonlPath);
  }
  const statusCounts = {};
  for (const row of rows) statusCounts[row.website_resolution_status] = (statusCounts[row.website_resolution_status] || 0) + 1;
  const progress = {
    productCount: rows.length,
    websiteResolvedCount: rows.filter((row) => row.website_domain).length,
    iosIdCount: rows.filter((row) => row.ios_app_id).length,
    androidPackageCount: rows.filter((row) => row.android_package).length,
    statusCounts,
    resolverDone: await exists(resolverDonePath),
    productHuntLinksDone: await exists(productHuntLinksDonePath),
    productHuntLinksProcessedCount: latestProductHuntLink.size,
    updatedAt: new Date().toISOString(),
    csvPath,
    jsonlPath,
    launchCount: classifiedRows.length,
    launchCsvPath: classifiedRows.length ? launchCsvPath : null,
    launchJsonlPath: classifiedRows.length ? launchJsonlPath : null,
  };
  await atomicWrite(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  console.log(JSON.stringify(progress));
}

function verifiedApparkStoreIdentities(record, authoritativeStores) {
  if (!record || !String(record.scanStatus || '').startsWith('success')) return [];
  const clusterList = Array.isArray(record?.raw?.data?.cluster?.cluster_list)
    ? record.raw.data.cluster.cluster_list
    : [];
  if (!clusterList.length) return [];
  const hasAuthoritativeMatch = clusterList.some((item) => authoritativeStores.some((store) => {
    const platform = item.platform === 'app_store' ? 'ios' : item.platform === 'google_play' ? 'android' : '';
    return platform === store.platform && String(item.app_id || '').toLowerCase() === String(store.appId || '').toLowerCase();
  }));
  if (!hasAuthoritativeMatch && record.identityStatus !== 'exact_app_id') return [];
  return clusterList.map((item) => {
    if (item.platform === 'app_store' && /^\d+$/.test(String(item.app_id || ''))) {
      return {
        platform: 'ios',
        appId: String(item.app_id),
        url: `https://apps.apple.com/us/app/id${item.app_id}`,
        source: 'appark_verified_cluster',
      };
    }
    if (item.platform === 'google_play' && item.app_id) {
      return {
        platform: 'android',
        appId: String(item.app_id),
        url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(String(item.app_id))}`,
        source: 'appark_verified_cluster',
      };
    }
    return null;
  }).filter(Boolean);
}

function storeStatus(identity) {
  if (identity.source === 'producthunt_product_page' || identity.source === 'producthunt_visit_website_redirect') {
    return 'found_producthunt';
  }
  if (identity.source === 'appark_verified_cluster') return 'found_appark_verified';
  return 'found_existing';
}

async function writeTable(rows, headers, targetCsvPath, targetJsonlPath) {
  const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].join('\n') + '\n';
  const jsonl = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  await atomicWrite(targetCsvPath, csv);
  await atomicWrite(targetJsonlPath, jsonl);
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

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function canonicalProductUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const match = url.pathname.match(/^\/products\/([^/?#]+)/i);
    return match ? `https://www.producthunt.com/products/${match[1].toLowerCase()}` : String(value || '').trim();
  } catch {
    return String(value || '').trim();
  }
}

async function atomicWrite(filePath, content) {
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function readJsonLines(filePath) {
  try {
    return (await fs.readFile(filePath, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}
