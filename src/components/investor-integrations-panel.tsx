'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebugCollapsible } from '@/components/debug-collapsible';
import { MarkdownMessage } from '@/components/markdown-message';

type ProviderKey =
  | 'gmail'
  | 'feishu'
  | 'meta'
  | 'xiaohongshu'
  | 'similarweb_api1'
  | 'semrush13'
  | 'semrush8'
  | 'domain_metrics_check';

type PersonalProviderKey = 'gmail' | 'feishu' | 'meta';

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
  metadata?: {
    pageCount?: number;
    instagramAccountCount?: number;
    pages?: Array<Record<string, unknown>>;
    instagramAccounts?: Array<Record<string, unknown>>;
  };
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
  { key: 'messages', label: 'content', description: 'IM content, content/content' },
  { key: 'contacts', label: 'content', description: 'content, content' },
  { key: 'calendar', label: 'content', description: 'contentToday/content' },
  { key: 'docs', label: 'content', description: 'content, content' },
  { key: 'meetings', label: 'content', description: 'content/content/content, toolcontent' },
] as const satisfies readonly { key: FeishuFeaturePackage; label: string; description: string }[];

const DEFAULT_FEISHU_FEATURE_PACKAGES: FeishuFeaturePackage[] = ['messages', 'contacts', 'calendar', 'docs'];

const providerLabels: Record<ProviderKey, string> = {
  gmail: 'Gmail',
  feishu: 'content',
  meta: 'Instagram / Facebook',
  xiaohongshu: 'content',
  similarweb_api1: 'Similarweb API1',
  semrush13: 'Semrush13',
  semrush8: 'Semrush8',
  domain_metrics_check: 'Domain Metrics Check',
};

function providerLabel(provider: ProviderKey) {
  return providerLabels[provider];
}

const competitiveDataSourceDescriptions: Record<(typeof COMPETITIVE_DATA_SOURCE_PROVIDERS)[number], string> = {
  similarweb_api1: 'content Similarweb content, content, content, content, content, content.',
  semrush13: 'content, content, content, content, content, content, content.',
  semrush8: 'content SEO URL traffic content, content, content, content.',
  domain_metrics_check: 'content Moz, Majestic, Ahrefs content, content DA, DR, content.',
};

const competitiveDataSourceScopes: Record<(typeof COMPETITIVE_DATA_SOURCE_PROVIDERS)[number], string> = {
  similarweb_api1: 'content, content, content, content, content, content, content/content.content.',
  semrush13: 'content, content, content, content, content, content, AI traffic, content.content URL content.',
  semrush8: 'Semrush-like rank, content, content, content, content.content, content.',
  domain_metrics_check: 'DA/PA, Spam Score, Trust Flow, Citation Flow, DR, content, content, content.',
};

const recordForProviders = <T,>(value: T): Record<ProviderKey, T> => ({
  gmail: value,
  feishu: value,
  meta: value,
  xiaohongshu: value,
  similarweb_api1: value,
  semrush13: value,
  semrush8: value,
  domain_metrics_check: value,
});

function isCompetitiveDataSource(provider: ProviderKey): provider is (typeof COMPETITIVE_DATA_SOURCE_PROVIDERS)[number] {
  return COMPETITIVE_DATA_SOURCE_SET.has(provider);
}

function isPersonalAccountProvider(provider: ProviderKey): provider is PersonalProviderKey {
  return provider === 'gmail' || provider === 'feishu' || provider === 'meta';
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

function openFeishuAuthPlaceholder(message = 'contentaccountscontent...', options: { disownOpener?: boolean } = {}) {
  if (typeof window === 'undefined') return null;
  const popup = window.open('', '_blank');
  if (!popup) return null;
  try {
    if (options.disownOpener) popup.opener = null;
    popup.document.title = 'contentaccountscontent';
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
      popup.focus();
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
    meta: [],
    xiaohongshu: [],
    similarweb_api1: [],
    semrush13: [],
    semrush8: [],
    domain_metrics_check: [],
  });
  const [assistantThreadIds, setAssistantThreadIds] = useState<Record<ProviderKey, string | null>>({
    gmail: null,
    feishu: null,
    meta: null,
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
  const [metaAccounts, setMetaAccounts] = useState<PersonalAccount[]>([]);
  const [metaAccountsLoading, setMetaAccountsLoading] = useState(false);
  const [personalAccountsChecked, setPersonalAccountsChecked] = useState<Record<PersonalProviderKey, boolean>>({
    gmail: false,
    feishu: false,
    meta: false,
  });
  const [personalAccountsError, setPersonalAccountsError] = useState<Record<PersonalProviderKey, string>>({
    gmail: '',
    feishu: '',
    meta: '',
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
    const providerLabel = providerLabels[integrationProvider as ProviderKey] || 'content';
    if (integrationStatus === 'pending') {
      return `${providerLabel} contentComplete: ${integrationDetail || 'contentCompletecontent.'}`;
    }
    if (integrationStatus === 'connected') {
      return `${providerLabel} connected successfully`;
    }
    return `${providerLabel} connection failed: ${integrationDetail || 'Unknown error'}`;
  }, [integrationDetail, integrationProvider, integrationStatus]);

  const assistantEndpoint = (provider: ProviderKey) =>
    provider === 'xiaohongshu'
      ? '/api/investor/xiaohongshu/assistant'
      : `/api/investor/integrations/assistant/${provider}`;

  const loadPersonalAccounts = useCallback(async (provider: PersonalProviderKey) => {
    if (provider === 'gmail') setGmailAccountsLoading(true);
    if (provider === 'feishu') setFeishuAccountsLoading(true);
    if (provider === 'meta') setMetaAccountsLoading(true);
    setPersonalAccountsError((prev) => ({ ...prev, [provider]: '' }));
    try {
      const res = await fetch(`/api/investor/personal-data/accounts?provider=${provider}`);
      const data = await res.json();
      if (!res.ok) {
        setPersonalAccountsError((prev) => ({
          ...prev,
          [provider]: data.error || `${providerLabel(provider)} authorization status check failed.`,
        }));
        return;
      }
      const accounts = Array.isArray(data.accounts) ? data.accounts as PersonalAccount[] : [];
      if (provider === 'gmail') setGmailAccounts(accounts);
      if (provider === 'meta') setMetaAccounts(accounts);
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
                  ? `${accounts.length} ${providerLabel(provider)} accounts`
                  : accounts[0]?.displayName || (provider === 'gmail' ? accounts[0]?.accountEmail : null) || null,
                updatedAt: accounts[0]?.updatedAt || card.updatedAt,
              }
            : card
        )
      );
    } catch {
      setPersonalAccountsError((prev) => ({
        ...prev,
        [provider]: `${providerLabel(provider)} authorization status check failed.`,
      }));
    } finally {
      setPersonalAccountsChecked((prev) => ({ ...prev, [provider]: true }));
      if (provider === 'gmail') setGmailAccountsLoading(false);
      if (provider === 'feishu') setFeishuAccountsLoading(false);
      if (provider === 'meta') setMetaAccountsLoading(false);
    }
  }, []);

  const personalAccountsFor = (provider: ProviderKey) => (
    provider === 'gmail' ? gmailAccounts : provider === 'feishu' ? feishuAccounts : provider === 'meta' ? metaAccounts : []
  );

  const personalAccountsLoadingFor = (provider: ProviderKey) => (
    provider === 'gmail' ? gmailAccountsLoading : provider === 'feishu' ? feishuAccountsLoading : provider === 'meta' ? metaAccountsLoading : false
  );

  const personalAccountsCheckedFor = (provider: ProviderKey) => (
    provider === 'gmail' ? personalAccountsChecked.gmail : provider === 'feishu' ? personalAccountsChecked.feishu : provider === 'meta' ? personalAccountsChecked.meta : true
  );

  const personalAccountsErrorFor = (provider: ProviderKey) => (
    provider === 'gmail' ? personalAccountsError.gmail : provider === 'feishu' ? personalAccountsError.feishu : provider === 'meta' ? personalAccountsError.meta : ''
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
    void loadPersonalAccounts('meta');
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
          setError(data.error || `Update ${providerLabel(provider)} teammatecontentfailed`);
          return;
        }
        setCards((prev) =>
          prev.map((card) =>
            card.provider === provider
              ? {
                  ...card,
                  connected: Boolean(data.integration?.connected),
                  accountName: data.integration?.accountName || `${providerLabel(provider)} teammate`,
                  updatedAt: data.integration?.updatedAt || new Date().toISOString(),
                  platformConfigured: Boolean(data.integration?.platformConfigured),
                }
              : card
          )
        );
      } catch {
        setError('Network error. Please try again later.');
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
          setError(data.error || 'contentXiaohongshu Assistantfailed');
          return;
        }
        setCards((prev) =>
          prev.map((card) =>
            card.provider === 'xiaohongshu'
              ? {
                  ...card,
                  connected: true,
                  accountName: data.integration?.provider || 'Xiaohongshu Assistant',
                  updatedAt: data.integration?.updatedAt || new Date().toISOString(),
                }
              : card
          )
        );
      } catch {
        setError('Network error. Please try again later.');
      } finally {
        setLoadingProvider(null);
      }
      return;
    }
    if (isPersonalAccountProvider(provider)) {
      if (provider === 'feishu' && feishuBindPackages.length === 0) {
        setError('Select at least one Lark capability package before connecting.');
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
        setError(data.error || `Disconnect ${providerLabel(provider)} failed`);
        return;
      }
      await loadPersonalAccounts(provider);
    } catch {
      setError('Network error. Please try again later.');
      if (isPersonalAccountProvider(provider)) {
        setPersonalAccountsChecked((prev) => ({ ...prev, [provider]: true }));
        setPersonalAccountsError((prev) => ({
          ...prev,
          [provider]: `${providerLabel(provider)} authorization status check failed.`,
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
      setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: 'Capability packages did not change.' }));
      return;
    }

    if (hasAddedFeaturePackages(current, next)) {
      setFeishuPackageMessages((prev) => ({
        ...prev,
        [account.connectionId]: 'content, contentaccounts.',
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
        setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: data.error || 'Save packagesfailed.' }));
        return;
      }
      setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: 'contentSave, Codex contentCall toolcontent.' }));
      await loadPersonalAccounts('feishu');
    } catch {
      setFeishuPackageMessages((prev) => ({ ...prev, [account.connectionId]: 'Network error. Please try again later..' }));
    } finally {
      setFeishuPackageSaving((prev) => ({ ...prev, [account.connectionId]: false }));
    }
  };

  const openFeishuSetupAndPoll = () => {
    if (!feishuCliSetupUrl) {
      setFeishuCliMessage('The Lark CLI app setup link is missing. Reconnect.');
      return;
    }
    clearFeishuCliPoll();
    const setupPopup = openFeishuAuthPlaceholder('Opening Lark CLI app setup...', { disownOpener: true });
    const authPopup = openFeishuAuthPlaceholder('contentComplete, contentaccountscontent...');
    if (!setupPopup) {
      closePreparedPopup(authPopup);
      setFeishuCliMessage('The browser blocked the popup. Allow popups and try again, or open the app setup link manually.');
      return;
    }
    try {
      setupPopup.location.href = feishuCliSetupUrl;
    } catch {
      setFeishuCliMessage('content CLI contentfailed, content.');
      return;
    }
    if (authPopup) {
      try {
        authPopup.blur();
        setupPopup.focus();
      } catch {
        // Focus behavior is browser-controlled.
      }
    }
    feishuCliPopupRef.current = authPopup;
    setFeishuCliPhase('app_setup');
    setFeishuCliMessage(
      authPopup
        ? 'content CLI content, accountscontent.Completecontentaccountscontent.'
        : 'content CLI content; contentaccountscontent, Completecontent.'
    );
    startFeishuCliSetupPolling(authPopup);
  };

  const startFeishuCliSetupPolling = (popup: Window | null) => {
    clearFeishuCliPoll();
    let attempts = 0;
    feishuCliPollRef.current = window.setInterval(() => {
      attempts += 1;
      if (attempts > 120) {
        clearFeishuCliPoll();
        setFeishuCliMessage('Lark CLI app setup timed out. Check status manually or restart connection.');
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
        setFeishuCliMessage('contentaccountscontent.contentCompletecontent, contentComplete binding manually.');
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
          setFeishuCliMessage(data.error || 'Lark CLI app setup is not complete yet. Complete it before continuing.');
        }
        return;
      }
      if (data.phase === 'connected' || data.account) {
        clearFeishuCliPoll();
        closePreparedPopup(authPopup);
        feishuCliPopupRef.current = null;
        setFeishuCliPhase('connected');
        setFeishuCliMessage('contentconnected successfully, content lark-cli content.');
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
            ? 'content CLI contentComplete, contentaccountscontent.contentCompleteConnect.'
            : 'content CLI contentComplete, contentaccountscontent.'
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
        setFeishuCliMessage('Still waiting for Lark CLI app setup to complete. Finish setup and try again.');
      }
    } catch {
      if (!options.auto) {
        closePreparedPopup(authPopup);
        setFeishuCliMessage('Network error. Please try again later..');
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
          setFeishuCliMessage('contentaccountscontent...');
        } else {
          setFeishuCliMessage(data.error || 'contentConnectCompletefailed, contentCompletecontent.');
        }
        return;
      }
      clearFeishuCliPoll();
      closePreparedPopup(options.popup || feishuCliPopupRef.current);
      feishuCliPopupRef.current = null;
      setFeishuCliPhase('connected');
      setFeishuCliMessage('contentconnected successfully, content lark-cli content.');
      await loadPersonalAccounts('feishu');
    } catch {
      if (options.auto) {
        setFeishuCliMessage('contentaccountscontent...');
      } else {
        setFeishuCliMessage('Network error. Please try again later..');
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
        const detail = data.error || 'Refresh summaryfailed';
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
                    ? `${providerLabel(provider)} teammate`
                    : isPersonalAccountProvider(provider)
                    ? (Array.isArray(data.accounts) && data.accounts.length > 0 ? `${data.accounts.length} ${providerLabel(provider)} accounts` : null)
                    : provider === 'xiaohongshu'
                    ? (data.integration?.connected ? 'Xiaohongshu Assistant' : null)
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
                    ? `${providerLabel(provider)} contentaccountsConnectcontent.`
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
        if (provider === 'meta') setMetaAccounts(data.accounts as PersonalAccount[]);
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
      setError('Network error. Please try again later.');
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
        const content = data.error || 'The AI assistant is temporarily unavailable. Please try again later.';
        setAssistantChats((prev) => ({
          ...prev,
          [provider]: [...nextMessages, { role: 'assistant', content }],
        }));
        return;
      }

      setAssistantChats((prev) => ({
        ...prev,
        [provider]: [...nextMessages, { role: 'assistant', content: data.reply || 'Received, but no reply is available yet.' }],
      }));
      if (data.threadId) {
        setAssistantThreadIds((prev) => ({ ...prev, [provider]: String(data.threadId) }));
      }
    } catch {
      setAssistantChats((prev) => ({
        ...prev,
        [provider]: [...nextMessages, { role: 'assistant', content: 'Network error. Please try again later..' }],
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
        setError(data.error || 'Failed to load coaching settings');
        return;
      }

      const prompt = String(data.customPrompt || data.integration?.customPrompt || '');
      setCoachDraft((prev) => ({ ...prev, [provider]: prompt }));
      setCoachSaved((prev) => ({ ...prev, [provider]: prompt }));
      setCoachLoaded((prev) => ({ ...prev, [provider]: true }));
    } catch {
      setError('Network error. Please try again later.');
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
        setError(data.error || 'SavecontentSettingsfailed');
        return;
      }

      const prompt = String(data.integration?.customPrompt || data.customPrompt || '');
      setCoachDraft((prev) => ({ ...prev, [provider]: prompt }));
      setCoachSaved((prev) => ({ ...prev, [provider]: prompt }));
      setCoachMessage((prev) => ({ ...prev, [provider]: 'Saved. Future conversations will use these settings.' }));
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setCoachSaving((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const feishuCliMessageIsError =
    feishuCliMessage.includes('failed') ||
    feishuCliMessage.includes('Error') ||
    feishuCliMessage.includes('content') ||
    feishuCliMessage.includes('content') ||
    feishuCliMessage.includes('content');

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">External Message Assistants</h2>
          <p className="text-sm text-slate-600 mt-1">
            contentConnect Gmail / content / Instagram / Facebook accounts, contenttool.
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
          <p className="font-medium text-sky-950">Enhanced Lark Authorization</p>
          <div className="mt-2 space-y-3">
            <div className="rounded-md border border-sky-100 bg-white px-3 py-2">
              <p className="text-xs font-semibold text-slate-900">Step 1: Configure your Lark CLI app</p>
              <p className="mt-1 text-xs text-slate-600">
                contentCompletecontent/content; content, contentaccountscontent.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {feishuCliSetupUrl && (
                  <button
                    type="button"
                    onClick={openFeishuSetupAndPoll}
                    disabled={feishuCliCompleting || feishuCliPhase === 'user_auth' || feishuCliPhase === 'connected'}
                    className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                  >
                    Open app setup and continue automatically
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void continueFeishuCliSetup()}
                  disabled={feishuCliCompleting || feishuCliPhase === 'user_auth' || feishuCliPhase === 'connected'}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {feishuCliCompleting && feishuCliPhase !== 'user_auth' ? 'Checking...' : 'Check status manually'}
                </button>
              </div>
            </div>

            {(feishuCliPhase === 'user_auth' || feishuCliAuthUrl) && (
              <div className="rounded-md border border-sky-100 bg-white px-3 py-2">
                <p className="text-xs font-semibold text-slate-900">content 2 content: contentaccounts</p>
                <p className="mt-1 text-xs text-slate-600">
                  accountscontent; contentCompleteConnect.content, content.
                  {feishuCliUserCode ? ` Enter this verification code when prompted: ${feishuCliUserCode}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {feishuCliAuthUrl && (
                    <a
                      href={feishuCliAuthUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                    >
                      contentaccountscontent
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void completeFeishuCliBinding()}
                    disabled={feishuCliCompleting}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {feishuCliCompleting ? 'Connecting...' : 'Complete binding manually'}
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
            ? 'Checking'
            : personalLoadError
              ? 'contentfailed'
              : displayConnected
                ? (card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider) ? 'Enabled' : 'Connected')
                : (card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider) ? 'Not enabled' : 'Not connected')}
                </span>
              </div>

            <p className="text-sm text-slate-600 mt-2">
              {personalChecking
                ? `Checking ${providerLabel(card.provider)} authorization status...`
                : personalLoadError
                  ? `${providerLabel(card.provider)} authorization status check failed, contentRefresh status.`
                  : isCompetitiveDataSource(card.provider)
                ? competitiveDataSourceDescriptions[card.provider]
                : card.accountEmail || card.accountName || 'contentNot connectedaccounts'}
            </p>
            {isCompetitiveDataSource(card.provider) && (
              <p className="mt-2 text-xs text-slate-500">
                Platform-managed RapidAPI data source. Actual calls depend on backend Personal Agent environment variables and provider quota.
              </p>
            )}
            {card.updatedAt && (
              <p className="text-xs text-slate-500 mt-1">
                Last synced: {new Date(card.updatedAt).toLocaleString('en-US')}
              </p>
            )}
            {card.provider === 'feishu' && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-medium text-slate-700">Connectcontentaccountscontent</p>
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
                  Connectcontentaccountscontent; content, contentStopcontent Codex contenttool.
                </p>
              </div>
            )}
            {isPersonalAccountProvider(card.provider) && (
              <div className="mt-3 rounded-lg border border-sky-100 bg-sky-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-sky-900">Authorized {providerLabel(card.provider)} accounts</p>
                  {personalAccountsLoadingFor(card.provider) && <span className="text-xs text-sky-700">Loading...</span>}
                </div>
                {personalChecking ? (
                  <p className="mt-2 text-sm text-slate-600">
                    Loading {providerLabel(card.provider)} authorization status...
                  </p>
                ) : personalLoadError ? (
                  <p className="mt-2 text-sm text-red-600">
                    {personalLoadError}
                  </p>
                ) : personalAccountsFor(card.provider).length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">
                    {card.provider === 'gmail'
                      ? 'content Gmail content.Connectcontent AI content Gmail content, contenttool.'
                      : card.provider === 'feishu'
                        ? 'content.Connectcontent AI content, content, contenttool.'
                        : 'content Instagram / Facebook content.Connectcontent AI content Page, content Instagram contentaccounts, content Page content.'}
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
                                {account.status === 'connected' ? 'Connected' : account.status}
                                {card.provider === 'feishu' && account.connectionType === 'lark_cli_user' ? ' · CLI enhanced' : ''}
                                {' · '}
                                {new Date(account.updatedAt).toLocaleString('en-US')}
                              </p>
                              {card.provider === 'meta' && account.metadata && (
                                <p className="mt-1 text-xs text-slate-500">
                                  Page {account.metadata.pageCount || 0} · Instagram contentaccounts {account.metadata.instagramAccountCount || 0} content
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={loadingProvider === card.provider}
                              onClick={() => void disconnectPersonalAccount(card.provider, account.connectionId)}
                              className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                            >
                              Disconnect
                            </button>
                          </div>

                          {card.provider === 'feishu' && (
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <p className="text-xs font-medium text-slate-700">contentaccountscontent</p>
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
                                    ? 'Saving...'
                                    : packageAdded
                                      ? 'Reauthorize new packages'
                                      : 'Save packages'}
                                </button>
                                {packageAdded && (
                                  <span className="text-xs text-amber-700">contentaccounts.</span>
                                )}
                              </div>
                              {feishuPackageMessages[account.connectionId] && (
                                <p className={`mt-2 text-xs ${feishuPackageMessages[account.connectionId].includes('failed') || feishuPackageMessages[account.connectionId].includes('Error') ? 'text-red-600' : 'text-emerald-700'}`}>
                                  {feishuPackageMessages[account.connectionId]}
                                </p>
                              )}
                            </div>
                          )}

                          {card.provider === 'meta' && account.metadata && (
                            <div className="mt-3 border-t border-slate-100 pt-3">
                              <p className="text-xs font-medium text-slate-700">Authorized assets</p>
                              <div className="mt-2 grid gap-2">
                                {(account.metadata.instagramAccounts || []).slice(0, 5).map((item, index) => (
                                  <div key={`ig-${account.connectionId}-${index}`} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                                    Instagram: {String(item.username || item.name || item.id || 'contentaccounts')}
                                    {item.pageName ? ` · Page: ${String(item.pageName)}` : ''}
                                  </div>
                                ))}
                                {(account.metadata.pages || []).slice(0, 5).map((item, index) => (
                                  <div key={`page-${account.connectionId}-${index}`} className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
                                    Facebook Page: {String(item.name || item.id || 'Unnamed Page')}
                                    {item.category ? ` · ${String(item.category)}` : ''}
                                  </div>
                                ))}
                                {(account.metadata.instagramAccounts || []).length === 0 && (account.metadata.pages || []).length === 0 && (
                                  <p className="text-xs text-slate-500">
                                    content Page content Instagram contentaccounts.content Facebook accountscontent Page, content Page content Instagram Business/Creator accounts.
                                  </p>
                                )}
                              </div>
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
                  ? 'Checking...'
                  : card.provider === 'xiaohongshu'
                  ? displayConnected
                    ? 'EnabledXiaohongshu Assistant'
                    : 'contentXiaohongshu Assistant'
                  : isCompetitiveDataSource(card.provider)
                    ? displayConnected
                      ? `Disable ${providerLabel(card.provider)}`
                      : `Enable ${providerLabel(card.provider)}`
                  : displayConnected
                    ? isPersonalAccountProvider(card.provider)
                      ? `Connect more ${providerLabel(card.provider)}`
                      : 'Reconnect'
                    : `Connect${providerLabel(card.provider)}`}
              </button>
              <button
                type="button"
                disabled={loadingProvider === card.provider || personalChecking}
                onClick={() => refreshSummary(card.provider)}
                className="bg-white text-slate-800 px-3 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-100 disabled:opacity-50"
              >
                {loadingProvider === card.provider
                  ? 'Refreshing...'
                  : isPersonalAccountProvider(card.provider) || card.provider === 'xiaohongshu' || isCompetitiveDataSource(card.provider)
                    ? 'Refresh status'
                    : 'Refresh summary'}
              </button>
            </div>

            <div className="mt-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500 mb-1">{isCompetitiveDataSource(card.provider) ? 'Call scope' : 'Latest summary'}</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">
                {card.latestSummary ||
                  (isCompetitiveDataSource(card.provider)
                    ? competitiveDataSourceScopes[card.provider]
                    : card.provider === 'gmail'
                    ? 'Gmail accountscontent AI contenttoolcontent; content, Codex contentaccounts.'
                    : card.provider === 'feishu'
                    ? 'contentaccountscontent AI content lark-cli contenttoolcontent; content, content, content, Codex contentaccounts.'
                    : card.provider === 'meta'
                    ? 'Instagram / Facebook accountscontent AI content Meta Graph toolcontent; contentaccounts, content, Page content, Codex contentAuthorized assets.'
                    : card.provider === 'xiaohongshu'
                    ? 'No summary yet. You can trigger skill retrieval directly in chat.'
                    : 'content, Connectcontent"Refresh summary"content.')}
              </p>
              {card.latestSummaryAt && (
                <p className="text-xs text-slate-500 mt-2">
                  Generated at: {new Date(card.latestSummaryAt).toLocaleString('en-US')}
                </p>
              )}
            </div>

            {!isCompetitiveDataSource(card.provider) && !isPersonalAccountProvider(card.provider) && (
            <div className="mt-3 border border-slate-200 rounded-lg p-3 bg-white">
              <p className="text-xs text-slate-500 mb-2">AI teammate chat</p>
              <div
                ref={(node) => {
                  assistantViewportRefs.current[card.provider] = node;
                }}
                className="max-h-44 overflow-y-auto space-y-2 pr-1"
              >
                {assistantChats[card.provider].length === 0 ? (
                  <p className="text-sm text-slate-500">
                    You can ask directly, for example: Prioritize my recent emails and give me the three things I should do today.
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
                  placeholder={card.connected ? 'Type your question...' : 'contentConnectaccountscontent'}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-100"
                />
                <button
                  type="button"
                  disabled={!card.connected || assistantLoading[card.provider] || !assistantInputs[card.provider].trim()}
                  onClick={() => void sendAssistantMessage(card.provider)}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {assistantLoading[card.provider] ? 'Thinking...' : 'Send'}
                </button>
              </div>
            </div>
            )}

            {!isCompetitiveDataSource(card.provider) && !isPersonalAccountProvider(card.provider) && (
            <div className="mt-3">
              <DebugCollapsible title="Advanced settings (AI teammate coaching)">
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => void toggleCoach(card.provider)}
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    {coachOpen[card.provider] ? 'Hide coaching editor' : 'Load coaching editor'}
                  </button>

                  {coachOpen[card.provider] && (
                    <div className="mt-2">
                      {coachLoading[card.provider] ? (
                        <p className="text-sm text-slate-500">Loading...</p>
                      ) : (
                        <>
                          <textarea
                            value={coachDraft[card.provider]}
                            onChange={(e) =>
                              setCoachDraft((prev) => ({ ...prev, [card.provider]: e.target.value }))
                            }
                            rows={6}
                            placeholder="Example: You are my execution-focused email assistant. Prioritize to-do lists, risks, and ready-to-send reply drafts. Keep the tone concise and professional."
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-xs text-slate-500">
                              Current length {coachDraft[card.provider].length}/8000
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
                                Discard changes
                              </button>
                              <button
                                type="button"
                                disabled={coachSaving[card.provider]}
                                onClick={() => void saveCoachPrompt(card.provider)}
                                className="px-3 py-1.5 text-xs rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
                              >
                                {coachSaving[card.provider] ? 'Saving...' : 'Save and apply'}
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
