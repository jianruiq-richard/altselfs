import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { FigmaShell } from '@/components/figma-shell';
import { Archive, Eye, FileText, Mail, MessageSquare, Search, Star } from 'lucide-react';

type CenterMessage = {
  id: string;
  source: string;
  sender: string;
  title: string;
  summary: string;
  priority: 'high' | 'medium' | 'low';
  createdAt: Date;
  isRead: boolean;
};

const providerLabel: Record<string, string> = {
  GMAIL: 'Gmail',
  FEISHU: '飞书',
  XIAOHONGSHU: '小红书',
};

const sourceIconMap = {
  Gmail: Mail,
  飞书: MessageSquare,
  小红书: FileText,
  公众号: FileText,
  分身会话: MessageSquare,
  分身对话: MessageSquare,
  '行业雷达（演示）': FileText,
} as const;

const sourceColorMap: Record<string, string> = {
  Gmail: 'text-red-600 bg-red-50',
  飞书: 'text-blue-600 bg-blue-50',
  小红书: 'text-rose-600 bg-rose-50',
  公众号: 'text-green-600 bg-green-50',
  分身会话: 'text-indigo-600 bg-indigo-50',
  分身对话: 'text-sky-600 bg-sky-50',
  '行业雷达（演示）': 'text-purple-600 bg-purple-50',
};

export default async function MessagesPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerkId: userId },
    relationLoadStrategy: 'join',
    select: {
      role: true,
      integrations: {
        select: {
          id: true,
          provider: true,
          accountEmail: true,
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
          displayName: true,
          description: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      },
      chatsAsCandidate: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          updatedAt: true,
          avatar: {
            select: {
              name: true,
            },
          },
          messages: {
            select: {
              content: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 8,
      },
      avatars: {
        select: {
          id: true,
          name: true,
          chats: {
            select: {
              id: true,
              needsInvestorReview: true,
              qualificationStatus: true,
              candidate: {
                select: {
                  nickname: true,
                  name: true,
                },
              },
              messages: {
                select: {
                  content: true,
                  createdAt: true,
                },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
            orderBy: { updatedAt: 'desc' },
            take: 8,
          },
        },
        take: 8,
      },
    },
  });

  if (!dbUser) redirect('/dashboard');

  const items: CenterMessage[] = [];

  for (const integration of dbUser.integrations) {
    const latest = integration.snapshots[0];
    if (!latest) continue;
    items.push({
      id: `integration-${integration.id}`,
      source: providerLabel[integration.provider] || integration.provider,
      sender: integration.accountEmail || '集成系统',
      title: `${providerLabel[integration.provider] || integration.provider} 最新摘要`,
      summary: latest.summary,
      priority: 'medium',
      createdAt: latest.createdAt,
      isRead: false,
    });
  }

  for (const source of dbUser.wechatSources) {
    items.push({
      id: `wechat-${source.id}`,
      source: '公众号',
      sender: source.displayName,
      title: `公众号更新：${source.displayName}`,
      summary: source.description || '已接入该公众号，后续文章将进入信息中心。',
      priority: 'low',
      createdAt: source.updatedAt,
      isRead: true,
    });
  }

  for (const chat of dbUser.chatsAsCandidate) {
    const latest = chat.messages[0];
    if (!latest) continue;
    items.push({
      id: `candidate-chat-${chat.id}`,
      source: '分身对话',
      sender: chat.avatar.name,
      title: `与 ${chat.avatar.name} 的会话更新`,
      summary: latest.content,
      priority: 'medium',
      createdAt: latest.createdAt,
      isRead: false,
    });
  }

  for (const avatar of dbUser.avatars) {
    for (const chat of avatar.chats) {
      const latest = chat.messages[0];
      if (!latest) continue;
      const candidateName = chat.candidate.nickname || chat.candidate.name || '用户';
      items.push({
        id: `investor-chat-${chat.id}`,
        source: '分身会话',
        sender: candidateName,
        title: `${avatar.name} 与 ${candidateName} 的会话更新`,
        summary: latest.content,
        priority: chat.needsInvestorReview || chat.qualificationStatus === 'QUALIFIED' ? 'high' : 'medium',
        createdAt: latest.createdAt,
        isRead: !chat.needsInvestorReview,
      });
    }
  }

  const mockDemoItems: CenterMessage[] = [
    {
      id: 'demo-1',
      source: '行业雷达（演示）',
      sender: '行业雷达Agent',
      title: 'AI 应用方向出现新信号',
      summary: '演示态数据：后续可接入外部情报源，自动汇总行业趋势。',
      priority: 'low',
      createdAt: new Date(),
      isRead: true,
    },
  ];

  const list = [...items, ...mockDemoItems]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 40);

  const highCount = list.filter((item) => item.priority === 'high').length;

  return (
    <FigmaShell
      homeHref={dbUser.role === 'INVESTOR' ? '/dashboard' : '/candidate'}
      title="信息中心"
      subtitle="AI助手为你整理的所有信息"
    >
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-4">
          <div className="flex-1">
            <input
              readOnly
              value=""
              placeholder="搜索信息..."
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 pl-10 text-sm text-gray-700 placeholder:text-gray-400"
            />
            <Search className="pointer-events-none -mt-8 ml-3 h-4 w-4 text-gray-400" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            `全部 (${list.length})`,
            `高优先级 (${highCount})`,
            `集成摘要 (${dbUser.integrations.filter((it) => it.snapshots[0]).length})`,
            `演示态 (${mockDemoItems.length})`,
          ].map((tab, index) => (
            <button
              key={tab}
              type="button"
              className={`rounded-lg px-3 py-1.5 text-sm ${
                index === 0 ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {list.map((item) => (
          <div
            key={item.id}
            className={`rounded-2xl border p-4 shadow-sm transition-colors hover:bg-gray-50 sm:p-5 ${
              item.isRead ? 'border-gray-200 bg-white' : 'border-blue-200 bg-blue-50/40'
            }`}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {(() => {
                  const Icon = sourceIconMap[item.source as keyof typeof sourceIconMap] || MessageSquare;
                  return (
                    <span className={`rounded-lg p-2 ${sourceColorMap[item.source] || 'text-gray-600 bg-gray-100'}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                  );
                })()}
                <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600">{item.source}</span>
                <span className="text-xs text-gray-500">{item.sender}</span>
                {!item.isRead ? <span className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white">新</span> : null}
              </div>
              <span className="text-xs text-gray-400">{item.createdAt.toLocaleString('zh-CN')}</span>
            </div>

            <h3 className="text-base font-semibold text-gray-900">{item.title}</h3>

            <div className="mt-3 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 p-3">
              <div className="flex items-start gap-2">
                <span className="text-xs font-medium text-purple-600">AI摘要</span>
                <p className="flex-1 whitespace-pre-wrap text-sm text-gray-700">{item.summary}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    item.priority === 'high'
                      ? 'bg-rose-100 text-rose-800'
                      : item.priority === 'medium'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {item.priority === 'high' ? '高优先级' : item.priority === 'medium' ? '中优先级' : '低优先级'}
                </span>
                <button type="button" className="inline-flex items-center rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  标记已读
                </button>
                <button type="button" className="inline-flex items-center rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
                  <Star className="mr-1 h-3.5 w-3.5" />
                  收藏
                </button>
                <button type="button" className="inline-flex items-center rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
                  <Archive className="mr-1 h-3.5 w-3.5" />
                  归档
                </button>
              </div>
            </div>
          </div>
        ))}

        {list.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-500">
            暂无信息，先去接入 Gmail / 飞书 / 公众号或开启会话。
          </div>
        ) : null}
      </div>
    </FigmaShell>
  );
}
