'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

  const title = useMemo(() => (isExecutive ? '总裁秘书Momo' : 'AI 助手'), [isExecutive]);

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
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [isExecutive]);

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
    } catch {
      setError('网络错误，请稍后重试');
      setMessages(messages);
    } finally {
      setSending(false);
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
        <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
          返回工作台
        </Link>
      }
    >
      {briefing ? (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5">
          <div className="mb-3 flex items-center justify-between">
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
        <div className="h-[56vh] overflow-y-auto p-5">
          {loading ? (
            <div className="py-8 text-center text-slate-600">加载中...</div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-xs rounded-2xl px-4 py-3 lg:max-w-md ${
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

        <div className="border-t border-slate-200 p-4">
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
            className="mx-auto flex max-w-3xl gap-3"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入你的问题..."
              rows={3}
              className="flex-1 resize-none rounded-xl border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="self-end rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
