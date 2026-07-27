import type { ReactNode } from 'react';
import {
  CalendarDays,
  Check,
  CircleGauge,
  Cpu,
  Sparkles,
} from 'lucide-react';
import { formatCredits, getBillingPlan } from '@/lib/billing-plans';

type PlanSubscription = {
  planKey: string;
  planName: string;
  status: string;
  monthlyCredits: number;
  concurrentTaskLimit: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type PlanCapacity = {
  activeTaskCount: number;
  availableTaskSlots: number;
};

type BillingPlanOverviewProps = {
  subscription: PlanSubscription;
  availableCredits?: number;
  reservedCredits?: number;
  capacity?: PlanCapacity;
  actions?: ReactNode;
};

export function BillingPlanOverview({
  subscription,
  availableCredits,
  reservedCredits = 0,
  capacity,
  actions,
}: BillingPlanOverviewProps) {
  const plan = getBillingPlan(subscription.planKey);
  const planName = subscription.planName || plan.name;
  const concurrentTaskLimit = subscription.concurrentTaskLimit || plan.concurrentTasks;
  const status = getPlanStatus(subscription);
  const period = getPlanPeriod(subscription);
  const creditBenefit = subscription.planKey === 'FREE'
    ? '1,000 once'
    : `${formatCredits(subscription.monthlyCredits || plan.monthlyCredits)} per period`;
  const modelBenefit = plan.modelTiers.includes('PRO')
    ? 'Altselfs Lite and Pro'
    : 'Altselfs Lite';

  return (
    <section className="overflow-hidden rounded-[8px] border border-white/[0.1] bg-white/[0.025]">
      <div className="grid gap-5 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center lg:px-6">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] border border-[#8eb3ff]/20 bg-[#8eb3ff]/[0.07] text-[#8eb3ff]">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="grid min-w-0">
            <span className="text-[9px] font-extrabold uppercase text-zinc-600">Current plan</span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <strong className="truncate text-[22px] leading-none text-zinc-50">{planName}</strong>
              <span className={`rounded-full border px-2 py-1 text-[8px] font-extrabold uppercase ${status.className}`}>
                {status.label}
              </span>
            </span>
            <span className="mt-2 text-[10px] text-zinc-500">{period.summary}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          {availableCredits !== undefined ? (
            <span className="grid min-w-[142px] border-l border-white/[0.09] pl-4">
              <span className="text-[9px] text-zinc-600">Available Credits</span>
              <strong className="mt-1 text-[20px] leading-none text-zinc-100">
                {formatCredits(availableCredits)}
              </strong>
              <span className="mt-1.5 text-[9px] text-zinc-700">
                {reservedCredits > 0 ? `${formatCredits(reservedCredits)} reserved` : 'Ready to use'}
              </span>
            </span>
          ) : null}
          {actions}
        </div>
      </div>

      <div className="grid border-t border-white/[0.09] sm:grid-cols-2 xl:grid-cols-4">
        <PlanBenefit
          icon={Sparkles}
          label="Included Credits"
          value={creditBenefit}
          detail={subscription.planKey === 'FREE' ? 'Welcome grant' : 'Added each billing cycle'}
        />
        <PlanBenefit
          icon={CircleGauge}
          label="Concurrent tasks"
          value={`${concurrentTaskLimit}`}
          detail={capacity
            ? `${capacity.activeTaskCount} active · ${capacity.availableTaskSlots} available`
            : 'Maximum active tasks'}
        />
        <PlanBenefit
          icon={Cpu}
          label="Model access"
          value={modelBenefit}
          detail={plan.modelTiers.includes('PRO') ? 'Use either agent tier' : 'Standard agent tier'}
        />
        <PlanBenefit
          icon={CalendarDays}
          label="Plan validity"
          value={period.value}
          detail={period.detail}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-white/[0.09] px-5 py-3 text-[9px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between lg:px-6">
        <span>{period.range}</span>
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3 w-3 text-[#46d19a]" />
          Purchased and unused Credits do not expire
        </span>
      </div>
    </section>
  );
}

function PlanBenefit({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Sparkles;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="grid min-h-[102px] grid-cols-[28px_minmax(0,1fr)] content-center gap-3 border-b border-white/[0.09] px-5 py-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0 lg:px-6">
      <Icon className="mt-0.5 h-4 w-4 text-zinc-600" />
      <span className="grid min-w-0">
        <span className="text-[9px] text-zinc-600">{label}</span>
        <strong className="mt-1 truncate text-[12px] text-zinc-200">{value}</strong>
        <span className="mt-1 text-[9px] text-zinc-700">{detail}</span>
      </span>
    </div>
  );
}

function getPlanStatus(subscription: PlanSubscription) {
  if (subscription.cancelAtPeriodEnd) {
    return {
      label: 'Cancellation scheduled',
      className: 'border-amber-300/20 bg-amber-300/[0.07] text-amber-200',
    };
  }

  const normalized = subscription.status.trim().toUpperCase();
  if (normalized === 'PAST_DUE') {
    return {
      label: 'Payment due',
      className: 'border-amber-300/20 bg-amber-300/[0.07] text-amber-200',
    };
  }
  if (normalized === 'DISPUTED') {
    return {
      label: 'Payment disputed',
      className: 'border-red-300/20 bg-red-300/[0.07] text-red-200',
    };
  }
  if (normalized === 'CANCELED' || normalized === 'CANCELLED') {
    return {
      label: 'Canceled',
      className: 'border-zinc-500/20 bg-zinc-500/[0.07] text-zinc-400',
    };
  }
  if (normalized === 'TRIALING') {
    return {
      label: 'Trial',
      className: 'border-[#8eb3ff]/25 bg-[#8eb3ff]/[0.08] text-[#a9c5ff]',
    };
  }
  return {
    label: 'Active',
    className: 'border-[#46d19a]/20 bg-[#46d19a]/[0.07] text-[#46d19a]',
  };
}

function getPlanPeriod(subscription: PlanSubscription) {
  if (subscription.planKey === 'FREE') {
    return {
      summary: 'Free access remains available without a billing period.',
      value: 'No expiration',
      detail: 'No recurring charge',
      range: 'Free plan · No billing cycle',
    };
  }

  const start = formatPlanDate(subscription.currentPeriodStart);
  const end = formatPlanDate(subscription.currentPeriodEnd);

  if (subscription.cancelAtPeriodEnd) {
    return {
      summary: end ? `Cancels on ${end}. Access remains valid until ${end}.` : 'Cancellation is scheduled.',
      value: end || 'Pending',
      detail: end ? 'Valid until cancellation' : 'Awaiting billing update',
      range: start && end
        ? `Current period · ${start} – ${end} · Will not renew`
        : end
          ? `Subscription cancels on ${end}`
          : 'Cancellation scheduled; billing period unavailable',
    };
  }

  return {
    summary: end ? `Renews ${end}` : 'Billing period is being confirmed.',
    value: end || 'Pending',
    detail: end ? 'Renews' : 'Awaiting billing update',
    range: start && end
      ? `Current period · ${start} – ${end}`
      : end
        ? `Current period ends ${end}`
        : 'Current billing period unavailable',
  };
}

function formatPlanDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
