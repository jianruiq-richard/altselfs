import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [dataDirectoryArgument, htmlOutputArgument, jsonOutputArgument] = process.argv.slice(2);
if (!dataDirectoryArgument || !htmlOutputArgument || !jsonOutputArgument) {
  throw new Error('Usage: node build-payment-star-rejection-audit.mjs <data-directory> <output.html> <output.json>');
}

const dataDirectory = resolve(dataDirectoryArgument);
const htmlOutput = resolve(htmlOutputArgument);
const jsonOutput = resolve(jsonOutputArgument);
const payloadFile = join(dataDirectory, 'market-intelligence-import-2026-09-11.json');
const payload = JSON.parse(readFileSync(payloadFile, 'utf8'));
const manifest = JSON.parse(readFileSync(join(dataDirectory, 'manifest.json'), 'utf8'));

const SHARED_PLATFORM_DOMAINS = new Set([
  'amazon.com', 'apple.com', 'carrd.co', 'discord.com', 'figma.com', 'github.com', 'github.io', 'google.com',
  'gumroad.com', 'huggingface.co', 'instagram.com', 'itch.io', 'linkedin.com', 'medium.com', 'microsoft.com',
  'netlify.app', 'notion.so', 'pages.dev', 'producthunt.com', 'reddit.com', 'replit.com', 'slack.com',
  'shopify.com', 'sourceforge.net', 'spotify.com', 'substack.com', 't.me', 'twitter.com', 'vercel.app',
  'x.com', 'youtube.com',
]);

const REASONS = {
  appark_precedence: {
    label: 'Appark 营收优先',
    short: '已有通过身份校验的 Appark 30 天营收，按照现有规则显示 **，不再同时采用 Semrush 支付流量估算。',
  },
  domain_mapped_to_multiple_products: {
    label: '同一域名对应多个产品',
    short: '这次域名查询同时关联多个 Product Hunt 产品，无法可靠地把整站支付流量分配给其中一个产品。',
  },
  shared_platform_domain: {
    label: '共享平台域名',
    short: '官网属于托管、社交、应用商店或大型共享平台，整站支付流量不能归属于这个具体产品。',
  },
  name_domain_not_attributable_and_no_verified_pricing: {
    label: '产品与域名归属证据不足',
    short: '产品名与域名未通过严格品牌匹配，并且没有经过验证的定价/结账证据，因此不把域名级支付流量用于产品营收。',
  },
};

function normalizeKey(value) {
  return String(value || '').trim().replace(/[?#].*$/, '').replace(/\/$/, '');
}

function productId(key) {
  return `ph_${createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
}

function readJsonLines(fileName) {
  const filePath = join(dataDirectory, fileName);
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

function addIndex(index, key, value) {
  const normalized = normalizeKey(key);
  if (!normalized) return;
  const current = index.get(normalized) || [];
  current.push(value);
  index.set(normalized, current);
}

function indexRecords(records, keyGetter) {
  const index = new Map();
  for (const record of records) {
    for (const key of keyGetter(record)) addIndex(index, key, record);
  }
  return index;
}

function latestRecord(records) {
  return [...(records || [])].toSorted((left, right) => String(left.fetchedAt || left.checkedAt || '').localeCompare(String(right.fetchedAt || right.checkedAt || ''))).at(-1) || null;
}

function normalizedBrand(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSharedPlatformDomain(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/^www\./, '');
  return [...SHARED_PLATFORM_DOMAINS].some((rootDomain) => domain === rootDomain || domain.endsWith(`.${rootDomain}`));
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

function collectUrls(value, output = new Set()) {
  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s"'<>\\]+/g) || [];
    for (const match of matches) {
      try {
        const url = new URL(match.replace(/[),.;\]]+$/, ''));
        if (url.protocol === 'http:' || url.protocol === 'https:') output.add(url.toString());
      } catch {}
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectUrls(item, output);
  }
  return output;
}

const sourceDefinitions = [
  ['productIdentities', 'product-identities.jsonl', (record) => [record.product_hunt_url]],
  ['productLaunches', 'product-launches-with-identities.jsonl', (record) => [record.url]],
  ['productHuntOfficialLinks', 'producthunt-official-links.raw.jsonl', (record) => [record.productKey, record.productHuntUrl]],
  ['identityResolution', 'identity-resolution.raw.jsonl', (record) => [record.productKey, record.productHuntUrl]],
  ['semrushHistorical', 'semrush.raw.jsonl', (record) => record.productKeys || []],
  ['semrushJuly', 'semrush-2026-07.raw.jsonl', (record) => record.productKeys || []],
  ['similarweb', 'similarweb.raw.jsonl', (record) => record.productKeys || []],
  ['apparkLegacy', 'appark.raw.jsonl', (record) => [record.productKey, record.productHuntUrl]],
  ['apparkSummary', 'appark-local-products.jsonl', (record) => [record.product_key, record.product_hunt_url]],
  ['apparkPlatforms', 'appark-local-platform.raw.jsonl', (record) => [record.productKey, record.productHuntUrl]],
  ['pricingSignals', 'pricing-signals.jsonl', (record) => [record.productKey]],
];

const sourceIndexes = Object.fromEntries(sourceDefinitions.map(([name, fileName, keyGetter]) => {
  const records = readJsonLines(fileName);
  return [name, { fileName, index: indexRecords(records, keyGetter) }];
}));

const manifestById = new Map();
for (const product of manifest.products || []) {
  const key = normalizeKey(product.productKey || product.productHuntUrl);
  manifestById.set(productId(key), { key, product });
}
const compiledProductById = new Map(payload.products.map((product) => [product.id, product]));
const compiledPaymentById = indexRecords(payload.paymentMetrics, (record) => [record.product_id]);
const compiledMonthlyById = indexRecords(payload.monthlyMetrics, (record) => [record.product_id]);
const compiledAppById = indexRecords(payload.appMetrics, (record) => [record.product_id]);

const latestJulyByKey = new Map();
for (const sourceName of ['semrushHistorical', 'semrushJuly']) {
  for (const [key, records] of sourceIndexes[sourceName].index.entries()) {
    for (const record of records) {
      const monthly = record.monthly || record.raw?.data?.monthly || [];
      const metric = monthly.find((item) => String(item.displayDate || '').slice(0, 7) === '2026-07');
      if (!metric || metric.status !== 'available' || !(Number(metric.paymentOutboundVisits) > 0)) continue;
      const candidate = {
        record,
        metric,
        fetchedAt: String(record.fetchedAt || record.raw?.fetchedAt || ''),
        productCount: new Set(record.productKeys || []).size,
      };
      const previous = latestJulyByKey.get(key);
      if (!previous || candidate.fetchedAt >= previous.fetchedAt) latestJulyByKey.set(key, candidate);
    }
  }
}

const positiveJulyIds = [...new Set(payload.paymentMetrics
  .filter((metric) => metric.month === '2026-07-01' && Number(metric.payment_outbound_visits) > 0)
  .map((metric) => metric.product_id))];

const rows = [];
for (const id of positiveJulyIds) {
  const compiledProduct = compiledProductById.get(id);
  if (!compiledProduct || String(compiledProduct.revenue_estimate_source || '').includes('Semrush payment traffic')) continue;
  const manifestEntry = manifestById.get(id);
  if (!manifestEntry) continue;
  const { key, product: manifestProduct } = manifestEntry;
  const latestJuly = latestJulyByKey.get(key);
  const pricingRecord = latestRecord(sourceIndexes.pricingSignals.index.get(key));
  const verifiedPricingEvidence = (manifestProduct.productTypes || []).includes('SaaS / Web Service') && hasVerifiedPricingSignal(pricingRecord);
  const dedicatedProductDomain = hasDedicatedProductDomain(compiledProduct.name, compiledProduct.website_url, compiledProduct.domain);
  const sharedPlatformDomain = isSharedPlatformDomain(compiledProduct.domain);

  let reasonCode;
  if (compiledProduct.revenue_estimate_source === 'Appark estimate') reasonCode = 'appark_precedence';
  else if (!latestJuly || latestJuly.productCount !== 1) reasonCode = 'domain_mapped_to_multiple_products';
  else if (sharedPlatformDomain) reasonCode = 'shared_platform_domain';
  else reasonCode = 'name_domain_not_attributable_and_no_verified_pricing';

  const rawData = {
    manifestProduct,
    compiledProduct,
    compiledPaymentMetrics: compiledPaymentById.get(id) || [],
    compiledMonthlyMetrics: compiledMonthlyById.get(id) || [],
    compiledAppMetrics: compiledAppById.get(id) || [],
  };
  for (const [sourceName, { fileName, index }] of Object.entries(sourceIndexes)) {
    rawData[sourceName] = { sourceFile: fileName, records: index.get(key) || [] };
  }

  const urls = [...collectUrls(rawData)].toSorted();
  const identity = latestRecord(sourceIndexes.productIdentities.index.get(key)) || {};
  const julyPayment = (compiledPaymentById.get(id) || []).find((metric) => metric.month === '2026-07-01');
  rows.push({
    id,
    productKey: key,
    name: compiledProduct.name,
    tagline: compiledProduct.tagline,
    launchedAt: compiledProduct.launched_at,
    productHuntUrl: compiledProduct.product_hunt_url || manifestProduct.productHuntUrl || key,
    websiteUrl: compiledProduct.website_url || identity.website_url || null,
    domain: compiledProduct.domain || identity.website_domain || latestJuly?.record?.domain || null,
    iosStoreUrl: identity.ios_store_url || null,
    androidStoreUrl: identity.android_store_url || null,
    productTypes: compiledProduct.product_types || [],
    platforms: compiledProduct.platforms || [],
    julyPaymentOutboundVisits: julyPayment?.payment_outbound_visits ?? latestJuly?.metric?.paymentOutboundVisits ?? null,
    semrushQueryDomain: latestJuly?.record?.domain || null,
    semrushFetchedAt: latestJuly?.fetchedAt || null,
    queryProductCount: latestJuly?.productCount ?? null,
    queryProductNames: latestJuly?.record?.productNames || [],
    queryProductKeys: latestJuly?.record?.productKeys || [],
    finalRevenueSource: compiledProduct.revenue_estimate_source,
    finalEstimateMethod: compiledProduct.estimate_method_version,
    reasonCode,
    reasonLabel: REASONS[reasonCode].label,
    reasonExplanation: REASONS[reasonCode].short,
    checks: {
      positiveJulyPaymentTraffic: Number(julyPayment?.payment_outbound_visits ?? latestJuly?.metric?.paymentOutboundVisits) > 0,
      singleProductQuery: latestJuly?.productCount === 1,
      sharedPlatformDomain,
      dedicatedProductDomain,
      verifiedPricingEvidence,
      apparkRevenuePreferred: compiledProduct.revenue_estimate_source === 'Appark estimate',
    },
    links: urls,
    rawData,
  });
}

rows.sort((left, right) => String(left.launchedAt).localeCompare(String(right.launchedAt)) || left.name.localeCompare(right.name));
const reasonCounts = Object.fromEntries(Object.keys(REASONS).map((code) => [code, rows.filter((row) => row.reasonCode === code).length]));
const report = {
  metadata: {
    generatedAt: new Date().toISOString(),
    title: 'Semrush 支付流量星标拒绝审核',
    period: '2026-07',
    selection: 'payment_outbound_visits > 0 AND final revenue source does not include Semrush payment traffic',
    totalPositiveJulyProducts: positiveJulyIds.length,
    totalRejected: rows.length,
    reasonCounts,
    dataDirectory,
    payloadFile: basename(payloadFile),
  },
  reasonDefinitions: REASONS,
  products: rows,
};
writeFileSync(jsonOutput, `${JSON.stringify(report, null, 2)}\n`);

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Semrush 支付流量星标拒绝审核</title>
  <style>
    :root{color-scheme:light;--ink:#172033;--muted:#67718a;--line:#dfe4ed;--panel:#fff;--bg:#f3f5f9;--accent:#315efb;--danger:#bf3d3d;--warn:#9b6814;--ok:#147a55}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    header{padding:28px 30px 22px;background:#121a2c;color:#fff}h1{margin:0 0 8px;font-size:26px}header p{margin:0;color:#c7d0e4;max-width:980px}
    .wrap{padding:20px 24px 48px}.stats{display:grid;grid-template-columns:repeat(5,minmax(140px,1fr));gap:12px;margin-bottom:16px}
    .stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}.stat b{display:block;font-size:23px}.stat span{color:var(--muted);font-size:12px}
    .toolbar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:10px;padding:12px;background:rgba(243,245,249,.96);border:1px solid var(--line);border-radius:12px;margin-bottom:12px;backdrop-filter:blur(10px)}
    input,select,button{height:38px;border:1px solid #cfd6e3;border-radius:8px;background:#fff;padding:0 11px;color:var(--ink)}input{min-width:260px;flex:1}button{cursor:pointer;font-weight:600}button:hover{border-color:var(--accent);color:var(--accent)}
    .result-count{display:flex;align-items:center;color:var(--muted);margin-left:auto}.table-shell{overflow:auto;background:#fff;border:1px solid var(--line);border-radius:12px}
    table{width:100%;border-collapse:separate;border-spacing:0;min-width:1420px}th{position:sticky;top:0;z-index:2;background:#edf1f7;color:#3b465d;text-align:left;font-size:12px;padding:11px;border-bottom:1px solid var(--line)}td{vertical-align:top;padding:12px 11px;border-bottom:1px solid #edf0f5}
    tr:hover td{background:#fafbfe}.num{text-align:right;font-variant-numeric:tabular-nums}.product{min-width:210px}.product strong{font-size:15px}.muted{color:var(--muted);font-size:12px}.links{display:flex;gap:6px;flex-wrap:wrap}.links a{color:var(--accent);text-decoration:none}.links a:hover{text-decoration:underline}
    .pill{display:inline-block;border-radius:999px;padding:3px 8px;font-size:12px;font-weight:650;background:#fff1df;color:#8a5312}.pill[data-reason="appark_precedence"]{background:#e8f4ff;color:#1a5b8f}.pill[data-reason="shared_platform_domain"]{background:#f1eaff;color:#6b3aa0}.pill[data-reason="domain_mapped_to_multiple_products"]{background:#ffeceb;color:#a33a32}
    .checks{display:grid;grid-template-columns:1fr 1fr;gap:3px;min-width:220px}.check{font-size:12px}.yes{color:var(--ok)}.no{color:var(--danger)}
    details{min-width:260px}summary{cursor:pointer;color:var(--accent);font-weight:600}.raw-actions{display:flex;gap:8px;margin:8px 0}.raw-links{max-height:150px;overflow:auto;margin:8px 0;padding:8px;background:#f7f8fb;border-radius:7px}.raw-links a{display:block;overflow:hidden;text-overflow:ellipsis;color:var(--accent);white-space:nowrap}
    pre{margin:8px 0 0;max-width:800px;max-height:540px;overflow:auto;padding:12px;border-radius:8px;background:#111827;color:#d6e1f4;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
    .empty{padding:40px;text-align:center;color:var(--muted)}@media(max-width:900px){.stats{grid-template-columns:1fr 1fr}.wrap{padding:14px}.result-count{width:100%;margin-left:0}}
  </style>
</head>
<body>
  <header>
    <h1>Semrush 支付流量星标拒绝审核</h1>
    <p>范围：2026 年 7 月支付平台出站流量大于 0、但未被收入估算采用的产品。原始数据仍被完整保留；“拒绝”只表示未通过产品级收入归属校验。</p>
  </header>
  <main class="wrap">
    <section class="stats" id="stats"></section>
    <section class="toolbar">
      <input id="search" type="search" placeholder="搜索产品、域名、链接或最终来源…">
      <select id="reason"><option value="">全部拒绝原因</option></select>
      <select id="sort"><option value="date">按上架日期</option><option value="visits">按支付流量降序</option><option value="name">按产品名</option></select>
      <button id="download">下载当前筛选 CSV</button>
      <button id="expand">展开当前原始数据</button>
      <span class="result-count" id="resultCount"></span>
    </section>
    <section class="table-shell"><table>
      <thead><tr><th>#</th><th>产品 / 上架时间</th><th>主要链接</th><th>类型 / 平台</th><th class="num">7 月支付流量</th><th>拒绝原因</th><th>判定证据</th><th>最终收入处理</th><th>完整原始数据与链接</th></tr></thead>
      <tbody id="rows"></tbody>
    </table></section>
  </main>
  <script>
    const report = ${escapeScriptJson(report)};
    const products = report.products;
    const fmt = new Intl.NumberFormat('zh-CN');
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const safeUrl = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? u.href : '#'; } catch { return '#'; } };
    const reasonOrder = ['name_domain_not_attributable_and_no_verified_pricing','domain_mapped_to_multiple_products','appark_precedence','shared_platform_domain'];
    document.querySelector('#stats').innerHTML = [
      ['218','未打星产品'],['116','产品与域名证据不足'],['90','同域名多个产品'],['8','Appark 优先（**）'],['4','共享平台域名']
    ].map(([value,label]) => '<div class="stat"><b>'+value+'</b><span>'+label+'</span></div>').join('');
    const reasonSelect = document.querySelector('#reason');
    for (const code of reasonOrder) reasonSelect.insertAdjacentHTML('beforeend','<option value="'+code+'">'+esc(report.reasonDefinitions[code].label)+' ('+report.metadata.reasonCounts[code]+')</option>');
    const state = { filtered: products };
    const link = (href,label) => href ? '<a href="'+esc(safeUrl(href))+'" target="_blank" rel="noreferrer">'+esc(label)+'</a>' : '';
    function render(){
      const query = document.querySelector('#search').value.trim().toLowerCase();
      const reason = reasonSelect.value;
      const sort = document.querySelector('#sort').value;
      let items = products.filter(p => (!reason || p.reasonCode===reason) && (!query || JSON.stringify([p.name,p.domain,p.productHuntUrl,p.websiteUrl,p.finalRevenueSource,p.queryProductNames,p.links]).toLowerCase().includes(query)));
      items = [...items].sort(sort==='visits' ? (a,b)=>(b.julyPaymentOutboundVisits||0)-(a.julyPaymentOutboundVisits||0) : sort==='name' ? (a,b)=>a.name.localeCompare(b.name) : (a,b)=>String(a.launchedAt).localeCompare(String(b.launchedAt))||a.name.localeCompare(b.name));
      state.filtered = items;
      document.querySelector('#resultCount').textContent = '显示 '+items.length+' / '+products.length;
      const body = document.querySelector('#rows');
      if(!items.length){body.innerHTML='<tr><td colspan="9" class="empty">没有符合条件的产品</td></tr>';return;}
      body.innerHTML = items.map((p,index)=>{
        const storeLinks=[link(p.productHuntUrl,'Product Hunt'),link(p.websiteUrl,'官网'),link(p.iosStoreUrl,'iOS'),link(p.androidStoreUrl,'Android')].filter(Boolean).join(' · ');
        const checkRows=[['单次查询只对应一个产品',p.checks.singleProductQuery],['非共享平台域名',!p.checks.sharedPlatformDomain],['产品名与域名匹配',p.checks.dedicatedProductDomain],['有验证定价证据',p.checks.verifiedPricingEvidence],['Appark 营收优先',p.checks.apparkRevenuePreferred]];
        const checks=checkRows.map(([label,value])=>'<span class="check '+(value?'yes':'no')+'">'+(value?'✓ ':'× ')+esc(label)+'</span>').join('');
        const related=p.queryProductNames.length>1?'<div class="muted">同域产品：'+esc(p.queryProductNames.join('、'))+'</div>':'';
        const rawId='raw-'+p.id;
        return '<tr data-id="'+esc(p.id)+'"><td>'+(index+1)+'</td><td class="product"><strong>'+esc(p.name)+'</strong><div class="muted">'+esc(String(p.launchedAt||'').slice(0,10))+'</div><div class="muted">'+esc(p.tagline||'')+'</div></td><td><div class="links">'+storeLinks+'</div><div class="muted">'+esc(p.domain||'无域名')+'</div></td><td><div>'+esc((p.productTypes||[]).join(' · ')||'—')+'</div><div class="muted">'+esc((p.platforms||[]).join(' · ')||'—')+'</div></td><td class="num"><strong>'+fmt.format(p.julyPaymentOutboundVisits||0)+'</strong><div class="muted">'+esc(p.semrushQueryDomain||'')+'</div></td><td><span class="pill" data-reason="'+esc(p.reasonCode)+'">'+esc(p.reasonLabel)+'</span><div class="muted" style="margin-top:6px">'+esc(p.reasonExplanation)+'</div>'+related+'</td><td><div class="checks">'+checks+'</div></td><td><div>'+esc(p.finalRevenueSource||'—')+'</div><div class="muted">'+esc(p.finalEstimateMethod||'—')+'</div></td><td><details data-raw-id="'+rawId+'"><summary>查看 '+p.links.length+' 个链接和全部 JSON</summary><div class="raw-actions"><button type="button" data-copy="'+esc(p.id)+'">复制该产品 JSON</button></div><div class="raw-links">'+p.links.map((u)=>link(u,u)).join('')+'</div><pre id="'+rawId+'">展开后载入…</pre></details></td></tr>';
      }).join('');
      document.querySelectorAll('details[data-raw-id]').forEach(details=>details.addEventListener('toggle',()=>{if(!details.open)return;const id=details.closest('tr').dataset.id;const p=products.find(item=>item.id===id);const pre=document.getElementById(details.dataset.rawId);if(pre.dataset.loaded!=='1'){pre.textContent=JSON.stringify(p.rawData,null,2);pre.dataset.loaded='1';}}));
      document.querySelectorAll('button[data-copy]').forEach(button=>button.addEventListener('click',async()=>{const p=products.find(item=>item.id===button.dataset.copy);await navigator.clipboard.writeText(JSON.stringify(p,null,2));button.textContent='已复制';setTimeout(()=>button.textContent='复制该产品 JSON',1200);}));
    }
    function csvCell(value){return '"'+String(value??'').replaceAll('"','""')+'"'}
    document.querySelector('#download').addEventListener('click',()=>{const headers=['name','launched_at','product_hunt_url','website_url','domain','july_payment_outbound_visits','reason_code','reason','query_product_count','related_products','final_revenue_source','final_estimate_method'];const lines=[headers.map(csvCell).join(',')];for(const p of state.filtered)lines.push([p.name,p.launchedAt,p.productHuntUrl,p.websiteUrl,p.domain,p.julyPaymentOutboundVisits,p.reasonCode,p.reasonLabel,p.queryProductCount,p.queryProductNames.join(' | '),p.finalRevenueSource,p.finalEstimateMethod].map(csvCell).join(','));const blob=new Blob(['\\ufeff'+lines.join('\\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='semrush-payment-star-rejections-filtered.csv';a.click();URL.revokeObjectURL(a.href)});
    document.querySelector('#expand').addEventListener('click',()=>{const details=[...document.querySelectorAll('details')];const shouldOpen=details.some(item=>!item.open);for(const item of details)item.open=shouldOpen;document.querySelector('#expand').textContent=shouldOpen?'收起全部原始数据':'展开当前原始数据'});
    for(const id of ['search','reason','sort'])document.querySelector('#'+id).addEventListener(id==='search'?'input':'change',render);
    render();
  </script>
</body>
</html>`;

writeFileSync(htmlOutput, html);
console.log(JSON.stringify({ htmlOutput, jsonOutput, total: rows.length, reasonCounts }, null, 2));
