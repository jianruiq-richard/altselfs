import { NextResponse } from 'next/server';
import {
  COMPETITIVE_DATA_SOURCES,
  toCompetitiveDataSourceProvider,
  type CompetitiveDataSourceProvider,
} from '@/lib/competitive-data-sources';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { prisma } from '@/lib/prisma';

type RouteParams = {
  params: Promise<{ provider: string }>;
};

function toPayload(
  provider: CompetitiveDataSourceProvider,
  integration: { id: string; status: string; accountName: string | null; updatedAt: Date } | null
) {
  const config = COMPETITIVE_DATA_SOURCES[provider];
  return {
    provider,
    connected: integration?.status === 'CONNECTED',
    status: integration?.status || 'DISABLED',
    accountName: integration?.accountName || config.accountName,
    updatedAt: integration?.updatedAt?.toISOString() || null,
    platformConfigured: true,
  };
}

async function getProvider(ctx: RouteParams) {
  const { provider } = await ctx.params;
  return toCompetitiveDataSourceProvider(provider);
}

export async function GET(_req: Request, ctx: RouteParams) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const provider = await getProvider(ctx);
  if (!provider) return NextResponse.json({ error: 'Unsupported competitive data source' }, { status: 404 });
  const config = COMPETITIVE_DATA_SOURCES[provider];

  const integration = await prisma.investorIntegration.findUnique({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: config.dbProvider,
      },
    },
    select: {
      id: true,
      status: true,
      accountName: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ integration: toPayload(provider, integration) });
}

export async function PUT(_req: Request, ctx: RouteParams) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const provider = await getProvider(ctx);
  if (!provider) return NextResponse.json({ error: 'Unsupported competitive data source' }, { status: 404 });
  const config = COMPETITIVE_DATA_SOURCES[provider];

  const integration = await prisma.investorIntegration.upsert({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: config.dbProvider,
      },
    },
    create: {
      investorId: investor.id,
      provider: config.dbProvider,
      status: 'CONNECTED',
      accountName: config.accountName,
      accountEmail: 'platform-provided',
      scope: config.scope,
      connectedAt: new Date(),
    },
    update: {
      status: 'CONNECTED',
      accountName: config.accountName,
      accountEmail: 'platform-provided',
      scope: config.scope,
      connectedAt: new Date(),
    },
    select: {
      id: true,
      status: true,
      accountName: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, integration: toPayload(provider, integration) });
}

export async function DELETE(_req: Request, ctx: RouteParams) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const provider = await getProvider(ctx);
  if (!provider) return NextResponse.json({ error: 'Unsupported competitive data source' }, { status: 404 });
  const config = COMPETITIVE_DATA_SOURCES[provider];

  const integration = await prisma.investorIntegration.upsert({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: config.dbProvider,
      },
    },
    create: {
      investorId: investor.id,
      provider: config.dbProvider,
      status: 'DISABLED',
      accountName: config.accountName,
      accountEmail: 'platform-provided',
      scope: config.scope,
    },
    update: {
      status: 'DISABLED',
    },
    select: {
      id: true,
      status: true,
      accountName: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, integration: toPayload(provider, integration) });
}
