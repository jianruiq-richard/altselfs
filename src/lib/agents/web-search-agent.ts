import { createChatCompletion, getOpenRouterModel, type ChatMessage } from '@/lib/openrouter';
import type { AgentBriefingItem, AgentRunInput, AgentRunResult, AgentRunToolCall, AgentTaskSpec } from '@/lib/agents/types';

type WebSearchModuleKey = 'industryDynamics' | 'technologyTrends' | 'competitorMonitoring';

type WebSearchSourceItem = {
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt?: string;
  whyItMatters?: string;
};

type WebSearchAgentOutput = {
  summary?: string;
  modules?: Partial<Record<WebSearchModuleKey, {
    content?: string;
    items?: WebSearchSourceItem[];
  }>>;
  searchLog?: Array<{
    query?: string;
    reason?: string;
    importantSources?: Array<{
      title?: string;
      url?: string;
      source?: string;
    }>;
  }>;
};

const MODULE_LABELS: Record<WebSearchModuleKey, string> = {
  industryDynamics: '行业动态',
  technologyTrends: '技术趋势',
  competitorMonitoring: '竞品监控',
};

function extractJsonObject(raw: string) {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const candidate = fenceMatch[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) return candidate;
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1);
  return null;
}

function normalizeText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeItems(rawItems: unknown): WebSearchSourceItem[] {
  if (!Array.isArray(rawItems)) return [];
  return rawItems
    .map((item): WebSearchSourceItem | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const title = normalizeText(record.title);
      const summary = normalizeText(record.summary);
      const source = normalizeText(record.source, 'OpenRouter Web Search');
      if (!title || !summary) return null;
      const normalized: WebSearchSourceItem = {
        title: title.slice(0, 220),
        summary: summary.slice(0, 900),
        source: source.slice(0, 180),
      };
      const url = normalizeText(record.url);
      const publishedAt = normalizeText(record.publishedAt);
      const whyItMatters = normalizeText(record.whyItMatters).slice(0, 500);
      if (url) normalized.url = url;
      if (publishedAt) normalized.publishedAt = publishedAt;
      if (whyItMatters) normalized.whyItMatters = whyItMatters;
      return normalized;
    })
    .filter((item): item is WebSearchSourceItem => Boolean(item));
}

function parseWebSearchOutput(raw: string): WebSearchAgentOutput {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error(`OpenRouter Web Search agent 没有返回 JSON。原始输出：${raw.slice(0, 600)}`);
  }

  const parsed = JSON.parse(json) as WebSearchAgentOutput;
  return {
    summary: normalizeText(parsed.summary),
    modules: {
      industryDynamics: {
        content: normalizeText(parsed.modules?.industryDynamics?.content),
        items: normalizeItems(parsed.modules?.industryDynamics?.items),
      },
      technologyTrends: {
        content: normalizeText(parsed.modules?.technologyTrends?.content),
        items: normalizeItems(parsed.modules?.technologyTrends?.items),
      },
      competitorMonitoring: {
        content: normalizeText(parsed.modules?.competitorMonitoring?.content),
        items: normalizeItems(parsed.modules?.competitorMonitoring?.items),
      },
    },
    searchLog: Array.isArray(parsed.searchLog) ? parsed.searchLog : [],
  };
}

function buildDefaultTaskSpec(input: AgentRunInput): AgentTaskSpec {
  const now = new Date();
  return {
    objective: `根据用户指令进行联网搜索并整理晨报信息：${input.userQuery}`,
    sourceSelectionCriteria: [
      input.userQuery,
      'AI agent',
      'vibe coding',
      '开发者工具',
      '产品发布',
      '竞品动态',
      '技术趋势',
    ],
    timeWindow: {
      type: 'rolling_hours',
      hours: 24,
      endAt: now.toISOString(),
    },
    returnFormat: {
      sections: ['行业动态', '技术趋势', '竞品监控'],
      instructions: '每条信息必须有来源；优先最近24小时内的公开网页；无法确认时间时标注不确定。',
    },
  };
}

function flattenBriefingItems(output: WebSearchAgentOutput): AgentBriefingItem[] {
  const result: AgentBriefingItem[] = [];
  for (const key of Object.keys(MODULE_LABELS) as WebSearchModuleKey[]) {
    const items = output.modules?.[key]?.items || [];
    for (const item of items) {
      result.push({
        category: MODULE_LABELS[key],
        title: item.title,
        summary: item.whyItMatters ? `${item.summary}\n为什么重要：${item.whyItMatters}` : item.summary,
        source: item.source,
        url: item.url,
        publishedAt: item.publishedAt,
      });
    }
  }
  return result;
}

export async function runWebSearchAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const taskSpec = input.context?.taskSpec || buildDefaultTaskSpec(input);
  const searchIntent = typeof input.context?.webSearchIntent === 'string' ? input.context.webSearchIntent : '';
  const subagentSignals = Array.isArray(input.context?.subagentResults)
    ? input.context.subagentResults
    : [];

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是“联网搜索助手”，属于信息部门，和微信公众号助手平级。',
        '你必须使用可用的 OpenRouter web_search / web_fetch 工具进行搜索和打开网页，不能只凭模型记忆回答。',
        '你根据上级总裁秘书传达的任务要求，自行规划搜索query，优先查找最近24小时内的公开网页信息。',
        '搜索范围必须服从任务要求和用户偏好，过滤掉泛行业新闻、无关公司动态和低质量转载。',
        '输出必须是严格JSON，不要输出markdown。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userQuery: input.userQuery,
        mode: input.mode || 'briefing',
        taskSpec,
        searchIntent,
        existingSignals: subagentSignals,
        outputSchema: {
          summary: 'string',
          modules: {
            industryDynamics: {
              content: 'string',
              items: [
                {
                  title: 'string',
                  summary: 'string',
                  source: 'publisher/domain',
                  url: 'https://...',
                  publishedAt: 'ISO/date string if known',
                  whyItMatters: 'string',
                },
              ],
            },
            technologyTrends: { content: 'string', items: [] },
            competitorMonitoring: { content: 'string', items: [] },
          },
          searchLog: [
            {
              query: 'string',
              reason: 'why this query was searched',
              importantSources: [{ title: 'string', url: 'string', source: 'string' }],
            },
          ],
        },
        hardRules: [
          '每个模块最多50条items。',
          '每条item都必须来自搜索或网页读取结果，必须包含source，能拿到url时必须包含url。',
          '没有足够证据的内容不要编造；找不到某模块信息时items为空并在content说明。',
          '只返回JSON对象。',
        ],
      }),
    },
  ];

  const startedAt = Date.now();
  const raw = await createChatCompletion(messages, getOpenRouterModel('WEB_SEARCH'), {
    enableWebTools: true,
    maxTokens: 4200,
  });
  const output = parseWebSearchOutput(raw);
  const briefingItems = flattenBriefingItems(output);
  const toolCalls: AgentRunToolCall[] = [
    {
      toolName: 'openrouterWebSearchAgent',
      status: briefingItems.length > 0 ? 'SUCCESS' : 'ERROR',
      args: {
        taskSpec,
        searchIntent,
        enableWebTools: true,
      },
      result: {
        summary: output.summary,
        searchLog: output.searchLog,
        moduleItemCounts: Object.fromEntries(
          (Object.keys(MODULE_LABELS) as WebSearchModuleKey[]).map((key) => [
            MODULE_LABELS[key],
            output.modules?.[key]?.items?.length || 0,
          ])
        ),
      },
    },
  ];

  return {
    agentType: 'WEB_SEARCH',
    answer: output.summary || raw.slice(0, 2000),
    briefingItems,
    toolCalls,
    debug: {
      provider: 'openrouter_native_web_tools',
      model: getOpenRouterModel('WEB_SEARCH'),
      durationMs: Date.now() - startedAt,
      itemCount: briefingItems.length,
      searchLog: output.searchLog,
      moduleItemCounts: Object.fromEntries(
        (Object.keys(MODULE_LABELS) as WebSearchModuleKey[]).map((key) => [
          MODULE_LABELS[key],
          output.modules?.[key]?.items?.length || 0,
        ])
      ),
    },
  };
}
