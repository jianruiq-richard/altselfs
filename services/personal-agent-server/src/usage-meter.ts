import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ServerConfig } from './config.js';
import { isRecord } from './util.js';

const execFileAsync = promisify(execFile);
const PRICING_VERSION = '2026-07-v2';

type HermesCostSource = 'provider_actual' | 'provider_estimated' | 'local_pricing' | 'unavailable';

type HermesPricingSnapshot = {
  source: 'apiyi-claude-sonnet-4-6';
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number;
  multiplier: number;
};

export type HermesUsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
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
  version: 'v1';
  pricingVersion: string;
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
  hermesHome: string;
  hermesSessionId: string | null | undefined;
  hermesBefore: HermesUsageSnapshot;
  hermesModel: string;
  hermesProvider: string;
  codexHome: string;
  codexModel: string;
  startedAtMs: number;
}): Promise<AgentRunUsage> {
  const [hermesAfter, codex] = await Promise.all([
    readHermesUsageSnapshot(input.hermesHome, input.hermesSessionId),
    readCodexUsageSince(input.codexHome, input.startedAtMs),
  ]);
  const hermes = subtractHermesUsage(hermesAfter, input.hermesBefore);
  const pricing = resolveHermesPricing(input.config, input.hermesProvider, input.hermesModel);
  const locallyEstimatedCostUsd = pricing
    ? calculateHermesCostUsd(hermes, pricing)
    : 0;
  const providerReportedCostUsd = hermes.actualCostUsd > 0
    ? hermes.actualCostUsd
    : hermes.estimatedCostUsd;
  const billedCostUsd = providerReportedCostUsd > 0
    ? providerReportedCostUsd
    : locallyEstimatedCostUsd;
  const costSource = resolveHermesCostSource(hermes, locallyEstimatedCostUsd);
  const hermesCredits = Math.ceil(
    billedCostUsd * input.config.creditsPerUsd * input.config.creditsCostMarkup,
  );
  const uncachedInputTokens = Math.max(0, codex.inputTokens - codex.cachedInputTokens);
  const openAiUsageCredits = (
    (uncachedInputTokens / 1_000_000) * input.config.codexUsageUncachedInputRate +
    (codex.cachedInputTokens / 1_000_000) * input.config.codexUsageCachedInputRate +
    (codex.outputTokens / 1_000_000) * input.config.codexUsageOutputRate
  );
  const codexCredits = Math.ceil(openAiUsageCredits * input.config.codexUsageCreditMultiplier);
  const totalCredits = Math.max(
    input.config.creditsMinimumRunCharge,
    hermesCredits + codexCredits,
  );

  return {
    version: 'v1',
    pricingVersion: PRICING_VERSION,
    hermes: {
      ...hermes,
      model: input.hermesModel,
      provider: input.hermesProvider,
      billedCostUsd,
      locallyEstimatedCostUsd,
      costSource,
      pricing,
      credits: hermesCredits,
    },
    codex: {
      ...codex,
      model: input.codexModel,
      openAiUsageCredits,
      credits: codexCredits,
    },
    totalCredits,
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
    cacheWriteUsdPerMillion: nonNegativeNumber(config.hermesApiyiCacheWriteRate),
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
    usage.cacheWriteTokens * pricing.cacheWriteUsdPerMillion
  ) / 1_000_000;
  return cost * pricing.multiplier;
}

function resolveHermesCostSource(
  usage: HermesUsageSnapshot,
  locallyEstimatedCostUsd: number,
): HermesCostSource {
  if (usage.actualCostUsd > 0) return 'provider_actual';
  if (usage.estimatedCostUsd > 0) return 'provider_estimated';
  if (locallyEstimatedCostUsd > 0) return 'local_pricing';
  return 'unavailable';
}

function subtractHermesUsage(after: HermesUsageSnapshot, before: HermesUsageSnapshot): HermesUsageSnapshot {
  return {
    inputTokens: positiveDelta(after.inputTokens, before.inputTokens),
    outputTokens: positiveDelta(after.outputTokens, before.outputTokens),
    cacheReadTokens: positiveDelta(after.cacheReadTokens, before.cacheReadTokens),
    cacheWriteTokens: positiveDelta(after.cacheWriteTokens, before.cacheWriteTokens),
    reasoningTokens: positiveDelta(after.reasoningTokens, before.reasoningTokens),
    estimatedCostUsd: positiveDelta(after.estimatedCostUsd, before.estimatedCostUsd),
    actualCostUsd: positiveDelta(after.actualCostUsd, before.actualCostUsd),
    apiCallCount: positiveDelta(after.apiCallCount, before.apiCallCount),
  };
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
