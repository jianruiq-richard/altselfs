'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Check,
  CircleGauge,
  CreditCard,
  LoaderCircle,
  Mail,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { BillingCapacityPopover, type BillingCapacityData } from '@/components/billing-capacity-popover';
import { BillingPlanOverview } from '@/components/billing-plan-overview';
import { productBrand } from '@/lib/brand';
import { formatCredits, getBillingPlan } from '@/lib/billing-plans';
import { displayEmail } from '@/lib/user-identifier';
import {
  fetchWorkspaceJson,
  getWorkspaceCachedStale,
  setWorkspaceCached,
  WORKSPACE_CACHE_KEYS,
} from '@/lib/workspace-client-cache';

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
    concurrentTaskLimit: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    scheduledPlanKey: string | null;
    graceEndsAt: string | null;
  };
  capacity: {
    activeTaskCount: number;
    availableTaskSlots: number;
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
  recentPayments: Array<{
    id: string;
    kind: 'SUBSCRIPTION' | 'CREDIT_PACK' | string;
    status: string;
    planKey: string | null;
    packKey: string | null;
    creditsGranted: number;
    creditsReversed: number;
    amountSubtotalCents: number;
    amountTotalCents: number;
    refundedAmountCents: number;
    currency: string;
    providerInvoiceId: string | null;
    usedSinceGrant: number;
    lotRemainingCredits: number;
    standardRefundEligible: boolean;
    paidAt: string | null;
    refundedAt: string | null;
    createdAt: string;
  }>;
  refundPolicy: {
    contactEmail: string;
    usageLimitCredits: number;
    selfService: false;
  };
};

type BillingDetails = Pick<BillingSummary, 'recentLedger' | 'recentUsage' | 'recentPayments' | 'refundPolicy'>;

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

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(Math.max(0, amountCents) / 100);
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

function paymentTitle(payment: BillingSummary['recentPayments'][number]) {
  if (payment.kind === 'CREDIT_PACK') {
    return `${formatCredits(payment.creditsGranted)} Credit pack`;
  }
  if (!payment.planKey) return 'Subscription';
  return `${getBillingPlan(payment.planKey.toUpperCase()).name} plan`;
}

function billingSummaryFromCapacity(capacity: BillingCapacityData): BillingSummary {
  const plan = getBillingPlan(capacity.subscription.planKey);
  return {
    mode: capacity.mode,
    account: {
      balanceCredits: capacity.account.balanceCredits,
      reservedCredits: capacity.account.reservedCredits,
      availableCredits: capacity.account.availableCredits,
      lifetimeGrantedCredits: capacity.account.lifetimeGrantedCredits ?? capacity.account.balanceCredits,
      lifetimeSpentCredits: capacity.account.lifetimeSpentCredits ?? 0,
      lifetimeRefundedCredits: capacity.account.lifetimeRefundedCredits ?? 0,
    },
    subscription: {
      planKey: capacity.subscription.planKey,
      planName: capacity.subscription.planName || plan.name,
      status: capacity.subscription.status || 'active',
      monthlyCredits: capacity.subscription.monthlyCredits ?? plan.monthlyCredits,
      concurrentTaskLimit: capacity.subscription.concurrentTaskLimit,
      currentPeriodStart: capacity.subscription.currentPeriodStart ?? null,
      currentPeriodEnd: capacity.subscription.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: Boolean(capacity.subscription.cancelAtPeriodEnd),
      scheduledPlanKey: capacity.subscription.scheduledPlanKey ?? null,
      graceEndsAt: capacity.subscription.graceEndsAt ?? null,
    },
    capacity: {
      activeTaskCount: capacity.capacity.activeTaskCount,
      availableTaskSlots: capacity.capacity.availableTaskSlots,
    },
    recentLedger: [],
    recentUsage: [],
    recentPayments: [],
    refundPolicy: {
      contactEmail: productBrand.supportEmail,
      usageLimitCredits: 1_000,
      selfService: false,
    },
  };
}

function isBillingSummary(value: unknown): value is BillingSummary {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<BillingSummary>;
  return Boolean(record.account && record.subscription && record.capacity)
    && Array.isArray(record.recentLedger)
    && Array.isArray(record.recentUsage)
    && Array.isArray(record.recentPayments)
    && Boolean(record.refundPolicy);
}

function isBillingDetails(value: unknown): value is BillingDetails {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<BillingDetails>;
  return Array.isArray(record.recentLedger)
    && Array.isArray(record.recentUsage)
    && Array.isArray(record.recentPayments)
    && Boolean(record.refundPolicy);
}

function mergeBillingDetails(summary: BillingSummary, details: BillingDetails): BillingSummary {
  return {
    ...summary,
    recentLedger: details.recentLedger,
    recentUsage: details.recentUsage,
    recentPayments: details.recentPayments,
    refundPolicy: details.refundPolicy,
  };
}

function billingSummaryFromOverview(value: BillingCapacityData | BillingSummary): BillingSummary {
  return isBillingSummary(value) ? value : billingSummaryFromCapacity(value);
}

function BillingSectionLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center px-4 text-center text-xs text-zinc-600">
      <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" />
      {label}
    </div>
  );
}

export default function ProfilePage() {
  const cachedProfile = getWorkspaceCachedStale<{ user?: Profile }>(WORKSPACE_CACHE_KEYS.userProfile)?.user || null;
  const cachedBillingSummary = getWorkspaceCachedStale<BillingSummary>(WORKSPACE_CACHE_KEYS.billingSummary);
  const cachedBillingOverview = getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingOverview)
    || getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingCapacity);
  const cachedBillingDetails = getWorkspaceCachedStale<BillingDetails>(WORKSPACE_CACHE_KEYS.billingDetails);
  const cachedBillingDetailsLoaded = Boolean(cachedBillingSummary || cachedBillingDetails);
  const initialBilling = cachedBillingSummary
    || (cachedBillingOverview
      ? (cachedBillingDetails
          ? mergeBillingDetails(billingSummaryFromCapacity(cachedBillingOverview), cachedBillingDetails)
          : billingSummaryFromCapacity(cachedBillingOverview))
      : null);
  const [activeView, setActiveView] = useState<SettingsView>('account');
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [profileLoading, setProfileLoading] = useState(!profile);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [nickname, setNickname] = useState(cachedProfile?.nickname || '');
  const [phone, setPhone] = useState(cachedProfile?.phone || '');
  const [wechatId, setWechatId] = useState(cachedProfile?.wechatId || '');

  const [archivedSessions, setArchivedSessions] = useState<ArchivedConversation[]>(() => {
    const cached = getWorkspaceCachedStale<{ sessions?: ArchivedConversation[] }>(WORKSPACE_CACHE_KEYS.archivedSessions);
    return Array.isArray(cached?.sessions) ? cached.sessions : [];
  });
  const [archivedLoading, setArchivedLoading] = useState(archivedSessions.length === 0);
  const [archivedLoaded, setArchivedLoaded] = useState(archivedSessions.length > 0);
  const [archivedError, setArchivedError] = useState<string | null>(null);
  const [archiveActionId, setArchiveActionId] = useState<string | null>(null);
  const [archiveQuery, setArchiveQuery] = useState('');
  const [billing, setBilling] = useState<BillingSummary | null>(() => initialBilling);
  const [billingLoading, setBillingLoading] = useState(!billing);
  const [billingLoaded, setBillingLoaded] = useState(Boolean(billing));
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingDetailsLoading, setBillingDetailsLoading] = useState(false);
  const [billingDetailsLoaded, setBillingDetailsLoaded] = useState(cachedBillingDetailsLoaded);
  const [billingDetailsError, setBillingDetailsError] = useState<string | null>(null);
  const [billingPartial, setBillingPartial] = useState(Boolean(initialBilling && !cachedBillingDetailsLoaded));
  const [billingNotice, setBillingNotice] = useState<string | null>(null);
  const [billingAction, setBillingAction] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get('view');
    const billingStatus = params.get('billing');
    if (requestedView === 'account' || requestedView === 'plan' || requestedView === 'archive') {
      setActiveView(requestedView);
    }
    if (billingStatus === 'cancelled') {
      setActiveView('plan');
      setBillingNotice('Cancellation request received. Your plan remains available until the current billing period ends.');
    } else if (billingStatus === 'success') {
      setActiveView('plan');
      setBillingNotice('Billing updated.');
    }
  }, []);

  const loadProfile = useCallback(async () => {
    const cached = getWorkspaceCachedStale<{ user?: Profile }>(WORKSPACE_CACHE_KEYS.userProfile);
    if (cached?.user) {
      setProfile(cached.user);
      setNickname(cached.user.nickname || '');
      setPhone(cached.user.phone || '');
      setWechatId(cached.user.wechatId || '');
      setProfileLoading(false);
    } else {
      setProfileLoading(true);
    }
    setProfileError(null);
    try {
      const data = await fetchWorkspaceJson<{ user?: Profile }>(
        WORKSPACE_CACHE_KEYS.userProfile,
        '/api/user/profile',
        {},
        { force: true, ttlMs: 120_000 },
      );
      if (!data.user) throw new Error('Failed to load account settings');
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
    const cached = getWorkspaceCachedStale<{ sessions?: ArchivedConversation[] }>(WORKSPACE_CACHE_KEYS.archivedSessions);
    if (Array.isArray(cached?.sessions)) {
      setArchivedSessions(cached.sessions);
      setArchivedLoading(false);
      setArchivedLoaded(true);
    } else {
      setArchivedLoading(true);
    }
    setArchivedError(null);
    try {
      const data = await fetchWorkspaceJson<{ sessions?: ArchivedConversation[] }>(
        WORKSPACE_CACHE_KEYS.archivedSessions,
        '/api/investor/personal-agent?sessions=1&sessionStatus=archived',
        {},
        { force: true, ttlMs: 45_000 },
      );
      setArchivedSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (loadError) {
      setArchivedError(loadError instanceof Error ? loadError.message : 'Failed to load archived conversations');
    } finally {
      setArchivedLoading(false);
      setArchivedLoaded(true);
    }
  }, []);

  const loadBillingOverview = useCallback(async (options: { force?: boolean } = {}) => {
    const cachedSummary = getWorkspaceCachedStale<BillingSummary>(WORKSPACE_CACHE_KEYS.billingSummary);
    const cachedOverview = getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingOverview)
      || getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingCapacity);
    const cachedDetails = getWorkspaceCachedStale<BillingDetails>(WORKSPACE_CACHE_KEYS.billingDetails);
    if (cachedSummary) {
      setBilling(cachedSummary);
      setBillingPartial(false);
      setBillingDetailsLoaded(true);
      setBillingLoading(false);
    } else if (cachedOverview) {
      const overview = billingSummaryFromCapacity(cachedOverview);
      setBilling(cachedDetails ? mergeBillingDetails(overview, cachedDetails) : overview);
      setBillingPartial(!cachedDetails);
      setBillingLoading(false);
    } else {
      setBillingLoading(true);
    }
    setBillingError(null);
    try {
      const data = await fetchWorkspaceJson<BillingCapacityData | BillingSummary>(
        WORKSPACE_CACHE_KEYS.billingOverview,
        '/api/billing/summary?section=overview',
        {},
        { force: options.force ?? true, ttlMs: 45_000 },
      );
      const overview = billingSummaryFromOverview(data);
      setWorkspaceCached(WORKSPACE_CACHE_KEYS.billingCapacity, data);
      if (isBillingSummary(data)) {
        setWorkspaceCached(WORKSPACE_CACHE_KEYS.billingSummary, data);
        setBilling(data);
        setBillingDetailsLoaded(true);
        setBillingPartial(false);
      } else {
        const details = getWorkspaceCachedStale<BillingDetails>(WORKSPACE_CACHE_KEYS.billingDetails);
        setBilling(details ? mergeBillingDetails(overview, details) : overview);
        setBillingPartial(!details);
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load plan and usage';
      try {
        const cachedCapacity = getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingOverview)
          || getWorkspaceCachedStale<BillingCapacityData>(WORKSPACE_CACHE_KEYS.billingCapacity);
        const capacity = cachedCapacity || await fetchWorkspaceJson<BillingCapacityData>(
          WORKSPACE_CACHE_KEYS.billingCapacity,
          '/api/billing/capacity',
          {},
          { force: true, ttlMs: 30_000 },
        );
        setBilling(billingSummaryFromCapacity(capacity));
        setBillingPartial(true);
        setBillingError(`${message} Showing current plan from live capacity data.`);
      } catch {
        setBillingError(message);
      }
    } finally {
      setBillingLoading(false);
      setBillingLoaded(true);
    }
  }, []);

  const loadBillingDetails = useCallback(async (options: { force?: boolean } = {}) => {
    const cached = getWorkspaceCachedStale<BillingDetails>(WORKSPACE_CACHE_KEYS.billingDetails);
    if (cached) {
      setBilling((current) => current ? mergeBillingDetails(current, cached) : current);
      setBillingDetailsLoaded(true);
      setBillingDetailsLoading(false);
    } else {
      setBillingDetailsLoading(true);
    }
    setBillingDetailsError(null);
    try {
      const data = await fetchWorkspaceJson<BillingDetails | BillingSummary>(
        WORKSPACE_CACHE_KEYS.billingDetails,
        '/api/billing/summary?section=details',
        {},
        { force: options.force ?? true, ttlMs: 60_000 },
      );
      if (isBillingSummary(data)) {
        setWorkspaceCached(WORKSPACE_CACHE_KEYS.billingSummary, data);
        setBilling(data);
        setBillingPartial(false);
      } else if (isBillingDetails(data)) {
        setWorkspaceCached(WORKSPACE_CACHE_KEYS.billingDetails, data);
        setBilling((current) => current ? mergeBillingDetails(current, data) : current);
        setBillingPartial(false);
      }
      setBillingDetailsLoaded(true);
    } catch (loadError) {
      setBillingDetailsError(loadError instanceof Error ? loadError.message : 'Billing details are temporarily unavailable.');
      setBillingPartial(true);
    } finally {
      setBillingDetailsLoading(false);
    }
  }, []);

  const loadBilling = useCallback(async () => {
    await loadBillingOverview({ force: true });
    void loadBillingDetails({ force: true });
  }, [loadBillingDetails, loadBillingOverview]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (activeView !== 'archive' || archivedLoaded) return;
    void loadArchivedSessions();
  }, [activeView, archivedLoaded, loadArchivedSessions]);

  useEffect(() => {
    if (activeView !== 'plan' || billingLoaded) return;
    void loadBilling();
  }, [activeView, billingLoaded, loadBilling]);

  useEffect(() => {
    if (activeView !== 'plan' || !billingLoaded || billingDetailsLoaded || billingDetailsLoading) return;
    void loadBillingDetails();
  }, [activeView, billingDetailsLoaded, billingDetailsLoading, billingLoaded, loadBillingDetails]);

  const openBillingPortal = async () => {
    if (billingAction) return;
    setBillingAction('portal');
    setBillingError(null);
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error || 'Billing portal could not be opened.');
      window.location.assign(data.url);
    } catch (actionError) {
      setBillingError(actionError instanceof Error ? actionError.message : 'Billing portal could not be opened.');
    } finally {
      setBillingAction(null);
    }
  };

  const openCancellationPortal = async () => {
    if (billingAction) return;
    setBillingAction('cancel');
    setBillingError(null);
    try {
      const response = await fetch('/api/billing/change-plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ planKey: 'FREE' }),
      });
      const data = (await response.json().catch(() => ({}))) as { url?: string; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || 'Cancellation could not be started.');
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setBillingNotice(data.message || 'Cancellation is already scheduled at the end of the billing period.');
      await loadBilling();
    } catch (actionError) {
      setBillingError(actionError instanceof Error ? actionError.message : 'Cancellation could not be started.');
    } finally {
      setBillingAction(null);
    }
  };

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
      setWorkspaceCached(WORKSPACE_CACHE_KEYS.userProfile, { user: data.user });
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
      const nextArchivedSessions = Array.isArray(data.archivedSessions) ? data.archivedSessions : [];
      setArchivedSessions(nextArchivedSessions);
      setWorkspaceCached(WORKSPACE_CACHE_KEYS.archivedSessions, { sessions: nextArchivedSessions });
    } catch (actionError) {
      setArchivedError(actionError instanceof Error ? actionError.message : 'Failed to update archived conversation');
    } finally {
      setArchiveActionId(null);
    }
  };

  const displayName = profile?.nickname || profile?.name || `${productBrand.name} user`;

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)] md:grid-rows-[64px_minmax(0,1fr)]">
        <header className="hidden items-center justify-between border-b border-white/[0.09] px-6 md:flex">
          <div>
            <strong className="block text-[13px] text-zinc-100">Settings</strong>
            <span className="mt-0.5 block text-[10px] text-zinc-600">Account and workspace</span>
          </div>
          <BillingCapacityPopover />
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
                          <p className="mt-1 text-[11px] text-zinc-600">Your identity and contact details inside {productBrand.name}.</p>
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
                      {billingError ? (
                        <div className="mb-5 flex items-center justify-between gap-4 rounded-[7px] border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-[11px] text-red-200">
                          <span>{billingPartial ? `Limited view: ${billingError}` : billingError}</span>
                          <button
                            type="button"
                            onClick={() => setBillingError(null)}
                            className="shrink-0 font-bold text-white hover:underline"
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : null}
                      {billingNotice ? (
                        <div className="mb-5 flex items-center justify-between gap-4 rounded-[7px] border border-[#8eb3ff]/20 bg-[#8eb3ff]/[0.06] px-4 py-3 text-[11px] text-[#a9c5ff]">
                          <span>{billingNotice}</span>
                          <button
                            type="button"
                            onClick={() => setBillingNotice(null)}
                            className="shrink-0 font-bold text-white hover:underline"
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : null}
                      {billingDetailsError ? (
                        <div className="mb-5 flex items-center justify-between gap-4 rounded-[7px] border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-[11px] text-amber-100">
                          <span>Usage, payment, and ledger details are temporarily unavailable.</span>
                          <button
                            type="button"
                            onClick={() => void loadBillingDetails({ force: true })}
                            className="shrink-0 font-bold text-white hover:underline"
                          >
                            Retry details
                          </button>
                        </div>
                      ) : null}
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

                      <section className="border-b border-white/[0.09] py-7">
                        <BillingPlanOverview
                          subscription={billing.subscription}
                          capacity={billing.capacity}
                          actions={(
                            <span className="flex flex-wrap gap-2">
                              {billing.subscription.planKey !== 'FREE' ? (
                                <button
                                  type="button"
                                  onClick={() => void openBillingPortal()}
                                  disabled={Boolean(billingAction)}
                                  className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-white/[0.09] bg-white/[0.035] px-3 text-[11px] font-bold text-zinc-300 hover:border-white/15 hover:bg-white/[0.055] hover:text-white disabled:cursor-not-allowed disabled:text-zinc-600"
                                >
                                  {billingAction === 'portal' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                                  Manage billing
                                </button>
                              ) : null}
                              {billing.subscription.planKey !== 'FREE' && billing.subscription.cancelAtPeriodEnd ? (
                                <span className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-amber-300/20 bg-amber-300/[0.06] px-3 text-[11px] font-bold text-amber-200">
                                  Cancellation scheduled
                                </span>
                              ) : billing.subscription.planKey !== 'FREE' ? (
                                <button
                                  type="button"
                                  onClick={() => void openCancellationPortal()}
                                  disabled={Boolean(billingAction)}
                                  className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-red-300/15 bg-red-300/[0.045] px-3 text-[11px] font-bold text-red-200 hover:border-red-300/25 hover:bg-red-300/[0.07] disabled:cursor-not-allowed disabled:text-zinc-600"
                                >
                                  {billingAction === 'cancel' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                                  Cancel subscription
                                </button>
                              ) : null}
                              <Link
                                href="/pricing"
                                className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-white/[0.09] bg-white/[0.035] px-3 text-[11px] font-bold text-zinc-300 hover:border-white/15 hover:bg-white/[0.055] hover:text-white"
                              >
                                View plans
                                <ArrowRight className="h-3.5 w-3.5" />
                              </Link>
                            </span>
                          )}
                        />
                      </section>

                      <section className="pt-7">
                        <div className="flex items-end justify-between gap-5">
                          <div>
                            <h2 className="text-sm font-semibold text-zinc-100">Payments</h2>
                            <p className="mt-1 text-[11px] text-zinc-600">Subscription invoices and permanent Credit packs.</p>
                          </div>
                          <ReceiptText className="h-4 w-4 text-zinc-700" />
                        </div>

                        <div className="mt-4 border-y border-white/[0.09]">
                          {billingDetailsLoading && !billingDetailsLoaded ? (
                            <BillingSectionLoading label="Loading payments" />
                          ) : billing.recentPayments.length > 0 ? billing.recentPayments.map((payment) => (
                            <article key={payment.id} className="grid min-h-[68px] grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-white/[0.09] py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_120px_100px]">
                              <span className="grid min-w-0">
                                <strong className="truncate text-xs text-zinc-200">
                                  {paymentTitle(payment)}
                                </strong>
                                <span className="mt-1 truncate text-[10px] text-zinc-600">
                                  {payment.status.toLowerCase().replaceAll('_', ' ')}
                                  {payment.creditsReversed > 0
                                    ? ` · ${formatCredits(payment.creditsReversed)} Credits reversed`
                                    : ''}
                                  {` · ${formatCredits(payment.lotRemainingCredits)} Credits remaining`}
                                </span>
                              </span>
                              <span className="hidden text-[10px] text-zinc-600 sm:block">
                                {formatDateTime(payment.paidAt || payment.createdAt)}
                              </span>
                              <span className="text-right">
                                <strong className="block text-xs text-zinc-200">
                                  {formatMoney(payment.amountTotalCents, payment.currency)}
                                </strong>
                                <span className="text-[9px] uppercase text-zinc-700">{payment.status}</span>
                              </span>
                            </article>
                          )) : (
                            <div className="flex min-h-28 items-center justify-center px-4 text-center text-xs text-zinc-600">
                              Completed Stripe payments will appear here.
                            </div>
                          )}
                        </div>

                        <div className="mt-4 flex gap-3 rounded-[7px] border border-white/[0.09] bg-white/[0.025] p-4">
                          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#8eb3ff]" />
                          <span className="grid">
                            <strong className="text-[11px] text-zinc-300">Refunds are reviewed manually</strong>
                            <span className="mt-1 text-[10px] leading-5 text-zinc-600">
                              Email{' '}
                              <a className="text-zinc-300 hover:text-white" href={`mailto:${billing.refundPolicy.contactEmail}`}>
                                {billing.refundPolicy.contactEmail}
                              </a>
                              . For non-platform issues, requests are eligible when no more than{' '}
                              {formatCredits(billing.refundPolicy.usageLimitCredits)} Credits have been used from that purchase batch.
                            </span>
                          </span>
                        </div>
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
                          {billingDetailsLoading && !billingDetailsLoaded ? (
                            <BillingSectionLoading label="Loading usage details" />
                          ) : billing.recentUsage.length > 0 ? billing.recentUsage.map((usage) => (
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
                          {billingDetailsLoading && !billingDetailsLoaded ? (
                            <BillingSectionLoading label="Loading credit activity" />
                          ) : billing.recentLedger.length > 0 ? billing.recentLedger.slice(0, 12).map((entry) => (
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
                          )) : (
                            <div className="flex min-h-24 items-center justify-center px-4 text-center text-xs text-zinc-600">
                              Credit activity will appear here.
                            </div>
                          )}
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
