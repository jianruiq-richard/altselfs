export type BillingPlanKey = 'FREE' | 'STARTER' | 'PRO' | 'SCALE';
export type AltselfsModelTier = 'LITE' | 'PRO';
export type BillingCycle = 'monthly' | 'yearly';

export type BillingPlan = {
  key: BillingPlanKey;
  name: string;
  priceUsd: number;
  monthlyCredits: number;
  concurrentTasks: number;
  scheduledTasks: number;
  modelTiers: AltselfsModelTier[];
  description: string;
  highlighted?: boolean;
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: 'FREE',
    name: 'Free',
    priceUsd: 0,
    monthlyCredits: 0,
    concurrentTasks: 1,
    scheduledTasks: 0,
    modelTiers: ['LITE'],
    description: 'Explore the workspace and run occasional agent tasks.',
  },
  {
    key: 'STARTER',
    name: 'Starter',
    priceUsd: 20,
    monthlyCredits: 20_000,
    concurrentTasks: 3,
    scheduledTasks: 5,
    modelTiers: ['LITE'],
    description: 'For consistent research, analysis, and daily execution.',
  },
  {
    key: 'PRO',
    name: 'Pro',
    priceUsd: 40,
    monthlyCredits: 40_000,
    concurrentTasks: 10,
    scheduledTasks: 20,
    modelTiers: ['LITE', 'PRO'],
    description: 'For heavier agent workloads and parallel projects.',
    highlighted: true,
  },
  {
    key: 'SCALE',
    name: 'Ultra',
    priceUsd: 200,
    monthlyCredits: 200_000,
    concurrentTasks: 20,
    scheduledTasks: 20,
    modelTiers: ['LITE', 'PRO'],
    description: 'For teams operating multiple continuous workflows.',
  },
];

export const BILLING_PRICING_VERSION = '2026-07-v1';
export const ALTSELFS_CREDITS_PER_USD = 1_000;
export const BILLING_YEARLY_DISCOUNT_RATE = 0.2;
export const BILLING_WELCOME_CREDITS = 1_000;

export const WORKLOAD_BENCHMARKS = {
  quickDiscussionCredits: 35,
  standardResearchCredits: 150,
  deepResearchCredits: 370,
};

export function getBillingPlan(planKey: string | null | undefined) {
  return BILLING_PLANS.find((plan) => plan.key === planKey) || BILLING_PLANS[0];
}

export function formatCredits(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)));
}

export function getPlanBillingPriceUsd(plan: BillingPlan, billingCycle: BillingCycle) {
  if (plan.key === 'FREE') return 0;
  if (billingCycle === 'monthly') return plan.priceUsd;
  return Math.round(plan.priceUsd * 12 * (1 - BILLING_YEARLY_DISCOUNT_RATE));
}

export function getPlanBillingCredits(plan: BillingPlan, billingCycle: BillingCycle) {
  if (plan.key === 'FREE') return BILLING_WELCOME_CREDITS;
  return billingCycle === 'yearly' ? plan.monthlyCredits * 12 : plan.monthlyCredits;
}

export function estimatePlanWorkload(credits: number) {
  return {
    discussions: formatApproxCount(credits / WORKLOAD_BENCHMARKS.quickDiscussionCredits),
    researchTasks: formatApproxCount(credits / WORKLOAD_BENCHMARKS.standardResearchCredits),
    deepTasks: formatApproxCount(credits / WORKLOAD_BENCHMARKS.deepResearchCredits),
  };
}

export function formatApproxCount(value: number) {
  const safeValue = Math.max(1, Math.floor(value));
  const rounded = safeValue >= 1_000
    ? Math.round(safeValue / 100) * 100
    : safeValue >= 100
      ? Math.round(safeValue / 10) * 10
      : safeValue;
  return new Intl.NumberFormat('en-US').format(rounded);
}
