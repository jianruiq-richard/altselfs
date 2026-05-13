-- AlterTable
ALTER TABLE "investor_wechat_sources"
ADD COLUMN "profile" JSONB,
ADD COLUMN "profileUpdatedAt" TIMESTAMP(3),
ADD COLUMN "profileConfidence" DOUBLE PRECISION,
ADD COLUMN "lastProfileEvidence" JSONB,
ADD COLUMN "lastScannedAt" TIMESTAMP(3);
