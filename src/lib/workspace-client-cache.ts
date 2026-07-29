'use client';

type CacheEntry<T> = {
  value?: T;
  updatedAt: number;
  inflight?: Promise<T>;
};

type JsonFetchOptions = {
  ttlMs?: number;
  force?: boolean;
};

const DEFAULT_TTL_MS = 90_000;
const workspaceCache = new Map<string, CacheEntry<unknown>>();

function now() {
  return Date.now();
}

function browserReady() {
  return typeof window !== 'undefined';
}

export function getWorkspaceCached<T>(key: string, ttlMs = DEFAULT_TTL_MS): T | null {
  if (!browserReady()) return null;
  const entry = workspaceCache.get(key) as CacheEntry<T> | undefined;
  if (!entry || entry.value === undefined) return null;
  if (ttlMs > 0 && now() - entry.updatedAt > ttlMs) return null;
  return entry.value;
}

export function getWorkspaceCachedStale<T>(key: string): T | null {
  if (!browserReady()) return null;
  const entry = workspaceCache.get(key) as CacheEntry<T> | undefined;
  return entry?.value === undefined ? null : entry.value;
}

export function setWorkspaceCached<T>(key: string, value: T) {
  if (!browserReady()) return;
  workspaceCache.set(key, {
    value,
    updatedAt: now(),
  });
}

export function deleteWorkspaceCached(key: string) {
  if (!browserReady()) return;
  workspaceCache.delete(key);
}

export async function fetchWorkspaceJson<T>(
  key: string,
  url: string,
  init: RequestInit = {},
  options: JsonFetchOptions = {},
): Promise<T> {
  if (!browserReady()) {
    throw new Error('workspace cache is only available in the browser');
  }

  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const existing = workspaceCache.get(key) as CacheEntry<T> | undefined;
  if (!options.force && existing?.value !== undefined && ttlMs > 0 && now() - existing.updatedAt <= ttlMs) {
    return existing.value;
  }
  if (existing?.inflight) return existing.inflight;

  const inflight = fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
  }).then(async (response) => {
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
    }
    workspaceCache.set(key, {
      value: payload,
      updatedAt: now(),
    });
    return payload;
  }).finally(() => {
    const latest = workspaceCache.get(key) as CacheEntry<T> | undefined;
    if (latest?.inflight === inflight) {
      workspaceCache.set(key, {
        value: latest.value,
        updatedAt: latest.updatedAt,
      });
    }
  });

  workspaceCache.set(key, {
    value: existing?.value,
    updatedAt: existing?.updatedAt || 0,
    inflight,
  });
  return inflight;
}

export function prefetchWorkspaceJson<T>(
  key: string,
  url: string,
  init: RequestInit = {},
  options: Omit<JsonFetchOptions, 'force'> = {},
) {
  if (!browserReady()) return;
  void fetchWorkspaceJson<T>(key, url, init, {
    ...options,
    force: false,
  }).catch(() => undefined);
}

export const WORKSPACE_CACHE_KEYS = {
  connectors: 'workspace:connectors',
  billingCapacity: 'workspace:billing-capacity',
  billingSummary: 'workspace:billing-summary',
  userProfile: 'workspace:user-profile',
  archivedSessions: 'workspace:archived-sessions',
  personalAgentDefault: 'workspace:personal-agent:default',
  personalAgentThread: (threadId: string) => `workspace:personal-agent:thread:${threadId}`,
};

export function prefetchWorkspaceRouteData(href: string) {
  if (!browserReady()) return;
  let url: URL;
  try {
    url = new URL(href, window.location.origin);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;

  const pathname = url.pathname;
  if (pathname.startsWith('/connectors')) {
    prefetchWorkspaceJson<{ connectors?: unknown[] }>(
      WORKSPACE_CACHE_KEYS.connectors,
      '/api/investor/connectors',
      {},
      { ttlMs: 45_000 },
    );
    return;
  }

  if (pathname.startsWith('/profile')) {
    prefetchWorkspaceJson<{ user?: unknown }>(
      WORKSPACE_CACHE_KEYS.userProfile,
      '/api/user/profile',
      {},
      { ttlMs: 120_000 },
    );
    if (url.searchParams.get('view') === 'plan') {
      prefetchWorkspaceJson<unknown>(
        WORKSPACE_CACHE_KEYS.billingSummary,
        '/api/billing/summary',
        {},
        { ttlMs: 45_000 },
      );
    }
    return;
  }

  if (pathname.startsWith('/investor/chat')) {
    prefetchWorkspaceJson<unknown>(
      WORKSPACE_CACHE_KEYS.personalAgentDefault,
      '/api/investor/personal-agent?sessions=1',
      {},
      { ttlMs: 30_000 },
    );
    prefetchWorkspaceJson<{ connectors?: unknown[] }>(
      WORKSPACE_CACHE_KEYS.connectors,
      '/api/investor/connectors',
      {},
      { ttlMs: 45_000 },
    );
    prefetchWorkspaceJson<unknown>(
      WORKSPACE_CACHE_KEYS.billingCapacity,
      '/api/billing/capacity',
      {},
      { ttlMs: 30_000 },
    );
    return;
  }

  if (pathname.startsWith('/dashboard')) {
    prefetchWorkspaceJson<unknown>(
      WORKSPACE_CACHE_KEYS.billingCapacity,
      '/api/billing/capacity',
      {},
      { ttlMs: 30_000 },
    );
  }
}
