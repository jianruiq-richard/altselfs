'use client';

import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
import {
  BarChart3,
  Check,
  Gauge,
  Image,
  Mail,
  Megaphone,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ConnectorAccount = {
  connectionId: string;
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

type ConnectorCategory = 'all' | 'communication' | 'social' | 'intelligence';

const categories: Array<{ key: ConnectorCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'communication', label: 'Communication' },
  { key: 'social', label: 'Social' },
  { key: 'intelligence', label: 'Intelligence' },
];

function connectorCategory(connector: ConnectorItem): Exclude<ConnectorCategory, 'all'> {
  if (connector.key === 'meta' || connector.key === 'xiaohongshu') return 'social';
  if (connector.type === 'data_source') return 'intelligence';
  return 'communication';
}

function connectorIcon(connector: ConnectorItem): { Icon: LucideIcon; color: string } {
  if (connector.key === 'gmail') return { Icon: Mail, color: 'text-[#ff7d73]' };
  if (connector.key === 'feishu') return { Icon: MessageSquare, color: 'text-[#8eb3ff]' };
  if (connector.key === 'meta') return { Icon: Megaphone, color: 'text-[#f38eea]' };
  if (connector.key === 'wechat') return { Icon: MessageSquare, color: 'text-[#46d19a]' };
  if (connector.key.includes('similarweb')) return { Icon: Gauge, color: 'text-[#8eb3ff]' };
  if (connector.key.includes('semrush')) return { Icon: BarChart3, color: 'text-[#e9b85a]' };
  if (connector.key.includes('domain')) return { Icon: Search, color: 'text-[#46d19a]' };
  if (connector.key.includes('xiaohongshu')) return { Icon: Image, color: 'text-[#ff7464]' };
  return { Icon: Plus, color: 'text-zinc-400' };
}

function connectorAccountLabel(connector: ConnectorItem) {
  const labels = connector.accounts
    .map((account) => account.displayName || account.accountEmail)
    .filter(Boolean);
  if (labels.length > 0) return labels.join(', ');
  if (connector.connected) return 'Connected';
  if (connector.platformConfigured === false) return 'Platform setup required';
  return 'Not connected';
}

export function AstromarConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ConnectorCategory>('all');

  const loadConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/investor/connectors', { cache: 'no-store', credentials: 'same-origin' });
      const data = (await response.json().catch(() => ({}))) as { connectors?: ConnectorItem[]; error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to load connectors');
      setConnectors(Array.isArray(data.connectors) ? data.connectors : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load connectors');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnectors();
  }, [loadConnectors]);

  const connectedCount = connectors.filter((connector) => connector.connected).length;
  const filteredConnectors = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return connectors.filter((connector) => {
      const categoryMatches = category === 'all' || connectorCategory(connector) === category;
      const queryMatches = !normalizedQuery || `${connector.label} ${connector.description}`.toLowerCase().includes(normalizedQuery);
      return categoryMatches && queryMatches;
    });
  }, [category, connectors, query]);

  return (
    <AstromarWorkspaceShell mobileTitle="Connectors">
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] md:grid-rows-[64px_minmax(0,1fr)]">
        <header className="hidden items-center justify-between border-b border-white/[0.09] px-6 md:flex">
          <div>
            <strong className="block text-[13px] text-zinc-100">Connectors</strong>
            <span className="mt-0.5 block text-[10px] text-zinc-600">Workspace connections</span>
          </div>
          <button type="button" onClick={() => void loadConnectors()} className="grid h-8 w-8 place-items-center rounded-[7px] text-zinc-600 hover:bg-white/5 hover:text-white" title="Refresh connections">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
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
                <button type="button" onClick={() => void loadConnectors()} className="font-bold hover:text-white">Retry</button>
              </div>
            ) : null}

            {loading && connectors.length === 0 ? (
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-[104px] animate-pulse rounded-[8px] border border-white/[0.09] bg-white/[0.022]" />
                ))}
              </div>
            ) : filteredConnectors.length > 0 ? (
              <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                {filteredConnectors.map((connector) => {
                  const { Icon, color } = connectorIcon(connector);
                  const actionHref = connector.connected ? connector.manageHref : connector.connectHref || connector.manageHref;
                  const canConnect = connector.connected || connector.platformConfigured !== false;
                  const actionClass = connector.connected
                    ? 'border-[#46d19a]/20 bg-[#46d19a]/[0.075] text-[#46d19a]'
                    : 'border-white/[0.09] bg-white/[0.025] text-zinc-400 hover:border-white/15 hover:bg-white/[0.065] hover:text-white';
                  const action = (
                    <span className={`grid h-[38px] w-[38px] place-items-center rounded-[8px] border ${actionClass}`}>
                      {connector.connected ? <Check className="h-[18px] w-[18px]" /> : <Plus className="h-[18px] w-[18px]" />}
                    </span>
                  );
                  return (
                    <article
                      key={connector.key}
                      className={`grid min-h-[104px] grid-cols-[48px_minmax(0,1fr)_38px] items-center gap-3.5 rounded-[8px] border border-white/[0.09] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.04] ${
                        connector.connected ? 'bg-[linear-gradient(135deg,rgba(70,209,154,.035),rgba(255,255,255,.02))]' : 'bg-white/[0.022]'
                      }`}
                    >
                      <span className={`grid h-12 w-12 place-items-center rounded-[8px] border border-white/[0.09] bg-white/[0.045] ${color}`}>
                        <Icon className="h-6 w-6" />
                      </span>
                      <span className="min-w-0">
                        <strong className="block text-[15px] text-zinc-100">{connector.label}</strong>
                        <span className="mt-1 line-clamp-2 block text-xs leading-[1.45] text-zinc-400">{connector.description}</span>
                        <span className="mt-1.5 block truncate text-[10px] text-zinc-600">{connectorAccountLabel(connector)}</span>
                      </span>
                      {actionHref && canConnect ? (
                        <Link href={actionHref} title={connector.connected ? `Manage ${connector.label}` : `Connect ${connector.label}`} aria-label={connector.connected ? `Manage ${connector.label}` : `Connect ${connector.label}`}>
                          {action}
                        </Link>
                      ) : (
                        <button type="button" disabled title="Platform setup required" aria-label={`${connector.label} unavailable`} className="cursor-not-allowed opacity-45">
                          {action}
                        </button>
                      )}
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
      </div>
    </AstromarWorkspaceShell>
  );
}
