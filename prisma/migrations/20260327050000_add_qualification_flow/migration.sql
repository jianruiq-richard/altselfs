-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_chats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "qualificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "qualificationScore" INTEGER NOT NULL DEFAULT 0,
    "qualificationReason" TEXT,
    "needsInvestorReview" BOOLEAN NOT NULL DEFAULT false,
    "lastEvaluatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "candidateId" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL,
    CONSTRAINT "chats_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chats_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "avatars" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_chats" ("avatarId", "candidateId", "createdAt", "id", "status", "summary", "title", "updatedAt") SELECT "avatarId", "candidateId", "createdAt", "id", "status", "summary", "title", "updatedAt" FROM "chats";
DROP TABLE "chats";
ALTER TABLE "new_chats" RENAME TO "chats";
CREATE INDEX "chats_candidateId_avatarId_status_idx" ON "chats"("candidateId", "avatarId", "status");
CREATE INDEX "chats_avatarId_qualificationStatus_needsInvestorReview_idx" ON "chats"("avatarId", "qualificationStatus", "needsInvestorReview");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

