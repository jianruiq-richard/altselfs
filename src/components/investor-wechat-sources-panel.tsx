'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DebugCollapsible } from '@/components/debug-collapsible';
import { MarkdownMessage } from '@/components/markdown-message';

type WechatSource = {
  id: string;
  biz: string;
  displayName: string;
  description: string;
  lastArticleUrl: string;
  createdAt: string;
  updatedAt: string;
};

type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type WechatCandidate = {
  displayName: string;
  wechatId: string;
  biz: string;
  originId: string;
  description: string;
  latestArticleUrl: string;
};

type AddSourceLog = {
  step: string;
  status: 'ok' | 'skip' | 'error';
  detail?: string;
  input?: Record<string, unknown>;
};

async function readResponsePayload(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      error: text.slice(0, 500) || `Request failed (HTTP ${res.status})`,
    };
  }
}

export default function InvestorWechatSourcesPanel({
  initialSources,
}: {
  initialSources: WechatSource[];
}) {
  const [sources, setSources] = useState<WechatSource[]>(initialSources);
  const [expanded, setExpanded] = useState(false);
  const [articleUrl, setArticleUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchCandidates, setSearchCandidates] = useState<WechatCandidate[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantThreadId, setAssistantThreadId] = useState<string | null>(null);
  const [clearingAssistant, setClearingAssistant] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachLoaded, setCoachLoaded] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachSaving, setCoachSaving] = useState(false);
  const [coachDraft, setCoachDraft] = useState('');
  const [coachSaved, setCoachSaved] = useState('');
  const [coachMessage, setCoachMessage] = useState('');
  const [addLogs, setAddLogs] = useState<AddSourceLog[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const assistantViewportRef = useRef<HTMLDivElement | null>(null);

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [sources]
  );

  useEffect(() => {
    const loadThreadAndPrompt = async () => {
      try {
        const res = await fetch('/api/investor/wechat-sources/assistant');
        const data = await res.json();
        if (!res.ok) return;
        if (data.thread?.id) {
          setAssistantThreadId(String(data.thread.id));
        }
        if (Array.isArray(data.thread?.messages)) {
          setAssistantMessages(data.thread.messages);
        }
      } catch {
        // ignore preload failure
      }
    };
    void loadThreadAndPrompt();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const viewport = assistantViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assistantMessages, assistantLoading]);

  const addSource = async () => {
    const nextUrl = articleUrl.trim();
    if (!nextUrl || loading) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setAddLogs([]);
    setLogsOpen(false);

    try {
      const res = await fetch('/api/investor/wechat-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleUrl: nextUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Unable to add this source. Please try again later.');
        return;
      }

      const created = data.source as WechatSource;
      setSources((prev) => [created, ...prev.filter((it) => it.id !== created.id)]);
      setArticleUrl('');
      setExpanded(true);
      setSuccess(`Added source: ${created.displayName}`);
      const logs = Array.isArray(data.logs) ? (data.logs as AddSourceLog[]) : [];
      setAddLogs(logs);
      setLogsOpen(logs.length > 0);
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const removeSource = async (id: string) => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setAddLogs([]);
    setLogsOpen(false);

    try {
      const res = await fetch(`/api/investor/wechat-sources/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Delete failed. Please try again later.');
        return;
      }

      setSources((prev) => prev.filter((it) => it.id !== id));
      setSuccess('WeChat Official Account removed');
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const searchCandidatesByKeyword = async () => {
    const keyword = searchKeyword.trim();
    if (!keyword || searchLoading) return;

    setSearchLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/investor/wechat-sources/search?keyword=${encodeURIComponent(keyword)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Search failed. Please try again later.');
        return;
      }
      setSearchCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
        setSuccess('No candidate accounts found. Try another keyword or add an article URL instead.');
      }
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setSearchLoading(false);
    }
  };

  const addSourceFromCandidate = async (candidate: WechatCandidate) => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/investor/wechat-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          biz: candidate.biz,
          displayName: candidate.displayName || candidate.wechatId || candidate.originId || candidate.biz,
          description: candidate.description || '',
          articleUrl: candidate.latestArticleUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to add this source. Please try again later.');
        return;
      }

      const created = data.source as WechatSource;
      setSources((prev) => [created, ...prev.filter((it) => it.id !== created.id)]);
      setExpanded(true);
      setSuccess(`Added source: ${created.displayName}`);
      const logs = Array.isArray(data.logs) ? (data.logs as AddSourceLog[]) : [];
      setAddLogs(logs);
      setLogsOpen(logs.length > 0);
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const sendAssistantMessage = async () => {
    const text = assistantInput.trim();
    if (!text || assistantLoading) return;

    const nextMessages: AssistantMessage[] = [...assistantMessages, { role: 'user', content: text }];
    setAssistantInput('');
    setAssistantMessages(nextMessages);
    setAssistantLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/investor/wechat-sources/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, threadId: assistantThreadId }),
      });
      const data = await readResponsePayload(res);
      if (!res.ok) {
        setAssistantMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content:
              typeof data.error === 'string' && data.error.trim()
                ? data.error
                : 'The AI teammate is temporarily unavailable. Please try again later.',
          },
        ]);
        return;
      }

      setAssistantMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim() ? data.reply : 'Received, but no reply is available yet.',
        },
      ]);
      if (data.threadId) {
        setAssistantThreadId(String(data.threadId));
      }
    } catch {
      setAssistantMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Network error. Please try again later.' },
      ]);
    } finally {
      setAssistantLoading(false);
    }
  };

  const clearAssistantHistory = async () => {
    if (clearingAssistant || assistantLoading) return;
    if (!window.confirm('Clear all chat history for this AI teammate? This cannot be undone.')) return;

    setClearingAssistant(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/investor/wechat-sources/assistant', {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Unable to clear history. Please try again later.');
        return;
      }
      setAssistantMessages([]);
      setAssistantThreadId(null);
      setSuccess('WeChat AI teammate chat history cleared');
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setClearingAssistant(false);
    }
  };

  const toggleCoach = async () => {
    const nextOpen = !coachOpen;
    setCoachOpen(nextOpen);
    if (!nextOpen || coachLoaded) return;

    setCoachLoading(true);
    setError(null);
    setCoachMessage('');
    try {
      const res = await fetch('/api/investor/wechat-sources/assistant');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load coaching settings');
        return;
      }
      const prompt = String(data.customPrompt || '');
      setCoachDraft(prompt);
      setCoachSaved(prompt);
      setCoachLoaded(true);
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setCoachLoading(false);
    }
  };

  const saveCoachPrompt = async () => {
    if (coachSaving) return;
    setCoachSaving(true);
    setError(null);
    setCoachMessage('');

    try {
      const res = await fetch('/api/investor/wechat-sources/assistant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPrompt: coachDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save settings.');
        return;
      }

      const prompt = String(data.integration?.customPrompt || '');
      setCoachDraft(prompt);
      setCoachSaved(prompt);
      setCoachMessage('Saved. Future AI teammate chats will use this coaching prompt.');
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setCoachSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">WeChat Official Accounts</h2>
      <p className="text-sm text-slate-600 mt-1">
        Add WeChat Official Account sources, then ask the AI agent to summarize signals and trends.
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-3 text-sm text-emerald-700">{success}</p>}
      {addLogs.length > 0 && (
        <div className="mt-2 border border-slate-200 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setLogsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
          >
            <span className="text-xs font-medium text-slate-700">Background execution logs ({addLogs.length})</span>
            <span className="text-xs text-slate-500">{logsOpen ? 'Collapse' : 'Expand'}</span>
          </button>
          {logsOpen && (
            <div className="bg-white divide-y divide-slate-200">
              {addLogs.map((log, idx) => (
                <div key={`${log.step}-${idx}`} className="px-3 py-2 text-xs text-slate-700">
                  <p className="font-medium">
                    {idx + 1}. {log.step}{' '}
                    <span
                      className={
                        log.status === 'ok'
                          ? 'text-emerald-700'
                          : log.status === 'skip'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                      }
                    >
                      [{log.status}]
                    </span>
                  </p>
                  {log.detail && <p className="mt-1 text-slate-500 break-all">detail: {log.detail}</p>}
                  {log.input && (
                    <pre className="mt-1 p-2 bg-slate-50 rounded border border-slate-200 text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(log.input, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
        >
          <span className="text-sm font-medium text-slate-800">Current WeChat account library ({sources.length})</span>
          <span className="text-xs text-slate-500">{expanded ? 'Collapse' : 'Expand'}</span>
        </button>

        {expanded && (
          <div className="divide-y divide-slate-200">
            {sortedSources.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">No WeChat accounts added yet</p>
            ) : (
              sortedSources.map((source) => (
                <div key={source.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{source.displayName}</p>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{source.description || 'No account description available'}</p>
                    <a
                      href={source.lastArticleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-sky-700 hover:underline break-all mt-1 inline-block"
                    >
                      Recently added link
                    </a>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void removeSource(source.id)}
                    className="shrink-0 px-3 py-1.5 text-xs rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <input
          value={articleUrl}
          onChange={(e) => setArticleUrl(e.target.value)}
          placeholder="Paste a WeChat article URL, e.g. https://mp.weixin.qq.com/s?..."
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="button"
          disabled={loading || !articleUrl.trim()}
          onClick={() => void addSource()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Add'}
        </button>
      </div>

      <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-slate-50">
        <p className="text-xs text-slate-500 mb-2">Search by keyword and add the right official account directly</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void searchCandidatesByKeyword();
              }
            }}
            placeholder="Enter an account name or keyword"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          />
          <button
            type="button"
            disabled={searchLoading || !searchKeyword.trim()}
            onClick={() => void searchCandidatesByKeyword()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
          >
            {searchLoading ? 'Searching...' : 'Search candidates'}
          </button>
        </div>

        {searchCandidates.length > 0 && (
          <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 bg-white rounded-lg divide-y divide-slate-200">
            {searchCandidates.map((candidate, idx) => (
              <div key={`${candidate.biz || candidate.wechatId || candidate.originId}-${idx}`} className="px-3 py-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900 font-medium truncate">
                    {candidate.displayName || candidate.wechatId || candidate.originId || candidate.biz}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 break-all">
                    wxid: {candidate.wechatId || '-'} · biz: {candidate.biz || '-'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {candidate.description || 'No account description available'}
                  </p>
                  {candidate.latestArticleUrl ? (
                    <p className="text-xs text-emerald-700 mt-1 break-all">Latest article link resolved</p>
                  ) : (
                    <p className="text-xs text-amber-700 mt-1 break-all">Latest article link unavailable. You can add it now and update it later.</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={loading || !candidate.biz}
                  onClick={() => void addSourceFromCandidate(candidate)}
                  className="shrink-0 px-3 py-1.5 text-xs rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 border border-slate-200 rounded-lg p-3 bg-white">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">AI teammate chat</p>
          <button
            type="button"
            disabled={clearingAssistant || assistantLoading || assistantMessages.length === 0}
            onClick={() => void clearAssistantHistory()}
            className="px-2 py-1 text-xs rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            {clearingAssistant ? 'Clearing...' : 'Clear chat history'}
          </button>
        </div>
        <div ref={assistantViewportRef} className="max-h-44 overflow-y-auto space-y-2 pr-1">
          {assistantMessages.length === 0 ? (
            <p className="text-sm text-slate-500">
              Ask a question such as: Summarize the three most important AI application signals from my current WeChat account library.
            </p>
          ) : (
            assistantMessages.map((message, idx) => (
              <div
                key={`wechat-assistant-${idx}`}
                className={`rounded-md px-3 py-2 ${
                  message.role === 'user' ? 'bg-sky-50 text-sky-900' : 'bg-slate-100 text-slate-800'
                }`}
              >
                <MarkdownMessage content={message.content} compact />
              </div>
            ))
          )}
        </div>

        <div className="mt-2 flex gap-2">
          <input
            value={assistantInput}
            onChange={(e) => setAssistantInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void sendAssistantMessage();
              }
            }}
            placeholder="Type your question..."
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            type="button"
            disabled={assistantLoading || !assistantInput.trim()}
            onClick={() => void sendAssistantMessage()}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {assistantLoading ? 'Thinking...' : 'Send'}
          </button>
        </div>
      </div>

      <div className="mt-3">
        <DebugCollapsible title="Advanced settings (AI teammate coaching)">
          <button
            type="button"
            onClick={() => void toggleCoach()}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {coachOpen ? 'Hide coaching editor' : 'Load coaching editor'}
          </button>

          {coachOpen && (
            <div className="mt-2">
              {coachLoading ? (
                <p className="text-sm text-slate-500">Loading...</p>
              ) : (
                <>
                  <textarea
                    value={coachDraft}
                    onChange={(e) => setCoachDraft(e.target.value)}
                    rows={6}
                    placeholder="Example: Keep summaries concise, identify the top three signals, and explain why they matter."
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">Current length {coachDraft.length}/8000</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={coachSaving}
                        onClick={() => setCoachDraft(coachSaved)}
                        className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Discard changes
                      </button>
                      <button
                        type="button"
                        disabled={coachSaving}
                        onClick={() => void saveCoachPrompt()}
                        className="px-3 py-1.5 text-xs rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        {coachSaving ? 'Saving...' : 'Save and apply'}
                      </button>
                    </div>
                  </div>
                  {coachMessage && <p className="mt-2 text-xs text-emerald-700">{coachMessage}</p>}
                </>
              )}
            </div>
          )}
        </DebugCollapsible>
      </div>
    </div>
  );
}
