-- CreateTable
CREATE TABLE "investor_integrations" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "accountEmail" TEXT,
    "accountName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "investorId" TEXT NOT NULL,

    CONSTRAINT "investor_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_snapshots" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integrationId" TEXT NOT NULL,

    CONSTRAINT "integration_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_integrations_investorId_provider_key" ON "investor_integrations"("investorId", "provider");

-- CreateIndex
CREATE INDEX "investor_integrations_provider_updatedAt_idx" ON "investor_integrations"("provider", "updatedAt");

-- CreateIndex
CREATE INDEX "integration_snapshots_integrationId_createdAt_idx" ON "integration_snapshots"("integrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "investor_integrations" ADD CONSTRAINT "investor_integrations_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_snapshots" ADD CONSTRAINT "integration_snapshots_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "investor_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
