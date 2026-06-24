'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Paperclip, X } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
import { FigmaShell } from '@/components/figma-shell';
import {
  EXECUTIVE_UPDATE_BRIEFING_PROMPT,
  ExecutiveDailyBriefingBrowser,
} from '@/components/executive-daily-briefing-browser';
import { MarkdownMessage } from '@/components/markdown-message';

type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
};

type PendingAttachmentKind = 'image' | 'video' | 'pdf' | 'document' | 'file';

type PendingAttachment = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  kind: PendingAttachmentKind;
};

type Briefing = {
  date: string;
  generatedTime: string;
  headline: string;
  departmentOverview: Array<{
    department: string;
    status: string;
    summary: string;
    progress: number;
  }>;
  priorityTasks: Array<{
    priority: 'high' | 'medium' | 'low';
    task: string;
    deadline: string;
    assignedBy: string;
  }>;
  externalInsights?: Array<{
    category: string;
    content: string;
    source: string;
  }>;
};

type PersistedBriefing = {
  dateKey: string;
  title: string;
  summary: string;
  sections: unknown;
  updatedAt?: string;
};

type AgentConfig = {
  systemPrompt: string;
  defaultSystemPrompt: string;
  hasCustomPrompt: boolean;
};

type PlannerStepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR' | 'SKIPPED';

type PlannerStep = {
  id: string;
  title: string;
  description: string;
  agentType?: string;
};

type PlannerTraceItem = PlannerStep & {
  status: PlannerStepStatus;
  detail?: string;
  error?: string;
  timestamp: string;
  payload?: unknown;
};

type ExecutiveRunPollResult = {
  runId?: string;
  status?: string;
  result?: unknown;
  error?: string | null;
  planner?: unknown;
  plannerTrace?: unknown;
  pollIntervalMs?: number;
};

type PersonalAgentFinalData = {
  threadId?: string;
  messages?: ChatMessage[];
  reply?: string;
  error?: string;
};

type CodexStreamItemStatus = 'running' | 'completed' | 'error';

type CodexStreamItem = {
  id: string;
  title: string;
  detail: string;
  status: CodexStreamItemStatus;
  timestamp: string;
  method?: string;
  content?: string;
};

const EXECUTIVE_ACTIVE_RUN_STORAGE_KEY = 'altselfs:executive-active-run-id';

const suggestedQuestions = [
  '请帮我搜集一下今日关于 OPC 相关的行业或者技术信息。',
  '帮我分析一下这个产品想法是否值得做。',
  '今天 AI agent 领域有什么值得关注的变化？',
  '帮我把一个复杂问题拆成行动计划。',
  '记住：我喜欢看结论、依据和下一步建议。',
];

const plannerStatusLabel: Record<PlannerStepStatus, string> = {
  PENDING: '待执行',
  RUNNING: '执行中',
  SUCCESS: '完成',
  ERROR: '错误',
  SKIPPED: '跳过',
};

const plannerStatusClass: Record<PlannerStepStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  RUNNING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  ERROR: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-amber-100 text-amber-700',
};

const codexItemDotClass: Record<CodexStreamItemStatus, string> = {
  running: 'bg-blue-500',
  completed: 'bg-emerald-500',
  error: 'bg-red-500',
};

const attachmentAccept =
  'image/*,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_ATTACHMENT_FILES = 6;
const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;

function getPendingAttachmentKind(file: File): PendingAttachmentKind {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.doc') ||
    name.endsWith('.docx')
  ) {
    return 'document';
  }
  return 'file';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function createPendingAttachment(file: File): PendingAttachment {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    name: file.name,
    type: file.type,
    size: file.size,
    kind: getPendingAttachmentKind(file),
  };
}

function formatAttachmentList(attachments: PendingAttachment[]) {
  if (attachments.length === 0) return '';
  return attachments.map((attachment) => `- ${attachment.name}（${formatBytes(attachment.size)}）`).join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlannerSteps(value: unknown): PlannerStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return null;
      return {
        id: item.id,
        title: item.title,
        description: typeof item.description === 'string' ? item.description : '',
        agentType: typeof item.agentType === 'string' ? item.agentType : undefined,
      };
    })
    .filter(Boolean) as PlannerStep[];
}

function normalizePlannerTrace(value: unknown): PlannerTraceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return null;
      const status = typeof item.status === 'string' ? item.status : 'PENDING';
      if (!['PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED'].includes(status)) return null;
      return {
        id: item.id,
        title: item.title,
        description: typeof item.description === 'string' ? item.description : '',
        agentType: typeof item.agentType === 'string' ? item.agentType : undefined,
        status: status as PlannerStepStatus,
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        error: typeof item.error === 'string' ? item.error : undefined,
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
        payload: item.payload,
      };
    })
    .filter(Boolean) as PlannerTraceItem[];
}

function getLatestPlannerStatuses(trace: PlannerTraceItem[]) {
  const map = new Map<string, PlannerTraceItem>();
  for (const item of trace) {
    map.set(item.id, item);
  }
  return map;
}

function formatPlannerPayload(payload: unknown) {
  if (payload === undefined || payload === null) return '';
  try {
    return JSON.stringify(payload, null, 2).slice(0, 1200);
  } catch {
    return String(payload).slice(0, 1200);
  }
}

function parseNdjsonLine(line: string) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getEventPayload(event: unknown) {
  if (!isRecord(event)) return {};
  return isRecord(event.payload) ? event.payload : {};
}

function parseJsonRecord(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getCodexNotification(envelope: Record<string, unknown>) {
  if (String(envelope.type || '') !== 'event' || !isRecord(envelope.event)) return null;
  const event = envelope.event;
  if (!String(event.type || '').startsWith('codex.')) return null;
  const payload = getEventPayload(event);
  return parseJsonRecord(payload.notification) || parseJsonRecord(payload.notificationText);
}

function extractCodexText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  for (const key of ['text', 'content', 'message', 'finalText']) {
    const item = value[key];
    if (typeof item === 'string') return item;
  }
  const content = value.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .filter(Boolean)
    .join('');
}

function describeCodexItem(item: Record<string, unknown>) {
  const type = String(item.type || 'item');
  const command = typeof item.command === 'string' ? item.command : '';
  const tool = typeof item.tool === 'string' ? item.tool : '';
  const namespace = typeof item.namespace === 'string' ? item.namespace : '';
  const path = typeof item.path === 'string' ? item.path : typeof item.file === 'string' ? item.file : '';
  const text = extractCodexText(item).trim();

  if (type.toLowerCase().includes('command')) {
    return { title: '运行命令', detail: command || '命令执行中', content: text };
  }
  if (type.toLowerCase().includes('tool') || tool) {
    return { title: '调用工具', detail: [namespace, tool].filter(Boolean).join('.') || '工具调用中', content: text };
  }
  if (type.toLowerCase().includes('file') || type.toLowerCase().includes('patch')) {
    return { title: '更新文件', detail: path || type, content: text };
  }
  if (type.toLowerCase().includes('agentmessage') || type === 'message') {
    return { title: '生成回复', detail: '正在输出 assistant message', content: text };
  }
  return { title: '处理项目', detail: type, content: text };
}

function projectCodexStreamItem(envelope: Record<string, unknown>, index: number): CodexStreamItem | null {
  const envelopeType = String(envelope.type || '');
  const now = new Date().toISOString();
  if (envelopeType === 'turn_started') {
    return null;
  }

  if (envelopeType === 'error') {
    return {
      id: `stream-error-${index}`,
      title: '执行失败',
      detail: typeof envelope.error === 'string' ? envelope.error : '执行过程中发生错误',
      status: 'error',
      timestamp: now,
    };
  }

  if (envelopeType !== 'event' || !isRecord(envelope.event)) return null;

  const event = envelope.event;
  const type = String(event.type || 'agent.event');
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : now;
  const payload = getEventPayload(event);

  if (type === 'codex.server_request.item/tool/call') {
    const request = isRecord(payload.request) ? payload.request : {};
    const params = isRecord(request.params) ? request.params : {};
    const namespace = typeof params.namespace === 'string' ? params.namespace : '';
    const tool = typeof params.tool === 'string' ? params.tool : '';
    return {
      id: `codex-server-request-${timestamp}-${index}`,
      title: '调用工具',
      detail: [namespace, tool].filter(Boolean).join('.') || 'item/tool/call',
      status: 'running',
      timestamp,
      method: 'item/tool/call',
    };
  }

  if (type === 'codex.error' || type === 'codex.web_search.not_used') {
    const detail = typeof payload.error === 'string'
      ? payload.error
      : typeof payload.warning === 'string'
        ? payload.warning
        : 'Codex runtime 返回错误';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'codex.web_search.not_used' ? '搜索未执行' : 'Codex 执行失败',
      detail,
      status: 'error',
      timestamp,
      method: type,
    };
  }

  if (type === 'codex.session.starting' || type === 'codex.thread.started' || type === 'codex.turn.started') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'codex.session.starting' ? '启动 Codex' : type === 'codex.thread.started' ? '创建线程' : '开始回合',
      detail: type.replace('codex.', ''),
      status: type === 'codex.thread.started' ? 'completed' : 'running',
      timestamp,
      method: type,
    };
  }

  const notification = getCodexNotification(envelope);
  if (notification) {
    const method = String(notification.method || '');
    if (
      [
        'thread/status/changed',
        'thread/tokenUsage/updated',
        'account/rateLimits/updated',
        'turn/started',
      ].includes(method)
    ) {
      return null;
    }
    if (method === 'warning') {
      const params = isRecord(notification.params) ? notification.params : {};
      return {
        id: `warning-${timestamp}-${index}`,
        title: 'Codex 警告',
        detail: typeof params.message === 'string' ? params.message : 'warning',
        status: 'error',
        timestamp,
        method,
      };
    }
    if (method === 'item/agentMessage/delta') return null;
    if (method === 'turn/completed') {
      return {
        id: 'turn-completed',
        title: '完成回合',
        detail: 'turn/completed',
        status: 'completed',
        timestamp,
        method,
      };
    }
    const params = isRecord(notification.params) ? notification.params : {};
    const item = isRecord(params.item) ? params.item : {};
    const itemType = String(item.type || '');
    const role = String(item.role || '');
    if (
      itemType === 'userMessage' ||
      itemType === 'agentMessage' ||
      itemType === 'assistantMessage' ||
      (itemType === 'message' && (role === 'assistant' || role === 'user'))
    ) {
      return null;
    }
    const summary = describeCodexItem(item);
    const itemId = typeof item.id === 'string' ? item.id : `${method}-${timestamp}-${index}`;
    if (method === 'item/started' || method === 'item/completed') {
      return {
        id: itemId,
        title: summary.title,
        detail: summary.detail,
        status: method === 'item/completed' ? 'completed' : 'running',
        timestamp,
        method,
        content: method === 'item/completed' ? summary.content : undefined,
      };
    }
    return {
      id: `${method}-${timestamp}-${index}`,
      title: 'Codex 事件',
      detail: method || type,
      status: method.includes('completed') ? 'completed' : 'running',
      timestamp,
      method,
    };
  }

  if (!type.startsWith('codex.')) return null;

  return {
    id: `${type}-${timestamp}-${index}`,
    title: 'Agent 事件',
    detail: type,
    status: type.includes('completed') ? 'completed' : 'running',
    timestamp,
    method: type,
  };
}

function extractAssistantDelta(envelope: Record<string, unknown>) {
  if (String(envelope.type || '') !== 'event' || !isRecord(envelope.event)) return '';
  const payload = getEventPayload(envelope.event);
  const projected = isRecord(payload.projected) ? payload.projected : {};
  const delta = projected.assistantDelta;
  if (typeof delta === 'string') return delta;
  const notification = getCodexNotification(envelope);
  if (!notification || notification.method !== 'item/agentMessage/delta') return '';
  const params = isRecord(notification.params) ? notification.params : {};
  return typeof params.delta === 'string' ? params.delta : '';
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getRunPollErrorMessage(data: ExecutiveRunPollResult, status: number) {
  const detail = typeof data.error === 'string' && data.error.trim() ? data.error.trim() : '查询任务状态失败';
  return `查询任务状态失败（HTTP ${status}）：${detail}`;
}

function getStoredActiveRunId() {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(EXECUTIVE_ACTIVE_RUN_STORAGE_KEY) || '';
}

function storeActiveRunId(runId: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(EXECUTIVE_ACTIVE_RUN_STORAGE_KEY, runId);
}

function clearStoredActiveRunId(runId?: string) {
  if (typeof window === 'undefined') return;
  const current = getStoredActiveRunId();
  if (!runId || current === runId) {
    window.sessionStorage.removeItem(EXECUTIVE_ACTIVE_RUN_STORAGE_KEY);
  }
}

async function waitForExecutiveRun(
  runId: string,
  onUpdate: (run: ExecutiveRunPollResult) => void
) {
  let transientUnauthorizedCount = 0;
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const res = await fetch(`/api/investor/executive-assistant?runId=${encodeURIComponent(runId)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const data = (await res.json().catch(() => ({}))) as ExecutiveRunPollResult;
    if (!res.ok) {
      if (res.status === 401 && transientUnauthorizedCount < 3) {
        transientUnauthorizedCount += 1;
        await sleep(1500);
        continue;
      }
      throw Object.assign(new Error(getRunPollErrorMessage(data, res.status)), {
        status: res.status,
      });
    }
    transientUnauthorizedCount = 0;
    onUpdate(data);
    if (data.status === 'SUCCESS' || data.status === 'ERROR') return data;
    await sleep(typeof data.pollIntervalMs === 'number' ? data.pollIntervalMs : 3000);
  }
  throw new Error('晨报执行仍未完成，请稍后刷新查看结果');
}

function CodexStreamOutput({ items, active }: { items: CodexStreamItem[]; active: boolean }) {
  if (items.length === 0 && !active) return null;
  const visibleItems = items.length > 0
    ? items.slice(-8)
    : [
        {
          id: 'agent-stream-preparing',
          title: '准备执行',
          detail: '正在创建本轮任务并加载上下文',
          status: 'running' as const,
          timestamp: new Date().toISOString(),
        },
      ];

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-2xl py-1 pl-1 text-sm text-slate-500">
        <div className="space-y-1.5 border-l border-slate-200 pl-4">
          {visibleItems.map((item) => (
            <div key={item.id} className="relative min-w-0 leading-6">
              <span
                className={`absolute -left-[1.18rem] top-2 h-2 w-2 rounded-full ${codexItemDotClass[item.status]} ${
                  active && item.status === 'running' ? 'animate-pulse' : ''
                }`}
              />
              <span className="font-medium text-slate-700">{item.title}</span>
              {item.detail ? <span className="break-words text-slate-500">：{item.detail}</span> : null}
              {item.content ? (
                <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100">
                  {item.content}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StreamingAssistantMessage({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-3 text-slate-900 sm:max-w-2xl">
        <MarkdownMessage content={content} />
      </div>
    </div>
  );
}

export default function InvestorAgentChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;
  const isExecutive = agentId === '100';

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [persistedBriefing, setPersistedBriefing] = useState<PersistedBriefing | null>(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaved, setPromptSaved] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [hasCustomPrompt, setHasCustomPrompt] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [plannerSteps, setPlannerSteps] = useState<PlannerStep[]>([]);
  const [plannerTrace, setPlannerTrace] = useState<PlannerTraceItem[]>([]);
  const [plannerPanelOpen, setPlannerPanelOpen] = useState(false);
  const [codexStreamItems, setCodexStreamItems] = useState<CodexStreamItem[]>([]);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stoppingRun, setStoppingRun] = useState(false);
  const promptEditorRef = useRef<HTMLDivElement | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingOlderMessagesRef = useRef(false);
  const suppressNextAutoScrollRef = useRef(false);
  const codexEventIndexRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const title = useMemo(() => (isExecutive ? '个人 Hermes Agent' : 'AI 助手'), [isExecutive]);
  const showExecutiveControls = false;
  const latestPlannerStatuses = useMemo(() => getLatestPlannerStatuses(plannerTrace), [plannerTrace]);
  const hasPlannerErrors = plannerTrace.some((item) => item.status === 'ERROR');
  const plannerButtonText = sending
    ? '正在执行，查看过程'
    : plannerTrace.length > 0
      ? hasPlannerErrors
        ? '查看上次过程和错误'
        : '查看上次执行过程'
      : '等待本轮 planner';
  const applyAgentConfig = useCallback((agentConfig: AgentConfig | null | undefined) => {
    if (!agentConfig) return;
    const systemPrompt = String(agentConfig.systemPrompt || '');
    setPromptDraft(systemPrompt);
    setPromptSaved(systemPrompt);
    setDefaultPrompt(String(agentConfig.defaultSystemPrompt || ''));
    setHasCustomPrompt(Boolean(agentConfig.hasCustomPrompt));
  }, []);

  const applyTerminalRun = useCallback(
    (
      run: ExecutiveRunPollResult,
      fallbackMessages: ChatMessage[],
      options: { closePlannerOnSuccess: boolean }
    ) => {
      const data = isRecord(run.result) ? run.result : {};
      if (run.status === 'ERROR') {
        setError(run.error || (typeof data.error === 'string' ? data.error : '发送失败'));
        setMessages(fallbackMessages);
        setPlannerTrace(normalizePlannerTrace(run.plannerTrace || data.plannerTrace));
        setPlannerSteps(normalizePlannerSteps(run.planner || data.planner));
        return;
      }

      setThreadId(typeof data.threadId === 'string' ? data.threadId : null);
      if (Array.isArray(data.messages)) {
        setMessages(data.messages as ChatMessage[]);
      } else if (typeof data.reply === 'string') {
        setMessages([...fallbackMessages, { role: 'assistant', content: data.reply }]);
      }
      if (data.briefing) {
        setBriefing(data.briefing as Briefing);
      }
      setPersistedBriefing(isRecord(data.persistedBriefing) ? (data.persistedBriefing as PersistedBriefing) : null);
      setPlannerSteps(normalizePlannerSteps(data.planner || run.planner));
      setPlannerTrace(normalizePlannerTrace(data.plannerTrace || run.plannerTrace));
      applyAgentConfig(data.agentConfig as AgentConfig | null | undefined);
      if (options.closePlannerOnSuccess) setPlannerPanelOpen(false);
    },
    [applyAgentConfig]
  );

  const resumeExecutiveRun = useCallback(
    async (
      runId: string,
      fallbackMessages: ChatMessage[],
      options: { closePlannerOnSuccess: boolean }
    ) => {
      if (!runId || activeRunIdRef.current === runId) return;
      activeRunIdRef.current = runId;
      setActiveRunId(runId);
      storeActiveRunId(runId);
      setSending(true);
      setError(null);
      setPlannerPanelOpen(true);

      try {
        const run = await waitForExecutiveRun(runId, (nextRun) => {
          setPlannerSteps(normalizePlannerSteps(nextRun.planner));
          setPlannerTrace(normalizePlannerTrace(nextRun.plannerTrace));
        });
        applyTerminalRun(run, fallbackMessages, options);
        clearStoredActiveRunId(runId);
      } catch (err) {
        if (isRecord(err) && err.status === 404) clearStoredActiveRunId(runId);
        setError(err instanceof Error ? `网络错误：${err.message}` : '网络错误，请稍后重试');
      } finally {
        activeRunIdRef.current = null;
        setActiveRunId(null);
        setSending(false);
        setStoppingRun(false);
      }
    },
    [applyTerminalRun]
  );

  const stopExecutiveRun = useCallback(async () => {
    const runId = activeRunIdRef.current || activeRunId;
    if (!runId || stoppingRun) return;
    setStoppingRun(true);
    setError(null);
    try {
      const res = await fetch('/api/investor/executive-assistant', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const data = (await res.json().catch(() => ({}))) as ExecutiveRunPollResult;
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : '停止任务失败');
        return;
      }
      activeRunIdRef.current = null;
      setActiveRunId(null);
      setSending(false);
      clearStoredActiveRunId(runId);
      setPlannerTrace(normalizePlannerTrace(data.plannerTrace || (isRecord(data.result) ? data.result.plannerTrace : null)));
      setError('已停止本次执行。');
    } catch (err) {
      setError(err instanceof Error ? `停止任务失败：${err.message}` : '停止任务失败，请稍后重试');
    } finally {
      setStoppingRun(false);
    }
  }, [activeRunId, stoppingRun]);

  const loadData = useCallback(async () => {
    if (!isExecutive) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/investor/personal-agent', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载失败');
        return;
      }
      setThreadId(data.threadId || null);
      const loadedMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
      setMessages(loadedMessages);
      setHasMoreMessages(Boolean(data.hasMore));
      setBriefing(null);
      setPersistedBriefing(null);
      setPlannerSteps([]);
      setPlannerTrace([]);
      setCodexStreamItems([]);
      setAssistantDraft('');
      if (showExecutiveControls && getStoredActiveRunId()) {
        void resumeExecutiveRun(getStoredActiveRunId(), loadedMessages, { closePlannerOnSuccess: false });
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [isExecutive, resumeExecutiveRun, showExecutiveControls]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (suppressNextAutoScrollRef.current) {
        suppressNextAutoScrollRef.current = false;
        return;
      }
      const viewport = messagesViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, loading, sending, codexStreamItems, assistantDraft]);

  const loadOlderMessages = useCallback(async () => {
    if (!threadId || !hasMoreMessages || loadingOlderMessagesRef.current) return;
    const firstMessageWithId = messages.find((message) => message.id);
    if (!firstMessageWithId?.id) return;

    const viewport = messagesViewportRef.current;
    const previousScrollHeight = viewport?.scrollHeight || 0;
    const previousScrollTop = viewport?.scrollTop || 0;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        threadId,
        before: firstMessageWithId.id,
        limit: '60',
      });
      const res = await fetch(`/api/investor/personal-agent?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载更早消息失败');
        return;
      }

      const olderMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
      setHasMoreMessages(Boolean(data.hasMore));
      if (olderMessages.length === 0) return;

      suppressNextAutoScrollRef.current = true;
      setMessages((currentMessages) => {
        const existingIds = new Set(currentMessages.map((message) => message.id).filter(Boolean));
        const dedupedOlderMessages = olderMessages.filter((message) => !message.id || !existingIds.has(message.id));
        return [...dedupedOlderMessages, ...currentMessages];
      });

      window.requestAnimationFrame(() => {
        const nextViewport = messagesViewportRef.current;
        if (!nextViewport) return;
        nextViewport.scrollTop = nextViewport.scrollHeight - previousScrollHeight + previousScrollTop;
      });
    } catch {
      setError('加载更早消息失败，请稍后重试');
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [hasMoreMessages, messages, threadId]);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport || viewport.scrollTop > 80) return;
    if (!hasMoreMessages || loadingOlderMessagesRef.current || loading) return;
    void loadOlderMessages();
  }, [hasMoreMessages, loadOlderMessages, loading]);

  useEffect(() => {
    const prompt = searchParams.get('prompt')?.trim();
    if (prompt) setInput(prompt);
  }, [searchParams]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    const oversized = selectedFiles.find((file) => file.size > MAX_ATTACHMENT_FILE_BYTES);
    if (oversized) {
      setError(`附件 ${oversized.name} 超过 ${formatBytes(MAX_ATTACHMENT_FILE_BYTES)}，请压缩后再上传。`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setAttachments((prev) => [...prev, ...selectedFiles.map(createPendingAttachment)].slice(0, MAX_ATTACHMENT_FILES));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  };

  const handleSend = async (textFromSuggestion?: string) => {
    const content = (textFromSuggestion || input).trim();
    const requestAttachments = attachments;
    const hasAttachments = requestAttachments.length > 0;
    if ((!content && !hasAttachments) || sending || !isExecutive) return;

    const attachmentList = formatAttachmentList(requestAttachments);
    const displayContent = [
      content || '请分析我上传的附件。',
      attachmentList ? `附件：\n${attachmentList}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const nextMessages = [...messages, { role: 'user' as const, content: displayContent }];
    setMessages(nextMessages);
    setInput('');
    setAttachments([]);
    setSending(true);
    setError(null);
    setPlannerTrace([]);
    setCodexStreamItems([]);
    setAssistantDraft('');
    setPlannerPanelOpen(false);
    codexEventIndexRef.current = 0;

    try {
      const requestBody = hasAttachments
        ? (() => {
          const formData = new FormData();
          if (threadId) formData.append('threadId', threadId);
          formData.append('message', content);
          formData.append('displayMessage', displayContent);
          requestAttachments.forEach((attachment) => {
            formData.append('attachments', attachment.file, attachment.name);
          });
          return formData;
        })()
        : JSON.stringify({
            threadId,
            message: content,
            displayMessage: displayContent,
          });

      const res = await fetch('/api/investor/personal-agent?stream=1', {
        method: 'POST',
        ...(hasAttachments ? {} : { headers: { 'Content-Type': 'application/json' } }),
        body: requestBody,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof data.error === 'string' ? data.error : '发送失败');
        setMessages(messages);
        setAttachments(requestAttachments);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalData: PersonalAgentFinalData | null = null;
      let finalStatus = 200;

      const appendCodexItem = (item: CodexStreamItem | null) => {
        if (!item) return;
        setCodexStreamItems((prev) => {
          const existingIndex = prev.findIndex((entry) => entry.id === item.id);
          if (existingIndex >= 0) {
            const next = [...prev];
            next[existingIndex] = { ...next[existingIndex], ...item };
            return next.slice(-18);
          }
          return [...prev, item].slice(-18);
        });
      };

      const handleEnvelope = (envelope: Record<string, unknown>) => {
        if (envelope.type === 'heartbeat') return;
        if (envelope.type === 'final') {
          finalStatus = typeof envelope.status === 'number' ? envelope.status : 200;
          finalData = isRecord(envelope.data) ? (envelope.data as PersonalAgentFinalData) : null;
          return;
        }
        const index = codexEventIndexRef.current;
        codexEventIndexRef.current += 1;
        const delta = extractAssistantDelta(envelope);
        if (delta) setAssistantDraft((prev) => `${prev}${delta}`);
        appendCodexItem(projectCodexStreamItem(envelope, index));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const parsed = parseNdjsonLine(line);
          if (parsed) handleEnvelope(parsed);
        }
      }

      if (buffer.trim()) {
        const parsed = parseNdjsonLine(buffer);
        if (parsed) handleEnvelope(parsed);
      }

      if (!finalData || finalStatus >= 400) {
        const finalError = (finalData as { error?: unknown } | null)?.error;
        const finalErrorMessage = typeof finalError === 'string' ? finalError : '发送失败';
        setError(finalErrorMessage);
        setMessages(messages);
        setAttachments(requestAttachments);
        setAssistantDraft('');
        setCodexStreamItems((prev) => [
          ...prev,
          {
            id: `final-error-${Date.now()}`,
            title: '执行失败',
            detail: finalErrorMessage,
            status: 'error',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      const completedData = finalData as PersonalAgentFinalData;
      setThreadId(typeof completedData.threadId === 'string' ? completedData.threadId : threadId);
      if (Array.isArray(completedData.messages) && completedData.messages.length >= nextMessages.length) {
        setMessages(completedData.messages);
      } else if (typeof completedData.reply === 'string') {
        setMessages([...nextMessages, { role: 'assistant', content: completedData.reply }]);
      }
      setAssistantDraft('');
      setCodexStreamItems([]);
    } catch (err) {
      setError(err instanceof Error ? `网络错误：${err.message}` : '网络错误，请稍后重试');
      setMessages(messages);
      setAttachments(requestAttachments);
      setAssistantDraft('');
    } finally {
      activeRunIdRef.current = null;
      setActiveRunId(null);
      setSending(false);
      setStoppingRun(false);
    }
  };

  const openPromptEditor = () => {
    const nextOpen = !promptEditorOpen;
    setPromptEditorOpen(nextOpen);
    setPromptMessage(null);
    if (!nextOpen) return;
    window.setTimeout(() => {
      promptEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const savePrompt = async (resetToDefault = false) => {
    if (promptSaving) return;
    const nextPrompt = resetToDefault ? defaultPrompt : promptDraft.trim();
    if (!resetToDefault && !nextPrompt) {
      setPromptMessage('system prompt 不能为空。');
      return;
    }

    setPromptSaving(true);
    setPromptMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/investor/executive-assistant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetToDefault ? { resetToDefault: true } : { systemPrompt: nextPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPromptMessage(data.error || '保存 system prompt 失败');
        return;
      }

      applyAgentConfig(data.agentConfig);
      setPromptMessage(resetToDefault ? '已恢复默认 system prompt，后续对话生效。' : '已保存，后续对话生效。');
    } catch {
      setPromptMessage('网络错误，请稍后重试');
    } finally {
      setPromptSaving(false);
    }
  };

  if (!isExecutive) {
    return (
      <FigmaShell
        homeHref="/dashboard"
        title="AI助手"
        subtitle="当前仅开放总裁秘书Momo入口"
        actions={
          <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
            返回工作台
          </Link>
        }
      >
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-600">
          暂不支持该助手，请返回工作台使用总裁秘书Momo入口。
        </div>
      </FigmaShell>
    );
  }

  return (
    <FigmaShell
      homeHref="/dashboard"
      title={title}
      subtitle="长期记忆、联网研究和多 Agent 调度入口"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {showExecutiveControls ? (
            <button
              type="button"
              onClick={openPromptEditor}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {promptEditorOpen ? '收起 system prompt' : '编辑 system prompt'}
            </button>
          ) : null}
          <Link href="/dashboard" className="px-2 text-sm text-blue-700 hover:underline">
            返回工作台
          </Link>
        </div>
      }
    >
      {showExecutiveControls && promptEditorOpen ? (
        <div ref={promptEditorRef} className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">总裁秘书 system prompt</h2>
              <p className="mt-1 text-sm text-slate-500">
                当前账户专属配置。保存后，Momo 后续生成回复会使用这段系统提示词。
              </p>
            </div>
            <span
              className={`self-start rounded-full px-2 py-1 text-xs ${
                hasCustomPrompt ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {hasCustomPrompt ? '已自定义' : '默认配置'}
            </span>
          </div>

          <textarea
            value={promptDraft}
            onChange={(e) => {
              setPromptDraft(e.target.value);
              setPromptMessage(null);
            }}
            rows={14}
            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm leading-6 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="输入总裁秘书 Momo 的 system prompt..."
          />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              当前长度 {promptDraft.length}/30000
              {promptDraft !== promptSaved ? ' · 有未保存修改' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={promptSaving || promptDraft === promptSaved}
                onClick={() => {
                  setPromptDraft(promptSaved);
                  setPromptMessage(null);
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                撤销修改
              </button>
              <button
                type="button"
                disabled={promptSaving || !defaultPrompt}
                onClick={() => void savePrompt(true)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                恢复默认
              </button>
              <button
                type="button"
                disabled={promptSaving || !promptDraft.trim()}
                onClick={() => void savePrompt(false)}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {promptSaving ? '保存中...' : '保存并生效'}
              </button>
            </div>
          </div>
          {promptMessage ? (
            <p className={`mt-3 text-sm ${promptMessage.includes('失败') || promptMessage.includes('错误') || promptMessage.includes('不能为空') ? 'text-red-600' : 'text-emerald-700'}`}>
              {promptMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {showExecutiveControls ? (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">秘书 Planner</h2>
            <p className="mt-1 text-sm text-slate-500">
              Momo 会根据每条指令动态生成本轮计划；发送后实时显示，完成后自动收起。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sending && activeRunId ? (
              <button
                type="button"
                onClick={() => void stopExecutiveRun()}
                disabled={stoppingRun}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {stoppingRun ? '停止中...' : '强制停止'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPlannerPanelOpen((open) => !open)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                hasPlannerErrors
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {plannerPanelOpen ? '收起过程' : plannerButtonText}
            </button>
          </div>
        </div>

        {plannerPanelOpen ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">本轮动态 planner</h3>
              <div className="mt-3 space-y-2">
                {plannerSteps.length > 0 ? (
                  plannerSteps.map((step) => {
                    const trace = latestPlannerStatuses.get(step.id);
                    const status = trace?.status || 'PENDING';
                    return (
                      <div key={step.id} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {step.title}
                              {step.agentType ? <span className="ml-2 text-xs text-slate-400">{step.agentType}</span> : null}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{step.description}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${plannerStatusClass[status]}`}>
                            {plannerStatusLabel[status]}
                          </span>
                        </div>
                        {trace?.detail ? <p className="mt-2 text-xs text-slate-600">{trace.detail}</p> : null}
                        {trace?.error ? <p className="mt-2 text-xs text-red-600">{trace.error}</p> : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">发送一条指令后，这里会显示 Momo 为本轮任务动态生成的计划。</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-slate-100">
              <h3 className="text-sm font-semibold">过程详细</h3>
              <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                {plannerTrace.length > 0 ? (
                  plannerTrace.map((item, index) => {
                    const payloadText = formatPlannerPayload(item.payload);
                    return (
                      <div key={`${item.id}-${item.timestamp}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="mt-1 text-xs text-slate-400">{item.timestamp || '时间未知'}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${plannerStatusClass[item.status]}`}>
                            {plannerStatusLabel[item.status]}
                          </span>
                        </div>
                        {item.detail ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-300">{item.detail}</p> : null}
                        {item.error ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-red-300">{item.error}</p> : null}
                        {payloadText ? (
                          <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-[11px] leading-5 text-slate-300">
                            {payloadText}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">发送“更新今天的晨报...”后，这里会实时追加执行过程。</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

      {showExecutiveControls && briefing ? (
        <ExecutiveDailyBriefingBrowser
          briefing={briefing}
          persistedBriefing={persistedBriefing}
          updating={sending}
          onUpdateBriefing={() => void handleSend(EXECUTIVE_UPDATE_BRIEFING_PROMPT)}
          onPromptRequest={(prompt) => setInput(prompt)}
        />
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div
          ref={messagesViewportRef}
          onScroll={handleMessagesScroll}
          className="h-[52vh] overflow-y-auto p-4 sm:h-[56vh] sm:p-5"
        >
          {loading ? (
            <div className="py-8 text-center text-slate-600">加载中...</div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.length > 0 ? (
                <div className="flex justify-center">
                  {hasMoreMessages ? (
                    <button
                      type="button"
                      onClick={() => void loadOlderMessages()}
                      disabled={loadingOlderMessages}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingOlderMessages ? '加载中...' : '加载更早消息'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">已到最早消息</span>
                  )}
                </div>
              ) : null}
              {messages.map((message, index) => (
                <div key={message.id || `${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-xs lg:max-w-md ${
                      message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'
                    }`}
                  >
                    <MarkdownMessage content={message.content} inverted={message.role === 'user'} />
                  </div>
                </div>
              ))}
              <CodexStreamOutput items={codexStreamItems} active={sending} />
              <StreamingAssistantMessage content={assistantDraft} />
              {messages.length === 0 ? <div className="py-8 text-center text-slate-500">开始和你的个人 Hermes Agent 对话吧。</div> : null}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-3 flex max-w-3xl flex-wrap gap-2">
            {suggestedQuestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => void handleSend(question)}
                disabled={sending}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="mx-auto flex max-w-3xl flex-col gap-3"
          >
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    <span className="min-w-0 truncate">{attachment.name}</span>
                    <span className="shrink-0 text-slate-400">{formatBytes(attachment.size)}</span>
                    <span className="hidden shrink-0 text-slate-400 sm:inline">发送时上传</span>
                    <button
                      type="button"
                      title="移除附件"
                      onClick={() => removeAttachment(attachment.id)}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入你的问题..."
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                className="min-h-[7rem] flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:min-h-0 sm:py-2"
              />
              <div className="flex gap-2 sm:self-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={attachmentAccept}
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
                <button
                  type="button"
                  title="添加附件"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:h-9 sm:w-9"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="submit"
                  disabled={(!input.trim() && attachments.length === 0) || sending}
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:py-2"
                >
                  {sending ? '发送中...' : '发送'}
                </button>
              </div>
            </div>
          </form>

          {error ? <p className="mx-auto mt-3 max-w-3xl text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </FigmaShell>
  );
}
