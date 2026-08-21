'use client';

import { BillingCapacityPopover } from '@/components/billing-capacity-popover';
import {
  BarChart3,
  Camera,
  Check,
  Gauge,
  LoaderCircle,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  SquarePlay,
  X,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InvestorConnectorsData } from '@/lib/investor-connectors-data';
import { productBrand } from '@/lib/brand';
import {
  fetchWorkspaceJson,
  getWorkspaceCachedStale,
  setWorkspaceCached,
  WORKSPACE_CACHE_KEYS,
} from '@/lib/workspace-client-cache';

type ConnectorAccount = {
  connectionId: string;
  provider?: string;
  accountEmail: string;
  displayName: string;
  status: string;
  updatedAt: string;
};

type ConnectorItem = {
  key: string;
  type: 'app' | 'data_source';
  label: string;
  description: string;
  connected: boolean;
  accounts: ConnectorAccount[];
  platformConfigured?: boolean;
  connectHref?: string;
  manageHref?: string;
};

type ConnectorCategory = 'all' | 'communication' | 'intelligence';
type DrawerMode = 'connect' | 'manage' | 'disconnect';
type DrawerPhase = 'idle' | 'waiting' | 'done';
type FeishuPhase = 'idle' | 'app_setup' | 'setup_opened' | 'user_auth' | 'auth_opened';

type FeishuFlowState = {
  phase: FeishuPhase;
  setupUrl?: string;
  authUrl?: string;
  userCode?: string;
};

const SUPPORTED_CONNECTOR_KEYS = new Set([
  'gmail',
  'feishu',
  'instagram_looter2',
  'tiktok_api23',
  'youtube_v2',
  'similarweb_api1',
  'semrush13',
  'ahrefs_url_research',
  'domain_metrics_check',
  'appark',
]);

const categories: Array<{ key: ConnectorCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'communication', label: 'Communication' },
  { key: 'intelligence', label: 'Intelligence' },
];

const FEISHU_FEATURE_PACKAGES = [
  { key: 'messages', label: 'Messages', description: 'IM history' },
  { key: 'docs', label: 'Docs', description: 'Docs and wiki' },
  { key: 'calendar', label: 'Calendar', description: 'Events' },
  { key: 'contacts', label: 'Contacts', description: 'Directory' },
  { key: 'meetings', label: 'Meetings', description: 'Optional' },
] as const;

const DEFAULT_FEISHU_PACKAGES = ['messages', 'docs', 'calendar', 'contacts'];

const CONNECTOR_PERMISSIONS: Record<string, Array<{ title: string; description: string }>> = {
  gmail: [
    { title: 'Search inbox', description: 'Find relevant emails when a task needs them.' },
    { title: 'Read selected threads', description: 'Summarize thread contents and attachments.' },
    { title: 'Draft replies', description: 'Draft only; sending remains confirmation-gated.' },
  ],
  feishu: [
    { title: 'Messages and docs', description: 'Use selected Lark context when you ask for it.' },
    { title: 'Calendar and contacts', description: 'Read schedule and people context for relevant tasks.' },
    { title: 'Scoped feature packages', description: 'Only enabled packages are available to the agent.' },
  ],
  instagram_looter2: [
    { title: 'Official account resolution', description: 'Resolve and verify a competitor Instagram profile from its product name, domain, URL, or username.' },
    { title: 'Recent official activity', description: 'Review public posts and Reels with publication dates, links, and engagement counts.' },
    { title: 'KOC promotion candidates', description: 'Find public posts tagging the official account and surface collaboration, affiliate, and conversion signals.' },
  ],
  tiktok_api23: [
    { title: 'Account and profile lookup', description: 'Search public TikTok accounts and load a selected user profile without assuming which account is official.' },
    { title: 'Posts and pagination', description: 'Load public user posts with caller-supplied identifiers, counts, and cursors.' },
    { title: 'Search and discovery', description: 'Run caller-supplied video searches or post-discovery queries with optional exact publication filters.' },
  ],
  youtube_v2: [
    { title: 'Official channel resolution', description: 'Resolve a competitor YouTube channel from a product, domain, known channel id, or expected channel name.' },
    { title: 'Videos and Shorts', description: 'Review official public uploads with exact publication dates, links, and current view counts.' },
    { title: 'Creator promotion candidates', description: 'Discover public KOC or creator videos and surface sponsorship, affiliate, and conversion signals.' },
  ],
  similarweb_api1: [
    { title: 'Website performance', description: 'Estimate visits, engagement, bounce behavior, pages per visit, and visit duration.' },
    { title: 'Rankings and geography', description: 'Check global, country, and category rank signals plus top country distribution.' },
    { title: 'Acquisition signals', description: 'Review traffic channels, referrals, outgoing links, social sources, and similar websites.' },
  ],
  semrush13: [
    { title: 'Domain and competitor view', description: 'Estimate domain traffic, visibility, market position, and competitor relationships.' },
    { title: 'Search intelligence', description: 'Review organic and paid keyword signals, ranking opportunities, and traffic value estimates.' },
    { title: 'Backlink and geography signals', description: 'Check backlink summaries, referring-domain context, and country or device distribution when available.' },
  ],
  ahrefs_url_research: [
    { title: 'URL authority metrics', description: 'Check URL and domain authority-style SEO signals when the provider covers the target.' },
    { title: 'Backlink footprint', description: 'Review backlink counts, referring domains, and link-growth proxy signals.' },
    { title: 'Organic search signals', description: 'Use organic keyword and traffic estimates to support SEO diligence.' },
  ],
  domain_metrics_check: [
    { title: 'Authority snapshot', description: 'Check DA, PA, DR, Trust Flow, Citation Flow, and related authority signals.' },
    { title: 'Risk and quality signals', description: 'Use spam score and link-quality indicators to flag domains that need closer review.' },
    { title: 'Link footprint', description: 'Review backlink scale, referring domains, and source-diversity signals for domain diligence.' },
  ],
  appark: [
    { title: 'Mobile app search', description: 'Find matching App Store and Google Play apps by name, app id, package, publisher, and market.' },
    { title: 'App market metrics', description: 'Review ratings, installs, IAP pricing, version history, and Appark 30-day download and revenue estimates.' },
    { title: 'Competitor discovery', description: 'Use Appark cluster and competitor signals to map adjacent mobile apps and market alternatives.' },
  ],
};

const CONNECTOR_LOGOS: Record<string, {
  src: string;
  alt: string;
  width: number;
  height: number;
  imageClassName: string;
  tileClassName?: string;
}> = {
  gmail: {
    src: '/connector-logos/gmail.svg',
    alt: 'Gmail logo',
    width: 192,
    height: 192,
    imageClassName: 'h-7 w-7 object-contain',
  },
  feishu: {
    src: '/connector-logos/lark.png',
    alt: 'Lark logo',
    width: 700,
    height: 700,
    imageClassName: 'h-8 w-8 object-contain',
  },
  similarweb_api1: {
    src: '/connector-logos/similarweb.svg',
    alt: 'Similarweb logo',
    width: 1609,
    height: 1513,
    imageClassName: 'h-8 w-8 object-contain',
    tileClassName: 'bg-white',
  },
  semrush13: {
    src: '/connector-logos/semrush.svg',
    alt: 'Semrush logo',
    width: 37,
    height: 23,
    imageClassName: 'h-7 w-9 object-contain',
  },
  ahrefs_url_research: {
    src: '/connector-logos/ahrefs.png',
    alt: 'Ahrefs logo',
    width: 1020,
    height: 640,
    imageClassName: 'h-8 w-10 object-contain',
  },
  appark: {
    src: '/connector-logos/appark-icon.png',
    alt: 'Appark logo',
    width: 48,
    height: 48,
    imageClassName: 'h-8 w-8 object-contain',
  },
  sensor_tower: {
    src: '/connector-logos/sensor-tower-icon.png',
    alt: 'Sensor Tower logo',
    width: 48,
    height: 48,
    imageClassName: 'h-9 w-9 object-contain',
  },
  domain_metrics_check: {
    src: '/connector-logos/domain-metrics-check.png',
    alt: 'Domain Metrics Check logo',
    width: 175,
    height: 175,
    imageClassName: 'h-9 w-9 rounded-[6px] object-cover',
    tileClassName: 'bg-[#b9ff62]',
  },
};

function supportedConnectors(connectors: ConnectorItem[]) {
  return connectors.filter((connector) => SUPPORTED_CONNECTOR_KEYS.has(connector.key));
}

function connectorCategory(connector: ConnectorItem): Exclude<ConnectorCategory, 'all'> {
  return connector.type === 'data_source' ? 'intelligence' : 'communication';
}

function connectorIcon(connector: ConnectorItem): { Icon: LucideIcon; color: string } {
  if (connector.key === 'gmail') return { Icon: Mail, color: 'text-[#ff7d73]' };
  if (connector.key === 'feishu') return { Icon: MessageSquare, color: 'text-[#8eb3ff]' };
  if (connector.key === 'instagram_looter2') return { Icon: Camera, color: 'text-[#e879f9]' };
  if (connector.key === 'tiktok_api23') return { Icon: Camera, color: 'text-[#57e6d7]' };
  if (connector.key === 'youtube_v2') return { Icon: SquarePlay, color: 'text-[#ff5c5c]' };
  if (connector.key.includes('similarweb')) return { Icon: Gauge, color: 'text-[#8eb3ff]' };
  if (connector.key.includes('semrush')) return { Icon: BarChart3, color: 'text-[#e9b85a]' };
  if (connector.key.includes('ahrefs')) return { Icon: Search, color: 'text-[#ff8b4a]' };
  if (connector.key.includes('domain')) return { Icon: Search, color: 'text-[#46d19a]' };
  if (connector.key === 'appark') return { Icon: BarChart3, color: 'text-[#7fc7ff]' };
  return { Icon: Plus, color: 'text-zinc-400' };
}

function connectorLogo(connector: ConnectorItem) {
  return CONNECTOR_LOGOS[connector.key] || null;
}

function connectorAccountLabel(connector: ConnectorItem) {
  const labels = connector.accounts
    .map((account) => account.displayName || account.accountEmail)
    .filter(Boolean);
  if (labels.length > 1) return `${labels.length} accounts`;
  if (labels.length === 1) return labels[0];
  if (connector.connected && connector.type === 'data_source') return 'Platform key configured';
  if (connector.connected) return 'Connected';
  if (connector.platformConfigured === false && connector.type !== 'data_source') return 'Platform setup required';
  return 'Not connected';
}

function accountName(account: ConnectorAccount) {
  return account.displayName || account.accountEmail || 'Connected account';
}

function openPopup(url: string) {
  if (typeof window === 'undefined') return null;
  const popup = window.open(url, '_blank', 'width=980,height=820,noopener=false,noreferrer=false');
  if (popup) {
    try {
      popup.focus();
    } catch {
      // Browser-controlled focus behavior.
    }
  }
  return popup;
}

type AstromarConnectorsPageProps = {
  initialData?: InvestorConnectorsData | null;
};

export function AstromarConnectorsPage({ initialData = null }: AstromarConnectorsPageProps) {
  const cachedConnectors = getWorkspaceCachedStale<{ connectors?: ConnectorItem[] }>(WORKSPACE_CACHE_KEYS.connectors);
  const initialConnectors = supportedConnectors(initialData?.connectors || cachedConnectors?.connectors || []);
  const [connectors, setConnectors] = useState<ConnectorItem[]>(initialConnectors);
  const [loading, setLoading] = useState(initialConnectors.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory>('all');
  const [activeConnectorKey, setActiveConnectorKey] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('connect');
  const [drawerPhase, setDrawerPhase] = useState<DrawerPhase>('idle');
  const [drawerMessage, setDrawerMessage] = useState('');
  const [drawerError, setDrawerError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [disconnectAccount, setDisconnectAccount] = useState<ConnectorAccount | null>(null);
  const [feishuPackages, setFeishuPackages] = useState<string[]>(DEFAULT_FEISHU_PACKAGES);
  const [feishuFlow, setFeishuFlow] = useState<FeishuFlowState>({ phase: 'idle' });
  const loadStartedRef = useRef(false);
  const connectorLoadSeqRef = useRef(0);
  const pollRef = useRef<number | null>(null);
  const oauthBaselineRef = useRef({ key: '', accountCount: 0, requireNewAccount: false });

  const activeConnector = useMemo(
    () => connectors.find((connector) => connector.key === activeConnectorKey) || null,
    [activeConnectorKey, connectors],
  );

  const clearPolling = useCallback(() => {
    if (pollRef.current === null || typeof window === 'undefined') return;
    window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const loadConnectors = useCallback(async (options: { showLoading?: boolean; force?: boolean } = {}) => {
    const loadSeq = connectorLoadSeqRef.current += 1;
    const isCurrentLoad = () => connectorLoadSeqRef.current === loadSeq;
    const showLoading = options.showLoading ?? false;
    if (showLoading && isCurrentLoad()) setLoading(true);
    if (isCurrentLoad()) setError(null);
    try {
      const data = await fetchWorkspaceJson<{ connectors?: ConnectorItem[] }>(
        WORKSPACE_CACHE_KEYS.connectors,
        '/api/investor/connectors',
        {},
        { force: options.force ?? true, ttlMs: 45_000 },
      );
      const next = supportedConnectors(Array.isArray(data.connectors) ? data.connectors : []);
      if (!isCurrentLoad()) return null;
      setConnectors(next);
      setWorkspaceCached(WORKSPACE_CACHE_KEYS.connectors, { ...data, connectors: next });
      return next;
    } catch (loadError) {
      if (isCurrentLoad()) setError(loadError instanceof Error ? loadError.message : 'Failed to load connectors');
      return null;
    } finally {
      if (showLoading && isCurrentLoad()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    if (initialData) {
      const next = { ...initialData, connectors: supportedConnectors(initialData.connectors || []) };
      setWorkspaceCached(WORKSPACE_CACHE_KEYS.connectors, next);
      void loadConnectors({ showLoading: false, force: false });
      return;
    }
    const cached = getWorkspaceCachedStale<{ connectors?: ConnectorItem[] }>(WORKSPACE_CACHE_KEYS.connectors);
    const supportedCached = supportedConnectors(cached?.connectors || []);
    if (supportedCached.length) {
      setConnectors(supportedCached);
      setLoading(false);
      void loadConnectors({ showLoading: false, force: false });
      return;
    }
    void loadConnectors({ showLoading: true, force: false });
  }, [initialData, loadConnectors]);

  useEffect(() => () => clearPolling(), [clearPolling]);

  const connectedCount = connectors.filter((connector) => connector.connected).length;
  const filteredConnectors = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return connectors.filter((connector) => {
      const categoryMatches = category === 'all' || connectorCategory(connector) === category;
      const queryMatches = !normalizedQuery || `${connector.label} ${connector.description}`.toLowerCase().includes(normalizedQuery);
      return categoryMatches && queryMatches;
    });
  }, [category, connectors, query]);

  const resetDrawerState = (connector: ConnectorItem, mode: DrawerMode) => {
    clearPolling();
    setActiveConnectorKey(connector.key);
    setDrawerMode(mode);
    setDrawerPhase('idle');
    setDrawerMessage('');
    setDrawerError('');
    setActionLoading(false);
    setDisconnectAccount(null);
    setFeishuFlow({ phase: 'idle' });
    oauthBaselineRef.current = {
      key: connector.key,
      accountCount: connector.accounts.length,
      requireNewAccount: mode === 'connect' && connector.connected && connector.accounts.length > 0,
    };
  };

  const openConnectorDrawer = (connector: ConnectorItem) => {
    resetDrawerState(connector, connector.connected ? 'manage' : 'connect');
  };

  const closeDrawer = () => {
    if (actionLoading) return;
    clearPolling();
    setActiveConnectorKey(null);
    setDrawerPhase('idle');
    setDrawerMessage('');
    setDrawerError('');
    setDisconnectAccount(null);
  };

  const markDone = async (message: string) => {
    setDrawerPhase('done');
    setDrawerMessage(message);
    setDrawerError('');
    await loadConnectors({ showLoading: false, force: true });
  };

  const refreshOAuthStatus = useCallback(async () => {
    const baseline = oauthBaselineRef.current;
    if (!baseline.key) return false;
    const latest = await loadConnectors({ showLoading: false, force: true });
    const connector = latest?.find((item) => item.key === baseline.key);
    const connected = Boolean(connector?.connected);
    const accountCount = connector?.accounts.length || 0;
    const complete = baseline.requireNewAccount ? accountCount > baseline.accountCount : connected;
    if (complete) {
      clearPolling();
      setDrawerPhase('done');
      setDrawerMessage(`${connector?.label || 'Connector'} connected.`);
      setDrawerError('');
      setActionLoading(false);
      return true;
    }
    return false;
  }, [clearPolling, loadConnectors]);

  const startOAuthPolling = useCallback(() => {
    if (typeof window === 'undefined') return;
    clearPolling();
    let attempts = 0;
    pollRef.current = window.setInterval(() => {
      attempts += 1;
      void refreshOAuthStatus().then((complete) => {
        if (complete) return;
        if (attempts >= 45) {
          clearPolling();
          setDrawerError('Still waiting for authorization. If you finished it, refresh status or reopen the connector.');
        }
      });
    }, 2000);
  }, [clearPolling, refreshOAuthStatus]);

  const startGmailAuthorization = () => {
    if (!activeConnector) return;
    const popup = openPopup(activeConnector.connectHref || '/api/investor/personal-data/gmail/connect');
    if (!popup) {
      window.location.href = activeConnector.connectHref || '/api/investor/personal-data/gmail/connect';
      return;
    }
    setDrawerPhase('waiting');
    setDrawerMessage('Finish Gmail authorization in the opened window. This drawer will update when the account is connected.');
    startOAuthPolling();
  };

  const enableCompetitiveSource = async (connector: ConnectorItem) => {
    setActionLoading(true);
    setDrawerError('');
    try {
      const res = await fetch(`/api/investor/competitive-data-source/${connector.key}`, {
        method: 'PUT',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to enable ${connector.label}`);
      await markDone(`${connector.label} enabled.`);
    } catch (actionError) {
      setDrawerError(actionError instanceof Error ? actionError.message : `Failed to enable ${connector.label}`);
    } finally {
      setActionLoading(false);
    }
  };

  const startFeishuSetup = async () => {
    setActionLoading(true);
    setDrawerError('');
    try {
      const params = new URLSearchParams({
        response: 'json',
        packages: feishuPackages.join(','),
      });
      const res = await fetch(`/api/investor/personal-data/feishu/connect?${params.toString()}`, {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to start Lark setup.');
      setFeishuFlow({
        phase: 'app_setup',
        setupUrl: typeof data.setupUrl === 'string' ? data.setupUrl : '',
      });
      setDrawerMessage('Lark setup link is ready.');
    } catch (actionError) {
      setDrawerError(actionError instanceof Error ? actionError.message : 'Failed to start Lark setup.');
    } finally {
      setActionLoading(false);
    }
  };

  const continueFeishuSetup = async () => {
    setActionLoading(true);
    setDrawerError('');
    try {
      const res = await fetch('/api/investor/personal-data/feishu/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'continue' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Lark setup is not complete yet.');
      if (data.phase === 'connected' || data.account) {
        await markDone('Lark connected.');
        return;
      }
      setFeishuFlow((current) => ({
        ...current,
        phase: 'user_auth',
        authUrl: typeof data.authUrl === 'string' ? data.authUrl : current.authUrl,
        userCode: typeof data.userCode === 'string' ? data.userCode : '',
      }));
      setDrawerMessage(data.authUrl ? 'Lark account authorization link is ready.' : 'Still waiting for Lark app setup to complete.');
    } catch (actionError) {
      setDrawerError(actionError instanceof Error ? actionError.message : 'Lark setup is not complete yet.');
    } finally {
      setActionLoading(false);
    }
  };

  const completeFeishuBinding = async () => {
    setActionLoading(true);
    setDrawerError('');
    try {
      const res = await fetch('/api/investor/personal-data/feishu/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Connection is not complete yet.');
      await markDone('Lark connected.');
    } catch (actionError) {
      setDrawerError(actionError instanceof Error ? actionError.message : 'Connection is not complete yet.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleFeishuPrimary = () => {
    if (feishuFlow.phase === 'idle') {
      void startFeishuSetup();
      return;
    }
    if (feishuFlow.phase === 'app_setup' && feishuFlow.setupUrl) {
      openPopup(feishuFlow.setupUrl);
      setFeishuFlow((current) => ({ ...current, phase: 'setup_opened' }));
      setDrawerMessage('Finish Lark app setup in the opened window, then continue.');
      return;
    }
    if (feishuFlow.phase === 'setup_opened') {
      void continueFeishuSetup();
      return;
    }
    if (feishuFlow.phase === 'user_auth' && feishuFlow.authUrl) {
      openPopup(feishuFlow.authUrl);
      setFeishuFlow((current) => ({ ...current, phase: 'auth_opened' }));
      setDrawerMessage('Approve Lark account access, then complete binding.');
      return;
    }
    if (feishuFlow.phase === 'auth_opened') {
      void completeFeishuBinding();
    }
  };

  const disconnectCompetitiveSource = async (connector: ConnectorItem) => {
    const res = await fetch(`/api/investor/competitive-data-source/${connector.key}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed to disconnect ${connector.label}`);
  };

  const disconnectPersonalAccount = async (account: ConnectorAccount) => {
    const res = await fetch(`/api/investor/personal-data/accounts/${encodeURIComponent(account.connectionId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed to disconnect ${accountName(account)}`);
  };

  const handleDisconnect = async () => {
    if (!activeConnector) return;
    setActionLoading(true);
    setDrawerError('');
    try {
      if (activeConnector.type === 'data_source') {
        await disconnectCompetitiveSource(activeConnector);
        await markDone(`${activeConnector.label} disconnected.`);
      } else if (disconnectAccount) {
        await disconnectPersonalAccount(disconnectAccount);
        await markDone(`${accountName(disconnectAccount)} disconnected.`);
      } else {
        await Promise.all(activeConnector.accounts.map(disconnectPersonalAccount));
        await markDone(`${activeConnector.label} disconnected.`);
      }
    } catch (actionError) {
      setDrawerError(actionError instanceof Error ? actionError.message : `Failed to disconnect ${activeConnector.label}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePrimaryAction = () => {
    if (!activeConnector) return;
    if (drawerPhase === 'done') {
      closeDrawer();
      return;
    }
    if (drawerPhase === 'waiting') {
      void refreshOAuthStatus();
      return;
    }
    if (drawerMode === 'manage') {
      closeDrawer();
      return;
    }
    if (drawerMode === 'disconnect') {
      void handleDisconnect();
      return;
    }
    if (activeConnector.key === 'gmail') {
      startGmailAuthorization();
      return;
    }
    if (activeConnector.key === 'feishu') {
      handleFeishuPrimary();
      return;
    }
    if (activeConnector.type === 'data_source') {
      void enableCompetitiveSource(activeConnector);
    }
  };

  const primaryButtonLabel = () => {
    if (!activeConnector) return 'Continue';
    if (actionLoading) return 'Working...';
    if (drawerPhase === 'done') return 'Done';
    if (drawerPhase === 'waiting') return 'Refresh status';
    if (drawerMode === 'manage') return 'Done';
    if (drawerMode === 'disconnect') return 'Disconnect';
    if (activeConnector.key === 'feishu') {
      if (feishuFlow.phase === 'idle') return 'Start setup';
      if (feishuFlow.phase === 'app_setup') return 'Open setup';
      if (feishuFlow.phase === 'setup_opened') return 'I finished setup';
      if (feishuFlow.phase === 'user_auth') return 'Open authorization';
      if (feishuFlow.phase === 'auth_opened') return 'Complete binding';
    }
    if (activeConnector.type === 'data_source') return 'Enable';
    return 'Open authorization';
  };

  const renderFeishuSteps = () => {
    const stepClass = (step: 'setup' | 'auth' | 'return') => {
      if (step === 'setup') return ['setup_opened', 'user_auth', 'auth_opened'].includes(feishuFlow.phase) || drawerPhase === 'done'
        ? 'border-[#46d19a]/20 bg-[#46d19a]/[0.06]'
        : 'border-[#8eb3ff]/20 bg-[#8eb3ff]/[0.06]';
      if (step === 'auth') return ['auth_opened'].includes(feishuFlow.phase) || drawerPhase === 'done'
        ? 'border-[#46d19a]/20 bg-[#46d19a]/[0.06]'
        : feishuFlow.phase === 'user_auth'
          ? 'border-[#8eb3ff]/20 bg-[#8eb3ff]/[0.06]'
          : 'border-white/[0.09] bg-white/[0.022]';
      return drawerPhase === 'done'
        ? 'border-[#46d19a]/20 bg-[#46d19a]/[0.06]'
        : 'border-white/[0.09] bg-white/[0.022]';
    };
    return (
      <div className="grid gap-2">
        <div className={`rounded-[8px] border p-3 ${stepClass('setup')}`}>
          <strong className="block text-[11px] text-zinc-100">1. Open Lark setup link</strong>
          <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">
            Configure the Lark app in the opened window.
          </span>
        </div>
        <div className={`rounded-[8px] border p-3 ${stepClass('auth')}`}>
          <strong className="block text-[11px] text-zinc-100">2. Authorize your account</strong>
          <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">
            {feishuFlow.userCode ? `Use code ${feishuFlow.userCode} if prompted. ` : ''}Approve account access.
          </span>
        </div>
        <div className={`rounded-[8px] border p-3 ${stepClass('return')}`}>
          <strong className="block text-[11px] text-zinc-100">3. Return to {productBrand.name}</strong>
          <span className="mt-1 block text-[10px] leading-relaxed text-zinc-500">
            Complete binding here after authorization.
          </span>
        </div>
      </div>
    );
  };

  const renderDrawerBody = () => {
    if (!activeConnector) return null;
    if (drawerPhase === 'waiting') {
      return (
        <div className="grid min-h-[180px] place-items-center rounded-[12px] border border-white/[0.09] bg-white/[0.024] p-6 text-center">
          <div>
            <LoaderCircle className="mx-auto mb-4 h-7 w-7 animate-spin text-[#46d19a]" />
            <strong className="block text-[17px] text-zinc-100">Waiting for authorization...</strong>
            <p className="mx-auto mt-2 max-w-[330px] text-[11px] leading-relaxed text-zinc-500">
              {drawerMessage || 'Finish the provider step in the opened window.'}
            </p>
          </div>
        </div>
      );
    }
    if (drawerPhase === 'done') {
      return (
        <div className="rounded-[12px] border border-[#46d19a]/25 bg-[#46d19a]/[0.08] p-4 text-[#dbf9eb]">
          <strong className="block text-[13px]">{drawerMessage || `${activeConnector.label} updated.`}</strong>
          <span className="mt-1 block text-[11px] leading-relaxed text-[#dbf9eb]/70">
            The Connectors page has been refreshed.
          </span>
        </div>
      );
    }
    if (drawerMode === 'manage') {
      return (
        <div>
          <div className="rounded-[12px] border border-[#46d19a]/25 bg-[#46d19a]/[0.08] p-4 text-[#dbf9eb]">
            <strong className="block text-[13px]">{activeConnector.label} is connected</strong>
            <span className="mt-1 block text-[11px] leading-relaxed text-[#dbf9eb]/70">
              {connectorAccountLabel(activeConnector)}
            </span>
          </div>
          {activeConnector.accounts.length > 0 ? (
            <section className="mt-4 rounded-[10px] border border-white/[0.09] bg-white/[0.024] p-3">
              <h3 className="mb-2 text-[12px] text-zinc-100">
                {activeConnector.accounts.length > 1 ? 'Accounts' : 'Account'}
              </h3>
              <div className="grid gap-2">
                {activeConnector.accounts.map((account) => (
                  <div key={account.connectionId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-[8px] border border-white/[0.09] bg-white/[0.022] px-3 py-2.5">
                    <span className="min-w-0">
                      <strong className="block truncate text-[11px] text-zinc-100">{accountName(account)}</strong>
                      <span className="mt-0.5 block truncate text-[10px] text-zinc-600">
                        {account.accountEmail || account.status || 'Connected'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDisconnectAccount(account);
                        setDrawerMode('disconnect');
                        setDrawerPhase('idle');
                        setDrawerError('');
                      }}
                      className="inline-flex h-7 items-center rounded-[7px] border border-red-400/20 bg-red-400/[0.055] px-2 text-[10px] font-bold text-red-200 hover:bg-red-400/[0.1]"
                    >
                      Disconnect
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section className="mt-4 rounded-[10px] border border-white/[0.09] bg-white/[0.024] p-3">
            <h3 className="text-[12px] text-zinc-100">Manage</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              Keep common actions one click away.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {activeConnector.type !== 'data_source' ? (
                <button
                  type="button"
                  onClick={() => resetDrawerState(activeConnector, 'connect')}
                  className="inline-flex h-8 items-center rounded-[7px] border border-white/[0.09] bg-white/[0.025] px-3 text-[11px] font-bold text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                >
                  Add another account
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setDisconnectAccount(null);
                  setDrawerMode('disconnect');
                  setDrawerPhase('idle');
                  setDrawerError('');
                }}
                className="inline-flex h-8 items-center rounded-[7px] border border-red-400/20 bg-red-400/[0.055] px-3 text-[11px] font-bold text-red-200 hover:bg-red-400/[0.1]"
              >
                {activeConnector.accounts.length > 1 ? 'Disconnect all' : 'Disconnect'}
              </button>
            </div>
          </section>
        </div>
      );
    }
    if (drawerMode === 'disconnect') {
      const target = disconnectAccount ? accountName(disconnectAccount) : activeConnector.label;
      return (
        <div className="rounded-[10px] border border-red-400/20 bg-red-400/[0.055] p-4">
          <h3 className="text-[13px] text-red-100">Disconnect {target}?</h3>
          <p className="mt-2 text-[11px] leading-relaxed text-red-100/70">
            {disconnectAccount ? 'This removes only this account.' : 'This removes this connector from future discussions.'} You can reconnect later.
          </p>
        </div>
      );
    }
    return (
      <div>
        {activeConnector.key === 'feishu' ? (
          <>
            <section className="rounded-[10px] border border-white/[0.09] bg-white/[0.024] p-3">
              <h3 className="text-[12px] text-zinc-100">Choose access</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                Defaults are selected; adjust only if needed.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {FEISHU_FEATURE_PACKAGES.map((feature) => {
                  const active = feishuPackages.includes(feature.key);
                  return (
                    <button
                      key={feature.key}
                      type="button"
                      onClick={() => {
                        setFeishuPackages((current) => (
                          current.includes(feature.key)
                            ? current.filter((item) => item !== feature.key)
                            : [...current, feature.key]
                        ));
                      }}
                      className={`rounded-[8px] border px-3 py-2 text-left text-[10px] ${
                        active
                          ? 'border-[#46d19a]/25 bg-[#46d19a]/[0.08] text-white'
                          : 'border-white/[0.09] bg-white/[0.022] text-zinc-500'
                      }`}
                    >
                      <strong className="block text-[11px]">{feature.label}</strong>
                      <span className="mt-0.5 block text-zinc-600">{feature.description}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="mt-3 rounded-[10px] border border-[#8eb3ff]/20 bg-[#8eb3ff]/[0.07] p-3">
              <h3 className="mb-2 text-[12px] text-zinc-100">Lark authorization</h3>
              {renderFeishuSteps()}
            </section>
          </>
        ) : (
          <section className="rounded-[10px] border border-[#8eb3ff]/20 bg-[#8eb3ff]/[0.07] p-3">
            <h3 className="text-[12px] text-zinc-100">
              {activeConnector.type === 'data_source' ? 'Enable data source' : 'Authorize account'}
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
              {activeConnector.type === 'data_source'
                ? 'This turns on this platform-provided source for future discussions. No OAuth step is needed.'
                : 'Click once to open the provider authorization window. After callback, return to this drawer.'}
            </p>
          </section>
        )}
        <section className="mt-3 rounded-[10px] border border-white/[0.09] bg-white/[0.024] p-3">
          <h3 className="text-[12px] text-zinc-100">Agent access</h3>
          <div className="mt-2 grid gap-2">
            {(CONNECTOR_PERMISSIONS[activeConnector.key] || []).map((permission) => (
              <div key={permission.title} className="rounded-[8px] border border-white/[0.09] bg-white/[0.022] px-3 py-2">
                <strong className="block text-[11px] text-zinc-200">{permission.title}</strong>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-600">{permission.description}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  };

  const drawerTitle = activeConnector
    ? drawerMode === 'disconnect'
      ? `Disconnect ${disconnectAccount ? accountName(disconnectAccount) : activeConnector.label}`
      : drawerMode === 'manage'
        ? `Manage ${activeConnector.label}`
        : `Connect ${activeConnector.label}`
    : '';
  const drawerSubtitle = activeConnector
    ? drawerMode === 'disconnect'
      ? 'Remove access from this workspace.'
      : drawerMode === 'manage'
        ? 'Connected now. Manage or disconnect it here.'
        : 'Authorize without leaving the Connectors page.'
    : '';
  const canRunPrimary = Boolean(
    activeConnector
    && (
      drawerMode !== 'connect'
      || activeConnector.type === 'data_source'
      || activeConnector.platformConfigured !== false
    ),
  );

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] md:grid-rows-[64px_minmax(0,1fr)]">
        <header className="hidden items-center justify-between border-b border-white/[0.09] px-6 md:flex">
          <div>
            <strong className="block text-[13px] text-zinc-100">Connectors</strong>
            <span className="mt-0.5 block text-[10px] text-zinc-600">Workspace connections</span>
          </div>
          <div className="flex items-center gap-2">
            <BillingCapacityPopover />
            <button type="button" onClick={() => void loadConnectors({ showLoading: connectors.length === 0, force: true })} className="grid h-8 w-8 place-items-center rounded-[7px] text-zinc-600 hover:bg-white/5 hover:text-white" title="Refresh connections">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        <main className="astromar-scrollbar min-h-0 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1180px]">
            <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <h1 className="text-[28px] font-bold leading-tight text-zinc-50">Connectors</h1>
                <p className="mt-2 text-xs text-zinc-400">Connect once, then choose the context available to each discussion.</p>
              </div>
              <span className="inline-flex min-h-[30px] items-center gap-2 rounded-full border border-[#46d19a]/20 bg-[#46d19a]/[0.06] px-3 text-[10px] font-extrabold text-[#46d19a]">
                <i className="h-1.5 w-1.5 rounded-full bg-[#46d19a]" />
                {connectedCount} connected
              </span>
            </div>

            <div className="mb-4">
              <label className="relative block">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  type="search"
                  placeholder="Search connectors"
                  className="h-[46px] w-full rounded-[8px] border border-white/[0.09] bg-white/[0.035] pl-10 pr-4 text-[13px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-white/25 focus:ring-2 focus:ring-white/[0.035]"
                />
              </label>
            </div>

            <nav className="astromar-scrollbar mb-5 flex gap-1 overflow-x-auto" aria-label="Connector categories">
              {categories.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setCategory(item.key)}
                  className={`h-[34px] shrink-0 rounded-[7px] border px-3 text-[11px] font-bold ${
                    category === item.key
                      ? 'border-white/[0.09] bg-white/[0.075] text-white'
                      : 'border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            {error ? (
              <div className="mb-4 flex items-center justify-between gap-4 rounded-[8px] border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-xs text-red-200">
                <span>{error}</span>
                <button type="button" onClick={() => void loadConnectors({ showLoading: connectors.length === 0, force: true })} className="font-bold hover:text-white">Retry</button>
              </div>
            ) : null}

            {loading && connectors.length === 0 ? (
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="h-[118px] animate-pulse rounded-[8px] border border-white/[0.09] bg-white/[0.022]" />
                ))}
              </div>
            ) : filteredConnectors.length > 0 ? (
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {filteredConnectors.map((connector) => {
                  const { Icon, color } = connectorIcon(connector);
                  const logo = connectorLogo(connector);
                  const canConnect = connector.type === 'data_source' || connector.connected || connector.platformConfigured !== false;
                  const actionClass = connector.connected
                    ? 'border-[#46d19a]/20 bg-[#46d19a]/[0.075] text-[#46d19a]'
                    : 'border-white/[0.09] bg-white/[0.025] text-zinc-400 hover:border-white/15 hover:bg-white/[0.065] hover:text-white';
                  return (
                    <article
                      key={connector.key}
                      className={`grid h-[118px] grid-cols-[48px_minmax(0,1fr)_38px] items-center gap-3.5 overflow-hidden rounded-[8px] border border-white/[0.09] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.04] ${
                        connector.connected ? 'bg-[linear-gradient(135deg,rgba(70,209,154,.035),rgba(255,255,255,.02))]' : 'bg-white/[0.022]'
                      }`}
                    >
                      <span className={`grid h-12 w-12 place-items-center overflow-hidden rounded-[8px] border border-white/[0.09] ${logo?.tileClassName || 'bg-white/[0.045]'} ${logo ? '' : color}`}>
                        {logo ? (
                          <Image
                            src={logo.src}
                            alt={logo.alt}
                            width={logo.width}
                            height={logo.height}
                            loading="lazy"
                            unoptimized
                            className={logo.imageClassName}
                          />
                        ) : (
                          <Icon className="h-6 w-6" />
                        )}
                      </span>
                      <span className="min-w-0 overflow-hidden">
                        <strong className="block truncate text-[15px] text-zinc-100">{connector.label}</strong>
                        <span className="mt-1 line-clamp-2 block text-xs leading-[1.45] text-zinc-400">{connector.description}</span>
                        <span className="mt-1.5 block truncate text-[10px] text-zinc-600">{connectorAccountLabel(connector)}</span>
                      </span>
                      <button
                        type="button"
                        disabled={!canConnect}
                        onClick={() => openConnectorDrawer(connector)}
                        title={connector.connected ? `Manage ${connector.label}` : `Connect ${connector.label}`}
                        aria-label={connector.connected ? `Manage ${connector.label}` : `Connect ${connector.label}`}
                        className={`grid h-[38px] w-[38px] place-items-center rounded-[8px] border disabled:cursor-not-allowed disabled:opacity-45 ${actionClass}`}
                      >
                        {connector.connected ? <Check className="h-[18px] w-[18px]" /> : <Plus className="h-[18px] w-[18px]" />}
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[8px] border border-dashed border-white/[0.09] px-5 py-14 text-center text-xs text-zinc-500">
                No connectors match this search.
              </div>
            )}
          </div>
        </main>

        {activeConnector ? (
          <>
            <button
              type="button"
              aria-label="Close connector drawer"
              onClick={closeDrawer}
              className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[5px]"
            />
            <aside className="fixed inset-y-0 right-0 z-50 grid w-full max-w-[460px] grid-rows-[auto_minmax(0,1fr)_auto] border-l border-white/[0.16] bg-[linear-gradient(180deg,#17181a,#101113)] shadow-[-28px_0_90px_rgba(0,0,0,.5)]">
              <header className="grid grid-cols-[minmax(0,1fr)_34px] items-start gap-3 border-b border-white/[0.09] p-[18px]">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold tracking-[-0.025em] text-zinc-50">{drawerTitle}</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{drawerSubtitle}</p>
                </div>
                <button type="button" onClick={closeDrawer} className="grid h-[34px] w-[34px] place-items-center rounded-[7px] text-zinc-500 hover:bg-white/5 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="astromar-scrollbar min-h-0 overflow-y-auto p-[18px]">
                {renderDrawerBody()}
                {drawerMessage && drawerPhase !== 'waiting' && drawerPhase !== 'done' ? (
                  <p className="mt-3 text-[11px] leading-relaxed text-[#46d19a]">{drawerMessage}</p>
                ) : null}
                {drawerError ? (
                  <p className="mt-3 rounded-[8px] border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-red-200">{drawerError}</p>
                ) : null}
              </div>
              <footer className="flex items-center justify-between gap-3 border-t border-white/[0.09] bg-black/20 p-4">
                <button
                  type="button"
                  onClick={drawerPhase === 'done' || drawerMode === 'manage' ? closeDrawer : () => {
                    if (drawerMode === 'disconnect') {
                      setDrawerMode('manage');
                      setDisconnectAccount(null);
                      setDrawerError('');
                      return;
                    }
                    closeDrawer();
                  }}
                  className="inline-flex min-h-[34px] items-center justify-center rounded-[7px] border border-white/[0.09] bg-white/[0.025] px-3 text-[11px] font-bold text-zinc-400 hover:bg-white/[0.06] hover:text-white"
                >
                  {drawerPhase === 'done' || drawerMode === 'manage' ? 'Close' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handlePrimaryAction}
                  disabled={!canRunPrimary || actionLoading}
                  className={`inline-flex min-h-[34px] items-center justify-center gap-2 rounded-[7px] px-3 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                    drawerMode === 'disconnect'
                      ? 'border border-red-400/25 bg-red-400/[0.08] text-red-100 hover:bg-red-400/[0.12]'
                      : 'border border-white bg-[#f3f3f1] text-[#101010] hover:bg-white'
                  }`}
                >
                  {actionLoading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                  {primaryButtonLabel()}
                </button>
              </footer>
            </aside>
          </>
        ) : null}
    </div>
  );
}
