-- Add per-investor AI employee configuration.
CREATE TABLE "investor_agent_configs" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "systemPrompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "investorId" TEXT NOT NULL,

    CONSTRAINT "investor_agent_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "investor_agent_configs_investorId_agentType_key" ON "investor_agent_configs"("investorId", "agentType");
CREATE INDEX "investor_agent_configs_agentType_updatedAt_idx" ON "investor_agent_configs"("agentType", "updatedAt");

ALTER TABLE "investor_agent_configs"
ADD CONSTRAINT "investor_agent_configs_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
