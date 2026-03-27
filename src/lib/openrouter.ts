import OpenAI from 'openai';

// Initialize OpenRouter client
const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": "https://altselfs.com", // 替换为你的域名
    "X-Title": "AltSelfs - 投资人数字分身平台",
  }
});

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function createChatCompletion(
  messages: ChatMessage[],
  model: string = "anthropic/claude-3.5-sonnet" // 默认使用 Claude 3.5 Sonnet
) {
  try {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    });

    return completion.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('OpenRouter API error:', error);
    throw new Error('Failed to generate response');
  }
}

// 可用的模型列表
export const availableModels = [
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    description: "最新的 Claude 模型，推理能力强"
  },
  {
    id: "openai/gpt-4-turbo",
    name: "GPT-4 Turbo",
    description: "OpenAI 最新的 GPT-4 模型"
  },
  {
    id: "anthropic/claude-3-opus",
    name: "Claude 3 Opus",
    description: "Claude 3 系列最强大的模型"
  }
];