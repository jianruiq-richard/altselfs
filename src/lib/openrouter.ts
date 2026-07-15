import OpenAI from 'openai';
import { mkdir, appendFile } from 'fs/promises';
import path from 'path';

// Initialize OpenRouter client
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    // Header values must be ASCII/latin1-safe in Node runtime.
    "X-Title": "AltSelfs Platform",
  }
});

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type toolChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }
  | {
      role: 'tool';
      tool_call_id: string;
      content: string;
    };

export type OpenRouterFunctiontool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

type JsonSchemaResponseFormat = {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
};

type OpenRouterServertool =
  | {
      type: 'openrouter:web_search';
      parameters?: {
        engine?: string;
        max_results?: number;
        max_total_results?: number;
        search_context_size?: string;
      };
    }
  | {
      type: 'openrouter:web_fetch';
      parameters?: {
        engine?: string;
        max_uses?: number;
        max_content_tokens?: number;
      };
    };

type ChatCompletionResult = {
  choices: Array<{
    message?: {
      content?: string | null;
      [key: string]: unknown;
    };
  }>;
  [key: string]: unknown;
};

type ChatCompletionRequestResult = {
  content: string;
  completion: ChatCompletionResult;
  tools: OpenRouterServertool[];
};

type OpenRouterProviderRouting = {
  order?: string[];
  only?: string[];
  ignore?: string[];
  sort?: string;
  allow_fallbacks?: boolean;
  require_parameters?: boolean;
};

type JsonCompletionRequestResult = {
  content: string;
  completion: ChatCompletionResult;
  providerRouting?: OpenRouterProviderRouting;
};

export type ChatCompletionMetadata = {
  content: string;
  model: string;
  tools: OpenRouterServertool[];
  rawMessage: ChatCompletionResult['choices'][number]['message'] | null;
  rawCompletion: ChatCompletionResult;
};

export type toolChatCompletionMetadata = {
  model: string;
  rawMessage: ChatCompletionResult['choices'][number]['message'] | null;
  rawCompletion: ChatCompletionResult;
};

const DEFAULT_OPENROUTER_MODELS = {
  primary: 'deepseek/deepseek-v3.2',
  fallback: 'deepseek/deepseek-v3.2',
  backup: 'deepseek/deepseek-v3.2',
  regionFallback1: 'deepseek/deepseek-v3.2',
  regionFallback2: 'deepseek/deepseek-v3.2',
};

const DEFAULT_AGENT_MODELS = {
  CHAT: 'deepseek/deepseek-v3.2',
  EVALUATOR: 'deepseek/deepseek-v3.2',
  EXECUTIVE: 'deepseek/deepseek-v3.2',
  EXECUTIVE_PLANNER: 'deepseek/deepseek-v3.2',
  EXECUTIVE_STRUCTURER: 'deepseek/deepseek-v3.2',
  WEB_SEARCH: 'deepseek/deepseek-v3.2',
  WECHAT_AGENT: 'deepseek/deepseek-v3.2',
  WECHAT_SOURCE_SELECTOR: 'deepseek/deepseek-v3.2',
  WECHAT_SOURCES_PLANNER: 'deepseek/deepseek-v3.2',
  WECHAT_SOURCES_ASSISTANT: 'deepseek/deepseek-v3.2',
  MAIL_AGENT_PRIMARY: 'deepseek/deepseek-v3.2',
  MAIL_AGENT_FALLBACK: 'deepseek/deepseek-v3.2',
  XHS_PLANNER: 'deepseek/deepseek-v3.2',
  XHS_ASSISTANT: 'deepseek/deepseek-v3.2',
} as const;

const DEFAULT_JSON_PROVIDER_ORDER = ['Friendli', 'Baidu', 'Alibaba'];

export type OpenRouterAgentModelKey = keyof typeof DEFAULT_AGENT_MODELS;

export interface QualificationResult {
  status: 'PENDING' | 'NEEDS_INFO' | 'QUALIFIED' | 'REJECTED';
  score: number;
  needsInvestorReview: boolean;
  reason: string;
  summary: string;
}

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function readBoolEnv(key: string, fallback: boolean) {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readPositiveIntEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.round(value);
}

function readCsvEnv(key: string, fallback: string[]) {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const OPENROUTER_REQUEST_TIMEOUT_MS = readPositiveIntEnv('OPENROUTER_REQUEST_TIMEOUT_MS', 60_000);
const OPENROUTER_MAX_MODEL_ATTEMPTS = readPositiveIntEnv('OPENROUTER_MAX_MODEL_ATTEMPTS', 3);

function isTraceEnabled() {
  const raw = process.env.OPENROUTER_TRACE_ENABLED;
  if (raw !== undefined) return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
  return process.env.NODE_ENV === 'development';
}

async function appendOpenRouterTrace(entry: Record<string, unknown>) {
  if (!isTraceEnabled()) return;
  try {
    const dir = process.env.OPENROUTER_TRACE_DIR || path.join(process.cwd(), '.debug', 'openrouter-traces');
    await mkdir(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    await appendFile(
      path.join(dir, `${date}.jsonl`),
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
      'utf8'
    );
  } catch (error) {
    console.error('[openrouter] trace write failed', getErrorMessage(error));
  }
}

function getOpenRouterServertools(): OpenRouterServertool[] {
  if (!readBoolEnv('OPENROUTER_WEB_TOOLS_ENABLED', true)) return [];

  const tools: OpenRouterServertool[] = [];
  if (readBoolEnv('OPENROUTER_WEB_SEARCH_ENABLED', true)) {
    tools.push({
      type: 'openrouter:web_search',
      parameters: {
        engine: process.env.OPENROUTER_WEB_SEARCH_ENGINE || 'auto',
        max_results: readPositiveIntEnv('OPENROUTER_WEB_SEARCH_MAX_RESULTS', 5),
        max_total_results: readPositiveIntEnv('OPENROUTER_WEB_SEARCH_MAX_TOTAL_RESULTS', 20),
        search_context_size: process.env.OPENROUTER_WEB_SEARCH_CONTEXT_SIZE || 'medium',
      },
    });
  }

  if (readBoolEnv('OPENROUTER_WEB_FETCH_ENABLED', true)) {
    tools.push({
      type: 'openrouter:web_fetch',
      parameters: {
        engine: process.env.OPENROUTER_WEB_FETCH_ENGINE || 'auto',
        max_uses: readPositiveIntEnv('OPENROUTER_WEB_FETCH_MAX_USES', 10),
        max_content_tokens: readPositiveIntEnv('OPENROUTER_WEB_FETCH_MAX_CONTENT_TOKENS', 50000),
      },
    });
  }

  return tools;
}

function getJsonProviderRouting(): OpenRouterProviderRouting | undefined {
  const order = readCsvEnv('OPENROUTER_JSON_PROVIDER_ORDER', DEFAULT_JSON_PROVIDER_ORDER);
  if (order.length === 0) return undefined;

  return {
    order,
    allow_fallbacks: readBoolEnv('OPENROUTER_JSON_PROVIDER_ALLOW_FALLBACKS', true),
    require_parameters: readBoolEnv('OPENROUTER_JSON_PROVIDER_REQUIRE_PARAMETERS', true),
  };
}

function safeParseQualification(raw: string): QualificationResult {
  try {
    const parsed = JSON.parse(extractJsonObject(raw) ?? raw) as Partial<QualificationResult>;
    const allowedStatus = new Set(['PENDING', 'NEEDS_INFO', 'QUALIFIED', 'REJECTED']);
    const status = allowedStatus.has(parsed.status || '') ? parsed.status : 'NEEDS_INFO';

    return {
      status: status as QualificationResult['status'],
      score: clampScore(Number(parsed.score ?? 0)),
      needsInvestorReview: Boolean(parsed.needsInvestorReview),
      reason: String(parsed.reason || 'No reason provided.'),
      summary: String(parsed.summary || 'No summary available.'),
    };
  } catch {
    return {
      status: 'NEEDS_INFO',
      score: 0,
      needsInvestorReview: false,
      reason: 'The evaluation response could not be parsed. More information is needed.',
      summary: 'Unable to generate a reliable summary.',
    };
  }
}

async function requestCompletion(
  messages: ChatMessage[],
  model: string,
  options?: { enableWebtools?: boolean; maxTokens?: number }
): Promise<ChatCompletionRequestResult> {
  const tools = options?.enableWebtools === false ? [] : getOpenRouterServertools();
  const completion = (await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_CHAT_MAX_TOKENS', 12000),
    stream: false,
    ...(tools.length > 0 ? { tools } : {}),
  } as Parameters<typeof openai.chat.completions.create>[0], {
    timeout: OPENROUTER_REQUEST_TIMEOUT_MS,
  })) as unknown as ChatCompletionResult;

  return {
    content: completion.choices[0]?.message?.content || '',
    completion,
    tools,
  };
}

async function requesttoolCompletion(
  messages: toolChatMessage[],
  tools: OpenRouterFunctiontool[],
  model: string,
  options?: { maxTokens?: number; toolChoice?: 'auto' | 'none'; paralleltoolCalls?: boolean }
) {
  const completion = (await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.3,
    max_tokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_AGENT_MAX_TOKENS', 12000),
    tools,
    tool_choice: options?.toolChoice || 'auto',
    parallel_tool_calls: options?.paralleltoolCalls ?? true,
    stream: false,
  } as Parameters<typeof openai.chat.completions.create>[0], {
    timeout: OPENROUTER_REQUEST_TIMEOUT_MS,
  })) as unknown as ChatCompletionResult;

  return {
    completion,
  };
}

async function requestJsonCompletion(
  messages: ChatMessage[],
  model: string,
  options?: { maxTokens?: number; jsonSchema?: JsonSchemaResponseFormat }
) {
  const providerRouting = getJsonProviderRouting();
  const completion = (await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.1,
    max_tokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_JSON_MAX_TOKENS', 16000),
    response_format: options?.jsonSchema
      ? { type: 'json_schema', json_schema: options.jsonSchema }
      : { type: 'json_object' },
    ...(providerRouting ? { provider: providerRouting } : {}),
  } as Parameters<typeof openai.chat.completions.create>[0], {
    timeout: OPENROUTER_REQUEST_TIMEOUT_MS,
  })) as unknown as ChatCompletionResult;

  return {
    content: completion.choices[0]?.message?.content || '',
    completion,
    providerRouting,
  } satisfies JsonCompletionRequestResult;
}

function extractJsonObject(raw: string): string | null {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch?.[1]) {
    const candidate = fenceMatch[1].trim();
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      return candidate;
    }
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'unknown error';
}

function uniqueModels(models: Array<string | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const model of models) {
    const value = model?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function getOpenRouterModel(key: OpenRouterAgentModelKey) {
  return process.env[`OPENROUTER_MODEL_${key}`]?.trim() || DEFAULT_AGENT_MODELS[key];
}

export function getOpenRouterModelCandidates(keys: OpenRouterAgentModelKey[] = []) {
  return uniqueModels([
    ...keys.map((key) => getOpenRouterModel(key)),
    process.env.OPENROUTER_MODEL_PRIMARY || DEFAULT_OPENROUTER_MODELS.primary,
    process.env.OPENROUTER_MODEL_FALLBACK || DEFAULT_OPENROUTER_MODELS.fallback,
    process.env.OPENROUTER_MODEL_BACKUP || DEFAULT_OPENROUTER_MODELS.backup,
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_1 || DEFAULT_OPENROUTER_MODELS.regionFallback1,
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_2 || DEFAULT_OPENROUTER_MODELS.regionFallback2,
  ]);
}

export async function createChatCompletion(
  messages: ChatMessage[],
  model?: string,
  options?: { enableWebtools?: boolean; maxTokens?: number }
) {
  const result = await createChatCompletionWithMetadata(messages, model, options);
  return result.content;
}

export async function createChatCompletionWithMetadata(
  messages: ChatMessage[],
  model?: string,
  options?: { enableWebtools?: boolean; maxTokens?: number }
): Promise<ChatCompletionMetadata> {
  const candidates = uniqueModels([model, ...getOpenRouterModelCandidates()]).slice(0, OPENROUTER_MAX_MODEL_ATTEMPTS);

  let lastError: unknown;
  const tried: string[] = [];

  for (const currentModel of candidates) {
    tried.push(currentModel);
    const startedAt = Date.now();
    console.log('[openrouter] chat start', {
      model: currentModel,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
    });
    try {
      const result = await requestCompletion(messages, currentModel, options);
      await appendOpenRouterTrace({
        type: 'chat',
        status: 'success',
        model: currentModel,
        durationMs: Date.now() - startedAt,
        maxTokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_CHAT_MAX_TOKENS', 12000),
        tools: result.tools,
        messages,
        output: result.content,
        rawMessage: result.completion.choices[0]?.message || null,
        rawCompletion: result.completion,
      });
      console.log('[openrouter] chat success', {
        model: currentModel,
        durationMs: Date.now() - startedAt,
        outputLength: result.content.length,
        hastoolCalls: Boolean(result.completion.choices[0]?.message && 'tool_calls' in result.completion.choices[0].message),
      });
      return {
        content: result.content,
        model: currentModel,
        tools: result.tools,
        rawMessage: result.completion.choices[0]?.message || null,
        rawCompletion: result.completion,
      };
    } catch (error) {
      lastError = error;
      await appendOpenRouterTrace({
        type: 'chat',
        status: 'error',
        model: currentModel,
        durationMs: Date.now() - startedAt,
        messages,
        error: getErrorMessage(error),
      });
      console.error('[openrouter] chat failed', {
        model: currentModel,
        durationMs: Date.now() - startedAt,
        error: getErrorMessage(error),
      });
      console.error(`OpenRouter API error (${currentModel}):`, error);
    }
  }

  const detail = getErrorMessage(lastError);
  throw new Error(`OpenRouter failed after trying models [${tried.join(', ')}]: ${detail}`);
}

export async function createtoolChatCompletionWithMetadata(
  messages: toolChatMessage[],
  tools: OpenRouterFunctiontool[],
  model?: string,
  options?: { maxTokens?: number; toolChoice?: 'auto' | 'none'; paralleltoolCalls?: boolean }
): Promise<toolChatCompletionMetadata> {
  const candidates = uniqueModels([model, ...getOpenRouterModelCandidates()]).slice(0, OPENROUTER_MAX_MODEL_ATTEMPTS);

  let lastError: unknown;
  const tried: string[] = [];

  for (const currentModel of candidates) {
    tried.push(currentModel);
    const startedAt = Date.now();
    console.log('[openrouter] tool-chat start', {
      model: currentModel,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
      toolCount: tools.length,
    });
    try {
      const result = await requesttoolCompletion(messages, tools, currentModel, options);
      const rawMessage = result.completion.choices[0]?.message || null;
      await appendOpenRouterTrace({
        type: 'tool_chat',
        status: 'success',
        model: currentModel,
        durationMs: Date.now() - startedAt,
        maxTokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_AGENT_MAX_TOKENS', 12000),
        toolChoice: options?.toolChoice || 'auto',
        tools,
        messages,
        rawMessage,
        rawCompletion: result.completion,
      });
      console.log('[openrouter] tool-chat success', {
        model: currentModel,
        durationMs: Date.now() - startedAt,
        hastoolCalls: Boolean(rawMessage && 'tool_calls' in rawMessage),
      });
      return {
        model: currentModel,
        rawMessage,
        rawCompletion: result.completion,
      };
    } catch (error) {
      lastError = error;
      await appendOpenRouterTrace({
        type: 'tool_chat',
        status: 'error',
        model: currentModel,
        durationMs: Date.now() - startedAt,
        messages,
        tools,
        error: getErrorMessage(error),
      });
      console.error('[openrouter] tool-chat failed', {
        model: currentModel,
        durationMs: Date.now() - startedAt,
        error: getErrorMessage(error),
      });
    }
  }

  const detail = getErrorMessage(lastError);
  throw new Error(`OpenRouter tool chat failed after trying models [${tried.join(', ')}]: ${detail}`);
}

export async function createJsonChatCompletion(
  messages: ChatMessage[],
  model?: string,
  options?: { maxTokens?: number; jsonSchema?: JsonSchemaResponseFormat }
) {
  const candidates = uniqueModels([model, ...getOpenRouterModelCandidates()]).slice(0, OPENROUTER_MAX_MODEL_ATTEMPTS);

  let lastError: unknown;
  const tried: string[] = [];

  for (const currentModel of candidates) {
    tried.push(currentModel);
    const startedAt = Date.now();
    console.log('[openrouter] json start', {
      model: currentModel,
      timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS,
      maxTokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_JSON_MAX_TOKENS', 16000),
      responseFormat: options?.jsonSchema ? { type: 'json_schema', name: options.jsonSchema.name } : { type: 'json_object' },
      provider: getJsonProviderRouting(),
    });
    try {
      const result = await requestJsonCompletion(messages, currentModel, options);
      const raw = result.content;
      await appendOpenRouterTrace({
        type: 'json',
        status: raw.trim() ? 'success' : 'empty',
        model: currentModel,
        durationMs: Date.now() - startedAt,
        maxTokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_JSON_MAX_TOKENS', 16000),
        responseFormat: options?.jsonSchema ? { type: 'json_schema', name: options.jsonSchema.name } : { type: 'json_object' },
        providerRouting: result.providerRouting,
        provider: result.completion.provider,
        messages,
        output: raw,
        rawCompletion: result.completion,
      });
      console.log('[openrouter] json success', {
        model: currentModel,
        provider: result.completion.provider,
        durationMs: Date.now() - startedAt,
        empty: !raw.trim(),
      });
      if (raw.trim()) {
        return raw;
      }
    } catch (error) {
      lastError = error;
      await appendOpenRouterTrace({
        type: 'json',
        status: 'error',
        model: currentModel,
        durationMs: Date.now() - startedAt,
        maxTokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_JSON_MAX_TOKENS', 16000),
        messages,
        error: getErrorMessage(error),
      });
      console.error('[openrouter] json failed', {
        model: currentModel,
        durationMs: Date.now() - startedAt,
        error: getErrorMessage(error),
      });
      console.error(`OpenRouter JSON API error (${currentModel}):`, error);
    }
  }

  const detail = getErrorMessage(lastError);
  throw new Error(`OpenRouter JSON failed after trying models [${tried.join(', ')}]: ${detail}`);
}

export async function evaluateConversation(
  avatarSystemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<QualificationResult> {
  const evaluationPrompt = `Evaluate this conversation against the digital twin's system prompt and decide whether the candidate is qualified.

Instructions:
1) Use the digital twin system prompt as the evaluation rubric.
2) Assess relevance, clarity, expertise, consistency, risk, and whether the candidate needs investor review.
3) Return strict JSON only.

JSON schema:
{
  "status": "PENDING|NEEDS_INFO|QUALIFIED|REJECTED",
  "score": 0-100,
  "needsInvestorReview": true/false,
  "reason": "A concise explanation for the decision",
  "summary": "A professional summary in 180 words or fewer"
}

Status guidance:
- QUALIFIED: The conversation shows strong fit and enough information to proceed.
- NEEDS_INFO: The conversation is promising but lacks important details.
- REJECTED: The conversation clearly shows poor fit or high risk.
- PENDING: The conversation is too early to decide.

Digital twin system prompt:
${avatarSystemPrompt}`;

  const evaluationMessages: ChatMessage[] = [
    { role: 'system', content: evaluationPrompt },
    ...messages,
  ];

  const candidates = getOpenRouterModelCandidates(['EVALUATOR']);

  let raw = '';
  let lastError: unknown;

  for (const model of candidates) {
    try {
      raw = (await requestJsonCompletion(evaluationMessages, model)).content;
      if (raw.trim()) break;
    } catch (error) {
      lastError = error;
      console.error(`Evaluation model error (${model}):`, error);
    }
  }

  if (!raw.trim()) {
    const detail = getErrorMessage(lastError);
    console.error(`Evaluation failed across all models: ${detail}`);
    return {
      status: 'NEEDS_INFO',
      score: 0,
      needsInvestorReview: false,
      reason: 'No model returned a usable evaluation.',
      summary: 'Unable to evaluate this conversation reliably.',
    };
  }

  return safeParseQualification(raw);
}

// Model options shown in the product and used by server-side routing.
export const availableModels = [
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    description: "Default model for balanced chat, reasoning, and agent tasks."
  },
  {
    id: "qwen/qwen3-max",
    name: "Qwen3 Max",
    description: "Strong general-purpose model with reliable structured JSON output."
  },
  {
    id: "z-ai/glm-4.6",
    name: "GLM 4.6",
    description: "Useful for planning-heavy workflows and tool-driven agent tasks."
  },
  {
    id: "moonshotai/kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    description: "Long-context reasoning model for complex analysis and agent workflows."
  }
];
