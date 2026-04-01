'use client';

import { useMemo, useState } from 'react';

type WechatSource = {
  id: string;
  biz: string;
  displayName: string;
  lastArticleUrl: string;
  createdAt: string;
  updatedAt: string;
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

  const sortedSources = useMemo(
    () => [...sources].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)),
    [sources]
  );

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
    </div>
  );
}
