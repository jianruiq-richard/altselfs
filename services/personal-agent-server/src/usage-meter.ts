import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ServerConfig } from './config.js';
import { isRecord } from './util.js';

const execFileAsync = promisify(execFile);
export const AGENT_PRICING_VERSION = '2026-07-v3';

type HermesCostSource = 'provider_actual' | 'provider_estimated' | 'local_pricing' | 'unavailable';
type CacheWriteTierSource = 'provider_detail' | 'apiyi_channel_fallback_5m' | 'none';

type HermesPricingSnapshot = {
  source: 'apiyi-claude-sonnet-4-6';
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWrite5mUsdPerMillion: number;
  cacheWrite1hUsdPerMillion: number;
  multiplier: number;
};

export type HermesUsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
  cacheWriteUnclassifiedTokens: number;
  cacheWriteTierSource: CacheWriteTierSource;
  reasoningTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  apiCallCount: number;
};

export type CodexUsageSnapshot = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  modelCallCount: number;
};

export type AgentRunUsage = {
  version: 'v2';
  pricingVersion: string;
  component: 'agent_task' | 'memory_review';
  sourceRunId: string;
  memoryReviewJobId?: string;
  taskLabel?: string;
  hermes: HermesUsageSnapshot & {
    model: string;
    provider: string;
    billedCostUsd: number;
    locallyEstimatedCostUsd: number;
    costSource: HermesCostSource;
    pricing: HermesPricingSnapshot | null;
    credits: number;
  };
  codex: CodexUsageSnapshot & {
    model: string;
    openAiUsageCredits: number;
    credits: number;
  };
  totalCredits: number;
};

const EMPTY_HERMES_USAGE: HermesUsageSnapshot = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  cacheWriteUnclassifiedTokens: 0,
  cacheWriteTierSource: 'none',
  reasoningTokens: 0,
  estimatedCostUsd: 0,
  actualCostUsd: 0,
  apiCallCount: 0,
};

const EMPTY_CODEX_USAGE: CodexUsageSnapshot = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  modelCallCount: 0,
};

export async function readHermesUsageSnapshot(
  hermesHome: string,
  sessionId: string | null | undefined,
): Promise<HermesUsageSnapshot> {
  if (!sessionId) return { ...EMPTY_HERMES_USAGE };
  const stateDb = path.join(hermesHome, 'state.db');
  try {
    await fs.access(stateDb);
    const script = [
      'import json, sqlite3, sys',
      'db, session_id = sys.argv[1], sys.argv[2]',
      'conn = sqlite3.connect(db)',
      'conn.row_factory = sqlite3.Row',
      'row = conn.execute("""',
      'SELECT input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,',
      'reasoning_tokens, estimated_cost_usd, actual_cost_usd, api_call_count',
      'FROM sessions WHERE id = ?',
      '""", (session_id,)).fetchone()',
      'print(json.dumps(dict(row) if row else {}))',
    ].join('\n');
    const { stdout } = await execFileAsync('python3', ['-c', script, stateDb, sessionId], {
      timeout: 10_000,
      maxBuffer: 64 * 1024,
    });
    const row = JSON.parse(stdout.trim() || '{}') as Record<string, unknown>;
    return {
      inputTokens: numberValue(row.input_tokens),
      outputTokens: numberValue(row.output_tokens),
      cacheReadTokens: numberValue(row.cache_read_tokens),
      cacheWriteTokens: numberValue(row.cache_write_tokens),
      cacheWrite5mTokens: 0,
      cacheWrite1hTokens: 0,
      cacheWriteUnclassifiedTokens: numberValue(row.cache_write_tokens),
      cacheWriteTierSource: numberValue(row.cache_write_tokens) > 0 ? 'apiyi_channel_fallback_5m' : 'none',
      reasoningTokens: numberValue(row.reasoning_tokens),
      estimatedCostUsd: numberValue(row.estimated_cost_usd),
      actualCostUsd: numberValue(row.actual_cost_usd),
      apiCallCount: numberValue(row.api_call_count),
    };
  } catch {
    return { ...EMPTY_HERMES_USAGE };
  }
}

export async function readCodexUsageSince(codexHome: string, startedAtMs: number): Promise<CodexUsageSnapshot> {
  const files = await findRecentJsonlFiles(path.join(codexHome, 'sessions'), startedAtMs);
  const usage = { ...EMPTY_CODEX_USAGE };

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    let previousTotal: CodexUsageSnapshot | null = null;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(event) || eventTimestampMs(event) < startedAtMs - 10_000) continue;
      const payload = isRecord(event.payload) ? event.payload : null;
      if (!payload || payload.type !== 'token_count' || !isRecord(payload.info)) continue;

      const last = normalizeCodexUsage(payload.info.last_token_usage);
      if (last && hasUsage(last)) {
        addCodexUsage(usage, last);
        usage.modelCallCount += 1;
        continue;
      }

      const total = normalizeCodexUsage(payload.info.total_token_usage);
      if (!total) continue;
      if (previousTotal) {
        addCodexUsage(usage, subtractCodexUsage(total, previousTotal));
        usage.modelCallCount += 1;
      }
      previousTotal = total;
    }
  }
  return usage;
}

export async function buildAgentRunUsage(input: {
  config: ServerConfig;
  runId: string;
  taskLabel?: string;
  hermesHome: string;
  hermesUsageLogPath?: string;
  hermesSessionId: string | null | undefined;
  hermesBefore: HermesUsageSnapshot;
  hermesModel: string;
  hermesProvider: string;
  codexHome: string;
  codexModel: string;
  startedAtMs: number;
}): Promise<AgentRunUsage> {
  const [hermesAfter, detailedHermes, codex] = await Promise.all([
    readHermesUsageSnapshot(input.hermesHome, input.hermesSessionId),
    readHermesUsageLog(input.hermesUsageLogPath),
    readCodexUsageSince(input.codexHome, input.startedAtMs),
  ]);
  const stateDelta = subtractHermesUsage(hermesAfter, input.hermesBefore);
  const hermes = detailedHermes.apiCallCount > 0
    ? {
        ...detailedHermes,
        estimatedCostUsd: stateDelta.estimatedCostUsd,
        actualCostUsd: stateDelta.actualCostUsd,
      }
    : classifyUnspecifiedApiyiCacheWrites(stateDelta, input.hermesProvider);
  const pricedHermes = priceHermesUsage(
    input.config,
    hermes,
    input.hermesModel,
    input.hermesProvider,
  );
  const uncachedInputTokens = Math.max(0, codex.inputTokens - codex.cachedInputTokens);
  const openAiUsageCredits = (
    (uncachedInputTokens / 1_000_000) * input.config.codexUsageUncachedInputRate +
    (codex.cachedInputTokens / 1_000_000) * input.config.codexUsageCachedInputRate +
    (codex.outputTokens / 1_000_000) * input.config.codexUsageOutputRate
  );
  const codexCredits = Math.ceil(openAiUsageCredits * input.config.codexUsageCreditMultiplier);

  return {
    version: 'v2',
    pricingVersion: AGENT_PRICING_VERSION,
    component: 'agent_task',
    sourceRunId: input.runId,
    taskLabel: normalizeTaskLabel(input.taskLabel),
    hermes: pricedHermes,
    codex: {
      ...codex,
      model: input.codexModel,
      openAiUsageCredits,
      credits: codexCredits,
    },
    totalCredits: Math.max(
      input.config.creditsMinimumRunCharge,
      pricedHermes.credits + codexCredits,
    ),
  };
}

export function buildMemoryReviewUsage(input: {
  config: ServerConfig;
  sourceRunId: string;
  memoryReviewJobId: string;
  taskLabel?: string;
  hermesModel: string;
  hermesProvider: string;
  rawCompletion: unknown;
}): AgentRunUsage {
  const hermes = normalizeRawHermesUsage(input.rawCompletion, input.hermesProvider);
  const pricedHermes = priceHermesUsage(
    input.config,
    hermes,
    input.hermesModel,
    input.hermesProvider,
  );
  return {
    version: 'v2',
    pricingVersion: AGENT_PRICING_VERSION,
    component: 'memory_review',
    sourceRunId: input.sourceRunId,
    memoryReviewJobId: input.memoryReviewJobId,
    taskLabel: normalizeTaskLabel(input.taskLabel),
    hermes: pricedHermes,
    codex: {
      ...EMPTY_CODEX_USAGE,
      model: '',
      openAiUsageCredits: 0,
      credits: 0,
    },
    totalCredits: pricedHermes.credits,
  };
}

function priceHermesUsage(
  config: ServerConfig,
  usage: HermesUsageSnapshot,
  model: string,
  provider: string,
): AgentRunUsage['hermes'] {
  const pricing = resolveHermesPricing(config, provider, model);
  const locallyEstimatedCostUsd = pricing ? calculateHermesCostUsd(usage, pricing) : 0;
  const billedCostUsd = usage.actualCostUsd > 0
    ? usage.actualCostUsd
    : locallyEstimatedCostUsd > 0
      ? locallyEstimatedCostUsd
      : usage.estimatedCostUsd;
  const costSource = resolveHermesCostSource(usage, locallyEstimatedCostUsd);
  return {
    ...usage,
    model,
    provider,
    billedCostUsd,
    locallyEstimatedCostUsd,
    costSource,
    pricing,
    credits: Math.ceil(billedCostUsd * config.creditsPerUsd * config.creditsCostMarkup),
  };
}

function resolveHermesPricing(
  config: ServerConfig,
  provider: string,
  model: string,
): HermesPricingSnapshot | null {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = model.trim().toLowerCase().replace(/[._]/g, '-');
  if (
    normalizedProvider !== 'apiyi' ||
    !['claude-sonnet-4-6', 'sonnet-4-6'].includes(normalizedModel)
  ) {
    return null;
  }
  return {
    source: 'apiyi-claude-sonnet-4-6',
    inputUsdPerMillion: nonNegativeNumber(config.hermesApiyiInputRate),
    outputUsdPerMillion: nonNegativeNumber(config.hermesApiyiOutputRate),
    cacheReadUsdPerMillion: nonNegativeNumber(config.hermesApiyiCacheReadRate),
    cacheWrite5mUsdPerMillion: nonNegativeNumber(config.hermesApiyiCacheWrite5mRate),
    cacheWrite1hUsdPerMillion: nonNegativeNumber(config.hermesApiyiCacheWrite1hRate),
    multiplier: nonNegativeNumber(config.hermesApiyiCostMultiplier),
  };
}

function calculateHermesCostUsd(
  usage: HermesUsageSnapshot,
  pricing: HermesPricingSnapshot,
) {
  const cost = (
    usage.inputTokens * pricing.inputUsdPerMillion +
    usage.outputTokens * pricing.outputUsdPerMillion +
    usage.cacheReadTokens * pricing.cacheReadUsdPerMillion +
    usage.cacheWrite5mTokens * pricing.cacheWrite5mUsdPerMillion +
    usage.cacheWrite1hTokens * pricing.cacheWrite1hUsdPerMillion
  ) / 1_000_000;
  return cost * pricing.multiplier;
}

function resolveHermesCostSource(
  usage: HermesUsageSnapshot,
  locallyEstimatedCostUsd: number,
): HermesCostSource {
  if (usage.actualCostUsd > 0) return 'provider_actual';
  if (locallyEstimatedCostUsd > 0) return 'local_pricing';
  if (usage.estimatedCostUsd > 0) return 'provider_estimated';
  return 'unavailable';
}

function subtractHermesUsage(after: HermesUsageSnapshot, before: HermesUsageSnapshot): HermesUsageSnapshot {
  return {
    inputTokens: positiveDelta(after.inputTokens, before.inputTokens),
    outputTokens: positiveDelta(after.outputTokens, before.outputTokens),
    cacheReadTokens: positiveDelta(after.cacheReadTokens, before.cacheReadTokens),
    cacheWriteTokens: positiveDelta(after.cacheWriteTokens, before.cacheWriteTokens),
    cacheWrite5mTokens: positiveDelta(after.cacheWrite5mTokens, before.cacheWrite5mTokens),
    cacheWrite1hTokens: positiveDelta(after.cacheWrite1hTokens, before.cacheWrite1hTokens),
    cacheWriteUnclassifiedTokens: positiveDelta(
      after.cacheWriteUnclassifiedTokens,
      before.cacheWriteUnclassifiedTokens,
    ),
    cacheWriteTierSource: after.cacheWriteTierSource,
    reasoningTokens: positiveDelta(after.reasoningTokens, before.reasoningTokens),
    estimatedCostUsd: positiveDelta(after.estimatedCostUsd, before.estimatedCostUsd),
    actualCostUsd: positiveDelta(after.actualCostUsd, before.actualCostUsd),
    apiCallCount: positiveDelta(after.apiCallCount, before.apiCallCount),
  };
}

async function readHermesUsageLog(logPath: string | undefined): Promise<HermesUsageSnapshot> {
  if (!logPath) return { ...EMPTY_HERMES_USAGE };
  const text = await fs.readFile(logPath, 'utf8').catch(() => '');
  const total = { ...EMPTY_HERMES_USAGE };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(record)) continue;
    const normalized = normalizeHermesUsageRecord(record);
    addHermesUsage(total, normalized);
  }
  return total;
}

function normalizeRawHermesUsage(rawCompletion: unknown, provider: string): HermesUsageSnapshot {
  if (!isRecord(rawCompletion)) return { ...EMPTY_HERMES_USAGE };
  const usage = isRecord(rawCompletion.usage) ? rawCompletion.usage : {};
  const normalizedProvider = provider.trim().toLowerCase();
  if (normalizedProvider === 'apiyi') {
    const cacheCreation = isRecord(usage.cache_creation) ? usage.cache_creation : {};
    const cacheWrite5mTokens = numberValue(cacheCreation.ephemeral_5m_input_tokens);
    const cacheWrite1hTokens = numberValue(cacheCreation.ephemeral_1h_input_tokens);
    const cacheWriteTokens = Math.max(
      numberValue(usage.cache_creation_input_tokens),
      cacheWrite5mTokens + cacheWrite1hTokens,
    );
    return classifyUnspecifiedApiyiCacheWrites({
      ...EMPTY_HERMES_USAGE,
      inputTokens: numberValue(usage.input_tokens),
      outputTokens: numberValue(usage.output_tokens),
      cacheReadTokens: numberValue(usage.cache_read_input_tokens),
      cacheWriteTokens,
      cacheWrite5mTokens,
      cacheWrite1hTokens,
      cacheWriteUnclassifiedTokens: Math.max(0, cacheWriteTokens - cacheWrite5mTokens - cacheWrite1hTokens),
      cacheWriteTierSource: cacheWrite5mTokens + cacheWrite1hTokens > 0 ? 'provider_detail' : 'none',
      actualCostUsd: extractProviderCostUsd(rawCompletion, usage),
      apiCallCount: 1,
    }, provider);
  }

  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const promptTokens = numberValue(usage.prompt_tokens);
  const cacheReadTokens = numberValue(promptDetails.cached_tokens)
    || numberValue(usage.cache_read_input_tokens);
  const cacheWriteTokens = numberValue(promptDetails.cache_write_tokens)
    || numberValue(usage.cache_creation_input_tokens);
  return {
    ...EMPTY_HERMES_USAGE,
    inputTokens: Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens),
    outputTokens: numberValue(usage.completion_tokens),
    cacheReadTokens,
    cacheWriteTokens,
    cacheWriteUnclassifiedTokens: cacheWriteTokens,
    actualCostUsd: extractProviderCostUsd(rawCompletion, usage),
    apiCallCount: 1,
  };
}

function normalizeHermesUsageRecord(record: Record<string, unknown>): HermesUsageSnapshot {
  const cacheWrite5mTokens = numberValue(record.cache_write_5m_tokens);
  const cacheWrite1hTokens = numberValue(record.cache_write_1h_tokens);
  const cacheWriteTokens = Math.max(
    numberValue(record.cache_write_tokens),
    cacheWrite5mTokens + cacheWrite1hTokens,
  );
  return classifyUnspecifiedApiyiCacheWrites({
    ...EMPTY_HERMES_USAGE,
    inputTokens: numberValue(record.input_tokens),
    outputTokens: numberValue(record.output_tokens),
    cacheReadTokens: numberValue(record.cache_read_tokens),
    cacheWriteTokens,
    cacheWrite5mTokens,
    cacheWrite1hTokens,
    cacheWriteUnclassifiedTokens: Math.max(0, cacheWriteTokens - cacheWrite5mTokens - cacheWrite1hTokens),
    cacheWriteTierSource: cacheWrite5mTokens + cacheWrite1hTokens > 0 ? 'provider_detail' : 'none',
    reasoningTokens: numberValue(record.reasoning_tokens),
    estimatedCostUsd: numberValue(record.estimated_cost_usd),
    actualCostUsd: numberValue(record.actual_cost_usd),
    apiCallCount: 1,
  }, String(record.provider || ''));
}

function classifyUnspecifiedApiyiCacheWrites(
  usage: HermesUsageSnapshot,
  provider: string,
): HermesUsageSnapshot {
  const classified = usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  const unclassified = Math.max(usage.cacheWriteUnclassifiedTokens, usage.cacheWriteTokens - classified);
  if (unclassified <= 0 || provider.trim().toLowerCase() !== 'apiyi') {
    return {
      ...usage,
      cacheWriteUnclassifiedTokens: unclassified,
      cacheWriteTierSource: classified > 0 ? 'provider_detail' : 'none',
    };
  }
  return {
    ...usage,
    cacheWrite5mTokens: usage.cacheWrite5mTokens + unclassified,
    cacheWriteUnclassifiedTokens: 0,
    cacheWriteTierSource: classified > 0 ? 'provider_detail' : 'apiyi_channel_fallback_5m',
  };
}

function addHermesUsage(target: HermesUsageSnapshot, value: HermesUsageSnapshot) {
  target.inputTokens += value.inputTokens;
  target.outputTokens += value.outputTokens;
  target.cacheReadTokens += value.cacheReadTokens;
  target.cacheWriteTokens += value.cacheWriteTokens;
  target.cacheWrite5mTokens += value.cacheWrite5mTokens;
  target.cacheWrite1hTokens += value.cacheWrite1hTokens;
  target.cacheWriteUnclassifiedTokens += value.cacheWriteUnclassifiedTokens;
  target.reasoningTokens += value.reasoningTokens;
  target.estimatedCostUsd += value.estimatedCostUsd;
  target.actualCostUsd += value.actualCostUsd;
  target.apiCallCount += value.apiCallCount;
  if (value.cacheWriteTierSource === 'provider_detail') {
    target.cacheWriteTierSource = 'provider_detail';
  } else if (target.cacheWriteTierSource === 'none') {
    target.cacheWriteTierSource = value.cacheWriteTierSource;
  }
}

function extractProviderCostUsd(
  rawCompletion: Record<string, unknown>,
  usage: Record<string, unknown>,
) {
  const candidates = [
    usage.cost,
    usage.total_cost,
    usage.actual_cost_usd,
    rawCompletion.cost,
    rawCompletion.total_cost,
    rawCompletion.actual_cost_usd,
  ];
  for (const candidate of candidates) {
    const value = nonNegativeNumber(candidate);
    if (value > 0) return value;
  }
  return 0;
}

function normalizeTaskLabel(value: string | undefined) {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 160) : undefined;
}

async function findRecentJsonlFiles(root: string, startedAtMs: number) {
  const files: string[] = [];
  async function visit(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return visit(target);
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
      const stat = await fs.stat(target).catch(() => null);
      if (stat && stat.mtimeMs >= startedAtMs - 10_000) files.push(target);
    }));
  }
  await visit(root);
  return files;
}

function normalizeCodexUsage(value: unknown): CodexUsageSnapshot | null {
  if (!isRecord(value)) return null;
  return {
    inputTokens: numberValue(value.input_tokens),
    cachedInputTokens: numberValue(value.cached_input_tokens),
    outputTokens: numberValue(value.output_tokens),
    reasoningOutputTokens: numberValue(value.reasoning_output_tokens),
    modelCallCount: 0,
  };
}

function subtractCodexUsage(after: CodexUsageSnapshot, before: CodexUsageSnapshot): CodexUsageSnapshot {
  return {
    inputTokens: positiveDelta(after.inputTokens, before.inputTokens),
    cachedInputTokens: positiveDelta(after.cachedInputTokens, before.cachedInputTokens),
    outputTokens: positiveDelta(after.outputTokens, before.outputTokens),
    reasoningOutputTokens: positiveDelta(after.reasoningOutputTokens, before.reasoningOutputTokens),
    modelCallCount: 0,
  };
}

function addCodexUsage(target: CodexUsageSnapshot, value: CodexUsageSnapshot) {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
}

function hasUsage(value: CodexUsageSnapshot) {
  return value.inputTokens > 0 || value.outputTokens > 0 || value.cachedInputTokens > 0;
}

function eventTimestampMs(event: Record<string, unknown>) {
  const value = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN;
  return Number.isFinite(value) ? value : 0;
}

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function nonNegativeNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function positiveDelta(after: number, before: number) {
  return Math.max(0, after - before);
}
