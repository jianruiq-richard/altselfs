'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CreditCard,
  LoaderCircle,
  Search,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { formatCredits } from '@/lib/billing-plans';

type AdminUserListItem = {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  nickname: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
  billing: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
    lifetimeSpentCredits: number;
    planKey: string;
    planName: string;
    subscriptionStatus: string;
    monthlyCredits: number;
  };
  counts: {
    agentThreads: number;
    executiveRuns: number;
    usageRecords: number;
    ledgerEntries: number;
  };
};

type AdminUserDetail = {
  user: {
    id: string;
    clerkId: string;
    email: string;
    name: string | null;
    nickname: string | null;
    phone: string | null;
    wechatId: string | null;
    role: string;
    createdAt: string;
    updatedAt: string;
  };
  account: {
    id: string | null;
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
    lifetimeGrantedCredits: number;
    lifetimeSpentCredits: number;
    lifetimeRefundedCredits: number;
    createdAt: string | null;
    updatedAt: string | null;
  };
  subscription: {
    id: string | null;
    planKey: string;
    planName: string;
    status: string;
    monthlyCredits: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    provider: string | null;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
  };
  threads: ThreadSummary[];
  ledger: LedgerEntry[];
  usageRecords: UsageRecord[];
  reservations: ReservationRecord[];
  executiveRuns: ExecutiveRunRecord[];
  contextRuns: ContextRunRecord[];
  resourceUsage: {
    appDbBytes: number | null;
    agentRdsBytes: number | null;
    ecsDiskBytes: number | null;
    agentMessages: number;
    agentArtifacts: number;
    agentRuns: number;
    agentThreads: number;
    warning: string | null;
  };
};

type ThreadSummary = {
  id: string;
  agentType: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  toolCallCount: number;
  lastMessagePreview: string;
  lastMessageAt: string | null;
};

type LedgerEntry = {
  id: string;
  type: string;
  amountCredits: number;
  reservedDeltaCredits: number;
  balanceAfterCredits: number;
  reservedAfterCredits: number;
  description: string;
  runId: string | null;
  threadId: string | null;
  threadTitle: string | null;
  metadata: unknown;
  createdAt: string;
};

type UsageRecord = {
  id: string;
  runId: string;
  status: string;
  hermesModel: string | null;
  codexModel: string | null;
  hermesCostUsd: number;
  hermesCredits: number;
  codexCredits: number;
  computedCredits: number;
  billedCredits: number;
  pricingVersion: string;
  usage: unknown;
  threadId: string | null;
  threadTitle: string | null;
  createdAt: string;
};

type ReservationRecord = {
  id: string;
  runId: string;
  status: string;
  mode: string;
  hermesModel: string | null;
  estimatedCredits: number;
  reservedCredits: number;
  capturedCredits: number;
  shortfallCredits: number;
  threadId: string | null;
  threadTitle: string | null;
  expiresAt: string;
  settledAt: string | null;
  createdAt: string;
};

type ExecutiveRunRecord = {
  id: string;
  status: string;
  request: unknown;
  result: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ContextRunRecord = {
  id: string;
  investorId: string;
  threadId: string;
  status: string;
  route: string | null;
  request: unknown;
  executionRequest: unknown;
  result: unknown;
  error: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  workerId: string | null;
  attemptCount: number;
  modelProvider: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
};

type AdminThreadDetail = {
  thread: {
    id: string;
    agentType: string;
    title: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    toolCallCount: number;
    investor: { id: string; email: string; name: string | null };
  };
  messages: Array<{
    id: string;
    role: string;
    content: string;
    meta: unknown;
    createdAt: string;
  }>;
  toolCalls: Array<{
    id: string;
    toolName: string;
    status: string;
    toolArgs: unknown;
    toolResult: unknown;
    messageId: string | null;
    createdAt: string;
  }>;
  contextRuns: ContextRunRecord[];
  contextToolCalls: Array<{
    id: string;
    runId: string | null;
    toolName: string;
    status: string;
    toolArgs: unknown;
    toolResult: unknown;
    createdAt: string;
  }>;
  runEvents: Array<{
    id: string;
    runId: string;
    type: string;
    payload: unknown;
    createdAt: string;
  }>;
  artifacts: Array<{
    id: string;
    runId: string | null;
    kind: string;
    name: string;
    mimeType: string | null;
    sizeBytes: number;
    contentPreview: string;
    metadata: unknown;
    createdAt: string;
  }>;
};

const PLAN_OPTIONS = ['FREE', 'STARTER', 'PRO', 'SCALE'];
const SUBSCRIPTION_STATUS_OPTIONS = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELLED'];

export function AdminUsersClient({ adminName }: { adminName: string }) {
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadDetail, setThreadDetail] = useState<AdminThreadDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditForm, setCreditForm] = useState({ action: 'GRANT', amountCredits: '1000', reason: '' });
  const [subscriptionForm, setSubscriptionForm] = useState({
    planKey: 'FREE',
    status: 'ACTIVE',
    monthlyCredits: '1000',
    currentPeriodStart: '',
    currentPeriodEnd: '',
    provider: '',
    providerCustomerId: '',
    providerSubscriptionId: '',
    reason: '',
  });
  const [saving, setSaving] = useState<'credits' | 'subscription' | null>(null);

  const loadUsers = useCallback(async (nextQuery = query) => {
    setUsersLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '40');
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      const data = await fetchJson<{ users: AdminUserListItem[] }>(`/api/admin/users?${params.toString()}`);
      setUsers(data.users);
      setSelectedUserId((current) => current || data.users[0]?.id || null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setUsersLoading(false);
    }
  }, [query]);

  const loadDetail = useCallback(async (userId: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const data = await fetchJson<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(userId)}`);
      setDetail(data);
      setSelectedThreadId((current) => {
        if (current && data.threads.some((thread) => thread.id === current)) return current;
        return data.threads[0]?.id || null;
      });
      setSubscriptionForm({
        planKey: data.subscription.planKey,
        status: data.subscription.status,
        monthlyCredits: String(data.subscription.monthlyCredits),
        currentPeriodStart: toDateInputValue(data.subscription.currentPeriodStart),
        currentPeriodEnd: toDateInputValue(data.subscription.currentPeriodEnd),
        provider: data.subscription.provider || '',
        providerCustomerId: data.subscription.providerCustomerId || '',
        providerSubscriptionId: data.subscription.providerSubscriptionId || '',
        reason: '',
      });
    } catch (loadError) {
      setError(errorMessage(loadError));
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadThreadDetail = useCallback(async (threadId: string) => {
    setThreadLoading(true);
    setError(null);
    try {
      const data = await fetchJson<AdminThreadDetail>(`/api/admin/threads/${encodeURIComponent(threadId)}?limit=220`);
      setThreadDetail(data);
    } catch (loadError) {
      setError(errorMessage(loadError));
      setThreadDetail(null);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers('');
  }, [loadUsers]);

  useEffect(() => {
    if (selectedUserId) void loadDetail(selectedUserId);
  }, [loadDetail, selectedUserId]);

  useEffect(() => {
    if (selectedThreadId) {
      void loadThreadDetail(selectedThreadId);
    } else {
      setThreadDetail(null);
    }
  }, [loadThreadDetail, selectedThreadId]);

  const selectedUser = useMemo(() => users.find((user) => user.id === selectedUserId) || null, [selectedUserId, users]);

  async function adjustCredits(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || saving) return;
    setSaving('credits');
    setError(null);
    try {
      await fetchJson(`/api/admin/users/${encodeURIComponent(detail.user.id)}/credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: creditForm.action,
          amountCredits: Number(creditForm.amountCredits),
          reason: creditForm.reason,
        }),
      });
      setCreditForm((current) => ({ ...current, reason: '' }));
      await Promise.all([loadUsers(query), loadDetail(detail.user.id)]);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(null);
    }
  }

  async function updateSubscription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail || saving) return;
    setSaving('subscription');
    setError(null);
    try {
      await fetchJson(`/api/admin/users/${encodeURIComponent(detail.user.id)}/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planKey: subscriptionForm.planKey,
          status: subscriptionForm.status,
          monthlyCredits: Number(subscriptionForm.monthlyCredits),
          currentPeriodStart: fromDateInputValue(subscriptionForm.currentPeriodStart),
          currentPeriodEnd: fromDateInputValue(subscriptionForm.currentPeriodEnd),
          provider: subscriptionForm.provider,
          providerCustomerId: subscriptionForm.providerCustomerId,
          providerSubscriptionId: subscriptionForm.providerSubscriptionId,
          reason: subscriptionForm.reason,
        }),
      });
      await Promise.all([loadUsers(query), loadDetail(detail.user.id)]);
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1800px] px-5 py-5">
        <header className="mb-5 flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-slate-400">Altselfs operations</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-normal">User Admin</h1>
            <p className="mt-2 text-sm text-slate-400">
              Signed in as {adminName}. Reads are on demand; no background jobs run from this page.
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/admin/ops"
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 hover:bg-white/10"
            >
              Ops dashboard
            </a>
            <a
              href="/dashboard"
              className="rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-100 hover:bg-sky-500/20"
            >
              Back to workspace
            </a>
          </div>
        </header>

        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-white/10 bg-white/[0.03]">
            <form
              className="flex items-center gap-2 border-b border-white/10 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void loadUsers(query);
              }}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-black/20 px-3 py-2">
                <Search className="h-4 w-4 text-slate-500" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search user, email, Clerk ID"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
                />
              </div>
              <button
                type="submit"
                className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
              >
                Search
              </button>
            </form>

            <div className="max-h-[calc(100vh-180px)] overflow-y-auto p-2">
              {usersLoading ? <LoadingRow label="Loading users" /> : null}
              {!usersLoading && users.length === 0 ? <EmptyState label="No users found." /> : null}
              {users.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedUserId(user.id)}
                  className={`mb-2 w-full rounded-lg border p-3 text-left transition ${
                    user.id === selectedUserId
                      ? 'border-sky-400/70 bg-sky-500/10'
                      : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{user.name || user.nickname || user.email}</p>
                      <p className="mt-1 truncate text-xs text-slate-400">{user.email}</p>
                    </div>
                    <StatusPill status={user.billing.subscriptionStatus} />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <span>{user.billing.planName}</span>
                    <span className="text-right">{formatCredits(user.billing.availableCredits)} available</span>
                    <span>{user.counts.agentThreads} discussions</span>
                    <span className="text-right">{user.counts.usageRecords} usage rows</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0">
            {!selectedUser ? (
              <EmptyState label="Select a user to inspect billing and conversations." />
            ) : detailLoading || !detail ? (
              <LoadingPanel label="Loading user detail" />
            ) : (
              <div className="space-y-5">
                <UserHeader detail={detail} />

                <section className="grid gap-4 xl:grid-cols-4">
                  <MetricCard icon={WalletCards} label="Available credits" value={formatCredits(detail.account.availableCredits)} />
                  <MetricCard icon={CreditCard} label="Balance / reserved" value={`${formatCredits(detail.account.balanceCredits)} / ${formatCredits(detail.account.reservedCredits)}`} />
                  <MetricCard icon={CheckCircle2} label="Lifetime spent" value={formatCredits(detail.account.lifetimeSpentCredits)} />
                  <MetricCard icon={Clock3} label="Recent runs" value={String(detail.contextRuns.length)} />
                </section>

                <ResourceUsagePanel usage={detail.resourceUsage} />

                <section className="grid gap-4 xl:grid-cols-2">
                  <CreditAdjustmentForm
                    form={creditForm}
                    saving={saving === 'credits'}
                    onChange={setCreditForm}
                    onSubmit={adjustCredits}
                  />
                  <SubscriptionForm
                    form={subscriptionForm}
                    saving={saving === 'subscription'}
                    onChange={setSubscriptionForm}
                    onSubmit={updateSubscription}
                  />
                </section>

                <section className="grid gap-5 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="space-y-5">
                    <BillingTables detail={detail} />
                    <RunTables detail={detail} />
                  </div>
                  <ThreadInspector
                    threads={detail.threads}
                    selectedThreadId={selectedThreadId}
                    threadDetail={threadDetail}
                    loading={threadLoading}
                    onSelectThread={setSelectedThreadId}
                  />
                </section>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function UserHeader({ detail }: { detail: AdminUserDetail }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/10">
            <UserRound className="h-6 w-6 text-slate-300" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold">{detail.user.name || detail.user.nickname || detail.user.email}</h2>
            <p className="mt-1 text-sm text-slate-400">{detail.user.email}</p>
            <p className="mt-2 font-mono text-xs text-slate-500">{detail.user.id}</p>
          </div>
        </div>
        <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2 xl:min-w-[520px]">
          <KeyValue label="Role" value={detail.user.role} />
          <KeyValue label="Clerk ID" value={detail.user.clerkId} mono />
          <KeyValue label="Phone" value={detail.user.phone || 'Not set'} />
          <KeyValue label="WeChat" value={detail.user.wechatId || 'Not set'} />
          <KeyValue label="Created" value={formatDateTime(detail.user.createdAt)} />
          <KeyValue label="Updated" value={formatDateTime(detail.user.updatedAt)} />
        </div>
      </div>
    </section>
  );
}

function ResourceUsagePanel({ usage }: { usage: AdminUserDetail['resourceUsage'] }) {
  return (
    <Panel title="Resource footprint" subtitle="Loaded on demand for the selected user only.">
      {usage.warning ? (
        <div className="mb-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Agent resource detail unavailable: {usage.warning}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <FootprintItem label="Product DB estimate" value={formatBytes(usage.appDbBytes)} />
        <FootprintItem label="Agent RDS estimate" value={formatBytes(usage.agentRdsBytes)} />
        <FootprintItem label="ECS workspace disk" value={formatBytes(usage.ecsDiskBytes)} />
      </div>
      <div className="mt-3 grid gap-3 text-sm text-slate-400 sm:grid-cols-4">
        <FootprintItem label="Agent messages" value={usage.agentMessages.toLocaleString()} compact />
        <FootprintItem label="Artifacts" value={usage.agentArtifacts.toLocaleString()} compact />
        <FootprintItem label="Runs" value={usage.agentRuns.toLocaleString()} compact />
        <FootprintItem label="Threads" value={usage.agentThreads.toLocaleString()} compact />
      </div>
    </Panel>
  );
}

function FootprintItem({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-lg border border-white/10 bg-black/20 ${compact ? 'px-3 py-2' : 'p-3'}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={compact ? 'mt-1 text-sm font-medium text-slate-200' : 'mt-2 text-lg font-semibold text-slate-100'}>{value}</p>
    </div>
  );
}

function CreditAdjustmentForm({
  form,
  saving,
  onChange,
  onSubmit,
}: {
  form: { action: string; amountCredits: string; reason: string };
  saving: boolean;
  onChange: (value: { action: string; amountCredits: string; reason: string }) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <SectionTitle title="Adjust credits" subtitle="Creates an immutable ledger row." />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-400">
          Action
          <select
            value={form.action}
            onChange={(event) => onChange({ ...form, action: event.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          >
            <option value="GRANT">Grant</option>
            <option value="DEDUCT">Deduct</option>
            <option value="REFUND">Refund</option>
          </select>
        </label>
        <label className="text-sm text-slate-400">
          Credits
          <input
            value={form.amountCredits}
            onChange={(event) => onChange({ ...form, amountCredits: event.target.value })}
            inputMode="numeric"
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Apply
          </button>
        </div>
      </div>
      <label className="mt-3 block text-sm text-slate-400">
        Reason
        <textarea
          value={form.reason}
          onChange={(event) => onChange({ ...form, reason: event.target.value })}
          rows={3}
          placeholder="Required for audit trail"
          className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600"
        />
      </label>
    </form>
  );
}

function SubscriptionForm({
  form,
  saving,
  onChange,
  onSubmit,
}: {
  form: {
    planKey: string;
    status: string;
    monthlyCredits: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    provider: string;
    providerCustomerId: string;
    providerSubscriptionId: string;
    reason: string;
  };
  saving: boolean;
  onChange: (value: SubscriptionFormProps) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <SectionTitle title="Subscription" subtitle="Updates entitlement fields used by admission control." />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-slate-400">
          Plan
          <select
            value={form.planKey}
            onChange={(event) => onChange({ ...form, planKey: event.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          >
            {PLAN_OPTIONS.map((plan) => <option key={plan} value={plan}>{plan}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-400">
          Status
          <select
            value={form.status}
            onChange={(event) => onChange({ ...form, status: event.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          >
            {SUBSCRIPTION_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label className="text-sm text-slate-400">
          Monthly credits
          <input
            value={form.monthlyCredits}
            onChange={(event) => onChange({ ...form, monthlyCredits: event.target.value })}
            inputMode="numeric"
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          />
        </label>
        <label className="text-sm text-slate-400">
          Period start
          <input
            type="datetime-local"
            value={form.currentPeriodStart}
            onChange={(event) => onChange({ ...form, currentPeriodStart: event.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          />
        </label>
        <label className="text-sm text-slate-400">
          Period end
          <input
            type="datetime-local"
            value={form.currentPeriodEnd}
            onChange={(event) => onChange({ ...form, currentPeriodEnd: event.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          />
        </label>
        <label className="text-sm text-slate-400">
          Provider
          <input
            value={form.provider}
            onChange={(event) => onChange({ ...form, provider: event.target.value })}
            placeholder="stripe, manual, etc."
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600"
          />
        </label>
        <label className="text-sm text-slate-400">
          Customer ID
          <input
            value={form.providerCustomerId}
            onChange={(event) => onChange({ ...form, providerCustomerId: event.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          />
        </label>
        <label className="text-sm text-slate-400">
          Subscription ID
          <input
            value={form.providerSubscriptionId}
            onChange={(event) => onChange({ ...form, providerSubscriptionId: event.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Save
          </button>
        </div>
      </div>
      <label className="mt-3 block text-sm text-slate-400">
        Reason
        <input
          value={form.reason}
          onChange={(event) => onChange({ ...form, reason: event.target.value })}
          placeholder="Optional audit note"
          className="mt-1 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-600"
        />
      </label>
    </form>
  );
}

type SubscriptionFormProps = {
  planKey: string;
  status: string;
  monthlyCredits: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  provider: string;
  providerCustomerId: string;
  providerSubscriptionId: string;
  reason: string;
};

function BillingTables({ detail }: { detail: AdminUserDetail }) {
  return (
    <div className="space-y-5">
      <Panel title="Credit ledger" subtitle="Latest balance, reservation, and admin changes.">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-950 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Balance</th>
                <th className="px-3 py-2 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {detail.ledger.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-400">{formatDateTime(entry.createdAt)}</td>
                  <td className="px-3 py-2"><StatusPill status={entry.type} /></td>
                  <td className={`px-3 py-2 font-medium ${entry.amountCredits < 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {entry.amountCredits > 0 ? '+' : ''}{formatCredits(entry.amountCredits)}
                  </td>
                  <td className="px-3 py-2">{formatCredits(entry.balanceAfterCredits)}</td>
                  <td className="px-3 py-2">
                    <p>{entry.description}</p>
                    <p className="mt-1 text-xs text-slate-500">{entry.threadTitle || shortId(entry.runId) || entry.threadId || ''}</p>
                    <JsonDetails label="Metadata" value={entry.metadata} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.ledger.length === 0 ? <EmptyState label="No ledger entries." /> : null}
        </div>
      </Panel>

      <Panel title="Usage records" subtitle="Computed agent task and memory review charges.">
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-950 text-xs text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Hermes</th>
                <th className="px-3 py-2 font-medium">Codex</th>
                <th className="px-3 py-2 font-medium">Billed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {detail.usageRecords.map((record) => (
                <tr key={record.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-400">{formatDateTime(record.createdAt)}</td>
                  <td className="px-3 py-2">
                    <p className="font-mono text-xs">{shortId(record.runId)}</p>
                    <p className="mt-1 text-xs text-slate-500">{record.threadTitle || record.status}</p>
                  </td>
                  <td className="px-3 py-2">{formatCredits(record.hermesCredits)}</td>
                  <td className="px-3 py-2">{formatCredits(record.codexCredits)}</td>
                  <td className="px-3 py-2">
                    <p className="font-semibold">{formatCredits(record.billedCredits)}</p>
                    <p className="mt-1 text-xs text-slate-500">${record.hermesCostUsd.toFixed(6)}</p>
                    <JsonDetails label="Usage JSON" value={record.usage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.usageRecords.length === 0 ? <EmptyState label="No usage records." /> : null}
        </div>
      </Panel>
    </div>
  );
}

function RunTables({ detail }: { detail: AdminUserDetail }) {
  const failedContextRuns = detail.contextRuns.filter((run) => run.error || ['FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(run.status));
  return (
    <div className="space-y-5">
      <Panel title="Reservations" subtitle="Active and historical admission-control holds.">
        <div className="max-h-[300px] overflow-auto">
          {detail.reservations.map((reservation) => (
            <RecordRow key={reservation.id} title={reservation.threadTitle || shortId(reservation.runId)} meta={`${reservation.status} · ${reservation.mode} · ${formatDateTime(reservation.createdAt)}`}>
              <span>{formatCredits(reservation.reservedCredits)} reserved</span>
              <span>{formatCredits(reservation.capturedCredits)} captured</span>
              <span>{reservation.settledAt ? `settled ${formatDateTime(reservation.settledAt)}` : `expires ${formatDateTime(reservation.expiresAt)}`}</span>
            </RecordRow>
          ))}
          {detail.reservations.length === 0 ? <EmptyState label="No reservations." /> : null}
        </div>
      </Panel>

      <Panel title="Agent runs" subtitle="Queue, worker, model, and failure state from personal-agent-server.">
        <div className="max-h-[420px] overflow-auto">
          {detail.contextRuns.map((run) => (
            <RecordRow key={run.id} title={shortId(run.id)} meta={`${run.status} · ${run.modelProvider || 'unknown'} · ${formatDateTime(run.createdAt)}`}>
              <span>{run.route || 'route unknown'}</span>
              <span>{run.workerId ? `worker ${shortId(run.workerId)}` : 'no worker'}</span>
              <span>{run.startedAt ? `started ${formatDateTime(run.startedAt)}` : 'not started'}</span>
              {run.error ? <p className="mt-2 whitespace-pre-wrap text-sm text-red-200">{run.error}</p> : null}
              <JsonDetails label="Request" value={run.request} />
              <JsonDetails label="Result" value={run.result} />
            </RecordRow>
          ))}
          {detail.contextRuns.length === 0 ? <EmptyState label="No agent context runs found." /> : null}
        </div>
      </Panel>

      <Panel title="Failures" subtitle="Recent failed runs and legacy executive assistant failures.">
        <div className="max-h-[320px] overflow-auto">
          {failedContextRuns.map((run) => (
            <RecordRow key={run.id} title={shortId(run.id)} meta={`${run.status} · ${formatDateTime(run.updatedAt)}`}>
              <p className="whitespace-pre-wrap text-red-200">{run.error || 'No error text stored.'}</p>
            </RecordRow>
          ))}
          {detail.executiveRuns.filter((run) => run.error).map((run) => (
            <RecordRow key={run.id} title={`Executive run ${shortId(run.id)}`} meta={`${run.status} · ${formatDateTime(run.updatedAt)}`}>
              <p className="whitespace-pre-wrap text-red-200">{run.error}</p>
              <JsonDetails label="Request" value={run.request} />
            </RecordRow>
          ))}
          {failedContextRuns.length === 0 && detail.executiveRuns.every((run) => !run.error) ? (
            <EmptyState label="No recent failures." />
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function ThreadInspector({
  threads,
  selectedThreadId,
  threadDetail,
  loading,
  onSelectThread,
}: {
  threads: ThreadSummary[];
  selectedThreadId: string | null;
  threadDetail: AdminThreadDetail | null;
  loading: boolean;
  onSelectThread: (threadId: string) => void;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03]">
      <div className="grid min-h-[720px] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 p-3 lg:border-b-0 lg:border-r">
          <SectionTitle title="Discussions" subtitle={`${threads.length} visible discussions`} />
          <div className="mt-3 max-h-[650px] overflow-y-auto">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelectThread(thread.id)}
                className={`mb-2 w-full rounded-lg border p-3 text-left ${
                  selectedThreadId === thread.id
                    ? 'border-sky-400/70 bg-sky-500/10'
                    : 'border-white/10 bg-black/20 hover:bg-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium">{thread.title || 'New discussion'}</p>
                  <StatusPill status={thread.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{thread.agentType} · {thread.messageCount} messages · {thread.toolCallCount} tools</p>
                {thread.lastMessagePreview ? <p className="mt-2 line-clamp-2 text-xs text-slate-400">{thread.lastMessagePreview}</p> : null}
              </button>
            ))}
            {threads.length === 0 ? <EmptyState label="No discussions." /> : null}
          </div>
        </aside>

        <div className="min-w-0 p-4">
          {loading ? <LoadingPanel label="Loading discussion" /> : null}
          {!loading && !threadDetail ? <EmptyState label="Select a discussion to view messages." /> : null}
          {!loading && threadDetail ? (
            <div className="space-y-5">
              <div>
                <h3 className="text-xl font-semibold">{threadDetail.thread.title}</h3>
                <p className="mt-1 text-sm text-slate-400">
                  {threadDetail.thread.agentType} · {threadDetail.thread.status} · {formatDateTime(threadDetail.thread.updatedAt)}
                </p>
              </div>

              <Panel title="Messages" subtitle={`${threadDetail.messages.length} loaded of ${threadDetail.thread.messageCount}`}>
                <div className="max-h-[580px] space-y-3 overflow-y-auto pr-1">
                  {threadDetail.messages.map((message) => (
                    <div key={message.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="font-medium text-slate-300">{message.role}</span>
                        <span>{formatDateTime(message.createdAt)}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{message.content}</p>
                      <JsonDetails label="Message metadata" value={message.meta} />
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Tool calls" subtitle={`${threadDetail.toolCalls.length} UI calls, ${threadDetail.contextToolCalls.length} runtime calls`}>
                <div className="grid gap-3 xl:grid-cols-2">
                  {threadDetail.toolCalls.map((call) => (
                    <ToolCallCard key={`ui-${call.id}`} title={call.toolName} status={call.status} createdAt={call.createdAt} args={call.toolArgs} result={call.toolResult} />
                  ))}
                  {threadDetail.contextToolCalls.map((call) => (
                    <ToolCallCard key={`runtime-${call.id}`} title={call.toolName} status={call.status} createdAt={call.createdAt} args={call.toolArgs} result={call.toolResult} />
                  ))}
                </div>
                {threadDetail.toolCalls.length === 0 && threadDetail.contextToolCalls.length === 0 ? <EmptyState label="No tool calls." /> : null}
              </Panel>

              <Panel title="Run events and artifacts" subtitle={`${threadDetail.runEvents.length} events, ${threadDetail.artifacts.length} artifacts`}>
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="max-h-[420px] overflow-y-auto">
                    {threadDetail.runEvents.map((event) => (
                      <RecordRow key={event.id} title={event.type} meta={`${shortId(event.runId)} · ${formatDateTime(event.createdAt)}`}>
                        <JsonDetails label="Payload" value={event.payload} defaultOpen={false} />
                      </RecordRow>
                    ))}
                    {threadDetail.runEvents.length === 0 ? <EmptyState label="No run events." /> : null}
                  </div>
                  <div className="max-h-[420px] overflow-y-auto">
                    {threadDetail.artifacts.map((artifact) => (
                      <RecordRow key={artifact.id} title={artifact.name} meta={`${artifact.kind} · ${formatDateTime(artifact.createdAt)}`}>
                        <span>{artifact.mimeType || 'unknown type'}</span>
                        <span>{formatBytes(artifact.sizeBytes)}</span>
                        {artifact.contentPreview ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{artifact.contentPreview}</p> : null}
                        <JsonDetails label="Metadata" value={artifact.metadata} />
                      </RecordRow>
                    ))}
                    {threadDetail.artifacts.length === 0 ? <EmptyState label="No artifacts." /> : null}
                  </div>
                </div>
              </Panel>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ToolCallCard({
  title,
  status,
  createdAt,
  args,
  result,
}: {
  title: string;
  status: string;
  createdAt: string;
  args: unknown;
  result: unknown;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-medium">{title}</p>
        <StatusPill status={status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">{formatDateTime(createdAt)}</p>
      <JsonDetails label="Args" value={args} />
      <JsonDetails label="Result" value={result} />
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof WalletCards; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-400">{label}</p>
        <Icon className="h-4 w-4 text-slate-500" />
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <SectionTitle title={title} subtitle={subtitle} />
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function RecordRow({ title, meta, children }: { title: string; meta: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <p className="font-medium text-slate-100">{title}</p>
        <p className="text-xs text-slate-500">{meta}</p>
      </div>
      <div className="mt-2 flex flex-col gap-1 text-sm text-slate-400">{children}</div>
    </div>
  );
}

function KeyValue({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-600">{label}</p>
      <p className={`mt-1 truncate ${mono ? 'font-mono text-xs' : ''}`}>{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const className = normalized.includes('FAIL') || normalized.includes('ERROR') || normalized.includes('CANCEL') || normalized.includes('DEDUCT')
    ? 'border-red-400/30 bg-red-500/10 text-red-200'
    : normalized.includes('ACTIVE') || normalized.includes('CAPTURE') || normalized.includes('GRANT') || normalized.includes('SUCCESS')
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200'
      : normalized.includes('RUN') || normalized.includes('QUEU') || normalized.includes('RESERVE') || normalized.includes('PENDING')
        ? 'border-sky-400/30 bg-sky-500/10 text-sky-200'
        : 'border-white/10 bg-white/10 text-slate-300';
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}>{status}</span>;
}

function JsonDetails({ label, value, defaultOpen = false }: { label: string; value: unknown; defaultOpen?: boolean }) {
  if (value === null || value === undefined) return null;
  return (
    <details className="mt-2" open={defaultOpen}>
      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">{label}</summary>
      <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-white/10 bg-slate-950 p-3 text-xs leading-5 text-slate-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-slate-400">
      <LoaderCircle className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-sm text-slate-400">
      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">
      {label}
    </div>
  );
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: 'no-store', credentials: 'same-origin' });
  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(data.error || `Request failed with ${response.status}`);
  return data as T;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed';
}

function shortId(value: string | null | undefined) {
  if (!value) return '';
  return value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined || bytes < 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function toDateInputValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateInputValue(value: string) {
  if (!value.trim()) return null;
  return new Date(value).toISOString();
}
