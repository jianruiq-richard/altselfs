import type { ServerConfig } from '../config.js';
import { truncate } from '../util.js';

export type HermesProvider = 'apiyi' | 'openrouter' | 'custom' | string;

export type HermesModelSelection = {
  model: string;
  provider: HermesProvider;
  baseUrl: string;
  apiKeyEnv: string;
  apiMode: 'chat_completions' | 'anthropic_messages';
};

export type HermesTextMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const APIYI_CLAUDE_SONNET_4_6 = 'claude-sonnet-4-6';
const OPENROUTER_DEEPSEEK_V3_2 = 'deepseek/deepseek-v3.2';

export function normalizeHermesModel(model?: unknown) {
  if (typeof model !== 'string') return undefined;
  const value = model.trim();
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (
    normalized === APIYI_CLAUDE_SONNET_4_6 ||
    normalized === 'claude-sonnet-4.6' ||
    normalized === 'claude-sonnet-4_6' ||
    normalized === 'sonnet-4-6' ||
    normalized === 'sonnet-4.6'
  ) {
    return APIYI_CLAUDE_SONNET_4_6;
  }
  if (
    normalized === OPENROUTER_DEEPSEEK_V3_2 ||
    normalized === 'deepseek-v3.2' ||
    normalized === 'deepseek3.2'
  ) {
    return OPENROUTER_DEEPSEEK_V3_2;
  }
  return value;
}

export function resolveHermesModelSelection(config: ServerConfig, requested?: unknown): HermesModelSelection {
  const model = normalizeHermesModel(requested) || normalizeHermesModel(config.hermesModel) || APIYI_CLAUDE_SONNET_4_6;
  if (model === APIYI_CLAUDE_SONNET_4_6) {
    return {
      model,
      provider: 'apiyi',
      baseUrl: config.hermesBaseUrl || 'https://api.apiyi.com/v1',
      apiKeyEnv: config.hermesApiKeyEnv || 'APIYI_API_KEY',
      apiMode: 'anthropic_messages',
    };
  }
  if (model === OPENROUTER_DEEPSEEK_V3_2) {
    return {
      model,
      provider: 'openrouter',
      baseUrl: config.openRouterBaseUrl,
      apiKeyEnv: config.openRouterApiKeyEnv,
      apiMode: 'chat_completions',
    };
  }
  return {
    model,
    provider: config.hermesProvider || 'custom',
    baseUrl: config.hermesBaseUrl || config.openRouterBaseUrl,
    apiKeyEnv: config.hermesApiKeyEnv || config.openRouterApiKeyEnv,
    apiMode: 'chat_completions',
  };
}

export function resolveHermesApiKey(selection: HermesModelSelection) {
  return process.env[selection.apiKeyEnv]?.trim() || '';
}

export function hermesChatCompletionsUrl(selection: HermesModelSelection) {
  return `${selection.baseUrl.replace(/\/$/, '')}/chat/completions`;
}

export function hermesChatHeaders(config: ServerConfig, selection: HermesModelSelection) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${resolveHermesApiKey(selection)}`,
    'content-type': 'application/json',
  };
  if (selection.provider === 'openrouter') {
    headers['x-openrouter-title'] = config.openRouterAppTitle;
  }
  return headers;
}

export async function callHermesText(
  config: ServerConfig,
  selection: HermesModelSelection,
  input: {
    messages: HermesTextMessage[];
    maxTokens: number;
    temperature?: number;
    signal?: AbortSignal;
  }
): Promise<{ content: string; rawCompletion: unknown }> {
  if (selection.apiMode === 'anthropic_messages') {
    return callHermesAnthropicMessages(config, selection, input);
  }
  return callHermesChatCompletions(config, selection, input);
}

async function callHermesChatCompletions(
  config: ServerConfig,
  selection: HermesModelSelection,
  input: {
    messages: HermesTextMessage[];
    maxTokens: number;
    temperature?: number;
    signal?: AbortSignal;
  }
) {
  const response = await fetch(hermesChatCompletionsUrl(selection), {
    method: 'POST',
    signal: input.signal,
    headers: hermesChatHeaders(config, selection),
    body: JSON.stringify({
      model: selection.model,
      messages: input.messages,
      temperature: input.temperature ?? 0,
      max_tokens: input.maxTokens,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Hermes chat completion failed ${response.status}: ${truncate(text, 2000)}`);
  const rawCompletion = JSON.parse(text) as unknown;
  return { content: extractChatCompletionContent(rawCompletion), rawCompletion };
}

async function callHermesAnthropicMessages(
  _config: ServerConfig,
  selection: HermesModelSelection,
  input: {
    messages: HermesTextMessage[];
    maxTokens: number;
    temperature?: number;
    signal?: AbortSignal;
  }
) {
  const system = input.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');
  const messages = input.messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: [{ type: 'text', text: message.content }],
    }));
  const body: Record<string, unknown> = {
    model: selection.model,
    max_tokens: input.maxTokens,
    temperature: input.temperature ?? 0,
    messages,
  };
  if (system) body.system = [{ type: 'text', text: system }];

  const response = await fetch(hermesAnthropicMessagesUrl(selection), {
    method: 'POST',
    signal: input.signal,
    headers: hermesAnthropicHeaders(selection),
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Hermes Anthropic messages failed ${response.status}: ${truncate(text, 2000)}`);
  const rawCompletion = JSON.parse(text) as unknown;
  return { content: extractAnthropicMessageContent(rawCompletion), rawCompletion };
}

function hermesAnthropicMessagesUrl(selection: HermesModelSelection) {
  return `${selection.baseUrl.replace(/\/$/, '')}/messages`;
}

function hermesAnthropicHeaders(selection: HermesModelSelection) {
  return {
    'x-api-key': resolveHermesApiKey(selection),
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
}

function extractChatCompletionContent(rawCompletion: unknown) {
  if (!isRecord(rawCompletion)) return '';
  const choices = rawCompletion.choices;
  if (!Array.isArray(choices)) return '';
  const first = choices[0];
  if (!isRecord(first)) return '';
  const message = first.message;
  if (!isRecord(message)) return '';
  return typeof message.content === 'string' ? message.content : '';
}

function extractAnthropicMessageContent(rawCompletion: unknown) {
  if (!isRecord(rawCompletion)) return '';
  const content = rawCompletion.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (isRecord(item) && item.type === 'text' && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
