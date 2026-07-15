import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { prisma } from '@/lib/prisma';

const SEMRUSH_PROVIDER = 'SEMRUSH';

function hasPlatformSemrushKey() {
  return Boolean(process.env.SEMRUSH_API_KEY?.trim());
}

function toPayload(integration: { id: string; provider: string; status: string; accountName: string | null; updatedAt: Date } | null) {
  return {
    provider: 'semrush',
    connected: integration?.status === 'CONNECTED',
    status: integration?.status || 'DISABLED',
    accountName: integration?.accountName || 'Semrush teammate',
    updatedAt: integration?.updatedAt?.toISOString() || null,
    platformConfigured: hasPlatformSemrushKey(),
  };
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const integration = await prisma.investorIntegration.findUnique({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: SEMRUSH_PROVIDER,
      },
    },
    select: {
      id: true,
      provider: true,
      status: true,
      accountName: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ integration: toPayload(integration) });
}

export async function PUT() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const integration = await prisma.investorIntegration.upsert({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: SEMRUSH_PROVIDER,
      },
    },
    create: {
      investorId: investor.id,
      provider: SEMRUSH_PROVIDER,
      status: 'CONNECTED',
      accountName: 'Semrush teammate',
      accountEmail: 'platform-provided',
      scope: 'seo,ppc,keywords,backlinks,traffic',
    },
    update: {
      status: 'CONNECTED',
      accountName: 'Semrush teammate',
      accountEmail: 'platform-provided',
      scope: 'seo,ppc,keywords,backlinks,traffic',
      connectedAt: new Date(),
    },
    select: {
      id: true,
      provider: true,
      status: true,
      accountName: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, integration: toPayload(integration) });
}

export async function DELETE() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const integration = await prisma.investorIntegration.upsert({
    where: {
      investorId_provider: {
        investorId: investor.id,
        provider: SEMRUSH_PROVIDER,
      },
    },
    create: {
      investorId: investor.id,
      provider: SEMRUSH_PROVIDER,
      status: 'DISABLED',
      accountName: 'Semrush teammate',
      accountEmail: 'platform-provided',
      scope: 'seo,ppc,keywords,backlinks,traffic',
    },
    update: {
      status: 'DISABLED',
    },
    select: {
      id: true,
      provider: true,
      status: true,
      accountName: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, integration: toPayload(integration) });
}
