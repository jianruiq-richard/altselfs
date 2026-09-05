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
let workspaceFetchSeq = 0;
const latestWorkspaceFetchByKey = new Map<string, number>();
let activeWorkspaceUserId: string | null = null;

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
  workspaceFetchSeq += 1;
  latestWorkspaceFetchByKey.set(key, workspaceFetchSeq);
  workspaceCache.set(key, {
    value,
    updatedAt: now(),
  });
}

export function deleteWorkspaceCached(key: string) {
  if (!browserReady()) return;
  workspaceFetchSeq += 1;
  latestWorkspaceFetchByKey.set(key, workspaceFetchSeq);
  workspaceCache.delete(key);
}

function clearWorkspaceCacheEntries() {
  workspaceFetchSeq += 1;
  workspaceCache.clear();
  latestWorkspaceFetchByKey.clear();
}

export function resetWorkspaceClientCache() {
  if (!browserReady()) return;
  clearWorkspaceCacheEntries();
  activeWorkspaceUserId = null;
}

export function clearWorkspacePersonalAgentCache() {
  if (!browserReady()) return;
  workspaceFetchSeq += 1;
  for (const key of workspaceCache.keys()) {
    if (key.startsWith('workspace:personal-agent:')) {
      workspaceCache.delete(key);
      latestWorkspaceFetchByKey.delete(key);
    }
  }
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
  if (existing?.inflight && !options.force) return existing.inflight;

  const requestSeq = workspaceFetchSeq += 1;
  latestWorkspaceFetchByKey.set(key, requestSeq);

  const inflight = fetch(url, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
  }).then(async (response) => {
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`);
    }
    if (latestWorkspaceFetchByKey.get(key) === requestSeq) {
      workspaceCache.set(key, {
        value: payload,
        updatedAt: now(),
      });
    }
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
  workspaceBootstrap: 'workspace:bootstrap',
  connectors: 'workspace:connectors',
  billingCapacity: 'workspace:billing-capacity',
  billingOverview: 'workspace:billing-overview',
  billingDetails: 'workspace:billing-details',
  billingSummary: 'workspace:billing-summary',
  userProfile: 'workspace:user-profile',
  productIntelligence: 'workspace:product-intelligence',
  archivedSessions: 'workspace:archived-sessions',
  personalAgentSessions: 'workspace:personal-agent:sessions',
  personalAgentDefault: 'workspace:personal-agent:default',
  personalAgentThread: (threadId: string) => `workspace:personal-agent:thread:${threadId}`,
};

export type WorkspaceBootstrapPayload = {
  user?: unknown;
  billingCapacity?: unknown;
  personalAgent?: {
    threadId?: unknown;
    sessions?: unknown;
  };
  warnings?: unknown;
};

export type WorkspacePersonalAgentPayload = {
  threadId?: unknown;
  sessions?: unknown;
  messages?: unknown;
  hasMore?: unknown;
};

export function setWorkspacePersonalAgentThreadPage(payload: WorkspacePersonalAgentPayload) {
  if (!browserReady()) return;
  const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
  if (!threadId) return;
  setWorkspaceCached(WORKSPACE_CACHE_KEYS.personalAgentThread(threadId), {
    threadId,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    hasMore: Boolean(payload.hasMore),
  });
}

function getBootstrapUserId(user: unknown) {
  if (!user || typeof user !== 'object' || !('id' in user)) return null;
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function scopeWorkspaceCacheToUser(user: unknown) {
  const userId = getBootstrapUserId(user);
  if (!userId || activeWorkspaceUserId === userId) return;
  clearWorkspaceCacheEntries();
  activeWorkspaceUserId = userId;
}

export function applyWorkspacePersonalAgentPayload(payload: WorkspacePersonalAgentPayload) {
  if (!browserReady() || !Array.isArray(payload.sessions)) return;

  const sessions = payload.sessions;
  const requestedThreadId = typeof payload.threadId === 'string' ? payload.threadId : null;
  const threadId = requestedThreadId && sessions.some((session) => (
    session && typeof session === 'object' && 'id' in session && session.id === requestedThreadId
  ))
    ? requestedThreadId
    : null;

  clearWorkspacePersonalAgentCache();
  setWorkspaceCached(WORKSPACE_CACHE_KEYS.personalAgentSessions, {
    threadId,
    sessions,
  });

  const page = {
    threadId,
    sessions,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    hasMore: Boolean(payload.hasMore),
  };
  setWorkspaceCached(WORKSPACE_CACHE_KEYS.personalAgentDefault, page);
  if (threadId) {
    setWorkspacePersonalAgentThreadPage(page);
  }
}

export function applyWorkspaceBootstrapPayload(payload: WorkspaceBootstrapPayload) {
  if (!browserReady()) return;
  scopeWorkspaceCacheToUser(payload.user);
  setWorkspaceCached(WORKSPACE_CACHE_KEYS.workspaceBootstrap, payload);
  if (payload.user) {
    setWorkspaceCached(WORKSPACE_CACHE_KEYS.userProfile, { user: payload.user });
  }
  if (payload.billingCapacity) {
    setWorkspaceCached(WORKSPACE_CACHE_KEYS.billingCapacity, payload.billingCapacity);
    setWorkspaceCached(WORKSPACE_CACHE_KEYS.billingOverview, payload.billingCapacity);
  }
  if (payload.personalAgent && Array.isArray(payload.personalAgent.sessions)) {
    const sessions = payload.personalAgent.sessions;
    const requestedThreadId = typeof payload.personalAgent.threadId === 'string'
      ? payload.personalAgent.threadId
      : null;
    const threadId = requestedThreadId && sessions.some((session) => (
      session && typeof session === 'object' && 'id' in session && session.id === requestedThreadId
    ))
      ? requestedThreadId
      : null;

    if (sessions.length === 0) {
      applyWorkspacePersonalAgentPayload({
        threadId: null,
        sessions: [],
        messages: [],
        hasMore: false,
      });
    } else {
      setWorkspaceCached(WORKSPACE_CACHE_KEYS.personalAgentSessions, {
        threadId,
        sessions,
      });
    }
  }
}

export function prefetchWorkspaceBootstrap(options: { force?: boolean } = {}) {
  if (!browserReady()) return;
  void fetchWorkspaceJson<WorkspaceBootstrapPayload>(
    WORKSPACE_CACHE_KEYS.workspaceBootstrap,
    '/api/workspace/bootstrap',
    {},
    { ttlMs: 30_000, force: options.force ?? false },
  )
    .then(applyWorkspaceBootstrapPayload)
    .catch(() => undefined);
}

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
  if (pathname.startsWith('/product-intelligence')) {
    prefetchWorkspaceJson<{ products?: unknown[] }>(
      WORKSPACE_CACHE_KEYS.productIntelligence,
      '/api/product-intelligence/products?limit=100',
      {},
      { ttlMs: 60_000 },
    );
    return;
  }

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
        WORKSPACE_CACHE_KEYS.billingOverview,
        '/api/billing/summary?section=overview',
        {},
        { ttlMs: 45_000 },
      );
      prefetchWorkspaceJson<unknown>(
        WORKSPACE_CACHE_KEYS.billingDetails,
        '/api/billing/summary?section=details',
        {},
        { ttlMs: 45_000 },
      );
    }
    return;
  }

  if (pathname.startsWith('/investor/chat')) {
    void fetchWorkspaceJson<Record<string, unknown>>(
      WORKSPACE_CACHE_KEYS.personalAgentSessions,
      '/api/investor/personal-agent?sessionsOnly=1',
      {},
      { ttlMs: 30_000 },
    )
      .then((payload) => {
        if (Array.isArray(payload.sessions)) {
          setWorkspaceCached(WORKSPACE_CACHE_KEYS.personalAgentSessions, {
            threadId: typeof payload.threadId === 'string' ? payload.threadId : null,
            sessions: payload.sessions,
          });
        }
      })
      .catch(() => undefined);
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
