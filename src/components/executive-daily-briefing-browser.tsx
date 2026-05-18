'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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
    cover?: string;
    imageUrls?: string[];
    images?: Array<string | { url?: string }>;
  }>;
};

type BriefingItem = NonNullable<BriefingModule['items']>[number];

type BriefingTabKey = 'industryDynamics' | 'technologyTrends' | 'competitorMonitoring';

type BriefingFeedEntry = {
  id: string;
  categoryKey: BriefingTabKey;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt?: string;
  imageUrls?: string[];
};

type PlannerStepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR' | 'SKIPPED';

type PlannerTraceItem = {
  id: string;
  title: string;
  description?: string;
  status: PlannerStepStatus;
  detail?: string;
  error?: string;
  timestamp?: string;
};

type ExecutiveRunPollResult = {
  runId?: string;
  status?: string;
  result?: unknown;
  error?: string | null;
  plannerTrace?: unknown;
  pollIntervalMs?: number;
};

const briefingTabs: Array<{ key: BriefingTabKey; label: string }> = [
  { key: 'industryDynamics', label: '行业动态' },
  { key: 'technologyTrends', label: '技术趋势' },
  { key: 'competitorMonitoring', label: '竞品监控' },
];

const plannerStatusLabel: Record<PlannerStepStatus, string> = {
  PENDING: '待执行',
  RUNNING: '执行中',
  SUCCESS: '完成',
  ERROR: '错误',
  SKIPPED: '跳过',
};

const plannerStatusClass: Record<PlannerStepStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  RUNNING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  ERROR: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-amber-100 text-amber-700',
};

export const EXECUTIVE_UPDATE_BRIEFING_PROMPT =
  '更新今天的晨报，请调用可用子agent，尤其是微信公众号助手，并重新汇总当天信息，按照行业动态、技术趋势和竞品监控三个模块整理展示。';

const dayTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBriefingModules(sections: unknown): BriefingModule[] {
  const expectedTitles = ['行业动态', '技术趋势', '竞品监控'];
  if (!Array.isArray(sections)) {
    return expectedTitles.map((title) => ({
      title,
      content: '点击“更新资讯”后，总裁秘书会重新汇总当天信息并填充这个模块。',
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
        content: '点击“更新资讯”后，总裁秘书会重新汇总当天信息并填充这个模块。',
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
            cover: typeof item.cover === 'string' ? item.cover : undefined,
            imageUrls: Array.isArray(item.imageUrls) ? item.imageUrls.filter((value): value is string => typeof value === 'string') : undefined,
            images: Array.isArray(item.images) ? item.images : undefined,
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

function formatDateTime(value?: string) {
  if (!value) return '今日';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dayTimeFormatter.format(date);
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

function normalizePlannerTrace(value: unknown): PlannerTraceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return null;
      const status = typeof item.status === 'string' ? item.status : 'PENDING';
      if (!['PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED'].includes(status)) return null;
      return {
        id: item.id,
        title: item.title,
        description: typeof item.description === 'string' ? item.description : undefined,
        status: status as PlannerStepStatus,
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        error: typeof item.error === 'string' ? item.error : undefined,
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
      };
    })
    .filter(Boolean) as PlannerTraceItem[];
}

function getCurrentProgress(trace: PlannerTraceItem[]) {
  if (trace.length === 0) return null;
  return [...trace].reverse().find((item) => item.status === 'RUNNING') || trace[trace.length - 1] || null;
}

function getProgressText(progress: PlannerTraceItem | null) {
  if (!progress) return '已提交任务，正在等待后台开始处理';
  return progress.detail || progress.error || progress.title;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForExecutiveRun(runId: string, onUpdate?: (run: ExecutiveRunPollResult) => void) {
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const res = await fetch(`/api/investor/executive-assistant?runId=${encodeURIComponent(runId)}`, {
      cache: 'no-store',
    });
    const data = (await res.json().catch(() => ({}))) as ExecutiveRunPollResult;
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : '查询任务状态失败');
    }
    onUpdate?.(data);
    if (data.status === 'SUCCESS' || data.status === 'ERROR') return data;
    await sleep(typeof data.pollIntervalMs === 'number' ? data.pollIntervalMs : 3000);
  }
  throw new Error('晨报执行仍未完成，请稍后刷新查看结果');
}

function titleToTabKey(title: string): BriefingTabKey {
  if (title.includes('技术趋势')) return 'technologyTrends';
  if (title.includes('竞品监控')) return 'competitorMonitoring';
  return 'industryDynamics';
}

function normalizeImageUrls(item: BriefingItem | undefined) {
  if (!item) return [];
  const fromImageUrls = Array.isArray(item.imageUrls) ? item.imageUrls.filter((value): value is string => typeof value === 'string') : [];
  const fromImages = Array.isArray(item.images)
    ? item.images
        .map((value) => {
          if (typeof value === 'string') return value;
          if (isRecord(value) && typeof value.url === 'string') return value.url;
          return null;
        })
        .filter((value): value is string => Boolean(value))
    : [];
  const fromCover = typeof item.cover === 'string' ? [item.cover] : [];
  return [...fromImageUrls, ...fromImages, ...fromCover];
}

function normalizeBriefingEntries(
  modules: BriefingModule[],
  briefing: ExecutiveDailyBriefingView,
  persistedBriefing: PersistedExecutiveBriefingView
): BriefingFeedEntry[] {
  return modules.flatMap((module, index) => {
    const categoryKey = titleToTabKey(module.title);
    const insight = briefing.externalInsights?.find((item) => item.category.includes(module.title));
    const fallbackTitle = module.title;
    const fallbackSummary = insight?.content || module.content || '今日暂无新的资讯更新。';
    const rawItems =
      module.items && module.items.length > 0
        ? module.items
        : [
            {
              title: fallbackTitle,
              summary: fallbackSummary,
              source: insight?.source || '总裁秘书Momo',
              publishedAt: persistedBriefing?.updatedAt || briefing.generatedTime,
              imageUrls: [],
            },
          ];

    return rawItems.map((item, itemIndex) => ({
      id: `${categoryKey}-${index}-${itemIndex}-${item.url || item.title || fallbackTitle}`,
      categoryKey,
      title: clampText(item.title || fallbackTitle, 60),
      summary: clampText(item.summary || fallbackSummary, 140),
      source: item.source || insight?.source || '总裁秘书Momo',
      url: item.url,
      publishedAt: item.publishedAt || persistedBriefing?.updatedAt || briefing.generatedTime,
      imageUrls: normalizeImageUrls(item),
    }));
  });
}

function PreviewCarousel({
  images,
  title,
}: {
  images: string[];
  title: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % images.length);
    }, 2600);
    return () => window.clearInterval(timer);
  }, [images.length]);

  if (images.length === 0) return null;

  return (
    <div className="relative h-36 overflow-hidden rounded-[1.25rem] bg-slate-100 sm:h-32">
      <div
        className="flex h-full transition-transform duration-500 ease-out"
        style={{ transform: `translateX(-${activeIndex * 100}%)` }}
      >
        {images.map((image, index) => (
          <img
            key={`${title}-${index}`}
            src={image}
            alt={`${title} 预览图 ${index + 1}`}
            className="h-full w-full shrink-0 object-cover"
          />
        ))}
      </div>
      {images.length > 1 ? (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5 rounded-full bg-black/35 px-2.5 py-1">
          {images.map((_, index) => (
            <span
              key={`${title}-dot-${index}`}
              className={`h-1.5 rounded-full transition-all ${index === activeIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/55'}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
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
  const [visibleCount, setVisibleCount] = useState(20);
  const [internalUpdating, setInternalUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentProgress, setCurrentProgress] = useState<PlannerTraceItem | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

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
  const briefingEntries = useMemo(
    () => normalizeBriefingEntries(briefingModules, briefing, persistedBriefing),
    [briefingModules, briefing, persistedBriefing]
  );

  const visibleEntries = useMemo(
    () => briefingEntries.filter((entry) => entry.categoryKey === activeBriefingTab),
    [activeBriefingTab, briefingEntries]
  );
  const renderedEntries = useMemo(
    () => visibleEntries.slice(0, visibleCount),
    [visibleEntries, visibleCount]
  );
  const hasMore = visibleCount < visibleEntries.length;

  useEffect(() => {
    setVisibleCount(20);
  }, [activeBriefingTab]);

  useEffect(() => {
    if (!hasMore || !loadMoreRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setVisibleCount((current) => Math.min(current + 20, visibleEntries.length));
        }
      },
      {
        root: null,
        rootMargin: '240px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, visibleEntries.length]);

  const requestPrompt = (prompt: string) => {
    if (onPromptRequest) {
      onPromptRequest(prompt);
      return;
    }
    window.location.href = `/investor/chat/100?prompt=${encodeURIComponent(prompt)}`;
  };

  const handleUpdateBriefing = async () => {
    if (onUpdateBriefing) {
      onUpdateBriefing();
      return;
    }
    if (internalUpdating) return;
    setInternalUpdating(true);
    setError(null);
    setCurrentProgress(null);
    try {
      const res = await fetch('/api/investor/executive-assistant?async=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: EXECUTIVE_UPDATE_BRIEFING_PROMPT }],
        }),
      });

      const startData = (await res.json().catch(() => ({}))) as ExecutiveRunPollResult;
      if (!res.ok || typeof startData.runId !== 'string') {
        setError(typeof startData.error === 'string' ? startData.error : '更新资讯失败');
        return;
      }

      const run = await waitForExecutiveRun(startData.runId, (nextRun) => {
        const trace = normalizePlannerTrace(nextRun.plannerTrace);
        setCurrentProgress(getCurrentProgress(trace));
      });
      const data = isRecord(run.result) ? run.result : {};
      if (run.status === 'ERROR') {
        setError(run.error || (typeof data.error === 'string' ? data.error : '更新资讯失败'));
        return;
      }

      if (isRecord(data.briefing)) setBriefing(data.briefing as ExecutiveDailyBriefingView);
      setPersistedBriefing(normalizePersistedBriefing(data.persistedBriefing));
      setVisibleCount(20);
    } catch (err) {
      setError(err instanceof Error ? `更新资讯失败：${err.message}` : '更新资讯失败，请稍后重试');
    } finally {
      setInternalUpdating(false);
      setCurrentProgress(null);
    }
  };

  const isUpdating = updating || internalUpdating;
  const progressText = getProgressText(currentProgress);
  const progressStatus = currentProgress?.status || 'RUNNING';
  const progressKey = currentProgress
    ? `${currentProgress.id}-${currentProgress.status}-${currentProgress.timestamp || currentProgress.detail || currentProgress.error || ''}`
    : 'waiting-for-background-run';

  return (
    <div className={`${className} relative overflow-visible rounded-[2rem] border border-slate-200 bg-[#f7f9fc] text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.08)]`}>
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-[#f7f9fc]/95 px-4 pt-4 backdrop-blur-md sm:px-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold text-slate-950 sm:text-3xl">每日晨报</h2>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-500 shadow-sm">
                {persistedBriefing?.dateKey || briefing.date}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 max-w-4xl text-sm leading-6 text-slate-500">
              {persistedBriefing?.summary || briefing.headline}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleUpdateBriefing()}
            disabled={isUpdating}
            className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUpdating ? '更新中...' : '更新资讯'}
          </button>
        </div>
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        {isUpdating ? (
          <div className="mb-3 h-7 overflow-hidden">
            <div
              key={progressKey}
              className="briefing-progress-line flex min-w-0 items-center gap-2 text-sm text-slate-600"
              aria-live="polite"
            >
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${plannerStatusClass[progressStatus]}`}>
                {plannerStatusLabel[progressStatus]}
              </span>
              <span className="min-w-0 truncate">{progressText}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
                <span className="h-1 w-1 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.2s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.1s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-slate-400" />
              </span>
            </div>
          </div>
        ) : null}
        <div className="flex gap-6 overflow-x-auto">
          {briefingTabs.map((tab) => {
            const isActive = tab.key === activeBriefingTab;
            const itemCount = briefingEntries.filter((entry) => entry.categoryKey === tab.key).length;

            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveBriefingTab(tab.key)}
                className={`relative shrink-0 pb-4 text-sm font-medium transition-colors ${
                  isActive ? 'text-slate-950' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {tab.label}
                <span className="ml-1 text-xs text-slate-400">{itemCount}</span>
                {isActive ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-blue-600" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="grid gap-4 md:grid-cols-2">
          {renderedEntries.map((entry) => {
            const hasImages = Boolean(entry.imageUrls?.length);
            const card = (
              <div className="h-full rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                <div className={`grid h-full items-start gap-4 ${hasImages ? 'lg:grid-cols-[minmax(0,1fr)_15rem]' : ''}`}>
                  <div className="flex min-w-0 flex-col">
                    <h3 className="line-clamp-2 text-lg font-semibold leading-8 text-slate-900">{entry.title}</h3>
                    <p className="mt-[14px] line-clamp-2 text-sm leading-7 text-slate-500">{entry.summary}</p>
                    <div className="mt-[14px] flex items-center gap-3 overflow-hidden text-sm text-slate-400">
                      <p className="min-w-0 truncate">{formatDateTime(entry.publishedAt)}</p>
                      <span className="shrink-0 text-slate-300">·</span>
                      <p className="min-w-0 truncate">{entry.source}</p>
                    </div>
                  </div>
                  {hasImages ? <PreviewCarousel images={entry.imageUrls || []} title={entry.title} /> : null}
                </div>
              </div>
            );

            if (entry.url) {
              return (
                <a key={entry.id} href={entry.url} target="_blank" rel="noreferrer" className="block h-full">
                  {card}
                </a>
              );
            }

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => requestPrompt(`请展开这条资讯：${entry.title}，补充更完整的背景、来源和行动建议。`)}
                className="block h-full w-full text-left"
              >
                {card}
              </button>
            );
          })}
        </div>

        {visibleEntries.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            当前分类暂时还没有可展示的资讯。
          </div>
        ) : null}

        {visibleEntries.length > 0 ? (
          <div className="pt-5">
            {hasMore ? (
              <div ref={loadMoreRef} className="py-3 text-center text-sm text-slate-400">
                正在加载更多...
              </div>
            ) : (
              <div className="py-3 text-center text-sm text-slate-400">已经到底啦</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
