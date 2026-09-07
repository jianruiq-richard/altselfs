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

const MODEL_VERSION = 'minaco-static-competitor-estimate-v2';

const REVENUE_STATUS = {
  openSource: 'Open Source',
  free: 'Free',
  unavailable: 'Not available',
};

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
  'shopify.com',
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

function normalizedBrand(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function hasDedicatedProductDomain(name, websiteUrl, metricDomain = '') {
  try {
    const url = new URL(String(metricDomain ? `https://${metricDomain}` : websiteUrl || ''));
    const labels = url.hostname.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    const genericLabels = new Set(['app', 'apps', 'blog', 'chat', 'community', 'developer', 'developers', 'docs', 'help', 'news', 'status', 'support']);
    const candidates = labels.slice(0, -1).filter((label) => !genericLabels.has(label));
    if (labels.length >= 2) candidates.push(`${labels.at(-2)}${labels.at(-1)}`);
    const nameKey = normalizedBrand(name);
    return candidates.some((candidate) => {
      const candidateKey = normalizedBrand(candidate);
      const unprefixedKey = candidateKey.replace(/^(?:get|use|try|join|with|hello|hey|my|go)(?=[a-z0-9])/, '');
      return candidateKey === nameKey || unprefixedKey === nameKey;
    });
  } catch {
    return false;
  }
}

function hasVerifiedPricingSignal(record) {
  if (record?.verified !== true) return false;
  const signals = Array.isArray(record.signals) ? record.signals : [];
  return signals.some((signal) => signal !== 'payment_link')
    || /^(?:https:\/\/)?(?:buy|checkout)\.stripe\.com\//i.test(String(record.checkoutUrl || ''))
    || /^(?:https:\/\/)?[^/]*(?:gumroad|lemonsqueezy|paddle|paypal)\.com\//i.test(String(record.checkoutUrl || ''));
}

function revenueEligibilityStatus(product, description, websiteUrl, metricDomain, pricingSignal) {
  const name = String(product.name || '').trim();
  const tagline = String(product.tagline || '').trim();
  const topics = new Set((product.topics || []).map((value) => String(value).trim().toLowerCase()));
  const productTypes = new Set((product.productTypes || []).map((value) => String(value).trim().toLowerCase()));
  const text = `${name} ${tagline} ${description}`.toLowerCase();
  const verifiedPricingEvidence = productTypes.has('saas / web service') && hasVerifiedPricingSignal(pricingSignal);
  const commercialTextEvidence = verifiedPricingEvidence || /\b(?:annual plan|available (?:now )?on (?:all )?plans|buy once|enterprise plan|lifetime license|monthly plan|one-time (?:payment|purchase)|paid (?:plan|subscription)|pay once|premium plan|upgrade to pro)\b/i.test(text)
    || /\b(?:costs?|from|only|priced at|starts? at|starting at|then)\s*[$€£]\s?\d/i.test(text)
    || /[$€£]\s?\d+(?:[.,]\d+)?\s*(?:one[- ]time|per month|\/mo\b)/i.test(text);
  const paidTierName = /\b(?:business|enterprise|premium|pro)\b/i.test(name);

  if (!commercialTextEvidence && (topics.has('open source') || /\bopen[\s‐‑‒–—-]*source\b/i.test(text))) {
    return { label: REVENUE_STATUS.openSource, method: 'open-source-without-paid-evidence' };
  }

  const explicitlyFree = topics.has('free games')
    || /\b(?:completely|entirely|totally|truly|fully|100%) free\b/i.test(text)
    || /\b(?:free to use|free for everyone|at no cost|zero[- ]cost|no paywall)\b/i.test(text)
    || /\bfree(?:,|\s)+(?:desktop |mobile |web |ai |online )?(?:app|tool|software|service|platform|game|extension|library|template|resource|utility)\b/i.test(text)
    || /^free\b(?!\s+(?:trial|plan|tier|credits?|version))/i.test(tagline);
  if (explicitlyFree && !commercialTextEvidence && !paidTierName) {
    return { label: REVENUE_STATUS.free, method: 'free-without-paid-evidence' };
  }

  const systemRelease = /^(?:android|ios|ipados|macos|windows|ubuntu|debian|fedora|chrome(?:os)?|firefox)\s+(?:v(?:ersion)?\s*)?\d+(?:\.\d+)*/i.test(name);
  const namedDeveloperRelease = /(?:^|[^a-z0-9])(?:api|sdk|cli)(?:[^a-z0-9]|$)/i.test(name);
  const versionedRelease = /(?:^|\s)(?:v\s*)?\d+(?:\.\d+)+(?:\s|$)/i.test(name);
  const bundledOffering = /\bincluded with\b.{0,60}\b(?:membership|subscription|plan)\b|\bno (?:ads|in-app purchases)\b/i.test(text);
  const nonStandaloneType = productTypes.has('ai model') || productTypes.has('hardware');
  const domainAttributionRisk = Boolean(websiteUrl || metricDomain) && !hasDedicatedProductDomain(name, websiteUrl, metricDomain);
  const governmentDomain = /\.(?:gov|mil)(?:\.[a-z]{2})?$/i.test(String(metricDomain || ''));

  let nonProductSurface = false;
  try {
    const url = new URL(String(websiteUrl || ''));
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.toLowerCase();
    nonProductSurface = /^(?:blog|community|developer|developers|docs|help|news|status|support)\./.test(hostname)
      || /\/(?:blog|changelog|docs?|documentation|news|releases?|updates?)(?:\/|$)/.test(path);
  } catch {
    nonProductSurface = false;
  }

  if (verifiedPricingEvidence) return null;

  if (systemRelease || namedDeveloperRelease || versionedRelease || bundledOffering || nonStandaloneType || nonProductSurface || domainAttributionRisk || governmentDomain) {
    return { label: REVENUE_STATUS.unavailable, method: 'no-product-level-paid-evidence' };
  }

  return null;
}

function appIdentityTokens(value) {
  const ignored = new Set([
    'ai', 'android', 'app', 'apps', 'assistant', 'by', 'for', 'ios', 'mac', 'macos', 'mail', 'mobile', 'notetaker', 'official', 'store', 'the', 'version', 'with',
  ]);
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !ignored.has(token) && !/^v?\d+(?:\.\d+)*$/.test(token));
}

function apparkIdentityMatches(product, record) {
  if (!record || !String(record.queryStatus || '').startsWith('success')) return false;
  if (record.storeIdentitySource === 'appark_verified_cluster') return false;
  const productTokens = appIdentityTokens(product.name);
  const resolvedTokens = new Set(appIdentityTokens(record.resolvedAppName));
  if (productTokens.length === 0 || resolvedTokens.size === 0) return false;
  return productTokens.every((token) => resolvedTokens.has(token));
}

function validatedApparkMetrics(product, summary, platformRecords) {
  if (!summary || !Array.isArray(platformRecords) || platformRecords.length === 0) return null;
  const latestByPlatform = new Map();
  for (const record of platformRecords.toSorted((left, right) => String(left.fetchedAt || '').localeCompare(String(right.fetchedAt || '')))) {
    if (record.platform) latestByPlatform.set(record.platform, record);
  }
  const validRecords = [...latestByPlatform.values()].filter((record) => apparkIdentityMatches(product, record));
  if (validRecords.length === 0) return null;

  const uniqueClusters = new Map();
  for (const record of validRecords) {
    const clusterKey = record.clusterId || `${record.platform}:${record.resolvedStoreId || record.requestedStoreId || ''}`;
    const previous = uniqueClusters.get(clusterKey);
    if (!previous || (finiteNumber(record.revenue30d) || 0) > (finiteNumber(previous.revenue30d) || 0)) {
      uniqueClusters.set(clusterKey, record);
    }
  }
  const totalDownloads = [...uniqueClusters.values()].reduce((total, record) => total + (finiteNumber(record.downloads30d) || 0), 0);
  const totalRevenue = [...uniqueClusters.values()].reduce((total, record) => total + (finiteNumber(record.revenue30d) || 0), 0);
  const ios = validRecords.find((record) => record.platform === 'ios') || null;
  const android = validRecords.find((record) => record.platform === 'android') || null;

  return {
    ...summary,
    ios_downloads_30d: finiteNumber(ios?.downloads30d),
    ios_revenue_30d: finiteNumber(ios?.revenue30d),
    android_downloads_30d: finiteNumber(android?.downloads30d),
    android_revenue_30d: finiteNumber(android?.revenue30d),
    total_downloads_30d: totalDownloads,
    total_revenue_30d: totalRevenue,
    total_coverage_status: validRecords.length > 1 ? 'validated_multi_platform' : `validated_${validRecords[0].platform}_only`,
  };
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

function estimateRevenue({ appark, paymentMonths, registrations, model, countryFactor, launchedAt, latestMonth, eligibilityStatus, paymentEvidenceAllowed, verifiedPricingEvidence }) {
  const appRevenue = finiteNumber(appark?.total_revenue_30d);
  if (appRevenue !== null && appRevenue > 0) {
    return {
      base: money(appRevenue),
      low: null,
      high: null,
      source: 'Appark estimate',
      method: 'appark-30d',
    };
  }

  const usablePaymentMonths = [...(paymentMonths || [])]
    .filter((item) => item.value !== null)
    .toSorted((left, right) => left.month.localeCompare(right.month));
  const positivePaymentMonths = usablePaymentMonths.filter((item) => (
    item.value > 0 && item.productCount === 1 && paymentEvidenceAllowed
  ));
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
  } else if (eligibilityStatus) {
    return {
      base: null,
      low: null,
      high: null,
      source: eligibilityStatus.label,
      method: eligibilityStatus.method,
    };
  } else if (registrations !== null && latestMonth) {
    const acquisitionMonths = Math.min(12, monthsBetween(launchedAt, latestMonth));
    const cohortMultiplier = Array.from({ length: acquisitionMonths }, (_, index) => Math.pow(model.monthlyRetention, index))
      .reduce((total, value) => total + value, 0);
    const newPayers = registrations * model.trialToPaidRate * clamp(countryFactor, 0.55, 1.02);
    base = newPayers * cohortMultiplier * model.monthlyRevenuePerPayer * countryFactor;
    source = verifiedPricingEvidence
      ? 'Minaco estimate · Similarweb + verified pricing'
      : 'Minaco estimate · Similarweb fallback';
    method = verifiedPricingEvidence ? 'verified-pricing-traffic-cohort' : 'traffic-registration-cohort';
  } else {
    return {
      base: null,
      low: null,
      high: null,
      source: REVENUE_STATUS.unavailable,
      method: 'no-audience-data-for-revenue-estimate',
    };
  }

  if (!Number.isFinite(base) || base <= 0) {
    return {
      base: null,
      low: null,
      high: null,
      source: eligibilityStatus?.label || REVENUE_STATUS.unavailable,
      method: eligibilityStatus?.method || 'no-positive-revenue-evidence',
    };
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

const apparkPlatformsByProduct = new Map();
await readJsonLines(join(dataDirectory, 'appark-local-platform.raw.jsonl'), (record) => {
  const key = normalizeProductKey(record.productKey);
  if (!key) return;
  const existing = apparkPlatformsByProduct.get(key) || [];
  existing.push(record);
  apparkPlatformsByProduct.set(key, existing);
});

const pricingSignalsByProduct = new Map();
await readJsonLines(join(dataDirectory, 'pricing-signals.jsonl'), (record) => {
  const key = normalizeProductKey(record.productKey);
  if (key) pricingSignalsByProduct.set(key, record);
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
        if (!previous || fetchedAt >= previous.fetchedAt) {
          monthMap.set(month, {
            month,
            value,
            fetchedAt,
            productCount: new Set(record.productKeys || []).size,
          });
        }
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
  const websiteUrl = identity.website_url || latestLaunch.website_url || null;
  const similarwebCandidate = similarwebByProduct.get(key) || null;
  const similarweb = isSharedPlatformDomain(domain) || (similarwebCandidate?.productCount || 0) > 1
    ? null
    : similarwebCandidate;
  const appark = validatedApparkMetrics(product, apparkByProduct.get(key) || null, apparkPlatformsByProduct.get(key) || []);
  const pricingSignal = pricingSignalsByProduct.get(key) || null;
  const verifiedPricingEvidence = (product.productTypes || []).includes('SaaS / Web Service') && hasVerifiedPricingSignal(pricingSignal);
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
  const eligibilityStatus = revenueEligibilityStatus(product, description, websiteUrl, domain, pricingSignal);
  const paymentEvidenceAllowed = !isSharedPlatformDomain(domain)
    && (verifiedPricingEvidence || hasDedicatedProductDomain(product.name, websiteUrl, domain));
  const revenue = estimateRevenue({
    appark,
    paymentMonths,
    registrations: latestTraffic?.registrations.base ?? null,
    model,
    countryFactor,
    launchedAt: product.lastLaunchDate,
    latestMonth,
    eligibilityStatus,
    paymentEvidenceAllowed,
    verifiedPricingEvidence,
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
    caveat: 'Website registrations and revenue are Minaco model estimates. SaaS fallback revenue requires verified pricing evidence or product-level attribution. App downloads and revenue are Appark estimates.',
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
      productsWithVerifiedPricing: [...pricingSignalsByProduct.values()].filter(hasVerifiedPricingSignal).length,
      revenueStatuses: {
        openSource: products.filter((product) => product.monthly_new_revenue_usd === null && product.revenue_estimate_source === REVENUE_STATUS.openSource).length,
        free: products.filter((product) => product.monthly_new_revenue_usd === null && product.revenue_estimate_source === REVENUE_STATUS.free).length,
        unavailable: products.filter((product) => product.monthly_new_revenue_usd === null && product.revenue_estimate_source === REVENUE_STATUS.unavailable).length,
      },
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
