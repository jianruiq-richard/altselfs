import { BillingUnavailableError, getRequiredBillingPool, runSerializableBillingTransaction, } from './billing-database.js';
import { id, isRecord } from './util.js';
const PRICING_VERSION = '2026-07-v1';
const PLAN_LIMITS = {
    FREE: { name: 'Free', concurrentTasks: 1, monthlyCredits: 1_000 },
    STARTER: { name: 'Starter', concurrentTasks: 3, monthlyCredits: 20_000 },
    PRO: { name: 'Pro', concurrentTasks: 10, monthlyCredits: 40_000 },
    SCALE: { name: 'Scale', concurrentTasks: 20, monthlyCredits: 200_000 },
};
export class CreditAdmissionError extends Error {
    httpStatus;
    code;
    details;
    constructor(httpStatus, code, message, details = {}) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.details = details;
        this.name = 'CreditAdmissionError';
    }
}
export async function authorizeAgentRun(config, input) {
    return runSerializableBillingTransaction(config, async (client) => {
        const now = new Date();
        const existing = await client.query([
            'select r.id, r.status, r.mode, r."reservedCredits", r."estimatedCredits",',
            'a."balanceCredits", a."reservedCredits" as "accountReservedCredits",',
            's."planKey", s.status as "subscriptionStatus", s."monthlyCredits"',
            'from credit_reservations r',
            'join credit_accounts a on a.id = r."accountId"',
            'left join credit_subscriptions s on s."investorId" = r."investorId"',
            'where r."runId" = $1',
        ].join(' '), [input.runId]);
        if (existing.rows[0]) {
            return authorizationFromExisting(config, existing.rows[0], input.runId, client, now);
        }
        const account = await ensureBillingAccount(config, client, input.investorId);
        const refreshedAccount = await releaseExpiredReservations(client, account, now);
        const subscription = await getSubscription(client, input.investorId);
        const plan = planFor(subscription.planKey);
        if (!['ACTIVE', 'TRIALING'].includes(subscription.status.toUpperCase())) {
            throw new CreditAdmissionError(402, 'SUBSCRIPTION_INACTIVE', 'Your subscription is not active.', { subscriptionStatus: subscription.status });
        }
        const activeReservations = await client.query([
            'select id, "threadId"',
            'from credit_reservations',
            'where "investorId" = $1 and status = $2 and "expiresAt" > $3',
            'order by "createdAt" asc, id asc',
        ].join(' '), [input.investorId, 'ACTIVE', now]);
        if (activeReservations.rows.some((row) => String(row.threadId || '') === input.threadId)) {
            throw new CreditAdmissionError(409, 'THREAD_BUSY', 'This discussion already has an active task.', { threadId: input.threadId });
        }
        if (activeReservations.rows.length >= plan.concurrentTasks) {
            throw new CreditAdmissionError(429, 'CONCURRENT_TASK_LIMIT', `${plan.name} allows ${plan.concurrentTasks} active task${plan.concurrentTasks === 1 ? '' : 's'}.`, {
                activeTaskCount: activeReservations.rows.length,
                concurrentTaskLimit: plan.concurrentTasks,
                planKey: subscription.planKey,
            });
        }
        const availableCredits = Math.max(0, refreshedAccount.balanceCredits - refreshedAccount.reservedCredits);
        const holdCredits = Math.max(1, config.creditsConcurrencyHold);
        if (config.creditsEnforcementMode === 'enforce' && availableCredits < holdCredits) {
            throw new CreditAdmissionError(402, 'INSUFFICIENT_CREDITS', `${holdCredits} available credits are required to authorize this task.`, {
                requiredCredits: holdCredits,
                availableCredits,
                reservedCredits: refreshedAccount.reservedCredits,
            });
        }
        const reservedCredits = config.creditsEnforcementMode === 'enforce' ? holdCredits : 0;
        const nextReservedCredits = refreshedAccount.reservedCredits + reservedCredits;
        if (reservedCredits > 0) {
            await client.query('update credit_accounts set "reservedCredits" = $2, "updatedAt" = now() where id = $1', [refreshedAccount.id, nextReservedCredits]);
        }
        const reservationId = id('credit_reservation');
        const expiresAt = new Date(now.getTime() + Math.max(1, config.creditsReservationTtlMinutes) * 60_000);
        await client.query([
            'insert into credit_reservations',
            '("id", "runId", status, mode, "hermesModel", "estimatedCredits", "reservedCredits",',
            '"capturedCredits", "shortfallCredits", "expiresAt", "createdAt", "updatedAt",',
            '"investorId", "accountId", "threadId")',
            'values ($1, $2, $3, $4, $5, $6, $7, 0, 0, $8, now(), now(), $9, $10, $11)',
        ].join(' '), [
            reservationId,
            input.runId,
            'ACTIVE',
            config.creditsEnforcementMode.toUpperCase(),
            input.hermesModel || null,
            holdCredits,
            reservedCredits,
            expiresAt,
            input.investorId,
            refreshedAccount.id,
            input.threadId,
        ]);
        await client.query([
            'insert into credit_ledger_entries',
            '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
            '"reservedAfterCredits", description, "idempotencyKey", "runId", "threadId", metadata,',
            '"createdAt", "investorId", "accountId", "reservationId")',
            'values ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(), $11, $12, $13)',
        ].join(' '), [
            id('credit_ledger'),
            config.creditsEnforcementMode === 'enforce' ? 'RESERVE' : 'USAGE_PENDING',
            reservedCredits,
            refreshedAccount.balanceCredits,
            nextReservedCredits,
            config.creditsEnforcementMode === 'enforce' ? 'Credits reserved for agent task' : 'Agent task authorized',
            `reserve:${input.runId}`,
            input.runId,
            input.threadId,
            JSON.stringify({
                concurrencyHoldCredits: holdCredits,
                hermesModel: input.hermesModel || null,
                mode: config.creditsEnforcementMode,
                pricingVersion: PRICING_VERSION,
            }),
            input.investorId,
            refreshedAccount.id,
            reservationId,
        ]);
        return {
            reservationId,
            runId: input.runId,
            status: 'ACTIVE',
            mode: config.creditsEnforcementMode,
            reservedCredits,
            estimatedCredits: holdCredits,
            existing: false,
            account: {
                balanceCredits: refreshedAccount.balanceCredits,
                reservedCredits: nextReservedCredits,
                availableCredits: Math.max(0, refreshedAccount.balanceCredits - nextReservedCredits),
            },
            subscription: {
                planKey: subscription.planKey,
                planName: plan.name,
                concurrentTaskLimit: plan.concurrentTasks,
            },
            capacity: {
                activeTaskCount: activeReservations.rows.length + 1,
                availableTaskSlots: Math.max(0, plan.concurrentTasks - activeReservations.rows.length - 1),
            },
        };
    });
}
export async function getBillingCapacity(config, investorId) {
    return runSerializableBillingTransaction(config, async (client) => {
        const now = new Date();
        const account = await ensureBillingAccount(config, client, investorId);
        const refreshedAccount = await releaseExpiredReservations(client, account, now);
        const subscription = await getSubscription(client, investorId);
        const activeTasks = await client.query([
            'select "runId", "threadId", "reservedCredits", "createdAt", "expiresAt"',
            'from credit_reservations',
            'where "investorId" = $1 and status = $2 and "expiresAt" > $3',
            'order by "createdAt" asc, id asc',
        ].join(' '), [investorId, 'ACTIVE', now]);
        return buildCapacity(config, refreshedAccount, subscription, activeTasks.rows);
    });
}
export async function getBillingSummary(config, investorId) {
    const capacity = await getBillingCapacity(config, investorId);
    const pool = getRequiredBillingPool(config);
    const [ledger, usage] = await Promise.all([
        pool.query([
            'select id, type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
            '"reservedAfterCredits", description, "runId", "threadId", metadata, "createdAt"',
            'from credit_ledger_entries where "investorId" = $1',
            'order by "createdAt" desc, id desc limit 40',
        ].join(' '), [investorId]),
        pool.query([
            'select id, "runId", status, "hermesModel", "codexModel", "hermesCredits",',
            '"codexCredits", "computedCredits", "billedCredits", "pricingVersion", "createdAt"',
            'from agent_usage_records where "investorId" = $1',
            'order by "createdAt" desc, id desc limit 20',
        ].join(' '), [investorId]),
    ]);
    return {
        ...capacity,
        pricingVersion: PRICING_VERSION,
        recentLedger: ledger.rows.map((row) => ({
            id: String(row.id || ''),
            type: String(row.type || ''),
            amountCredits: numberValue(row.amountCredits),
            reservedDeltaCredits: numberValue(row.reservedDeltaCredits),
            balanceAfterCredits: numberValue(row.balanceAfterCredits),
            reservedAfterCredits: numberValue(row.reservedAfterCredits),
            description: String(row.description || ''),
            runId: typeof row.runId === 'string' ? row.runId : null,
            threadId: typeof row.threadId === 'string' ? row.threadId : null,
            metadata: isRecord(row.metadata) ? row.metadata : row.metadata ?? null,
            createdAt: dateIso(row.createdAt),
        })),
        recentUsage: usage.rows.map((row) => ({
            id: String(row.id || ''),
            runId: String(row.runId || ''),
            status: String(row.status || ''),
            hermesModel: typeof row.hermesModel === 'string' ? row.hermesModel : null,
            codexModel: typeof row.codexModel === 'string' ? row.codexModel : null,
            hermesCredits: numberValue(row.hermesCredits),
            codexCredits: numberValue(row.codexCredits),
            computedCredits: numberValue(row.computedCredits),
            billedCredits: numberValue(row.billedCredits),
            pricingVersion: String(row.pricingVersion || PRICING_VERSION),
            createdAt: dateIso(row.createdAt),
        })),
    };
}
async function ensureBillingAccount(config, client, investorId) {
    const existing = await client.query([
        'select id, "balanceCredits", "reservedCredits", "lifetimeGrantedCredits",',
        '"lifetimeSpentCredits", "lifetimeRefundedCredits"',
        'from credit_accounts where "investorId" = $1 for update',
    ].join(' '), [investorId]);
    if (existing.rows[0]) {
        await ensureFreeSubscription(client, investorId);
        return accountRow(existing.rows[0]);
    }
    const accountId = id('credit_account');
    const welcomeCredits = Math.max(0, config.creditsWelcomeGrant);
    await client.query([
        'insert into credit_accounts',
        '("id", "balanceCredits", "reservedCredits", "lifetimeGrantedCredits",',
        '"lifetimeSpentCredits", "lifetimeRefundedCredits", "createdAt", "updatedAt", "investorId")',
        'values ($1, $2, 0, $2, 0, 0, now(), now(), $3)',
    ].join(' '), [accountId, welcomeCredits, investorId]);
    await ensureFreeSubscription(client, investorId);
    await client.query([
        'insert into credit_ledger_entries',
        '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", metadata, "createdAt", "investorId", "accountId")',
        'values ($1, $2, $3, 0, $3, 0, $4, $5, $6::jsonb, now(), $7, $8)',
        'on conflict ("idempotencyKey") do nothing',
    ].join(' '), [
        id('credit_ledger'),
        'WELCOME_GRANT',
        welcomeCredits,
        'Welcome credits',
        `welcome:${investorId}`,
        JSON.stringify({ pricingVersion: PRICING_VERSION }),
        investorId,
        accountId,
    ]);
    return {
        id: accountId,
        balanceCredits: welcomeCredits,
        reservedCredits: 0,
        lifetimeGrantedCredits: welcomeCredits,
        lifetimeSpentCredits: 0,
        lifetimeRefundedCredits: 0,
    };
}
async function ensureFreeSubscription(client, investorId) {
    await client.query([
        'insert into credit_subscriptions',
        '("id", "planKey", status, "monthlyCredits", "createdAt", "updatedAt", "investorId")',
        'values ($1, $2, $3, $4, now(), now(), $5)',
        'on conflict ("investorId") do nothing',
    ].join(' '), [id('credit_subscription'), 'FREE', 'ACTIVE', PLAN_LIMITS.FREE.monthlyCredits, investorId]);
}
async function getSubscription(client, investorId) {
    const result = await client.query([
        'select "planKey", status, "monthlyCredits", "currentPeriodStart", "currentPeriodEnd"',
        'from credit_subscriptions where "investorId" = $1',
    ].join(' '), [investorId]);
    const row = result.rows[0] || {};
    return {
        planKey: String(row.planKey || 'FREE').toUpperCase(),
        status: String(row.status || 'ACTIVE'),
        monthlyCredits: numberValue(row.monthlyCredits || PLAN_LIMITS.FREE.monthlyCredits),
        currentPeriodStart: row.currentPeriodStart instanceof Date ? row.currentPeriodStart : null,
        currentPeriodEnd: row.currentPeriodEnd instanceof Date ? row.currentPeriodEnd : null,
    };
}
async function releaseExpiredReservations(client, account, now) {
    const expired = await client.query([
        'select id, "runId", "threadId", mode, "reservedCredits", "investorId", "accountId"',
        'from credit_reservations',
        'where "accountId" = $1 and status = $2 and "expiresAt" <= $3',
        'for update',
    ].join(' '), [account.id, 'ACTIVE', now]);
    if (expired.rows.length === 0)
        return account;
    const releasedCredits = expired.rows.reduce((sum, row) => sum + Math.max(0, numberValue(row.reservedCredits)), 0);
    const nextReservedCredits = Math.max(0, account.reservedCredits - releasedCredits);
    await client.query('update credit_accounts set "reservedCredits" = $2, "updatedAt" = now() where id = $1', [account.id, nextReservedCredits]);
    await client.query('update credit_reservations set status = $2, "settledAt" = $3, "updatedAt" = now() where id = any($1::text[])', [expired.rows.map((row) => String(row.id)), 'EXPIRED', now]);
    let runningReservedCredits = account.reservedCredits;
    for (const row of expired.rows) {
        const reservationCredits = Math.max(0, numberValue(row.reservedCredits));
        runningReservedCredits = Math.max(0, runningReservedCredits - reservationCredits);
        await client.query([
            'insert into credit_ledger_entries',
            '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
            '"reservedAfterCredits", description, "idempotencyKey", "runId", "threadId", metadata,',
            '"createdAt", "investorId", "accountId", "reservationId")',
            'values ($1, $2, 0, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now(), $11, $12, $13)',
            'on conflict ("idempotencyKey") do nothing',
        ].join(' '), [
            id('credit_ledger'),
            'RELEASE',
            -reservationCredits,
            account.balanceCredits,
            runningReservedCredits,
            'Expired agent task hold released',
            `expire:${String(row.runId || '')}`,
            row.runId || null,
            row.threadId || null,
            JSON.stringify({ reason: 'reservation_expired', mode: String(row.mode || '').toLowerCase() }),
            String(row.investorId || ''),
            String(row.accountId || ''),
            String(row.id || ''),
        ]);
    }
    return { ...account, reservedCredits: nextReservedCredits };
}
async function authorizationFromExisting(config, row, runId, client, now) {
    const planKey = String(row.planKey || 'FREE').toUpperCase();
    const plan = planFor(planKey);
    const investorResult = await client.query('select "investorId" from credit_reservations where "runId" = $1', [runId]);
    const investorId = String(investorResult.rows[0]?.investorId || '');
    const activeCountResult = await client.query('select count(*)::int as count from credit_reservations where "investorId" = $1 and status = $2 and "expiresAt" > $3', [investorId, 'ACTIVE', now]);
    const activeTaskCount = numberValue(activeCountResult.rows[0]?.count);
    const balanceCredits = numberValue(row.balanceCredits);
    const reservedCredits = numberValue(row.accountReservedCredits);
    return {
        reservationId: String(row.id || ''),
        runId,
        status: String(row.status || ''),
        mode: String(row.mode || '').toLowerCase() === 'enforce' ? 'enforce' : 'observe',
        reservedCredits: numberValue(row.reservedCredits),
        estimatedCredits: numberValue(row.estimatedCredits),
        existing: true,
        account: {
            balanceCredits,
            reservedCredits,
            availableCredits: Math.max(0, balanceCredits - reservedCredits),
        },
        subscription: {
            planKey,
            planName: plan.name,
            concurrentTaskLimit: plan.concurrentTasks,
        },
        capacity: {
            activeTaskCount,
            availableTaskSlots: Math.max(0, plan.concurrentTasks - activeTaskCount),
        },
    };
}
function buildCapacity(config, account, subscription, activeTasks) {
    const plan = planFor(subscription.planKey);
    const availableCredits = Math.max(0, account.balanceCredits - account.reservedCredits);
    const hasCreditAuthorization = config.creditsEnforcementMode !== 'enforce'
        || availableCredits >= Math.max(1, config.creditsConcurrencyHold);
    const availableTaskSlots = Math.max(0, plan.concurrentTasks - activeTasks.length);
    return {
        mode: config.creditsEnforcementMode,
        account: {
            balanceCredits: account.balanceCredits,
            reservedCredits: account.reservedCredits,
            availableCredits,
            lifetimeGrantedCredits: account.lifetimeGrantedCredits,
            lifetimeSpentCredits: account.lifetimeSpentCredits,
            lifetimeRefundedCredits: account.lifetimeRefundedCredits,
        },
        subscription: {
            planKey: subscription.planKey,
            planName: plan.name,
            status: subscription.status,
            monthlyCredits: subscription.monthlyCredits,
            concurrentTaskLimit: plan.concurrentTasks,
            currentPeriodStart: subscription.currentPeriodStart?.toISOString() || null,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
        },
        capacity: {
            activeTaskCount: activeTasks.length,
            availableTaskSlots,
            concurrencyHoldCredits: Math.max(1, config.creditsConcurrencyHold),
            hasCreditAuthorization,
            canStartTask: availableTaskSlots > 0 && hasCreditAuthorization,
        },
        activeTasks: activeTasks.map((row) => ({
            runId: String(row.runId || ''),
            threadId: typeof row.threadId === 'string' ? row.threadId : null,
            reservedCredits: numberValue(row.reservedCredits),
            createdAt: dateIso(row.createdAt),
            expiresAt: dateIso(row.expiresAt),
        })),
    };
}
function planFor(planKey) {
    return PLAN_LIMITS[planKey.toUpperCase()] || PLAN_LIMITS.FREE;
}
function accountRow(row) {
    return {
        id: String(row.id || ''),
        balanceCredits: numberValue(row.balanceCredits),
        reservedCredits: numberValue(row.reservedCredits),
        lifetimeGrantedCredits: numberValue(row.lifetimeGrantedCredits),
        lifetimeSpentCredits: numberValue(row.lifetimeSpentCredits),
        lifetimeRefundedCredits: numberValue(row.lifetimeRefundedCredits),
    };
}
function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function dateIso(value) {
    if (value instanceof Date)
        return value.toISOString();
    const parsed = new Date(String(value || ''));
    return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}
export { BillingUnavailableError };
