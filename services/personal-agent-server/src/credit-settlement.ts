import type { ServerConfig } from './config.js';
import { getBillingPool, runSerializableBillingTransaction } from './billing-database.js';
import type { AgentRunUsage } from './usage-meter.js';
import { isRecord } from './util.js';

type ReservationRow = {
  id: string;
  accountId: string;
  investorId: string;
  threadId: string | null;
  mode: string;
  status: string;
  reservedCredits: number;
  capturedCredits: number;
  shortfallCredits: number;
  balanceCredits: number;
  accountReservedCredits: number;
};

export async function settleRunCredits(
  config: ServerConfig,
  input: { runId: string; raw?: unknown },
) {
  const usage = extractAgentRunUsage(input.raw);
  if (!usage) return { settled: false, reason: 'usage_unavailable' };

  const pool = getBillingPool(config);
  if (!pool) return { settled: false, reason: 'database_unavailable' };
  return runSerializableBillingTransaction(config, async (client) => {
    const selected = await client.query(
      [
        'select r.id, r."accountId", r."investorId", r."threadId", r.mode,',
        'r."reservedCredits", a."balanceCredits", a."reservedCredits" as "accountReservedCredits"',
        'from credit_reservations r',
        'join credit_accounts a on a.id = r."accountId"',
        'where r."runId" = $1 and r.status = $2',
        'for update of r, a',
      ].join(' '),
      [input.runId, 'ACTIVE'],
    );
    const row = normalizeReservationRow(selected.rows[0]);
    if (!row) {
      return { settled: false, reason: 'reservation_not_active' };
    }

    const computedCredits = Math.max(0, Math.round(usage.totalCredits));
    const billedCredits = row.mode === 'ENFORCE'
      ? computedCredits
      : 0;
    const shortfallCredits = row.mode === 'ENFORCE'
      ? Math.max(0, computedCredits - Math.max(0, row.balanceCredits))
      : 0;
    const nextBalance = row.balanceCredits - billedCredits;
    const nextReserved = Math.max(0, row.accountReservedCredits - row.reservedCredits);
    const settledStatus = nextBalance < 0 ? 'OVERDRAWN' : 'CAPTURED';

    await client.query(
      [
        'update credit_accounts',
        'set "balanceCredits" = $2, "reservedCredits" = $3,',
        '"lifetimeSpentCredits" = "lifetimeSpentCredits" + $4, "updatedAt" = now()',
        'where id = $1',
      ].join(' '),
      [row.accountId, nextBalance, nextReserved, billedCredits],
    );
    await client.query(
      [
        'update credit_reservations',
        'set status = $2, "capturedCredits" = $3, "shortfallCredits" = $4,',
        '"settledAt" = now(), "updatedAt" = now()',
        'where id = $1',
      ].join(' '),
      [row.id, settledStatus, billedCredits, shortfallCredits],
    );
    await client.query(
      [
        'insert into agent_usage_records',
        '("id", "runId", status, "hermesModel", "codexModel", "hermesCostUsd",',
        '"hermesCredits", "codexCredits", "computedCredits", "billedCredits",',
        'usage, "pricingVersion", "createdAt", "updatedAt", "investorId", "accountId", "threadId")',
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, now(), now(), $13, $14, $15)',
        'on conflict ("runId") do nothing',
      ].join(' '),
      [
        `usage_${input.runId}`,
        input.runId,
        row.mode === 'ENFORCE' ? 'BILLED' : 'OBSERVED',
        usage.hermes.model,
        usage.codex.model,
        usage.hermes.billedCostUsd,
        usage.hermes.credits,
        usage.codex.credits,
        computedCredits,
        billedCredits,
        JSON.stringify(usage),
        usage.pricingVersion,
        row.investorId,
        row.accountId,
        row.threadId,
      ],
    );
    await client.query(
      [
        'insert into credit_ledger_entries',
        '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", "runId", "threadId", metadata,',
        '"createdAt", "investorId", "accountId", "reservationId")',
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now(), $12, $13, $14)',
        'on conflict ("idempotencyKey") do nothing',
      ].join(' '),
      [
        `capture_${input.runId}`,
        row.mode === 'ENFORCE' ? 'CAPTURE' : 'USAGE_RECORDED',
        -billedCredits,
        -row.reservedCredits,
        nextBalance,
        nextReserved,
        row.mode === 'ENFORCE' ? 'Agent task completed' : 'Agent task usage recorded',
        `capture:${input.runId}`,
        input.runId,
        row.threadId,
        JSON.stringify({
          computedCredits,
          billedCredits,
          shortfallCredits,
          hermesCredits: usage.hermes.credits,
          codexCredits: usage.codex.credits,
          pricingVersion: usage.pricingVersion,
          component: usage.component,
          sourceRunId: usage.sourceRunId,
          taskLabel: usage.taskLabel || null,
          mode: row.mode.toLowerCase(),
        }),
        row.investorId,
        row.accountId,
        row.id,
      ],
    );
    return { settled: true, computedCredits, billedCredits, shortfallCredits };
  });
}

export async function settleMemoryReviewCredits(
  config: ServerConfig,
  input: { jobId: string; sourceRunId: string; usage: AgentRunUsage },
) {
  if (
    input.usage.component !== 'memory_review' ||
    input.usage.sourceRunId !== input.sourceRunId ||
    input.usage.memoryReviewJobId !== input.jobId
  ) {
    return { settled: false as const, reason: 'invalid_memory_review_usage' };
  }

  const pool = getBillingPool(config);
  if (!pool) return { settled: false as const, reason: 'database_unavailable' };
  return runSerializableBillingTransaction(config, async (client) => {
    const selected = await client.query(
      [
        'select r.id, r."accountId", r."investorId", r."threadId", r.mode, r.status,',
        'r."reservedCredits", r."capturedCredits", r."shortfallCredits",',
        'a."balanceCredits", a."reservedCredits" as "accountReservedCredits"',
        'from credit_reservations r',
        'join credit_accounts a on a.id = r."accountId"',
        'where r."runId" = $1',
        'for update of r, a',
      ].join(' '),
      [input.sourceRunId],
    );
    const row = normalizeReservationRow(selected.rows[0]);
    if (!row) {
      return { settled: false as const, reason: 'reservation_not_found' };
    }

    const mainUsage = await client.query(
      'select id from agent_usage_records where "runId" = $1 limit 1',
      [input.sourceRunId],
    );
    if (!mainUsage.rows[0]) {
      return { settled: false as const, reason: 'task_settlement_pending' };
    }

    const idempotencyKey = `memory-review:${input.jobId}`;
    const existing = await client.query(
      [
        'select "amountCredits", metadata from credit_ledger_entries',
        'where "idempotencyKey" = $1 limit 1',
      ].join(' '),
      [idempotencyKey],
    );
    if (existing.rows[0]) {
      return {
        settled: true as const,
        computedCredits: Math.max(0, Math.round(input.usage.totalCredits)),
        billedCredits: Math.abs(Number(existing.rows[0].amountCredits) || 0),
        shortfallCredits: 0,
        mode: row.mode,
        existing: true,
      };
    }

    const computedCredits = Math.max(0, Math.round(input.usage.totalCredits));
    const billedCredits = row.mode === 'ENFORCE' ? computedCredits : 0;
    const shortfallCredits = row.mode === 'ENFORCE'
      ? Math.max(0, computedCredits - Math.max(0, row.balanceCredits))
      : 0;
    const nextBalance = row.balanceCredits - billedCredits;
    const usageRunId = `${input.sourceRunId}:memory-review:${input.jobId}`;

    await client.query(
      [
        'update credit_accounts',
        'set "balanceCredits" = $2,',
        '"lifetimeSpentCredits" = "lifetimeSpentCredits" + $3, "updatedAt" = now()',
        'where id = $1',
      ].join(' '),
      [row.accountId, nextBalance, billedCredits],
    );
    await client.query(
      [
        'update credit_reservations',
        'set "capturedCredits" = "capturedCredits" + $2,',
        '"shortfallCredits" = "shortfallCredits" + $3,',
        "status = case when $4 < 0 then 'OVERDRAWN' else status end,",
        '"updatedAt" = now()',
        'where id = $1',
      ].join(' '),
      [row.id, billedCredits, shortfallCredits, nextBalance],
    );
    await client.query(
      [
        'insert into agent_usage_records',
        '("id", "runId", status, "hermesModel", "codexModel", "hermesCostUsd",',
        '"hermesCredits", "codexCredits", "computedCredits", "billedCredits",',
        'usage, "pricingVersion", "createdAt", "updatedAt", "investorId", "accountId", "threadId")',
        'values ($1, $2, $3, $4, null, $5, $6, 0, $7, $8, $9::jsonb, $10, now(), now(), $11, $12, $13)',
        'on conflict ("runId") do nothing',
      ].join(' '),
      [
        `usage_memory_review_${input.jobId}`,
        usageRunId,
        row.mode === 'ENFORCE' ? 'BILLED' : 'OBSERVED',
        input.usage.hermes.model,
        input.usage.hermes.billedCostUsd,
        input.usage.hermes.credits,
        computedCredits,
        billedCredits,
        JSON.stringify(input.usage),
        input.usage.pricingVersion,
        row.investorId,
        row.accountId,
        row.threadId,
      ],
    );
    await client.query(
      [
        'insert into credit_ledger_entries',
        '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", "runId", "threadId", metadata,',
        '"createdAt", "investorId", "accountId", "reservationId")',
        'values ($1, $2, $3, 0, $4, $5, $6, $7, $8, $9, $10::jsonb, now(), $11, $12, $13)',
        'on conflict ("idempotencyKey") do nothing',
      ].join(' '),
      [
        `memory_review_${input.jobId}`,
        row.mode === 'ENFORCE' ? 'MEMORY_REVIEW_CAPTURE' : 'MEMORY_REVIEW_USAGE_RECORDED',
        -billedCredits,
        nextBalance,
        row.accountReservedCredits,
        row.mode === 'ENFORCE' ? 'Memory review completed' : 'Memory review usage recorded',
        idempotencyKey,
        input.sourceRunId,
        row.threadId,
        JSON.stringify({
          component: 'memory_review',
          sourceRunId: input.sourceRunId,
          memoryReviewJobId: input.jobId,
          taskLabel: input.usage.taskLabel || null,
          computedCredits,
          billedCredits,
          shortfallCredits,
          hermesCredits: input.usage.hermes.credits,
          pricingVersion: input.usage.pricingVersion,
          mode: row.mode.toLowerCase(),
        }),
        row.investorId,
        row.accountId,
        row.id,
      ],
    );
    return {
      settled: true as const,
      computedCredits,
      billedCredits,
      shortfallCredits,
      mode: row.mode,
      existing: false,
    };
  });
}

export async function releaseRunCredits(
  config: ServerConfig,
  input: { runId: string; reason: string },
) {
  const pool = getBillingPool(config);
  if (!pool) return { released: false, reason: 'database_unavailable' };
  return runSerializableBillingTransaction(config, async (client) => {
    const selected = await client.query(
      [
        'select r.id, r."accountId", r."investorId", r."threadId", r.mode,',
        'r."reservedCredits", a."balanceCredits", a."reservedCredits" as "accountReservedCredits"',
        'from credit_reservations r',
        'join credit_accounts a on a.id = r."accountId"',
        'where r."runId" = $1 and r.status = $2',
        'for update of r, a',
      ].join(' '),
      [input.runId, 'ACTIVE'],
    );
    const row = normalizeReservationRow(selected.rows[0]);
    if (!row) {
      return { released: false, reason: 'reservation_not_active' };
    }
    const nextReserved = Math.max(0, row.accountReservedCredits - row.reservedCredits);
    await client.query(
      'update credit_accounts set "reservedCredits" = $2, "updatedAt" = now() where id = $1',
      [row.accountId, nextReserved],
    );
    await client.query(
      [
        'update credit_reservations',
        'set status = $2, "settledAt" = now(), "updatedAt" = now()',
        'where id = $1',
      ].join(' '),
      [row.id, 'RELEASED'],
    );
    await client.query(
      [
        'insert into credit_ledger_entries',
        '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", "runId", "threadId", metadata,',
        '"createdAt", "investorId", "accountId", "reservationId")',
        'values ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(), $11, $12, $13)',
        'on conflict ("idempotencyKey") do nothing',
      ].join(' '),
      [
        `release_${input.runId}`,
        'RELEASE',
        -row.reservedCredits,
        row.balanceCredits,
        nextReserved,
        'Agent task reservation released',
        `release:${input.runId}`,
        input.runId,
        row.threadId,
        JSON.stringify({ reason: input.reason, mode: row.mode.toLowerCase() }),
        row.investorId,
        row.accountId,
        row.id,
      ],
    );
    return { released: true };
  });
}

function extractAgentRunUsage(raw: unknown): AgentRunUsage | null {
  if (!isRecord(raw) || !isRecord(raw.usage)) return null;
  const usage = raw.usage;
  if (!isRecord(usage.hermes) || !isRecord(usage.codex)) return null;
  const totalCredits = Number(usage.totalCredits);
  if (!Number.isFinite(totalCredits) || totalCredits < 0) return null;
  return usage as unknown as AgentRunUsage;
}

function normalizeReservationRow(value: Record<string, unknown> | undefined): ReservationRow | null {
  if (!value) return null;
  return {
    id: String(value.id || ''),
    accountId: String(value.accountId || ''),
    investorId: String(value.investorId || ''),
    threadId: typeof value.threadId === 'string' ? value.threadId : null,
    mode: String(value.mode || 'OBSERVE'),
    status: String(value.status || ''),
    reservedCredits: Math.max(0, Number(value.reservedCredits) || 0),
    capturedCredits: Math.max(0, Number(value.capturedCredits) || 0),
    shortfallCredits: Math.max(0, Number(value.shortfallCredits) || 0),
    balanceCredits: Number(value.balanceCredits) || 0,
    accountReservedCredits: Math.max(0, Number(value.accountReservedCredits) || 0),
  };
}
