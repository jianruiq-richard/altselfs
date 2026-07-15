import {
  createChatCompletionWithMetadata,
  createJsonChatCompletion,
  getOpenRouterModel,
  type ChatCompletionMetadata,
  type ChatMessage,
} from '@/lib/openrouter';
import type { AgentBriefingItem, AgentRunInput, AgentRunResult, AgentRuntoolCall, AgentTaskSpec } from '@/lib/agents/types';

type WebSearchModuleKey = 'informationSummary';

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
  informationSummary: 'Information Digest',
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
    throw new Error(`OpenRouter Web Search agent did not return valid JSON: ${raw.slice(0, 600)}`);
  }

  const parsed = JSON.parse(json) as WebSearchAgentOutput;
  return {
    summary: normalizeText(parsed.summary),
    modules: {
      informationSummary: {
        content: normalizeText(parsed.modules?.informationSummary?.content),
        items: normalizeItems(parsed.modules?.informationSummary?.items),
      },
    },
    searchLog: Array.isArray(parsed.searchLog) ? parsed.searchLog : [],
  };
}

function parseWebSearchSummary(raw: string): WebSearchSummaryOutput {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new Error(`Step 2 did not return valid JSON: ${raw.slice(0, 600)}`);
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
    objective: `Research request: ${input.userQuery}`,
    sourceSelectionCriteria: [
      input.userQuery,
    ],
    timeWindow: {
      type: 'rolling_hours',
      hours: 24,
      endAt: now.toISOString(),
    },
    returnFormat: {
      sections: ['Information Digest'],
      instructions: 'Prioritize credible, recent sources from the last 24 hours when possible. Return an Information Digest; use Today To-Dos and Twin Recommendations only when requested by the caller.',
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
        summary: item.whyItMatters ? `${item.summary}\nWhy it matters: ${item.whyItMatters}` : item.summary,
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
  const toolCalls: AgentRuntoolCall[] = [];
  const steps = [
    {
      id: 'web_search_collect',
      goal: 'Collect fresh evidence with OpenRouter web_search and web_fetch.',
    },
    {
      id: 'web_search_summarize',
      goal: 'Summarize citations into evidence-backed findings.',
    },
    {
      id: 'web_search_structure',
      goal: 'Structure findings into Information Digest JSON.',
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
        'You are Step 1 of a web research agent.',
        'Use OpenRouter web_search and web_fetch tools to find credible, current sources.',
        'Focus on the Executive Assistant request, derived search intent, and the requested time window.',
        'After tool use is complete, return a short JSON-compatible research note.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        channelInstruction: input.userQuery,
        mode: input.mode || 'briefing',
        taskSpec,
        searchIntent,
        ...(subagentSignals.length > 0 ? { existingSignals: subagentSignals } : {}),
        hardRules: [
          'Use web tools before answering.',
          'Search queries must follow taskSpec and searchIntent.',
          'Prefer sources from the last 24 hours when the request asks for current updates.',
        ],
      }),
    },
  ];

  const searchStep = await createChatCompletionWithMetadata(searchMessages, getOpenRouterModel('WEB_SEARCH'), {
    enableWebtools: true,
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
    throw new Error(`Step 1 returned no citations. Assistant content: ${searchStep.content.slice(0, 600)}`);
  }

  const summarizeMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are Step 2 of a web research agent. Return strict JSON.',
        'Use the Step 1 citations to produce concise, evidence-backed findings for Executive Assistant.',
        'Do not invent URLs or sources.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        channelInstruction: input.userQuery,
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
              summary: '120 words or fewer, factual and specific',
              evidence: 'direct evidence from the cited source',
              relevance: 'why this finding matters to the user request',
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
        'You are Step 3 of a web research agent. Return strict JSON.',
        'Transform Step 2 findings into an Information Digest module.',
        'Do not add Today To-Dos or Twin Recommendations unless the task explicitly requested them.',
        'Every item must be grounded in Step 2 findings and include its source URL.',
        'Keep the language concise and professional.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        channelInstruction: input.userQuery,
        taskSpec,
        searchIntent,
        stepInput: summarized,
        outputSchema: {
          summary: 'string',
          modules: {
            informationSummary: {
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
          'Return no more than 50 items.',
          'Each item must come from Step 2 findings.',
          'Do not create empty sections; informationSummary.content should summarize the items.',
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
