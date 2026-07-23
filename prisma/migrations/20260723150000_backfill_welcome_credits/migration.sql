-- Create billing records for existing users. New users continue to receive the
-- same grant lazily through personal-agent-server.
INSERT INTO "credit_accounts" (
  "id",
  "balanceCredits",
  "reservedCredits",
  "lifetimeGrantedCredits",
  "lifetimeSpentCredits",
  "lifetimeRefundedCredits",
  "createdAt",
  "updatedAt",
  "investorId"
)
SELECT
  'credit_account_' || md5(u."id"),
  0,
  0,
  0,
  0,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  u."id"
FROM "users" u
ON CONFLICT ("investorId") DO NOTHING;

INSERT INTO "credit_subscriptions" (
  "id",
  "planKey",
  "status",
  "monthlyCredits",
  "createdAt",
  "updatedAt",
  "investorId"
)
SELECT
  'credit_subscription_' || md5(u."id"),
  'FREE',
  'ACTIVE',
  1000,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  u."id"
FROM "users" u
ON CONFLICT ("investorId") DO NOTHING;

WITH eligible_accounts AS (
  SELECT
    a."id" AS "accountId",
    a."investorId"
  FROM "credit_accounts" a
  WHERE NOT EXISTS (
    SELECT 1
    FROM "credit_ledger_entries" l
    WHERE l."idempotencyKey" = 'welcome:' || a."investorId"
  )
  FOR UPDATE
),
updated_accounts AS (
  UPDATE "credit_accounts" a
  SET
    "balanceCredits" = a."balanceCredits" + 1000,
    "lifetimeGrantedCredits" = a."lifetimeGrantedCredits" + 1000,
    "updatedAt" = CURRENT_TIMESTAMP
  FROM eligible_accounts e
  WHERE a."id" = e."accountId"
  RETURNING
    a."id" AS "accountId",
    a."investorId",
    a."balanceCredits",
    a."reservedCredits"
)
INSERT INTO "credit_ledger_entries" (
  "id",
  "type",
  "amountCredits",
  "reservedDeltaCredits",
  "balanceAfterCredits",
  "reservedAfterCredits",
  "description",
  "idempotencyKey",
  "metadata",
  "createdAt",
  "investorId",
  "accountId"
)
SELECT
  'credit_ledger_welcome_' || md5(a."investorId"),
  'WELCOME_GRANT',
  1000,
  0,
  a."balanceCredits",
  a."reservedCredits",
  'Welcome credits',
  'welcome:' || a."investorId",
  '{"pricingVersion":"2026-07-v1","source":"existing_user_backfill"}'::jsonb,
  CURRENT_TIMESTAMP,
  a."investorId",
  a."accountId"
FROM updated_accounts a
ON CONFLICT ("idempotencyKey") DO NOTHING;
