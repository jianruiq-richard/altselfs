import type { PoolClient } from 'pg';
import type { ServerConfig } from './config.js';
import { runSerializableBillingTransaction } from './billing-database.js';
import { consumeCreditLotsFifo, createCreditLot } from './credit-lots.js';
import { AGENT_PRICING_VERSION } from './usage-meter.js';
import { id, isRecord } from './util.js';

const ADMIN_PLAN_LIMITS: Record<string, { name: string; concurrentTasks: number; monthlyCredits: number }> = {
  FREE: { name: 'Free', concurrentTasks: 1, monthlyCredits: 0 },
  STARTER: { name: 'Starter', concurrentTasks: 3, monthlyCredits: 20_000 },
  PRO: { name: 'Pro', concurrentTasks: 10, monthlyCredits: 40_000 },
  SCALE: { name: 'Ultra', concurrentTasks: 20, monthlyCredits: 200_000 },
};

const CREDIT_ACTIONS = new Set(['GRANT', 'DEDUCT', 'REFUND']);
const SUBSCRIPTION_STATUSES = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED']);
const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|secret|token|access[_-]?key|refresh[_-]?key|api[_-]?key/i;

type AccountRow = {
  id: string;
  balanceCredits: number;
  reservedCredits: number;
  lifetimeGrantedCredits: number;
  lifetimeSpentCredits: number;
  lifetimeRefundedCredits: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

type SubscriptionRow = {
  id: string;
  planKey: string;
  status: string;
  monthlyCredits: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanKey: string | null;
  graceEndsAt: Date | null;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerPriceId: string | null;
  latestInvoiceId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export class AdminBillingError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AdminBillingError';
  }
}

export async function getAdminBillingDetail(config: ServerConfig, investorId: string) {
  const normalizedInvestorId = normalizeRequiredString(investorId, 'investorId');
  return runSerializableBillingTransaction(config, async (client) => {
    await ensureUserExists(client, normalizedInvestorId);
    const account = await ensureAdminBillingAccount(config, client, normalizedInvestorId);
    const subscription = await getSubscription(client, normalizedInvestorId);
    const plan = planFor(subscription.planKey);
    const ledger = await client.query(
      [
        'select l.id, l.type, l."amountCredits", l."reservedDeltaCredits", l."balanceAfterCredits",',
        'l."reservedAfterCredits", l.description, l."idempotencyKey", l."runId", l."threadId",',
        'l.metadata, l."createdAt", t.title as "threadTitle"',
        'from credit_ledger_entries l',
        'left join agent_threads t on t.id = l."threadId"',
        'where l."investorId" = $1',
        'order by l."createdAt" desc, l.id desc limit 120',
      ].join(' '),
      [normalizedInvestorId],
    );
    const usage = await client.query(
      [
        'select u.id, u."runId", u.status, u."hermesModel", u."codexModel", u."hermesCostUsd",',
        'u."hermesCredits", u."codexCredits", u."computedCredits", u."billedCredits",',
        'u."pricingVersion", u.usage, u."threadId", u."createdAt", u."updatedAt", t.title as "threadTitle"',
        'from agent_usage_records u',
        'left join agent_threads t on t.id = u."threadId"',
        'where u."investorId" = $1',
        'order by u."createdAt" desc, u.id desc limit 120',
      ].join(' '),
      [normalizedInvestorId],
    );
    const reservations = await client.query(
      [
        'select r.id, r."runId", r.status, r.mode, r."hermesModel", r."estimatedCredits",',
        'r."reservedCredits", r."capturedCredits", r."shortfallCredits", r."threadId",',
        'r."expiresAt", r."settledAt", r."createdAt", r."updatedAt", t.title as "threadTitle"',
        'from credit_reservations r',
        'left join agent_threads t on t.id = r."threadId"',
        'where r."investorId" = $1',
        'order by r."createdAt" desc, r.id desc limit 80',
      ].join(' '),
      [normalizedInvestorId],
    );
    const payments = await client.query(
      [
        'select p.id, p.kind, p.status, p."planKey", p."packKey", p."creditsGranted", p."creditsReversed",',
        'p."amountSubtotalCents", p."amountTotalCents", p."refundedAmountCents", p.currency, p.provider,',
        'p."providerCheckoutSessionId", p."providerPaymentIntentId", p."providerInvoiceId",',
        'p."providerChargeId", p."lifetimeSpentCreditsAtGrant", p."paidAt", p."refundedAt", p.metadata,',
        'p."createdAt", p."updatedAt", coalesce(l."consumedCredits", 0) as "lotConsumedCredits",',
        'greatest(0, coalesce(l."grantedCredits" - l."consumedCredits" - l."reversedCredits", 0))',
        'as "lotRemainingCredits"',
        'from credit_payments p left join credit_lots l on l."paymentId" = p.id',
        'where p."investorId" = $1 order by p."createdAt" desc, p.id desc limit 120',
      ].join(' '),
      [normalizedInvestorId],
    );
    const availableCredits = Math.max(0, account.balanceCredits - account.reservedCredits);
    return {
      source: 'personal-agent-server',
      pricingVersion: AGENT_PRICING_VERSION,
      account: {
        id: account.id,
        balanceCredits: account.balanceCredits,
        reservedCredits: account.reservedCredits,
        availableCredits,
        lifetimeGrantedCredits: account.lifetimeGrantedCredits,
        lifetimeSpentCredits: account.lifetimeSpentCredits,
        lifetimeRefundedCredits: account.lifetimeRefundedCredits,
        createdAt: dateIsoOrNull(account.createdAt),
        updatedAt: dateIsoOrNull(account.updatedAt),
      },
      subscription: {
        id: subscription.id,
        planKey: subscription.planKey,
        planName: plan.name,
        status: subscription.status,
        monthlyCredits: subscription.monthlyCredits,
        concurrentTaskLimit: plan.concurrentTasks,
        currentPeriodStart: dateIsoOrNull(subscription.currentPeriodStart),
        currentPeriodEnd: dateIsoOrNull(subscription.currentPeriodEnd),
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        scheduledPlanKey: subscription.scheduledPlanKey,
        graceEndsAt: dateIsoOrNull(subscription.graceEndsAt),
        provider: subscription.provider,
        providerCustomerId: subscription.providerCustomerId,
        providerSubscriptionId: subscription.providerSubscriptionId,
        providerPriceId: subscription.providerPriceId,
        latestInvoiceId: subscription.latestInvoiceId,
        createdAt: dateIsoOrNull(subscription.createdAt),
        updatedAt: dateIsoOrNull(subscription.updatedAt),
      },
      ledger: ledger.rows.map(mapLedgerRow),
      usageRecords: usage.rows.map(mapUsageRow),
      reservations: reservations.rows.map(mapReservationRow),
      payments: payments.rows.map((row) => {
        const usedSinceGrant = Math.max(0, numberValue(row.lotConsumedCredits));
        return {
          id: String(row.id || ''),
          kind: String(row.kind || ''),
          status: String(row.status || ''),
          planKey: typeof row.planKey === 'string' ? row.planKey : null,
          packKey: typeof row.packKey === 'string' ? row.packKey : null,
          creditsGranted: numberValue(row.creditsGranted),
          creditsReversed: numberValue(row.creditsReversed),
          amountSubtotalCents: numberValue(row.amountSubtotalCents),
          amountTotalCents: numberValue(row.amountTotalCents),
          refundedAmountCents: numberValue(row.refundedAmountCents),
          currency: String(row.currency || 'usd'),
          provider: String(row.provider || 'stripe'),
          providerCheckoutSessionId: typeof row.providerCheckoutSessionId === 'string' ? row.providerCheckoutSessionId : null,
          providerPaymentIntentId: typeof row.providerPaymentIntentId === 'string' ? row.providerPaymentIntentId : null,
          providerInvoiceId: typeof row.providerInvoiceId === 'string' ? row.providerInvoiceId : null,
          providerChargeId: typeof row.providerChargeId === 'string' ? row.providerChargeId : null,
          lifetimeSpentCreditsAtGrant: numberValue(row.lifetimeSpentCreditsAtGrant),
          usedSinceGrant,
          lotRemainingCredits: Math.max(0, numberValue(row.lotRemainingCredits)),
          standardRefundEligible: (
            numberValue(row.creditsGranted) > numberValue(row.creditsReversed) &&
            usedSinceGrant <= config.stripeRefundUsageLimitCredits
          ),
          paidAt: dateIsoOrNull(row.paidAt),
          refundedAt: dateIsoOrNull(row.refundedAt),
          metadata: cleanJson(row.metadata),
          createdAt: dateIso(row.createdAt),
          updatedAt: dateIso(row.updatedAt),
        };
      }),
      refundPolicy: {
        contactEmail: config.stripeRefundContactEmail,
        usageLimitCredits: config.stripeRefundUsageLimitCredits,
        selfService: false,
      },
    };
  });
}

export async function adjustAdminBillingCredits(
  config: ServerConfig,
  input: {
    investorId: unknown;
    action: unknown;
    amountCredits: unknown;
    reason: unknown;
    admin: unknown;
  },
) {
  const investorId = normalizeRequiredString(input.investorId, 'investorId');
  const action = normalizeRequiredString(input.action, 'action').toUpperCase();
  if (!CREDIT_ACTIONS.has(action)) {
    throw new AdminBillingError(400, 'UNSUPPORTED_CREDIT_ACTION', 'Unsupported credit action.');
  }
  const amountCredits = normalizePositiveInteger(input.amountCredits, 'amountCredits');
  const reason = normalizeReason(input.reason);
  const admin = normalizeAdminActor(input.admin);
  const operationId = id('op');

  return runSerializableBillingTransaction(config, async (client) => {
    await ensureUserExists(client, investorId);
    const account = await ensureAdminBillingAccount(config, client, investorId);
    const delta = action === 'DEDUCT' ? -amountCredits : amountCredits;
    const nextBalanceCredits = account.balanceCredits + delta;
    const nextAvailableCredits = nextBalanceCredits - account.reservedCredits;
    if (action === 'DEDUCT' && nextAvailableCredits < 0) {
      throw new AdminBillingError(
        409,
        'INSUFFICIENT_AVAILABLE_CREDITS',
        'This deduction would make available credits negative.',
        {
          balanceCredits: account.balanceCredits,
          reservedCredits: account.reservedCredits,
          availableCredits: account.balanceCredits - account.reservedCredits,
        },
      );
    }

    const updatedResult = await client.query(
      [
        'update credit_accounts set',
        '"balanceCredits" = "balanceCredits" + $2,',
        '"lifetimeGrantedCredits" = "lifetimeGrantedCredits" + $3,',
        '"lifetimeSpentCredits" = "lifetimeSpentCredits" + $4,',
        '"lifetimeRefundedCredits" = "lifetimeRefundedCredits" + $5,',
        '"updatedAt" = now()',
        'where id = $1',
        'returning id, "balanceCredits", "reservedCredits", "lifetimeGrantedCredits",',
        '"lifetimeSpentCredits", "lifetimeRefundedCredits", "createdAt", "updatedAt"',
      ].join(' '),
      [
        account.id,
        delta,
        action === 'GRANT' ? amountCredits : 0,
        action === 'DEDUCT' ? amountCredits : 0,
        action === 'REFUND' ? amountCredits : 0,
      ],
    );
    const updated = accountRow(updatedResult.rows[0]);
    if (action === 'DEDUCT') {
      await consumeCreditLotsFifo(client, {
        investorId,
        accountId: account.id,
        amountCredits,
        debitKey: `admin:deduct:${operationId}`,
        metadata: { admin, reason, action },
      });
    } else {
      await createCreditLot(client, {
        investorId,
        accountId: account.id,
        sourceType: action === 'GRANT' ? 'ADMIN_GRANT' : 'ADMIN_REFUND',
        grantedCredits: amountCredits,
        balanceBeforeCredits: account.balanceCredits,
        idempotencyKey: `admin:${action.toLowerCase()}:${operationId}`,
        metadata: { admin, reason, action },
      });
    }
    const ledgerResult = await client.query(
      [
        'insert into credit_ledger_entries',
        '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", metadata, "createdAt", "investorId", "accountId")',
        'values ($1, $2, $3, 0, $4, $5, $6, $7, $8::jsonb, now(), $9, $10)',
        'returning id, type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", "runId", "threadId", metadata, "createdAt"',
      ].join(' '),
      [
        id('credit_ledger'),
        `ADMIN_${action}`,
        delta,
        updated.balanceCredits,
        updated.reservedCredits,
        reason,
        `admin:${action.toLowerCase()}:${investorId}:${operationId}`,
        JSON.stringify({
          admin,
          action,
          reason,
          pricingVersion: AGENT_PRICING_VERSION,
        }),
        investorId,
        updated.id,
      ],
    );

    return {
      ok: true,
      account: {
        id: updated.id,
        balanceCredits: updated.balanceCredits,
        reservedCredits: updated.reservedCredits,
        availableCredits: Math.max(0, updated.balanceCredits - updated.reservedCredits),
        lifetimeGrantedCredits: updated.lifetimeGrantedCredits,
        lifetimeSpentCredits: updated.lifetimeSpentCredits,
        lifetimeRefundedCredits: updated.lifetimeRefundedCredits,
        updatedAt: dateIsoOrNull(updated.updatedAt),
      },
      ledger: mapLedgerRow(ledgerResult.rows[0]),
    };
  });
}

export async function updateAdminBillingSubscription(
  config: ServerConfig,
  input: {
    investorId: unknown;
    planKey: unknown;
    status: unknown;
    monthlyCredits?: unknown;
    currentPeriodStart?: unknown;
    currentPeriodEnd?: unknown;
    provider?: unknown;
    providerCustomerId?: unknown;
    providerSubscriptionId?: unknown;
    reason?: unknown;
    admin: unknown;
  },
) {
  const investorId = normalizeRequiredString(input.investorId, 'investorId');
  const planKey = normalizeRequiredString(input.planKey, 'planKey').toUpperCase();
  const plan = planFor(planKey);
  if (!ADMIN_PLAN_LIMITS[planKey]) throw new AdminBillingError(400, 'UNSUPPORTED_PLAN', 'Unsupported plan.');
  const status = normalizeRequiredString(input.status, 'status').toUpperCase();
  if (!SUBSCRIPTION_STATUSES.has(status)) {
    throw new AdminBillingError(400, 'UNSUPPORTED_SUBSCRIPTION_STATUS', 'Unsupported subscription status.');
  }
  const monthlyCredits = input.monthlyCredits === undefined || input.monthlyCredits === null || input.monthlyCredits === ''
    ? plan.monthlyCredits
    : normalizeNonNegativeInteger(input.monthlyCredits, 'monthlyCredits');
  const reason = normalizeReason(input.reason || 'Admin subscription update');
  const admin = normalizeAdminActor(input.admin);
  const currentPeriodStart = parseDateOrNull(input.currentPeriodStart);
  const currentPeriodEnd = parseDateOrNull(input.currentPeriodEnd);

  return runSerializableBillingTransaction(config, async (client) => {
    await ensureUserExists(client, investorId);
    const account = await ensureAdminBillingAccount(config, client, investorId);
    const previous = await getSubscription(client, investorId);
    const result = await client.query(
      [
        'insert into credit_subscriptions',
        '("id", "planKey", status, "monthlyCredits", "currentPeriodStart", "currentPeriodEnd",',
        'provider, "providerCustomerId", "providerSubscriptionId", "createdAt", "updatedAt", "investorId")',
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now(), $10)',
        'on conflict ("investorId") do update set',
        '"planKey" = excluded."planKey",',
        'status = excluded.status,',
        '"monthlyCredits" = excluded."monthlyCredits",',
        '"currentPeriodStart" = excluded."currentPeriodStart",',
        '"currentPeriodEnd" = excluded."currentPeriodEnd",',
        'provider = excluded.provider,',
        '"providerCustomerId" = excluded."providerCustomerId",',
        '"providerSubscriptionId" = excluded."providerSubscriptionId",',
        '"updatedAt" = now()',
        'returning id, "planKey", status, "monthlyCredits", "currentPeriodStart", "currentPeriodEnd",',
        'provider, "providerCustomerId", "providerSubscriptionId", "createdAt", "updatedAt"',
      ].join(' '),
      [
        id('credit_subscription'),
        planKey,
        status,
        monthlyCredits,
        currentPeriodStart,
        currentPeriodEnd,
        normalizeOptionalString(input.provider),
        normalizeOptionalString(input.providerCustomerId),
        normalizeOptionalString(input.providerSubscriptionId),
        investorId,
      ],
    );
    const updated = subscriptionRow(result.rows[0]);
    const ledgerResult = await client.query(
      [
        'insert into credit_ledger_entries',
        '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", metadata, "createdAt", "investorId", "accountId")',
        'values ($1, $2, 0, 0, $3, $4, $5, $6, $7::jsonb, now(), $8, $9)',
        'returning id, type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", "runId", "threadId", metadata, "createdAt"',
      ].join(' '),
      [
        id('credit_ledger'),
        'ADMIN_SUBSCRIPTION_UPDATE',
        account.balanceCredits,
        account.reservedCredits,
        reason,
        `admin:subscription:${investorId}:${id('op')}`,
        JSON.stringify({
          admin,
          previous: subscriptionSnapshot(previous),
          current: subscriptionSnapshot(updated),
          reason,
          pricingVersion: AGENT_PRICING_VERSION,
        }),
        investorId,
        account.id,
      ],
    );

    return {
      ok: true,
      subscription: {
        id: updated.id,
        planKey: updated.planKey,
        planName: planFor(updated.planKey).name,
        status: updated.status,
        monthlyCredits: updated.monthlyCredits,
        concurrentTaskLimit: planFor(updated.planKey).concurrentTasks,
        currentPeriodStart: dateIsoOrNull(updated.currentPeriodStart),
        currentPeriodEnd: dateIsoOrNull(updated.currentPeriodEnd),
        provider: updated.provider,
        providerCustomerId: updated.providerCustomerId,
        providerSubscriptionId: updated.providerSubscriptionId,
        updatedAt: dateIsoOrNull(updated.updatedAt),
      },
      ledger: mapLedgerRow(ledgerResult.rows[0]),
    };
  });
}

async function ensureUserExists(client: PoolClient, investorId: string) {
  const result = await client.query('select id from users where id = $1', [investorId]);
  if (!result.rows[0]) throw new AdminBillingError(404, 'USER_NOT_FOUND', 'User not found.');
}

async function ensureAdminBillingAccount(config: ServerConfig, client: PoolClient, investorId: string): Promise<AccountRow> {
  const existing = await client.query(
    [
      'select id, "balanceCredits", "reservedCredits", "lifetimeGrantedCredits",',
      '"lifetimeSpentCredits", "lifetimeRefundedCredits", "createdAt", "updatedAt"',
      'from credit_accounts where "investorId" = $1 for update',
    ].join(' '),
    [investorId],
  );
  if (existing.rows[0]) {
    await ensureFreeSubscription(client, investorId);
    return accountRow(existing.rows[0]);
  }

  const accountId = id('credit_account');
  const welcomeCredits = Math.max(0, config.creditsWelcomeGrant);
  await client.query(
    [
      'insert into credit_accounts',
      '("id", "balanceCredits", "reservedCredits", "lifetimeGrantedCredits",',
      '"lifetimeSpentCredits", "lifetimeRefundedCredits", "createdAt", "updatedAt", "investorId")',
      'values ($1, $2, 0, $2, 0, 0, now(), now(), $3)',
    ].join(' '),
    [accountId, welcomeCredits, investorId],
  );
  await ensureFreeSubscription(client, investorId);
  if (welcomeCredits > 0) {
    await createCreditLot(client, {
      investorId,
      accountId,
      sourceType: 'WELCOME',
      grantedCredits: welcomeCredits,
      balanceBeforeCredits: 0,
      idempotencyKey: `welcome:${investorId}`,
      metadata: { pricingVersion: AGENT_PRICING_VERSION },
    });
  }
  await client.query(
    [
      'insert into credit_ledger_entries',
      '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
      '"reservedAfterCredits", description, "idempotencyKey", metadata, "createdAt", "investorId", "accountId")',
      'values ($1, $2, $3, 0, $3, 0, $4, $5, $6::jsonb, now(), $7, $8)',
      'on conflict ("idempotencyKey") do nothing',
    ].join(' '),
    [
      id('credit_ledger'),
      'WELCOME_GRANT',
      welcomeCredits,
      'Welcome credits',
      `welcome:${investorId}`,
      JSON.stringify({ pricingVersion: AGENT_PRICING_VERSION }),
      investorId,
      accountId,
    ],
  );
  const created = await client.query(
    [
      'select id, "balanceCredits", "reservedCredits", "lifetimeGrantedCredits",',
      '"lifetimeSpentCredits", "lifetimeRefundedCredits", "createdAt", "updatedAt"',
      'from credit_accounts where id = $1',
    ].join(' '),
    [accountId],
  );
  return accountRow(created.rows[0]);
}

async function ensureFreeSubscription(client: PoolClient, investorId: string) {
  await client.query(
    [
      'insert into credit_subscriptions',
      '("id", "planKey", status, "monthlyCredits", "createdAt", "updatedAt", "investorId")',
      'values ($1, $2, $3, $4, now(), now(), $5)',
      'on conflict ("investorId") do nothing',
    ].join(' '),
    [id('credit_subscription'), 'FREE', 'ACTIVE', ADMIN_PLAN_LIMITS.FREE.monthlyCredits, investorId],
  );
}

async function getSubscription(client: PoolClient, investorId: string): Promise<SubscriptionRow> {
  const result = await client.query(
    [
      'select id, "planKey", status, "monthlyCredits", "currentPeriodStart", "currentPeriodEnd",',
      '"cancelAtPeriodEnd", "scheduledPlanKey", "graceEndsAt", provider, "providerCustomerId",',
      '"providerSubscriptionId", "providerPriceId", "latestInvoiceId", "createdAt", "updatedAt"',
      'from credit_subscriptions where "investorId" = $1',
    ].join(' '),
    [investorId],
  );
  if (result.rows[0]) return subscriptionRow(result.rows[0]);
  await ensureFreeSubscription(client, investorId);
  const refreshed = await client.query(
    [
      'select id, "planKey", status, "monthlyCredits", "currentPeriodStart", "currentPeriodEnd",',
      'provider, "providerCustomerId", "providerSubscriptionId", "createdAt", "updatedAt"',
      'from credit_subscriptions where "investorId" = $1',
    ].join(' '),
    [investorId],
  );
  return subscriptionRow(refreshed.rows[0]);
}

function mapLedgerRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    type: String(row.type || ''),
    amountCredits: numberValue(row.amountCredits),
    reservedDeltaCredits: numberValue(row.reservedDeltaCredits),
    balanceAfterCredits: numberValue(row.balanceAfterCredits),
    reservedAfterCredits: numberValue(row.reservedAfterCredits),
    description: String(row.description || ''),
    idempotencyKey: String(row.idempotencyKey || ''),
    runId: typeof row.runId === 'string' ? row.runId : null,
    threadId: typeof row.threadId === 'string' ? row.threadId : null,
    threadTitle: typeof row.threadTitle === 'string' ? row.threadTitle : null,
    metadata: cleanJson(row.metadata),
    createdAt: dateIso(row.createdAt),
  };
}

function mapUsageRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    runId: String(row.runId || ''),
    status: String(row.status || ''),
    hermesModel: typeof row.hermesModel === 'string' ? row.hermesModel : null,
    codexModel: typeof row.codexModel === 'string' ? row.codexModel : null,
    hermesCostUsd: numberValue(row.hermesCostUsd),
    hermesCredits: numberValue(row.hermesCredits),
    codexCredits: numberValue(row.codexCredits),
    computedCredits: numberValue(row.computedCredits),
    billedCredits: numberValue(row.billedCredits),
    pricingVersion: String(row.pricingVersion || AGENT_PRICING_VERSION),
    component: isRecord(row.usage) && row.usage.component === 'memory_review'
      ? 'memory_review'
      : 'agent_task',
    sourceRunId: isRecord(row.usage) && typeof row.usage.sourceRunId === 'string'
      ? row.usage.sourceRunId
      : String(row.runId || ''),
    memoryReviewJobId: isRecord(row.usage) && typeof row.usage.memoryReviewJobId === 'string'
      ? row.usage.memoryReviewJobId
      : null,
    taskLabel: isRecord(row.usage) && typeof row.usage.taskLabel === 'string'
      ? row.usage.taskLabel
      : null,
    usage: cleanJson(row.usage),
    threadId: typeof row.threadId === 'string' ? row.threadId : null,
    threadTitle: typeof row.threadTitle === 'string' ? row.threadTitle : null,
    createdAt: dateIso(row.createdAt),
    updatedAt: dateIso(row.updatedAt),
  };
}

function mapReservationRow(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    runId: String(row.runId || ''),
    status: String(row.status || ''),
    mode: String(row.mode || ''),
    hermesModel: typeof row.hermesModel === 'string' ? row.hermesModel : null,
    estimatedCredits: numberValue(row.estimatedCredits),
    reservedCredits: numberValue(row.reservedCredits),
    capturedCredits: numberValue(row.capturedCredits),
    shortfallCredits: numberValue(row.shortfallCredits),
    threadId: typeof row.threadId === 'string' ? row.threadId : null,
    threadTitle: typeof row.threadTitle === 'string' ? row.threadTitle : null,
    expiresAt: dateIso(row.expiresAt),
    settledAt: dateIsoOrNull(row.settledAt),
    createdAt: dateIso(row.createdAt),
    updatedAt: dateIso(row.updatedAt),
  };
}

function accountRow(row: Record<string, unknown>): AccountRow {
  return {
    id: String(row.id || ''),
    balanceCredits: numberValue(row.balanceCredits),
    reservedCredits: numberValue(row.reservedCredits),
    lifetimeGrantedCredits: numberValue(row.lifetimeGrantedCredits),
    lifetimeSpentCredits: numberValue(row.lifetimeSpentCredits),
    lifetimeRefundedCredits: numberValue(row.lifetimeRefundedCredits),
    createdAt: dateOrNull(row.createdAt),
    updatedAt: dateOrNull(row.updatedAt),
  };
}

function subscriptionRow(row: Record<string, unknown>): SubscriptionRow {
  const planKey = String(row.planKey || 'FREE').toUpperCase();
  return {
    id: String(row.id || ''),
    planKey,
    status: String(row.status || 'ACTIVE').toUpperCase(),
    monthlyCredits: numberValue(row.monthlyCredits || planFor(planKey).monthlyCredits),
    currentPeriodStart: dateOrNull(row.currentPeriodStart),
    currentPeriodEnd: dateOrNull(row.currentPeriodEnd),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    scheduledPlanKey: typeof row.scheduledPlanKey === 'string' ? row.scheduledPlanKey : null,
    graceEndsAt: dateOrNull(row.graceEndsAt),
    provider: typeof row.provider === 'string' ? row.provider : null,
    providerCustomerId: typeof row.providerCustomerId === 'string' ? row.providerCustomerId : null,
    providerSubscriptionId: typeof row.providerSubscriptionId === 'string' ? row.providerSubscriptionId : null,
    providerPriceId: typeof row.providerPriceId === 'string' ? row.providerPriceId : null,
    latestInvoiceId: typeof row.latestInvoiceId === 'string' ? row.latestInvoiceId : null,
    createdAt: dateOrNull(row.createdAt),
    updatedAt: dateOrNull(row.updatedAt),
  };
}

function subscriptionSnapshot(value: SubscriptionRow) {
  return {
    planKey: value.planKey,
    status: value.status,
    monthlyCredits: value.monthlyCredits,
    currentPeriodStart: dateIsoOrNull(value.currentPeriodStart),
    currentPeriodEnd: dateIsoOrNull(value.currentPeriodEnd),
    cancelAtPeriodEnd: value.cancelAtPeriodEnd,
    scheduledPlanKey: value.scheduledPlanKey,
    graceEndsAt: dateIsoOrNull(value.graceEndsAt),
    provider: value.provider,
    providerCustomerId: value.providerCustomerId,
    providerSubscriptionId: value.providerSubscriptionId,
    providerPriceId: value.providerPriceId,
    latestInvoiceId: value.latestInvoiceId,
  };
}

function normalizeRequiredString(value: unknown, key: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminBillingError(400, 'INVALID_INPUT', `${key} is required.`);
  }
  return value.trim();
}

function normalizeReason(value: unknown) {
  const reason = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!reason) throw new AdminBillingError(400, 'INVALID_REASON', 'Reason is required.');
  if (reason.length > 500) throw new AdminBillingError(400, 'INVALID_REASON', 'Reason must be 500 characters or fewer.');
  return reason;
}

function normalizePositiveInteger(value: unknown, key: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AdminBillingError(400, 'INVALID_NUMBER', `${key} must be a positive whole number.`);
  }
  return Math.floor(parsed);
}

function normalizeNonNegativeInteger(value: unknown, key: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AdminBillingError(400, 'INVALID_NUMBER', `${key} must be a non-negative whole number.`);
  }
  return Math.floor(parsed);
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeAdminActor(value: unknown) {
  const admin = isRecord(value) ? value : {};
  return {
    clerkId: typeof admin.clerkId === 'string' ? admin.clerkId : null,
    email: typeof admin.email === 'string' ? admin.email : null,
    name: typeof admin.name === 'string' ? admin.name : null,
  };
}

function parseDateOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new AdminBillingError(400, 'INVALID_DATE', 'Date must be an ISO string.');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AdminBillingError(400, 'INVALID_DATE', 'Invalid date.');
  return date;
}

function planFor(planKey: string) {
  return ADMIN_PLAN_LIMITS[planKey.toUpperCase()] || ADMIN_PLAN_LIMITS.FREE;
}

function cleanJson(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 8000 ? `${value.slice(0, 8000)}... [truncated]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 120).map((item) => cleanJson(item, depth + 1));
  if (typeof value === 'object') {
    if ('toJSON' in value && typeof value.toJSON === 'function') return cleanJson(value.toJSON(), depth + 1);
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : cleanJson(item, depth + 1),
      ]),
    );
  }
  return String(value);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateOrNull(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function dateIso(value: unknown) {
  const date = dateOrNull(value);
  return date ? date.toISOString() : new Date(0).toISOString();
}

function dateIsoOrNull(value: unknown) {
  const date = dateOrNull(value);
  return date ? date.toISOString() : null;
}
