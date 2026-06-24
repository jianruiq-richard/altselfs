export type AgentRoute = 'main' | 'codex' | 'unsupported';

export type TurnStartRequest = {
  userId: string;
  threadId?: string;
  message: string;
  allowedAgents?: string[];
  metadata?: Record<string, unknown>;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
};

export type AgentEvent = {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type TurnStartResponse = {
  threadId: string;
  route: AgentRoute;
  reply: string;
  events: AgentEvent[];
  runId?: string;
  raw?: unknown;
  memoryWrites?: MemoryWriteSuggestion[];
};

export type MemoryScope = 'user' | 'agent' | 'project' | 'thread';

export type MemoryEntry = {
  id: string;
  userId: string;
  scope: MemoryScope;
  content: string;
  status: 'active' | 'pending' | 'rejected' | 'archived';
  sourceThreadId?: string;
  sourceMessageId?: string;
  confidence?: number;
  createdAt: string;
  updatedAt: string;
};

export type MemorySnapshot = {
  userProfile: string;
  agentMemory: string;
  entries: MemoryEntry[];
};

export type MemoryWriteSuggestion = {
  action: 'add' | 'replace' | 'remove';
  scope: MemoryScope;
  content: string;
  oldContent?: string;
  reason: string;
  confidence: number;
};

export type ChildAgentRunInput = {
  userId: string;
  threadId: string;
  message: string;
  profileId?: string;
  memorySnapshot: MemorySnapshot;
  metadata?: Record<string, unknown>;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
};

export type ChildAgentRunResult = {
  route: AgentRoute;
  reply: string;
  events: AgentEvent[];
  raw?: unknown;
};

export type ChildAgentRuntime = {
  id: string;
  description: string;
  canHandle: (input: ChildAgentRunInput) => boolean;
  run: (input: ChildAgentRunInput) => Promise<ChildAgentRunResult>;
};

export type SourceAgentRunResult = {
  route: AgentRoute;
  reply: string;
  events: AgentEvent[];
  raw?: unknown;
};

export type SourceAgentRuntime = {
  run: (request: TurnStartRequest) => Promise<SourceAgentRunResult>;
};

export type AgentProfileRiskLevel = 'low' | 'medium' | 'high';

export type AgentProfile = {
  id: string;
  runtimeId: string;
  name: string;
  description: string;
  visibleToRouter?: boolean;
  capabilities: string[];
  whenToUse: string[];
  whenNotToUse: string[];
  tools: string[];
  riskLevel: AgentProfileRiskLevel;
  requiresWorkspace: boolean;
  requiresApprovalFor: string[];
};

export type RouterDecision = {
  route: 'main' | 'agent';
  agentProfileId?: string;
  runtimeId?: string;
  reason: string;
  confidence: number;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  raw?: unknown;
};
