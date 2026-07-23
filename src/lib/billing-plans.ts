export type BillingPlanKey = 'FREE' | 'STARTER' | 'PRO' | 'SCALE';

export type BillingPlan = {
  key: BillingPlanKey;
  name: string;
  priceUsd: number;
  monthlyCredits: number;
  concurrentTasks: number;
  scheduledTasks: number;
  description: string;
  highlighted?: boolean;
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: 'FREE',
    name: 'Free',
    priceUsd: 0,
    monthlyCredits: 1_000,
    concurrentTasks: 1,
    scheduledTasks: 0,
    description: 'Explore the workspace and run occasional agent tasks.',
  },
  {
    key: 'STARTER',
    name: 'Starter',
    priceUsd: 20,
    monthlyCredits: 20_000,
    concurrentTasks: 3,
    scheduledTasks: 5,
    description: 'For consistent research, analysis, and daily execution.',
  },
  {
    key: 'PRO',
    name: 'Pro',
    priceUsd: 40,
    monthlyCredits: 40_000,
    concurrentTasks: 10,
    scheduledTasks: 20,
    description: 'For heavier agent workloads and parallel projects.',
    highlighted: true,
  },
  {
    key: 'SCALE',
    name: 'Scale',
    priceUsd: 200,
    monthlyCredits: 200_000,
    concurrentTasks: 20,
    scheduledTasks: 20,
    description: 'For teams operating multiple continuous workflows.',
  },
];

export const BILLING_PRICING_VERSION = '2026-07-v1';
export const ALTSELFS_CREDITS_PER_USD = 1_000;

export function getBillingPlan(planKey: string | null | undefined) {
  return BILLING_PLANS.find((plan) => plan.key === planKey) || BILLING_PLANS[0];
}

export function formatCredits(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.round(value)));
}
