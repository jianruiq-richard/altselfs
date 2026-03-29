'use client';

import { useMemo, useState } from 'react';

type ProviderKey = 'gmail' | 'feishu';

type IntegrationCard = {
  provider: ProviderKey;
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  updatedAt: string | null;
  latestSummary: string | null;
  latestSummaryAt: string | null;
};

export default function InvestorIntegrationsPanel({
  initialCards,
  integrationStatus,
  integrationProvider,
  integrationDetail,
}: {
  initialCards: IntegrationCard[];
  integrationStatus?: string;
  integrationProvider?: string;
  integrationDetail?: string;
}) {
  const [cards, setCards] = useState(initialCards);
  const [loadingProvider, setLoadingProvider] = useState<ProviderKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const banner = useMemo(() => {
    if (!integrationStatus || !integrationProvider) return null;
    const providerLabel = integrationProvider === 'gmail' ? 'Gmail' : '飞书';
    if (integrationStatus === 'connected') {
      return `${providerLabel} 绑定成功`;
    }
    return `${providerLabel} 绑定失败：${integrationDetail || '未知错误'}`;
  }, [integrationDetail, integrationProvider, integrationStatus]);

  const providerLabel = (provider: ProviderKey) => (provider === 'gmail' ? 'Gmail' : '飞书');

  const connect = (provider: ProviderKey) => {
    window.location.href = `/api/investor/integrations/connect/${provider}`;
  };

  const refreshSummary = async (provider: ProviderKey) => {
    setLoadingProvider(provider);
    setError(null);
    try {
      const res = await fetch(`/api/investor/integrations/summary/${provider}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '刷新摘要失败');
        return;
      }
      setCards((prev) =>
        prev.map((card) =>
          card.provider === provider
            ? {
                ...card,
                connected: true,
                accountEmail: data.integration.accountEmail || null,
                accountName: data.integration.accountName || null,
                updatedAt: data.integration.updatedAt || null,
                latestSummary: data.latestSummary || null,
                latestSummaryAt: data.latestSummaryAt || null,
              }
            : card
        )
      );
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">外部消息助手</h2>
          <p className="text-sm text-slate-600 mt-1">
            仅投资人可用。先绑定 Gmail / 飞书账号，再由分身生成你的被动消息摘要。
          </p>
        </div>
      </div>

      {banner && (
        <p className={`mt-4 text-sm ${integrationStatus === 'connected' ? 'text-emerald-700' : 'text-red-600'}`}>
          {banner}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="grid md:grid-cols-2 gap-4 mt-5">
        {cards.map((card) => (
          <div key={card.provider} className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{providerLabel(card.provider)}</h3>
              <span
                className={`px-2 py-1 text-xs rounded-full ${
                  card.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {card.connected ? '已绑定' : '未绑定'}
              </span>
            </div>

            <p className="text-sm text-slate-600 mt-2">
              {card.accountEmail || card.accountName || '尚未绑定账号'}
            </p>
            {card.updatedAt && (
              <p className="text-xs text-slate-500 mt-1">
                最近同步：{new Date(card.updatedAt).toLocaleString('zh-CN')}
              </p>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => connect(card.provider)}
                className="bg-sky-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
              >
                {card.connected ? '重新绑定' : `绑定${providerLabel(card.provider)}`}
              </button>
              <button
                type="button"
                disabled={!card.connected || loadingProvider === card.provider}
                onClick={() => refreshSummary(card.provider)}
                className="bg-white text-slate-800 px-3 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
              >
                {loadingProvider === card.provider ? '刷新中...' : '刷新摘要'}
              </button>
            </div>

            <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500 mb-1">最近摘要</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {card.latestSummary || '暂无摘要，绑定后点击“刷新摘要”生成。'}
              </p>
              {card.latestSummaryAt && (
                <p className="text-xs text-slate-500 mt-2">
                  生成于：{new Date(card.latestSummaryAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
