import { currentUser } from '@clerk/nextjs/server';
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
    assistant?: string;
  }>;
}) {
  const user = await currentUser();
  const query = await searchParams;
  if (!user) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: user.id },
    include: {
      integrations: {
        include: {
          snapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      },
      wechatSources: {
        orderBy: { updatedAt: 'desc' },
      },
    },
  });

  if (!dbUser || dbUser.role !== 'INVESTOR') redirect('/dashboard');

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

  const integrationCards = (['gmail', 'feishu'] as const).map((provider) => {
    const dbProvider = provider === 'gmail' ? 'GMAIL' : 'FEISHU';
    const integration = integrationMap.get(dbProvider);
    const latest = integration?.snapshots[0];
    return {
      provider,
      connected: Boolean(integration),
      accountEmail: integration?.accountEmail || null,
      accountName: integration?.accountName || null,
      updatedAt: integration?.updatedAt.toISOString() || null,
      latestSummary: latest?.summary || null,
      latestSummaryAt: latest?.createdAt.toISOString() || null,
    };
  });

  const assistantHint: Record<string, string> = {
    gmail: '当前建议先配置 Gmail 助手并刷新摘要。',
    feishu: '当前建议先配置 飞书 助手并刷新摘要。',
    wechat: '当前建议先录入公众号，再使用公众号助手对话。',
  };

  return (
    <FigmaShell homeHref="/dashboard" title="信息处理运营部门管理" subtitle="统一管理 Gmail、飞书、公众号助手与录入流程">
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
      />

      <InvestorWechatSourcesPanel initialSources={initialWechatSources} />
    </FigmaShell>
  );
}
