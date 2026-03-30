-- Drop unique constraint on users.email to allow independent accounts
-- (e.g. same email reused across different auth identities/roles)
DROP INDEX IF EXISTS "users_email_key";

-- Keep query performance for email lookups without uniqueness constraint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
