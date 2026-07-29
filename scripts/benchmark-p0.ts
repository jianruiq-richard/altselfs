import { performance } from 'node:perf_hooks';
import { prisma } from '../src/lib/prisma';
import {
  getLatestThreadWithMessages,
  getThreadMessagesPage,
  listAgentThreads,
} from '../src/lib/agent-session';
import { personalAgentInternalFetch } from '../src/lib/personal-agent-internal';

const SAMPLE_COUNT = Number(process.env.BENCHMARK_SAMPLES || 15);
const WARMUP_COUNT = 2;

type Sample = {
  connectorsDb: number;
  connectorsUpstream: number;
  connectorsParallel: number;
  connectorsSequentialModel: number;
  chatBootstrap: number;
  chatStatusRecovery: number | null;
  settingsProfile: number;
  settingsArchive: number;
};

async function timed<T>(work: () => Promise<T>) {
  const startedAt = performance.now();
  const value = await work();
  return { value, duration: performance.now() - startedAt };
}

function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1);
  return ordered[Math.max(0, index)];
}

function summarize(values: number[]) {
  return {
    medianMs: Number(percentile(values, 0.5).toFixed(1)),
    p75Ms: Number(percentile(values, 0.75).toFixed(1)),
    p95Ms: Number(percentile(values, 0.95).toFixed(1)),
    meanMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
  };
}

async function runSample(investor: { id: string; email: string }, threadId: string | null): Promise<Sample> {
  const connectorsDbPromise = timed(() => Promise.all([
    prisma.investorIntegration.findMany({
      where: {
        investorId: investor.id,
        provider: {
          in: ['SIMILARWEB_API1', 'SEMRUSH13', 'SEMRUSH8', 'DOMAIN_METRICS_CHECK', 'XIAOHONGSHU'],
        },
      },
      select: {
        provider: true,
        status: true,
        accountEmail: true,
        accountName: true,
        updatedAt: true,
      },
    }),
    prisma.investorWechatSource.findMany({
      where: { investorId: investor.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, displayName: true, updatedAt: true },
    }),
  ]));
  const connectorsUpstreamPromise = timed(() => {
    const query = new URLSearchParams({
      investorId: investor.id,
      userId: investor.email,
    });
    return personalAgentInternalFetch(
      `/internal/personal-data/accounts?${query.toString()}`,
      {},
      { attempts: 1, timeoutMs: 5000 },
    );
  });
  const [connectorsDb, connectorsUpstream] = await Promise.all([
    connectorsDbPromise,
    connectorsUpstreamPromise,
  ]);

  const chatBootstrap = await timed(async () => {
    await listAgentThreads(investor.id, 'PERSONAL', 100, 'ACTIVE');
    await getLatestThreadWithMessages(investor.id, 'PERSONAL');
  });

  let chatStatusRecovery: number | null = null;
  if (threadId) {
    const status = await timed(async () => {
      await getThreadMessagesPage({
        investorId: investor.id,
        agentType: 'PERSONAL',
        threadId,
        limit: 60,
      });
      const query = new URLSearchParams({
        threadId,
        investorId: investor.id,
        userId: investor.email,
        recentEventLimit: '100',
      });
      const baseUrl = process.env.PERSONAL_AGENT_SERVER_URL?.replace(/\/$/, '');
      if (!baseUrl) throw new Error('PERSONAL_AGENT_SERVER_URL is not configured');
      const response = await fetch(`${baseUrl}/v1/threads/status?${query.toString()}`, {
        cache: 'no-store',
        headers: {
          authorization: `Bearer ${process.env.OPS_AGENT_TOKEN || ''}`,
        },
      });
      await response.arrayBuffer();
    });
    chatStatusRecovery = status.duration;
  }

  const settingsProfile = await timed(() => prisma.user.findUnique({
    where: { id: investor.id },
    select: {
      id: true,
      email: true,
      name: true,
      nickname: true,
      phone: true,
      wechatId: true,
      role: true,
    },
  }));
  const settingsArchive = await timed(() => listAgentThreads(
    investor.id,
    'PERSONAL',
    100,
    'ARCHIVED',
  ));
  return {
    connectorsDb: connectorsDb.duration,
    connectorsUpstream: connectorsUpstream.duration,
    connectorsParallel: Math.max(connectorsDb.duration, connectorsUpstream.duration),
    connectorsSequentialModel: connectorsDb.duration + connectorsUpstream.duration,
    chatBootstrap: chatBootstrap.duration,
    chatStatusRecovery,
    settingsProfile: settingsProfile.duration,
    settingsArchive: settingsArchive.duration,
  };
}

async function main() {
  const investor = await prisma.user.findFirst({
    where: {
      agentThreads: {
        some: {
          agentType: 'PERSONAL',
          status: 'ACTIVE',
        },
      },
    },
    select: {
      id: true,
      email: true,
      agentThreads: {
        where: {
          agentType: 'PERSONAL',
          status: 'ACTIVE',
        },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  }) || await prisma.user.findFirst({
    select: {
      id: true,
      email: true,
      agentThreads: {
        where: {
          agentType: 'PERSONAL',
          status: 'ACTIVE',
        },
        orderBy: { updatedAt: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  });

  if (!investor) throw new Error('No application user is available for the read-only benchmark');
  const threadId = investor.agentThreads[0]?.id || null;

  for (let index = 0; index < WARMUP_COUNT; index += 1) {
    await runSample(investor, threadId);
  }

  const samples: Sample[] = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    samples.push(await runSample(investor, threadId));
  }

  const statusValues = samples
    .map((sample) => sample.chatStatusRecovery)
    .filter((value): value is number => value !== null);
  const sequentialMedian = summarize(samples.map((sample) => sample.connectorsSequentialModel)).medianMs;
  const parallelMedian = summarize(samples.map((sample) => sample.connectorsParallel)).medianMs;

  console.log(JSON.stringify({
    sampleCount: samples.length,
    hasPersonalThread: Boolean(threadId),
    connectors: {
      db: summarize(samples.map((sample) => sample.connectorsDb)),
      upstream: summarize(samples.map((sample) => sample.connectorsUpstream)),
      beforeSequentialModel: summarize(samples.map((sample) => sample.connectorsSequentialModel)),
      afterParallelModel: summarize(samples.map((sample) => sample.connectorsParallel)),
      medianSavedMs: Number((sequentialMedian - parallelMedian).toFixed(1)),
      medianImprovementPercent: Number((((sequentialMedian - parallelMedian) / sequentialMedian) * 100).toFixed(1)),
    },
    chat: {
      messageBootstrap: summarize(samples.map((sample) => sample.chatBootstrap)),
      statusRecovery: statusValues.length > 0 ? summarize(statusValues) : null,
      beforeBlockingModelMedianMs: statusValues.length > 0
        ? Number((
            summarize(samples.map((sample) => sample.chatBootstrap)).medianMs
            + summarize(statusValues).medianMs
          ).toFixed(1))
        : null,
      afterBlockingModelMedianMs: summarize(samples.map((sample) => sample.chatBootstrap)).medianMs,
    },
    settings: {
      profile: summarize(samples.map((sample) => sample.settingsProfile)),
      archive: summarize(samples.map((sample) => sample.settingsArchive)),
      initialRequestGroupsBefore: 3,
      initialRequestGroupsAfter: 1,
      deferredRequestGroups: ['archive', 'billing'],
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
