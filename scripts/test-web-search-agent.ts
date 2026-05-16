import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });
process.env.OPENROUTER_TRACE_ENABLED = process.env.OPENROUTER_TRACE_ENABLED || 'true';

const email = process.argv[2] || 'jianruiq@gmail.com';
const query = process.argv.slice(3).join(' ') || '更新今日晨报，补充最近24小时公开网络信息';
let disconnectPrisma: (() => Promise<void>) | null = null;

function buildSearchIntent(userQuery: string, systemPrompt: string) {
  return [
    '检索最近24小时公开网络信息，用于补充总裁秘书晨报。',
    `用户命令：${userQuery}`,
    `总裁秘书system prompt / 偏好：${systemPrompt.slice(0, 1600)}`,
    '重点关注：一人公司、OPC、AI agent、vibe coding、AI模型新技术或文章、开发者工具及相关产品动态。',
    '必须按行业动态、技术趋势、竞品监控三个模块整理，并保留来源URL。',
  ].join('\n');
}

async function main() {
  const [{ prisma }, { runWebSearchAgent }, { EXECUTIVE_MOMO_SYSTEM_PROMPT }] = await Promise.all([
    import('@/lib/prisma'),
    import('@/lib/agents/web-search-agent'),
    import('@/lib/prompts/executive-momo'),
  ]);
  disconnectPrisma = () => prisma.$disconnect();

  const investor = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      agentConfigs: {
        where: { agentType: 'EXECUTIVE' },
        select: { systemPrompt: true },
        take: 1,
      },
    },
  });

  if (!investor) {
    throw new Error(`未找到用户：${email}`);
  }

  const systemPrompt = investor.agentConfigs[0]?.systemPrompt?.trim() || EXECUTIVE_MOMO_SYSTEM_PROMPT;
  const now = new Date();
  const taskSpec = {
    objective: '联网检索并整理最近24小时内与总裁关注主题相关的公开信息，补充晨报。',
    sourceSelectionCriteria: [
      query,
      systemPrompt,
      'AI agent',
      'vibe coding',
      '一人公司',
      'OPC',
      'AI模型',
      '开发者工具',
      '产品发布',
      '竞品动态',
    ],
    timeWindow: {
      type: 'rolling_hours' as const,
      hours: 24,
      endAt: now.toISOString(),
    },
    returnFormat: {
      sections: ['行业动态', '技术趋势', '竞品监控'],
      instructions: '按三个模块返回结构化结果；每条信息必须有来源，能拿到URL时必须提供URL。',
    },
  };

  const input = {
    investorId: investor.id,
    userQuery: query,
    mode: 'briefing' as const,
    context: {
      webSearchIntent: buildSearchIntent(query, systemPrompt),
      subagentResults: [],
      taskSpec,
    },
  };

  const startedAt = Date.now();
  const result = await runWebSearchAgent(input);
  const report = {
    testedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    email: investor.email,
    investorId: investor.id,
    model: process.env.OPENROUTER_MODEL_WEB_SEARCH || 'default',
    systemPromptPreview: systemPrompt.slice(0, 1200),
    input,
    result,
  };

  const dir = path.join(process.cwd(), '.debug');
  await mkdir(dir, { recursive: true });
  const filename = `web-search-agent-test-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(dir, filename);
  await writeFile(filepath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    filepath,
    durationMs: report.durationMs,
    itemCount: result.briefingItems.length,
    answer: result.answer,
    debug: result.debug,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma?.();
  });
