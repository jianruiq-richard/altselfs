import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import InvestorIntegrationsPanel from '@/components/investor-integrations-panel';
import InvestorWechatSourcesPanel from '@/components/investor-wechat-sources-panel';

export default async function InfoOpsPage({
  searchParams,
}: {
  searchParams: Promise<{
    integrationStatus?: string;
    integrationProvider?: string;
    integrationDetail?: string;
    feishuPhase?: string;
    feishuSetupUrl?: string;
    feishuAuthUrl?: string;
    feishuUserCode?: string;
    assistant?: string;
  }>;
}) {
  const { userId } = await auth();
  const query = await searchParams;
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
      role: true,
      integrations: {
        select: {
          provider: true,
          accountEmail: true,
          accountName: true,
          status: true,
          updatedAt: true,
          snapshots: {
            select: {
              summary: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      wechatSources: {
        select: {
          id: true,
          biz: true,
          displayName: true,
          description: true,
          lastArticleUrl: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  if (!dbUser) redirect('/dashboard/setup?role=investor');

  const integrationMap = new Map(dbUser.integrations.map((it) => [it.provider, it]));
  const initialWechatSources = dbUser.wechatSources.map((source) => ({
    id: source.id,
    biz: source.biz,
    displayName: source.displayName,
    description: source.description || '',
    lastArticleUrl: source.lastArticleUrl,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  }));

  const providerDbMap = {
    gmail: 'GMAIL',
    feishu: 'FEISHU',
    meta: 'META',
    xiaohongshu: 'XIAOHONGSHU',
    similarweb_api1: 'SIMILARWEB_API1',
    semrush13: 'SEMRUSH13',
    semrush8: 'SEMRUSH8',
    domain_metrics_check: 'DOMAIN_METRICS_CHECK',
  } as const;

  const rapidApiConfigured = Boolean(process.env.RAPIDAPI_KEY?.trim());
  const integrationCards = (Object.keys(providerDbMap) as Array<keyof typeof providerDbMap>).map((provider) => {
    const dbProvider = providerDbMap[provider];
    const integration = integrationMap.get(dbProvider);
    const latest = integration?.snapshots[0];
    return {
      provider,
      connected: integration?.status === 'CONNECTED',
      accountEmail: integration?.accountEmail || null,
      accountName: integration?.accountName || null,
      updatedAt: integration?.updatedAt.toISOString() || null,
      latestSummary: latest?.summary || null,
      latestSummaryAt: latest?.createdAt.toISOString() || null,
      platformConfigured: isCompetitiveDataSource(provider) ? rapidApiConfigured : undefined,
    };
  });

  const assistantHint: Record<string, string> = {
    gmail: 'content Gmail contentRefresh summary.',
    feishu: 'content content contentRefresh summary.',
    meta: 'contentConnect Instagram / Facebook contentaccounts, content AI contentAuthorized assets.',
    wechat: 'content, contentWeChat Assistantcontent.',
    xiaohongshu: 'content, contentXiaohongshu Assistant.',
    semrush: 'contentteammatecontent, content AI contenttool.',
  };

  return (
    <FigmaShell homeHref="/dashboard" title="Information Operationscontent" subtitle="content, content, Gmail, content, Instagram / Facebook content">
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">{assistantHint[query.assistant || ''] || 'contentCompleteInformation OperationscontentAllcontent.'}</p>
        <Link href="/dashboard" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to workspace
        </Link>
      </div>

      <InvestorIntegrationsPanel
        initialCards={integrationCards}
        integrationStatus={query.integrationStatus}
        integrationProvider={query.integrationProvider}
        integrationDetail={query.integrationDetail}
        feishuPhase={query.feishuPhase}
        feishuSetupUrl={query.feishuSetupUrl}
        feishuAuthUrl={query.feishuAuthUrl}
        feishuUserCode={query.feishuUserCode}
      />

      <InvestorWechatSourcesPanel initialSources={initialWechatSources} />
    </FigmaShell>
  );
}

function isCompetitiveDataSource(provider: string) {
  return provider === 'similarweb_api1'
    || provider === 'semrush13'
    || provider === 'semrush8'
    || provider === 'domain_metrics_check';
}
