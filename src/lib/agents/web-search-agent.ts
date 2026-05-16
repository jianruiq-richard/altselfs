import {
  createChatCompletionWithMetadata,
  createJsonChatCompletion,
  getOpenRouterModel,
  type ChatCompletionMetadata,
  type ChatMessage,
} from '@/lib/openrouter';
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

type WebSearchCitation = {
  title: string;
  url: string;
  source: string;
  content: string;
};

type WebSearchFinding = {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  summary: string;
  evidence: string;
  relevance: string;
};

type WebSearchSummaryOutput = {
  summary?: string;
  findings?: WebSearchFinding[];
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

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'OpenRouter Web Search';
  }
}

function extractWebSearchCitations(message: ChatCompletionMetadata['rawMessage']): WebSearchCitation[] {
  if (!message || !Array.isArray(message.annotations)) return [];
  const citations: WebSearchCitation[] = [];
  const seen = new Set<string>();
  for (const annotation of message.annotations) {
    if (!annotation || typeof annotation !== 'object') continue;
    const record = annotation as Record<string, unknown>;
    if (record.type !== 'url_citation') continue;
    const citation = record.url_citation;
    if (!citation || typeof citation !== 'object') continue;
    const raw = citation as Record<string, unknown>;
    const url = normalizeText(raw.url);
    const title = normalizeText(raw.title);
    const content = normalizeText(raw.content);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    citations.push({
      title,
      url,
      source: getDomain(url),
      content: content.slice(0, 5000),
    });
  }
  return citations;
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

function parseWebSearchSummary(raw: string): WebSearchSummaryOutput {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error(`联网搜索 Step2 没有返回 JSON。原始输出：${raw.slice(0, 600)}`);
  }
  const parsed = JSON.parse(json) as WebSearchSummaryOutput;
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .map((item): WebSearchFinding | null => {
          if (!item || typeof item !== 'object') return null;
          const record = item as Record<string, unknown>;
          const title = normalizeText(record.title).slice(0, 220);
          const url = normalizeText(record.url);
          const summary = normalizeText(record.summary).slice(0, 700);
          if (!title || !url || !summary) return null;
          return {
            title,
            url,
            source: normalizeText(record.source, getDomain(url)).slice(0, 180),
            publishedAt: normalizeText(record.publishedAt) || undefined,
            summary,
            evidence: normalizeText(record.evidence).slice(0, 700),
            relevance: normalizeText(record.relevance).slice(0, 500),
          };
        })
        .filter((item): item is WebSearchFinding => Boolean(item))
    : [];
  return {
    summary: normalizeText(parsed.summary),
    findings,
  };
}

function buildDefaultTaskSpec(input: AgentRunInput): AgentTaskSpec {
  const now = new Date();
  return {
    objective: `根据用户指令进行联网搜索并整理晨报信息：${input.userQuery}`,
    sourceSelectionCriteria: [
      input.userQuery,
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
  const startedAt = Date.now();
  const toolCalls: AgentRunToolCall[] = [];
  const steps = [
    {
      id: 'web_search_collect',
      goal: '按照晨报秘书指令调用 OpenRouter web_search / web_fetch 获取公开网页资料。',
    },
    {
      id: 'web_search_summarize',
      goal: '基于搜索资料精简为可用于晨报的信息点，不引入外部信息。',
    },
    {
      id: 'web_search_structure',
      goal: '把精简信息点结构化为行业动态、技术趋势、竞品监控三模块 JSON。',
    },
  ];

  toolCalls.push({
    toolName: 'webSearchAgentPlan',
    status: 'SUCCESS',
    args: { taskSpec, searchIntent },
    result: { steps },
  });

  const searchMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是“联网搜索助手”的 Step1 搜索执行器。',
        '你必须使用可用的 OpenRouter web_search / web_fetch 工具进行搜索和打开网页，不能只凭模型记忆回答。',
        '你根据上级总裁秘书传达的任务要求，自行规划搜索 query，优先查找最近24小时内的公开网页信息。',
        '本步骤只负责获得搜索资料；搜索完成后用一句话说明已完成，不需要输出最终晨报JSON。',
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
        hardRules: [
          '必须实际调用搜索工具。',
          '搜索范围、关键词和筛选/保留策略必须以 taskSpec 和上级传达的 searchIntent 为准。',
          '优先最近24小时内资料；无法确认发布时间的资料可以保留但后续需要标注不确定。',
        ],
      }),
    },
  ];

  const searchStep = await createChatCompletionWithMetadata(searchMessages, getOpenRouterModel('WEB_SEARCH'), {
    enableWebTools: true,
    maxTokens: 12000,
  });
  const citations = extractWebSearchCitations(searchStep.rawMessage);
  toolCalls.push({
    toolName: 'webSearchCollect',
    status: citations.length > 0 ? 'SUCCESS' : 'ERROR',
    args: {
      step: steps[0],
      model: searchStep.model,
      toolCount: searchStep.tools.length,
      assistantContent: searchStep.content,
    },
    result: {
      citationCount: citations.length,
      citations: citations.map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source,
        contentPreview: item.content.slice(0, 500),
      })),
    },
  });
  if (citations.length === 0) {
    throw new Error(`联网搜索 Step1 未获得搜索结果。模型输出：${searchStep.content.slice(0, 600)}`);
  }

  const summarizeMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是“联网搜索助手”的 Step2 信息精简器，只输出严格JSON。',
        '你会收到 Step1 的搜索资料。请根据总裁秘书任务筛选、去重、精简。',
        '不要引入搜索资料之外的信息。不要为了凑数保留低相关内容。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userQuery: input.userQuery,
        taskSpec,
        searchIntent,
        stepInput: {
          citations,
        },
        outputSchema: {
          summary: 'string',
          findings: [
            {
              title: 'string',
              url: 'string',
              source: 'publisher/domain',
              publishedAt: 'date if known, otherwise empty',
              summary: '120字以内，提炼这条资料的关键事实',
              evidence: '资料中的关键证据',
              relevance: '为什么符合本轮晨报任务',
            },
          ],
        },
      }),
    },
  ];
  const summarizedRaw = await createJsonChatCompletion(
    summarizeMessages,
    getOpenRouterModel('WEB_SEARCH'),
    { maxTokens: 6000 }
  );
  const summarized = parseWebSearchSummary(summarizedRaw);
  toolCalls.push({
    toolName: 'webSearchSummarize',
    status: summarized.findings && summarized.findings.length > 0 ? 'SUCCESS' : 'ERROR',
    args: {
      step: steps[1],
      citationCount: citations.length,
    },
    result: {
      summary: summarized.summary,
      findingCount: summarized.findings?.length || 0,
      findings: summarized.findings,
    },
  });

  const structureMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        '你是“联网搜索助手”的 Step3 三模块结构化器，只输出严格JSON。',
        '你会收到 Step2 的精简信息点。请按总裁秘书要求归类为行业动态、技术趋势、竞品监控。',
        '每条 item 必须来自 Step2 findings，必须保留 source 和 url。',
        '不要编造，不要引入搜索资料之外的信息。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        userQuery: input.userQuery,
        taskSpec,
        searchIntent,
        stepInput: summarized,
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
                  publishedAt: 'date if known',
                  whyItMatters: 'string',
                },
              ],
            },
            technologyTrends: { content: 'string', items: [] },
            competitorMonitoring: { content: 'string', items: [] },
          },
          searchLog: [
            {
              query: 'derived from Step1 search intent',
              reason: 'why this area was searched',
              importantSources: [{ title: 'string', url: 'string', source: 'string' }],
            },
          ],
        },
        hardRules: [
          '每个模块最多50条items。',
          '每条item都必须来自Step2 findings。',
          '没有足够证据的内容不要编造；找不到某模块信息时items为空并在content说明。',
        ],
      }),
    },
  ];
  const structuredRaw = await createJsonChatCompletion(
    structureMessages,
    getOpenRouterModel('WEB_SEARCH'),
    { maxTokens: 8000 }
  );
  const output = parseWebSearchOutput(structuredRaw);
  const briefingItems = flattenBriefingItems(output);
  toolCalls.push({
    toolName: 'webSearchStructure',
    status: briefingItems.length > 0 ? 'SUCCESS' : 'ERROR',
    args: {
      step: steps[2],
      findingCount: summarized.findings?.length || 0,
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
  });

  return {
    agentType: 'WEB_SEARCH',
    answer: output.summary || summarized.summary || searchStep.content.slice(0, 2000),
    briefingItems,
    toolCalls,
    debug: {
      provider: 'openrouter_native_web_tools',
      model: getOpenRouterModel('WEB_SEARCH'),
      durationMs: Date.now() - startedAt,
      steps,
      citationCount: citations.length,
      findingCount: summarized.findings?.length || 0,
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
