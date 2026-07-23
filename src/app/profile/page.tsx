'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Check,
  CircleGauge,
  CreditCard,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
import { formatCredits } from '@/lib/billing-plans';
import { displayEmail } from '@/lib/user-identifier';

type Profile = {
  id: string;
  email: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  wechatId: string | null;
  role: 'INVESTOR' | 'CANDIDATE';
};

type ArchivedConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

type SettingsView = 'account' | 'plan' | 'archive';

type BillingSummary = {
  mode: 'observe' | 'enforce';
  account: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
    lifetimeGrantedCredits: number;
    lifetimeSpentCredits: number;
    lifetimeRefundedCredits: number;
  };
  subscription: {
    planKey: string;
    planName: string;
    status: string;
    monthlyCredits: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  };
  recentLedger: Array<{
    id: string;
    type: string;
    amountCredits: number;
    reservedDeltaCredits: number;
    description: string;
    runId: string | null;
    threadId: string | null;
    threadTitle: string | null;
    metadata: unknown;
    createdAt: string;
  }>;
  recentUsage: Array<{
    id: string;
    runId: string;
    hermesModel: string | null;
    codexModel: string | null;
    hermesCredits: number;
    codexCredits: number;
    computedCredits: number;
    billedCredits: number;
    component: 'agent_task' | 'memory_review';
    sourceRunId: string;
    memoryReviewJobId: string | null;
    taskLabel: string | null;
    threadId: string | null;
    threadTitle: string | null;
    createdAt: string;
  }>;
};

const settingsTabs = [
  { key: 'account' as const, label: 'Account', icon: UserRound },
  { key: 'plan' as const, label: 'Plan & usage', icon: CreditCard },
  { key: 'archive' as const, label: 'Archived', icon: Archive },
];

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getInitials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.slice(0, 1).toUpperCase())
      .join('') || 'U'
  );
}

function usageTaskLabel(usage: BillingSummary['recentUsage'][number]) {
  return usage.taskLabel || usage.threadTitle || 'New discussion';
}

function shortRunId(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function ledgerTaskLabel(entry: BillingSummary['recentLedger'][number]) {
  if (entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)) {
    const taskLabel = (entry.metadata as Record<string, unknown>).taskLabel;
    if (typeof taskLabel === 'string' && taskLabel.trim()) return taskLabel.trim();
  }
  return entry.threadTitle;
}

export default function ProfilePage() {
  const [activeView, setActiveView] = useState<SettingsView>('account');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [wechatId, setWechatId] = useState('');

  const [archivedSessions, setArchivedSessions] = useState<ArchivedConversation[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(true);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archiveActionId, setArchiveActionId] = useState<string | null>(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const response = await fetch('/api/user/profile', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await response.json().catch(() => ({}))) as { user?: Profile; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || 'Failed to load account settings');
      setProfile(data.user);
      setNickname(data.user.nickname || '');
      setPhone(data.user.phone || '');
      setWechatId(data.user.wechatId || '');
    } catch (loadError) {
      setProfileError(loadError instanceof Error ? loadError.message : 'Failed to load account settings');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadArchivedSessions = useCallback(async () => {
    setArchivedLoading(true);
    setArchivedError(null);
    try {
      const response = await fetch('/api/investor/personal-agent?sessions=1&sessionStatus=archived', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await response.json().catch(() => ({}))) as {
        sessions?: ArchivedConversation[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || 'Failed to load archived conversations');
      setArchivedSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (loadError) {
      setArchivedError(loadError instanceof Error ? loadError.message : 'Failed to load archived conversations');
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  const loadBilling = useCallback(async () => {
    setBillingLoading(true);
    setBillingError(null);
    try {
      const response = await fetch('/api/billing/summary', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await response.json().catch(() => ({}))) as BillingSummary & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to load plan and usage');
      setBilling(data);
    } catch (loadError) {
      setBillingError(loadError instanceof Error ? loadError.message : 'Failed to load plan and usage');
    } finally {
      setBillingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    void loadArchivedSessions();
    void loadBilling();
  }, [loadArchivedSessions, loadBilling, loadProfile]);

  const filteredArchivedSessions = useMemo(() => {
    const query = archiveQuery.trim().toLowerCase();
    if (!query) return archivedSessions;
    return archivedSessions.filter((session) => (session.title || 'New discussion').toLowerCase().includes(query));
  }, [archiveQuery, archivedSessions]);

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!profile || saving) return;
    setSaving(true);
    setProfileError(null);
    setProfileSuccess(false);
    try {
      const response = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ nickname, phone, wechatId }),
      });
      const data = (await response.json().catch(() => ({}))) as { user?: Profile; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || 'Failed to save account settings');
      setProfile(data.user);
      setNickname(data.user.nickname || '');
      setPhone(data.user.phone || '');
      setWechatId(data.user.wechatId || '');
      setProfileSuccess(true);
      window.setTimeout(() => setProfileSuccess(false), 2200);
    } catch (saveError) {
      setProfileError(saveError instanceof Error ? saveError.message : 'Failed to save account settings');
    } finally {
      setSaving(false);
    }
  };

  const updateArchivedSession = async (
    session: ArchivedConversation,
    action: 'unarchive' | 'permanent_delete',
  ) => {
    if (archiveActionId) return;
    if (action === 'permanent_delete') {
      const confirmed = window.confirm(
        `Delete “${session.title || 'New discussion'}” permanently? This action cannot be undone.`,
      );
      if (!confirmed) return;
    }

    setArchiveActionId(session.id);
    setArchivedError(null);
    try {
      const response = await fetch('/api/investor/personal-agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action, threadId: session.id }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        archivedSessions?: ArchivedConversation[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || 'Failed to update archived conversation');
      setArchivedSessions(Array.isArray(data.archivedSessions) ? data.archivedSessions : []);
    } catch (actionError) {
      setArchivedError(actionError instanceof Error ? actionError.message : 'Failed to update archived conversation');
    } finally {
      setArchiveActionId(null);
    }
  };

  const displayName = profile?.nickname || profile?.name || 'Astromar user';

  return (
    <AstromarWorkspaceShell mobileTitle="Settings">
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] md:grid-rows-[64px_minmax(0,1fr)]">
        <header className="hidden items-center justify-between border-b border-white/[0.09] px-6 md:flex">
          <div>
            <strong className="block text-[13px] text-zinc-100">Settings</strong>
            <span className="mt-0.5 block text-[10px] text-zinc-600">Account and workspace</span>
          </div>
        </header>

        <main className="astromar-scrollbar min-h-0 min-w-0 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto grid w-full max-w-[1080px] grid-cols-1 gap-7 md:grid-cols-[170px_minmax(0,760px)] md:gap-8 lg:grid-cols-[190px_minmax(0,760px)] lg:gap-[52px]">
            <nav className="astromar-scrollbar -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 md:sticky md:top-0 md:mx-0 md:grid md:self-start md:overflow-visible md:px-0" aria-label="Settings sections">
              <p className="mb-2 hidden px-2.5 text-[10px] font-extrabold uppercase text-zinc-600 md:block">Settings</p>
              {settingsTabs.map((tab) => {
                const Icon = tab.icon;
                const active = activeView === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveView(tab.key)}
                    className={`flex min-h-[38px] shrink-0 items-center gap-2.5 rounded-[7px] px-2.5 text-left text-xs transition-colors md:w-full ${
                      active
                        ? 'bg-white/[0.075] text-white'
                        : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{tab.label}</span>
                    {tab.key === 'plan' ? (
                      <small className="ml-auto hidden text-[9px] text-zinc-600 md:block">
                        {billing?.subscription.planName || 'Free'}
                      </small>
                    ) : null}
                    {tab.key === 'archive' ? (
                      <small className="ml-auto hidden text-[9px] text-zinc-600 md:block">{archivedSessions.length}</small>
                    ) : null}
                  </button>
                );
              })}
            </nav>

            <div className="min-w-0">
              {activeView === 'account' ? (
                <section>
                  <div className="mb-7">
                    <h1 className="text-[28px] font-bold leading-tight text-zinc-50">Account</h1>
                    <p className="mt-2 text-[13px] text-zinc-400">Profile and contact details used across your workspace.</p>
                  </div>

                  {profileLoading ? (
                    <div className="flex min-h-56 items-center justify-center border-b border-white/[0.09] text-xs text-zinc-500">
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      Loading account settings
                    </div>
                  ) : profile ? (
                    <>
                      <section className="mb-7 border-b border-white/[0.09] pb-8">
                        <div className="mb-4">
                          <h2 className="text-sm font-semibold text-zinc-100">Profile</h2>
                          <p className="mt-1 text-[11px] text-zinc-600">Your identity and contact details inside Astromar.</p>
                        </div>

                        <div className="mb-5 grid grid-cols-[52px_minmax(0,1fr)] items-center gap-3.5 py-2">
                          <span className="grid h-[52px] w-[52px] place-items-center rounded-[8px] bg-[#d9dce1] text-sm font-extrabold text-[#171717]">
                            {getInitials(displayName)}
                          </span>
                          <span className="grid min-w-0">
                            <strong className="truncate text-[13px] text-zinc-100">{displayName}</strong>
                            <span className="mt-1 truncate text-[11px] text-zinc-600">Founder workspace</span>
                          </span>
                        </div>

                        <form onSubmit={saveProfile}>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold text-zinc-400">
                              Display name
                              <input
                                value={nickname}
                                onChange={(event) => setNickname(event.target.value)}
                                autoComplete="name"
                                placeholder="Display name"
                                className="h-[42px] min-w-0 rounded-[7px] border border-white/[0.09] bg-white/[0.03] px-3 text-xs font-normal text-white outline-none placeholder:text-zinc-700 hover:border-white/15 focus:border-[#8eb3ff]/40 focus:ring-2 focus:ring-[#8eb3ff]/[0.07]"
                              />
                            </label>
                            <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold text-zinc-400">
                              Email
                              <input
                                value={displayEmail(profile.email)}
                                readOnly
                                className="h-[42px] min-w-0 cursor-not-allowed rounded-[7px] border border-white/[0.09] bg-white/[0.02] px-3 text-xs font-normal text-zinc-600 outline-none"
                              />
                            </label>
                            <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold text-zinc-400">
                              Phone
                              <input
                                value={phone}
                                onChange={(event) => setPhone(event.target.value)}
                                autoComplete="tel"
                                placeholder="Phone number"
                                className="h-[42px] min-w-0 rounded-[7px] border border-white/[0.09] bg-white/[0.03] px-3 text-xs font-normal text-white outline-none placeholder:text-zinc-700 hover:border-white/15 focus:border-[#8eb3ff]/40 focus:ring-2 focus:ring-[#8eb3ff]/[0.07]"
                              />
                            </label>
                            <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold text-zinc-400">
                              WeChat ID
                              <input
                                value={wechatId}
                                onChange={(event) => setWechatId(event.target.value)}
                                autoComplete="off"
                                placeholder="WeChat ID"
                                className="h-[42px] min-w-0 rounded-[7px] border border-white/[0.09] bg-white/[0.03] px-3 text-xs font-normal text-white outline-none placeholder:text-zinc-700 hover:border-white/15 focus:border-[#8eb3ff]/40 focus:ring-2 focus:ring-[#8eb3ff]/[0.07]"
                              />
                            </label>
                          </div>

                          {profileError ? (
                            <p className="mt-4 rounded-[7px] border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] text-red-200">{profileError}</p>
                          ) : null}

                          <div className="mt-5 flex justify-stretch sm:justify-end">
                            <button
                              type="submit"
                              disabled={saving}
                              className={`inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-[7px] border px-3.5 text-[11px] font-bold transition-colors sm:w-auto ${
                                profileSuccess
                                  ? 'border-[#46d19a]/30 bg-[#46d19a]/10 text-[#46d19a]'
                                  : 'border-white bg-[#f3f3f1] text-[#101010] hover:bg-white disabled:cursor-not-allowed disabled:opacity-55'
                              }`}
                            >
                              {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : profileSuccess ? <Check className="h-3.5 w-3.5" /> : null}
                              {saving ? 'Saving...' : profileSuccess ? 'Saved' : 'Save changes'}
                            </button>
                          </div>
                        </form>
                      </section>

                      <section>
                        <h2 className="text-sm font-semibold text-zinc-100">Sign-in</h2>
                        <p className="mt-1 text-[11px] text-zinc-600">Authentication method for this account.</p>
                        <div className="mt-4 grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-y border-white/[0.09]">
                          <span className="grid min-w-0">
                            <strong className="text-xs text-zinc-100">Email</strong>
                            <span className="mt-1 truncate text-[10px] text-zinc-600">{displayEmail(profile.email)}</span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#46d19a]">
                            <Check className="h-3.5 w-3.5" /> Verified
                          </span>
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="rounded-[8px] border border-red-400/20 bg-red-400/[0.06] p-4 text-xs text-red-200">
                      <p>{profileError || 'Account settings are unavailable.'}</p>
                      <button type="button" onClick={() => void loadProfile()} className="mt-3 font-bold text-white hover:underline">Retry</button>
                    </div>
                  )}
                </section>
              ) : null}

              {activeView === 'plan' ? (
                <section>
                  <div className="mb-7">
                    <h1 className="text-[28px] font-bold leading-tight text-zinc-50">Plan & usage</h1>
                    <p className="mt-2 text-[13px] text-zinc-400">Credits, task usage, and subscription details.</p>
                  </div>

                  {billingLoading ? (
                    <div className="flex min-h-56 items-center justify-center border-y border-white/[0.09] text-xs text-zinc-500">
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      Loading plan and usage
                    </div>
                  ) : billing ? (
                    <>
                      <section className="grid gap-3 border-b border-white/[0.09] pb-7 sm:grid-cols-3">
                        <UsageMetric
                          label="Available"
                          value={formatCredits(billing.account.availableCredits)}
                          detail={
                            billing.account.balanceCredits < 0
                              ? `${formatCredits(Math.abs(billing.account.balanceCredits))} credits outstanding`
                              : 'credits ready to use'
                          }
                          icon={Sparkles}
                        />
                        <UsageMetric
                          label="Reserved"
                          value={formatCredits(billing.account.reservedCredits)}
                          detail="held by active tasks"
                          icon={CircleGauge}
                        />
                        <UsageMetric
                          label="Lifetime usage"
                          value={formatCredits(billing.account.lifetimeSpentCredits)}
                          detail="credits billed"
                          icon={CreditCard}
                        />
                      </section>

                      <section className="grid min-h-[82px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-white/[0.09] py-5">
                        <span className="grid">
                          <span className="text-[10px] text-zinc-600">Current plan</span>
                          <strong className="mt-1 text-[15px] text-zinc-100">{billing.subscription.planName}</strong>
                          <span className="mt-1 text-[10px] text-zinc-600">
                            {formatCredits(billing.subscription.monthlyCredits)} included credits
                            {billing.mode === 'observe' ? ' · usage preview' : ''}
                          </span>
                        </span>
                        <Link
                          href="/pricing"
                          className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-white/[0.09] bg-white/[0.035] px-3 text-[11px] font-bold text-zinc-300 hover:border-white/15 hover:bg-white/[0.055] hover:text-white"
                        >
                          View plans
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </section>

                      <section className="pt-7">
                        <div className="flex items-end justify-between gap-5">
                          <div>
                            <h2 className="text-sm font-semibold text-zinc-100">Consumption details</h2>
                            <p className="mt-1 text-[11px] text-zinc-600">Task execution and post-turn memory review are billed separately.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void loadBilling()}
                            className="grid h-8 w-8 place-items-center rounded-[7px] text-zinc-600 hover:bg-white/[0.05] hover:text-white"
                            title="Refresh usage"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="mt-4 border-y border-white/[0.09]">
                          {billing.recentUsage.length > 0 ? billing.recentUsage.map((usage) => (
                            <article key={usage.id} className="grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-white/[0.09] py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_110px_90px]">
                              <span className="grid min-w-0">
                                <strong className="truncate text-xs text-zinc-200">
                                  {usage.component === 'memory_review'
                                    ? `Memory review · ${usageTaskLabel(usage)}`
                                    : usageTaskLabel(usage)}
                                </strong>
                                <span className="mt-1 truncate text-[10px] text-zinc-600">
                                  {usage.component === 'memory_review'
                                    ? `${usage.hermesModel?.includes('claude') ? 'Claude' : 'Hermes'} profile review · task ${shortRunId(usage.sourceRunId)}`
                                    : `Hermes ${formatCredits(usage.hermesCredits)} · Codex ${formatCredits(usage.codexCredits)}`}
                                </span>
                              </span>
                              <span className="hidden text-[10px] text-zinc-600 sm:block">{formatDateTime(usage.createdAt)}</span>
                              <span className="text-right">
                                <strong className="block text-xs text-zinc-200">
                                  {formatCredits(billing.mode === 'enforce' ? usage.billedCredits : usage.computedCredits)}
                                </strong>
                                <span className="text-[9px] uppercase text-zinc-700">
                                  {billing.mode === 'enforce' ? 'billed' : 'projected'}
                                </span>
                              </span>
                            </article>
                          )) : (
                            <div className="flex min-h-28 items-center justify-center px-4 text-center text-xs text-zinc-600">
                              Completed task usage will appear here.
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="pt-7">
                        <h2 className="text-sm font-semibold text-zinc-100">Credit activity</h2>
                        <div className="mt-4 border-y border-white/[0.09]">
                          {billing.recentLedger.slice(0, 12).map((entry) => (
                            <article key={entry.id} className="grid min-h-[58px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-white/[0.09] py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_80px]">
                              <span className="grid min-w-0">
                                <strong className="truncate text-[11px] text-zinc-300">{entry.description}</strong>
                                <span className="mt-1 truncate text-[9px] text-zinc-700">
                                  {entry.type.replaceAll('_', ' ')}
                                  {ledgerTaskLabel(entry) ? ` · ${ledgerTaskLabel(entry)}` : ''}
                                </span>
                              </span>
                              <span className="hidden text-[10px] text-zinc-600 sm:block">{formatDateTime(entry.createdAt)}</span>
                              <strong className={`text-right text-[11px] ${
                                entry.amountCredits > 0 ? 'text-[#46d19a]' : entry.amountCredits < 0 ? 'text-zinc-200' : 'text-zinc-600'
                              }`}>
                                {entry.amountCredits > 0 ? '+' : ''}{formatSignedCredits(entry.amountCredits)}
                              </strong>
                            </article>
                          ))}
                        </div>
                      </section>
                    </>
                  ) : (
                    <div className="rounded-[8px] border border-red-400/20 bg-red-400/[0.06] p-4 text-xs text-red-200">
                      <p>{billingError || 'Plan and usage details are unavailable.'}</p>
                      <button type="button" onClick={() => void loadBilling()} className="mt-3 font-bold text-white hover:underline">Retry</button>
                    </div>
                  )}
                </section>
              ) : null}

              {activeView === 'archive' ? (
                <section>
                  <div className="mb-7">
                    <h1 className="text-[28px] font-bold leading-tight text-zinc-50">Archived conversations</h1>
                    <p className="mt-2 text-[13px] text-zinc-400">Restore discussions or remove them permanently.</p>
                  </div>

                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className="relative block w-full sm:max-w-[320px]">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
                      <input
                        value={archiveQuery}
                        onChange={(event) => setArchiveQuery(event.target.value)}
                        type="search"
                        placeholder="Search archived conversations"
                        className="h-9 w-full rounded-[7px] border border-white/[0.09] bg-white/[0.03] pl-9 pr-3 text-[11px] text-white outline-none placeholder:text-zinc-700 focus:border-white/20"
                      />
                    </label>
                    <div className="flex items-center justify-between gap-3 text-[10px] text-zinc-600 sm:justify-end">
                      <span>{filteredArchivedSessions.length} conversations</span>
                      <button
                        type="button"
                        onClick={() => void loadArchivedSessions()}
                        disabled={archivedLoading}
                        className="grid h-8 w-8 place-items-center rounded-[7px] text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-50"
                        title="Refresh archived conversations"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${archivedLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {archivedError ? (
                    <div className="mb-3 rounded-[7px] border border-red-400/20 bg-red-400/[0.06] px-3 py-2.5 text-[11px] text-red-200">{archivedError}</div>
                  ) : null}

                  <div className="border-y border-white/[0.09]">
                    {archivedLoading && archivedSessions.length === 0 ? (
                      <div className="flex min-h-32 items-center justify-center text-xs text-zinc-600">
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading archived conversations
                      </div>
                    ) : filteredArchivedSessions.length > 0 ? (
                      filteredArchivedSessions.map((session) => {
                        const busy = archiveActionId === session.id;
                        return (
                          <article key={session.id} className="grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-white/[0.09] py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_130px_76px]">
                            <span className="grid min-w-0">
                              <strong className="truncate text-xs text-zinc-100">{session.title || 'New discussion'}</strong>
                              <span className="mt-1 text-[10px] text-zinc-600">{session.messageCount} messages</span>
                            </span>
                            <span className="hidden text-[10px] text-zinc-600 sm:block">{formatDateTime(session.createdAt)}</span>
                            <span className="flex justify-end gap-1">
                              <button
                                type="button"
                                disabled={Boolean(archiveActionId)}
                                onClick={() => void updateArchivedSession(session, 'unarchive')}
                                className="grid h-[30px] w-[30px] place-items-center rounded-[7px] text-zinc-500 hover:bg-white/[0.055] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                title="Restore conversation"
                                aria-label={`Restore ${session.title || 'conversation'}`}
                              >
                                {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(archiveActionId)}
                                onClick={() => void updateArchivedSession(session, 'permanent_delete')}
                                className="grid h-[30px] w-[30px] place-items-center rounded-[7px] text-zinc-600 hover:bg-red-400/[0.065] hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                                title="Delete permanently"
                                aria-label={`Delete ${session.title || 'conversation'} permanently`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          </article>
                        );
                      })
                    ) : (
                      <div className="flex min-h-32 items-center justify-center px-4 text-center text-xs text-zinc-600">
                        {archiveQuery ? 'No archived conversations match this search.' : 'No archived conversations yet.'}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        </main>
      </div>
    </AstromarWorkspaceShell>
  );
}

function UsageMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof CreditCard;
}) {
  return (
    <div className="grid min-h-[112px] content-between rounded-[8px] border border-white/[0.09] bg-white/[0.025] p-4">
      <span className="flex items-center justify-between gap-4 text-[10px] text-zinc-600">
        {label}
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="grid">
        <strong className="text-[20px] text-zinc-100">{value}</strong>
        <span className="mt-1 text-[9px] text-zinc-700">{detail}</span>
      </span>
    </div>
  );
}

function formatSignedCredits(value: number) {
  if (value === 0) return '0';
  return `${value < 0 ? '-' : ''}${formatCredits(Math.abs(value))}`;
}
