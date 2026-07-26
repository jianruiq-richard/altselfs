import Stripe from 'stripe';
import { getRequiredBillingPool, runSerializableBillingTransaction, } from './billing-database.js';
import { ensureBillingAccount } from './credit-admission.js';
import { createCreditLot, reverseRemainingCreditLot, } from './credit-lots.js';
import { id, isRecord } from './util.js';
const PLAN_CATALOG = {
    FREE: { name: 'Free', monthlyCredits: 0, rank: 0 },
    STARTER: { name: 'Starter', monthlyCredits: 20_000, rank: 1 },
    PRO: { name: 'Pro', monthlyCredits: 40_000, rank: 2 },
    SCALE: { name: 'Ultra', monthlyCredits: 200_000, rank: 3 },
};
const CREDIT_PACKS = {
    CREDITS_20000: { credits: 20_000, amountCents: 2_000 },
    CREDITS_40000: { credits: 40_000, amountCents: 4_000 },
    CREDITS_80000: { credits: 80_000, amountCents: 8_000 },
    CREDITS_100000: { credits: 100_000, amountCents: 10_000 },
};
export class StripeBillingError extends Error {
    httpStatus;
    code;
    details;
    constructor(httpStatus, code, message, details = {}) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.details = details;
        this.name = 'StripeBillingError';
    }
}
export function getStripeCatalog(config) {
    return {
        configured: Boolean(config.stripeSecretKey),
        plans: {
            STARTER: { priceId: config.stripePriceStarterMonthly || null, ...PLAN_CATALOG.STARTER },
            PRO: { priceId: config.stripePriceProMonthly || null, ...PLAN_CATALOG.PRO },
            SCALE: { priceId: config.stripePriceUltraMonthly || null, ...PLAN_CATALOG.SCALE },
        },
        packs: {
            CREDITS_20000: { priceId: config.stripePriceCredits20000 || null, ...CREDIT_PACKS.CREDITS_20000 },
            CREDITS_40000: { priceId: config.stripePriceCredits40000 || null, ...CREDIT_PACKS.CREDITS_40000 },
            CREDITS_80000: { priceId: config.stripePriceCredits80000 || null, ...CREDIT_PACKS.CREDITS_80000 },
            CREDITS_100000: { priceId: config.stripePriceCredits100000 || null, ...CREDIT_PACKS.CREDITS_100000 },
        },
        refundPolicy: {
            contactEmail: config.stripeRefundContactEmail,
            usageLimitCredits: config.stripeRefundUsageLimitCredits,
            selfService: false,
        },
    };
}
export async function createStripeCheckout(config, input) {
    const investorId = requiredString(input.investorId, 'investorId');
    const purchaseKind = String(input.purchaseKind || '').trim().toUpperCase();
    const stripe = requiredStripe(config);
    await assertPaymentAllowed(config, investorId);
    const customerId = await ensureStripeCustomer(config, stripe, {
        investorId,
        email: optionalString(input.email),
        name: optionalString(input.name),
    });
    const requestId = optionalString(input.requestId) || id('stripe_checkout');
    const common = {
        customer: customerId,
        client_reference_id: investorId,
        success_url: `${config.stripeAppBaseUrl}/profile?billing=success`,
        cancel_url: `${config.stripeAppBaseUrl}/pricing?billing=cancelled`,
        automatic_tax: { enabled: config.stripeAutomaticTaxEnabled },
        customer_update: { address: 'auto', name: 'auto' },
    };
    if (purchaseKind === 'SUBSCRIPTION') {
        const planKey = paidPlanKey(input.planKey);
        const priceId = priceIdForPlan(config, planKey);
        await assertNoSecondPaidSubscription(config, investorId);
        const session = await stripe.checkout.sessions.create({
            ...common,
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            metadata: {
                investorId,
                purchaseKind: 'SUBSCRIPTION',
                planKey,
            },
            subscription_data: {
                metadata: {
                    investorId,
                    planKey,
                },
            },
        }, { idempotencyKey: `checkout:subscription:${investorId}:${planKey}:${requestId}` });
        return checkoutResponse(session);
    }
    if (purchaseKind === 'CREDIT_PACK') {
        const packKey = creditPackKey(input.packKey);
        const pack = CREDIT_PACKS[packKey];
        const priceId = priceIdForPack(config, packKey);
        const metadata = {
            investorId,
            purchaseKind: 'CREDIT_PACK',
            packKey,
            credits: String(pack.credits),
        };
        const session = await stripe.checkout.sessions.create({
            ...common,
            mode: 'payment',
            line_items: [{ price: priceId, quantity: 1 }],
            metadata,
            payment_intent_data: { metadata },
        }, { idempotencyKey: `checkout:pack:${investorId}:${packKey}:${requestId}` });
        return checkoutResponse(session);
    }
    throw new StripeBillingError(400, 'INVALID_PURCHASE_KIND', 'purchaseKind must be SUBSCRIPTION or CREDIT_PACK.');
}
export async function createStripePortal(config, input) {
    const investorId = requiredString(input.investorId, 'investorId');
    const stripe = requiredStripe(config);
    const customerId = await ensureStripeCustomer(config, stripe, {
        investorId,
        email: optionalString(input.email),
        name: optionalString(input.name),
    });
    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${config.stripeAppBaseUrl}/profile`,
        ...(config.stripePortalConfigurationId ? { configuration: config.stripePortalConfigurationId } : {}),
    });
    return { url: session.url };
}
export async function changeStripePlan(config, input) {
    const investorId = requiredString(input.investorId, 'investorId');
    const targetPlanKey = String(input.planKey || '').trim().toUpperCase();
    if (!(targetPlanKey in PLAN_CATALOG)) {
        throw new StripeBillingError(400, 'INVALID_PLAN', 'Unknown billing plan.');
    }
    const subscription = await loadSubscription(config, investorId);
    if (String(subscription?.status || '').toUpperCase() === 'DISPUTED') {
        throw new StripeBillingError(403, 'PAYMENT_BLOCKED', 'Billing is blocked because this account has an unresolved payment dispute.');
    }
    const currentPlanKey = normalizePlanKey(subscription?.planKey);
    if (targetPlanKey === 'FREE' ||
        PLAN_CATALOG[targetPlanKey].rank <= PLAN_CATALOG[currentPlanKey].rank) {
        return {
            action: 'PORTAL',
            ...(await createStripePortal(config, input)),
            message: 'Downgrades and cancellations take effect at the end of the current billing period.',
        };
    }
    if (!subscription?.providerSubscriptionId || subscription.provider !== 'stripe') {
        return {
            action: 'CHECKOUT',
            ...(await createStripeCheckout(config, {
                ...input,
                purchaseKind: 'SUBSCRIPTION',
                planKey: targetPlanKey,
            })),
        };
    }
    const stripe = requiredStripe(config);
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.providerSubscriptionId);
    const item = stripeSubscription.items.data[0];
    if (!item)
        throw new StripeBillingError(409, 'SUBSCRIPTION_ITEM_MISSING', 'The Stripe subscription has no billable item.');
    const planKey = paidPlanKey(targetPlanKey);
    const priceId = priceIdForPlan(config, planKey);
    const requestId = optionalString(input.requestId) || id('upgrade');
    const updated = await stripe.subscriptions.update(stripeSubscription.id, {
        items: [{ id: item.id, price: priceId }],
        billing_cycle_anchor: 'now',
        payment_behavior: 'error_if_incomplete',
        proration_behavior: 'none',
        metadata: {
            ...stripeSubscription.metadata,
            investorId,
            planKey,
            planChangeKind: 'IMMEDIATE_UPGRADE',
            planChangeRequestId: requestId,
            previousPlanKey: currentPlanKey,
            previousPriceId: stripeId(item.price) || '',
            previousLatestInvoiceId: subscription.latestInvoiceId || '',
            previousPeriodEnd: subscription.currentPeriodEnd?.toISOString() || '',
        },
    }, {
        idempotencyKey: `plan-upgrade:${investorId}:${planKey}:${requestId}`,
    });
    return {
        action: 'UPGRADE',
        status: updated.status,
        pendingUpdate: false,
        message: 'The new plan starts today for a full month. Existing Credits remain available.',
    };
}
export async function handleStripeWebhook(config, rawBody, signature) {
    const stripe = requiredStripe(config);
    if (!config.stripeWebhookSecret) {
        throw new StripeBillingError(503, 'STRIPE_WEBHOOK_NOT_CONFIGURED', 'STRIPE_WEBHOOK_SECRET is not configured.');
    }
    if (!signature)
        throw new StripeBillingError(400, 'STRIPE_SIGNATURE_MISSING', 'Stripe-Signature is required.');
    let event;
    try {
        event = stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
    }
    catch (error) {
        throw new StripeBillingError(400, 'STRIPE_SIGNATURE_INVALID', error instanceof Error ? error.message : 'Invalid Stripe signature.');
    }
    const existing = await registerWebhookEvent(config, event);
    if (existing === 'PROCESSED')
        return { received: true, duplicate: true };
    let investorId = null;
    try {
        investorId = await processStripeEvent(config, stripe, event);
        await markWebhookEvent(config, event.id, 'PROCESSED', investorId, null);
        return { received: true, duplicate: false };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markWebhookEvent(config, event.id, 'FAILED', investorId, message);
        throw error;
    }
}
export async function refundStripePayment(config, input) {
    const investorId = requiredString(input.investorId, 'investorId');
    const paymentId = requiredString(input.paymentId, 'paymentId');
    const reason = requiredString(input.reason, 'reason');
    const platformFault = input.platformFault === true;
    const payment = await loadPayment(config, investorId, paymentId);
    if (!payment)
        throw new StripeBillingError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
    if (payment.status === 'REFUNDED' || payment.status === 'DISPUTED') {
        throw new StripeBillingError(409, 'PAYMENT_ALREADY_REVERSED', 'This payment has already been reversed.');
    }
    const remainingCredits = Math.max(0, payment.creditsGranted - payment.creditsReversed);
    if (remainingCredits === 0) {
        throw new StripeBillingError(409, 'PAYMENT_ALREADY_REVERSED', 'This payment has already been reversed.');
    }
    const usage = await paymentUsageSinceGrant(config, payment);
    if (!platformFault && usage.usedSinceGrant > config.stripeRefundUsageLimitCredits) {
        throw new StripeBillingError(409, 'REFUND_USAGE_LIMIT_EXCEEDED', `This payment has more than ${config.stripeRefundUsageLimitCredits} Credits of subsequent usage.`, usage);
    }
    const stripe = requiredStripe(config);
    const paymentSource = await resolveRefundSource(stripe, payment);
    if (!paymentSource.paymentIntentId && !paymentSource.chargeId) {
        throw new StripeBillingError(409, 'REFUND_SOURCE_MISSING', 'Stripe payment source could not be resolved.');
    }
    const refund = await stripe.refunds.create(paymentSource.paymentIntentId
        ? { payment_intent: paymentSource.paymentIntentId, reason: 'requested_by_customer', metadata: { paymentId, investorId } }
        : { charge: paymentSource.chargeId, reason: 'requested_by_customer', metadata: { paymentId, investorId } }, { idempotencyKey: `admin-refund:${paymentId}` });
    await revertStripeSubscriptionAfterRefund(config, stripe, payment);
    const result = await reversePaymentCredits(config, {
        payment,
        reversalId: refund.id,
        status: 'REFUNDED',
        refundedAmountCents: refund.amount,
        reason,
        metadata: {
            platformFault,
            admin: isRecord(input.admin) ? input.admin : null,
            stripeRefundId: refund.id,
            usedSinceGrant: usage.usedSinceGrant,
        },
    });
    return { ...result, stripeRefundId: refund.id, usage };
}
async function processStripeEvent(config, stripe, event) {
    switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
            const session = event.data.object;
            const investorId = optionalString(session.metadata?.investorId);
            if (!investorId)
                return null;
            if (session.mode === 'payment' && session.payment_status === 'paid') {
                await grantCreditPack(config, session);
            }
            else if (session.mode === 'subscription') {
                await syncCheckoutSubscription(config, session);
            }
            return investorId;
        }
        case 'invoice.paid': {
            return grantSubscriptionInvoice(config, stripe, event.data.object);
        }
        case 'invoice.payment_failed': {
            return markSubscriptionPastDue(config, event.data.object);
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
            const subscription = event.data.object;
            return syncStripeSubscription(config, subscription);
        }
        case 'refund.created':
        case 'charge.refunded': {
            return handleExternalRefund(config, stripe, event.data.object);
        }
        case 'charge.dispute.created': {
            return handleDispute(config, event.data.object);
        }
        default:
            return null;
    }
}
async function grantCreditPack(config, session) {
    const investorId = requiredString(session.metadata?.investorId, 'metadata.investorId');
    const packKey = creditPackKey(session.metadata?.packKey);
    const pack = CREDIT_PACKS[packKey];
    const paymentIntentId = stripeId(session.payment_intent);
    await runSerializableBillingTransaction(config, async (client) => {
        const account = await ensureBillingAccount(config, client, investorId);
        const existing = await client.query('select id from credit_payments where "providerCheckoutSessionId" = $1', [session.id]);
        if (existing.rows[0])
            return;
        const nextBalance = account.balanceCredits + pack.credits;
        const paymentId = id('credit_payment');
        await client.query([
            'insert into credit_payments',
            '("id", kind, status, "packKey", "creditsGranted", "amountSubtotalCents", "amountTotalCents",',
            'currency, "lifetimeSpentCreditsAtGrant", provider, "providerCheckoutSessionId",',
            '"providerPaymentIntentId", "paidAt", metadata, "createdAt", "updatedAt", "investorId")',
            'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), $13::jsonb, now(), now(), $14)',
        ].join(' '), [
            paymentId,
            'CREDIT_PACK',
            'PAID',
            packKey,
            pack.credits,
            numberValue(session.amount_subtotal),
            numberValue(session.amount_total),
            session.currency || 'usd',
            account.lifetimeSpentCredits,
            'stripe',
            session.id,
            paymentIntentId,
            JSON.stringify({ stripeCustomerId: stripeId(session.customer) }),
            investorId,
        ]);
        await grantCredits(client, {
            investorId,
            accountId: account.id,
            amountCredits: pack.credits,
            balanceBefore: account.balanceCredits,
            reservedCredits: account.reservedCredits,
            type: 'CREDIT_PACK_PURCHASE',
            sourceType: 'CREDIT_PACK',
            paymentId,
            description: `${pack.credits.toLocaleString('en-US')} Credit pack purchased`,
            idempotencyKey: `stripe:checkout:${session.id}`,
            metadata: { packKey, checkoutSessionId: session.id, paymentIntentId },
        });
        await client.query([
            'update credit_accounts set "balanceCredits" = $2,',
            '"lifetimeGrantedCredits" = "lifetimeGrantedCredits" + $3, "updatedAt" = now() where id = $1',
        ].join(' '), [account.id, nextBalance, pack.credits]);
    });
}
async function grantSubscriptionInvoice(config, stripe, invoice) {
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId)
        return null;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const investorId = await resolveInvestorId(config, {
        metadataInvestorId: subscription.metadata.investorId,
        providerSubscriptionId: subscription.id,
        providerCustomerId: stripeId(subscription.customer),
    });
    if (!investorId)
        throw new StripeBillingError(409, 'INVESTOR_NOT_FOUND', `No user mapped to ${subscription.id}.`);
    const planKey = planKeyForSubscription(config, subscription);
    const plan = PLAN_CATALOG[planKey];
    const billingReason = String(invoice.billing_reason || '');
    const isUpgrade = (billingReason === 'subscription_update' &&
        subscription.metadata.planChangeKind === 'IMMEDIATE_UPGRADE');
    const credits = plan.monthlyCredits;
    const paymentSource = await invoicePaymentSource(stripe, invoice.id);
    const period = subscriptionPeriod(subscription);
    await runSerializableBillingTransaction(config, async (client) => {
        const account = await ensureBillingAccount(config, client, investorId);
        const existing = await client.query('select id from credit_payments where "providerInvoiceId" = $1', [invoice.id]);
        if (existing.rows[0]) {
            await upsertSubscriptionFromStripe(client, investorId, subscription, planKey, period, invoice.id);
            return;
        }
        const paymentId = id('credit_payment');
        await client.query([
            'insert into credit_payments',
            '("id", kind, status, "planKey", "creditsGranted", "amountSubtotalCents", "amountTotalCents",',
            'currency, "lifetimeSpentCreditsAtGrant", provider, "providerPaymentIntentId",',
            '"providerInvoiceId", "providerChargeId", "paidAt", metadata, "createdAt", "updatedAt", "investorId")',
            'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14::jsonb, now(), now(), $15)',
        ].join(' '), [
            paymentId,
            'SUBSCRIPTION',
            'PAID',
            planKey,
            credits,
            numberValue(invoice.subtotal_excluding_tax ?? invoice.subtotal),
            numberValue(invoice.total),
            invoice.currency || 'usd',
            account.lifetimeSpentCredits,
            'stripe',
            paymentSource.paymentIntentId,
            invoice.id,
            paymentSource.chargeId,
            JSON.stringify({
                billingReason,
                subscriptionId: subscription.id,
                planChangeKind: isUpgrade ? 'IMMEDIATE_UPGRADE' : null,
                previousPlanKey: isUpgrade ? optionalString(subscription.metadata.previousPlanKey) : null,
                previousPriceId: isUpgrade ? optionalString(subscription.metadata.previousPriceId) : null,
                previousLatestInvoiceId: isUpgrade
                    ? optionalString(subscription.metadata.previousLatestInvoiceId)
                    : null,
                previousPeriodEnd: isUpgrade ? optionalString(subscription.metadata.previousPeriodEnd) : null,
                planChangeRequestId: isUpgrade ? optionalString(subscription.metadata.planChangeRequestId) : null,
            }),
            investorId,
        ]);
        if (credits > 0) {
            await grantCredits(client, {
                investorId,
                accountId: account.id,
                amountCredits: credits,
                balanceBefore: account.balanceCredits,
                reservedCredits: account.reservedCredits,
                type: isUpgrade ? 'SUBSCRIPTION_UPGRADE_GRANT' : 'SUBSCRIPTION_GRANT',
                sourceType: 'SUBSCRIPTION',
                paymentId,
                description: isUpgrade
                    ? `${plan.name} subscription upgrade Credits`
                    : `${plan.name} monthly subscription Credits`,
                idempotencyKey: `stripe:invoice:${invoice.id}`,
                metadata: { paymentId, invoiceId: invoice.id, billingReason, planKey },
            });
            await client.query([
                'update credit_accounts set "balanceCredits" = "balanceCredits" + $2,',
                '"lifetimeGrantedCredits" = "lifetimeGrantedCredits" + $2, "updatedAt" = now() where id = $1',
            ].join(' '), [account.id, credits]);
        }
        await upsertSubscriptionFromStripe(client, investorId, subscription, planKey, period, invoice.id);
    });
    return investorId;
}
async function syncCheckoutSubscription(config, session) {
    const investorId = requiredString(session.metadata?.investorId, 'metadata.investorId');
    const customerId = stripeId(session.customer);
    const subscriptionId = stripeId(session.subscription);
    await runSerializableBillingTransaction(config, async (client) => {
        await ensureBillingAccount(config, client, investorId);
        await client.query([
            'update credit_subscriptions set provider = $2, "providerCustomerId" = coalesce($3, "providerCustomerId"),',
            '"providerSubscriptionId" = coalesce($4, "providerSubscriptionId"), "updatedAt" = now()',
            'where "investorId" = $1',
        ].join(' '), [investorId, 'stripe', customerId, subscriptionId]);
    });
}
async function syncStripeSubscription(config, subscription) {
    const investorId = await resolveInvestorId(config, {
        metadataInvestorId: subscription.metadata.investorId,
        providerSubscriptionId: subscription.id,
        providerCustomerId: stripeId(subscription.customer),
    });
    if (!investorId)
        return null;
    const deleted = subscription.status === 'canceled';
    const planKey = deleted ? 'FREE' : planKeyForSubscription(config, subscription);
    const period = subscriptionPeriod(subscription);
    await runSerializableBillingTransaction(config, async (client) => {
        await ensureBillingAccount(config, client, investorId);
        await upsertSubscriptionFromStripe(client, investorId, subscription, planKey, period, null);
    });
    return investorId;
}
async function markSubscriptionPastDue(config, invoice) {
    const subscriptionId = invoiceSubscriptionId(invoice);
    const customerId = stripeId(invoice.customer);
    const investorId = await resolveInvestorId(config, {
        providerSubscriptionId: subscriptionId,
        providerCustomerId: customerId,
    });
    if (!investorId)
        return null;
    const graceEndsAt = new Date(Date.now() + config.stripePaymentGraceDays * 24 * 60 * 60 * 1000);
    const pool = getRequiredBillingPool(config);
    await pool.query([
        'update credit_subscriptions set status = $2, "graceEndsAt" = $3, "latestInvoiceId" = $4,',
        '"updatedAt" = now() where "investorId" = $1',
    ].join(' '), [investorId, 'PAST_DUE', graceEndsAt, invoice.id]);
    return investorId;
}
async function handleExternalRefund(config, stripe, object) {
    const record = object;
    const refundId = optionalString(record.id);
    const paymentIntentId = stripeId(record.payment_intent);
    const chargeId = stripeId(record.charge) || (record.object === 'charge' ? refundId : null);
    if (!refundId && !paymentIntentId && !chargeId)
        return null;
    const payment = await findPaymentByStripeSource(config, paymentIntentId, chargeId);
    if (!payment)
        return null;
    await revertStripeSubscriptionAfterRefund(config, stripe, payment);
    await reversePaymentCredits(config, {
        payment,
        reversalId: refundId || `charge-refund:${chargeId}`,
        status: 'REFUNDED',
        refundedAmountCents: numberValue(record.amount_refunded ?? record.amount),
        reason: 'Stripe refund',
        metadata: { source: 'stripe_webhook' },
    });
    return payment.investorId;
}
async function handleDispute(config, dispute) {
    const payment = await findPaymentByStripeSource(config, stripeId(dispute.payment_intent), stripeId(dispute.charge));
    if (!payment)
        return null;
    await reversePaymentCredits(config, {
        payment,
        reversalId: `dispute:${dispute.id}`,
        status: 'DISPUTED',
        refundedAmountCents: dispute.amount,
        reason: 'Stripe payment dispute',
        metadata: { disputeId: dispute.id, disputeReason: dispute.reason },
    });
    return payment.investorId;
}
async function revertStripeSubscriptionAfterRefund(config, stripe, payment) {
    if (payment.kind !== 'SUBSCRIPTION')
        return;
    const subscription = await loadSubscription(config, payment.investorId);
    const isCurrentInvoice = (!payment.providerInvoiceId ||
        !subscription?.latestInvoiceId ||
        subscription.latestInvoiceId === payment.providerInvoiceId);
    if (!subscription?.providerSubscriptionId || !isCurrentInvoice)
        return;
    const previousPlanKey = normalizePlanKey(payment.metadata?.previousPlanKey);
    if (previousPlanKey === 'FREE') {
        await stripe.subscriptions.cancel(subscription.providerSubscriptionId, {
            invoice_now: false,
            prorate: false,
        }, {
            idempotencyKey: `refund-plan-restore:${payment.id}`,
        });
        return;
    }
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.providerSubscriptionId);
    const item = stripeSubscription.items.data[0];
    if (!item) {
        throw new StripeBillingError(409, 'SUBSCRIPTION_ITEM_MISSING', 'The Stripe subscription has no billable item to restore.');
    }
    const previousPriceId = optionalString(payment.metadata?.previousPriceId)
        || priceIdForPlan(config, previousPlanKey);
    await stripe.subscriptions.update(stripeSubscription.id, {
        items: [{ id: item.id, price: previousPriceId }],
        proration_behavior: 'none',
        metadata: {
            ...stripeSubscription.metadata,
            investorId: payment.investorId,
            planKey: previousPlanKey,
            planChangeKind: '',
            planChangeRequestId: '',
            previousPlanKey: '',
            previousPriceId: '',
            previousLatestInvoiceId: '',
            previousPeriodEnd: '',
        },
    }, { idempotencyKey: `refund-plan-restore:${payment.id}` });
}
async function reversePaymentCredits(config, input) {
    return runSerializableBillingTransaction(config, async (client) => {
        const paymentResult = await client.query([
            'select id, kind, status, "planKey", "creditsGranted", "creditsReversed",',
            '"providerInvoiceId", metadata, "investorId"',
            'from credit_payments where id = $1 and "investorId" = $2 for update',
        ].join(' '), [input.payment.id, input.payment.investorId]);
        const row = paymentResult.rows[0];
        if (!row)
            throw new StripeBillingError(404, 'PAYMENT_NOT_FOUND', 'Payment record not found.');
        if (row.status === 'REFUNDED' || row.status === 'DISPUTED') {
            const account = await ensureBillingAccount(config, client, input.payment.investorId);
            return { reversedCredits: 0, balanceCredits: account.balanceCredits, duplicate: true };
        }
        const account = await ensureBillingAccount(config, client, input.payment.investorId);
        const lot = await reverseRemainingCreditLot(client, {
            paymentId: input.payment.id,
            investorId: input.payment.investorId,
        });
        if (!lot) {
            throw new StripeBillingError(409, 'PAYMENT_CREDIT_LOT_MISSING', 'This payment does not have a Credit Lot and cannot be reversed safely.');
        }
        const paymentRemainingCredits = Math.max(0, numberValue(row.creditsGranted) - numberValue(row.creditsReversed));
        const subscriptionRefund = String(row.kind) === 'SUBSCRIPTION' && input.status === 'REFUNDED';
        const amountCredits = subscriptionRefund
            ? lot.remainingCredits
            : paymentRemainingCredits;
        const nextBalance = account.balanceCredits - amountCredits;
        await client.query([
            'update credit_accounts set "balanceCredits" = $2,',
            '"lifetimeRefundedCredits" = "lifetimeRefundedCredits" + $3, "updatedAt" = now() where id = $1',
        ].join(' '), [account.id, nextBalance, amountCredits]);
        await client.query([
            'update credit_payments set status = $2, "creditsReversed" = "creditsReversed" + $3,',
            '"refundedAmountCents" = greatest("refundedAmountCents", $4), "refundedAt" = now(),',
            'metadata = coalesce(metadata, $5::jsonb) || $5::jsonb, "updatedAt" = now() where id = $1',
        ].join(' '), [
            input.payment.id,
            input.status,
            amountCredits,
            Math.max(0, input.refundedAmountCents),
            JSON.stringify(input.metadata),
        ]);
        await client.query([
            'insert into credit_ledger_entries',
            '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
            '"reservedAfterCredits", description, "idempotencyKey", metadata, "createdAt", "investorId", "accountId")',
            'values ($1, $2, $3, 0, $4, $5, $6, $7, $8::jsonb, now(), $9, $10)',
            'on conflict ("idempotencyKey") do nothing',
        ].join(' '), [
            id('credit_ledger'),
            input.status === 'DISPUTED' ? 'PAYMENT_DISPUTE_REVERSAL' : 'PAYMENT_REFUND_REVERSAL',
            -amountCredits,
            nextBalance,
            account.reservedCredits,
            input.reason,
            `stripe:reversal:${input.reversalId}`,
            JSON.stringify({ ...input.metadata, paymentId: input.payment.id }),
            input.payment.investorId,
            account.id,
        ]);
        if (input.status === 'DISPUTED') {
            await client.query([
                'update credit_subscriptions set status = $2, "graceEndsAt" = null,',
                '"updatedAt" = now() where "investorId" = $1',
            ].join(' '), [input.payment.investorId, 'DISPUTED']);
        }
        else if (String(row.kind) === 'SUBSCRIPTION') {
            const subscriptionResult = await client.query([
                'select "latestInvoiceId", "providerSubscriptionId" from credit_subscriptions',
                'where "investorId" = $1 for update',
            ].join(' '), [input.payment.investorId]);
            const latestInvoiceId = optionalString(subscriptionResult.rows[0]?.latestInvoiceId);
            const isCurrentInvoice = (!input.payment.providerInvoiceId ||
                !latestInvoiceId ||
                latestInvoiceId === input.payment.providerInvoiceId);
            if (!isCurrentInvoice) {
                return { reversedCredits: amountCredits, balanceCredits: nextBalance, duplicate: false };
            }
            const metadata = isRecord(row.metadata) ? row.metadata : {};
            const previousPlanKey = normalizePlanKey(metadata.previousPlanKey);
            if (previousPlanKey === 'FREE') {
                await client.query([
                    'update credit_subscriptions set "planKey" = $2, status = $3, "monthlyCredits" = 0,',
                    '"cancelAtPeriodEnd" = false, "scheduledPlanKey" = null, "graceEndsAt" = null,',
                    '"currentPeriodStart" = null, "currentPeriodEnd" = null, "providerSubscriptionId" = null,',
                    '"providerPriceId" = null, "latestInvoiceId" = null, "updatedAt" = now()',
                    'where "investorId" = $1',
                ].join(' '), [input.payment.investorId, 'FREE', 'ACTIVE']);
            }
            else {
                await client.query([
                    'update credit_subscriptions set "planKey" = $2, status = $3, "monthlyCredits" = $4,',
                    '"cancelAtPeriodEnd" = false, "scheduledPlanKey" = null, "graceEndsAt" = null,',
                    '"providerPriceId" = $5, "latestInvoiceId" = $6, "updatedAt" = now()',
                    'where "investorId" = $1',
                ].join(' '), [
                    input.payment.investorId,
                    previousPlanKey,
                    'ACTIVE',
                    PLAN_CATALOG[previousPlanKey].monthlyCredits,
                    optionalString(metadata.previousPriceId) || priceIdForPlanOptional(config, previousPlanKey),
                    optionalString(metadata.previousLatestInvoiceId),
                ]);
            }
        }
        return { reversedCredits: amountCredits, balanceCredits: nextBalance, duplicate: false };
    });
}
async function ensureStripeCustomer(config, stripe, input) {
    const pool = getRequiredBillingPool(config);
    const result = await pool.query([
        'select u.email, u.name, s."providerCustomerId"',
        'from users u left join credit_subscriptions s on s."investorId" = u.id where u.id = $1',
    ].join(' '), [input.investorId]);
    const row = result.rows[0];
    if (!row)
        throw new StripeBillingError(404, 'INVESTOR_NOT_FOUND', 'User not found.');
    if (row.providerCustomerId)
        return String(row.providerCustomerId);
    const customer = await stripe.customers.create({
        email: input.email || optionalString(row.email) || undefined,
        name: input.name || optionalString(row.name) || undefined,
        metadata: { investorId: input.investorId },
    }, { idempotencyKey: `customer:${input.investorId}` });
    await runSerializableBillingTransaction(config, async (client) => {
        await ensureBillingAccount(config, client, input.investorId);
        await client.query([
            'update credit_subscriptions set provider = $2, "providerCustomerId" = $3,',
            '"updatedAt" = now() where "investorId" = $1',
        ].join(' '), [input.investorId, 'stripe', customer.id]);
    });
    return customer.id;
}
async function assertNoSecondPaidSubscription(config, investorId) {
    const subscription = await loadSubscription(config, investorId);
    if (subscription?.providerSubscriptionId &&
        ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(String(subscription.status || '').toUpperCase())) {
        throw new StripeBillingError(409, 'SUBSCRIPTION_EXISTS', 'Manage the existing subscription instead of starting a second checkout.');
    }
}
async function assertPaymentAllowed(config, investorId) {
    const subscription = await loadSubscription(config, investorId);
    if (String(subscription?.status || '').toUpperCase() === 'DISPUTED') {
        throw new StripeBillingError(403, 'PAYMENT_BLOCKED', 'Billing is blocked because this account has an unresolved payment dispute.');
    }
}
async function loadSubscription(config, investorId) {
    const pool = getRequiredBillingPool(config);
    const result = await pool.query([
        'select "planKey", status, provider, "providerCustomerId", "providerSubscriptionId",',
        '"providerPriceId", "latestInvoiceId", "currentPeriodStart", "currentPeriodEnd"',
        'from credit_subscriptions where "investorId" = $1',
    ].join(' '), [investorId]);
    return result.rows[0];
}
async function loadPayment(config, investorId, paymentId) {
    const pool = getRequiredBillingPool(config);
    const result = await pool.query([
        'select id, "investorId", kind, status, "planKey", "packKey", "creditsGranted", "creditsReversed",',
        '"amountTotalCents", "providerPaymentIntentId", "providerInvoiceId", "providerChargeId",',
        '"lifetimeSpentCreditsAtGrant", metadata from credit_payments where id = $1 and "investorId" = $2',
    ].join(' '), [paymentId, investorId]);
    return result.rows[0] ? paymentRow(result.rows[0]) : null;
}
async function findPaymentByStripeSource(config, paymentIntentId, chargeId) {
    const pool = getRequiredBillingPool(config);
    const result = await pool.query([
        'select id, "investorId", kind, status, "planKey", "packKey", "creditsGranted", "creditsReversed",',
        '"amountTotalCents", "providerPaymentIntentId", "providerInvoiceId", "providerChargeId",',
        '"lifetimeSpentCreditsAtGrant", metadata from credit_payments',
        'where ($1::text is not null and "providerPaymentIntentId" = $1)',
        'or ($2::text is not null and "providerChargeId" = $2)',
        'order by "createdAt" desc limit 1',
    ].join(' '), [paymentIntentId, chargeId]);
    return result.rows[0] ? paymentRow(result.rows[0]) : null;
}
async function paymentUsageSinceGrant(config, payment) {
    const pool = getRequiredBillingPool(config);
    const result = await pool.query([
        'select "grantedCredits", "consumedCredits", "reversedCredits"',
        'from credit_lots where "paymentId" = $1 and "investorId" = $2',
    ].join(' '), [payment.id, payment.investorId]);
    const lot = result.rows[0];
    if (!lot) {
        throw new StripeBillingError(409, 'PAYMENT_CREDIT_LOT_MISSING', 'This payment does not have a Credit Lot and cannot be refunded safely.');
    }
    const grantedCredits = numberValue(lot.grantedCredits);
    const consumedCredits = numberValue(lot.consumedCredits);
    const reversedCredits = numberValue(lot.reversedCredits);
    return {
        grantedCredits,
        consumedCredits,
        reversedCredits,
        remainingCredits: Math.max(0, grantedCredits - consumedCredits - reversedCredits),
        usedSinceGrant: Math.max(0, consumedCredits),
    };
}
async function resolveRefundSource(stripe, payment) {
    if (payment.providerPaymentIntentId || payment.providerChargeId) {
        return {
            paymentIntentId: payment.providerPaymentIntentId,
            chargeId: payment.providerChargeId,
        };
    }
    if (!payment.providerInvoiceId)
        return { paymentIntentId: null, chargeId: null };
    return invoicePaymentSource(stripe, payment.providerInvoiceId);
}
async function invoicePaymentSource(stripe, invoiceId) {
    const payments = await stripe.invoicePayments.list({ invoice: invoiceId, status: 'paid', limit: 1 });
    const payment = payments.data[0]?.payment;
    const paymentIntentId = stripeId(payment?.payment_intent);
    const directChargeId = stripeId(payment?.charge);
    if (!paymentIntentId)
        return { paymentIntentId: null, chargeId: directChargeId };
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return { paymentIntentId, chargeId: stripeId(intent.latest_charge) || directChargeId };
}
async function resolveInvestorId(config, input) {
    if (input.metadataInvestorId)
        return input.metadataInvestorId;
    const pool = getRequiredBillingPool(config);
    const result = await pool.query([
        'select "investorId" from credit_subscriptions',
        'where ($1::text is not null and "providerSubscriptionId" = $1)',
        'or ($2::text is not null and "providerCustomerId" = $2)',
        'limit 1',
    ].join(' '), [input.providerSubscriptionId || null, input.providerCustomerId || null]);
    return optionalString(result.rows[0]?.investorId);
}
async function registerWebhookEvent(config, event) {
    const pool = getRequiredBillingPool(config);
    const result = await pool.query('select status from stripe_webhook_events where id = $1', [event.id]);
    if (result.rows[0]?.status === 'PROCESSED')
        return 'PROCESSED';
    await pool.query([
        'insert into stripe_webhook_events',
        '("id", type, status, livemode, "objectId", payload, "receivedAt", "updatedAt")',
        'values ($1, $2, $3, $4, $5, $6::jsonb, now(), now())',
        'on conflict (id) do update set status = $3, error = null, "updatedAt" = now()',
    ].join(' '), [
        event.id,
        event.type,
        'PROCESSING',
        event.livemode,
        stripeId(event.data.object.id),
        JSON.stringify(event),
    ]);
    return 'PROCESSING';
}
async function markWebhookEvent(config, eventId, status, investorId, error) {
    const pool = getRequiredBillingPool(config);
    await pool.query([
        'update stripe_webhook_events set status = $2, "investorId" = $3, error = $4,',
        '"processedAt" = case when $2 = $5 then now() else "processedAt" end, "updatedAt" = now() where id = $1',
    ].join(' '), [eventId, status, investorId, error?.slice(0, 4_000) || null, 'PROCESSED']);
}
async function grantCredits(client, input) {
    await createCreditLot(client, {
        investorId: input.investorId,
        accountId: input.accountId,
        sourceType: input.sourceType,
        grantedCredits: input.amountCredits,
        balanceBeforeCredits: input.balanceBefore,
        idempotencyKey: `payment:${input.paymentId}`,
        paymentId: input.paymentId,
        metadata: input.metadata,
    });
    await client.query([
        'insert into credit_ledger_entries',
        '("id", type, "amountCredits", "reservedDeltaCredits", "balanceAfterCredits",',
        '"reservedAfterCredits", description, "idempotencyKey", metadata, "createdAt", "investorId", "accountId")',
        'values ($1, $2, $3, 0, $4, $5, $6, $7, $8::jsonb, now(), $9, $10)',
        'on conflict ("idempotencyKey") do nothing',
    ].join(' '), [
        id('credit_ledger'),
        input.type,
        input.amountCredits,
        input.balanceBefore + input.amountCredits,
        input.reservedCredits,
        input.description,
        input.idempotencyKey,
        JSON.stringify(input.metadata),
        input.investorId,
        input.accountId,
    ]);
}
async function upsertSubscriptionFromStripe(client, investorId, subscription, planKey, period, invoiceId) {
    const deleted = subscription.status === 'canceled';
    const resolvedPlanKey = deleted ? 'FREE' : planKey;
    const priceId = deleted ? null : stripeId(subscription.items.data[0]?.price);
    await client.query([
        'update credit_subscriptions set "planKey" = $2, status = $3, "monthlyCredits" = $4,',
        '"currentPeriodStart" = $5, "currentPeriodEnd" = $6, "cancelAtPeriodEnd" = $7,',
        '"scheduledPlanKey" = null, "graceEndsAt" = null, provider = $8, "providerCustomerId" = $9,',
        '"providerSubscriptionId" = $10, "providerPriceId" = $11,',
        '"latestInvoiceId" = coalesce($12, "latestInvoiceId"), "updatedAt" = now() where "investorId" = $1',
    ].join(' '), [
        investorId,
        resolvedPlanKey,
        deleted ? 'ACTIVE' : subscription.status.toUpperCase(),
        PLAN_CATALOG[resolvedPlanKey].monthlyCredits,
        period.start,
        period.end,
        subscription.cancel_at_period_end,
        'stripe',
        stripeId(subscription.customer),
        deleted ? null : subscription.id,
        priceId,
        invoiceId,
    ]);
}
function subscriptionPeriod(subscription) {
    const item = subscription.items.data[0];
    return {
        start: item?.current_period_start ? new Date(item.current_period_start * 1_000) : null,
        end: item?.current_period_end ? new Date(item.current_period_end * 1_000) : null,
    };
}
function planKeyForSubscription(config, subscription) {
    const priceId = stripeId(subscription.items.data[0]?.price);
    const entry = Object.keys(PLAN_CATALOG)
        .find((key) => key !== 'FREE' && priceIdForPlanOptional(config, key) === priceId);
    if (entry && entry !== 'FREE')
        return entry;
    const metadataPlanKey = optionalString(subscription.metadata.planKey)?.toUpperCase();
    if (metadataPlanKey && metadataPlanKey !== 'FREE' && metadataPlanKey in PLAN_CATALOG) {
        return metadataPlanKey;
    }
    throw new StripeBillingError(409, 'STRIPE_PRICE_UNMAPPED', `Stripe price ${priceId || '(missing)'} is not mapped.`);
}
function invoiceSubscriptionId(invoice) {
    return stripeId(invoice.parent?.subscription_details?.subscription);
}
function priceIdForPlan(config, planKey) {
    const value = priceIdForPlanOptional(config, planKey);
    if (!value)
        throw new StripeBillingError(503, 'STRIPE_PRICE_NOT_CONFIGURED', `Stripe price for ${planKey} is not configured.`);
    return value;
}
function priceIdForPlanOptional(config, planKey) {
    if (planKey === 'STARTER')
        return config.stripePriceStarterMonthly || null;
    if (planKey === 'PRO')
        return config.stripePriceProMonthly || null;
    return config.stripePriceUltraMonthly || null;
}
function priceIdForPack(config, packKey) {
    const value = packKey === 'CREDITS_20000'
        ? config.stripePriceCredits20000
        : packKey === 'CREDITS_40000'
            ? config.stripePriceCredits40000
            : packKey === 'CREDITS_80000'
                ? config.stripePriceCredits80000
                : config.stripePriceCredits100000;
    if (!value)
        throw new StripeBillingError(503, 'STRIPE_PRICE_NOT_CONFIGURED', `Stripe price for ${packKey} is not configured.`);
    return value;
}
function paidPlanKey(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'STARTER' || normalized === 'PRO' || normalized === 'SCALE')
        return normalized;
    throw new StripeBillingError(400, 'INVALID_PLAN', 'A paid plan is required.');
}
function creditPackKey(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized in CREDIT_PACKS)
        return normalized;
    throw new StripeBillingError(400, 'INVALID_CREDIT_PACK', 'Unknown Credit pack.');
}
function normalizePlanKey(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized in PLAN_CATALOG ? normalized : 'FREE';
}
function requiredStripe(config) {
    if (!config.stripeSecretKey) {
        throw new StripeBillingError(503, 'STRIPE_NOT_CONFIGURED', 'Stripe billing is not configured.');
    }
    return new Stripe(config.stripeSecretKey);
}
function requiredString(value, key) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new StripeBillingError(400, 'INVALID_INPUT', `${key} is required.`);
    }
    return value.trim();
}
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function stripeId(value) {
    if (typeof value === 'string')
        return value;
    if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string')
        return value.id;
    return null;
}
function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}
function checkoutResponse(session) {
    if (!session.url)
        throw new StripeBillingError(502, 'CHECKOUT_URL_MISSING', 'Stripe did not return a Checkout URL.');
    return { id: session.id, url: session.url };
}
function paymentRow(row) {
    return {
        id: String(row.id || ''),
        investorId: String(row.investorId || ''),
        kind: String(row.kind || ''),
        status: String(row.status || ''),
        planKey: optionalString(row.planKey),
        packKey: optionalString(row.packKey),
        creditsGranted: numberValue(row.creditsGranted),
        creditsReversed: numberValue(row.creditsReversed),
        amountTotalCents: numberValue(row.amountTotalCents),
        providerPaymentIntentId: optionalString(row.providerPaymentIntentId),
        providerInvoiceId: optionalString(row.providerInvoiceId),
        providerChargeId: optionalString(row.providerChargeId),
        lifetimeSpentCreditsAtGrant: numberValue(row.lifetimeSpentCreditsAtGrant),
        metadata: isRecord(row.metadata) ? row.metadata : null,
    };
}
