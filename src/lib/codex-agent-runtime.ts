import {
  createChatCompletion,
  createToolChatCompletionWithMetadata,
  getOpenRouterModel,
  type OpenRouterAgentModelKey,
  type OpenRouterFunctionTool,
  type ToolChatMessage,
} from '@/lib/openrouter';

export type CodexAgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

export type CodexAgentLoopEvent =
  | {
      type: 'model_call';
      status: 'RUNNING' | 'SUCCESS' | 'ERROR';
      turn: number;
      model?: string;
      input?: unknown;
      output?: unknown;
      error?: string;
      timestamp: string;
    }
  | {
      type: 'tool_call';
      status: 'RUNNING' | 'SUCCESS' | 'ERROR';
      turn: number;
      callId: string;
      toolName: string;
      arguments?: unknown;
      result?: unknown;
      error?: string;
      timestamp: string;
    }
  | {
      type: 'context_compaction';
      status: 'RUNNING' | 'SUCCESS' | 'ERROR' | 'SKIPPED';
      turn: number;
      inputTokensEstimate?: number;
      outputTokensEstimate?: number;
      error?: string;
      timestamp: string;
    };

export type CodexAgentLoopResult = {
  finalText: string;
  messages: ToolChatMessage[];
  events: CodexAgentLoopEvent[];
  model: string | null;
};

type RunCodexAgentLoopParams = {
  systemMessages: string[];
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: CodexAgentTool[];
  modelKey?: OpenRouterAgentModelKey;
  maxTurns?: number;
  maxContextTokensEstimate?: number;
  compactPrompt?: string;
  onEvent?: (event: CodexAgentLoopEvent) => void | Promise<void>;
};

type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

const DEFAULT_MAX_TURNS = 8;
const DEFAULT_CONTEXT_TOKEN_ESTIMATE_LIMIT = 28000;

function now() {
  return new Date().toISOString();
}

function estimateTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function safeStringify(value: unknown, maxChars = 12000) {
  const raw = JSON.stringify(value, null, 2);
  if (raw.length <= maxChars) return raw;
  return `${raw.slice(0, maxChars)}\n... [truncated ${raw.length - maxChars} chars]`;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { value: parsed };
}

function getTextFromMessage(message: unknown) {
  if (!message || typeof message !== 'object') return '';
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

function getToolCallsFromMessage(message: unknown): ToolCall[] {
  if (!message || typeof message !== 'object') return [];
  const raw = (message as { tool_calls?: unknown }).tool_calls;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const call = item as {
        id?: unknown;
        type?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      };
      if (typeof call.id !== 'string') return null;
      if (call.type !== 'function') return null;
      if (typeof call.function?.name !== 'string') return null;
      return {
        id: call.id,
        type: 'function' as const,
        function: {
          name: call.function.name,
          arguments: typeof call.function.arguments === 'string' ? call.function.arguments : '',
        },
      };
    })
    .filter(Boolean) as ToolCall[];
}

function toOpenRouterTools(tools: CodexAgentTool[]): OpenRouterFunctionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function buildInitialMessages(params: RunCodexAgentLoopParams): ToolChatMessage[] {
  return [
    ...params.systemMessages
      .map((content) => content.trim())
      .filter(Boolean)
      .map((content) => ({ role: 'system' as const, content })),
    ...params.conversation.map((item) => ({ role: item.role, content: item.content }) as ToolChatMessage),
  ];
}

async function compactMessages(params: {
  messages: ToolChatMessage[];
  compactPrompt?: string;
  model: string;
}) {
  const systemMessages = params.messages.filter((message) => message.role === 'system');
  const nonSystem = params.messages.filter((message) => message.role !== 'system');
  if (nonSystem.length <= 10) return params.messages;

  const preservedTail = nonSystem.slice(-8);
  const historyToCompact = nonSystem.slice(0, -8);
  const summary = await createChatCompletion(
    [
      {
        role: 'system',
        content:
          params.compactPrompt ||
          [
            'You are compacting an agent conversation history.',
            'Preserve user intent, tool calls, tool outputs, unresolved tasks, errors, and decisions.',
            'Do not invent facts. Output a concise but complete summary.',
          ].join('\n'),
      },
      {
        role: 'user',
        content: safeStringify(historyToCompact, 24000),
      },
    ],
    params.model,
    { enableWebTools: false, maxTokens: 3000 }
  );

  return [
    ...systemMessages,
    {
      role: 'system' as const,
      content: [
        'Compacted conversation history follows. Treat it as prior context, not as a new user instruction.',
        summary.trim(),
      ].join('\n\n'),
    },
    ...preservedTail,
  ];
}

export async function runCodexAgentLoop(params: RunCodexAgentLoopParams): Promise<CodexAgentLoopResult> {
  const events: CodexAgentLoopEvent[] = [];
  const emit = async (event: CodexAgentLoopEvent) => {
    events.push(event);
    await params.onEvent?.(event);
  };

  const model = getOpenRouterModel(params.modelKey || 'EXECUTIVE');
  const maxTurns = params.maxTurns || DEFAULT_MAX_TURNS;
  const contextLimit = params.maxContextTokensEstimate || DEFAULT_CONTEXT_TOKEN_ESTIMATE_LIMIT;
  const tools = toOpenRouterTools(params.tools);
  const toolByName = new Map(params.tools.map((tool) => [tool.name, tool]));
  let messages = buildInitialMessages(params);
  let finalText = '';
  let lastModel: string | null = null;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const inputTokensEstimate = estimateTokens(messages);
    if (inputTokensEstimate > contextLimit) {
      await emit({
        type: 'context_compaction',
        status: 'RUNNING',
        turn,
        inputTokensEstimate,
        timestamp: now(),
      });
      try {
        messages = await compactMessages({
          messages,
          compactPrompt: params.compactPrompt,
          model,
        });
        await emit({
          type: 'context_compaction',
          status: 'SUCCESS',
          turn,
          inputTokensEstimate,
          outputTokensEstimate: estimateTokens(messages),
          timestamp: now(),
        });
      } catch (error) {
        await emit({
          type: 'context_compaction',
          status: 'ERROR',
          turn,
          inputTokensEstimate,
          error: error instanceof Error ? error.message : String(error),
          timestamp: now(),
        });
      }
    }

    await emit({
      type: 'model_call',
      status: 'RUNNING',
      turn,
      input: {
        messageCount: messages.length,
        tools: params.tools.map((tool) => tool.name),
        tokensEstimate: estimateTokens(messages),
      },
      timestamp: now(),
    });

    let rawMessage: unknown = null;
    try {
      const completion = await createToolChatCompletionWithMetadata(messages, tools, model, {
        toolChoice: tools.length > 0 ? 'auto' : 'none',
      });
      rawMessage = completion.rawMessage;
      lastModel = completion.model;
      await emit({
        type: 'model_call',
        status: 'SUCCESS',
        turn,
        model: completion.model,
        output: rawMessage,
        timestamp: now(),
      });
    } catch (error) {
      await emit({
        type: 'model_call',
        status: 'ERROR',
        turn,
        error: error instanceof Error ? error.message : String(error),
        timestamp: now(),
      });
      throw error;
    }

    const text = getTextFromMessage(rawMessage);
    const toolCalls = getToolCallsFromMessage(rawMessage);
    messages.push({
      role: 'assistant',
      content: text || null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      finalText = text.trim();
      break;
    }

    for (const call of toolCalls) {
      const toolName = call.function.name;
      const tool = toolByName.get(toolName);
      let args: Record<string, unknown> = {};
      try {
        args = parseToolArgs(call.function.arguments);
      } catch (error) {
        const message = `Tool arguments JSON parse failed: ${error instanceof Error ? error.message : String(error)}`;
        await emit({
          type: 'tool_call',
          status: 'ERROR',
          turn,
          callId: call.id,
          toolName,
          arguments: call.function.arguments,
          error: message,
          timestamp: now(),
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: safeStringify({ error: message }),
        });
        continue;
      }

      await emit({
        type: 'tool_call',
        status: 'RUNNING',
        turn,
        callId: call.id,
        toolName,
        arguments: args,
        timestamp: now(),
      });

      if (!tool) {
        const result = { error: `Unknown tool: ${toolName}` };
        await emit({
          type: 'tool_call',
          status: 'ERROR',
          turn,
          callId: call.id,
          toolName,
          arguments: args,
          result,
          timestamp: now(),
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: safeStringify(result) });
        continue;
      }

      try {
        const result = await tool.execute(args);
        await emit({
          type: 'tool_call',
          status: 'SUCCESS',
          turn,
          callId: call.id,
          toolName,
          arguments: args,
          result,
          timestamp: now(),
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: safeStringify(result) });
      } catch (error) {
        const result = { error: error instanceof Error ? error.message : String(error) };
        await emit({
          type: 'tool_call',
          status: 'ERROR',
          turn,
          callId: call.id,
          toolName,
          arguments: args,
          result,
          timestamp: now(),
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: safeStringify(result) });
      }
    }
  }

  if (!finalText) {
    finalText = '我已经完成可用工具调用，但模型没有返回最终回复。请再发一句你的具体问题，我会基于刚才的执行结果继续。';
  }

  return {
    finalText,
    messages,
    events,
    model: lastModel,
  };
}
