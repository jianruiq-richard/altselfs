CREATE TABLE "executive_assistant_runs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "request" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "planner" JSONB,
    "plannerTrace" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "investorId" TEXT NOT NULL,

    CONSTRAINT "executive_assistant_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "executive_assistant_runs_investorId_createdAt_idx" ON "executive_assistant_runs"("investorId", "createdAt");
CREATE INDEX "executive_assistant_runs_status_updatedAt_idx" ON "executive_assistant_runs"("status", "updatedAt");

ALTER TABLE "executive_assistant_runs"
ADD CONSTRAINT "executive_assistant_runs_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
