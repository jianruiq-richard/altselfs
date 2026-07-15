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
    throw new Error(`OpenRouter Web Search agent instruction JSON.instruction: ${raw.slice(0, 600)}`);
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
    throw new Error(`instruction Step2 instruction JSON.instruction: ${raw.slice(0, 600)}`);
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
    objective: `instruction: ${input.userQuery}`,
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
      instructions: 'instruction; instruction24instruction; instruction.instructionInformation Digestinstruction; Today To-DosinstructionExecutive Assistantinstruction; Twin Recommendationsinstruction.',
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
        summary: item.whyItMatters ? `${item.summary}\ninstruction: ${item.whyItMatters}` : item.summary,
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
      goal: 'instruction OpenRouter web_search / web_fetch instruction.',
    },
    {
      id: 'web_search_summarize',
      goal: 'instruction, instruction.',
    },
    {
      id: 'web_search_structure',
      goal: 'instructionInformation Digestinstruction JSON.',
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
        'instruction"instruction"instruction Step1 instruction.',
        'instruction OpenRouter web_search / web_fetch toolinstruction, instruction.',
        'instructionExecutive Assistantinstruction, instruction query, instruction24instruction.',
        'instruction; instructionCompleteinstructionCompleted, instructionJSON.',
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
          'instructiontool.',
          'instruction, instruction/instruction taskSpec instruction searchIntent instruction.',
          'instruction24instruction; instruction.',
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
    throw new Error(`instruction Step1 instruction.instruction: ${searchStep.content.slice(0, 600)}`);
  }

  const summarizeMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'instruction"instruction"instruction Step2 instruction, instructionJSON.',
        'instruction Step1 instruction.instructionExecutive Assistantinstruction, instruction, instruction.',
        'instruction.instruction.',
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
              summary: '120instruction, instruction',
              evidence: 'instruction',
              relevance: 'instruction',
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
        'instruction"instruction"instruction Step3 Information Digestinstruction, instructionJSON.',
        'instruction Step2 instruction.instructionInformation Digestinstruction.',
        'Today To-DosinstructionExecutive Assistantinstruction; Twin Recommendationsinstruction, instruction.',
        'instruction item instruction Step2 findings, instruction source instruction url.',
        'instruction, instruction.',
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
          'instruction50instructionitems.',
          'instructioniteminstructionStep2 findings.',
          'instruction; instructionitemsinstructioncontentinstruction.',
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
