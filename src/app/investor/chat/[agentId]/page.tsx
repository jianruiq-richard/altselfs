'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { FigmaShell } from '@/components/figma-shell';
import {
  EXECUTIVE_UPDATE_BRIEFING_PROMPT,
  ExecutiveDailyBriefingBrowser,
} from '@/components/executive-daily-briefing-browser';
import { MarkdownMessage } from '@/components/markdown-message';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
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

type AgentActivityStatus = 'running' | 'success' | 'error';

type AgentActivityItem = {
  id: string;
  title: string;
  detail: string;
  status: AgentActivityStatus;
  timestamp: string;
  raw?: unknown;
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

const activityStatusClass: Record<AgentActivityStatus, string> = {
  running: 'bg-blue-100 text-blue-700',
  success: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
};

const activityStatusLabel: Record<AgentActivityStatus, string> = {
  running: '进行中',
  success: '完成',
  error: '错误',
};

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

function formatActivityDetail(value: unknown, fallback = '') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return fallback;
  for (const key of ['reason', 'warning', 'error', 'detail', 'message']) {
    const item = value[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return fallback;
}

function summarizeCodexNotification(payload: Record<string, unknown>) {
  const raw = typeof payload.notification === 'string' ? payload.notification : '';
  if (!raw) return { title: 'Agent 执行中', detail: '正在处理本轮任务' };
  try {
    const notification = JSON.parse(raw) as Record<string, unknown>;
    const method = String(notification.method || '');
    if (method === 'item/agentMessage/delta') return { title: '生成回复', detail: '正在整理最终回答' };
    if (method === 'turn/completed') return { title: '完成本轮任务', detail: '正在收尾并生成总结' };
    if (method === 'item/started') {
      const params = isRecord(notification.params) ? notification.params : {};
      const item = isRecord(params.item) ? params.item : {};
      const type = String(item.type || 'item');
      return { title: '开始执行步骤', detail: `启动 ${type}` };
    }
    if (method === 'item/completed') {
      const params = isRecord(notification.params) ? notification.params : {};
      const item = isRecord(params.item) ? params.item : {};
      const type = String(item.type || 'item');
      return { title: '完成执行步骤', detail: `${type} 已完成` };
    }
    return { title: 'Agent 事件', detail: method || '收到执行事件' };
  } catch {
    return { title: 'Agent 执行中', detail: raw.slice(0, 140) };
  }
}

function projectActivityItem(envelope: Record<string, unknown>, index: number): AgentActivityItem | null {
  const envelopeType = String(envelope.type || '');
  const now = new Date().toISOString();
  if (envelopeType === 'turn_started') {
    return {
      id: `turn-started-${index}`,
      title: '收到指令',
      detail: '正在创建本轮任务并加载上下文',
      status: 'running',
      timestamp: typeof envelope.timestamp === 'string' ? envelope.timestamp : now,
      raw: envelope,
    };
  }

  if (envelopeType === 'error') {
    return {
      id: `stream-error-${index}`,
      title: '执行失败',
      detail: typeof envelope.error === 'string' ? envelope.error : '执行过程中发生错误',
      status: 'error',
      timestamp: now,
      raw: envelope,
    };
  }

  if (envelopeType !== 'event' || !isRecord(envelope.event)) return null;

  const event = envelope.event;
  const type = String(event.type || 'agent.event');
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : now;
  const payload = getEventPayload(event);
  let title = 'Agent 执行中';
  let detail = formatActivityDetail(payload, type);
  let status: AgentActivityStatus = 'running';

  if (type === 'memory.suggested') {
    title = '更新记忆建议';
    detail = '识别到一条可能需要保存的长期偏好';
    status = 'success';
  } else if (type === 'main.agent_profiles.loaded') {
    title = '加载可用能力';
    const profiles = Array.isArray(payload.profiles) ? payload.profiles.length : 0;
    detail = profiles ? `已加载 ${profiles} 个可用 Agent 能力` : '已加载可用 Agent 能力';
    status = 'success';
  } else if (type === 'router.decision' || type.endsWith('router.decision')) {
    title = '选择执行路径';
    detail = formatActivityDetail(payload, '已完成任务路由判断');
    status = 'success';
  } else if (type === 'main.route.selected') {
    title = '确定处理方式';
    detail = typeof payload.route === 'string' ? `本轮交给 ${payload.route} 处理` : '已确定本轮处理方式';
    status = 'success';
  } else if (type === 'codex.session.starting') {
    title = '启动通用 Agent';
    detail = '正在准备本轮工具和上下文环境';
  } else if (type === 'codex.thread.started') {
    title = '创建执行线程';
    detail = '执行线程已就绪';
    status = 'success';
  } else if (type === 'codex.turn.started') {
    title = '开始执行';
    detail = 'Agent 已开始处理你的指令';
  } else if (type.startsWith('codex.server_request.')) {
    title = '调用工具';
    detail = type.replace('codex.server_request.', '') || '正在调用工具';
  } else if (type === 'codex.web_search.not_used') {
    title = '搜索提醒';
    detail = formatActivityDetail(payload, '本轮可能需要联网信息，但未观察到搜索调用');
    status = 'error';
  } else if (type === 'codex.error') {
    title = 'Agent 执行失败';
    detail = formatActivityDetail(payload, 'Codex runtime 执行失败');
    status = 'error';
  } else if (type.startsWith('codex.')) {
    const summary = summarizeCodexNotification(payload);
    title = summary.title;
    detail = summary.detail;
    if (type.includes('completed')) status = 'success';
  } else if (type === 'hermes.profile.updated') {
    title = '更新用户画像';
    detail = '识别到可沉淀的个人偏好或画像信息';
    status = 'success';
  } else if (type === 'hermes.profile.loaded') {
    title = '加载个人上下文';
    const count = typeof payload.entryCount === 'number' ? payload.entryCount : 0;
    detail = count ? `已加载 ${count} 条个人上下文` : '已加载个人上下文';
    status = 'success';
  } else if (type === 'hermes.source_runtime.starting') {
    title = '启动 Hermes Agent';
    detail = '正在准备本轮推理和工具环境';
  } else if (type === 'hermes.source_runtime.completed') {
    title = 'Hermes 执行完成';
    detail = '正在生成最终回复';
    status = 'success';
  } else if (type === 'hermes.memory_review.enqueued') {
    title = '安排记忆复盘';
    detail = '本轮结束后会异步检查是否需要沉淀长期记忆';
    status = 'success';
  }

  return {
    id: `${type}-${timestamp}-${index}`,
    title,
    detail,
    status,
    timestamp,
    raw: event,
  };
}

function extractAssistantDelta(envelope: Record<string, unknown>) {
  if (String(envelope.type || '') !== 'event' || !isRecord(envelope.event)) return '';
  const payload = getEventPayload(envelope.event);
  const projected = isRecord(payload.projected) ? payload.projected : {};
  const delta = projected.assistantDelta;
  return typeof delta === 'string' ? delta : '';
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

function AgentActivityPanel({
  items,
  assistantDraft,
  active,
}: {
  items: AgentActivityItem[];
  assistantDraft: string;
  active: boolean;
}) {
  if (items.length === 0 && !active) return null;
  const visibleItems = items.slice(-8);
  const latest = visibleItems[visibleItems.length - 1];

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[92%] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 sm:max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {active ? '正在执行' : '执行过程'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {latest?.detail || '正在准备本轮任务'}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${active ? activityStatusClass.running : activityStatusClass.success}`}>
            {active ? '进行中' : '已完成'}
          </span>
        </div>

        <div className="mt-3 space-y-2">
          {visibleItems.length > 0 ? (
            visibleItems.map((item) => (
              <div key={item.id} className="flex gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className={`mt-0.5 h-fit shrink-0 rounded-full px-2 py-0.5 text-[11px] ${activityStatusClass[item.status]}`}>
                  {activityStatusLabel[item.status]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{item.title}</p>
                  <p className="mt-0.5 break-words text-xs leading-5 text-slate-600">{item.detail}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
              正在创建本轮任务并加载上下文
            </div>
          )}
        </div>

        {assistantDraft.trim() ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="mb-1 text-xs font-medium text-slate-500">正在整理回复</p>
            <div className="max-h-32 overflow-y-auto text-slate-800">
              <MarkdownMessage content={assistantDraft} compact />
            </div>
          </div>
        ) : null}
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
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [persistedBriefing, setPersistedBriefing] = useState<PersistedBriefing | null>(null);
  const [input, setInput] = useState('');
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
  const [activityItems, setActivityItems] = useState<AgentActivityItem[]>([]);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stoppingRun, setStoppingRun] = useState(false);
  const promptEditorRef = useRef<HTMLDivElement | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const activityEventIndexRef = useRef(0);

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
      setBriefing(null);
      setPersistedBriefing(null);
      setPlannerSteps([]);
      setPlannerTrace([]);
      setActivityItems([]);
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
      const viewport = messagesViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, loading, sending, activityItems, assistantDraft]);

  useEffect(() => {
    const prompt = searchParams.get('prompt')?.trim();
    if (prompt) setInput(prompt);
  }, [searchParams]);

  const handleSend = async (textFromSuggestion?: string) => {
    const content = (textFromSuggestion || input).trim();
    if (!content || sending || !isExecutive) return;

    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setError(null);
    setPlannerTrace([]);
    setActivityItems([]);
    setAssistantDraft('');
    setPlannerPanelOpen(false);
    activityEventIndexRef.current = 0;

    try {
      const res = await fetch('/api/investor/personal-agent?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          messages: nextMessages,
        }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(typeof data.error === 'string' ? data.error : '发送失败');
        setMessages(messages);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalData: PersonalAgentFinalData | null = null;
      let finalStatus = 200;

      const appendActivity = (item: AgentActivityItem | null) => {
        if (!item) return;
        setActivityItems((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.title === item.title && last.detail === item.detail && last.status === item.status) {
            return [...prev.slice(0, -1), item];
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
        const index = activityEventIndexRef.current;
        activityEventIndexRef.current += 1;
        const delta = extractAssistantDelta(envelope);
        if (delta) setAssistantDraft((prev) => `${prev}${delta}`);
        appendActivity(projectActivityItem(envelope, index));
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
        setActivityItems((prev) => [
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
      if (Array.isArray(completedData.messages)) {
        setMessages(completedData.messages);
      } else if (typeof completedData.reply === 'string') {
        setMessages([...nextMessages, { role: 'assistant', content: completedData.reply }]);
      }
      setAssistantDraft('');
      setActivityItems((prev) => [
        ...prev,
        {
          id: `final-success-${Date.now()}`,
          title: '完成总结',
          detail: '已生成最终回复',
          status: 'success',
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? `网络错误：${err.message}` : '网络错误，请稍后重试');
      setMessages(messages);
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
        <div ref={messagesViewportRef} className="h-[52vh] overflow-y-auto p-4 sm:h-[56vh] sm:p-5">
          {loading ? (
            <div className="py-8 text-center text-slate-600">加载中...</div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-xs lg:max-w-md ${
                      message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'
                    }`}
                  >
                    <MarkdownMessage content={message.content} inverted={message.role === 'user'} />
                  </div>
                </div>
              ))}
              <AgentActivityPanel items={activityItems} assistantDraft={assistantDraft} active={sending} />
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
            className="mx-auto flex max-w-3xl flex-col gap-3 sm:flex-row"
          >
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
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:self-end sm:py-2"
            >
              {sending ? '发送中...' : '发送'}
            </button>
          </form>

          {error ? <p className="mx-auto mt-3 max-w-3xl text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </FigmaShell>
  );
}
