import type { PoolClient } from 'pg';
import { id } from './util.js';

export type CreditLotSource =
  | 'WELCOME'
  | 'SUBSCRIPTION'
  | 'CREDIT_PACK'
  | 'ADMIN_GRANT'
  | 'ADMIN_REFUND'
  | 'MIGRATED_BALANCE';

export type FifoLot = {
  id: string;
  availableCredits: number;
};

export function planFifoAllocations(lots: FifoLot[], amountCredits: number) {
  let remaining = Math.max(0, Math.round(amountCredits));
  const allocations: Array<{ lotId: string; amountCredits: number }> = [];
  for (const lot of lots) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.round(lot.availableCredits));
    if (available === 0) continue;
    const amount = Math.min(available, remaining);
    allocations.push({ lotId: lot.id, amountCredits: amount });
    remaining -= amount;
  }
  return {
    allocations,
    allocatedCredits: Math.max(0, Math.round(amountCredits)) - remaining,
    unallocatedCredits: remaining,
  };
}

export async function createCreditLot(
  client: PoolClient,
  input: {
    investorId: string;
    accountId: string;
    sourceType: CreditLotSource;
    grantedCredits: number;
    balanceBeforeCredits: number;
    idempotencyKey: string;
    paymentId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const grantedCredits = Math.max(0, Math.round(input.grantedCredits));
  const debtRecoveredCredits = Math.min(grantedCredits, Math.max(0, -Math.round(input.balanceBeforeCredits)));
  const status = debtRecoveredCredits >= grantedCredits ? 'EXHAUSTED' : 'ACTIVE';
  const lotId = id('credit_lot');
  const result = await client.query(
    [
      'insert into credit_lots',
      '("id", "sourceType", status, "grantedCredits", "consumedCredits", "reversedCredits",',
      '"idempotencyKey", metadata, "createdAt", "updatedAt", "investorId", "accountId", "paymentId")',
      'values ($1, $2, $3, $4, $5, 0, $6, $7::jsonb, now(), now(), $8, $9, $10)',
      'on conflict ("idempotencyKey") do update set "updatedAt" = credit_lots."updatedAt"',
      'returning id, "sourceType", status, "grantedCredits", "consumedCredits",',
      '"reversedCredits", "paymentId", "createdAt"',
    ].join(' '),
    [
      lotId,
      input.sourceType,
      status,
      grantedCredits,
      debtRecoveredCredits,
      input.idempotencyKey,
      JSON.stringify({
        ...(input.metadata || {}),
        debtRecoveredCredits,
      }),
      input.investorId,
      input.accountId,
      input.paymentId || null,
    ],
  );
  return normalizeLot(result.rows[0]);
}

export async function consumeCreditLotsFifo(
  client: PoolClient,
  input: {
    investorId: string;
    accountId: string;
    amountCredits: number;
    debitKey: string;
    runId?: string | null;
    threadId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const amountCredits = Math.max(0, Math.round(input.amountCredits));
  if (amountCredits === 0) {
    return { allocations: [], allocatedCredits: 0, unallocatedCredits: 0 };
  }
  await client.query(
    'select pg_advisory_xact_lock(hashtext($1), hashtext($2))',
    [input.accountId, input.debitKey],
  );
  const existing = await client.query(
    [
      'select "lotId", "amountCredits" from credit_lot_allocations',
      'where "accountId" = $1 and "debitKey" = $2 order by "createdAt" asc, id asc',
    ].join(' '),
    [input.accountId, input.debitKey],
  );
  if (existing.rows.length > 0) {
    const allocations = existing.rows.map((row) => ({
      lotId: String(row.lotId),
      amountCredits: numberValue(row.amountCredits),
    }));
    const allocatedCredits = allocations.reduce((total, allocation) => (
      total + allocation.amountCredits
    ), 0);
    return {
      allocations,
      allocatedCredits,
      unallocatedCredits: Math.max(0, amountCredits - allocatedCredits),
    };
  }
  const selected = await client.query(
    [
      'select id, greatest(0, "grantedCredits" - "consumedCredits" - "reversedCredits") as available',
      'from credit_lots where "accountId" = $1 and status = $2',
      'and "grantedCredits" > "consumedCredits" + "reversedCredits"',
      'order by "createdAt" asc, id asc for update',
    ].join(' '),
    [input.accountId, 'ACTIVE'],
  );
  const planned = planFifoAllocations(
    selected.rows.map((row) => ({
      id: String(row.id),
      availableCredits: numberValue(row.available),
    })),
    amountCredits,
  );
  for (const allocation of planned.allocations) {
    await client.query(
      [
        'update credit_lots set "consumedCredits" = "consumedCredits" + $2,',
        "status = case when \"grantedCredits\" <= \"consumedCredits\" + \"reversedCredits\" + $2",
        "then 'EXHAUSTED' else status end, \"updatedAt\" = now() where id = $1",
      ].join(' '),
      [allocation.lotId, allocation.amountCredits],
    );
    await client.query(
      [
        'insert into credit_lot_allocations',
        '("id", "debitKey", "amountCredits", "runId", "threadId", metadata, "createdAt",',
        '"investorId", "accountId", "lotId")',
        'values ($1, $2, $3, $4, $5, $6::jsonb, now(), $7, $8, $9)',
        'on conflict ("lotId", "debitKey") do nothing',
      ].join(' '),
      [
        id('credit_lot_allocation'),
        input.debitKey,
        allocation.amountCredits,
        input.runId || null,
        input.threadId || null,
        JSON.stringify(input.metadata || {}),
        input.investorId,
        input.accountId,
        allocation.lotId,
      ],
    );
  }
  return planned;
}

export async function getPaymentCreditLot(
  client: PoolClient,
  paymentId: string,
  investorId: string,
  lock = false,
) {
  const result = await client.query(
    [
      'select id, "sourceType", status, "grantedCredits", "consumedCredits",',
      '"reversedCredits", "paymentId", "createdAt" from credit_lots',
      'where "paymentId" = $1 and "investorId" = $2',
      lock ? 'for update' : '',
    ].filter(Boolean).join(' '),
    [paymentId, investorId],
  );
  return result.rows[0] ? normalizeLot(result.rows[0]) : null;
}

export async function reverseRemainingCreditLot(
  client: PoolClient,
  input: { paymentId: string; investorId: string },
) {
  const lot = await getPaymentCreditLot(client, input.paymentId, input.investorId, true);
  if (!lot) return null;
  const remainingCredits = Math.max(
    0,
    lot.grantedCredits - lot.consumedCredits - lot.reversedCredits,
  );
  if (remainingCredits > 0) {
    await client.query(
      [
        'update credit_lots set "reversedCredits" = "reversedCredits" + $2,',
        "status = 'REVERSED', \"updatedAt\" = now() where id = $1",
      ].join(' '),
      [lot.id, remainingCredits],
    );
  }
  return { ...lot, remainingCredits };
}

function normalizeLot(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    sourceType: String(row.sourceType || ''),
    status: String(row.status || ''),
    grantedCredits: numberValue(row.grantedCredits),
    consumedCredits: numberValue(row.consumedCredits),
    reversedCredits: numberValue(row.reversedCredits),
    paymentId: typeof row.paymentId === 'string' ? row.paymentId : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
  };
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}
