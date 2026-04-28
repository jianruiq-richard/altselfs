export type AgentRunInput = {
  investorId: string;
  userQuery: string;
  mode?: 'chat' | 'briefing' | 'digest' | 'tool';
  context?: Record<string, unknown>;
};

export type AgentBriefingItem = {
  category: string;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt?: string;
};

export type AgentRunToolCall = {
  toolName: string;
  status: 'SUCCESS' | 'ERROR';
  args?: unknown;
  result?: unknown;
};

export type AgentRunResult = {
  agentType: string;
  answer: string;
  briefingItems: AgentBriefingItem[];
  toolCalls: AgentRunToolCall[];
  debug?: Record<string, unknown>;
};
