'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, MessageSquare, RefreshCw, Search, ThumbsDown, ThumbsUp, Zap } from 'lucide-react';

export type ExecutiveDailyBriefingView = {
  date: string;
  generatedTime: string;
  headline: string;
  externalInsights?: Array<{
    category: string;
    content: string;
    source: string;
  }>;
};

export type PersistedExecutiveBriefingView = {
  dateKey: string;
  title: string;
  summary: string;
  sections: unknown;
  updatedAt?: string;
} | null;

type BriefingModule = {
  title: string;
  content: string;
  items?: Array<{
    title?: string;
    summary?: string;
    source?: string;
    url?: string;
    publishedAt?: string;
  }>;
};

type BriefingTabKey = 'industryDynamics' | 'technologyTrends' | 'competitorMonitoring';

export const EXECUTIVE_UPDATE_BRIEFING_PROMPT =
  '更新今天的晨报，请调用可用子agent，尤其是微信公众号助手，并重新汇总当天信息，按照行业动态、技术趋势和竞品监控三个模块整理展示。';

const briefingTabs: Array<{ key: BriefingTabKey; label: string }> = [
  { key: 'industryDynamics', label: '行业动态' },
  { key: 'technologyTrends', label: '技术趋势' },
  { key: 'competitorMonitoring', label: '竞品监控' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBriefingModules(sections: unknown): BriefingModule[] {
  const expectedTitles = ['行业动态', '技术趋势', '竞品监控'];
  if (!Array.isArray(sections)) {
    return expectedTitles.map((title) => ({
      title,
      content: '点击“更新晨报”后，总裁秘书会重新汇总当天信息并填充这个模块。',
    }));
  }

  return expectedTitles.map((title) => {
    const matched = sections.find((section) => {
      if (!isRecord(section) || typeof section.title !== 'string') return false;
      return section.title.includes(title);
    });
    if (!isRecord(matched)) {
      return {
        title,
        content: '点击“更新晨报”后，总裁秘书会重新汇总当天信息并填充这个模块。',
      };
    }

    const rawItems = Array.isArray(matched.items) ? matched.items : [];
    return {
      title,
      content: typeof matched.content === 'string' && matched.content.trim() ? matched.content : '暂无明确内容。',
      items: rawItems
        .map((item) => {
          if (!isRecord(item)) return null;
          return {
            title: typeof item.title === 'string' ? item.title : undefined,
            summary: typeof item.summary === 'string' ? item.summary : undefined,
            source: typeof item.source === 'string' ? item.source : undefined,
            url: typeof item.url === 'string' ? item.url : undefined,
            publishedAt: typeof item.publishedAt === 'string' ? item.publishedAt : undefined,
          };
        })
        .filter(Boolean) as BriefingModule['items'],
    };
  });
}

function clampText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function formatBriefingTime(value?: string) {
  if (!value) return '今日';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

function normalizePersistedBriefing(value: unknown): PersistedExecutiveBriefingView {
  if (!isRecord(value)) return null;
  return {
    dateKey: typeof value.dateKey === 'string' ? value.dateKey : '',
    title: typeof value.title === 'string' ? value.title : '',
    summary: typeof value.summary === 'string' ? value.summary : '',
    sections: value.sections,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  };
}

export function ExecutiveDailyBriefingBrowser({
  briefing: initialBriefing,
  persistedBriefing: initialPersistedBriefing,
  className = 'mb-6',
  updating = false,
  onUpdateBriefing,
  onPromptRequest,
}: {
  briefing: ExecutiveDailyBriefingView;
  persistedBriefing?: PersistedExecutiveBriefingView;
  className?: string;
  updating?: boolean;
  onUpdateBriefing?: () => void;
  onPromptRequest?: (prompt: string) => void;
}) {
  const [briefing, setBriefing] = useState(initialBriefing);
  const [persistedBriefing, setPersistedBriefing] = useState(initialPersistedBriefing || null);
  const [activeBriefingTab, setActiveBriefingTab] = useState<BriefingTabKey>('industryDynamics');
  const [activeBriefingItemIndex, setActiveBriefingItemIndex] = useState(0);
  const [internalUpdating, setInternalUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBriefing(initialBriefing);
  }, [initialBriefing]);

  useEffect(() => {
    setPersistedBriefing(initialPersistedBriefing || null);
  }, [initialPersistedBriefing]);

  const briefingModules = useMemo(
    () => normalizeBriefingModules(persistedBriefing?.sections),
    [persistedBriefing]
  );
  const activeBriefingModule = useMemo(() => {
    const title = briefingTabs.find((item) => item.key === activeBriefingTab)?.label || '行业动态';
    return briefingModules.find((module) => module.title === title) || briefingModules[0];
  }, [activeBriefingTab, briefingModules]);
  const activeBriefingItems = useMemo(() => {
    if (!activeBriefingModule) return [];
    if (activeBriefingModule.items && activeBriefingModule.items.length > 0) return activeBriefingModule.items;

    const insight = briefing.externalInsights?.find((item) => item.category.includes(activeBriefingModule.title));
    return [
      {
        title: activeBriefingModule.title,
        summary: activeBriefingModule.content || insight?.content || '今日暂无明确更新。',
        source: insight?.source || '总裁秘书Momo',
        publishedAt: persistedBriefing?.updatedAt || briefing.generatedTime,
      },
    ];
  }, [activeBriefingModule, briefing, persistedBriefing]);
  const selectedBriefingItem = activeBriefingItems[Math.min(activeBriefingItemIndex, Math.max(0, activeBriefingItems.length - 1))];
  const activeBriefingTabMeta = briefingTabs.find((item) => item.key === activeBriefingTab) || briefingTabs[0];
  const isUpdating = updating || internalUpdating;

  const requestPrompt = (prompt: string) => {
    if (onPromptRequest) {
      onPromptRequest(prompt);
      return;
    }
    window.location.href = `/investor/chat/100?prompt=${encodeURIComponent(prompt)}`;
  };

  const updateBriefing = async () => {
    if (onUpdateBriefing) {
      onUpdateBriefing();
      return;
    }
    if (internalUpdating) return;
    setInternalUpdating(true);
    setError(null);
    try {
      const res = await fetch('/api/investor/executive-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: EXECUTIVE_UPDATE_BRIEFING_PROMPT }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : '更新晨报失败');
        return;
      }
      if (isRecord(data.briefing)) setBriefing(data.briefing as ExecutiveDailyBriefingView);
      setPersistedBriefing(normalizePersistedBriefing(data.persistedBriefing));
    } catch (err) {
      setError(err instanceof Error ? `更新晨报失败：${err.message}` : '更新晨报失败，请稍后重试');
    } finally {
      setInternalUpdating(false);
    }
  };

  return (
    <div className={`${className} overflow-hidden rounded-2xl border border-slate-800 bg-[#17171f] text-slate-100 shadow-xl`}>
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ffc400] text-[#17171f]">
                <Zap className="h-5 w-5 fill-current" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-normal text-white">每日晨报</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {persistedBriefing?.dateKey || briefing.date} ·{' '}
                  {persistedBriefing?.updatedAt
                    ? `已保存 ${new Date(persistedBriefing.updatedAt).toLocaleString()}`
                    : briefing.generatedTime}
                </p>
              </div>
            </div>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">{persistedBriefing?.summary || briefing.headline}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => requestPrompt(`请展开今天晨报里的${activeBriefingTabMeta.label}，并补充可追溯来源。`)}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-[#ffc400] hover:bg-white/5"
              aria-label="搜索当前晨报分类"
              title="搜索当前晨报分类"
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void updateBriefing()}
              disabled={isUpdating}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#ffc400] px-3 py-2 text-sm font-semibold text-[#17171f] hover:bg-[#ffd84d] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isUpdating ? 'animate-spin' : ''}`} />
              {isUpdating ? '更新中' : '更新晨报'}
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}

        <div className="mt-4 flex gap-5 overflow-x-auto border-b border-white/10 pb-0">
          {briefingTabs.map((tab) => {
            const isActive = tab.key === activeBriefingTab;
            const moduleInfo = briefingModules.find((item) => item.title === tab.label);
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setActiveBriefingTab(tab.key);
                  setActiveBriefingItemIndex(0);
                }}
                className={`relative shrink-0 pb-3 text-sm font-medium transition-colors ${
                  isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
                <span className="ml-1 text-xs text-slate-500">{moduleInfo?.items?.length || 0}</span>
                {isActive ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[#ffc400]" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="border-b border-white/10 lg:border-b-0 lg:border-r">
          <div className="max-h-[32rem] overflow-y-auto p-3 sm:p-4">
            <div className="space-y-3">
              {activeBriefingItems.map((item, index) => {
                const selected = index === Math.min(activeBriefingItemIndex, Math.max(0, activeBriefingItems.length - 1));
                return (
                  <button
                    key={`${activeBriefingTab}-${item.url || item.title || index}`}
                    type="button"
                    onClick={() => setActiveBriefingItemIndex(index)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_5.75rem] gap-3 border-b border-white/10 pb-3 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_7.5rem] ${
                      selected ? 'text-white' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-base font-semibold leading-6">{item.title || activeBriefingTabMeta.label}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {formatBriefingTime(item.publishedAt || persistedBriefing?.updatedAt)} · {item.source || '总裁秘书Momo'}
                      </span>
                      <span className="mt-2 line-clamp-2 text-sm leading-5 text-slate-400">
                        {clampText(item.summary || activeBriefingModule?.content || '', 120)}
                      </span>
                    </span>
                    <span className={`h-20 rounded-md ${selected ? 'bg-slate-600' : 'bg-slate-700/80'}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bg-[#363642] p-4 sm:p-5">
          <div className="min-h-[22rem]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <span className="inline-flex rounded-full bg-[#ffc400] px-2 py-1 text-xs font-semibold text-[#17171f]">
                  {activeBriefingTabMeta.label}
                </span>
                <h3 className="mt-3 text-xl font-semibold leading-8 text-white">
                  {selectedBriefingItem?.title || activeBriefingModule?.title || '今日晨报'}
                </h3>
                <p className="mt-2 text-xs text-slate-400">
                  {formatBriefingTime(selectedBriefingItem?.publishedAt || persistedBriefing?.updatedAt)} ·{' '}
                  {selectedBriefingItem?.source || '总裁秘书Momo'}
                </p>
              </div>
              {selectedBriefingItem?.url ? (
                <a
                  href={selectedBriefingItem.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg border border-white/10 p-2 text-[#ffc400] hover:bg-white/5"
                  aria-label="打开来源"
                  title="打开来源"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : null}
            </div>

            <div className="mt-6 space-y-5 text-sm leading-6 text-slate-200">
              <section>
                <h4 className="text-sm font-semibold text-white">一句话描述</h4>
                <p className="mt-1 whitespace-pre-wrap text-slate-300">
                  {selectedBriefingItem?.summary?.split('\n')[0] || activeBriefingModule?.content || '暂无明确内容。'}
                </p>
              </section>

              <section>
                <h4 className="text-sm font-semibold text-white">主要要点</h4>
                <div className="mt-2 space-y-3">
                  {(activeBriefingItems.length > 1 ? activeBriefingItems : [{ ...selectedBriefingItem, summary: activeBriefingModule?.content }])
                    .slice(0, 6)
                    .map((item, index) => (
                      <p key={`${activeBriefingTab}-point-${item?.url || item?.title || index}`} className="text-slate-300">
                        {index + 1}. {item?.summary || item?.title || activeBriefingModule?.content || '暂无明确要点。'}
                      </p>
                    ))}
                </div>
              </section>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 text-[#ffc400]">
              <button type="button" className="rounded-lg p-2 hover:bg-white/5" aria-label="有帮助" title="有帮助">
                <ThumbsUp className="h-5 w-5" />
              </button>
              <button type="button" className="rounded-lg p-2 hover:bg-white/5" aria-label="无帮助" title="无帮助">
                <ThumbsDown className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => requestPrompt(`基于今天晨报的${activeBriefingTabMeta.label}，给我下一步行动建议。`)}
                className="rounded-lg p-2 hover:bg-white/5"
                aria-label="追问"
                title="追问"
              >
                <MessageSquare className="h-5 w-5" />
              </button>
            </div>
            <div className="text-xs text-slate-500">{activeBriefingItems.length} 条来源</div>
          </div>
        </div>
      </div>
    </div>
  );
}
