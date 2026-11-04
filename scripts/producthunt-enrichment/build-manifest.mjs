import fs from 'node:fs/promises';

const [classifiedPath, knownIdentityPath, outputPath] = process.argv.slice(2);
if (!classifiedPath || !knownIdentityPath || !outputPath) {
  throw new Error('Usage: node build-manifest.mjs <classified.jsonl> <known-domain-map.jsonl> <manifest.json>');
}

function parseJsonLines(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function canonicalProductUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const match = url.pathname.match(/^\/products\/([^/?#]+)/i);
    if (match) return `https://www.producthunt.com/products/${match[1].toLowerCase()}`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value || '').trim();
  }
}

function splitTags(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];
}

function normalizeDomain(value) {
  const candidate = /^https?:\/\//i.test(String(value || '')) ? String(value) : `https://${value}`;
  try {
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

function extractStoreIdentity(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'apps.apple.com') {
      const match = url.pathname.match(/\/id(\d+)(?:\/|$)/i);
      return match ? { platform: 'ios', appId: match[1], url: url.toString() } : null;
    }
    if (hostname === 'play.google.com' && url.pathname.startsWith('/store/apps/details')) {
      const appId = url.searchParams.get('id');
      return appId ? { platform: 'android', appId, url: url.toString() } : null;
    }
    return null;
  } catch {
    return null;
  }
}

const classifiedRows = parseJsonLines(await fs.readFile(classifiedPath, 'utf8'));
const knownRows = parseJsonLines(await fs.readFile(knownIdentityPath, 'utf8'));

const knownByProduct = new Map();
for (const row of knownRows) {
  if (row.status !== 'ok' || !row.url) continue;
  const productKey = canonicalProductUrl(row.url);
  const websiteUrl = row.websiteUrl || null;
  const websiteDomain = normalizeDomain(row.websiteDomain || websiteUrl);
  const storeIdentity = extractStoreIdentity(websiteUrl);
  knownByProduct.set(productKey, {
    source: 'producthunt_product_page_2026-09-05',
    status: websiteDomain || storeIdentity ? 'resolved' : 'unresolved',
    websiteUrl,
    websiteDomain,
    storeIdentities: storeIdentity ? [storeIdentity] : [],
  });
}

const productsByKey = new Map();
for (const row of classifiedRows) {
  const productKey = canonicalProductUrl(row.url);
  const item = productsByKey.get(productKey) || {
    productKey,
    productHuntUrl: productKey,
    names: [],
    taglines: [],
    launchIds: [],
    launchDates: [],
    launchPaths: [],
    logos: [],
    productTypes: [],
    platforms: [],
    topics: [],
    productHuntWebsiteRedirects: [],
    nativeFlags: [],
  };
  item.names.push(row.name);
  item.taglines.push(row.tagline);
  item.launchIds.push(String(row.post_id || ''));
  item.launchDates.push(row.date);
  item.launchPaths.push(row.launch_path);
  item.logos.push(row.logo);
  item.productTypes.push(row.product_type);
  item.platforms.push(...splitTags(row.platforms));
  item.topics.push(...splitTags(row.product_hunt_topics));
  item.productHuntWebsiteRedirects.push(row.product_hunt_website_redirect);
  item.nativeFlags.push(row.is_native_app);
  productsByKey.set(productKey, item);
}

const products = [...productsByKey.values()].map((item) => {
  const launchDates = unique(item.launchDates).sort();
  const names = unique(item.names);
  const taglines = unique(item.taglines);
  const isNativeApp = item.nativeFlags.some((value) => value === 'Yes');
  const knownIdentity = knownByProduct.get(item.productKey) || null;
  return {
    productKey: item.productKey,
    productHuntUrl: item.productHuntUrl,
    name: names.at(-1) || names[0] || '',
    names,
    tagline: taglines.at(-1) || taglines[0] || '',
    taglines,
    launchIds: unique(item.launchIds),
    launchDates,
    firstLaunchDate: launchDates[0] || null,
    lastLaunchDate: launchDates.at(-1) || null,
    launchPaths: unique(item.launchPaths),
    logos: unique(item.logos),
    productTypes: unique(item.productTypes),
    platforms: unique(item.platforms),
    topics: unique(item.topics),
    productHuntWebsiteRedirects: unique(item.productHuntWebsiteRedirects),
    isNativeApp,
    knownIdentity,
  };
}).sort((a, b) => a.firstLaunchDate.localeCompare(b.firstLaunchDate) || a.productKey.localeCompare(b.productKey));

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: classifiedPath,
  knownIdentitySource: knownIdentityPath,
  launchCount: classifiedRows.length,
  productCount: products.length,
  nativeAppProductCount: products.filter((item) => item.isNativeApp).length,
  knownIdentityProductCount: products.filter((item) => item.knownIdentity?.status === 'resolved').length,
  products,
};

await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  launchCount: manifest.launchCount,
  productCount: manifest.productCount,
  nativeAppProductCount: manifest.nativeAppProductCount,
  knownIdentityProductCount: manifest.knownIdentityProductCount,
  outputPath,
}));
