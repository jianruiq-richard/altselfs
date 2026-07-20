ALTER TABLE "agent_threads"
ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS "agent_threads_investorId_agentType_status_updatedAt_idx"
ON "agent_threads"("investorId", "agentType", "status", "updatedAt");
