import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const [dataDirectoryArgument, outputFileArgument] = process.argv.slice(2);
if (!dataDirectoryArgument || !outputFileArgument) {
  throw new Error('Usage: node scripts/build-market-intelligence-import.mjs <enrichment-directory> <output.json>');
}

const dataDirectory = resolve(dataDirectoryArgument);
const outputFile = resolve(outputFileArgument);
const manifest = JSON.parse(readFileSync(join(dataDirectory, 'manifest.json'), 'utf8'));

const MODEL_VERSION = 'minaco-static-competitor-estimate-v1';

const MODELS = {
  enterprise: {
    uniqueVisitorShare: 0.72,
    signupRate: 0.032,
    trialToPaidRate: 0.065,
    checkoutUniqueShare: 0.66,
    checkoutCompletionRate: 0.58,
    monthlyRetention: 0.95,
    monthlyRevenuePerPayer: 65,
  },
  developer: {
    uniqueVisitorShare: 0.70,
    signupRate: 0.075,
    trialToPaidRate: 0.045,
    checkoutUniqueShare: 0.68,
    checkoutCompletionRate: 0.64,
    monthlyRetention: 0.93,
    monthlyRevenuePerPayer: 24,
  },
  creativeAi: {
    uniqueVisitorShare: 0.68,
    signupRate: 0.085,
    trialToPaidRate: 0.04,
    checkoutUniqueShare: 0.70,
    checkoutCompletionRate: 0.66,
    monthlyRetention: 0.88,
    monthlyRevenuePerPayer: 18,
  },
  consumer: {
    uniqueVisitorShare: 0.66,
    signupRate: 0.055,
    trialToPaidRate: 0.025,
    checkoutUniqueShare: 0.72,
    checkoutCompletionRate: 0.68,
    monthlyRetention: 0.84,
    monthlyRevenuePerPayer: 8,
  },
  fintech: {
    uniqueVisitorShare: 0.70,
    signupRate: 0.04,
    trialToPaidRate: 0.055,
    checkoutUniqueShare: 0.64,
    checkoutCompletionRate: 0.56,
    monthlyRetention: 0.94,
    monthlyRevenuePerPayer: 28,
  },
  marketplace: {
    uniqueVisitorShare: 0.68,
    signupRate: 0.045,
    trialToPaidRate: 0.035,
    checkoutUniqueShare: 0.68,
    checkoutCompletionRate: 0.62,
    monthlyRetention: 0.88,
    monthlyRevenuePerPayer: 15,
  },
  content: {
    uniqueVisitorShare: 0.62,
    signupRate: 0.025,
    trialToPaidRate: 0.02,
    checkoutUniqueShare: 0.72,
    checkoutCompletionRate: 0.66,
    monthlyRetention: 0.82,
    monthlyRevenuePerPayer: 7,
  },
  defaultSaas: {
    uniqueVisitorShare: 0.69,
    signupRate: 0.055,
    trialToPaidRate: 0.04,
    checkoutUniqueShare: 0.68,
    checkoutCompletionRate: 0.63,
    monthlyRetention: 0.90,
    monthlyRevenuePerPayer: 19,
  },
};

const HIGH_VALUE_COUNTRIES = new Set([
  'US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'DE', 'FR', 'NL', 'BE', 'LU', 'CH', 'AT', 'DK', 'SE', 'NO', 'FI',
  'IS', 'JP', 'KR', 'SG', 'HK', 'AE', 'IL',
]);
const MID_VALUE_COUNTRIES = new Set([
  'ES', 'IT', 'PT', 'PL', 'CZ', 'SK', 'SI', 'EE', 'LV', 'LT', 'GR', 'HU', 'HR', 'RO', 'BG', 'CN', 'TW',
  'MY', 'TH', 'MX', 'BR', 'AR', 'CL', 'CO', 'UY', 'ZA', 'TR', 'SA', 'QA', 'KW',
]);
const SHARED_PLATFORM_DOMAINS = new Set([
  'amazon.com',
  'apple.com',
  'carrd.co',
  'discord.com',
  'figma.com',
  'github.com',
  'github.io',
  'google.com',
  'gumroad.com',
  'huggingface.co',
  'instagram.com',
  'itch.io',
  'linkedin.com',
  'medium.com',
  'microsoft.com',
  'netlify.app',
  'notion.so',
  'pages.dev',
  'producthunt.com',
  'reddit.com',
  'replit.com',
  'slack.com',
  'sourceforge.net',
  'spotify.com',
  'substack.com',
  't.me',
  'twitter.com',
  'vercel.app',
  'x.com',
  'youtube.com',
]);

function normalizeProductKey(value) {
  return String(value || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '');
}

function productId(productKey) {
  return `ph_${createHash('sha256').update(productKey).digest('hex').slice(0, 24)}`;
}

function isSharedPlatformDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  return [...SHARED_PLATFORM_DOMAINS].some((rootDomain) => (
    domain === rootDomain || domain.endsWith(`.${rootDomain}`)
  ));
}

function launchId(value) {
  return `ph_launch_${String(value || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value) {
  return value === null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value));
}

function money(value) {
  return value === null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value * 100) / 100);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function latestIso(...values) {
  return values.filter(Boolean).toSorted().at(-1) || null;
}

function classifyModel(product, description) {
  const haystack = [
    product.name,
    product.tagline,
    description,
    ...(product.topics || []),
    ...(product.productTypes || []),
  ].join(' ').toLowerCase();

  if (/fintech|finance|invest|crypto|bank|payment|accounting|tax|insurance/.test(haystack)) return 'fintech';
  if (/marketplace|e-commerce|ecommerce|shopping|commerce|booking/.test(haystack)) return 'marketplace';
  if (/enterprise|sales|crm|customer support|human resources|recruit|cybersecurity|security|analytics|marketing/.test(haystack)) return 'enterprise';
  if (/developer|api|github|open source|software engineering|coding|code|database|devops|cloud|hosting/.test(haystack)) return 'developer';
  if (/design|video|photo|audio|writing|generative|artificial intelligence|ai model|image/.test(haystack)) return 'creativeAi';
  if (/health|fitness|social|music|game|travel|food|dating|lifestyle|family|kids|entertainment/.test(haystack)) return 'consumer';
  if (/content|community|news|media|blog|newsletter/.test(haystack)) return 'content';
  return 'defaultSaas';
}

function countryValueFactor(countries) {
  if (!Array.isArray(countries) || countries.length === 0) return 0.75;
  let measuredShare = 0;
  let weighted = 0;
  for (const country of countries) {
    const share = finiteNumber(country?.Value) ?? finiteNumber(country?.share) ?? 0;
    const code = String(country?.CountryCode || country?.countryCode || '').toUpperCase();
    if (share <= 0) continue;
    measuredShare += share;
    weighted += share * (HIGH_VALUE_COUNTRIES.has(code) ? 1.08 : MID_VALUE_COUNTRIES.has(code) ? 0.72 : 0.42);
  }
  if (measuredShare < 1) weighted += (1 - measuredShare) * 0.65;
  return clamp(weighted, 0.42, 1.08);
}

function engagementFactor(similarweb) {
  const engagement = similarweb?.engagement || {};
  const bounceRate = finiteNumber(engagement.BounceRate);
  const pagesPerVisit = finiteNumber(engagement.PagePerVisit);
  const bounceAdjustment = bounceRate === null ? 1 : clamp(1 + (0.50 - bounceRate) * 0.55, 0.80, 1.18);
  const depthAdjustment = pagesPerVisit === null ? 1 : clamp(1 + (pagesPerVisit - 2) * 0.075, 0.86, 1.22);
  return bounceAdjustment * depthAdjustment;
}

function estimateRegistrations(visits, model, similarweb) {
  if (visits === null) return { base: null, low: null, high: null };
  const base = rounded(visits * model.uniqueVisitorShare * model.signupRate * engagementFactor(similarweb));
  return {
    base,
    low: rounded(base * 0.62),
    high: rounded(base * 1.48),
  };
}

function monthsBetween(startDate, endMonth) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endMonth}-01T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 1;
  return Math.max(1, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1);
}

function estimateRevenue({ appark, paymentMonths, registrations, model, countryFactor, launchedAt, latestMonth }) {
  const appRevenue = finiteNumber(appark?.total_revenue_30d);
  if (appRevenue !== null) {
    return {
      base: money(appRevenue),
      low: null,
      high: null,
      source: 'Appark estimate',
      method: 'appark-30d',
    };
  }

  if (registrations === null || !latestMonth) {
    return { base: null, low: null, high: null, source: null, method: null };
  }

  const usablePaymentMonths = [...(paymentMonths || [])]
    .filter((item) => item.value !== null)
    .toSorted((left, right) => left.month.localeCompare(right.month));
  const positivePaymentMonths = usablePaymentMonths.filter((item) => item.value > 0);
  let base;
  let source;
  let method;

  if (positivePaymentMonths.length > 0) {
    const newestPaymentMonth = usablePaymentMonths.at(-1)?.month || latestMonth;
    const activePayers = positivePaymentMonths.reduce((total, item) => {
      const age = Math.max(0, monthsBetween(`${item.month}-01`, newestPaymentMonth) - 1);
      const newPayers = item.value * model.checkoutUniqueShare * model.checkoutCompletionRate * clamp(countryFactor, 0.58, 1.04);
      return total + newPayers * Math.pow(model.monthlyRetention, age);
    }, 0);
    base = activePayers * model.monthlyRevenuePerPayer * countryFactor;
    source = 'Minaco estimate · Semrush payment traffic';
    method = 'payment-destination-cohort';
  } else {
    const acquisitionMonths = Math.min(12, monthsBetween(launchedAt, latestMonth));
    const cohortMultiplier = Array.from({ length: acquisitionMonths }, (_, index) => Math.pow(model.monthlyRetention, index))
      .reduce((total, value) => total + value, 0);
    const newPayers = registrations * model.trialToPaidRate * clamp(countryFactor, 0.55, 1.02);
    base = newPayers * cohortMultiplier * model.monthlyRevenuePerPayer * countryFactor;
    source = 'Minaco estimate · Similarweb fallback';
    method = 'traffic-registration-cohort';
  }

  return {
    base: money(base),
    low: money(base * 0.52),
    high: money(base * 1.68),
    source,
    method,
  };
}

async function readJsonLines(filePath, visit) {
  if (!existsSync(filePath)) return;
  const input = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    visit(JSON.parse(line));
  }
}

const identities = new Map();
await readJsonLines(join(dataDirectory, 'product-identities.jsonl'), (record) => {
  identities.set(normalizeProductKey(record.product_hunt_url), record);
});

const launchesByProduct = new Map();
const launches = [];
await readJsonLines(join(dataDirectory, 'product-launches-with-identities.jsonl'), (record) => {
  const key = normalizeProductKey(record.url);
  if (!key) return;
  const existing = launchesByProduct.get(key) || [];
  existing.push(record);
  launchesByProduct.set(key, existing);
  launches.push(record);
});

const similarwebByProduct = new Map();
await readJsonLines(join(dataDirectory, 'similarweb.raw.jsonl'), (record) => {
  if (!String(record.scanStatus || '').startsWith('success')) return;
  const body = record.raw?.data?.body || {};
  const normalized = {
    fetchedAt: record.fetchedAt || record.raw?.fetchedAt || null,
    monthlyVisits: record.monthlyVisits || body.EstimatedMonthlyVisits || {},
    countries: body.TopCountryShares || [],
    engagement: body.Engagments || {},
    confidence: record.raw?.confidence || 'medium',
    productCount: Array.isArray(record.productKeys) ? record.productKeys.length : 0,
  };
  for (const rawKey of record.productKeys || []) {
    const key = normalizeProductKey(rawKey);
    const previous = similarwebByProduct.get(key);
    if (!previous || String(normalized.fetchedAt || '') >= String(previous.fetchedAt || '')) {
      similarwebByProduct.set(key, normalized);
    }
  }
});

const apparkByProduct = new Map();
await readJsonLines(join(dataDirectory, 'appark-local-products.jsonl'), (record) => {
  apparkByProduct.set(normalizeProductKey(record.product_key), record);
});

const paymentMaps = new Map();
for (const fileName of ['semrush.raw.jsonl', 'semrush-2026-07.raw.jsonl']) {
  await readJsonLines(join(dataDirectory, fileName), (record) => {
    const fetchedAt = String(record.fetchedAt || record.raw?.fetchedAt || '');
    for (const rawKey of record.productKeys || []) {
      const key = normalizeProductKey(rawKey);
      const monthMap = paymentMaps.get(key) || new Map();
      for (const metric of record.monthly || record.raw?.data?.monthly || []) {
        const month = String(metric.displayDate || '').slice(0, 7);
        const value = metric.status === 'available' ? finiteNumber(metric.paymentOutboundVisits) : null;
        if (!month) continue;
        const previous = monthMap.get(month);
        if (!previous || fetchedAt >= previous.fetchedAt) monthMap.set(month, { month, value, fetchedAt });
      }
      paymentMaps.set(key, monthMap);
    }
  });
}

const products = [];
const monthlyMetrics = [];
const appMetrics = [];
const paymentMetrics = [];

for (const product of manifest.products || []) {
  const key = normalizeProductKey(product.productKey || product.productHuntUrl);
  const id = productId(key);
  const identity = identities.get(key) || {};
  const productLaunches = (launchesByProduct.get(key) || []).toSorted((left, right) => String(right.date).localeCompare(String(left.date)));
  const latestLaunch = productLaunches[0] || {};
  const description = String(latestLaunch.product_description || product.tagline || '').trim();
  const domain = identity.website_domain || latestLaunch.website_domain || null;
  const similarwebCandidate = similarwebByProduct.get(key) || null;
  const similarweb = isSharedPlatformDomain(domain) || (similarwebCandidate?.productCount || 0) > 1
    ? null
    : similarwebCandidate;
  const appark = apparkByProduct.get(key) || null;
  const paymentMonths = [...(paymentMaps.get(key)?.values() || [])].toSorted((left, right) => left.month.localeCompare(right.month));
  const modelName = classifyModel(product, description);
  const model = MODELS[modelName];
  const countryFactor = countryValueFactor(similarweb?.countries);
  const visitSeries = Object.entries(similarweb?.monthlyVisits || {})
    .map(([month, value]) => ({ month: month.slice(0, 7), visits: finiteNumber(value) }))
    .filter((item) => item.month && item.visits !== null)
    .toSorted((left, right) => left.month.localeCompare(right.month))
    .slice(-3);
  const registrationSeries = visitSeries.map((metric) => ({
    ...metric,
    registrations: estimateRegistrations(metric.visits, model, similarweb),
  }));
  const latestTraffic = registrationSeries.at(-1) || null;
  const latestMonth = latestTraffic?.month || null;
  const revenue = estimateRevenue({
    appark,
    paymentMonths,
    registrations: latestTraffic?.registrations.base ?? null,
    model,
    countryFactor,
    launchedAt: product.lastLaunchDate,
    latestMonth,
  });
  const trafficGrowth = registrationSeries.length >= 2
    ? registrationSeries[0].visits === 0
      ? registrationSeries.at(-1).visits === 0 ? 0 : null
      : ((registrationSeries.at(-1).visits - registrationSeries[0].visits) / registrationSeries[0].visits) * 100
    : null;
  const appDownloads = finiteNumber(appark?.total_downloads_30d);
  const logoUrl = [...(product.logos || [])].filter(Boolean).at(-1) || latestLaunch.logo || null;
  const topics = [...new Set((product.topics || []).filter(Boolean))];
  const productTypes = [...new Set((product.productTypes || []).filter(Boolean))];
  const platforms = [...new Set((product.platforms || []).filter(Boolean))];
  const websiteUrl = identity.website_url || latestLaunch.website_url || null;
  const appObservedAt = latestIso(
    appark?.ios_checked_at,
    appark?.android_checked_at,
    manifest.generatedAt,
  );
  const metricUpdatedAt = latestIso(similarweb?.fetchedAt, appObservedAt, paymentMonths.at(-1)?.fetchedAt, manifest.generatedAt);

  products.push({
    id,
    external_source: 'product_hunt',
    external_id: key,
    slug: key.split('/').filter(Boolean).at(-1) || id,
    name: product.name,
    tagline: product.tagline || latestLaunch.tagline || null,
    description,
    domain,
    website_url: websiteUrl,
    product_hunt_url: product.productHuntUrl || key,
    logo_url: logoUrl,
    category: topics[0] || productTypes[0] || 'Uncategorized',
    topics,
    product_types: productTypes,
    platforms,
    is_native_app: Boolean(product.isNativeApp),
    launched_at: `${product.lastLaunchDate}T00:00:00.000Z`,
    current_rank: null,
    monthly_traffic: latestTraffic?.visits ?? null,
    traffic_growth_pct: trafficGrowth === null ? null : Math.round(trafficGrowth * 100) / 100,
    monthly_new_revenue_usd: revenue.base,
    revenue_growth_pct: null,
    revenue_estimate_low_usd: revenue.low,
    revenue_estimate_high_usd: revenue.high,
    revenue_estimate_source: revenue.source,
    estimate_method_version: `${MODEL_VERSION}:${revenue.method || 'no-revenue'}`,
    data_confidence: appDownloads !== null || paymentMonths.some((item) => item.value > 0) ? 'medium' : latestTraffic ? 'modelled' : 'unavailable',
    is_mock: false,
    metrics_updated_at: metricUpdatedAt,
    ranking_value: appDownloads ?? latestTraffic?.registrations.base ?? null,
  });

  for (const metric of registrationSeries) {
    monthlyMetrics.push({
      product_id: id,
      month: `${metric.month}-01`,
      traffic_visits: metric.visits,
      estimated_monthly_users: metric.registrations.base,
      estimated_users_low: metric.registrations.low,
      estimated_users_high: metric.registrations.high,
      user_estimate_source: 'Minaco estimate · Similarweb',
      traffic_source: 'Similarweb',
      confidence: similarweb?.confidence || 'medium',
      method_version: MODEL_VERSION,
      observed_at: similarweb?.fetchedAt || manifest.generatedAt,
      is_mock: false,
    });
  }

  if (appark) {
    appMetrics.push({
      product_id: id,
      observed_at: appObservedAt,
      ios_downloads_30d: finiteNumber(appark.ios_downloads_30d),
      ios_revenue_30d: finiteNumber(appark.ios_revenue_30d),
      android_downloads_30d: finiteNumber(appark.android_downloads_30d),
      android_revenue_30d: finiteNumber(appark.android_revenue_30d),
      total_downloads_30d: appDownloads,
      total_revenue_30d: finiteNumber(appark.total_revenue_30d),
      coverage_status: appark.total_coverage_status || null,
      source: 'Appark',
      confidence: 'estimated',
      is_mock: false,
    });
  }

  for (const payment of paymentMonths) {
    paymentMetrics.push({
      product_id: id,
      month: `${payment.month}-01`,
      payment_outbound_visits: payment.value,
      source: 'Semrush payment destinations',
      confidence: 'medium',
      observed_at: payment.fetchedAt || manifest.generatedAt,
      is_mock: false,
    });
  }
}

products.sort((left, right) => {
  if (left.ranking_value !== null || right.ranking_value !== null) {
    if (left.ranking_value === null) return 1;
    if (right.ranking_value === null) return -1;
    if (right.ranking_value !== left.ranking_value) return right.ranking_value - left.ranking_value;
  }
  const dateComparison = right.launched_at.localeCompare(left.launched_at);
  return dateComparison || left.name.localeCompare(right.name);
});
products.forEach((product, index) => {
  product.current_rank = index + 1;
  delete product.ranking_value;
});

const productIdByKey = new Map(products.map((product) => [normalizeProductKey(product.external_id), product.id]));
const launchRows = launches.flatMap((launch) => {
  const productKey = normalizeProductKey(launch.url);
  const linkedProductId = productIdByKey.get(productKey);
  if (!linkedProductId || !launch.post_id) return [];
  return [{
    id: launchId(launch.post_id),
    product_id: linkedProductId,
    source: 'product_hunt',
    external_id: String(launch.post_id),
    launched_at: `${launch.date}T00:00:00.000Z`,
    votes_count: finiteNumber(launch.votes_count),
    comments_count: finiteNumber(launch.comments_count),
    raw_object_key: launch.archive_source || null,
    is_mock: false,
  }];
});

const payload = {
  metadata: {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    sourceDirectory: basename(dataDirectory),
    sourceManifestGeneratedAt: manifest.generatedAt,
    estimateMethodVersion: MODEL_VERSION,
    caveat: 'Website registrations and revenue are Minaco model estimates. App downloads and revenue are Appark estimates.',
    counts: {
      products: products.length,
      launches: launchRows.length,
      monthlyMetrics: monthlyMetrics.length,
      appMetrics: appMetrics.length,
      paymentMetrics: paymentMetrics.length,
      productsWithAudience: (() => {
        const appAudienceIds = new Set(appMetrics.filter((metric) => metric.total_downloads_30d !== null).map((metric) => metric.product_id));
        return products.filter((product) => product.monthly_traffic !== null || appAudienceIds.has(product.id)).length;
      })(),
      productsWithRevenue: products.filter((product) => product.monthly_new_revenue_usd !== null).length,
    },
  },
  products,
  launches: launchRows,
  monthlyMetrics,
  appMetrics,
  paymentMetrics,
};

writeFileSync(outputFile, `${JSON.stringify(payload)}\n`);
console.log(JSON.stringify(payload.metadata, null, 2));
