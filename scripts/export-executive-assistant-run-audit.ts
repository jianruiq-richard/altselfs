import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';

const EMAIL = process.argv[2] || 'jianruiq@gmail.com';
const OUT_DIR = process.argv[3] || 'docs';
const STATUS = process.argv[4] || 'SUCCESS';
const RUN_ID = process.argv[5];

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, email: true, clerkId: true, createdAt: true, updatedAt: true },
  });
  if (!user) throw new Error(`User not found: ${EMAIL}`);

  const run = RUN_ID
    ? await prisma.executiveAssistantRun.findFirst({
        where: { id: RUN_ID, investorId: user.id },
      })
    : await prisma.executiveAssistantRun.findFirst({
        where: { investorId: user.id, status: STATUS },
        orderBy: { completedAt: 'desc' },
      });
  if (!run) throw new Error(`No ${STATUS} executive assistant run found for ${EMAIL}`);

  const result = asRecord(run.result);
  const persistedFromRun = asRecord(result.persistedBriefing);
  const document = Object.keys(persistedFromRun).length > 0
    ? {
        dateKey: persistedFromRun.dateKey,
        title: persistedFromRun.title,
        summary: persistedFromRun.summary,
        sections: persistedFromRun.sections,
        sources: persistedFromRun.sources,
        calledAgents: [],
      }
    : asRecord(result.document);
  const request = asRecord(run.request);
  const messages = asArray(request.messages);
  const userMessage = messages.find((value) => asRecord(value).role === 'user');
  const resultMessages = asArray(result.messages);
  const resultAssistantMessage = resultMessages.find((value) => asRecord(value).role === 'assistant');
  const responseText =
    typeof result.reply === 'string'
      ? result.reply
      : typeof result.response === 'string'
        ? result.response
        : typeof asRecord(resultAssistantMessage).content === 'string'
          ? String(asRecord(resultAssistantMessage).content)
          : '';

  const briefing =
    Object.keys(persistedFromRun).length > 0
      ? persistedFromRun
      : await prisma.executiveBriefing.findFirst({
          where: { investorId: user.id },
          orderBy: { updatedAt: 'desc' },
        });
  const config = await prisma.investorAgentConfig.findUnique({
    where: { investorId_agentType: { investorId: user.id, agentType: 'EXECUTIVE' } },
  });
  const sources = await prisma.investorWechatSource.findMany({
    where: { investorId: user.id },
    orderBy: { displayName: 'asc' },
  });

  const raw = {
    exportedAt: new Date().toISOString(),
    limitation:
      'This export contains data persisted in executive_assistant_runs and related tables. Raw model prompts and raw model completions are only available if an OpenRouter trace file is supplied to the replay generator.',
    user,
    thread: {
      id: `executive-assistant-run:${run.id}`,
      agentType: 'EXECUTIVE',
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    selectedtoolCall: {
      id: run.id,
      toolName: 'executive_dynamic_planner',
      status: run.status,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      toolArgs: {
        userQuery: typeof asRecord(userMessage).content === 'string' ? asRecord(userMessage).content : '',
        threadId: request.threadId ?? null,
        asyncRunId: run.id,
      },
      toolResult: {
        ...result,
        document,
        subagents: asArray(result.subagents),
        toolCalls: asArray(result.toolCalls),
        planner: run.planner,
        plannerTrace: run.plannerTrace || result.plannerTrace || [],
      },
    },
    latestMessages: [
      userMessage
        ? {
            id: `${run.id}:user`,
            role: 'USER',
            content: asRecord(userMessage).content,
            createdAt: run.createdAt,
          }
        : null,
      responseText
        ? {
            id: `${run.id}:assistant`,
            role: 'ASSISTANT',
            content: responseText,
            createdAt: run.completedAt || run.updatedAt,
          }
        : null,
    ].filter(Boolean),
    latestPersistedBriefing: briefing,
    executiveAgentConfig: config,
    wechatSources: sources,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const completed = (run.completedAt || run.updatedAt).toISOString().replace(/[:.]/g, '-');
  const status = run.status.toLowerCase();
  const baseName = `executive-assistant-run-${EMAIL.replace(/[^a-zA-Z0-9]+/g, '-')}-${status}-${completed}`;
  const rawPath = path.join(OUT_DIR, `${baseName}.raw.json`);
  writeFileSync(rawPath, stringify(raw), 'utf8');
  console.log(rawPath);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
