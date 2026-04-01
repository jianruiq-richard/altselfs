-- CreateTable
CREATE TABLE "agent_threads" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "investorId" TEXT NOT NULL,

    CONSTRAINT "agent_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" TEXT NOT NULL,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_calls" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "toolArgs" JSONB,
    "toolResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT,

    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_threads_investorId_agentType_updatedAt_idx" ON "agent_threads"("investorId", "agentType", "updatedAt");

-- CreateIndex
CREATE INDEX "agent_messages_threadId_createdAt_idx" ON "agent_messages"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_tool_calls_threadId_createdAt_idx" ON "agent_tool_calls"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_tool_calls_messageId_idx" ON "agent_tool_calls"("messageId");

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_investorId_fkey" FOREIGN KEY ("investorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "agent_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
