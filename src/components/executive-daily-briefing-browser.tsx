'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type ExecutiveDailyBriefingView = {
  date: string;
  generatedTime: string;
  headline: string;
  priorityTasks?: Array<{
    priority: 'high' | 'medium' | 'low';
    task: string;
    deadline: string;
    assignedBy: string;
  }>;
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
  key: string;
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

type BriefingTabKey = string;

type BriefingFeedEntry = {
  id: string;
  categoryKey: BriefingTabKey;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt?: string;
  imageUrls?: string[];
  compact?: boolean;
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

const defaultBriefingTitles = ['信息汇总', '今日to do', '分身推荐'];

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
  '更新今天的晨报，请调用可用子agent，尤其是微信公众号助手、邮件助手、飞书助手和小红书助手，并重新汇总当天信息。请按照“信息汇总、今日to do、分身推荐”三个模块整理：信息汇总覆盖所有消息渠道的重要信号；今日to do要从所有渠道里提取可执行事项并按红色P0、黄色P1、绿色P2排序；分身推荐给出值得我用个人决策分身进一步讨论或匹配的人/事。';

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

function moduleKey(title: string, index: number) {
  return `${index}-${title}`;
}

function defaultPriorityLabel(priority: 'high' | 'medium' | 'low') {
  if (priority === 'high') return '红色P0';
  if (priority === 'medium') return '黄色P1';
  return '绿色P2';
}

function defaultBriefingModules(briefing?: ExecutiveDailyBriefingView): BriefingModule[] {
  const taskItems = (briefing?.priorityTasks || []).map((task) => ({
    title: `${defaultPriorityLabel(task.priority)} ${task.task}`,
    summary: `截止：${task.deadline}。来源：${task.assignedBy}`,
    source: task.assignedBy,
    publishedAt: briefing?.generatedTime,
  }));

  return defaultBriefingTitles.map((title, index) => {
    if (title === '今日to do') {
      return {
        key: moduleKey(title, index),
        title,
        content: taskItems.length > 0 ? '基于当前已接入渠道和账户状态整理的今日待办。' : '更新晨报后，总裁秘书会从所有消息渠道里提取今日待办。',
        items: taskItems.length > 0 ? taskItems : undefined,
      };
    }

    return {
      key: moduleKey(title, index),
      title,
      content:
        title === '信息汇总'
          ? '点击“更新信息”后，总裁秘书会重新汇总公众号、Gmail、飞书、小红书等渠道的重要信息。'
          : '更新晨报后，这里会展示适合用个人决策分身继续讨论、跟进或匹配的人/事。',
    };
  });
}

function normalizeBriefingModules(sections: unknown, briefing?: ExecutiveDailyBriefingView): BriefingModule[] {
  if (!Array.isArray(sections)) {
    return defaultBriefingModules(briefing);
  }

  const modules = sections
    .map((section, index) => {
      if (!isRecord(section) || typeof section.title !== 'string') return null;
      const title = section.title.trim();
      if (!title || title === '总览') return null;

      const rawItems = Array.isArray(section.items) ? section.items : [];
      return {
        key: moduleKey(title, index),
        title,
        content: typeof section.content === 'string' && section.content.trim() ? section.content : '暂无明确内容。',
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
    })
    .filter(Boolean) as BriefingModule[];

  return modules.length > 0 ? modules : defaultBriefingModules(briefing);
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
  let transientUnauthorizedCount = 0;
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const res = await fetch(`/api/investor/executive-assistant?runId=${encodeURIComponent(runId)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const data = (await res.json().catch(() => ({}))) as ExecutiveRunPollResult;
    if (!res.ok) {
      if (res.status === 401 && transientUnauthorizedCount < 3) {
        transientUnauthorizedCount += 1;
        await sleep(1500);
        continue;
      }
      throw new Error(typeof data.error === 'string' ? data.error : '查询任务状态失败');
    }
    transientUnauthorizedCount = 0;
    onUpdate?.(data);
    if (data.status === 'SUCCESS' || data.status === 'ERROR') return data;
    await sleep(typeof data.pollIntervalMs === 'number' ? data.pollIntervalMs : 3000);
  }
  throw new Error('晨报执行仍未完成，请稍后刷新查看结果');
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
    const categoryKey = module.key;
    const compact = module.title === '信息汇总' || module.title === '今日to do' || module.title === '分身推荐';
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
      title: compact ? item.title || fallbackTitle : clampText(item.title || fallbackTitle, 60),
      summary: compact ? item.summary || fallbackSummary : clampText(item.summary || fallbackSummary, 140),
      source: item.source || insight?.source || '总裁秘书Momo',
      url: item.url,
      publishedAt: item.publishedAt || persistedBriefing?.updatedAt || briefing.generatedTime,
      imageUrls: normalizeImageUrls(item),
      compact,
    }));
  });
}

function initialBriefingTab(persistedBriefing: PersistedExecutiveBriefingView | undefined, briefing: ExecutiveDailyBriefingView) {
  return normalizeBriefingModules(persistedBriefing?.sections, briefing)[0]?.key || moduleKey(defaultBriefingTitles[0], 0);
}

function getTodoPriorityDisplay(title: string) {
  const matched = /^(红色P0|黄色P1|绿色P2)\s+(.+)$/.exec(title);
  if (!matched) return { title };
  const [, level, restTitle] = matched;
  const tone = level === '红色P0' ? 'bg-red-500' : level === '黄色P1' ? 'bg-amber-400' : 'bg-emerald-500';

  return {
    title: restTitle,
    tone,
    label: level,
  };
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
  updateDisabled = false,
  headerActionLabel,
  headerActionPrompt,
  onUpdateBriefing,
  onPromptRequest,
}: {
  briefing: ExecutiveDailyBriefingView;
  persistedBriefing?: PersistedExecutiveBriefingView;
  className?: string;
  updating?: boolean;
  updateDisabled?: boolean;
  headerActionLabel?: string;
  headerActionPrompt?: string;
  onUpdateBriefing?: () => void;
  onPromptRequest?: (prompt: string) => void;
}) {
  const [briefing, setBriefing] = useState(initialBriefing);
  const [persistedBriefing, setPersistedBriefing] = useState(initialPersistedBriefing || null);
  const [activeBriefingTab, setActiveBriefingTab] = useState<BriefingTabKey>(() =>
    initialBriefingTab(initialPersistedBriefing, initialBriefing)
  );
  const [visibleCount, setVisibleCount] = useState(20);
  const [internalUpdating, setInternalUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentProgress, setCurrentProgress] = useState<PlannerTraceItem | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    setBriefing(initialBriefing);
  }, [initialBriefing]);

  useEffect(() => {
    setPersistedBriefing(initialPersistedBriefing || null);
  }, [initialPersistedBriefing]);

  const briefingModules = useMemo(
    () => normalizeBriefingModules(persistedBriefing?.sections, briefing),
    [briefing, persistedBriefing]
  );
  const briefingTabs = useMemo(
    () => briefingModules.map((module) => ({ key: module.key, label: module.title })),
    [briefingModules]
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
  const compactEntries = renderedEntries.length > 0 && renderedEntries.every((entry) => entry.compact);
  const activeTab = briefingTabs.find((tab) => tab.key === activeBriefingTab);
  const hideHeaderSummary = compactEntries || activeTab?.label === '今日to do' || activeTab?.label === '分身推荐';

  useEffect(() => {
    setVisibleCount(20);
  }, [activeBriefingTab]);

  useEffect(() => {
    if (briefingTabs.length === 0) return;
    if (!briefingTabs.some((tab) => tab.key === activeBriefingTab)) {
      setActiveBriefingTab(briefingTabs[0].key);
    }
  }, [activeBriefingTab, briefingTabs]);

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

  const applyRunResult = useCallback((run: ExecutiveRunPollResult) => {
    const data = isRecord(run.result) ? run.result : {};
    if (run.status === 'ERROR') {
      setError(run.error || (typeof data.error === 'string' ? data.error : '更新信息失败'));
      return;
    }

    if (isRecord(data.briefing)) setBriefing(data.briefing as ExecutiveDailyBriefingView);
    setPersistedBriefing(normalizePersistedBriefing(data.persistedBriefing));
    setVisibleCount(20);
  }, []);

  const resumeExecutiveRun = useCallback(
    async (runId: string) => {
      if (!runId || activeRunIdRef.current === runId) return;
      activeRunIdRef.current = runId;
      setInternalUpdating(true);
      setError(null);
      try {
        const run = await waitForExecutiveRun(runId, (nextRun) => {
          const trace = normalizePlannerTrace(nextRun.plannerTrace);
          setCurrentProgress(getCurrentProgress(trace));
        });
        applyRunResult(run);
      } catch (err) {
        setError(err instanceof Error ? `更新信息失败：${err.message}` : '更新信息失败，请稍后重试');
      } finally {
        activeRunIdRef.current = null;
        setInternalUpdating(false);
        setCurrentProgress(null);
      }
    },
    [applyRunResult]
  );

  useEffect(() => {
    if (onUpdateBriefing) return;
    let cancelled = false;

    async function loadActiveRun() {
      try {
        const res = await fetch('/api/investor/executive-assistant', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (cancelled || !res.ok) return;

        if (isRecord(data.briefing)) setBriefing(data.briefing as ExecutiveDailyBriefingView);
        setPersistedBriefing(normalizePersistedBriefing(data.persistedBriefing));

        const activeRun = isRecord(data.activeRun) ? (data.activeRun as ExecutiveRunPollResult) : null;
        if (activeRun?.runId && activeRun.status !== 'SUCCESS' && activeRun.status !== 'ERROR') {
          const trace = normalizePlannerTrace(activeRun.plannerTrace);
          setCurrentProgress(getCurrentProgress(trace));
          void resumeExecutiveRun(activeRun.runId);
        }
      } catch {
        // Keep the server-rendered briefing visible if the status refresh fails.
      }
    }

    void loadActiveRun();
    return () => {
      cancelled = true;
    };
  }, [onUpdateBriefing, resumeExecutiveRun]);

  const handleUpdateBriefing = async () => {
    if (headerActionPrompt) {
      requestPrompt(headerActionPrompt);
      return;
    }
    if (updateDisabled) return;
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
        setError(typeof startData.error === 'string' ? startData.error : '更新信息失败');
        return;
      }

      activeRunIdRef.current = startData.runId;
      const run = await waitForExecutiveRun(startData.runId, (nextRun) => {
        const trace = normalizePlannerTrace(nextRun.plannerTrace);
        setCurrentProgress(getCurrentProgress(trace));
      });
      applyRunResult(run);
    } catch (err) {
      setError(err instanceof Error ? `更新信息失败：${err.message}` : '更新信息失败，请稍后重试');
    } finally {
      activeRunIdRef.current = null;
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
  const headerButtonLabel = headerActionLabel || (updateDisabled ? '演示数据' : isUpdating ? '更新中...' : '更新信息');

  return (
    <div className={`${className} relative overflow-visible rounded-[1.75rem] border border-[#e1d2bf] bg-[#f9f4ec] text-stone-950 shadow-[0_28px_70px_rgba(73,48,31,0.10)]`}>
      <div className="sticky top-0 z-20 border-b border-[#e8dccb] bg-[#f9f4ec]/95 px-4 pt-4 backdrop-blur-md sm:px-6">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold text-stone-950 sm:text-3xl">Decision Briefing</h2>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs text-stone-500 shadow-sm">
                {persistedBriefing?.dateKey || briefing.date}
              </span>
            </div>
            {!hideHeaderSummary ? (
              <p className="mt-2 line-clamp-2 max-w-4xl text-sm leading-6 text-stone-600">
                {persistedBriefing?.summary || briefing.headline}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleUpdateBriefing()}
              disabled={isUpdating || (updateDisabled && !headerActionPrompt)}
              className="inline-flex items-center justify-center rounded-xl bg-[#8a4d22] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#743f1b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {headerButtonLabel}
            </button>
            <button
              type="button"
              onClick={() =>
                requestPrompt('请基于今天的 Decision Briefing，和我的个人决策分身一起讨论：哪些信息最重要、今天应该先做什么、哪些判断需要进一步验证。')
              }
              className="inline-flex items-center justify-center rounded-xl border border-[#d9c5af] bg-white/70 px-4 py-2.5 text-sm font-semibold text-[#6b3d1d] transition hover:bg-white hover:text-[#4f2b15]"
            >
              与分身进行讨论
            </button>
          </div>
        </div>
        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
        {isUpdating ? (
          <div className="mb-3 h-7 overflow-hidden">
            <div
              key={progressKey}
              className="briefing-progress-line flex min-w-0 items-center gap-2 text-sm text-stone-600"
              aria-live="polite"
            >
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${plannerStatusClass[progressStatus]}`}>
                {plannerStatusLabel[progressStatus]}
              </span>
                <span className="min-w-0 truncate">{progressText}</span>
              <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden="true">
                <span className="h-1 w-1 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.2s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-stone-400 [animation-delay:-0.1s]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-stone-400" />
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
                  isActive ? 'text-stone-950' : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                {tab.label}
                <span className="ml-1 text-xs text-stone-400">{itemCount}</span>
                {isActive ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-full bg-[#c78b45]" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className={`grid md:grid-cols-2 ${compactEntries ? 'gap-2.5' : 'gap-4'}`}>
          {renderedEntries.map((entry) => {
            const hasImages = Boolean(entry.imageUrls?.length);
            const isCompact = Boolean(entry.compact);
            const isTodoTab = activeTab?.label === '今日to do';
            const priorityDisplay = isTodoTab ? getTodoPriorityDisplay(entry.title) : { title: entry.title };
            const card = (
              <div
                className={`h-full border border-[#e5d6c5] bg-white transition hover:-translate-y-0.5 ${
                  isCompact
                    ? 'rounded-xl p-3 shadow-[0_8px_20px_rgba(73,48,31,0.05)] hover:shadow-[0_12px_24px_rgba(73,48,31,0.07)]'
                    : 'rounded-[1.5rem] p-5 shadow-[0_12px_32px_rgba(73,48,31,0.06)] hover:shadow-[0_18px_40px_rgba(73,48,31,0.09)]'
                }`}
              >
                <div className={`grid h-full items-start ${isCompact ? 'gap-1.5' : `gap-4 ${hasImages ? 'lg:grid-cols-[minmax(0,1fr)_15rem]' : ''}`}`}>
                  <div className="flex min-w-0 flex-col">
                    <h3 className={isCompact ? 'text-sm font-semibold leading-5 text-stone-900' : 'line-clamp-2 text-lg font-semibold leading-8 text-stone-900'}>
                      <span className="inline-flex items-start gap-2">
                        {priorityDisplay.tone ? (
                          <span
                            aria-label={priorityDisplay.label}
                            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${priorityDisplay.tone}`}
                          />
                        ) : null}
                        <span>{priorityDisplay.title}</span>
                      </span>
                    </h3>
                    <p className={isCompact ? 'mt-1 text-xs leading-5 text-stone-500' : 'mt-[14px] line-clamp-2 text-sm leading-7 text-stone-500'}>
                      {entry.summary}
                    </p>
                    {!isTodoTab ? (
                      <div className={`${isCompact ? 'mt-1.5 flex flex-wrap items-center gap-2 text-[11px]' : 'mt-[14px] flex items-center gap-3 overflow-hidden text-sm'} text-stone-400`}>
                        <p className={isCompact ? '' : 'min-w-0 truncate'}>{formatDateTime(entry.publishedAt)}</p>
                        <span className="shrink-0 text-stone-300">·</span>
                        <p className={isCompact ? '' : 'min-w-0 truncate'}>{entry.source}</p>
                      </div>
                    ) : null}
                  </div>
                  {hasImages && !isCompact ? <PreviewCarousel images={entry.imageUrls || []} title={entry.title} /> : null}
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
            当前分类暂时还没有可展示的信息。
          </div>
        ) : null}

        {visibleEntries.length > 0 && !compactEntries ? (
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
