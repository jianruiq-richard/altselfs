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

type BriefingTabKey = 'recommended' | 'industryDynamics' | 'technologyTrends' | 'competitorMonitoring';

type BriefingFeedEntry = {
  id: string;
  categoryKey: Exclude<BriefingTabKey, 'recommended'>;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt?: string;
  imageUrls?: string[];
};

const briefingTabs: Array<{ key: BriefingTabKey; label: string }> = [
  { key: 'recommended', label: '推荐' },
  { key: 'industryDynamics', label: '行业动态' },
  { key: 'technologyTrends', label: '技术趋势' },
  { key: 'competitorMonitoring', label: '竞品监控' },
];

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

function createMockImage(label: string, start: string, end: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="640" height="360" rx="28" fill="url(#g)" />
      <circle cx="520" cy="78" r="56" fill="rgba(255,255,255,0.16)" />
      <circle cx="565" cy="305" r="72" fill="rgba(255,255,255,0.12)" />
      <text x="40" y="170" fill="white" font-size="42" font-family="Arial, sans-serif" font-weight="700">${label}</text>
      <text x="40" y="220" fill="rgba(255,255,255,0.82)" font-size="22" font-family="Arial, sans-serif">Preview</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const mockImages = {
  industry1: createMockImage('Industry Pulse', '#2563eb', '#1d4ed8'),
  industry2: createMockImage('Policy Watch', '#0f766e', '#14b8a6'),
  industry3: createMockImage('Consumer Shift', '#f97316', '#fb7185'),
  tech1: createMockImage('AI Infra', '#16a34a', '#22c55e'),
  tech2: createMockImage('Model Stack', '#7c3aed', '#8b5cf6'),
  tech3: createMockImage('Agent Flow', '#0891b2', '#06b6d4'),
  competitor1: createMockImage('Competitor Move', '#e11d48', '#fb7185'),
  competitor2: createMockImage('Launch Tracker', '#be123c', '#f43f5e'),
  competitor3: createMockImage('Ad Campaign', '#f59e0b', '#f97316'),
  general1: createMockImage('Daily Brief', '#334155', '#64748b'),
  general2: createMockImage('Insight Board', '#1f2937', '#4b5563'),
  general3: createMockImage('Market Signal', '#4338ca', '#6366f1'),
};

const mockBriefingEntries: BriefingFeedEntry[] = [
  {
    id: 'mock-01',
    categoryKey: 'industryDynamics',
    title: 'AI 办公自动化赛道融资热度回升，企业级协作产品进入新一轮整合窗口',
    summary: '过去两周内多家工作流和知识协作公司密集发布升级。资本更关注能直接接入企业现有系统的方案，而不是单点工具。',
    source: '36氪创投',
    publishedAt: '2026-05-05T08:10:00+08:00',
    imageUrls: [mockImages.industry1, mockImages.general1],
  },
  {
    id: 'mock-02',
    categoryKey: 'technologyTrends',
    title: '多 Agent 协同开始从 Demo 走向生产环境，企业更在意稳定性和追踪能力',
    summary: '近期厂商讨论重点已经从“能不能做”转向“如何观测和回放”。日志、权限和可解释链路正在变成标配。',
    source: 'InfoQ',
    publishedAt: '2026-05-05T08:25:00+08:00',
    imageUrls: [mockImages.tech1, mockImages.tech2, mockImages.tech3],
  },
  {
    id: 'mock-03',
    categoryKey: 'competitorMonitoring',
    title: '某头部协同平台上线智能摘要入口，直接切入高频会议与知识沉淀场景',
    summary: '新版本把摘要、待办提取和资料归档整合成统一入口。对比现有方案，其优势在于原生覆盖组织通讯录和权限体系。',
    source: '竞品跟踪组',
    publishedAt: '2026-05-05T08:40:00+08:00',
    imageUrls: [mockImages.competitor1],
  },
  {
    id: 'mock-04',
    categoryKey: 'industryDynamics',
    title: '政企客户采购节奏变慢，但更愿意为可审计的 AI 工作流付费',
    summary: '采购方对纯生成式展示兴趣下降，转而要求流程可回放、结果可归因。具备权限和审计能力的产品议价能力更强。',
    source: '甲子光年',
    publishedAt: '2026-05-05T09:05:00+08:00',
    imageUrls: [],
  },
  {
    id: 'mock-05',
    categoryKey: 'technologyTrends',
    title: '向量检索开始和实时数据库融合，知识更新时效成为体验差异点',
    summary: '越来越多团队不再接受“夜间批处理”式索引刷新。分钟级更新与热数据优先召回正在成为用户预期。',
    source: '技术观察台',
    publishedAt: '2026-05-05T09:20:00+08:00',
    imageUrls: [mockImages.tech2],
  },
  {
    id: 'mock-06',
    categoryKey: 'competitorMonitoring',
    title: '竞品开始主打“行业模板 + 自动报告”，明显在争夺非技术管理者入口',
    summary: '这类打法降低了上手门槛，但也牺牲了一部分灵活度。值得关注其模板质量和后续留存表现。',
    source: '渠道监测',
    publishedAt: '2026-05-05T09:35:00+08:00',
    imageUrls: [mockImages.competitor2, mockImages.general2],
  },
  {
    id: 'mock-07',
    categoryKey: 'industryDynamics',
    title: '内容平台调整推荐策略后，企业品牌账号的自然曝光波动明显增大',
    summary: '平台更强调互动质量和连续更新频率。对依赖单次爆款的品牌而言，后续投放效率会继续承压。',
    source: '新榜',
    publishedAt: '2026-05-05T09:50:00+08:00',
    imageUrls: [mockImages.industry3],
  },
  {
    id: 'mock-08',
    categoryKey: 'technologyTrends',
    title: '模型路由策略从成本优化走向任务分层，复杂问题开始采用多模型编排',
    summary: '越来越多团队会针对总结、分类、推理分别调用不同模型。结果是平均成本可控，但系统设计复杂度显著提升。',
    source: 'Arize 中文社区',
    publishedAt: '2026-05-05T10:05:00+08:00',
    imageUrls: [mockImages.tech1, mockImages.general3],
  },
  {
    id: 'mock-09',
    categoryKey: 'competitorMonitoring',
    title: '一家垂直 SaaS 将销售分析页升级为“每日看板”，强化管理层打开频次',
    summary: '其核心不是新增更多图表，而是把异常提醒和行动建议塞进首屏。这个思路和当前资讯模块方向高度接近。',
    source: 'SaaS 竞品雷达',
    publishedAt: '2026-05-05T10:15:00+08:00',
    imageUrls: [],
  },
  {
    id: 'mock-10',
    categoryKey: 'industryDynamics',
    title: '出海品牌对中文智能客服和本地化内容生成的需求同步升温',
    summary: '客户越来越希望同一套系统既能处理中文内部协作，也能支持多语种外部触达。跨语言一致性变成选择标准。',
    source: '雨果跨境',
    publishedAt: '2026-05-05T10:28:00+08:00',
    imageUrls: [mockImages.general1],
  },
  {
    id: 'mock-11',
    categoryKey: 'technologyTrends',
    title: '带工具调用能力的轻量模型开始覆盖更多流程节点，吞吐量优势明显',
    summary: '在批量整理和分类任务里，小模型加工具链的方案更容易控成本。高推理模型更多留在关键决策节点。',
    source: '机器之心',
    publishedAt: '2026-05-05T10:40:00+08:00',
    imageUrls: [mockImages.tech3],
  },
  {
    id: 'mock-12',
    categoryKey: 'competitorMonitoring',
    title: '竞品广告素材中开始弱化“AI 概念”，转而突出业务结果与团队提效',
    summary: '素材表达从技术炫耀切到具体业务收益，说明市场教育阶段正在过去。用户开始直接问 ROI 和替代流程。',
    source: '广告监测台',
    publishedAt: '2026-05-05T10:55:00+08:00',
    imageUrls: [mockImages.competitor3, mockImages.competitor1],
  },
  {
    id: 'mock-13',
    categoryKey: 'industryDynamics',
    title: '中大型企业开始要求 AI 系统支持跨部门知识权限继承，独立知识库工具受压',
    summary: '如果知识调用绕不开权限审批和组织结构，孤立工具很难进入核心流程。平台化能力的重要性继续提高。',
    source: '产业情报站',
    publishedAt: '2026-05-05T11:10:00+08:00',
    imageUrls: [],
  },
  {
    id: 'mock-14',
    categoryKey: 'technologyTrends',
    title: '生成式 UI 和动态报告模版结合后，管理看板的个性化展示开始普及',
    summary: '同一批数据可以按角色生成不同视图。产品竞争点从“能否生成”升级为“是否足够稳定且可控”。',
    source: '前端趋势',
    publishedAt: '2026-05-05T11:22:00+08:00',
    imageUrls: [mockImages.general2, mockImages.tech2],
  },
  {
    id: 'mock-15',
    categoryKey: 'competitorMonitoring',
    title: '一家内容分析产品将推荐机制前置到首页，试图缩短“打开到行动”的路径',
    summary: '首页直接给出重点情报和建议动作，减少用户先筛选再阅读的步骤。这个模式对提高周活非常有效。',
    source: '竞对首页观察',
    publishedAt: '2026-05-05T11:35:00+08:00',
    imageUrls: [mockImages.competitor2],
  },
  {
    id: 'mock-16',
    categoryKey: 'industryDynamics',
    title: '公众号、短视频、论坛三类渠道的信号开始互相验证，单一渠道判断失真风险加大',
    summary: '同一趋势在多个渠道同时出现时，才更可能意味着真实需求变化。多源交叉验证比过去更重要。',
    source: '多源舆情台',
    publishedAt: '2026-05-05T11:48:00+08:00',
    imageUrls: [mockImages.industry2, mockImages.general3],
  },
  {
    id: 'mock-17',
    categoryKey: 'technologyTrends',
    title: '多模态摘要开始进入日常资讯浏览场景，图片和文字联合理解体验提升明显',
    summary: '用户希望不仅看到结论，还能快速扫到关键图表和截图。资讯卡片带缩略预览，正在成为更自然的交互形式。',
    source: '产品体验周报',
    publishedAt: '2026-05-05T12:02:00+08:00',
    imageUrls: [mockImages.tech1, mockImages.general1, mockImages.general2],
  },
  {
    id: 'mock-18',
    categoryKey: 'competitorMonitoring',
    title: '竞品开始在案例页集中展示客户行业分布，试图强化“已经被主流采用”的认知',
    summary: '这类社会证明对于后期市场转化很关键。需要继续跟踪其案例更新频率和行业覆盖变化。',
    source: '官网更新监测',
    publishedAt: '2026-05-05T12:15:00+08:00',
    imageUrls: [],
  },
  {
    id: 'mock-19',
    categoryKey: 'industryDynamics',
    title: '管理层更愿意在早晨和午间快速浏览“短摘要 + 缩略图”的资讯卡片',
    summary: '长段报告阅读意愿下降，先扫一眼重要资讯再决定是否深挖，正在成为更主流的浏览习惯。',
    source: '用户研究访谈',
    publishedAt: '2026-05-05T12:26:00+08:00',
    imageUrls: [mockImages.general2],
  },
  {
    id: 'mock-20',
    categoryKey: 'technologyTrends',
    title: '轻量轮播式预览开始替代传统缩略图占位，兼顾信息密度和视觉吸引力',
    summary: '当一条资讯关联多张图时，用户更容易通过轮播快速理解上下文。空状态则应自动收缩，不额外占位。',
    source: '设计系统实验',
    publishedAt: '2026-05-05T12:40:00+08:00',
    imageUrls: [mockImages.tech3, mockImages.industry1],
  },
];

const previewFallbackEntries: BriefingFeedEntry[] = [
  ...mockBriefingEntries,
  ...mockBriefingEntries.map((entry, index) => ({
    ...entry,
    id: `${entry.id}-more`,
    title: `${entry.title}（延伸）`,
    publishedAt: `2026-05-06T${String(8 + (index % 10)).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}:00+08:00`,
  })),
];

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

function titleToTabKey(title: string): Exclude<BriefingTabKey, 'recommended'> {
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
    const fallbackSummary = module.content || insight?.content || '今日暂无新的资讯更新。';
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
  updating: _updating = false,
  onUpdateBriefing: _onUpdateBriefing,
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
  const [activeBriefingTab, setActiveBriefingTab] = useState<BriefingTabKey>('recommended');
  const [visibleCount, setVisibleCount] = useState(20);
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
  const hydratedEntries = useMemo(() => {
    if (briefingEntries.length >= 40) return briefingEntries;
    const existingIds = new Set(briefingEntries.map((entry) => entry.id));
    const filler = previewFallbackEntries.filter((entry) => !existingIds.has(entry.id));
    return [...briefingEntries, ...filler].slice(0, 40);
  }, [briefingEntries]);

  const visibleEntries = useMemo(() => {
    if (activeBriefingTab === 'recommended') return hydratedEntries;
    return hydratedEntries.filter((entry) => entry.categoryKey === activeBriefingTab);
  }, [activeBriefingTab, hydratedEntries]);
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

  return (
    <div className={`${className} relative overflow-visible rounded-[2rem] border border-slate-200 bg-[#f7f9fc] text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.08)]`}>
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-[#f7f9fc]/95 px-4 pt-4 backdrop-blur-md sm:px-6">
        <div className="flex gap-6 overflow-x-auto">
          {briefingTabs.map((tab) => {
            const isActive = tab.key === activeBriefingTab;
            const itemCount =
              tab.key === 'recommended'
                ? hydratedEntries.length
                : hydratedEntries.filter((entry) => entry.categoryKey === tab.key).length;

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
