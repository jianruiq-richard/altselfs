function getPersonalAgentServerUrl() {
  return (process.env.PERSONAL_AGENT_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function getOpsToken() {
  const token = process.env.OPS_AGENT_TOKEN?.trim();
  if (!token) throw new Error('OPS_AGENT_TOKEN is not configured');
  return token;
}

const DEFAULT_INTERNAL_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_INTERNAL_FETCH_ATTEMPTS = 3;

type PersonalAgentInternalFetchOptions = {
  attempts?: number;
  timeoutMs?: number;
};

class PersonalAgentHttpError extends Error {}

function readPositiveIntEnv(key: string, fallback: number) {
  const parsed = Number(process.env[key] || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause && typeof cause === 'object') {
    const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : '';
    return code ? `${error.message} (code=${code})` : error.message;
  }
  return error.name === 'AbortError' ? 'personal-agent-server request timed out' : error.message;
}

export async function personalAgentInternalFetch<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {},
  options: PersonalAgentInternalFetchOptions = {}
) {
  const url = `${getPersonalAgentServerUrl()}${path}`;
  const attempts = Math.max(
    1,
    Math.floor(options.attempts || readPositiveIntEnv('PERSONAL_AGENT_INTERNAL_FETCH_ATTEMPTS', DEFAULT_INTERNAL_FETCH_ATTEMPTS))
  );
  const timeoutMs = Math.max(
    1_000,
    Math.floor(options.timeoutMs || readPositiveIntEnv('PERSONAL_AGENT_INTERNAL_FETCH_TIMEOUT_MS', DEFAULT_INTERNAL_FETCH_TIMEOUT_MS))
  );
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${getOpsToken()}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        cache: 'no-store',
        headers,
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as T;
      if (!response.ok) {
        const detail = typeof (data as { error?: unknown }).error === 'string'
          ? (data as { error: string }).error
          : `personal-agent-server HTTP ${response.status}`;
        throw new PersonalAgentHttpError(detail);
      }
      return data;
    } catch (error) {
      lastError = error;
      if (error instanceof PersonalAgentHttpError) throw error;

      const detail = describeFetchError(error);
      console.warn('[personal-agent-internal] upstream fetch failed', {
        path,
        attempt,
        attempts,
        detail,
      });
      if (attempt < attempts) {
        await wait(500 * attempt);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(describeFetchError(lastError));
}
