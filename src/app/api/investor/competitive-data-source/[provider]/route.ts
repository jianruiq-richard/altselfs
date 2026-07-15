import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { prisma } from '@/lib/prisma';

type CompetitiveDataSourceProvider =
  | 'similarweb_api1'
  | 'semrush13'
  | 'semrush8'
  | 'domain_metrics_check';

type RouteParams = {
  params: Promise<{ provider: string }>;
};

const COMPETITIVE_DATA_SOURCES: Record<CompetitiveDataSourceProvider, {
  dbProvider: string;
  label: string;
  scope: string;
}> = {
  similarweb_api1: {
    dbProvider: 'SIMILARWEB_API1',
    label: 'Similarweb API1',
    scope: 'traffic,trend,countries,devices,sources,keywords,competitors',
  },
  semrush13: {
    dbProvider: 'SEMRUSH13',
    label: 'Semrush13',
    scope: 'traffic,growth,search,countries,devices,journey,backlinks_summary,keywords,competitors',
  },
  semrush8: {
    dbProvider: 'SEMRUSH8',
    label: 'Semrush8',
    scope: 'seo_rank,keywords,traffic,cost,links,url_traffic',
  },
  domain_metrics_check: {
    dbProvider: 'DOMAIN_METRICS_CHECK',
    label: 'Domain Metrics Check',
    scope: 'moz,majestic,ahrefs_style_metrics,authority,backlinks,referring_domains',
  },
};

function hasRapidApiKey() {
  return Boolean(process.env.RAPIDAPI_KEY?.trim());
}

function toProvider(value: string): CompetitiveDataSourceProvider | null {
  return Object.hasOwn(COMPETITIVE_DATA_SOURCES, value) ? (value as CompetitiveDataSourceProvider) : null;
}

function toPayload(
  provider: CompetitiveDataSourceProvider,
  integration: { id: string; status: string; accountName: string | null; updatedAt: Date } | null
) {
  const config = COMPETITIVE_DATA_SOURCES[provider];
  return {
    provider,
    connected: integration?.status === 'CONNECTED',
    status: integration?.status || 'DISABLED',
    accountName: integration?.accountName || `${config.label} teammate`,
    updatedAt: integration?.updatedAt?.toISOString() || null,
    platformConfigured: hasRapidApiKey(),
  };
}

async function getProvider(ctx: RouteParams) {
  const { provider } = await ctx.params;
  return toProvider(provider);
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
      accountName: `${config.label} teammate`,
      accountEmail: 'platform-provided',
      scope: config.scope,
      connectedAt: new Date(),
    },
    update: {
      status: 'CONNECTED',
      accountName: `${config.label} teammate`,
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
      accountName: `${config.label} teammate`,
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
