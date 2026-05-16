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

type OpenRouterServerTool =
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
  tools: OpenRouterServerTool[];
};

export type ChatCompletionMetadata = {
  content: string;
  model: string;
  tools: OpenRouterServerTool[];
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

function getOpenRouterServerTools(): OpenRouterServerTool[] {
  if (!readBoolEnv('OPENROUTER_WEB_TOOLS_ENABLED', true)) return [];

  const tools: OpenRouterServerTool[] = [];
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

function safeParseQualification(raw: string): QualificationResult {
  try {
    const parsed = JSON.parse(extractJsonObject(raw) ?? raw) as Partial<QualificationResult>;
    const allowedStatus = new Set(['PENDING', 'NEEDS_INFO', 'QUALIFIED', 'REJECTED']);
    const status = allowedStatus.has(parsed.status || '') ? parsed.status : 'NEEDS_INFO';

    return {
      status: status as QualificationResult['status'],
      score: clampScore(Number(parsed.score ?? 0)),
      needsInvestorReview: Boolean(parsed.needsInvestorReview),
      reason: String(parsed.reason || '暂无明确理由'),
      summary: String(parsed.summary || '暂无总结'),
    };
  } catch {
    return {
      status: 'NEEDS_INFO',
      score: 0,
      needsInvestorReview: false,
      reason: '评估结果解析失败，已回退为待补充信息状态。',
      summary: '当前会话信息不足或评估格式异常，请继续追问关键信息后再评估。',
    };
  }
}

async function requestCompletion(
  messages: ChatMessage[],
  model: string,
  options?: { enableWebTools?: boolean; maxTokens?: number }
): Promise<ChatCompletionRequestResult> {
  const tools = options?.enableWebTools === false ? [] : getOpenRouterServerTools();
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

async function requestJsonCompletion(messages: ChatMessage[], model: string, maxTokens?: number) {
  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.1,
    max_tokens: maxTokens || readPositiveIntEnv('OPENROUTER_JSON_MAX_TOKENS', 16000),
    response_format: { type: 'json_object' },
  }, {
    timeout: OPENROUTER_REQUEST_TIMEOUT_MS,
  });

  return completion.choices[0]?.message?.content || '';
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
  options?: { enableWebTools?: boolean; maxTokens?: number }
) {
  const result = await createChatCompletionWithMetadata(messages, model, options);
  return result.content;
}

export async function createChatCompletionWithMetadata(
  messages: ChatMessage[],
  model?: string,
  options?: { enableWebTools?: boolean; maxTokens?: number }
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
        hasToolCalls: Boolean(result.completion.choices[0]?.message && 'tool_calls' in result.completion.choices[0].message),
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

export async function createJsonChatCompletion(
  messages: ChatMessage[],
  model?: string,
  options?: { maxTokens?: number }
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
    });
    try {
      const raw = await requestJsonCompletion(messages, currentModel, options?.maxTokens);
      await appendOpenRouterTrace({
        type: 'json',
        status: raw.trim() ? 'success' : 'empty',
        model: currentModel,
        durationMs: Date.now() - startedAt,
        maxTokens: options?.maxTokens || readPositiveIntEnv('OPENROUTER_JSON_MAX_TOKENS', 16000),
        messages,
        output: raw,
      });
      console.log('[openrouter] json success', {
        model: currentModel,
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
  const evaluationPrompt = `你是投资流程评估引擎。请基于下面对话判断该项目是否达到了“值得投资人亲自介入”的标准。

评估原则：
1) 结合投资人分身的 system prompt 判断匹配度。
2) 判断信息是否充分：市场、团队、产品、商业模式、竞争、阶段与需求是否基本清晰。
3) 只输出 JSON，不要输出任何额外文本。

JSON格式：
{
  "status": "PENDING|NEEDS_INFO|QUALIFIED|REJECTED",
  "score": 0-100,
  "needsInvestorReview": true/false,
  "reason": "一句到三句中文，说明判断依据",
  "summary": "中文摘要，<=180字，供投资人后台快速浏览"
}

判定建议：
- QUALIFIED：信息充分且明显匹配，可转人工
- NEEDS_INFO：暂不充分，需继续追问
- REJECTED：明显不匹配或质量较差
- PENDING：非常早期、仍无法判断

投资人分身 system prompt：
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
      raw = await requestJsonCompletion(evaluationMessages, model);
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
      reason: '评估模型暂时不可用，请稍后重试。',
      summary: '评估暂不可用，本轮仅保留聊天记录。',
    };
  }

  return safeParseQualification(raw);
}

// 可用的模型列表
export const availableModels = [
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    description: "默认主模型，适合中文长上下文、agent规划与综合推理"
  },
  {
    id: "qwen/qwen3-max",
    name: "Qwen3 Max",
    description: "中文指令跟随和结构化输出稳定，适合对话、总结和JSON任务"
  },
  {
    id: "z-ai/glm-4.6",
    name: "GLM 4.6",
    description: "适合planner、工具调用和搜索型agent任务"
  },
  {
    id: "moonshotai/kimi-k2-thinking",
    name: "Kimi K2 Thinking",
    description: "适合长链路推理、复杂研究和多步骤agent任务"
  }
];
