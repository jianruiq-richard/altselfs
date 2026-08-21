import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { prisma } from '@/lib/prisma';

type CompetitiveDataSourceProvider =
  | 'instagram_looter2'
  | 'similarweb_api1'
  | 'semrush13'
  | 'semrush8'
  | 'ahrefs_url_research'
  | 'domain_metrics_check'
  | 'appark';

type RouteParams = {
  params: Promise<{ provider: string }>;
};

const COMPETITIVE_DATA_SOURCES: Record<CompetitiveDataSourceProvider, {
  dbProvider: string;
  label: string;
  scope: string;
}> = {
  instagram_looter2: {
    dbProvider: 'INSTAGRAM_LOOTER2',
    label: 'Instagram Competitive Activity',
    scope: 'profile_resolution,official_posts,reels,tagged_koc_candidates,engagement,promotion_signals',
  },
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
  ahrefs_url_research: {
    dbProvider: 'AHREFS_URL_RESEARCH',
    label: 'Ahrefs URL Research',
    scope: 'url_metrics,authority,backlinks,referring_domains,organic_keywords,organic_traffic',
  },
  domain_metrics_check: {
    dbProvider: 'DOMAIN_METRICS_CHECK',
    label: 'Domain Metrics Check',
    scope: 'moz,majestic,ahrefs_style_metrics,authority,backlinks,referring_domains',
  },
  appark: {
    dbProvider: 'APPARK',
    label: 'Appark',
    scope: 'mobile_app_search,app_metadata,ratings,downloads,revenue_estimates,country_split,competitors',
  },
};

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
    platformConfigured: true,
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
