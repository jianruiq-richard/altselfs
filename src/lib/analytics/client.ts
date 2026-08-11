'use client';

const configuredMeasurementId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID?.trim() || '';
export const GA4_MEASUREMENT_ID = /^G-[A-Z0-9]+$/i.test(configuredMeasurementId)
  ? configuredMeasurementId
  : '';
export const ANALYTICS_SCHEMA_VERSION = 1;

const AUTH_FLOW_STORAGE_KEY = 'minaco.analytics.auth-flow.v1';
const ANALYTICS_STORAGE_GRANTED = process.env.NEXT_PUBLIC_GA4_ANALYTICS_STORAGE === 'granted';

export type AuthFlow = 'login' | 'sign_up';
export type AuthMethod = 'email_password' | 'google_oauth' | 'phone_password' | 'clerk_ui';

export type AnalyticsItem = {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_variant?: string;
  price?: number;
  quantity?: number;
};

export type AnalyticsParams = Record<
  string,
  string | number | boolean | null | undefined | AnalyticsItem[]
>;

type PendingAuthFlow = {
  flow: AuthFlow;
  method: AuthMethod;
  startedAt: number;
};

type AnalyticsSessionContext = {
  clientId: string | null;
  sessionId: string | null;
  analyticsConsent: 'granted' | 'denied';
};

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function ensureGtag() {
  if (typeof window === 'undefined' || !GA4_MEASUREMENT_ID) return null;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  return window.gtag;
}

function compactParams(params: AnalyticsParams) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

export function trackEvent(name: string, params: AnalyticsParams = {}) {
  const gtag = ensureGtag();
  if (!gtag) return;
  gtag('event', name, compactParams({
    schema_version: ANALYTICS_SCHEMA_VERSION,
    ...params,
  }));
}

export function setAnalyticsUser(
  userId: string | null,
  properties: Record<string, string | number | boolean | null | undefined> = {},
) {
  const gtag = ensureGtag();
  if (!gtag) return;
  gtag('config', GA4_MEASUREMENT_ID, { user_id: userId });
  gtag('set', 'user_properties', compactParams(properties));
}

export function analyticsRoute(pathname: string) {
  if (pathname === '/') return { routeName: 'landing', pagePath: '/' };
  if (pathname === '/pricing') return { routeName: 'pricing', pagePath: '/pricing' };
  if (pathname.startsWith('/sign-in')) return { routeName: 'sign_in', pagePath: '/sign-in' };
  if (pathname.startsWith('/sign-up')) return { routeName: 'sign_up', pagePath: '/sign-up' };
  if (pathname === '/sso-callback') return { routeName: 'sso_callback', pagePath: '/sso-callback' };
  if (pathname === '/dashboard/setup') return { routeName: 'workspace_setup', pagePath: '/dashboard/setup' };
  if (/^\/investor\/chat\/[^/]+/.test(pathname)) {
    return { routeName: 'discussion', pagePath: '/investor/chat/:agent_id' };
  }
  if (/^\/investor\/avatar\/[^/]+\/chat\/[^/]+/.test(pathname)) {
    return { routeName: 'investor_avatar_chat', pagePath: '/investor/avatar/:avatar_id/chat/:chat_id' };
  }
  if (/^\/investor\/avatar\/[^/]+\/chats/.test(pathname)) {
    return { routeName: 'investor_avatar_chats', pagePath: '/investor/avatar/:avatar_id/chats' };
  }
  if (/^\/investor\/avatar\/[^/]+/.test(pathname)) {
    return { routeName: 'investor_avatar', pagePath: '/investor/avatar/:avatar_id' };
  }
  if (/^\/chat\/[^/]+/.test(pathname)) {
    return { routeName: 'public_chat', pagePath: '/chat/:avatar_id' };
  }
  if (pathname === '/connectors') return { routeName: 'connectors', pagePath: '/connectors' };
  if (pathname === '/profile') return { routeName: 'profile', pagePath: '/profile' };
  if (/^\/avatar\/[^/]+\/chat\/[^/]+/.test(pathname)) {
    return { routeName: 'avatar_chat', pagePath: '/avatar/:avatar_id/chat/:chat_id' };
  }
  if (/^\/avatar\/[^/]+/.test(pathname)) {
    return { routeName: 'avatar', pagePath: '/avatar/:avatar_id' };
  }
  return { routeName: 'other', pagePath: pathname };
}

export function trackPageView(pathname: string) {
  if (typeof window === 'undefined') return;
  const route = analyticsRoute(pathname);
  trackEvent('page_view', {
    app_area: route.routeName === 'landing' || route.routeName === 'pricing'
      ? 'marketing'
      : route.routeName === 'sign_in' || route.routeName === 'sign_up' || route.routeName === 'sso_callback'
        ? 'authentication'
        : 'product',
    route_name: route.routeName,
    page_location: `${window.location.origin}${route.pagePath}`,
    page_path: route.pagePath,
    page_title: document.title,
  });
}

export function startAuthFlow(flow: AuthFlow, method: AuthMethod) {
  const pending: PendingAuthFlow = { flow, method, startedAt: Date.now() };
  try {
    window.sessionStorage.setItem(AUTH_FLOW_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Storage can be disabled; the start event can still be measured.
  }
  trackEvent(flow === 'sign_up' ? 'sign_up_start' : 'login_start', { method });
}

function readPendingAuthFlow(): PendingAuthFlow | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_FLOW_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingAuthFlow>;
    if (
      (value.flow !== 'login' && value.flow !== 'sign_up') ||
      typeof value.method !== 'string' ||
      typeof value.startedAt !== 'number'
    ) {
      return null;
    }
    return value as PendingAuthFlow;
  } catch {
    return null;
  }
}

export function completePendingAuthFlow() {
  const pending = readPendingAuthFlow();
  if (!pending) return;
  try {
    window.sessionStorage.removeItem(AUTH_FLOW_STORAGE_KEY);
  } catch {
    // The event is still sent if storage cleanup is unavailable.
  }
  trackEvent(pending.flow, {
    method: pending.method,
    auth_duration_ms: Math.max(0, Date.now() - pending.startedAt),
  });
}

export function trackAuthError(input: {
  flow: AuthFlow;
  method: AuthMethod;
  stage: string;
  errorCode?: string | null;
}) {
  trackEvent('auth_error', {
    flow: input.flow,
    method: input.method,
    stage: input.stage,
    error_code: input.errorCode || 'unknown',
  });
}

function getGtagValue(field: 'client_id' | 'session_id') {
  return new Promise<string | null>((resolve) => {
    const gtag = ensureGtag();
    if (!gtag) {
      resolve(null);
      return;
    }
    let settled = false;
    let timeoutId: number | null = null;
    const finish = (value: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      resolve(typeof value === 'string' || typeof value === 'number' ? String(value) : null);
    };
    timeoutId = window.setTimeout(() => finish(null), 800);
    gtag('get', GA4_MEASUREMENT_ID, field, finish);
  });
}

export async function getAnalyticsSessionContext(): Promise<AnalyticsSessionContext> {
  const [clientId, sessionId] = await Promise.all([
    getGtagValue('client_id'),
    getGtagValue('session_id'),
  ]);
  return {
    clientId,
    sessionId,
    analyticsConsent: ANALYTICS_STORAGE_GRANTED ? 'granted' : 'denied',
  };
}

export function analyticsWasReported(key: string) {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`minaco.analytics.reported.${key}`) === '1';
  } catch {
    return false;
  }
}

export function markAnalyticsReported(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`minaco.analytics.reported.${key}`, '1');
  } catch {
    // Local storage is best-effort; duplicate prevention also happens in normal component state.
  }
}
