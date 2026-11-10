import { authHref } from './auth-destination';
export const accountViews = ['overview', 'plan', 'usage', 'billing', 'rates'] as const;
export type AccountView = typeof accountViews[number];
export function accountView(value: string | null): AccountView {
  return accountViews.includes(value as AccountView) ? value as AccountView : 'overview';
}
export function accountHref(view: AccountView, options: Record<string, string> = {}) {
  return `/account?${new URLSearchParams({ view, ...options })}`;
}
export function accountSignInHref(query: string) {
  return authHref('/sign-in', `/account${query ? `?${query}` : ''}`);
}
export function planHref(plan: string, cycle: string) {
  return accountHref('plan', { plan: plan.toUpperCase(), cycle: cycle === 'yearly' ? 'yearly' : 'monthly' });
}
