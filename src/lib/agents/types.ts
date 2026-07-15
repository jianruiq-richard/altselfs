export type AgentRunInput = {
  investorId: string;
  userQuery: string;
  mode?: 'chat' | 'briefing' | 'digest' | 'tool';
  context?: AgentRunContext;
};

export type RollingTimeWindow = {
  type: 'rolling_hours';
  hours: number;
  endAt: string;
};

export type AgentTaskSpec = {
  objective: string;
  sourceSelectionCriteria: string[];
  timeWindow?: RollingTimeWindow;
  returnFormat?: {
    sections: string[];
    instructions: string;
  };
};

export type AgentRunContext = Record<string, unknown> & {
  taskSpec?: AgentTaskSpec;
};

export type AgentBriefingItem = {
  category: string;
  title: string;
  summary: string;
  source: string;
  url?: string;
  publishedAt?: string;
};

export type AgentRuntoolCall = {
  toolName: string;
  status: 'SUCCESS' | 'ERROR';
  args?: unknown;
  result?: unknown;
};

export type AgentRunResult = {
  agentType: string;
  answer: string;
  briefingItems: AgentBriefingItem[];
  toolCalls: AgentRuntoolCall[];
  debug?: Record<string, unknown>;
};
