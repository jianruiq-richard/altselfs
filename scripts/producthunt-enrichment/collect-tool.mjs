import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [manifestPath, outputDir, phase, concurrencyArg] = process.argv.slice(2);
if (!manifestPath || !outputDir || !['similarweb', 'semrush', 'appark'].includes(phase)) {
  throw new Error('Usage: node collect-tool.mjs <manifest.json> <output-dir> <similarweb|semrush|appark> [concurrency]');
}

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const serverUrl = String(process.env.PERSONAL_AGENT_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const semrushUrl = String(process.env.SEMRUSH_TRAFFIC_SERVICE_URL || '').replace(/\/$/, '');
const semrushToken = process.env.SEMRUSH_SERVICE_TOKEN || '';
const semrushUseInternalTool = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.SEMRUSH_USE_INTERNAL_TOOL || '').trim().toLowerCase(),
);
const semrushUseEcsSsh = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.SEMRUSH_USE_ECS_SSH || '').trim().toLowerCase(),
);
const semrushEcsHost = String(process.env.SEMRUSH_ECS_HOST || 'root@47.84.96.220').trim();
const semrushEcsContainer = String(
  process.env.SEMRUSH_ECS_CONTAINER || 'personal-agent-server-docker-personal-agent-server-green-1',
).trim();
const internalToolsUseEcsSsh = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.INTERNAL_TOOLS_USE_ECS_SSH || '').trim().toLowerCase(),
);
const semrushExactMonth = phase === 'semrush'
  && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(process.env.SEMRUSH_EXACT_MONTH || '').trim())
  ? String(process.env.SEMRUSH_EXACT_MONTH).trim()
  : '';
const semrushRetryFailedAtStart = phase === 'semrush' && ['1', 'true', 'yes', 'on'].includes(
  String(process.env.SEMRUSH_RETRY_FAILED_AT_START || '').trim().toLowerCase(),
);
const semrushPauseWhenAllUsedPercent = phase === 'semrush'
  ? Number(process.env.SEMRUSH_PAUSE_WHEN_ALL_USED_PERCENT || 80)
  : Number.NaN;
const internalToolsEcsHost = String(process.env.INTERNAL_TOOLS_ECS_HOST || semrushEcsHost).trim();
const internalToolsEcsContainer = String(process.env.INTERNAL_TOOLS_ECS_CONTAINER || semrushEcsContainer).trim();
const resolverRawPath = path.join(outputDir, 'identity-resolution.raw.jsonl');
const resolverDonePath = path.join(outputDir, 'identity-resolution.done.json');
const productHuntLinksRawPath = path.join(outputDir, 'producthunt-official-links.raw.jsonl');
const productHuntLinksDonePath = path.join(outputDir, 'producthunt-official-links.done.json');
const outputSuffix = semrushExactMonth ? `-${semrushExactMonth}` : '';
const rawPath = path.join(outputDir, `${phase}${outputSuffix}.raw.jsonl`);
const progressPath = path.join(outputDir, `${phase}${outputSuffix}.progress.json`);
const semrushLegacyRawPath = path.join(outputDir, 'semrush.raw.jsonl');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
const requestedConcurrency = Math.max(1, Number(concurrencyArg) || (phase === 'similarweb' ? 2 : 1));
const concurrency = phase === 'similarweb'
  ? Math.min(4, requestedConcurrency)
  : phase === 'semrush'
    ? Math.min(3, requestedConcurrency)
    : 1;
const maxAttempts = 3;
const terminalStatuses = new Set([
  'success_value', 'success_zero', 'success_matched_no_estimate', 'no_data', 'identity_mismatch', 'failed_exhausted',
]);
const sharedDomains = new Set([
  'producthunt.com', 'apps.apple.com', 'play.google.com', 'github.com', 'gitlab.com', 'huggingface.co',
  'npmjs.com', 'pypi.org', 'chromewebstore.google.com', 'microsoft.com', 'youtube.com', 'youtu.be', 'x.com',
  'twitter.com', 'linkedin.com', 'instagram.com', 'facebook.com', 'reddit.com', 'medium.com', 'substack.com',
]);

await fs.mkdir(outputDir, { recursive: true });
let appendChain = Promise.resolve();
let throttleChain = Promise.resolve();
let nextAllowedAt = 0;
let semrushQuotaPause = null;
let semrushQuotaCheckPromise = null;
let semrushQuotaCheckCachedAt = 0;
let semrushQuotaCheckCachedResult = null;

if (phase === 'appark') await runAppark();
else await runDomainTool();

async function runDomainTool() {
  const failedAtStart = new Map();
  if (semrushRetryFailedAtStart) {
    const initialLatest = latestBy(await readJsonLines(rawPath), (record) => record.domain, phase);
    for (const [domain, record] of initialLatest) {
      if (record.scanStatus === 'failed_exhausted') failedAtStart.set(domain, record.fetchedAt);
    }
  }
  const isTerminalDomainRecord = (domain, record) => {
    if (!terminalStatuses.has(record?.scanStatus)) return false;
    return !(
      semrushRetryFailedAtStart
      && record.scanStatus === 'failed_exhausted'
      && failedAtStart.get(domain) === record.fetchedAt
    );
  };
  while (true) {
    const identityState = await loadIdentityState();
    const domains = groupProductsByDomain(identityState);
    const prior = await readJsonLines(rawPath);
    const latest = latestBy(prior, (record) => record.domain, phase);
    const legacyCoveredDomains = semrushExactMonth
      ? coveredDomainsForSemrushMonth(await readJsonLines(semrushLegacyRawPath), semrushExactMonth)
      : new Set();
    const pending = domains.filter((item) => (
      !legacyCoveredDomains.has(item.domain)
      && !isTerminalDomainRecord(item.domain, latest.get(item.domain))
    ));
    await writeProgress({
      phase,
      ...(semrushExactMonth ? {
        requestedMonth: semrushExactMonth,
        coveredByExistingRecords: legacyCoveredDomains.size,
      } : {}),
      state: pending.length ? 'running' : identityState.resolverDone ? 'done' : 'waiting_for_identity_resolution',
      resolverDone: identityState.resolverDone,
      discoveredDomains: domains.length,
      completedDomains: domains.length - pending.length,
      pendingDomains: pending.length,
      rawRecords: prior.length,
      concurrency,
      statusCounts: countLatestStatuses(latest),
    });
    if (pending.length) {
      if (phase === 'semrush' && (await semrushQuotaGuard())?.shouldPause) {
        await writeProgress({
          phase,
          ...(semrushExactMonth ? { requestedMonth: semrushExactMonth } : {}),
          state: 'paused_quota',
          pendingDomains: pending.length,
          completedDomains: domains.length - pending.length,
          quotaPause: semrushQuotaPause,
          pausedAt: new Date().toISOString(),
        });
        return;
      }
      if (phase === 'similarweb' || (phase === 'semrush' && concurrency === 1)) {
        // Rebuild the domain queue after every serial item so newly resolved
        // Product Hunt websites become visible immediately.
        await collectDomainItem(pending[0]);
        continue;
      }
      let completedThisBatch = 0;
      await runPool(pending, concurrency, async (item) => {
        await collectDomainItem(item);
        completedThisBatch += 1;
        if (completedThisBatch % 5 === 0 || completedThisBatch === pending.length) {
          const currentRecords = await readJsonLines(rawPath);
          const currentLatest = latestBy(currentRecords, (record) => record.domain, phase);
          await writeProgress({
            phase,
            ...(semrushExactMonth ? {
              requestedMonth: semrushExactMonth,
              coveredByExistingRecords: legacyCoveredDomains.size,
            } : {}),
            state: 'running',
            resolverDone: identityState.resolverDone,
            discoveredDomains: domains.length,
            completedDomains: domains.length - pending.length + completedThisBatch,
            pendingDomains: pending.length - completedThisBatch,
            rawRecords: currentRecords.length,
            concurrency,
            statusCounts: countLatestStatuses(currentLatest),
          });
        }
      });
      if (semrushQuotaPause) {
        const currentRecords = await readJsonLines(rawPath);
        const currentLatest = latestBy(currentRecords, (record) => record.domain, phase);
        const currentPending = domains.filter((item) => (
          !legacyCoveredDomains.has(item.domain)
          && !isTerminalDomainRecord(item.domain, currentLatest.get(item.domain))
        ));
        await writeProgress({
          phase,
          ...(semrushExactMonth ? {
            requestedMonth: semrushExactMonth,
            coveredByExistingRecords: legacyCoveredDomains.size,
          } : {}),
          state: 'paused_quota',
          resolverDone: identityState.resolverDone,
          discoveredDomains: domains.length,
          completedDomains: domains.length - currentPending.length,
          pendingDomains: currentPending.length,
          rawRecords: currentRecords.length,
          concurrency,
          statusCounts: countLatestStatuses(currentLatest),
          quotaPause: semrushQuotaPause,
          pausedAt: new Date().toISOString(),
        });
        return;
      }
    }
    if (identityState.resolverDone) {
      const finalState = await loadIdentityState();
      const finalDomains = groupProductsByDomain(finalState);
      const finalLatest = latestBy(await readJsonLines(rawPath), (record) => record.domain, phase);
      const finalLegacyCoveredDomains = semrushExactMonth
        ? coveredDomainsForSemrushMonth(await readJsonLines(semrushLegacyRawPath), semrushExactMonth)
        : new Set();
      const remaining = finalDomains.filter((item) => (
        !finalLegacyCoveredDomains.has(item.domain)
        && !isTerminalDomainRecord(item.domain, finalLatest.get(item.domain))
      ));
      if (!remaining.length) {
        await writeProgress({
          phase,
          ...(semrushExactMonth ? {
            requestedMonth: semrushExactMonth,
            coveredByExistingRecords: finalLegacyCoveredDomains.size,
          } : {}),
          state: 'done',
          resolverDone: true,
          discoveredDomains: finalDomains.length,
          completedDomains: finalDomains.length,
          pendingDomains: 0,
          concurrency,
          statusCounts: countLatestStatuses(finalLatest),
          completedAt: new Date().toISOString(),
        });
        return;
      }
    }
    await sleep(60_000);
  }
}

async function collectDomainItem(item) {
  let record;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (phase === 'similarweb') {
        await startThrottle(Number(process.env.SIMILARWEB_BETWEEN_DOMAINS_MS) || 3000);
        const response = await callInternalTool('altselfs_similarweb_api1', { domain: item.domain }, 120_000);
        record = classifySimilarweb(item, response, attempt);
      } else {
        if (!semrushUseInternalTool && !semrushUseEcsSsh && (!semrushUrl || !semrushToken)) {
          throw new Error('SEMRUSH_TRAFFIC_SERVICE_URL or SEMRUSH_SERVICE_TOKEN is missing');
        }
        const response = semrushExactMonth
          ? await callSemrush(item.domain, { month: semrushExactMonth })
          : await callSemrushWithFallback(item.domain);
        if (isBatchQuotaBlocked(response)) {
          semrushQuotaPause = {
            shouldPause: true,
            thresholdUsedPercent: 80,
            reason: response.raw.error,
            checkedAt: new Date().toISOString(),
          };
          return;
        }
        record = classifySemrush(item, response, attempt);
      }
    } catch (error) {
      record = baseRecord(item, attempt, attempt === maxAttempts ? 'failed_exhausted' : 'failed_retryable');
      record.error = error instanceof Error ? error.message : String(error);
    }
    record.fetchedAt = new Date().toISOString();
    await appendRecord(record);
    if (record.scanStatus !== 'failed_retryable') break;
    const delay = phase === 'semrush' ? 75_000 : attempt * 8000;
    await sleep(delay);
  }
  if (phase === 'semrush') await sleep(Number(process.env.SEMRUSH_BETWEEN_DOMAINS_MS) || 75_000);
}

async function runAppark() {
  const products = manifest.products.filter((product) => product.isNativeApp);
  const prior = await readJsonLines(rawPath);
  const latest = latestBy(prior, (record) => record.productKey, phase);
  for (const [productKey, record] of latest) {
    if (record.scanStatus !== 'no_data' && isApparkNoCandidate(record)) {
      const corrected = {
        ...record,
        scanStatus: 'no_data',
        correctedFrom: record.scanStatus || 'unknown',
        correctionReason: 'Appark completed the search and returned no matching candidate.',
        fetchedAt: new Date().toISOString(),
      };
      await appendRecord(corrected);
      latest.set(productKey, corrected);
    }
  }
  const pending = products.filter((product) => !terminalStatuses.has(latest.get(product.productKey)?.scanStatus));
  await writeProgress({
    phase,
    state: 'running',
    totalAppProducts: products.length,
    completedProducts: products.length - pending.length,
    pendingProducts: pending.length,
    rawRecords: prior.length,
    concurrency: 1,
    statusCounts: countLatestStatuses(latest),
  });
  let completedThisRun = 0;
  let apparkIdentityState = await loadIdentityState();
  for (const product of pending) {
    let record;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (completedThisRun > 0 && completedThisRun % 20 === 0) apparkIdentityState = await loadIdentityState();
        const identity = apparkIdentityState.byProduct.get(product.productKey);
        const toolInput = buildApparkInput(product, identity);
        const response = await callInternalTool('altselfs_appark_app_intelligence', toolInput, 180_000);
        record = classifyAppark(product, toolInput, response, attempt);
      } catch (error) {
        record = {
          productKey: product.productKey,
          productHuntUrl: product.productHuntUrl,
          name: product.name,
          attempt,
          scanStatus: attempt === maxAttempts ? 'failed_exhausted' : 'failed_retryable',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      record.fetchedAt = new Date().toISOString();
      await appendRecord(record);
      if (record.scanStatus !== 'failed_retryable') break;
      await sleep(attempt * 10_000);
    }
    latest.set(product.productKey, record);
    completedThisRun += 1;
    if (completedThisRun % 5 === 0 || completedThisRun === pending.length) {
      await writeProgress({
        phase,
        state: 'running',
        totalAppProducts: products.length,
        completedProducts: products.length - pending.length + completedThisRun,
        pendingProducts: pending.length - completedThisRun,
        concurrency: 1,
        statusCounts: countLatestStatuses(latest),
      });
    }
    await sleep(2000);
  }
  await writeProgress({
    phase,
    state: 'done',
    totalAppProducts: products.length,
    completedProducts: products.length,
    pendingProducts: 0,
    concurrency: 1,
    statusCounts: countLatestStatuses(latest),
    completedAt: new Date().toISOString(),
  });
}

function classifySimilarweb(item, response, attempt) {
  const record = baseRecord(item, attempt, 'failed_retryable');
  record.httpStatus = response.httpStatus;
  record.raw = response.raw;
  const body = response.raw?.data?.body;
  const visits = body?.EstimatedMonthlyVisits;
  const providerError = Number(body?.status) >= 400 ? `${body.status}: ${body.message || 'provider error'}` : null;
  if (!response.outerSuccess || response.raw?.error || providerError || !body || typeof body !== 'object' || Array.isArray(body)) {
    record.error = response.raw?.error || providerError || 'Similarweb response did not contain a data body';
    if (attempt === maxAttempts) record.scanStatus = 'failed_exhausted';
    return record;
  }
  if (!visits || typeof visits !== 'object' || Array.isArray(visits)) {
    record.scanStatus = 'no_data';
    return record;
  }
  record.monthlyVisits = visits;
  const values = Object.values(visits).map(Number).filter(Number.isFinite);
  record.scanStatus = values.some((value) => value > 0) ? 'success_value' : 'success_zero';
  return record;
}

function classifySemrush(item, response, attempt) {
  const record = baseRecord(item, attempt, 'failed_retryable');
  if (semrushExactMonth) record.requestedMonth = semrushExactMonth;
  record.httpStatus = response.httpStatus;
  record.raw = response.raw;
  record.supplementalRaw = response.supplementalRaw || [];
  const monthly = mergeMonthly([
    ...(Array.isArray(response.raw?.data?.monthly) ? response.raw.data.monthly : []),
    ...record.supplementalRaw.flatMap((item) => Array.isArray(item?.raw?.data?.monthly) ? item.raw.data.monthly : []),
  ]);
  const available = monthly.filter((month) => month?.status === 'available');
  if (!response.httpOk || response.raw?.error || !monthly.length) {
    record.error = response.raw?.error || `Semrush response did not contain monthly data (HTTP ${response.httpStatus})`;
    if (attempt === maxAttempts) record.scanStatus = 'failed_exhausted';
    return record;
  }
  if (!available.length) {
    record.scanStatus = 'no_data';
    record.monthly = monthly;
    return record;
  }
  record.monthly = monthly;
  record.coverage = response.raw?.data?.coverage || null;
  record.availableMonthCount = available.length;
  record.requestedRangeComplete = response.raw?.data?.coverage?.complete === true;
  record.fallbackMonths = record.supplementalRaw.map((item) => item.month);
  record.scanStatus = available.some((month) => Number(month.paymentOutboundVisits) > 0) ? 'success_value' : 'success_zero';
  return record;
}

function coveredDomainsForSemrushMonth(records, month) {
  const displayDate = `${month}-01`;
  const covered = new Set();
  for (const record of records) {
    const monthly = mergeMonthly([
      ...(Array.isArray(record?.monthly) ? record.monthly : []),
      ...(Array.isArray(record?.raw?.data?.monthly) ? record.raw.data.monthly : []),
      ...(Array.isArray(record?.supplementalRaw)
        ? record.supplementalRaw.flatMap((item) => Array.isArray(item?.raw?.data?.monthly) ? item.raw.data.monthly : [])
        : []),
    ]);
    if (monthly.some((item) => item?.displayDate === displayDate && item?.status === 'available')) {
      covered.add(record.domain);
    }
  }
  return covered;
}

function classifyAppark(product, toolInput, response, attempt) {
  const data = response.raw?.data;
  const selected = data?.selected?.app;
  const record = {
    productKey: product.productKey,
    productHuntUrl: product.productHuntUrl,
    name: product.name,
    platforms: product.platforms,
    toolInput,
    attempt,
    httpStatus: response.httpStatus,
    raw: response.raw,
    scanStatus: 'failed_retryable',
  };
  if (isApparkNoCandidate(record)) {
    record.scanStatus = 'no_data';
    record.error = data?.error;
    return record;
  }
  if (!response.outerSuccess || response.raw?.error) {
    record.error = response.raw?.error || 'Appark bridge request failed';
    if (attempt === maxAttempts) record.scanStatus = 'failed_exhausted';
    return record;
  }
  if (!selected) {
    record.scanStatus = data?.error ? 'no_data' : attempt === maxAttempts ? 'failed_exhausted' : 'failed_retryable';
    record.error = data?.error || 'Appark response did not select an app';
    return record;
  }
  const requestedId = String(toolInput.appId || '').toLowerCase();
  const selectedId = String(selected.app_id || '').toLowerCase();
  const requestedName = comparable(product.name);
  const selectedName = comparable(selected.app_name);
  const exactId = requestedId && requestedId === selectedId;
  const exactName = requestedName && selectedName === requestedName;
  const strongName = requestedName.length >= 4 && selectedName.includes(requestedName);
  record.identityStatus = exactId ? 'exact_app_id' : exactName ? 'exact_name' : strongName ? 'name_contains' : 'mismatch';
  if (record.identityStatus === 'mismatch') {
    record.scanStatus = 'identity_mismatch';
    return record;
  }
  const metrics = collectMetricNumbers(data?.downloadRevenue30d);
  record.downloadRevenueMetricNumbers = metrics;
  if (!metrics.length) record.scanStatus = 'success_matched_no_estimate';
  else record.scanStatus = metrics.some((value) => value > 0) ? 'success_value' : 'success_zero';
  return record;
}

function isApparkNoCandidate(record) {
  const message = record?.raw?.data?.error;
  return typeof message === 'string' && /No Appark app candidate matched/i.test(message);
}

function buildApparkInput(product, identity) {
  const storeIdentities = identity?.storeIdentities || [];
  const platformSet = new Set(product.platforms.map((value) => value.toLowerCase()));
  const preferred = storeIdentities.find((item) => item.platform === 'android') || storeIdentities[0];
  if (preferred) {
    return {
      appName: product.name,
      appId: preferred.appId,
      platform: preferred.platform,
      country: 'us',
      searchSize: 10,
      includeDownloadRevenue: true,
      includeCompetitors: true,
    };
  }
  const hasAndroid = platformSet.has('android');
  const hasApple = platformSet.has('ios') || platformSet.has('macos') || platformSet.has('watchos');
  return {
    appName: product.name,
    platform: hasAndroid && !hasApple ? 'android' : hasApple && !hasAndroid ? 'ios' : 'auto',
    country: 'us',
    searchSize: 10,
    includeDownloadRevenue: true,
    includeCompetitors: true,
  };
}

async function callInternalTool(toolName, argumentsValue, timeoutMs) {
  if (internalToolsUseEcsSsh) {
    return callInternalToolViaEcsSsh(toolName, argumentsValue, timeoutMs);
  }
  const response = await fetch(`${serverUrl}/internal/tools/rapidapi-competitor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      toolName,
      arguments: argumentsValue,
      _context: { enabledToolNames: [toolName] },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const wrapperText = await response.text();
  let wrapper;
  try { wrapper = JSON.parse(wrapperText); } catch { throw new Error(`tool bridge returned invalid JSON: ${wrapperText.slice(0, 300)}`); }
  const toolText = wrapper?.contentItems?.[0]?.text;
  let raw;
  try { raw = JSON.parse(toolText); } catch { raw = toolText ?? wrapper; }
  return { httpStatus: response.status, outerSuccess: Boolean(response.ok && wrapper?.success), raw };
}

async function callInternalToolViaEcsSsh(toolName, argumentsValue, timeoutMs) {
  const payload = Buffer.from(JSON.stringify({ toolName, argumentsValue, timeoutMs }), 'utf8').toString('base64url');
  const remoteScript = [
    '(async()=>{',
    "const input=JSON.parse(Buffer.from(process.argv[1],'base64url').toString('utf8'));",
    "const response=await fetch('http://127.0.0.1:8787/internal/tools/rapidapi-competitor',{",
    "method:'POST',",
    "headers:{'content-type':'application/json'},",
    'body:JSON.stringify({toolName:input.toolName,arguments:input.argumentsValue,_context:{enabledToolNames:[input.toolName]}}),',
    'signal:AbortSignal.timeout(input.timeoutMs),',
    '});',
    'const wrapperText=await response.text();',
    'let wrapper;',
    "try{wrapper=JSON.parse(wrapperText)}catch{throw new Error('tool bridge returned invalid JSON: '+wrapperText.slice(0,300))}",
    'const toolText=wrapper?.contentItems?.[0]?.text;',
    'let raw;',
    'try{raw=JSON.parse(toolText)}catch{raw=toolText??wrapper}',
    'process.stdout.write(JSON.stringify({httpStatus:response.status,outerSuccess:Boolean(response.ok&&wrapper?.success),raw}));',
    "})().catch(error=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exit(1)})",
  ].join('');
  const remoteCommand = [
    'docker exec',
    shellQuote(internalToolsEcsContainer),
    'node -e',
    shellQuote(remoteScript),
    shellQuote(payload),
  ].join(' ');
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'StrictHostKeyChecking=accept-new', internalToolsEcsHost, remoteCommand],
    { timeout: timeoutMs + 30_000, maxBuffer: 50 * 1024 * 1024 },
  );
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`ECS tool call returned invalid JSON: ${stdout.slice(0, 300)}`);
  }
}

async function callSemrush(domain, input = { months: 6 }) {
  input = { ...input, workload: 'batch' };
  if (semrushUseEcsSsh) return callSemrushViaEcsSsh(domain, input);
  if (semrushUseInternalTool) {
    throw new Error('Batch Semrush collection must use ECS SSH or the dispatcher URL; the interactive agent tool does not carry batch quota policy');
  }
  const response = await fetch(`${semrushUrl}/v1/payment-destinations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${semrushToken}` },
    body: JSON.stringify({ domain, ...input }),
    signal: AbortSignal.timeout(1_200_000),
  });
  const text = await response.text();
  let raw;
  try { raw = JSON.parse(text); } catch { raw = text; }
  return { httpStatus: response.status, httpOk: response.ok, raw };
}

async function callSemrushViaEcsSsh(domain, input) {
  const payload = Buffer.from(JSON.stringify({ domain, ...input }), 'utf8').toString('base64url');
  const remoteScript = [
    '(async()=>{',
    "const input=JSON.parse(Buffer.from(process.argv[1],'base64url').toString('utf8'));",
    "let url=process.env.SEMRUSH_TRAFFIC_SERVICE_URL||'http://semrush-traffic:8791';",
    "if(url.endsWith('/'))url=url.slice(0,-1);",
    "const token=process.env.SEMRUSH_SERVICE_TOKEN||'';",
    "const response=await fetch(url+'/v1/payment-destinations',{",
    "method:'POST',",
    "headers:{'content-type':'application/json',authorization:'Bearer '+token},",
    'body:JSON.stringify(input),',
    'signal:AbortSignal.timeout(1200000),',
    '});',
    'const text=await response.text();',
    'let raw;',
    'try{raw=JSON.parse(text)}catch{raw=text}',
    'process.stdout.write(JSON.stringify({httpStatus:response.status,httpOk:response.ok,raw}));',
    "})().catch(error=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exit(1)})",
  ].join('');
  const remoteCommand = [
    'docker exec',
    shellQuote(semrushEcsContainer),
    'node -e',
    shellQuote(remoteScript),
    shellQuote(payload),
  ].join(' ');
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'StrictHostKeyChecking=accept-new', semrushEcsHost, remoteCommand],
    { timeout: 1_230_000, maxBuffer: 20 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout.trim());
  return {
    httpStatus: Number(parsed.httpStatus) || 0,
    httpOk: parsed.httpOk === true,
    raw: parsed.raw,
  };
}

async function readSemrushDispatcherHealthViaEcsSsh() {
  const remoteScript = [
    '(async()=>{',
    "let url=process.env.SEMRUSH_TRAFFIC_SERVICE_URL||'http://semrush-traffic:8791';",
    "if(url.endsWith('/'))url=url.slice(0,-1);",
    "const response=await fetch(url+'/healthz',{signal:AbortSignal.timeout(30000)});",
    'const text=await response.text();',
    "if(!response.ok)throw new Error('Semrush dispatcher health returned HTTP '+response.status+': '+text.slice(0,300));",
    'process.stdout.write(text);',
    "})().catch(error=>{console.error(error instanceof Error?error.stack||error.message:String(error));process.exit(1)})",
  ].join('');
  const remoteCommand = [
    'docker exec',
    shellQuote(semrushEcsContainer),
    'node -e',
    shellQuote(remoteScript),
  ].join(' ');
  const { stdout } = await execFileAsync(
    'ssh',
    ['-o', 'StrictHostKeyChecking=accept-new', semrushEcsHost, remoteCommand],
    { timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return JSON.parse(stdout.trim());
}

async function semrushQuotaGuard() {
  if (semrushQuotaPause) return semrushQuotaPause;
  if (
    !semrushUseEcsSsh
    || !Number.isFinite(semrushPauseWhenAllUsedPercent)
    || semrushPauseWhenAllUsedPercent <= 0
  ) return null;
  if (semrushQuotaCheckCachedResult && Date.now() - semrushQuotaCheckCachedAt < 30_000) {
    return semrushQuotaCheckCachedResult;
  }
  if (!semrushQuotaCheckPromise) {
    semrushQuotaCheckPromise = (async () => {
      try {
        const health = await readSemrushDispatcherHealthViaEcsSsh();
        const workers = Array.isArray(health?.workers) ? health.workers : [];
        const quotas = workers.map((worker) => ({
          workerId: worker?.workerId || null,
          usedPercent: typeof worker?.quota?.usedPercent === 'number' && Number.isFinite(worker.quota.usedPercent)
            ? worker.quota.usedPercent
            : null,
          status: worker?.quota?.status || null,
          observedAt: worker?.quota?.observedAt || null,
        }));
        const validQuotas = quotas.filter((quota) => quota.usedPercent !== null);
        const shouldPause = health?.capacity?.acceptingBatchWorkers === 0
          || (workers.length > 0 && validQuotas.length === workers.length
            && validQuotas.every((quota) => quota.usedPercent >= semrushPauseWhenAllUsedPercent));
        return {
          shouldPause,
          thresholdUsedPercent: semrushPauseWhenAllUsedPercent,
          quotas,
          checkedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error(JSON.stringify({
          phase,
          event: 'quota_guard_check_failed',
          error: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        }));
        return null;
      }
    })().finally(() => {
      semrushQuotaCheckPromise = null;
    });
  }
  const result = await semrushQuotaCheckPromise;
  if (result) {
    semrushQuotaCheckCachedResult = result;
    semrushQuotaCheckCachedAt = Date.now();
  }
  if (result?.shouldPause) semrushQuotaPause = result;
  return result;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function callSemrushWithFallback(domain) {
  const primary = await callSemrush(domain, { months: 6 });
  if (isBatchQuotaBlocked(primary)) return primary;
  const primaryMonthly = Array.isArray(primary.raw?.data?.monthly) ? primary.raw.data.monthly : [];
  const available = primaryMonthly.filter((month) => month?.status === 'available');
  const requestedDates = primaryMonthly.map((month) => month?.displayDate).filter(Boolean).sort();
  const supplementalRaw = [];
  let cursorDate = requestedDates[0] ? new Date(`${requestedDates[0]}T00:00:00Z`) : null;
  for (let index = available.length; index < 6 && cursorDate && supplementalRaw.length < 3; index += 1) {
    cursorDate = new Date(Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() - 1, 1));
    const month = `${cursorDate.getUTCFullYear()}-${String(cursorDate.getUTCMonth() + 1).padStart(2, '0')}`;
    await sleep(5000);
    const supplemental = await callSemrush(domain, { month });
    if (isBatchQuotaBlocked(supplemental)) return supplemental;
    supplementalRaw.push({ month, ...supplemental });
    const supplementalMonthly = Array.isArray(supplemental.raw?.data?.monthly) ? supplemental.raw.data.monthly : [];
    if (!supplementalMonthly.some((item) => item?.status === 'available')) index -= 1;
  }
  return { ...primary, supplementalRaw };
}

function isBatchQuotaBlocked(response) {
  return response?.raw?.code === 'BATCH_QUOTA_RESERVED';
}

function mergeMonthly(monthly) {
  const byDate = new Map();
  for (const item of monthly) if (item?.displayDate) byDate.set(item.displayDate, item);
  return [...byDate.values()].sort((a, b) => String(a.displayDate).localeCompare(String(b.displayDate)));
}

async function loadIdentityState() {
  const resolverRecords = await readJsonLines(resolverRawPath);
  const resolverLatest = latestBy(resolverRecords, (record) => record.productKey);
  const productHuntLinkRecords = await readJsonLines(productHuntLinksRawPath);
  const productHuntLinkLatest = latestBy(productHuntLinkRecords, (record) => record.productKey);
  const byProduct = new Map();
  for (const product of manifest.products) {
    const known = product.knownIdentity;
    const resolved = resolverLatest.get(product.productKey);
    const productHuntLink = productHuntLinkLatest.get(product.productKey);
    const websiteDomain = normalizeDomain(
      productHuntLink?.officialDomain
      || productHuntLink?.officialUrl
      || resolved?.websiteDomain
      || known?.websiteDomain
      || resolved?.websiteUrl
      || known?.websiteUrl,
    );
    const storeIdentities = uniqueStoreIdentities([
      ...(Array.isArray(known?.storeIdentities) ? known.storeIdentities : []),
      ...(Array.isArray(resolved?.storeIdentities) ? resolved.storeIdentities : []),
      ...(Array.isArray(productHuntLink?.storeIdentities) ? productHuntLink.storeIdentities : []),
    ]);
    byProduct.set(product.productKey, {
      websiteDomain,
      storeIdentities,
      productHuntLink,
      resolved,
      known,
    });
  }
  const resolverDone = productHuntLinkRecords.length > 0
    ? await exists(productHuntLinksDonePath)
    : await exists(resolverDonePath);
  return { byProduct, resolverDone };
}

function groupProductsByDomain(identityState) {
  const map = new Map();
  for (const product of manifest.products) {
    const domain = identityState.byProduct.get(product.productKey)?.websiteDomain;
    if (!domain || isSharedDomain(domain)) continue;
    const launchDate = String(
      product.firstLaunchDate
      || (Array.isArray(product.launchDates) ? product.launchDates[0] : '')
      || '9999-12-31',
    );
    const item = map.get(domain) || {
      domain,
      productKeys: [],
      productNames: [],
      firstLaunchDate: launchDate,
    };
    item.productKeys.push(product.productKey);
    item.productNames.push(product.name);
    if (launchDate < item.firstLaunchDate) item.firstLaunchDate = launchDate;
    map.set(domain, item);
  }
  return [...map.values()].sort((a, b) => (
    phase === 'semrush'
      ? a.firstLaunchDate.localeCompare(b.firstLaunchDate) || a.domain.localeCompare(b.domain)
      : a.domain.localeCompare(b.domain)
  ));
}

function baseRecord(item, attempt, scanStatus) {
  return { domain: item.domain, productKeys: item.productKeys, productNames: item.productNames, attempt, scanStatus };
}

function latestBy(records, keyFn, phaseForLegacy) {
  const map = new Map();
  for (const sourceRecord of records) {
    const record = { ...sourceRecord };
    if (!record.scanStatus && phaseForLegacy === 'similarweb') {
      const classified = classifySimilarweb({ domain: record.domain, productKeys: record.productKeys || [], productNames: record.productNames || [] }, {
        httpStatus: record.httpStatus,
        outerSuccess: record.success,
        raw: record.raw,
      }, record.attempt || 1);
      record.scanStatus = classified.scanStatus;
    }
    const key = keyFn(record);
    if (key) map.set(key, record);
  }
  return map;
}

function countLatestStatuses(latest) {
  const counts = {};
  for (const record of latest.values()) counts[record.scanStatus || 'unknown'] = (counts[record.scanStatus || 'unknown'] || 0) + 1;
  return counts;
}

function collectMetricNumbers(value, key = '') {
  if (typeof value === 'number' && Number.isFinite(value) && /(download|revenue)/i.test(key)) return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectMetricNumbers(item, key));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([childKey, child]) => collectMetricNumbers(child, childKey));
  return [];
}

function comparable(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeDomain(value) {
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(String(value)) ? String(value) : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

function isSharedDomain(domain) {
  return [...sharedDomains].some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));
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

async function runPool(items, size, fn) {
  let cursor = 0;
  const workers = Array.from({ length: size }, async () => {
    while (true) {
      if (phase === 'semrush') {
        const quotaGuard = await semrushQuotaGuard();
        if (quotaGuard?.shouldPause || semrushQuotaPause) return;
      }
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]);
      if ((index + 1) % 10 === 0 || index + 1 === items.length) {
        console.log(JSON.stringify({ phase, processedBatch: index + 1, batchSize: items.length, at: new Date().toISOString() }));
      }
    }
  });
  await Promise.all(workers);
}

async function startThrottle(intervalMs) {
  const run = throttleChain.then(async () => {
    const waitMs = Math.max(0, nextAllowedAt - Date.now());
    if (waitMs) await sleep(waitMs);
    nextAllowedAt = Date.now() + intervalMs;
  });
  throttleChain = run.catch(() => {});
  await run;
}

async function appendRecord(record) {
  appendChain = appendChain.then(() => fs.appendFile(rawPath, `${JSON.stringify(record)}\n`, 'utf8'));
  await appendChain;
}

async function writeProgress(value) {
  const progress = { ...value, updatedAt: new Date().toISOString() };
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

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}
