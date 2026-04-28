import OpenAI from 'openai';

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
    };
  }>;
};

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

async function requestCompletion(messages: ChatMessage[], model: string) {
  const tools = getOpenRouterServerTools();
  const completion = (await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
    max_tokens: 2000,
    stream: false,
    ...(tools.length > 0 ? { tools } : {}),
  } as Parameters<typeof openai.chat.completions.create>[0])) as ChatCompletionResult;

  return completion.choices[0]?.message?.content || '';
}

async function requestJsonCompletion(messages: ChatMessage[], model: string) {
  const completion = await openai.chat.completions.create({
    model,
    messages,
    temperature: 0.1,
    max_tokens: 800,
    response_format: { type: 'json_object' },
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

export async function createChatCompletion(
  messages: ChatMessage[],
  model?: string
) {
  const candidates = [
    model,
    process.env.OPENROUTER_MODEL_PRIMARY || 'openai/gpt-5.2',
    process.env.OPENROUTER_MODEL_FALLBACK || 'anthropic/claude-sonnet-4.5',
    process.env.OPENROUTER_MODEL_BACKUP || 'anthropic/claude-3.5-sonnet',
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_1 || 'deepseek/deepseek-chat-v3-0324',
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_2 || 'qwen/qwen-2.5-72b-instruct',
    'openai/gpt-4o-mini',
  ].filter(Boolean) as string[];

  let lastError: unknown;
  const tried: string[] = [];

  for (const currentModel of candidates) {
    tried.push(currentModel);
    try {
      return await requestCompletion(messages, currentModel);
    } catch (error) {
      lastError = error;
      console.error(`OpenRouter API error (${currentModel}):`, error);
    }
  }

  const detail = getErrorMessage(lastError);
  throw new Error(`OpenRouter failed after trying models [${tried.join(', ')}]: ${detail}`);
}

export async function createJsonChatCompletion(
  messages: ChatMessage[],
  model?: string
) {
  const candidates = [
    model,
    process.env.OPENROUTER_MODEL_PRIMARY || 'openai/gpt-5.2',
    process.env.OPENROUTER_MODEL_FALLBACK || 'anthropic/claude-sonnet-4.5',
    process.env.OPENROUTER_MODEL_BACKUP || 'anthropic/claude-3.5-sonnet',
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_1 || 'deepseek/deepseek-chat-v3-0324',
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_2 || 'qwen/qwen-2.5-72b-instruct',
    'openai/gpt-4o-mini',
  ].filter(Boolean) as string[];

  let lastError: unknown;
  const tried: string[] = [];

  for (const currentModel of candidates) {
    tried.push(currentModel);
    try {
      const raw = await requestJsonCompletion(messages, currentModel);
      if (raw.trim()) {
        return raw;
      }
    } catch (error) {
      lastError = error;
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

  const candidates = [
    process.env.OPENROUTER_MODEL_EVALUATOR,
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_1,
    process.env.OPENROUTER_MODEL_REGION_FALLBACK_2,
    process.env.OPENROUTER_MODEL_PRIMARY,
    process.env.OPENROUTER_MODEL_FALLBACK,
    'deepseek/deepseek-chat-v3-0324',
  ].filter(Boolean) as string[];

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
    id: "openai/gpt-5.2",
    name: "GPT-5.2",
    description: "默认优先模型，适合综合推理与对话"
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    description: "作为回退模型，兼顾质量与稳定性"
  },
  {
    id: "openai/gpt-5.2-mini",
    name: "GPT-5.2 Mini",
    description: "成本敏感场景可选"
  }
];
