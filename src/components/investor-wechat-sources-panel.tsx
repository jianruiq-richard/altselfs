'use client';

import { useEffect, useMemo, useState } from 'react';

type WechatSource = {
  id: string;
  biz: string;
  displayName: string;
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
  latestArticleUrl: string;
};

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
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachLoaded, setCoachLoaded] = useState(false);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachSaving, setCoachSaving] = useState(false);
  const [coachDraft, setCoachDraft] = useState('');
  const [coachSaved, setCoachSaved] = useState('');
  const [coachMessage, setCoachMessage] = useState('');

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

  const addSource = async () => {
    const nextUrl = articleUrl.trim();
    if (!nextUrl || loading) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/investor/wechat-sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articleUrl: nextUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '录入失败，请稍后重试');
        return;
      }

      const created = data.source as WechatSource;
      setSources((prev) => [created, ...prev.filter((it) => it.id !== created.id)]);
      setArticleUrl('');
      setExpanded(true);
      setSuccess(`已录入：${created.displayName}`);
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const removeSource = async (id: string) => {
    if (loading) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/investor/wechat-sources/${id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '删除失败，请稍后重试');
        return;
      }

      setSources((prev) => prev.filter((it) => it.id !== id));
      setSuccess('已删除公众号');
    } catch {
      setError('网络错误，请稍后重试');
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
        setError(data.error || '搜索失败，请稍后重试');
        return;
      }
      setSearchCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (!Array.isArray(data.candidates) || data.candidates.length === 0) {
        setSuccess('未搜索到候选公众号，请换个关键词或改用文章链接录入');
      }
    } catch {
      setError('网络错误，请稍后重试');
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
          articleUrl: candidate.latestArticleUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '录入失败，请稍后重试');
        return;
      }

      const created = data.source as WechatSource;
      setSources((prev) => [created, ...prev.filter((it) => it.id !== created.id)]);
      setExpanded(true);
      setSuccess(`已录入：${created.displayName}`);
    } catch {
      setError('网络错误，请稍后重试');
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
      const data = await res.json();
      if (!res.ok) {
        setAssistantMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.error || 'AI员工暂时不可用，请稍后重试。' },
        ]);
        return;
      }

      setAssistantMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply || '已收到，但暂无回复。' },
      ]);
      if (data.threadId) {
        setAssistantThreadId(String(data.threadId));
      }
    } catch {
      setAssistantMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '网络错误，请稍后重试。' },
      ]);
    } finally {
      setAssistantLoading(false);
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
        setError(data.error || '加载调教设置失败');
        return;
      }
      const prompt = String(data.customPrompt || '');
      setCoachDraft(prompt);
      setCoachSaved(prompt);
      setCoachLoaded(true);
    } catch {
      setError('网络错误，请稍后重试');
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
        setError(data.error || '保存调教设置失败');
        return;
      }

      const prompt = String(data.integration?.customPrompt || '');
      setCoachDraft(prompt);
      setCoachSaved(prompt);
      setCoachMessage('已保存，后续公众号AI员工对话已生效。');
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setCoachSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">微信公众号</h2>
      <p className="text-sm text-slate-600 mt-1">
        录入公众号文章链接，系统会自动识别并维护你的公众号库，后续可由 AI Agent 拉取文章并分析。
      </p>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-3 text-sm text-emerald-700">{success}</p>}

      <div className="mt-4 border border-slate-200 rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
        >
          <span className="text-sm font-medium text-slate-800">当前公众号库（{sources.length}）</span>
          <span className="text-xs text-slate-500">{expanded ? '收起' : '展开'}</span>
        </button>

        {expanded && (
          <div className="divide-y divide-slate-200">
            {sortedSources.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-500">暂无录入公众号</p>
            ) : (
              sortedSources.map((source) => (
                <div key={source.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{source.displayName}</p>
                    <p className="text-xs text-slate-500 mt-1">biz: {source.biz}</p>
                    <a
                      href={source.lastArticleUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-sky-700 hover:underline break-all mt-1 inline-block"
                    >
                      最近录入链接
                    </a>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void removeSource(source.id)}
                    className="shrink-0 px-3 py-1.5 text-xs rounded border border-rose-300 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    删除
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
          placeholder="输入公众号文章链接，例如 https://mp.weixin.qq.com/s?..."
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="button"
          disabled={loading || !articleUrl.trim()}
          onClick={() => void addSource()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {loading ? '处理中...' : '添加'}
        </button>
      </div>

      <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-slate-50">
        <p className="text-xs text-slate-500 mb-2">关键词搜索公众号后直接选择录入</p>
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
            placeholder="输入公众号名称或关键词"
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
          />
          <button
            type="button"
            disabled={searchLoading || !searchKeyword.trim()}
            onClick={() => void searchCandidatesByKeyword()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
          >
            {searchLoading ? '搜索中...' : '搜索候选'}
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
                  {candidate.latestArticleUrl ? (
                    <p className="text-xs text-emerald-700 mt-1 break-all">已解析最新文章链接</p>
                  ) : (
                    <p className="text-xs text-amber-700 mt-1 break-all">未拿到最新文章链接（可先录入，后续补链接）</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={loading || !candidate.biz}
                  onClick={() => void addSourceFromCandidate(candidate)}
                  className="shrink-0 px-3 py-1.5 text-xs rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  选择并添加
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 border border-slate-200 rounded-lg p-3 bg-white">
        <p className="text-xs text-slate-500 mb-2">AI员工对话</p>
        <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
          {assistantMessages.length === 0 ? (
            <p className="text-sm text-slate-500">
              你可以提问：例如“基于我当前公众号库，帮我总结 AI 应用方向最近值得关注的3个信号”。
            </p>
          ) : (
            assistantMessages.map((message, idx) => (
              <div
                key={`wechat-assistant-${idx}`}
                className={`rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${
                  message.role === 'user' ? 'bg-sky-50 text-sky-900' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {message.content}
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
            placeholder="输入你的问题..."
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button
            type="button"
            disabled={assistantLoading || !assistantInput.trim()}
            onClick={() => void sendAssistantMessage()}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {assistantLoading ? '思考中...' : '发送'}
          </button>
        </div>
      </div>

      <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-white">
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">AI员工调教</p>
          <button
            type="button"
            onClick={() => void toggleCoach()}
            className="text-xs font-medium text-sky-700 hover:underline"
          >
            {coachOpen ? '收起' : '打开'}
          </button>
        </div>

        {coachOpen && (
          <div className="mt-2">
            {coachLoading ? (
              <p className="text-sm text-slate-500">加载中...</p>
            ) : (
              <>
                <textarea
                  value={coachDraft}
                  onChange={(e) => setCoachDraft(e.target.value)}
                  rows={6}
                  placeholder="例如：你是我的公众号研究员。每次先给3条核心结论，再给证据链接，再给可执行建议。"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">当前长度 {coachDraft.length}/8000</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={coachSaving}
                      onClick={() => setCoachDraft(coachSaved)}
                      className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      撤销修改
                    </button>
                    <button
                      type="button"
                      disabled={coachSaving}
                      onClick={() => void saveCoachPrompt()}
                      className="px-3 py-1.5 text-xs rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {coachSaving ? '保存中...' : '保存并生效'}
                    </button>
                  </div>
                </div>
                {coachMessage && <p className="mt-2 text-xs text-emerald-700">{coachMessage}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
