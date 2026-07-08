'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DebugCollapsible } from '@/components/debug-collapsible';
import { MarkdownMessage } from '@/components/markdown-message';

type ProviderKey =
  | 'gmail'
  | 'feishu'
  | 'xiaohongshu'
  | 'similarweb_api1'
  | 'semrush13'
  | 'semrush8'
  | 'domain_metrics_check';

type IntegrationCard = {
  provider: ProviderKey;
  connected: boolean;
  accountEmail: string | null;
  accountName: string | null;
  updatedAt: string | null;
  latestSummary: string | null;
  latestSummaryAt: string | null;
  platformConfigured?: boolean;
};

type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type PersonalAccount = {
  connectionId: string;
  provider: string;
  accountEmail: string;
  displayName: string;
  status: string;
  updatedAt: string;
};

const COMPETITIVE_DATA_SOURCE_PROVIDERS = [
  'similarweb_api1',
  'semrush13',
  'semrush8',
  'domain_metrics_check',
] as const satisfies readonly ProviderKey[];

const COMPETITIVE_DATA_SOURCE_SET = new Set<ProviderKey>(COMPETITIVE_DATA_SOURCE_PROVIDERS);

const providerLabels: Record<ProviderKey, string> = {
  gmail: 'Gmail',
  feishu: '飞书',
  xiaohongshu: '小红书',
  similarweb_api1: 'Similarweb API1',
  semrush13: 'Semrush13',
  semrush8: 'Semrush8',
  domain_metrics_check: 'Domain Metrics Check',
};

const competitiveDataSourceDescriptions: Record<(typeof COMPETITIVE_DATA_SOURCE_PROVIDERS)[number], string> = {
  similarweb_api1: '提供 Similarweb 类访问量、趋势、国家、设备、来源渠道、关键词和竞品发现信号。',
  semrush13: '提供较完整的域名情报，覆盖访问量、增长历史、搜索流量、渠道、关键词、竞品和外链摘要。',
  semrush8: '提供轻量 SEO URL traffic 指标，可作为覆盖不足时的备选流量、关键词、成本和链接代理信号。',
  domain_metrics_check: '提供 Moz、Majestic、Ahrefs 类域名权威和外链摘要指标，例如 DA、DR、反链和引用域。',
};

const competitiveDataSourceScopes: Record<(typeof COMPETITIVE_DATA_SOURCE_PROVIDERS)[number], string> = {
  similarweb_api1: '访问量、趋势、国家、设备、渠道、关键词、竞品/来源发现。用户量和营收需要结合代理指标推断。',
  semrush13: '访问量、增长历史、搜索流量、渠道、关键词、竞品、AI traffic、外链摘要。不提供完整外链 URL 列表。',
  semrush8: 'Semrush-like rank、关键词数、流量估计、流量价值、链接数。适合补充或兜底，不适合单独确认营收。',
  domain_metrics_check: 'DA/PA、Spam Score、Trust Flow、Citation Flow、DR、外链、引用域、自然关键词和流量代理指标。',
};

const recordForProviders = <T,>(value: T): Record<ProviderKey, T> => ({
  gmail: value,
  feishu: value,
  xiaohongshu: value,
  similarweb_api1: value,
  semrush13: value,
  semrush8: value,
  domain_metrics_check: value,
});

function isCompetitiveDataSource(provider: ProviderKey): provider is (typeof COMPETITIVE_DATA_SOURCE_PROVIDERS)[number] {
  return COMPETITIVE_DATA_SOURCE_SET.has(provider);
}

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
  const [assistantInputs, setAssistantInputs] = useState<Record<ProviderKey, string>>(() => recordForProviders(''));
  const [assistantLoading, setAssistantLoading] = useState<Record<ProviderKey, boolean>>(() => recordForProviders(false));
  const [assistantChats, setAssistantChats] = useState<Record<ProviderKey, AssistantMessage[]>>({
    gmail: [],
    feishu: [],
    xiaohongshu: [],
    similarweb_api1: [],
    semrush13: [],
    semrush8: [],
    domain_metrics_check: [],
  });
  const [assistantThreadIds, setAssistantThreadIds] = useState<Record<ProviderKey, string | null>>({
    gmail: null,
    feishu: null,
    xiaohongshu: null,
    similarweb_api1: null,
    semrush13: null,
    semrush8: null,
    domain_metrics_check: null,
  });
  const [coachOpen, setCoachOpen] = useState<Record<ProviderKey, boolean>>(() => recordForProviders(false));
  const [coachLoaded, setCoachLoaded] = useState<Record<ProviderKey, boolean>>(() => recordForProviders(false));
  const [coachLoading, setCoachLoading] = useState<Record<ProviderKey, boolean>>(() => recordForProviders(false));
  const [coachSaving, setCoachSaving] = useState<Record<ProviderKey, boolean>>(() => recordForProviders(false));
  const [coachDraft, setCoachDraft] = useState<Record<ProviderKey, string>>(() => recordForProviders(''));
  const [coachSaved, setCoachSaved] = useState<Record<ProviderKey, string>>(() => recordForProviders(''));
  const [coachMessage, setCoachMessage] = useState<Record<ProviderKey, string>>(() => recordForProviders(''));
  const [gmailAccounts, setGmailAccounts] = useState<PersonalAccount[]>([]);
  const [gmailAccountsLoading, setGmailAccountsLoading] = useState(false);
  const assistantViewportRefs = useRef<Partial<Record<ProviderKey, HTMLDivElement | null>>>({});

  const banner = useMemo(() => {
    if (!integrationStatus || !integrationProvider) return null;
    const providerLabel = providerLabels[integrationProvider as ProviderKey] || '数据源';
    if (integrationStatus === 'connected') {
      return `${providerLabel} 绑定成功`;
    }
    return `${providerLabel} 绑定失败：${integrationDetail || '未知错误'}`;
  }, [integrationDetail, integrationProvider, integrationStatus]);

  const providerLabel = (provider: ProviderKey) => providerLabels[provider];
  const assistantEndpoint = (provider: ProviderKey) =>
    provider === 'xiaohongshu'
      ? '/api/investor/xiaohongshu/assistant'
      : `/api/investor/integrations/assistant/${provider}`;

  const loadGmailAccounts = async () => {
    setGmailAccountsLoading(true);
    try {
      const res = await fetch('/api/investor/personal-data/accounts?provider=gmail');
      const data = await res.json();
      if (!res.ok) return;
      const accounts = Array.isArray(data.accounts) ? data.accounts as PersonalAccount[] : [];
      setGmailAccounts(accounts);
      setCards((prev) =>
        prev.map((card) =>
          card.provider === 'gmail'
            ? {
                ...card,
                connected: accounts.length > 0,
                accountEmail: accounts.length === 1 ? accounts[0].accountEmail : null,
                accountName: accounts.length > 1 ? `${accounts.length} 个 Gmail 账号` : accounts[0]?.displayName || null,
                updatedAt: accounts[0]?.updatedAt || card.updatedAt,
              }
            : card
        )
      );
    } catch {
      // Keep the existing server-rendered status if personal-agent-server is temporarily unavailable.
    } finally {
      setGmailAccountsLoading(false);
    }
  };

  useEffect(() => {
    const loadThreads = async () => {
      for (const provider of ['feishu', 'xiaohongshu'] as const) {
        try {
          const res = await fetch(assistantEndpoint(provider));
          const data = await res.json();
          if (!res.ok) continue;
          if (data.thread?.id) {
            setAssistantThreadIds((prev) => ({ ...prev, [provider]: String(data.thread.id) }));
          }
          if (Array.isArray(data.thread?.messages)) {
            setAssistantChats((prev) => ({ ...prev, [provider]: data.thread.messages }));
          }
          const prompt = String(data.customPrompt || data.integration?.customPrompt || '');
          setCoachDraft((prev) => ({ ...prev, [provider]: prompt }));
          setCoachSaved((prev) => ({ ...prev, [provider]: prompt }));
        } catch {
          // ignore thread preload failure
        }
      }
    };
    void loadThreads();
    void loadGmailAccounts();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      (['feishu', 'xiaohongshu'] as const).forEach((provider) => {
        const viewport = assistantViewportRefs.current[provider];
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assistantChats, assistantLoading]);

  const connect = async (provider: ProviderKey) => {
    if (isCompetitiveDataSource(provider)) {
      setLoadingProvider(provider);
      setError(null);
      const current = cards.find((card) => card.provider === provider);
      try {
        const res = await fetch(`/api/investor/competitive-data-source/${provider}`, {
          method: current?.connected ? 'DELETE' : 'PUT',
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || `更新 ${providerLabel(provider)} 员工状态失败`);
          return;
        }
        setCards((prev) =>
          prev.map((card) =>
            card.provider === provider
              ? {
                  ...card,
                  connected: Boolean(data.integration?.connected),
                  accountName: data.integration?.accountName || `${providerLabel(provider)} 员工`,
                  updatedAt: data.integration?.updatedAt || new Date().toISOString(),
                  platformConfigured: Boolean(data.integration?.platformConfigured),
                }
              : card
          )
        );
      } catch {
        setError('网络错误，请稍后重试');
      } finally {
        setLoadingProvider(null);
      }
      return;
    }
    if (provider === 'xiaohongshu') {
      setLoadingProvider(provider);
      setError(null);
      try {
        const res = await fetch('/api/investor/xiaohongshu/assistant', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customPrompt: coachDraft.xiaohongshu || '' }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || '启用小红书助手失败');
          return;
        }
        setCards((prev) =>
          prev.map((card) =>
            card.provider === 'xiaohongshu'
              ? {
                  ...card,
                  connected: true,
                  accountName: data.integration?.provider || '小红书助手',
                  updatedAt: data.integration?.updatedAt || new Date().toISOString(),
                }
              : card
          )
        );
      } catch {
        setError('网络错误，请稍后重试');
      } finally {
        setLoadingProvider(null);
      }
      return;
    }
    if (provider === 'gmail') {
      window.location.href = '/api/investor/personal-data/gmail/connect';
      return;
    }
    window.location.href = `/api/investor/integrations/connect/${provider}`;
  };

  const disconnectGmailAccount = async (connectionId: string) => {
    setLoadingProvider('gmail');
    setError(null);
    try {
      const res = await fetch(`/api/investor/personal-data/accounts/${encodeURIComponent(connectionId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '解绑 Gmail 失败');
        return;
      }
      await loadGmailAccounts();
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoadingProvider(null);
    }
  };

  const refreshSummary = async (provider: ProviderKey) => {
    setLoadingProvider(provider);
    setError(null);
    try {
      const res =
        isCompetitiveDataSource(provider)
          ? await fetch(`/api/investor/competitive-data-source/${provider}`)
          : provider === 'gmail'
          ? await fetch('/api/investor/personal-data/accounts?provider=gmail')
          : provider === 'xiaohongshu'
          ? await fetch('/api/investor/xiaohongshu/assistant')
          : await fetch(`/api/investor/integrations/summary/${provider}`, {
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
                connected:
                  isCompetitiveDataSource(provider)
                    ? Boolean(data.integration?.connected)
                    : provider === 'gmail'
                      ? Array.isArray(data.accounts) && data.accounts.length > 0
                    : provider === 'xiaohongshu'
                      ? Boolean(data.integration?.connected)
                      : true,
                accountEmail: provider === 'xiaohongshu' || provider === 'gmail' || isCompetitiveDataSource(provider) ? null : data.integration.accountEmail || null,
                accountName:
                  isCompetitiveDataSource(provider)
                    ? `${providerLabel(provider)} 员工`
                    : provider === 'gmail'
                    ? (Array.isArray(data.accounts) && data.accounts.length > 0 ? `${data.accounts.length} 个 Gmail 账号` : null)
                    : provider === 'xiaohongshu'
                    ? (data.integration?.connected ? '小红书助手' : null)
                    : data.integration.accountName || null,
                updatedAt:
                  isCompetitiveDataSource(provider)
                    ? data.integration?.updatedAt || card.updatedAt
                    : provider === 'gmail'
                      ? card.updatedAt
                    : provider === 'xiaohongshu'
                      ? data.thread?.messages?.length
                        ? new Date().toISOString()
                        : card.updatedAt
                      : data.integration.updatedAt || null,
                latestSummary:
                  isCompetitiveDataSource(provider)
                    ? card.latestSummary
                    : provider === 'gmail'
                    ? 'Gmail 多账号绑定状态已刷新。'
                    : provider === 'xiaohongshu'
                    ? data.thread?.messages?.length
                      ? String(data.thread.messages[data.thread.messages.length - 1]?.content || card.latestSummary || '')
                      : card.latestSummary
                    : data.latestSummary || null,
                latestSummaryAt:
                  provider === 'gmail'
                    ? new Date().toISOString()
                    : provider === 'xiaohongshu'
                    ? data.thread?.messages?.length
                      ? new Date().toISOString()
                      : card.latestSummaryAt
                    : data.latestSummaryAt || null,
                platformConfigured:
                  isCompetitiveDataSource(provider) ? Boolean(data.integration?.platformConfigured) : card.platformConfigured,
              }
            : card
        )
      );
      if (provider === 'gmail' && Array.isArray(data.accounts)) {
        setGmailAccounts(data.accounts as PersonalAccount[]);
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoadingProvider(null);
    }
  };

  const sendAssistantMessage = async (provider: ProviderKey) => {
    if (isCompetitiveDataSource(provider)) return;
    const text = assistantInputs[provider].trim();
    if (!text || assistantLoading[provider]) return;

    const current = assistantChats[provider];
    const nextMessages: AssistantMessage[] = [...current, { role: 'user', content: text }];

    setAssistantInputs((prev) => ({ ...prev, [provider]: '' }));
    setAssistantChats((prev) => ({ ...prev, [provider]: nextMessages }));
    setAssistantLoading((prev) => ({ ...prev, [provider]: true }));
    setError(null);

    try {
      const res = await fetch(assistantEndpoint(provider), {
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
    if (isCompetitiveDataSource(provider)) return;
    const nextOpen = !coachOpen[provider];
    setCoachOpen((prev) => ({ ...prev, [provider]: nextOpen }));
    if (!nextOpen || coachLoaded[provider]) return;

    setCoachLoading((prev) => ({ ...prev, [provider]: true }));
    setCoachMessage((prev) => ({ ...prev, [provider]: '' }));
    setError(null);
    try {
      const res = await fetch(assistantEndpoint(provider));
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载调教设置失败');
        return;
      }

      const prompt = String(data.customPrompt || data.integration?.customPrompt || '');
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
    if (isCompetitiveDataSource(provider)) return;
    if (coachSaving[provider]) return;
    setCoachSaving((prev) => ({ ...prev, [provider]: true }));
    setCoachMessage((prev) => ({ ...prev, [provider]: '' }));
    setError(null);
    try {
      const res = await fetch(assistantEndpoint(provider), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPrompt: coachDraft[provider] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '保存调教设置失败');
        return;
      }

      const prompt = String(data.integration?.customPrompt || data.customPrompt || '');
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
            先绑定 Gmail / 飞书账号，再由数字分身生成你的被动消息摘要。
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
          {card.connected
            ? (card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider) ? '已启用' : '已绑定')
            : (card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider) ? '未启用' : '未绑定')}
                </span>
              </div>

            <p className="text-sm text-slate-600 mt-2">
              {isCompetitiveDataSource(card.provider)
                ? competitiveDataSourceDescriptions[card.provider]
                : card.accountEmail || card.accountName || '尚未绑定账号'}
            </p>
            {isCompetitiveDataSource(card.provider) && (
              <p className="mt-2 text-xs text-slate-500">
                平台托管 RapidAPI 数据源；真实调用由后端个人 Agent 服务的环境变量和供应商额度决定。
              </p>
            )}
            {card.updatedAt && (
              <p className="text-xs text-slate-500 mt-1">
                最近同步：{new Date(card.updatedAt).toLocaleString('zh-CN')}
              </p>
            )}
            {card.provider === 'gmail' && (
              <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-sky-900">已授权 Gmail 账号</p>
                  {gmailAccountsLoading && <span className="text-xs text-sky-700">加载中...</span>}
                </div>
                {gmailAccounts.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    暂无新架构 Gmail 授权。绑定后主 AI 助手会按需调用 Gmail 搜索、读取邮件和线程工具。
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {gmailAccounts.map((account) => (
                      <div key={account.connectionId} className="flex items-center justify-between gap-3 rounded-md bg-white px-3 py-2 border border-sky-100">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{account.accountEmail}</p>
                          <p className="text-xs text-slate-500">
                            {account.status === 'connected' ? '已绑定' : account.status} · {new Date(account.updatedAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={loadingProvider === 'gmail'}
                          onClick={() => void disconnectGmailAccount(account.connectionId)}
                          className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                        >
                          解绑
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void connect(card.provider)}
                className="bg-sky-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
              >
                {card.provider === 'xiaohongshu'
                  ? card.connected
                    ? '已启用小红书助手'
                    : '启用小红书助手'
                  : isCompetitiveDataSource(card.provider)
                    ? card.connected
                      ? `停用 ${providerLabel(card.provider)}`
                      : `启用 ${providerLabel(card.provider)}`
                  : card.connected
                    ? card.provider === 'gmail'
                      ? '绑定更多 Gmail'
                      : '重新绑定'
                    : `绑定${providerLabel(card.provider)}`}
              </button>
              <button
                type="button"
                disabled={loadingProvider === card.provider}
                onClick={() => refreshSummary(card.provider)}
                className="bg-white text-slate-800 px-3 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
              >
                {loadingProvider === card.provider
                  ? '刷新中...'
                  : card.provider === 'gmail' || card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider)
                    ? '刷新状态'
                    : '刷新摘要'}
              </button>
            </div>

            <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500 mb-1">{isCompetitiveDataSource(card.provider) ? '调用范围' : '最近摘要'}</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {card.latestSummary ||
                  (isCompetitiveDataSource(card.provider)
                    ? competitiveDataSourceScopes[card.provider]
                    : card.provider === 'gmail'
                    ? 'Gmail 账号会作为主 AI 助手的原生工具使用；用户提问需要邮件信息时，Codex 会按需调用已授权账号。'
                    : card.provider === 'xiaohongshu'
                    ? '暂无摘要，可直接对话触发 skill 抓取。'
                    : '暂无摘要，绑定后点击“刷新摘要”生成。')}
              </p>
              {card.latestSummaryAt && (
                <p className="text-xs text-slate-500 mt-2">
                  生成于：{new Date(card.latestSummaryAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>

            {!isCompetitiveDataSource(card.provider) && card.provider !== 'gmail' && (
            <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-white">
              <p className="text-xs text-slate-500 mb-2">AI员工对话</p>
              <div
                ref={(node) => {
                  assistantViewportRefs.current[card.provider] = node;
                }}
                className="max-h-44 overflow-y-auto space-y-2 pr-1"
              >
                {assistantChats[card.provider].length === 0 ? (
                  <p className="text-sm text-slate-500">
                    你可以直接提问，例如“帮我按优先级整理最近邮件并给出今天要做的3件事”。
                  </p>
                ) : (
                  assistantChats[card.provider].map((m, idx) => (
                    <div
                      key={`${card.provider}-${idx}`}
                      className={`rounded-md px-3 py-2 ${
                        m.role === 'user' ? 'bg-sky-50 text-sky-900' : 'bg-slate-100 text-slate-800'
                      }`}
                    >
                      <MarkdownMessage content={m.content} compact />
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
            )}

            {!isCompetitiveDataSource(card.provider) && card.provider !== 'gmail' && (
            <div className="mt-3">
              <DebugCollapsible title="高级设置（AI员工调教）">
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => void toggleCoach(card.provider)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {coachOpen[card.provider] ? '隐藏调教编辑器' : '加载调教编辑器'}
                  </button>

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
              </DebugCollapsible>
            </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
