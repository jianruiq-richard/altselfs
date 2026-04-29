'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FigmaShell } from '@/components/figma-shell';

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
};

type BriefingModule = {
  title: string;
  content: string;
  items?: Array<{
    title?: string;
    summary?: string;
    source?: string;
    url?: string;
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

type PlannerStreamEvent =
  | {
      type: 'planner';
      steps: PlannerStep[];
    }
  | {
      type: 'step';
      step: PlannerTraceItem;
    }
  | {
      type: 'final';
      status: number;
      data: Record<string, unknown>;
    };

const suggestedQuestions = [
  '汇报一下各部门工作情况',
  '今天有哪些重点事项需要处理？',
  '外界有什么重要信息变化？',
  '晨报的完整内容是什么？',
  '更新今天的晨报，并重点汇总 AI agent 和 vibe coding 的外界信息。',
];

const updateBriefingPrompt =
  '更新今天的晨报，请调用可用子agent，尤其是微信公众号助手，并重新汇总当天信息，按照行业动态、技术趋势和竞品监控三个模块整理展示。';

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

function normalizeBriefingModules(sections: unknown): BriefingModule[] {
  const expectedTitles = ['行业动态', '技术趋势', '竞品监控'];
  if (!Array.isArray(sections)) {
    return expectedTitles.map((title) => ({
      title,
      content: '点击“更新晨报”后，总裁秘书会重新汇总当天信息并填充这个模块。',
    }));
  }

  return expectedTitles.map((title) => {
    const matched = sections.find((section) => {
      if (!isRecord(section) || typeof section.title !== 'string') return false;
      return section.title.includes(title);
    });
    if (!isRecord(matched)) {
      return {
        title,
        content: '点击“更新晨报”后，总裁秘书会重新汇总当天信息并填充这个模块。',
      };
    }

    const rawItems = Array.isArray(matched.items) ? matched.items : [];
    return {
      title,
      content: typeof matched.content === 'string' && matched.content.trim() ? matched.content : '暂无明确内容。',
      items: rawItems
        .map((item) => {
          if (!isRecord(item)) return null;
          return {
            title: typeof item.title === 'string' ? item.title : undefined,
            summary: typeof item.summary === 'string' ? item.summary : undefined,
            source: typeof item.source === 'string' ? item.source : undefined,
            url: typeof item.url === 'string' ? item.url : undefined,
          };
        })
        .filter(Boolean) as BriefingModule['items'],
    };
  });
}

export default function InvestorAgentChatPage() {
  const params = useParams();
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
  const promptEditorRef = useRef<HTMLDivElement | null>(null);

  const title = useMemo(() => (isExecutive ? '总裁秘书Momo' : 'AI 助手'), [isExecutive]);
  const latestPlannerStatuses = useMemo(() => getLatestPlannerStatuses(plannerTrace), [plannerTrace]);
  const hasPlannerErrors = plannerTrace.some((item) => item.status === 'ERROR');
  const plannerButtonText = sending
    ? '正在执行，查看过程'
    : plannerTrace.length > 0
      ? hasPlannerErrors
        ? '查看上次过程和错误'
        : '查看上次执行过程'
      : '等待本轮 planner';
  const briefingModules = useMemo(
    () => normalizeBriefingModules(persistedBriefing?.sections),
    [persistedBriefing]
  );

  const applyAgentConfig = useCallback((agentConfig: AgentConfig | null | undefined) => {
    if (!agentConfig) return;
    const systemPrompt = String(agentConfig.systemPrompt || '');
    setPromptDraft(systemPrompt);
    setPromptSaved(systemPrompt);
    setDefaultPrompt(String(agentConfig.defaultSystemPrompt || ''));
    setHasCustomPrompt(Boolean(agentConfig.hasCustomPrompt));
  }, []);

  const applyPlannerEvent = useCallback((event: PlannerStreamEvent) => {
    if (event.type === 'planner') {
      setPlannerSteps(normalizePlannerSteps(event.steps));
      return;
    }
    if (event.type === 'step') {
      setPlannerTrace((items) => [...items, event.step]);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!isExecutive) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/investor/executive-assistant');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载失败');
        return;
      }
      setThreadId(data.threadId || null);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setBriefing(data.briefing || null);
      setPersistedBriefing(isRecord(data.persistedBriefing) ? (data.persistedBriefing as PersistedBriefing) : null);
      setPlannerSteps(normalizePlannerSteps(data.planner));
      applyAgentConfig(data.agentConfig);
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [applyAgentConfig, isExecutive]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSend = async (textFromSuggestion?: string) => {
    const content = (textFromSuggestion || input).trim();
    if (!content || sending || !isExecutive) return;

    const nextMessages = [...messages, { role: 'user' as const, content }];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setError(null);
    setPlannerTrace([]);
    setPlannerPanelOpen(true);

    try {
      const res = await fetch('/api/investor/executive-assistant?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          messages: nextMessages,
        }),
      });

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/x-ndjson')) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '发送失败');
        setMessages(messages);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setError('网络错误，请稍后重试');
        setMessages(messages);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finalData: Record<string, unknown> | null = null;
      let finalStatus = 500;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as PlannerStreamEvent;
          if (event.type === 'final') {
            finalStatus = event.status;
            finalData = event.data;
          } else {
            applyPlannerEvent(event);
          }
        }
      }

      if (buffer.trim()) {
        const event = JSON.parse(buffer) as PlannerStreamEvent;
        if (event.type === 'final') {
          finalStatus = event.status;
          finalData = event.data;
        } else {
          applyPlannerEvent(event);
        }
      }

      if (!finalData) {
        setError('AI代理执行失败：未收到最终结果');
        setMessages(messages);
        return;
      }

      const data = finalData;
      if (finalStatus >= 400) {
        setError(typeof data.error === 'string' ? data.error : '发送失败');
        setMessages(messages);
        setPlannerTrace(normalizePlannerTrace(data.plannerTrace));
        setPlannerSteps(normalizePlannerSteps(data.planner));
        return;
      }

      setThreadId(typeof data.threadId === 'string' ? data.threadId : null);
      if (Array.isArray(data.messages)) {
        setMessages(data.messages as ChatMessage[]);
      } else if (typeof data.reply === 'string') {
        setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
      }
      if (data.briefing) {
        setBriefing(data.briefing as Briefing);
      }
      setPersistedBriefing(isRecord(data.persistedBriefing) ? (data.persistedBriefing as PersistedBriefing) : null);
      setPlannerSteps(normalizePlannerSteps(data.planner));
      setPlannerTrace(normalizePlannerTrace(data.plannerTrace));
      applyAgentConfig(data.agentConfig as AgentConfig | null | undefined);
      setPlannerPanelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? `网络错误：${err.message}` : '网络错误，请稍后重试');
      setMessages(messages);
    } finally {
      setSending(false);
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
      subtitle="全局信息整合与战略支持"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openPromptEditor}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {promptEditorOpen ? '收起 system prompt' : '编辑 system prompt'}
          </button>
          <Link href="/dashboard" className="px-2 text-sm text-blue-700 hover:underline">
            返回工作台
          </Link>
        </div>
      }
    >
      {promptEditorOpen ? (
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

      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">秘书 Planner</h2>
            <p className="mt-1 text-sm text-slate-500">
              Momo 会根据每条指令动态生成本轮计划；发送后实时显示，完成后自动收起。
            </p>
          </div>
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

      {briefing ? (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 sm:p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">每日晨报</h2>
              <span className="text-xs text-gray-500">
                {persistedBriefing?.dateKey || briefing.date} · {persistedBriefing?.updatedAt ? `已保存 ${new Date(persistedBriefing.updatedAt).toLocaleString()}` : briefing.generatedTime}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleSend(updateBriefingPrompt)}
              disabled={sending}
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {sending ? '更新中...' : '更新晨报'}
            </button>
          </div>
          <p className="text-sm text-gray-700">{persistedBriefing?.summary || briefing.headline}</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {briefingModules.map((module) => (
              <div key={module.title} className="rounded-xl border border-amber-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{module.title}</p>
                  <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                    {module.items?.length || 0} 条来源
                  </span>
                </div>
                <p className="line-clamp-6 whitespace-pre-wrap text-xs leading-5 text-gray-600">{module.content}</p>
                {module.items && module.items.length > 0 ? (
                  <div className="mt-3 space-y-2 border-t border-amber-100 pt-2">
                    {module.items.slice(0, 2).map((item, index) => (
                      <div key={`${module.title}-${item.url || item.title || index}`}>
                        <p className="text-xs font-medium text-gray-800">{item.title || '未命名来源'}</p>
                        <p className="mt-0.5 text-[11px] text-gray-500">{item.source || '未知来源'}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="h-[52vh] overflow-y-auto p-4 sm:h-[56vh] sm:p-5">
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
                    <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                  </div>
                </div>
              ))}
              {messages.length === 0 ? <div className="py-8 text-center text-slate-500">开始和总裁秘书Momo对话吧。</div> : null}
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
