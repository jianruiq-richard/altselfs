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

type AgentConfig = {
  systemPrompt: string;
  defaultSystemPrompt: string;
  hasCustomPrompt: boolean;
};

const suggestedQuestions = [
  '汇报一下各部门工作情况',
  '今天有哪些重点事项需要处理？',
  '外界有什么重要信息变化？',
  '晨报的完整内容是什么？',
];

export default function InvestorAgentChatPage() {
  const params = useParams();
  const agentId = params.agentId as string;
  const isExecutive = agentId === '100';

  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
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
  const promptEditorRef = useRef<HTMLDivElement | null>(null);

  const title = useMemo(() => (isExecutive ? '总裁秘书Momo' : 'AI 助手'), [isExecutive]);

  const applyAgentConfig = useCallback((agentConfig: AgentConfig | null | undefined) => {
    if (!agentConfig) return;
    const systemPrompt = String(agentConfig.systemPrompt || '');
    setPromptDraft(systemPrompt);
    setPromptSaved(systemPrompt);
    setDefaultPrompt(String(agentConfig.defaultSystemPrompt || ''));
    setHasCustomPrompt(Boolean(agentConfig.hasCustomPrompt));
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

    try {
      const res = await fetch('/api/investor/executive-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId,
          messages: nextMessages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '发送失败');
        setMessages(messages);
        return;
      }

      setThreadId(data.threadId || null);
      if (Array.isArray(data.messages)) {
        setMessages(data.messages);
      } else if (typeof data.reply === 'string') {
        setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
      }
      if (data.briefing) {
        setBriefing(data.briefing);
      }
      applyAgentConfig(data.agentConfig);
    } catch {
      setError('网络错误，请稍后重试');
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

      {briefing ? (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 sm:p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-gray-900">每日晨报</h2>
            <span className="text-xs text-gray-500">
              {briefing.date} · {briefing.generatedTime}
            </span>
          </div>
          <p className="text-sm text-gray-700">{briefing.headline}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {briefing.priorityTasks.slice(0, 2).map((task) => (
              <div key={`${task.task}-${task.deadline}`} className="rounded-lg border border-amber-200 bg-white p-3">
                <p className="text-sm font-medium text-gray-900">{task.task}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {task.deadline} · {task.assignedBy}
                </p>
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
