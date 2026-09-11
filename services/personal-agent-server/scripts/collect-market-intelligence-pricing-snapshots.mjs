import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [payloadFileArgument, outputFileArgument] = process.argv.slice(2);
if (!payloadFileArgument || !outputFileArgument) {
  throw new Error('Usage: node scripts/collect-market-intelligence-pricing-snapshots.mjs <market-intelligence-import.json> <pricing-snapshots.raw.jsonl>');
}

const payloadFile = resolve(payloadFileArgument);
const outputFile = resolve(outputFileArgument);
const progressFile = outputFile.replace(/\.jsonl$/i, '.progress.json');
const payload = JSON.parse(await readFile(payloadFile, 'utf8'));
const snapshotMonth = String(process.env.PRICING_SNAPSHOT_MONTH || new Date().toISOString().slice(0, 7));
const concurrency = Math.max(1, Math.min(30, Number(process.env.PRICING_SCAN_CONCURRENCY || 12)));
const timeoutMs = Math.max(2_000, Math.min(30_000, Number(process.env.PRICING_SCAN_TIMEOUT_MS || 10_000)));
const maxPages = Math.max(1, Math.min(15, Number(process.env.PRICING_SCAN_MAX_PAGES || 8)));
const resume = process.env.PRICING_SCAN_RESUME !== 'false';
const retryStatuses = new Set(String(process.env.PRICING_SCAN_RETRY_STATUSES || '').split(',').map((value) => value.trim()).filter(Boolean));
const productFilter = String(process.env.PRICING_SCAN_PRODUCT_FILTER || '').trim().toLowerCase();
const paymentHosts = [
  'buy.stripe.com',
  'checkout.stripe.com',
  'gumroad.com',
  'lemonsqueezy.com',
  'paddle.com',
  'paypal.com',
];

function sanitizeUnicode(value) {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else {
        output += '\ufffd';
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += '\ufffd';
    } else {
      output += value[index];
    }
  }
  return output;
}

function serializeRecord(record) {
  return JSON.stringify(record, (_key, value) => typeof value === 'string' ? sanitizeUnicode(value) : value);
}

function safeUrl(value, base) {
  try {
    const url = new URL(String(value || ''), base);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function visibleText(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 750_000);
}

function extractLinks(html, pageUrl) {
  const links = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  for (const match of String(html || '').matchAll(pattern)) {
    const url = safeUrl(match[1] || match[2] || match[3], pageUrl);
    if (url) links.push(url);
  }
  return links;
}

function currencyCode(token) {
  const value = String(token || '').toUpperCase().replace(/\s/g, '');
  if (value === '€' || value === 'EUR') return 'EUR';
  if (value === '£' || value === 'GBP') return 'GBP';
  if (value === '₹' || value === 'INR') return 'INR';
  if (value === '¥' || value === 'JPY' || value === 'CNY' || value === 'RMB') return value === 'JPY' ? 'JPY' : 'CNY_OR_JPY';
  if (value === 'CAD' || value === 'CA$' || value === 'C$') return 'CAD';
  if (value === 'AUD' || value === 'A$') return 'AUD';
  return 'USD';
}

function billingInterval(context) {
  if (/\b(?:one[- ]time|lifetime|pay once|single payment|once only)\b/i.test(context)) return 'one_time';
  if (/\b(?:per\s+seat|\/\s*seat|seat\s*\/|user\s*\/|per\s+user)\b/i.test(context)) {
    if (/\b(?:year|yr|annual|annually)\b/i.test(context)) return 'per_seat_year';
    return 'per_seat_month';
  }
  if (/\b(?:year|yr|annual|annually)\b|\/\s*(?:yr|year)\b/i.test(context)) return 'year';
  if (/\b(?:month|mo|monthly)\b|\/\s*(?:mo|month)\b/i.test(context)) return 'month';
  if (/\b(?:usage|token|credit|request|api call|minute|gb|million characters)\b/i.test(context)) return 'usage_based';
  return 'unspecified';
}

function planName(context) {
  const names = [...String(context).matchAll(/\b(free|personal|hobby|starter|basic|plus|premium|pro|professional|growth|creator|team|business|enterprise)\b/gi)];
  return names.at(-1)?.[1] || null;
}

function normalizedMonthlyAmount(amount, interval) {
  if (!Number.isFinite(amount)) return null;
  if (interval === 'year' || interval === 'per_seat_year') return Number((amount / 12).toFixed(4));
  if (interval === 'month' || interval === 'per_seat_month') return amount;
  return null;
}

function numericAmount(value) {
  const raw = String(value || '');
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) return Number(raw.replace(/,/g, ''));
  if (/^\d+,\d{1,2}$/.test(raw)) return Number(raw.replace(',', '.'));
  return Number(raw.replace(/,/g, ''));
}

function priceRole(context, interval) {
  if (/\b(?:compare|comparison|competitor|alternative|elsewhere|published rates?|versus|\bvs\.?)\b/i.test(context)) return 'comparison';
  if (/\b(?:credit|token|balance|included usage|spending cap)\b/i.test(context)) return 'credit_or_allowance';
  if (/\b(?:free trial|trial credit|trial balance)\b/i.test(context) && ['usage_based', 'unspecified'].includes(interval)) return 'trial';
  if (interval === 'usage_based') return 'usage_rate';
  if (interval !== 'unspecified') return 'list_price';
  return 'price_mention';
}

function extractPricePoints(text, pageUrl) {
  const points = [];
  const patterns = [
    /(?<currency>US\$|CA\$|C\$|A\$|USD|EUR|GBP|CAD|AUD|INR|JPY|CNY|RMB|[$€£₹¥])\s*(?<amount>(?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d{1,2})?|\d{1,6},\d{1,2})/gi,
    /(?<amount>(?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:\.\d{1,2})?|\d{1,6},\d{1,2})\s*(?<currency>USD|EUR|GBP|CAD|AUD|INR|JPY|CNY|RMB)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = numericAmount(match.groups?.amount);
      if (!Number.isFinite(amount)) continue;
      const start = Math.max(0, match.index - 100);
      const end = Math.min(text.length, match.index + match[0].length + 130);
      const context = text.slice(start, end).trim();
      const localContext = text.slice(Math.max(0, match.index - 38), Math.min(text.length, match.index + match[0].length + 65));
      const beforePrice = text.slice(start, match.index).replace(/\bfree trial\b/gi, ' ').trim();
      const interval = billingInterval(context);
      points.push({
        planName: planName(beforePrice),
        amount,
        currency: currencyCode(match.groups?.currency),
        billingInterval: interval,
        normalizedMonthlyAmount: normalizedMonthlyAmount(amount, interval),
        role: priceRole(localContext, interval),
        rawPrice: match[0],
        context,
        evidenceUrl: pageUrl,
      });
    }
  }
  return [...new Map(points.map((point) => [
    [point.planName, point.amount, point.currency, point.billingInterval, point.evidenceUrl].join('|'),
    point,
  ])).values()].slice(0, 40);
}

function pricingEvidence(pageUrl, html) {
  const text = visibleText(html);
  const lowerText = text.toLowerCase();
  const title = String(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  const url = safeUrl(pageUrl);
  const pricingPath = /\b(?:billing|plans?|pricing|subscribe|subscription|upgrade)\b/i.test(`${url?.pathname || ''} ${title}`);
  const pricePoints = extractPricePoints(text, pageUrl);
  const currencyPrice = pricePoints.length > 0;
  const recurringPrice = pricePoints.some((point) => ['month', 'year', 'per_seat_month', 'per_seat_year'].includes(point.billingInterval))
    || /(?:\/\s*(?:mo|month|yr|year)\b|per\s+(?:month|year)\b|billed\s+(?:monthly|annually)|monthly billing|annual billing)/i.test(lowerText);
  const planLanguage = /\b(?:free|personal|hobby|starter|basic|plus|premium|pro|professional|growth|creator|team|business|enterprise)\s+(?:plan|tier)\b|\bchoose (?:a|your) plan\b/i.test(lowerText);
  const contactSales = /\b(?:contact sales|talk to sales|request (?:a )?(?:demo|quote)|custom pricing|get a quote)\b/i.test(lowerText);
  const usageBased = /\b(?:usage[- ]based|pay as you go|per token|per credit|per request|per api call)\b/i.test(lowerText);
  const oneTime = /\b(?:one[- ]time (?:payment|purchase)|lifetime (?:access|deal|license)|pay once)\b/i.test(lowerText)
    || pricePoints.some((point) => point.billingInterval === 'one_time');
  const freeTier = /\b(?:free forever|free plan|free tier|start for free|\$0\b|€0\b|£0\b)\b/i.test(lowerText)
    || pricePoints.some((point) => point.amount === 0);
  const checkoutLink = extractLinks(html, pageUrl).find((link) => paymentHosts.some((host) => link.hostname === host || link.hostname.endsWith(`.${host}`))) || null;
  const score = Number(pricingPath) * 2 + Number(currencyPrice) * 2 + Number(recurringPrice) * 2 + Number(planLanguage) * 2
    + Number(checkoutLink) * 4 + Number(contactSales) * 2 + Number(usageBased) * 2 + Number(oneTime) * 2;
  return {
    verified: Boolean(checkoutLink)
      || (pricingPath && score >= 4)
      || (currencyPrice && (recurringPrice || oneTime || usageBased) && (planLanguage || pricingPath))
      || (pricingPath && contactSales),
    score,
    signals: [
      pricingPath ? 'pricing_page' : null,
      currencyPrice ? 'currency_price' : null,
      recurringPrice ? 'recurring_price' : null,
      planLanguage ? 'plan_language' : null,
      checkoutLink ? 'payment_link' : null,
      contactSales ? 'contact_sales' : null,
      usageBased ? 'usage_based' : null,
      oneTime ? 'one_time' : null,
      freeTier ? 'free_tier' : null,
    ].filter(Boolean),
    checkoutUrl: checkoutLink?.toString() || null,
    pricePoints,
    flags: { freeTier, contactSales, usageBased, oneTime, recurringPrice },
  };
}

function pricingStrategy(evidence, status) {
  if (status === 'no_website') return 'no_website';
  if (status === 'unreachable') return 'unreachable';
  if (!evidence?.verified) return 'no_pricing_evidence';
  const hasPaidPrice = evidence.pricePoints.some((point) => point.amount > 0);
  if (evidence.flags.freeTier && hasPaidPrice && evidence.flags.recurringPrice) return 'freemium_subscription';
  if (evidence.flags.usageBased && evidence.flags.recurringPrice) return 'subscription_plus_usage';
  if (evidence.flags.usageBased) return 'usage_based';
  if (evidence.flags.oneTime && evidence.flags.recurringPrice) return 'subscription_plus_one_time';
  if (evidence.flags.oneTime) return 'one_time';
  if (evidence.flags.recurringPrice) return 'subscription';
  if (evidence.flags.contactSales && !hasPaidPrice) return 'contact_sales';
  if (evidence.flags.freeTier && !hasPaidPrice) return 'free_only';
  if (hasPaidPrice || evidence.checkoutUrl) return 'paid_unspecified';
  return 'commercial_terms_detected';
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'MinacoProductIntelligencePricingAudit/2.0 (+https://minaco.ai)',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      return { ok: false, status: response.status, url: response.url || url, html: '' };
    }
    return { ok: true, status: response.status, url: response.url || url, html: (await response.text()).slice(0, 2_000_000) };
  } finally {
    clearTimeout(timeout);
  }
}

function productRecord(product, values = {}) {
  return {
    schemaVersion: 2,
    snapshotMonth,
    productKey: product.external_id,
    productName: product.name,
    productTypes: product.product_types || [],
    revenueStatusBeforeScan: product.revenue_estimate_source || null,
    websiteUrl: product.website_url || null,
    checkedAt: new Date().toISOString(),
    ...values,
  };
}

async function inspectProduct(product) {
  const websiteUrl = safeUrl(product.website_url);
  if (!websiteUrl) {
    return productRecord(product, {
      verified: false,
      evidenceStatus: 'not_scannable',
      evidenceUrl: null,
      checkoutUrl: null,
      signals: [],
      pricingStrategy: 'no_website',
      pricePoints: [],
      status: 'no_website',
      attempts: [],
    });
  }

  const origin = websiteUrl.origin;
  const initialUrls = [websiteUrl, ...['/pricing', '/plans', '/billing', '/subscriptions'].map((path) => new URL(path, origin))];
  const queued = new Map(initialUrls.map((url) => [url.toString(), url]));
  const attempts = [];
  const pageEvidence = [];

  for (let index = 0; index < Math.min(queued.size, maxPages); index += 1) {
    const candidate = [...queued.values()][index];
    try {
      const page = await fetchPage(candidate);
      const attempt = { url: candidate.toString(), finalUrl: page.url, status: page.status, ok: page.ok };
      attempts.push(attempt);
      if (!page.ok) continue;
      const evidence = pricingEvidence(page.url, page.html);
      pageEvidence.push({ pageUrl: page.url, ...evidence });
      attempt.signals = evidence.signals;
      attempt.score = evidence.score;
      attempt.pricePointCount = evidence.pricePoints.length;
      if (index === 0) {
        for (const link of extractLinks(page.html, page.url)) {
          if (link.origin !== new URL(page.url).origin) continue;
          if (!/\b(?:billing|plans?|pricing|subscribe|subscription|upgrade)\b/i.test(`${link.pathname} ${link.search}`)) continue;
          queued.set(link.toString(), link);
          if (queued.size >= maxPages) break;
        }
      }
    } catch (error) {
      attempts.push({
        url: candidate.toString(),
        finalUrl: null,
        status: null,
        ok: false,
        error: error instanceof Error ? `${error.name}: ${error.message}` : 'fetch_error',
      });
    }
  }

  const bestEvidence = pageEvidence.toSorted((left, right) => right.score - left.score)[0] || null;
  const verified = pageEvidence.some((evidence) => evidence.verified);
  const verifiedEvidence = pageEvidence.filter((evidence) => evidence.verified).toSorted((left, right) => right.score - left.score)[0] || bestEvidence;
  const pricePoints = [...new Map(pageEvidence.flatMap((evidence) => evidence.pricePoints).map((point) => [
    [point.planName, point.amount, point.currency, point.billingInterval].join('|'),
    point,
  ])).values()].slice(0, 80);
  const primaryPricePoints = pricePoints.filter((point) => ['list_price', 'usage_rate'].includes(point.role));
  const combinedEvidence = verifiedEvidence ? {
    ...verifiedEvidence,
    pricePoints,
    primaryPricePoints,
    flags: pageEvidence.reduce((flags, evidence) => ({
      freeTier: flags.freeTier || evidence.flags.freeTier,
      contactSales: flags.contactSales || evidence.flags.contactSales,
      usageBased: flags.usageBased || evidence.flags.usageBased,
      oneTime: flags.oneTime || evidence.flags.oneTime,
      recurringPrice: flags.recurringPrice || evidence.flags.recurringPrice,
    }), { freeTier: false, contactSales: false, usageBased: false, oneTime: false, recurringPrice: false }),
  } : null;
  const status = verified ? 'verified' : attempts.some((attempt) => attempt.ok) ? 'no_pricing_evidence' : 'unreachable';

  return productRecord(product, {
    verified,
    evidenceStatus: verified ? 'verified' : status === 'unreachable' ? 'scan_failed' : 'verified_absent',
    evidenceUrl: verifiedEvidence?.pageUrl || null,
    checkoutUrl: verifiedEvidence?.checkoutUrl || null,
    signals: [...new Set(pageEvidence.flatMap((evidence) => evidence.signals))],
    pricingStrategy: pricingStrategy(combinedEvidence, status),
    pricePoints,
    primaryPricePoints,
    flags: combinedEvidence?.flags || { freeTier: false, contactSales: false, usageBased: false, oneTime: false, recurringPrice: false },
    status,
    pagesInspected: attempts.length,
    attempts,
  });
}

async function existingKeys() {
  if (!resume) return new Set();
  try {
    const contents = await readFile(outputFile, 'utf8');
    const keys = new Set();
    for (const line of contents.split('\n')) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record.snapshotMonth !== snapshotMonth) continue;
      if (retryStatuses.has(record.status)) continue;
      keys.add(record.productKey);
    }
    return keys;
  } catch (error) {
    if (error?.code === 'ENOENT') return new Set();
    throw error;
  }
}

await mkdir(dirname(outputFile), { recursive: true });
if (!resume) await writeFile(outputFile, '', 'utf8');
const completedKeys = await existingKeys();
const products = (payload.products || [])
  .filter((product) => !productFilter || [product.external_id, product.name, product.website_url].some((value) => String(value || '').toLowerCase().includes(productFilter)))
  .filter((product) => !completedKeys.has(product.external_id))
  .toSorted((left, right) => {
    const leftPriority = left.revenue_estimate_source === 'Not available' ? 0 : 1;
    const rightPriority = right.revenue_estimate_source === 'Not available' ? 0 : 1;
    return leftPriority - rightPriority || String(left.launched_at || '').localeCompare(String(right.launched_at || ''));
  });

let nextIndex = 0;
let completed = completedKeys.size;
const total = completedKeys.size + products.length;
const counters = {};

async function writeProgress(lastRecord = null) {
  const progress = {
    snapshotMonth,
    total,
    completed,
    remaining: total - completed,
    percent: total === 0 ? 100 : Number(((completed / total) * 100).toFixed(2)),
    concurrency,
    counters,
    lastProduct: lastRecord ? { productKey: lastRecord.productKey, productName: lastRecord.productName, status: lastRecord.status } : null,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(progressFile, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
}

async function runWorker() {
  while (nextIndex < products.length) {
    const index = nextIndex;
    nextIndex += 1;
    const record = await inspectProduct(products[index]);
    await appendFile(outputFile, `${serializeRecord(record)}\n`, 'utf8');
    completed += 1;
    counters[record.status] = (counters[record.status] || 0) + 1;
    if (completed % 25 === 0 || completed === total) {
      await writeProgress(record);
      process.stderr.write(`Checked ${completed}/${total} (${((completed / total) * 100).toFixed(1)}%) ${record.productName}: ${record.status}\n`);
    }
  }
}

await writeProgress();
await Promise.all(Array.from({ length: concurrency }, runWorker));
await writeProgress();
console.log(JSON.stringify({ input: payloadFile, output: outputFile, progressFile, snapshotMonth, total, completed, counters }, null, 2));
