-- CreateTable
CREATE TABLE "investor_team_hires" (
  "id" TEXT NOT NULL,
  "teamKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'HIRED',
  "agentName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "investorId" TEXT NOT NULL,

  CONSTRAINT "investor_team_hires_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_team_hires_investorId_teamKey_key"
ON "investor_team_hires"("investorId", "teamKey");

-- CreateIndex
CREATE INDEX "investor_team_hires_investorId_status_updatedAt_idx"
ON "investor_team_hires"("investorId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "investor_team_hires"
ADD CONSTRAINT "investor_team_hires_investorId_fkey"
FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
