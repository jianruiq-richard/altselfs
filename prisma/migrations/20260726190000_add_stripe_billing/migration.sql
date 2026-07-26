ALTER TABLE "credit_subscriptions"
ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "scheduledPlanKey" TEXT,
ADD COLUMN "graceEndsAt" TIMESTAMP(3),
ADD COLUMN "providerPriceId" TEXT,
ADD COLUMN "latestInvoiceId" TEXT;

UPDATE "credit_subscriptions"
SET "monthlyCredits" = 0
WHERE "planKey" = 'FREE';

CREATE TABLE "credit_payments" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "planKey" TEXT,
  "packKey" TEXT,
  "creditsGranted" INTEGER NOT NULL DEFAULT 0,
  "creditsReversed" INTEGER NOT NULL DEFAULT 0,
  "amountSubtotalCents" INTEGER NOT NULL DEFAULT 0,
  "amountTotalCents" INTEGER NOT NULL DEFAULT 0,
  "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "lifetimeSpentCreditsAtGrant" INTEGER NOT NULL DEFAULT 0,
  "provider" TEXT NOT NULL DEFAULT 'stripe',
  "providerCheckoutSessionId" TEXT,
  "providerPaymentIntentId" TEXT,
  "providerInvoiceId" TEXT,
  "providerChargeId" TEXT,
  "paidAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "investorId" TEXT NOT NULL,
  CONSTRAINT "credit_payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stripe_webhook_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "livemode" BOOLEAN NOT NULL DEFAULT false,
  "objectId" TEXT,
  "error" TEXT,
  "payload" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "investorId" TEXT,
  CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_lots" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "grantedCredits" INTEGER NOT NULL,
  "consumedCredits" INTEGER NOT NULL DEFAULT 0,
  "reversedCredits" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "investorId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "paymentId" TEXT,
  CONSTRAINT "credit_lots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_lot_allocations" (
  "id" TEXT NOT NULL,
  "debitKey" TEXT NOT NULL,
  "amountCredits" INTEGER NOT NULL,
  "runId" TEXT,
  "threadId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "investorId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "lotId" TEXT NOT NULL,
  CONSTRAINT "credit_lot_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_payments_providerCheckoutSessionId_key"
ON "credit_payments"("providerCheckoutSessionId");

CREATE UNIQUE INDEX "credit_payments_providerPaymentIntentId_key"
ON "credit_payments"("providerPaymentIntentId");

CREATE UNIQUE INDEX "credit_payments_providerInvoiceId_key"
ON "credit_payments"("providerInvoiceId");

CREATE INDEX "credit_payments_investorId_createdAt_idx"
ON "credit_payments"("investorId", "createdAt");

CREATE INDEX "credit_payments_status_createdAt_idx"
ON "credit_payments"("status", "createdAt");

CREATE INDEX "credit_payments_providerChargeId_idx"
ON "credit_payments"("providerChargeId");

CREATE INDEX "stripe_webhook_events_status_receivedAt_idx"
ON "stripe_webhook_events"("status", "receivedAt");

CREATE INDEX "stripe_webhook_events_investorId_receivedAt_idx"
ON "stripe_webhook_events"("investorId", "receivedAt");

CREATE UNIQUE INDEX "credit_lots_idempotencyKey_key"
ON "credit_lots"("idempotencyKey");

CREATE UNIQUE INDEX "credit_lots_paymentId_key"
ON "credit_lots"("paymentId");

CREATE INDEX "credit_lots_accountId_status_createdAt_idx"
ON "credit_lots"("accountId", "status", "createdAt");

CREATE INDEX "credit_lots_investorId_createdAt_idx"
ON "credit_lots"("investorId", "createdAt");

CREATE UNIQUE INDEX "credit_lot_allocations_lotId_debitKey_key"
ON "credit_lot_allocations"("lotId", "debitKey");

CREATE INDEX "credit_lot_allocations_accountId_createdAt_idx"
ON "credit_lot_allocations"("accountId", "createdAt");

CREATE INDEX "credit_lot_allocations_investorId_debitKey_idx"
ON "credit_lot_allocations"("investorId", "debitKey");

CREATE INDEX "credit_lot_allocations_runId_idx"
ON "credit_lot_allocations"("runId");

ALTER TABLE "credit_payments"
ADD CONSTRAINT "credit_payments_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stripe_webhook_events"
ADD CONSTRAINT "stripe_webhook_events_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_lots"
ADD CONSTRAINT "credit_lots_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_lots"
ADD CONSTRAINT "credit_lots_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_lots"
ADD CONSTRAINT "credit_lots_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "credit_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_lot_allocations"
ADD CONSTRAINT "credit_lot_allocations_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_lot_allocations"
ADD CONSTRAINT "credit_lot_allocations_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_lot_allocations"
ADD CONSTRAINT "credit_lot_allocations_lotId_fkey"
FOREIGN KEY ("lotId") REFERENCES "credit_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "credit_lots" (
  "id", "sourceType", "status", "grantedCredits", "consumedCredits", "reversedCredits",
  "idempotencyKey", "metadata", "createdAt", "updatedAt", "investorId", "accountId"
)
SELECT
  'migrated_' || a."id",
  'MIGRATED_BALANCE',
  'ACTIVE',
  GREATEST(a."balanceCredits", 0),
  0,
  0,
  'migration:opening-balance:' || a."id",
  jsonb_build_object('reason', 'Opening balance before Credit Lot ledger'),
  a."createdAt",
  CURRENT_TIMESTAMP,
  a."investorId",
  a."id"
FROM "credit_accounts" a
WHERE a."balanceCredits" > 0;
