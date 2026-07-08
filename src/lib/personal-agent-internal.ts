function getPersonalAgentServerUrl() {
  return (process.env.PERSONAL_AGENT_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function getOpsToken() {
  const token = process.env.OPS_AGENT_TOKEN?.trim();
  if (!token) throw new Error('OPS_AGENT_TOKEN is not configured');
  return token;
}

export async function personalAgentInternalFetch<T = Record<string, unknown>>(
  path: string,
  init: RequestInit = {}
) {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${getOpsToken()}`);
  const response = await fetch(`${getPersonalAgentServerUrl()}${path}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  const data = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    const detail = typeof (data as { error?: unknown }).error === 'string'
      ? (data as { error: string }).error
      : `personal-agent-server HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data;
}
