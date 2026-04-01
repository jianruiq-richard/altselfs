-- CreateTable
CREATE TABLE "investor_wechat_sources" (
    "id" TEXT NOT NULL,
    "biz" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "lastArticleUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "investorId" TEXT NOT NULL,

    CONSTRAINT "investor_wechat_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investor_wechat_sources_investorId_biz_key" ON "investor_wechat_sources"("investorId", "biz");

-- CreateIndex
CREATE INDEX "investor_wechat_sources_investorId_updatedAt_idx" ON "investor_wechat_sources"("investorId", "updatedAt");

-- AddForeignKey
ALTER TABLE "investor_wechat_sources" ADD CONSTRAINT "investor_wechat_sources_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
