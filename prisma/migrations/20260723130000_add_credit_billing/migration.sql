CREATE TABLE "credit_accounts" (
  "id" TEXT NOT NULL,
  "balanceCredits" INTEGER NOT NULL DEFAULT 0,
  "reservedCredits" INTEGER NOT NULL DEFAULT 0,
  "lifetimeGrantedCredits" INTEGER NOT NULL DEFAULT 0,
  "lifetimeSpentCredits" INTEGER NOT NULL DEFAULT 0,
  "lifetimeRefundedCredits" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "investorId" TEXT NOT NULL,
  CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_subscriptions" (
  "id" TEXT NOT NULL,
  "planKey" TEXT NOT NULL DEFAULT 'FREE',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "monthlyCredits" INTEGER NOT NULL DEFAULT 0,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "provider" TEXT,
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "investorId" TEXT NOT NULL,
  CONSTRAINT "credit_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_reservations" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "mode" TEXT NOT NULL DEFAULT 'OBSERVE',
  "hermesModel" TEXT,
  "estimatedCredits" INTEGER NOT NULL,
  "reservedCredits" INTEGER NOT NULL DEFAULT 0,
  "capturedCredits" INTEGER NOT NULL DEFAULT 0,
  "shortfallCredits" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "investorId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "threadId" TEXT,
  CONSTRAINT "credit_reservations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_ledger_entries" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountCredits" INTEGER NOT NULL DEFAULT 0,
  "reservedDeltaCredits" INTEGER NOT NULL DEFAULT 0,
  "balanceAfterCredits" INTEGER NOT NULL,
  "reservedAfterCredits" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "runId" TEXT,
  "threadId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "investorId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "reservationId" TEXT,
  CONSTRAINT "credit_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_usage_records" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECORDED',
  "hermesModel" TEXT,
  "codexModel" TEXT,
  "hermesCostUsd" DECIMAL(16,8) NOT NULL DEFAULT 0,
  "hermesCredits" INTEGER NOT NULL DEFAULT 0,
  "codexCredits" INTEGER NOT NULL DEFAULT 0,
  "computedCredits" INTEGER NOT NULL DEFAULT 0,
  "billedCredits" INTEGER NOT NULL DEFAULT 0,
  "usage" JSONB NOT NULL,
  "pricingVersion" TEXT NOT NULL DEFAULT '2026-07-v1',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "investorId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "threadId" TEXT,
  CONSTRAINT "agent_usage_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "credit_accounts_investorId_key" ON "credit_accounts"("investorId");
CREATE UNIQUE INDEX "credit_subscriptions_investorId_key" ON "credit_subscriptions"("investorId");
CREATE INDEX "credit_subscriptions_status_currentPeriodEnd_idx" ON "credit_subscriptions"("status", "currentPeriodEnd");
CREATE UNIQUE INDEX "credit_reservations_runId_key" ON "credit_reservations"("runId");
CREATE INDEX "credit_reservations_accountId_status_expiresAt_idx" ON "credit_reservations"("accountId", "status", "expiresAt");
CREATE INDEX "credit_reservations_investorId_createdAt_idx" ON "credit_reservations"("investorId", "createdAt");
CREATE INDEX "credit_reservations_threadId_createdAt_idx" ON "credit_reservations"("threadId", "createdAt");
CREATE UNIQUE INDEX "credit_ledger_entries_idempotencyKey_key" ON "credit_ledger_entries"("idempotencyKey");
CREATE INDEX "credit_ledger_entries_accountId_createdAt_idx" ON "credit_ledger_entries"("accountId", "createdAt");
CREATE INDEX "credit_ledger_entries_investorId_createdAt_idx" ON "credit_ledger_entries"("investorId", "createdAt");
CREATE INDEX "credit_ledger_entries_runId_idx" ON "credit_ledger_entries"("runId");
CREATE UNIQUE INDEX "agent_usage_records_runId_key" ON "agent_usage_records"("runId");
CREATE INDEX "agent_usage_records_accountId_createdAt_idx" ON "agent_usage_records"("accountId", "createdAt");
CREATE INDEX "agent_usage_records_investorId_createdAt_idx" ON "agent_usage_records"("investorId", "createdAt");
CREATE INDEX "agent_usage_records_threadId_createdAt_idx" ON "agent_usage_records"("threadId", "createdAt");

ALTER TABLE "credit_accounts"
  ADD CONSTRAINT "credit_accounts_investorId_fkey"
  FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_subscriptions"
  ADD CONSTRAINT "credit_subscriptions_investorId_fkey"
  FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_reservations"
  ADD CONSTRAINT "credit_reservations_investorId_fkey"
  FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_reservations"
  ADD CONSTRAINT "credit_reservations_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_investorId_fkey"
  FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_ledger_entries"
  ADD CONSTRAINT "credit_ledger_entries_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "credit_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "agent_usage_records"
  ADD CONSTRAINT "agent_usage_records_investorId_fkey"
  FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_usage_records"
  ADD CONSTRAINT "agent_usage_records_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "credit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
