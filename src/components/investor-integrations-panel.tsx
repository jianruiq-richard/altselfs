'use client';

import { useEffect, useMemo, useState } from 'react';

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

type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
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
  const [assistantInputs, setAssistantInputs] = useState<Record<ProviderKey, string>>({
    gmail: '',
    feishu: '',
  });
  const [assistantLoading, setAssistantLoading] = useState<Record<ProviderKey, boolean>>({
    gmail: false,
    feishu: false,
  });
  const [assistantChats, setAssistantChats] = useState<Record<ProviderKey, AssistantMessage[]>>({
    gmail: [],
    feishu: [],
  });
  const [assistantThreadIds, setAssistantThreadIds] = useState<Record<ProviderKey, string | null>>({
    gmail: null,
    feishu: null,
  });
  const [coachOpen, setCoachOpen] = useState<Record<ProviderKey, boolean>>({
    gmail: false,
    feishu: false,
  });
  const [coachLoaded, setCoachLoaded] = useState<Record<ProviderKey, boolean>>({
    gmail: false,
    feishu: false,
  });
  const [coachLoading, setCoachLoading] = useState<Record<ProviderKey, boolean>>({
    gmail: false,
    feishu: false,
  });
  const [coachSaving, setCoachSaving] = useState<Record<ProviderKey, boolean>>({
    gmail: false,
    feishu: false,
  });
  const [coachDraft, setCoachDraft] = useState<Record<ProviderKey, string>>({
    gmail: '',
    feishu: '',
  });
  const [coachSaved, setCoachSaved] = useState<Record<ProviderKey, string>>({
    gmail: '',
    feishu: '',
  });
  const [coachMessage, setCoachMessage] = useState<Record<ProviderKey, string>>({
    gmail: '',
    feishu: '',
  });

  const banner = useMemo(() => {
    if (!integrationStatus || !integrationProvider) return null;
    const providerLabel = integrationProvider === 'gmail' ? 'Gmail' : '飞书';
    if (integrationStatus === 'connected') {
      return `${providerLabel} 绑定成功`;
    }
    return `${providerLabel} 绑定失败：${integrationDetail || '未知错误'}`;
  }, [integrationDetail, integrationProvider, integrationStatus]);

  const providerLabel = (provider: ProviderKey) => (provider === 'gmail' ? 'Gmail' : '飞书');

  useEffect(() => {
    const loadThreads = async () => {
      for (const provider of ['gmail', 'feishu'] as const) {
        try {
          const res = await fetch(`/api/investor/integrations/assistant/${provider}`);
          const data = await res.json();
          if (!res.ok) continue;
          if (data.thread?.id) {
            setAssistantThreadIds((prev) => ({ ...prev, [provider]: String(data.thread.id) }));
          }
          if (Array.isArray(data.thread?.messages)) {
            setAssistantChats((prev) => ({ ...prev, [provider]: data.thread.messages }));
          }
        } catch {
          // ignore thread preload failure
        }
      }
    };
    void loadThreads();
  }, []);

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

  const sendAssistantMessage = async (provider: ProviderKey) => {
    const text = assistantInputs[provider].trim();
    if (!text || assistantLoading[provider]) return;

    const current = assistantChats[provider];
    const nextMessages: AssistantMessage[] = [...current, { role: 'user', content: text }];

    setAssistantInputs((prev) => ({ ...prev, [provider]: '' }));
    setAssistantChats((prev) => ({ ...prev, [provider]: nextMessages }));
    setAssistantLoading((prev) => ({ ...prev, [provider]: true }));
    setError(null);

    try {
      const res = await fetch(`/api/investor/integrations/assistant/${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, threadId: assistantThreadIds[provider] }),
      });
      const data = await res.json();
      if (!res.ok) {
        const content = data.error || 'AI助手暂时不可用，请稍后重试。';
        setAssistantChats((prev) => ({
          ...prev,
          [provider]: [...nextMessages, { role: 'assistant', content }],
        }));
        return;
      }

      setAssistantChats((prev) => ({
        ...prev,
        [provider]: [...nextMessages, { role: 'assistant', content: data.reply || '已收到，但暂无回复。' }],
      }));
      if (data.threadId) {
        setAssistantThreadIds((prev) => ({ ...prev, [provider]: String(data.threadId) }));
      }
    } catch {
      setAssistantChats((prev) => ({
        ...prev,
        [provider]: [...nextMessages, { role: 'assistant', content: '网络错误，请稍后重试。' }],
      }));
    } finally {
      setAssistantLoading((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const toggleCoach = async (provider: ProviderKey) => {
    const nextOpen = !coachOpen[provider];
    setCoachOpen((prev) => ({ ...prev, [provider]: nextOpen }));
    if (!nextOpen || coachLoaded[provider]) return;

    setCoachLoading((prev) => ({ ...prev, [provider]: true }));
    setCoachMessage((prev) => ({ ...prev, [provider]: '' }));
    setError(null);
    try {
      const res = await fetch(`/api/investor/integrations/assistant/${provider}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载调教设置失败');
        return;
      }

      const prompt = String(data.customPrompt || '');
      setCoachDraft((prev) => ({ ...prev, [provider]: prompt }));
      setCoachSaved((prev) => ({ ...prev, [provider]: prompt }));
      setCoachLoaded((prev) => ({ ...prev, [provider]: true }));
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setCoachLoading((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const saveCoachPrompt = async (provider: ProviderKey) => {
    if (coachSaving[provider]) return;
    setCoachSaving((prev) => ({ ...prev, [provider]: true }));
    setCoachMessage((prev) => ({ ...prev, [provider]: '' }));
    setError(null);
    try {
      const res = await fetch(`/api/investor/integrations/assistant/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPrompt: coachDraft[provider] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '保存调教设置失败');
        return;
      }

      const prompt = String(data.integration?.customPrompt || '');
      setCoachDraft((prev) => ({ ...prev, [provider]: prompt }));
      setCoachSaved((prev) => ({ ...prev, [provider]: prompt }));
      setCoachMessage((prev) => ({ ...prev, [provider]: '已保存，后续对话已生效。' }));
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setCoachSaving((prev) => ({ ...prev, [provider]: false }));
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

            <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-white">
              <p className="text-xs text-slate-500 mb-2">AI员工对话</p>
              <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                {assistantChats[card.provider].length === 0 ? (
                  <p className="text-sm text-slate-500">
                    你可以直接提问，例如“帮我按优先级整理最近邮件并给出今天要做的3件事”。
                  </p>
                ) : (
                  assistantChats[card.provider].map((m, idx) => (
                    <div
                      key={`${card.provider}-${idx}`}
                      className={`rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${
                        m.role === 'user' ? 'bg-sky-50 text-sky-900' : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      {m.content}
                    </div>
                  ))
                )}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={assistantInputs[card.provider]}
                  onChange={(e) =>
                    setAssistantInputs((prev) => ({ ...prev, [card.provider]: e.target.value }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void sendAssistantMessage(card.provider);
                    }
                  }}
                  disabled={!card.connected}
                  placeholder={card.connected ? '输入你的问题...' : '先绑定账号后可对话'}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-100"
                />
                <button
                  type="button"
                  disabled={!card.connected || assistantLoading[card.provider] || !assistantInputs[card.provider].trim()}
                  onClick={() => void sendAssistantMessage(card.provider)}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {assistantLoading[card.provider] ? '思考中...' : '发送'}
                </button>
              </div>
            </div>

            <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">AI员工调教</p>
                <button
                  type="button"
                  onClick={() => void toggleCoach(card.provider)}
                  className="text-xs font-medium text-sky-700 hover:underline"
                >
                  {coachOpen[card.provider] ? '收起' : '打开'}
                </button>
              </div>

              {coachOpen[card.provider] && (
                <div className="mt-2">
                  {coachLoading[card.provider] ? (
                    <p className="text-sm text-slate-500">加载中...</p>
                  ) : (
                    <>
                      <textarea
                        value={coachDraft[card.provider]}
                        onChange={(e) =>
                          setCoachDraft((prev) => ({ ...prev, [card.provider]: e.target.value }))
                        }
                        rows={6}
                        placeholder="例如：你是我的执行型邮箱助理。优先输出待办清单、风险点、可直接发送的回复草稿。语气简洁专业。"
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-xs text-slate-500">
                          当前长度 {coachDraft[card.provider].length}/8000
                        </p>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={coachSaving[card.provider]}
                            onClick={() =>
                              setCoachDraft((prev) => ({ ...prev, [card.provider]: coachSaved[card.provider] }))
                            }
                            className="px-3 py-1.5 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                          >
                            撤销修改
                          </button>
                          <button
                            type="button"
                            disabled={coachSaving[card.provider]}
                            onClick={() => void saveCoachPrompt(card.provider)}
                            className="px-3 py-1.5 text-xs rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                          >
                            {coachSaving[card.provider] ? '保存中...' : '保存并生效'}
                          </button>
                        </div>
                      </div>
                      {coachMessage[card.provider] && (
                        <p className="mt-2 text-xs text-emerald-700">{coachMessage[card.provider]}</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
