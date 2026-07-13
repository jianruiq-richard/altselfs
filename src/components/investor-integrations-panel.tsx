'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  connectionType?: string;
  accountEmail: string;
  displayName: string;
  featurePackages?: string[];
  status: string;
  updatedAt: string;
};

type FeishuFeaturePackage = 'messages' | 'contacts' | 'calendar' | 'docs' | 'meetings';

const COMPETITIVE_DATA_SOURCE_PROVIDERS = [
  'similarweb_api1',
  'semrush13',
  'semrush8',
  'domain_metrics_check',
] as const satisfies readonly ProviderKey[];

const COMPETITIVE_DATA_SOURCE_SET = new Set<ProviderKey>(COMPETITIVE_DATA_SOURCE_PROVIDERS);

const FEISHU_FEATURE_PACKAGES = [
  { key: 'messages', label: '消息', description: 'IM 搜索、群聊/单聊消息读取' },
  { key: 'contacts', label: '联系人', description: '按姓名搜索用户、辅助定位单聊' },
  { key: 'calendar', label: '日历', description: '读取今日/时间段日程' },
  { key: 'docs', label: '文档', description: '搜索和读取云文档、云空间文件' },
  { key: 'meetings', label: '会议', description: '预留会议/妙记/纪要授权，工具接通后可用' },
] as const satisfies readonly { key: FeishuFeaturePackage; label: string; description: string }[];

const DEFAULT_FEISHU_FEATURE_PACKAGES: FeishuFeaturePackage[] = ['messages', 'contacts', 'calendar', 'docs'];

const providerLabels: Record<ProviderKey, string> = {
  gmail: 'Gmail',
  feishu: '飞书',
  xiaohongshu: '小红书',
  similarweb_api1: 'Similarweb API1',
  semrush13: 'Semrush13',
  semrush8: 'Semrush8',
  domain_metrics_check: 'Domain Metrics Check',
};

function providerLabel(provider: ProviderKey) {
  return providerLabels[provider];
}

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

function isPersonalAccountProvider(provider: ProviderKey): provider is 'gmail' | 'feishu' {
  return provider === 'gmail' || provider === 'feishu';
}

function normalizeFeishuFeaturePackages(value: unknown, fallback: FeishuFeaturePackage[] = []) {
  if (!Array.isArray(value)) return [...fallback];
  const allowed = new Set<string>(FEISHU_FEATURE_PACKAGES.map((item) => item.key));
  return value
    .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
    .filter((item, index, items) => allowed.has(item) && items.indexOf(item) === index) as FeishuFeaturePackage[];
}

function sameFeaturePackages(left: FeishuFeaturePackage[], right: FeishuFeaturePackage[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function hasAddedFeaturePackages(current: FeishuFeaturePackage[], next: FeishuFeaturePackage[]) {
  const currentSet = new Set(current);
  return next.some((item) => !currentSet.has(item));
}

function togglePackage(packages: FeishuFeaturePackage[], featurePackage: FeishuFeaturePackage) {
  return packages.includes(featurePackage)
    ? packages.filter((item) => item !== featurePackage)
    : [...packages, featurePackage];
}

function openFeishuAuthPlaceholder(message = '正在准备飞书账号授权...') {
  if (typeof window === 'undefined') return null;
  const popup = window.open('', '_blank');
  if (!popup) return null;
  try {
    popup.opener = null;
    popup.document.title = '飞书账号授权';
    popup.document.body.style.cssText = 'font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; color: #0f172a;';
    popup.document.body.textContent = message;
  } catch {
    // Some browsers restrict touching popup contents; navigation below still works.
  }
  return popup;
}

function closePreparedPopup(popup: Window | null) {
  if (!popup || popup.closed) return;
  try {
    popup.close();
  } catch {
    // Ignore browser popup lifecycle differences.
  }
}

function openFeishuAuthUrl(popup: Window | null, authUrl: string) {
  if (popup && !popup.closed) {
    try {
      popup.location.href = authUrl;
      return true;
    } catch {
      // Fall back to opening a new tab below.
    }
  }
  if (typeof window === 'undefined') return false;
  return Boolean(window.open(authUrl, '_blank', 'noreferrer'));
}

export default function InvestorIntegrationsPanel({
  initialCards,
  integrationStatus,
  integrationProvider,
  integrationDetail,
  feishuPhase,
  feishuSetupUrl,
  feishuAuthUrl,
  feishuUserCode,
}: {
  initialCards: IntegrationCard[];
  integrationStatus?: string;
  integrationProvider?: string;
  integrationDetail?: string;
  feishuPhase?: string;
  feishuSetupUrl?: string;
  feishuAuthUrl?: string;
  feishuUserCode?: string;
}) {
  const [cards, setCards] = useState(initialCards);
  const [loadingProvider, setLoadingProvider] = useState<ProviderKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feishuCliCompleting, setFeishuCliCompleting] = useState(false);
  const [feishuCliMessage, setFeishuCliMessage] = useState('');
  const [feishuCliPhase, setFeishuCliPhase] = useState(feishuPhase || (feishuAuthUrl ? 'user_auth' : feishuSetupUrl ? 'app_setup' : ''));
  const [feishuCliSetupUrl, setFeishuCliSetupUrl] = useState(feishuSetupUrl || '');
  const [feishuCliAuthUrl, setFeishuCliAuthUrl] = useState(feishuAuthUrl || '');
  const [feishuCliUserCode, setFeishuCliUserCode] = useState(feishuUserCode || '');
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
  const [feishuAccounts, setFeishuAccounts] = useState<PersonalAccount[]>([]);
  const [feishuAccountsLoading, setFeishuAccountsLoading] = useState(false);
  const [personalAccountsChecked, setPersonalAccountsChecked] = useState<Record<'gmail' | 'feishu', boolean>>({
    gmail: false,
    feishu: false,
  });
  const [personalAccountsError, setPersonalAccountsError] = useState<Record<'gmail' | 'feishu', string>>({
    gmail: '',
    feishu: '',
  });
  const [feishuBindPackages, setFeishuBindPackages] = useState<FeishuFeaturePackage[]>(DEFAULT_FEISHU_FEATURE_PACKAGES);
  const [feishuPackageDrafts, setFeishuPackageDrafts] = useState<Record<string, FeishuFeaturePackage[]>>({});
  const [feishuPackageSaving, setFeishuPackageSaving] = useState<Record<string, boolean>>({});
  const [feishuPackageMessages, setFeishuPackageMessages] = useState<Record<string, string>>({});
  const assistantViewportRefs = useRef<Partial<Record<ProviderKey, HTMLDivElement | null>>>({});
  const feishuCliPopupRef = useRef<Window | null>(null);
  const feishuCliPollRef = useRef<number | null>(null);
  const feishuCliAutoRequestRef = useRef(false);

  const clearFeishuCliPoll = useCallback(() => {
    if (feishuCliPollRef.current === null) return;
    window.clearInterval(feishuCliPollRef.current);
    feishuCliPollRef.current = null;
  }, []);

  const banner = useMemo(() => {
    if (!integrationStatus || !integrationProvider) return null;
    const providerLabel = providerLabels[integrationProvider as ProviderKey] || '数据源';
    if (integrationStatus === 'pending') {
      return `${providerLabel} 授权待完成：${integrationDetail || '请完成授权后返回本页。'}`;
    }
    if (integrationStatus === 'connected') {
      return `${providerLabel} 绑定成功`;
    }
    return `${providerLabel} 绑定失败：${integrationDetail || '未知错误'}`;
  }, [integrationDetail, integrationProvider, integrationStatus]);

  const assistantEndpoint = (provider: ProviderKey) =>
    provider === 'xiaohongshu'
      ? '/api/investor/xiaohongshu/assistant'
      : `/api/investor/integrations/assistant/${provider}`;

  const loadPersonalAccounts = useCallback(async (provider: 'gmail' | 'feishu') => {
    if (provider === 'gmail') setGmailAccountsLoading(true);
    if (provider === 'feishu') setFeishuAccountsLoading(true);
    setPersonalAccountsError((prev) => ({ ...prev, [provider]: '' }));
    try {
      const res = await fetch(`/api/investor/personal-data/accounts?provider=${provider}`);
      const data = await res.json();
      if (!res.ok) {
        setPersonalAccountsError((prev) => ({
          ...prev,
          [provider]: data.error || `${providerLabel(provider)} 授权状态检查失败。`,
        }));
        return;
      }
      const accounts = Array.isArray(data.accounts) ? data.accounts as PersonalAccount[] : [];
      if (provider === 'gmail') setGmailAccounts(accounts);
      if (provider === 'feishu') {
        setFeishuAccounts(accounts);
        setFeishuPackageDrafts((prev) => {
          const next = { ...prev };
          for (const account of accounts) {
            if (!next[account.connectionId]) {
              next[account.connectionId] = normalizeFeishuFeaturePackages(account.featurePackages, DEFAULT_FEISHU_FEATURE_PACKAGES);
            }
          }
          return next;
        });
      }
      setCards((prev) =>
        prev.map((card) =>
          card.provider === provider
            ? {
                ...card,
                connected: accounts.length > 0,
                accountEmail: provider === 'gmail' && accounts.length === 1 ? accounts[0].accountEmail : null,
                accountName: accounts.length > 1
                  ? `${accounts.length} 个 ${providerLabel(provider)} 账号`
                  : accounts[0]?.displayName || (provider === 'gmail' ? accounts[0]?.accountEmail : null) || null,
                updatedAt: accounts[0]?.updatedAt || card.updatedAt,
              }
            : card
        )
      );
    } catch {
      setPersonalAccountsError((prev) => ({
        ...prev,
        [provider]: `${providerLabel(provider)} 授权状态检查失败。`,
      }));
    } finally {
      setPersonalAccountsChecked((prev) => ({ ...prev, [provider]: true }));
      if (provider === 'gmail') setGmailAccountsLoading(false);
      if (provider === 'feishu') setFeishuAccountsLoading(false);
    }
  }, []);

  const personalAccountsFor = (provider: ProviderKey) => (
    provider === 'gmail' ? gmailAccounts : provider === 'feishu' ? feishuAccounts : []
  );

  const personalAccountsLoadingFor = (provider: ProviderKey) => (
    provider === 'gmail' ? gmailAccountsLoading : provider === 'feishu' ? feishuAccountsLoading : false
  );

  const personalAccountsCheckedFor = (provider: ProviderKey) => (
    provider === 'gmail' ? personalAccountsChecked.gmail : provider === 'feishu' ? personalAccountsChecked.feishu : true
  );

  const personalAccountsErrorFor = (provider: ProviderKey) => (
    provider === 'gmail' ? personalAccountsError.gmail : provider === 'feishu' ? personalAccountsError.feishu : ''
  );

  useEffect(() => {
    const loadThreads = async () => {
      for (const provider of ['xiaohongshu'] as const) {
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
    void loadPersonalAccounts('gmail');
    void loadPersonalAccounts('feishu');
  }, [loadPersonalAccounts]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      (['xiaohongshu'] as const).forEach((provider) => {
        const viewport = assistantViewportRefs.current[provider];
        if (viewport) viewport.scrollTop = viewport.scrollHeight;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [assistantChats, assistantLoading]);

  useEffect(() => () => clearFeishuCliPoll(), [clearFeishuCliPoll]);

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
    if (isPersonalAccountProvider(provider)) {
      if (provider === 'feishu' && feishuBindPackages.length === 0) {
        setError('至少选择一个飞书功能包后再绑定。');
        return;
      }
      const packagesQuery = provider === 'feishu'
        ? `?packages=${encodeURIComponent(feishuBindPackages.join(','))}`
        : '';
      window.location.href = `/api/investor/personal-data/${provider}/connect${packagesQuery}`;
      return;
    }
    window.location.href = `/api/investor/integrations/connect/${provider}`;
  };

  const disconnectPersonalAccount = async (provider: ProviderKey, connectionId: string) => {
    if (!isPersonalAccountProvider(provider)) return;
    setLoadingProvider(provider);
    setError(null);
    try {
      const res = await fetch(`/api/investor/personal-data/accounts/${encodeURIComponent(connectionId)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `解绑 ${providerLabel(provider)} 失败`);
        return;
      }
      await loadPersonalAccounts(provider);
    } catch {
      setError('网络错误，请稍后重试');
      if (isPersonalAccountProvider(provider)) {
        setPersonalAccountsChecked((prev) => ({ ...prev, [provider]: true }));
        setPersonalAccountsError((prev) => ({
          ...prev,
          [provider]: `${providerLabel(provider)} 授权状态检查失败。`,
        }));
      }
    } finally {
      setLoadingProvider(null);
    }
  };

  const saveFeishuFeaturePackages = async (account: PersonalAccount) => {
    const current = normalizeFeishuFeaturePackages(account.featurePackages, DEFAULT_FEISHU_FEATURE_PACKAGES);
    const next = normalizeFeishuFeaturePackages(feishuPackageDrafts[account.connectionId], []);
    setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: '' }));
    if (sameFeaturePackages(current, next)) {
      setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: '功能包没有变化。' }));
      return;
    }

    if (hasAddedFeaturePackages(current, next)) {
      setFeishuPackageMessages((prev) => ({
        ...prev,
        [account.connectionId]: '新增功能包需要重新授权，请在飞书授权页选择同一个账号。',
      }));
      window.location.href = `/api/investor/personal-data/feishu/connect?packages=${encodeURIComponent(next.join(','))}`;
      return;
    }

    setFeishuPackageSaving((prev) => ({ ...prev, [account.connectionId]: true }));
    try {
      const res = await fetch(`/api/investor/personal-data/accounts/${encodeURIComponent(account.connectionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featurePackages: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: data.error || '保存功能包失败。' }));
        return;
      }
      setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: '已保存，Codex 可调用工具范围已更新。' }));
      await loadPersonalAccounts('feishu');
    } catch {
      setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: '网络错误，请稍后重试。' }));
    } finally {
      setFeishuPackageSaving((prev) => ({ ...prev, [account.connectionId]: false }));
    }
  };

  const openFeishuSetupAndPoll = () => {
    if (!feishuCliSetupUrl) {
      setFeishuCliMessage('飞书 CLI 应用配置链接不存在，请重新绑定。');
      return;
    }
    clearFeishuCliPoll();
    const setupPopup = openFeishuAuthPlaceholder('正在打开飞书 CLI 应用配置...');
    if (!setupPopup) {
      setFeishuCliMessage('浏览器拦截了弹窗，请允许弹窗后重试，或手动打开应用配置链接。');
      return;
    }
    try {
      setupPopup.location.href = feishuCliSetupUrl;
    } catch {
      setFeishuCliMessage('打开飞书 CLI 应用配置失败，请手动打开链接。');
      return;
    }
    feishuCliPopupRef.current = setupPopup;
    setFeishuCliPhase('app_setup');
    setFeishuCliMessage('飞书 CLI 应用配置页已打开，完成配置后会自动进入账号授权。');
    startFeishuCliSetupPolling(setupPopup);
  };

  const startFeishuCliSetupPolling = (popup: Window | null) => {
    clearFeishuCliPoll();
    let attempts = 0;
    feishuCliPollRef.current = window.setInterval(() => {
      attempts += 1;
      if (attempts > 120) {
        clearFeishuCliPoll();
        setFeishuCliMessage('飞书 CLI 应用配置等待超时。你可以手动检查状态，或重新开始绑定。');
        return;
      }
      void continueFeishuCliSetup({ auto: true, popup });
    }, 3000);
  };

  const startFeishuCliCompletionPolling = (popup: Window | null) => {
    clearFeishuCliPoll();
    let attempts = 0;
    feishuCliPollRef.current = window.setInterval(() => {
      attempts += 1;
      if (attempts > 120) {
        clearFeishuCliPoll();
        setFeishuCliMessage('飞书账号授权等待超时。如果你已经在飞书完成授权，可以点击手动完成绑定。');
        return;
      }
      void completeFeishuCliBinding({ auto: true, popup });
    }, 3000);
  };

  const continueFeishuCliSetup = async (options: { auto?: boolean; popup?: Window | null } = {}) => {
    const authPopup =
      options.popup ||
      feishuCliPopupRef.current ||
      (!options.auto && feishuCliPhase !== 'user_auth' && !feishuCliAuthUrl ? openFeishuAuthPlaceholder() : null);
    if (authPopup) feishuCliPopupRef.current = authPopup;
    if (feishuCliAutoRequestRef.current) return;
    feishuCliAutoRequestRef.current = true;
    if (!options.auto) {
      setFeishuCliCompleting(true);
      setFeishuCliMessage('');
    }
    setError(null);
    try {
      const res = await fetch('/api/investor/personal-data/feishu/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'continue' }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (!options.auto) {
          closePreparedPopup(authPopup);
          setFeishuCliMessage(data.error || '飞书 CLI 应用配置还没有完成，请完成后再继续。');
        }
        return;
      }
      if (data.phase === 'connected' || data.account) {
        clearFeishuCliPoll();
        closePreparedPopup(authPopup);
        feishuCliPopupRef.current = null;
        setFeishuCliPhase('connected');
        setFeishuCliMessage('飞书绑定成功，已切换到 lark-cli 增强连接。');
        await loadPersonalAccounts('feishu');
        return;
      }
      if (data.phase === 'user_auth' && data.authUrl) {
        const authUrl = String(data.authUrl);
        const opened = openFeishuAuthUrl(authPopup, authUrl);
        setFeishuCliPhase('user_auth');
        setFeishuCliAuthUrl(authUrl);
        setFeishuCliUserCode(typeof data.userCode === 'string' ? data.userCode : '');
        setFeishuCliMessage(
          opened
            ? '飞书 CLI 应用配置完成，已打开账号授权页。确认授权后会自动完成绑定。'
            : '飞书 CLI 应用配置完成，请点击打开账号授权。'
        );
        if (opened) {
          startFeishuCliCompletionPolling(authPopup);
        }
        return;
      }
      setFeishuCliPhase(data.phase || 'app_setup');
      if (data.setupUrl) setFeishuCliSetupUrl(String(data.setupUrl));
      if (!options.auto) {
        closePreparedPopup(authPopup);
        setFeishuCliMessage('仍在等待飞书 CLI 应用配置完成，请完成页面操作后再试。');
      }
    } catch {
      if (!options.auto) {
        closePreparedPopup(authPopup);
        setFeishuCliMessage('网络错误，请稍后重试。');
      }
    } finally {
      feishuCliAutoRequestRef.current = false;
      if (!options.auto) setFeishuCliCompleting(false);
    }
  };

  const completeFeishuCliBinding = async (options: { auto?: boolean; popup?: Window | null } = {}) => {
    if (feishuCliAutoRequestRef.current) return;
    feishuCliAutoRequestRef.current = true;
    if (!options.auto) {
      clearFeishuCliPoll();
      setFeishuCliCompleting(true);
      setFeishuCliMessage('');
    }
    setError(null);
    try {
      const res = await fetch('/api/investor/personal-data/feishu/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (options.auto) {
          setFeishuCliMessage('等待你在飞书账号授权页确认授权...');
        } else {
          setFeishuCliMessage(data.error || '飞书绑定完成失败，请确认已在飞书页面完成授权。');
        }
        return;
      }
      clearFeishuCliPoll();
      closePreparedPopup(options.popup || feishuCliPopupRef.current);
      feishuCliPopupRef.current = null;
      setFeishuCliPhase('connected');
      setFeishuCliMessage('飞书绑定成功，已切换到 lark-cli 增强连接。');
      await loadPersonalAccounts('feishu');
    } catch {
      if (options.auto) {
        setFeishuCliMessage('等待你在飞书账号授权页确认授权...');
      } else {
        setFeishuCliMessage('网络错误，请稍后重试。');
      }
    } finally {
      feishuCliAutoRequestRef.current = false;
      if (!options.auto) setFeishuCliCompleting(false);
    }
  };

  const refreshSummary = async (provider: ProviderKey) => {
    setLoadingProvider(provider);
    setError(null);
    try {
      const res =
        isCompetitiveDataSource(provider)
          ? await fetch(`/api/investor/competitive-data-source/${provider}`)
          : isPersonalAccountProvider(provider)
          ? await fetch(`/api/investor/personal-data/accounts?provider=${provider}`)
          : provider === 'xiaohongshu'
          ? await fetch('/api/investor/xiaohongshu/assistant')
          : await fetch(`/api/investor/integrations/summary/${provider}`, {
              method: 'POST',
            });
      const data = await res.json();
      if (!res.ok) {
        const detail = data.error || '刷新摘要失败';
        setError(detail);
        if (isPersonalAccountProvider(provider)) {
          setPersonalAccountsChecked((prev) => ({ ...prev, [provider]: true }));
          setPersonalAccountsError((prev) => ({
            ...prev,
            [provider]: String(detail),
          }));
        }
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
                    : isPersonalAccountProvider(provider)
                      ? Array.isArray(data.accounts) && data.accounts.length > 0
                    : provider === 'xiaohongshu'
                      ? Boolean(data.integration?.connected)
                      : true,
                accountEmail: provider === 'xiaohongshu' || isPersonalAccountProvider(provider) || isCompetitiveDataSource(provider) ? null : data.integration.accountEmail || null,
                accountName:
                  isCompetitiveDataSource(provider)
                    ? `${providerLabel(provider)} 员工`
                    : isPersonalAccountProvider(provider)
                    ? (Array.isArray(data.accounts) && data.accounts.length > 0 ? `${data.accounts.length} 个 ${providerLabel(provider)} 账号` : null)
                    : provider === 'xiaohongshu'
                    ? (data.integration?.connected ? '小红书助手' : null)
                    : data.integration.accountName || null,
                updatedAt:
                  isCompetitiveDataSource(provider)
                    ? data.integration?.updatedAt || card.updatedAt
                    : isPersonalAccountProvider(provider)
                      ? card.updatedAt
                    : provider === 'xiaohongshu'
                      ? data.thread?.messages?.length
                        ? new Date().toISOString()
                        : card.updatedAt
                      : data.integration.updatedAt || null,
                latestSummary:
                  isCompetitiveDataSource(provider)
                    ? card.latestSummary
                    : isPersonalAccountProvider(provider)
                    ? `${providerLabel(provider)} 多账号绑定状态已刷新。`
                    : provider === 'xiaohongshu'
                    ? data.thread?.messages?.length
                      ? String(data.thread.messages[data.thread.messages.length - 1]?.content || card.latestSummary || '')
                      : card.latestSummary
                    : data.latestSummary || null,
                latestSummaryAt:
                  isPersonalAccountProvider(provider)
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
      if (isPersonalAccountProvider(provider) && Array.isArray(data.accounts)) {
        setPersonalAccountsChecked((prev) => ({ ...prev, [provider]: true }));
        setPersonalAccountsError((prev) => ({ ...prev, [provider]: '' }));
        if (provider === 'gmail') setGmailAccounts(data.accounts as PersonalAccount[]);
        if (provider === 'feishu') {
          const accounts = data.accounts as PersonalAccount[];
          setFeishuAccounts(accounts);
          setFeishuPackageDrafts((prev) => {
            const next = { ...prev };
            for (const account of accounts) {
              next[account.connectionId] = normalizeFeishuFeaturePackages(account.featurePackages, DEFAULT_FEISHU_FEATURE_PACKAGES);
            }
            return next;
          });
        }
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

  const feishuCliMessageIsError =
    feishuCliMessage.includes('失败') ||
    feishuCliMessage.includes('错误') ||
    feishuCliMessage.includes('过期') ||
    feishuCliMessage.includes('超时') ||
    feishuCliMessage.includes('不存在');

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
        <p className={`mt-4 text-sm ${integrationStatus === 'connected' || integrationStatus === 'pending' ? 'text-emerald-700' : 'text-red-600'}`}>
          {banner}
        </p>
      )}
      {integrationProvider === 'feishu' && integrationStatus === 'pending' && (feishuCliSetupUrl || feishuCliAuthUrl) ? (
        <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-slate-700">
          <p className="font-medium text-sky-950">飞书增强授权</p>
          <div className="mt-2 space-y-3">
            <div className="rounded-md border border-sky-100 bg-white px-3 py-2">
              <p className="text-xs font-semibold text-slate-900">第 1 步：配置你自己的飞书 CLI 应用</p>
              <p className="mt-1 text-xs text-slate-600">
                打开后按飞书页面完成应用创建/配置；本页会自动检测，完成后同一个弹窗会进入账号授权。
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {feishuCliSetupUrl && (
                  <button
                    type="button"
                    onClick={openFeishuSetupAndPoll}
                    disabled={feishuCliCompleting || feishuCliPhase === 'user_auth' || feishuCliPhase === 'connected'}
                    className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                  >
                    打开应用配置并自动继续
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void continueFeishuCliSetup()}
                  disabled={feishuCliCompleting || feishuCliPhase === 'user_auth' || feishuCliPhase === 'connected'}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {feishuCliCompleting && feishuCliPhase !== 'user_auth' ? '检查中...' : '手动检查状态'}
                </button>
              </div>
            </div>

            {(feishuCliPhase === 'user_auth' || feishuCliAuthUrl) && (
              <div className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <p className="text-xs font-semibold text-slate-900">第 2 步：授权你的飞书账号</p>
                <p className="mt-1 text-xs text-slate-600">
                  账号授权页会自动打开；确认授权后本页会自动完成绑定。如果弹窗被拦截，可以手动重新打开。
                  {feishuCliUserCode ? ` 页面提示时输入验证码：${feishuCliUserCode}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {feishuCliAuthUrl && (
                    <a
                      href={feishuCliAuthUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                    >
                      重新打开账号授权
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void completeFeishuCliBinding()}
                    disabled={feishuCliCompleting}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {feishuCliCompleting ? '绑定中...' : '手动完成绑定'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {feishuCliMessage && (
            <p className={`mt-2 ${feishuCliMessageIsError ? 'text-red-600' : 'text-emerald-700'}`}>
              {feishuCliMessage}
            </p>
          )}
        </div>
      ) : null}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="grid md:grid-cols-2 gap-4 mt-5">
        {cards.map((card) => {
          const personalChecking = isPersonalAccountProvider(card.provider) && !personalAccountsCheckedFor(card.provider);
          const personalLoadError = isPersonalAccountProvider(card.provider) ? personalAccountsErrorFor(card.provider) : '';
          const displayConnected = !personalChecking && !personalLoadError && card.connected;
          return (
          <div key={card.provider} className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">{providerLabel(card.provider)}</h3>
              <span
                className={`px-2 py-1 text-xs rounded-full ${
                  personalChecking
                    ? 'bg-slate-100 text-slate-700'
                    : personalLoadError
                      ? 'bg-red-100 text-red-700'
                      : displayConnected
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                }`}
              >
          {personalChecking
            ? '检查中'
            : personalLoadError
              ? '检查失败'
              : displayConnected
                ? (card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider) ? '已启用' : '已绑定')
                : (card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider) ? '未启用' : '未绑定')}
                </span>
              </div>

            <p className="text-sm text-slate-600 mt-2">
              {personalChecking
                ? `正在检查 ${providerLabel(card.provider)} 授权状态...`
                : personalLoadError
                  ? `${providerLabel(card.provider)} 授权状态检查失败，请刷新状态。`
                  : isCompetitiveDataSource(card.provider)
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
            {card.provider === 'feishu' && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-medium text-slate-700">绑定新飞书账号时启用的功能包</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {FEISHU_FEATURE_PACKAGES.map((item) => (
                    <label key={item.key} className="flex items-start gap-2 rounded-md border border-slate-200 px-2 py-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={feishuBindPackages.includes(item.key)}
                        onChange={() => setFeishuBindPackages((prev) => togglePackage(prev, item.key))}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block font-medium text-slate-900">{item.label}</span>
                        <span className="block text-slate-500">{item.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  绑定后也可以在账号下调整；新增功能包需要重新授权，取消功能包会立即停止向 Codex 暴露对应工具。
                </p>
              </div>
            )}
            {isPersonalAccountProvider(card.provider) && (
              <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-sky-900">已授权 {providerLabel(card.provider)} 账号</p>
                  {personalAccountsLoadingFor(card.provider) && <span className="text-xs text-sky-700">加载中...</span>}
                </div>
                {personalChecking ? (
                  <p className="mt-2 text-sm text-slate-600">
                    正在加载 {providerLabel(card.provider)} 授权状态...
                  </p>
                ) : personalLoadError ? (
                  <p className="mt-2 text-sm text-red-600">
                    {personalLoadError}
                  </p>
                ) : personalAccountsFor(card.provider).length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {card.provider === 'gmail'
                      ? '暂无 Gmail 授权。绑定后主 AI 助手会按需调用 Gmail 搜索、读取邮件和线程工具。'
                      : '暂无飞书授权。绑定后主 AI 助手会按需调用飞书消息搜索、联系人、日历和文档搜索工具。'}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {personalAccountsFor(card.provider).map((account) => {
                      const currentPackages = normalizeFeishuFeaturePackages(account.featurePackages, DEFAULT_FEISHU_FEATURE_PACKAGES);
                      const draftPackages = normalizeFeishuFeaturePackages(
                        feishuPackageDrafts[account.connectionId],
                        currentPackages
                      );
                      const packageChanged = !sameFeaturePackages(currentPackages, draftPackages);
                      const packageAdded = hasAddedFeaturePackages(currentPackages, draftPackages);
                      return (
                        <div key={account.connectionId} className="rounded-md bg-white px-3 py-2 border border-sky-100">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">{account.displayName || account.accountEmail}</p>
                              {account.displayName !== account.accountEmail && (
                                <p className="truncate text-xs text-slate-500">{account.accountEmail}</p>
                              )}
                              <p className="text-xs text-slate-500">
                                {account.status === 'connected' ? '已绑定' : account.status}
                                {card.provider === 'feishu' && account.connectionType === 'lark_cli_user' ? ' · CLI增强' : ''}
                                {' · '}
                                {new Date(account.updatedAt).toLocaleString('zh-CN')}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={loadingProvider === card.provider}
                              onClick={() => void disconnectPersonalAccount(card.provider, account.connectionId)}
                              className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            >
                              解绑
                            </button>
                          </div>

                          {card.provider === 'feishu' && (
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <p className="text-xs font-medium text-slate-700">该账号启用的功能包</p>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {FEISHU_FEATURE_PACKAGES.map((item) => (
                                  <label key={item.key} className="flex items-start gap-2 rounded-md border border-slate-200 px-2 py-2 text-xs text-slate-700">
                                    <input
                                      type="checkbox"
                                      checked={draftPackages.includes(item.key)}
                                      onChange={() =>
                                        setFeishuPackageDrafts((prev) => ({
                                          ...prev,
                                          [account.connectionId]: togglePackage(draftPackages, item.key),
                                        }))
                                      }
                                      className="mt-0.5"
                                    />
                                    <span>
                                      <span className="block font-medium text-slate-900">{item.label}</span>
                                      <span className="block text-slate-500">{item.description}</span>
                                    </span>
                                  </label>
                                ))}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={!packageChanged || Boolean(feishuPackageSaving[account.connectionId])}
                                  onClick={() => void saveFeishuFeaturePackages(account)}
                                  className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50"
                                >
                                  {feishuPackageSaving[account.connectionId]
                                    ? '保存中...'
                                    : packageAdded
                                      ? '重新授权新增功能包'
                                      : '保存功能包'}
                                </button>
                                {packageAdded && (
                                  <span className="text-xs text-amber-700">新增功能包需要重新授权同一个飞书账号。</span>
                                )}
                              </div>
                              {feishuPackageMessages[account.connectionId] && (
                                <p className={`mt-2 text-xs ${feishuPackageMessages[account.connectionId].includes('失败') || feishuPackageMessages[account.connectionId].includes('错误') ? 'text-red-600' : 'text-emerald-700'}`}>
                                  {feishuPackageMessages[account.connectionId]}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={personalChecking}
                onClick={() => void connect(card.provider)}
                className="bg-sky-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                {personalChecking
                  ? '检查中...'
                  : card.provider === 'xiaohongshu'
                  ? displayConnected
                    ? '已启用小红书助手'
                    : '启用小红书助手'
                  : isCompetitiveDataSource(card.provider)
                    ? displayConnected
                      ? `停用 ${providerLabel(card.provider)}`
                      : `启用 ${providerLabel(card.provider)}`
                  : displayConnected
                    ? isPersonalAccountProvider(card.provider)
                      ? `绑定更多 ${providerLabel(card.provider)}`
                      : '重新绑定'
                    : `绑定${providerLabel(card.provider)}`}
              </button>
              <button
                type="button"
                disabled={loadingProvider === card.provider || personalChecking}
                onClick={() => refreshSummary(card.provider)}
                className="bg-white text-slate-800 px-3 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
              >
                {loadingProvider === card.provider
                  ? '刷新中...'
                  : isPersonalAccountProvider(card.provider) || card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider)
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
                    : card.provider === 'feishu'
                    ? '飞书账号会作为主 AI 助手的 lark-cli 增强工具使用；用户提问需要飞书消息、联系人、日历或文档信息时，Codex 会按需调用已授权账号。'
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

            {!isCompetitiveDataSource(card.provider) && !isPersonalAccountProvider(card.provider) && (
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

            {!isCompetitiveDataSource(card.provider) && !isPersonalAccountProvider(card.provider) && (
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
          );
        })}
      </div>
    </div>
  );
}
