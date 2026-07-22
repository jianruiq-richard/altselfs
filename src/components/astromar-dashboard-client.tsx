'use client';

import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
import {
  Activity,
  ArrowUp,
  Check,
  CircleDot,
  Clock3,
  Compass,
  ExternalLink,
  LoaderCircle,
  MessageSquare,
  Plug,
  RefreshCw,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type DashboardMetric = {
  label: string;
  value: number;
  detail: string;
  tone: 'green' | 'blue' | 'amber';
};

type DashboardTask = {
  priority: 'high' | 'medium' | 'low';
  task: string;
  deadline: string;
  owner: string;
};

type DashboardSignal = {
  title: string;
  detail: string;
  source: string;
  updatedAt: string;
};

type DashboardWork = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
};

type ConnectorItem = {
  key: string;
  label: string;
  connected: boolean;
  accounts: Array<{ displayName: string; accountEmail: string }>;
  platformConfigured?: boolean;
};

type AstromarDashboardClientProps = {
  userName: string;
  dateLabel: string;
  briefingHeadline: string;
  metrics: DashboardMetric[];
  tasks: DashboardTask[];
  signals: DashboardSignal[];
  activeWork: DashboardWork[];
};

const promptSuggestions = [
  'Analyze a competitor',
  'Prioritize today',
  'Find early adopters',
  'Draft a founder reply',
];

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Recently';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function metricIcon(label: string) {
  if (label.toLowerCase().includes('decision')) return Compass;
  if (label.toLowerCase().includes('signal')) return Activity;
  return LoaderCircle;
}

function connectorAccount(connector: ConnectorItem) {
  const account = connector.accounts[0];
  return account?.displayName || account?.accountEmail || (connector.connected ? 'Connected' : 'Not connected');
}

export function AstromarDashboardClient({
  userName,
  dateLabel,
  briefingHeadline,
  metrics,
  tasks,
  signals,
  activeWork,
}: AstromarDashboardClientProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(true);
  const connectedConnectors = useMemo(() => connectors.filter((connector) => connector.connected), [connectors]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/investor/connectors', { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { connectors?: ConnectorItem[] };
        if (!response.ok) throw new Error('Failed to load connectors');
        return Array.isArray(data.connectors) ? data.connectors : [];
      })
      .then((items) => {
        if (!cancelled) setConnectors(items);
      })
      .catch(() => {
        if (!cancelled) setConnectors([]);
      })
      .finally(() => {
        if (!cancelled) setConnectorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openDiscussion = (nextPrompt?: string) => {
    const value = (nextPrompt ?? prompt).trim();
    const query = value ? `?prompt=${encodeURIComponent(value)}` : '';
    router.push(`/investor/chat/100${query}`);
  };

  const rightRail = (
    <div className="grid h-full min-h-0 grid-rows-[64px_minmax(0,1fr)]">
      <div className="flex items-center justify-between border-b border-white/[0.09] px-4">
        <strong className="text-sm text-zinc-100">Workspace context</strong>
        <span className="inline-flex items-center gap-2 text-[11px] text-zinc-400">
          <i className="h-1.5 w-1.5 rounded-full bg-[#46d19a] shadow-[0_0_9px_rgba(70,209,154,.5)]" />
          Ready
        </span>
      </div>
      <div className="min-h-0 overflow-y-auto px-4 py-5">
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-zinc-200">Active work</h2>
            <Clock3 className="h-3.5 w-3.5 text-zinc-600" />
          </div>
          <div className="grid gap-2.5">
            {activeWork.length > 0 ? (
              activeWork.slice(0, 3).map((work) => {
                const running = ['RUNNING', 'QUEUED'].includes(work.status.toUpperCase());
                return (
                  <Link
                    key={work.id}
                    href="/investor/chat/100"
                    className="rounded-[7px] border border-white/[0.09] bg-white/[0.027] p-3.5 hover:border-white/15 hover:bg-white/[0.045]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[12px] font-semibold leading-5 text-zinc-100">{work.title}</h3>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 text-[9px] font-extrabold uppercase ${running ? 'text-[#8eb3ff]' : 'text-[#46d19a]'}`}>
                        <i className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-[#8eb3ff]' : 'bg-[#46d19a]'}`} />
                        {running ? 'Running' : 'Ready'}
                      </span>
                    </div>
                    <p className="mt-2 text-[10px] text-zinc-500">Updated {relativeTime(work.updatedAt)} ago</p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]">
                      <i className={`block h-full ${running ? 'w-2/3 bg-[#8eb3ff]' : 'w-full bg-[#46d19a]'}`} />
                    </div>
                  </Link>
                );
              })
            ) : (
              <div className="rounded-[7px] border border-dashed border-white/[0.09] px-3 py-5 text-center text-[11px] text-zinc-500">
                No active work right now.
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-zinc-200">Connected context</h2>
            <Link href="/connectors" className="grid h-7 w-7 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-white" title="Manage connectors">
              <Plug className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="grid gap-1">
            {connectorsLoading ? (
              <p className="px-2 py-4 text-[11px] text-zinc-500">Loading connectors...</p>
            ) : connectedConnectors.length > 0 ? (
              connectedConnectors.map((connector) => (
                <Link key={connector.key} href="/connectors" className="grid min-h-14 grid-cols-[34px_minmax(0,1fr)_20px] items-center gap-2.5 rounded-[7px] px-2 hover:bg-white/[0.025]">
                  <span className="grid h-8 w-8 place-items-center rounded-md border border-white/[0.09] text-zinc-400"><Plug className="h-3.5 w-3.5" /></span>
                  <span className="grid min-w-0">
                    <strong className="truncate text-xs text-zinc-100">{connector.label}</strong>
                    <span className="truncate text-[10px] text-zinc-500">{connectorAccount(connector)}</span>
                  </span>
                  <Check className="h-3.5 w-3.5 text-[#46d19a]" />
                </Link>
              ))
            ) : (
              <Link href="/connectors" className="flex items-center justify-between rounded-[7px] border border-dashed border-white/[0.09] px-3 py-4 text-[11px] text-zinc-500 hover:text-zinc-300">
                Connect your first source
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
          <p className="mt-4 border-t border-white/[0.09] px-2 pt-3 text-[10px] leading-4 text-zinc-600">
            Source access is selected inside each discussion.
          </p>
        </section>
      </div>
    </div>
  );

  return (
    <AstromarWorkspaceShell mobileTitle="Home" rightRail={rightRail}>
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] md:grid-rows-[64px_minmax(0,1fr)_auto]">
        <header className="hidden items-center justify-between border-b border-white/[0.09] px-6 md:flex">
          <div>
            <strong className="block text-[13px] text-zinc-100">Home</strong>
            <span className="mt-0.5 block text-[10px] text-zinc-600">Founder operating view</span>
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="grid h-8 w-8 place-items-center rounded-[7px] text-zinc-600 hover:bg-white/5 hover:text-white"
            title="Refresh dashboard"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </header>

        <main className="min-h-0 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[980px]">
            <div className="mb-6">
              <p className="mb-1 text-[11px] font-extrabold uppercase text-zinc-600">{dateLabel}</p>
              <h1 className="text-[28px] font-bold leading-tight text-zinc-50">Good morning, {userName}.</h1>
            </div>

            <div className="mb-7 grid gap-2.5 md:grid-cols-3">
              {metrics.map((metric) => {
                const Icon = metricIcon(metric.label);
                const detailColor = metric.tone === 'green' ? 'text-[#46d19a]' : metric.tone === 'blue' ? 'text-[#8eb3ff]' : 'text-[#e9b85a]';
                return (
                  <article key={metric.label} className="rounded-[8px] border border-white/[0.09] bg-white/[0.025] p-4">
                    <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-400">
                      <span>{metric.label}</span>
                      <Icon className="h-4 w-4 text-zinc-600" />
                    </div>
                    <div className="mt-2 flex items-baseline gap-2.5">
                      <strong className="text-2xl leading-none text-zinc-50">{metric.value}</strong>
                      <span className={`text-[10px] font-bold ${detailColor}`}>{metric.detail}</span>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-zinc-100">Today&apos;s decision brief</h2>
              <button type="button" onClick={() => router.refresh()} className="inline-flex items-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-300">
                <RefreshCw className="h-3 w-3" />
                Refresh
              </button>
            </div>
            <section className="mb-7 overflow-hidden rounded-[8px] border border-white/[0.09] bg-white/[0.022]">
              <div className="flex items-center justify-between gap-5 border-b border-white/[0.09] px-4 py-3.5">
                <p className="text-xs leading-5 text-zinc-400">{briefingHeadline}</p>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#46d19a]/20 bg-[#46d19a]/[0.07] px-2.5 py-1.5 text-[10px] font-extrabold text-[#46d19a]">
                  <i className="h-1.5 w-1.5 rounded-full bg-[#46d19a]" />
                  Live brief
                </span>
              </div>
              <div className="divide-y divide-white/[0.07]">
                {tasks.length > 0 ? (
                  tasks.slice(0, 4).map((task, index) => (
                    <button
                      key={`${task.task}-${index}`}
                      type="button"
                      onClick={() => openDiscussion(`Help me move this forward: ${task.task}`)}
                      className="grid min-h-[72px] w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]"
                    >
                      <span className={`grid h-[34px] w-[34px] place-items-center rounded-[7px] border border-white/[0.09] ${task.priority === 'high' ? 'text-[#8eb3ff]' : task.priority === 'medium' ? 'text-[#e9b85a]' : 'text-[#46d19a]'}`}>
                        <CircleDot className="h-4 w-4" />
                      </span>
                      <span className="grid min-w-0">
                        <strong className="text-xs text-zinc-100">{task.task}</strong>
                        <span className="mt-1 truncate text-[10px] text-zinc-500">{task.owner}</span>
                      </span>
                      <span className="grid justify-items-end gap-1">
                        <b className="rounded-full bg-[#8eb3ff]/[0.09] px-2 py-1 text-[9px] text-[#8eb3ff]">{task.priority === 'high' ? 'Decide today' : 'Review'}</b>
                        <span className="text-[9px] text-zinc-600">{task.deadline}</span>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">No decision items are waiting for review.</div>
                )}
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[1.08fr_.92fr]">
              <section>
                <div className="mb-2.5 flex items-center justify-between"><h2 className="text-[15px] font-semibold">Operating signals</h2><span className="text-[10px] text-zinc-600">Live</span></div>
                <div className="overflow-hidden rounded-[8px] border border-white/[0.09] bg-white/[0.02]">
                  {signals.length > 0 ? signals.slice(0, 4).map((signal, index) => (
                    <div key={`${signal.source}-${index}`} className="grid min-h-14 grid-cols-[7px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-white/[0.06] px-3.5 py-2.5 last:border-b-0">
                      <i className="h-1.5 w-1.5 rounded-full bg-[#46d19a]" />
                      <span className="grid min-w-0"><strong className="truncate text-[11px] text-zinc-200">{signal.title}</strong><span className="truncate text-[9px] text-zinc-600">{signal.detail}</span></span>
                      <span className="text-[9px] text-zinc-600">{relativeTime(signal.updatedAt)}</span>
                    </div>
                  )) : <div className="px-4 py-8 text-center text-xs text-zinc-500">Connect a source to populate operating signals.</div>}
                </div>
              </section>
              <section>
                <div className="mb-2.5 flex items-center justify-between"><h2 className="text-[15px] font-semibold">Recent discussions</h2><Link href="/investor/chat/100" className="text-[10px] text-zinc-600 hover:text-zinc-300">Open</Link></div>
                <div className="overflow-hidden rounded-[8px] border border-white/[0.09] bg-white/[0.02]">
                  {activeWork.length > 0 ? activeWork.slice(0, 4).map((work) => (
                    <Link key={work.id} href="/investor/chat/100" className="grid min-h-14 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-white/[0.06] px-3.5 py-2.5 last:border-b-0 hover:bg-white/[0.02]">
                      <MessageSquare className="h-4 w-4 text-zinc-600" />
                      <span className="truncate text-[11px] font-medium text-zinc-200">{work.title}</span>
                      <span className="text-[9px] text-zinc-600">{relativeTime(work.updatedAt)}</span>
                    </Link>
                  )) : <div className="px-4 py-8 text-center text-xs text-zinc-500">Start your first discussion.</div>}
                </div>
              </section>
            </div>
          </div>
        </main>

        <div className="bg-[linear-gradient(180deg,rgba(9,10,10,0),#090a0a_24%)] px-4 pb-4 pt-3 sm:px-6 md:px-8 md:pb-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              openDiscussion();
            }}
            className="mx-auto w-full max-w-[820px] overflow-hidden rounded-[8px] border border-white/[0.16] bg-[linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025)),#111214] shadow-[0_20px_60px_rgba(0,0,0,.34),inset_0_1px_0_rgba(255,255,255,.06)]"
          >
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  openDiscussion();
                }
              }}
              className="block h-[76px] w-full resize-none bg-transparent px-4 py-3 text-base text-zinc-100 outline-none placeholder:text-zinc-600"
              placeholder="What should we decide, research, or move forward?"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3">
              <div className="flex min-w-0 gap-1.5 overflow-x-auto">
                {promptSuggestions.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => setPrompt(suggestion)} className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-white/[0.09] px-2 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
                    <Search className="h-3 w-3" />
                    {suggestion}
                  </button>
                ))}
              </div>
              <button type="submit" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white bg-zinc-100 text-[#090909] hover:bg-white" title="Continue in Discussion">
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </AstromarWorkspaceShell>
  );
}
