ALTER TABLE "chats"
ADD COLUMN "qualificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "qualificationScore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "qualificationReason" TEXT,
ADD COLUMN "needsInvestorReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastEvaluatedAt" TIMESTAMP(3);

CREATE INDEX "chats_candidateId_avatarId_status_idx" ON "chats"("candidateId", "avatarId", "status");
CREATE INDEX "chats_avatarId_qualificationStatus_needsInvestorReview_idx" ON "chats"("avatarId", "qualificationStatus", "needsInvestorReview");
