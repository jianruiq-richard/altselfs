import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [payloadFileArgument, outputFileArgument] = process.argv.slice(2);
if (!payloadFileArgument || !outputFileArgument) {
  throw new Error('Usage: node scripts/collect-market-intelligence-pricing-signals.mjs <provisional-import.json> <pricing-signals.jsonl>');
}

const payloadFile = resolve(payloadFileArgument);
const outputFile = resolve(outputFileArgument);
const payload = JSON.parse(await readFile(payloadFile, 'utf8'));
const concurrency = Math.max(1, Math.min(30, Number(process.env.PRICING_SCAN_CONCURRENCY || 16)));
const timeoutMs = Math.max(2_000, Math.min(20_000, Number(process.env.PRICING_SCAN_TIMEOUT_MS || 8_000)));
const paymentHosts = [
  'buy.stripe.com',
  'checkout.stripe.com',
  'gumroad.com',
  'lemonsqueezy.com',
  'paddle.com',
  'paypal.com',
];

function isSaas(product) {
  return (product.product_types || []).includes('SaaS / Web Service');
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
    .slice(0, 500_000);
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

function pricingEvidence(pageUrl, html) {
  const text = visibleText(html).toLowerCase();
  const title = String(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').toLowerCase();
  const url = safeUrl(pageUrl);
  const pricingPath = /\b(?:billing|plans?|pricing|subscribe|upgrade)\b/i.test(`${url?.pathname || ''} ${title}`);
  const currencyPrice = /(?:[$€£]\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?(?:usd|eur|gbp))\b/i.test(text);
  const recurringPrice = /(?:\/\s*(?:mo|month|yr|year)\b|per\s+(?:month|year)\b|billed\s+(?:monthly|annually)|monthly billing|annual billing)/i.test(text);
  const planLanguage = /\b(?:free|starter|basic|pro|professional|team|business|enterprise)\s+(?:plan|tier)\b|\bchoose (?:a|your) plan\b/i.test(text);
  const checkoutLink = extractLinks(html, pageUrl).find((link) => paymentHosts.some((host) => link.hostname === host || link.hostname.endsWith(`.${host}`))) || null;
  const score = Number(pricingPath) * 2 + Number(currencyPrice) * 2 + Number(recurringPrice) * 2 + Number(planLanguage) * 2 + Number(checkoutLink) * 4;
  return {
    verified: Boolean(checkoutLink) || (pricingPath && score >= 4) || (currencyPrice && recurringPrice && planLanguage),
    score,
    signals: [
      pricingPath ? 'pricing_page' : null,
      currencyPrice ? 'currency_price' : null,
      recurringPrice ? 'recurring_price' : null,
      planLanguage ? 'plan_language' : null,
      checkoutLink ? 'payment_link' : null,
    ].filter(Boolean),
    checkoutUrl: checkoutLink?.toString() || null,
  };
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'MinacoProductIntelligencePricingAudit/1.0 (+https://minaco.ai)',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('text/html')) {
      return { ok: false, status: response.status, url: response.url || url, html: '' };
    }
    return { ok: true, status: response.status, url: response.url || url, html: (await response.text()).slice(0, 1_500_000) };
  } finally {
    clearTimeout(timeout);
  }
}

async function inspectProduct(product) {
  const startedAt = new Date().toISOString();
  const websiteUrl = safeUrl(product.website_url);
  if (!websiteUrl) {
    return {
      productKey: product.external_id,
      productName: product.name,
      websiteUrl: product.website_url || null,
      verified: false,
      evidenceUrl: null,
      checkoutUrl: null,
      signals: [],
      status: 'no_website',
      checkedAt: startedAt,
    };
  }

  const origin = websiteUrl.origin;
  const initialUrls = [websiteUrl, ...['/pricing', '/plans', '/billing'].map((path) => new URL(path, origin))];
  const queued = new Map(initialUrls.map((url) => [url.toString(), url]));
  const attempts = [];

  try {
    const homepage = await fetchPage(websiteUrl);
    attempts.push({ url: homepage.url, status: homepage.status, ok: homepage.ok });
    if (homepage.ok) {
      const homepageEvidence = pricingEvidence(homepage.url, homepage.html);
      if (homepageEvidence.verified) {
        return {
          productKey: product.external_id,
          productName: product.name,
          websiteUrl: websiteUrl.toString(),
          verified: true,
          evidenceUrl: homepage.url,
          checkoutUrl: homepageEvidence.checkoutUrl,
          signals: homepageEvidence.signals,
          status: 'verified',
          checkedAt: startedAt,
          attempts,
        };
      }
      for (const link of extractLinks(homepage.html, homepage.url)) {
        if (link.origin !== new URL(homepage.url).origin) continue;
        if (!/\b(?:billing|plans?|pricing|subscribe|upgrade)\b/i.test(`${link.pathname} ${link.search}`)) continue;
        queued.set(link.toString(), link);
        if (queued.size >= 8) break;
      }
    }
  } catch (error) {
    attempts.push({ url: websiteUrl.toString(), status: null, ok: false, error: error instanceof Error ? error.name : 'fetch_error' });
  }

  for (const candidate of [...queued.values()].slice(1, 8)) {
    try {
      const page = await fetchPage(candidate);
      attempts.push({ url: page.url, status: page.status, ok: page.ok });
      if (!page.ok) continue;
      const evidence = pricingEvidence(page.url, page.html);
      if (!evidence.verified) continue;
      return {
        productKey: product.external_id,
        productName: product.name,
        websiteUrl: websiteUrl.toString(),
        verified: true,
        evidenceUrl: page.url,
        checkoutUrl: evidence.checkoutUrl,
        signals: evidence.signals,
        status: 'verified',
        checkedAt: startedAt,
        attempts,
      };
    } catch (error) {
      attempts.push({ url: candidate.toString(), status: null, ok: false, error: error instanceof Error ? error.name : 'fetch_error' });
    }
  }

  return {
    productKey: product.external_id,
    productName: product.name,
    websiteUrl: websiteUrl.toString(),
    verified: false,
    evidenceUrl: null,
    checkoutUrl: null,
    signals: [],
    status: attempts.some((attempt) => attempt.ok) ? 'no_pricing_evidence' : 'unreachable',
    checkedAt: startedAt,
    attempts,
  };
}

async function mapConcurrent(items, workerCount, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  let completed = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
      completed += 1;
      if (completed % 50 === 0 || completed === items.length) {
        process.stderr.write(`Checked ${completed}/${items.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

const products = (payload.products || []).filter(isSaas);
const results = await mapConcurrent(products, concurrency, inspectProduct);
await writeFile(outputFile, `${results.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');

const verified = results.filter((record) => record.verified);
console.log(JSON.stringify({
  input: payloadFile,
  output: outputFile,
  outputDirectory: dirname(outputFile),
  products: results.length,
  verified: verified.length,
  unreachable: results.filter((record) => record.status === 'unreachable').length,
  noPricingEvidence: results.filter((record) => record.status === 'no_pricing_evidence').length,
}, null, 2));
