import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';

const EMAIL = process.argv[2] || 'jianruiq@163.com';
const OUT_DIR = process.argv[3] || 'docs';

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function mdJson(value: unknown) {
  return `\n\`\`\`json\n${stringify(value)}\n\`\`\`\n`;
}

function mdText(value: unknown) {
  return `\n\`\`\`text\n${typeof value === 'string' ? value : stringify(value)}\n\`\`\`\n`;
}

function compact(value: unknown, limit = 1800) {
  const raw = typeof value === 'string' ? value : stringify(value);
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit)}\n...[truncated in markdown; see raw JSON file for full content]`;
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: EMAIL },
    select: { id: true, email: true, clerkId: true, createdAt: true, updatedAt: true },
  });
  if (!user) throw new Error(`User not found: ${EMAIL}`);

  const thread = await prisma.agentThread.findFirst({
    where: { investorId: user.id, agentType: 'EXECUTIVE' },
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      toolCalls: {
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });
  if (!thread) throw new Error(`No EXECUTIVE thread found for ${EMAIL}`);

  const dynamicPlannerCalls = thread.toolCalls.filter((item) => item.toolName === 'executive_dynamic_planner');
  const targetCall =
    dynamicPlannerCalls.find((item) => {
      const result = asRecord(item.toolResult);
      return Boolean(result.document || result.subagents || result.plannerTrace);
    }) || dynamicPlannerCalls[0] || thread.toolCalls[0];
  if (!targetCall) throw new Error(`No tool call found for latest EXECUTIVE thread ${thread.id}`);

  const result = asRecord(targetCall.toolResult);
  const args = asRecord(targetCall.toolArgs);
  const document = asRecord(result.document);
  const plannerTrace = asArray(result.plannerTrace);
  const subagents = asArray(result.subagents);
  const toolCalls = asArray(result.toolCalls);
  const latestAssistant = thread.messages.find((item) => item.role === 'ASSISTANT');
  const latestUser = thread.messages.find((item) => item.role === 'USER');

  const briefing = await prisma.executiveBriefing.findFirst({
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
      'This export contains data persisted in the local database. Raw model prompts and raw model completions were not persisted for this historical run.',
    user,
    thread: {
      id: thread.id,
      agentType: thread.agentType,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    },
    selectedtoolCall: targetCall,
    latestMessages: thread.messages,
    latestPersistedBriefing: briefing,
    executiveAgentConfig: config,
    wechatSources: sources,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `executive-briefing-run-audit-${stamp}`;
  const rawPath = path.join(OUT_DIR, `${baseName}.raw.json`);
  const mdPath = path.join(OUT_DIR, `${baseName}.md`);
  writeFileSync(rawPath, stringify(raw), 'utf8');

  const markdown = [
    '# Executive Briefing Run Audit',
    '',
    `- Exported at: ${raw.exportedAt}`,
    `- User: ${user.email} (${user.id})`,
    `- Thread: ${thread.id}`,
    `- Selected tool call: ${targetCall.toolName} / ${targetCall.status} / ${targetCall.createdAt.toISOString()}`,
    `- Raw JSON: ${rawPath}`,
    '',
    '## Important Limitation',
    '',
    'content.contentSavecontent raw prompt content raw completion, content 100% content planner, summary, structurer, reply content.',
    '',
    'content: content, plannerTrace, content subagent content, contenttoolcontent, content document, content assistant content, content, content profile.',
    '',
    '## User Request',
    mdText(args.userQuery || latestUser?.content || ''),
    '',
    '## Latest Assistant Reply',
    mdText(latestAssistant?.content || ''),
    '',
    '## Planner Trace',
    mdJson(plannerTrace),
    '',
    '## Subagent Results',
    mdJson(subagents),
    '',
    '## WeChat tool Calls',
    mdJson(toolCalls),
    '',
    '## Final Document',
    mdJson(document),
    '',
    '## Latest Persisted Briefing',
    mdJson(briefing),
    '',
    '## Executive Agent Config',
    mdJson({
      agentType: config?.agentType,
      hasCustomPrompt: Boolean(config?.systemPrompt),
      systemPrompt: config?.systemPrompt,
    }),
    '',
    '## WeChat Sources',
    mdJson(
      sources.map((source) => ({
        id: source.id,
        displayName: source.displayName,
        biz: source.biz,
        description: source.description,
        lastArticleUrl: source.lastArticleUrl,
        profile: source.profile,
        profileUpdatedAt: source.profileUpdatedAt,
        profileConfidence: source.profileConfidence,
        lastScannedAt: source.lastScannedAt,
      }))
    ),
    '',
    '## Quick Diagnosis',
    '',
    [
      '- content subagent contenttoolcontent, content `Subagent Results` content `WeChat tool Calls`.',
      '- content, content, content `generate_briefing_summary` content `structure_briefing_json` contentSave raw prompt/raw output, content summary content 24 content sources content, content.',
      '- content, content"contentDecide", content.',
      '- content, content prompt, model, raw output, duration, error.',
    ].join('\n'),
    '',
    '## Markdown Compact Preview',
    '',
    'content document content, content raw JSON.',
    mdText(compact(document, 5000)),
    '',
  ].join('\n');

  writeFileSync(mdPath, markdown, 'utf8');
  console.log(JSON.stringify({ mdPath, rawPath }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
