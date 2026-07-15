import { config as loadEnv } from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });
process.env.OPENROUTER_TRACE_ENABLED = process.env.OPENROUTER_TRACE_ENABLED || 'true';

const email = process.argv[2] || 'jianruiq@gmail.com';
const query = process.argv.slice(3).join(' ') || 'What happened today in AI agent startups over the last 24 hours?';
let disconnectPrisma: (() => Promise<void>) | null = null;

function buildSearchIntent(userQuery: string, systemPrompt: string) {
  return [
    'Run a 24-hour public web scan for the Executive Assistant.',
    `User query: ${userQuery}`,
    `Executive Assistant system prompt / instructions: ${systemPrompt.slice(0, 1600)}`,
    'Focus: startups, OPC, AI agents, vibe coding, technical releases, and agent tooling.',
    'Return concise technical signals with source URLs.',
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
    throw new Error(`Investor not found: ${email}`);
  }

  const systemPrompt = investor.agentConfigs[0]?.systemPrompt?.trim() || EXECUTIVE_MOMO_SYSTEM_PROMPT;
  const now = new Date();
  const taskSpec = {
    objective: 'Find high-signal AI agent startup and tooling updates from the last 24 hours.',
    sourceSelectionCriteria: [
      query,
      systemPrompt,
      'AI agent',
      'vibe coding',
      'startup',
      'OPC',
      'AI engineering',
      'agent tooling',
      'technical release',
      'funding or customer traction',
    ],
    timeWindow: {
      type: 'rolling_hours' as const,
      hours: 24,
      endAt: now.toISOString(),
    },
    returnFormat: {
      sections: ['Market Signals', 'Technical Updates', 'Action Items'],
      instructions: 'Prioritize credible sources; include concise summaries and source URLs.',
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
