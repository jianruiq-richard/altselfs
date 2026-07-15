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
    gmail: '当前建议先配置 Gmail 助手并刷新摘要。',
    feishu: '当前建议先配置 飞书 助手并刷新摘要。',
    meta: '当前建议先绑定 Instagram / Facebook 运营账号，再让主 AI 助手按需读取授权资产。',
    wechat: '当前建议先录入公众号，再使用公众号助手对话。',
    xiaohongshu: '当前建议先接入小红书数据源，再启用小红书助手。',
    semrush: '启用竞品数据源员工后，主 AI 助手会在竞品情报问题中自动使用对应工具。',
  };

  return (
    <FigmaShell homeHref="/dashboard" title="信息处理运营部门管理" subtitle="统一管理公众号、小红书、Gmail、飞书、Instagram / Facebook 助手与录入流程">
      <div className="mb-6 flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">{assistantHint[query.assistant || ''] || '在这里完成信息处理运营部门的全部配置与调试。'}</p>
        <Link href="/dashboard" className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回工作台
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
