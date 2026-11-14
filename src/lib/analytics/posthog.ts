const DISTINCT_ID_PATTERN = /^[a-zA-Z0-9._-]{1,160}$/;

type PostHogProperties = Record<string, string | number | boolean>;

export function normalizePostHogDistinctId(value: unknown): string | null {
  return typeof value === 'string' && DISTINCT_ID_PATTERN.test(value) ? value : null;
}

function configuration() {
  const projectKey = process.env.POSTHOG_PROJECT_KEY?.trim() || '';
  const rawHost = process.env.POSTHOG_HOST?.trim() || '';
  if (!/^phc_[a-zA-Z0-9]+$/.test(projectKey)) return null;
  try {
    const host = new URL(rawHost);
    if (host.protocol !== 'https:' || host.username || host.password || host.pathname !== '/') return null;
    return { projectKey, host };
  } catch {
    return null;
  }
}

async function capture(event: string, distinctId: string, properties: PostHogProperties) {
  const config = configuration();
  if (!config || !normalizePostHogDistinctId(distinctId)) return false;
  try {
    const response = await fetch(new URL('/i/v0/e/', config.host), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.projectKey,
        event,
        properties: {
          distinct_id: distinctId,
          $geoip_disable: true,
          surface: 'website',
          environment: 'production',
          ...properties,
        },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function recordDesktopDownload(distinctId: string, release: { version: string; platform: string }) {
  return capture('desktop_downloaded', distinctId, { app_version: release.version, platform: release.platform });
}

export function identifyPostHogUser(userId: string, anonymousId: unknown) {
  const distinctId = normalizePostHogDistinctId(anonymousId);
  if (!distinctId || !normalizePostHogDistinctId(userId) || distinctId === userId) return Promise.resolve(false);
  return capture('$identify', userId, { $anon_distinct_id: distinctId });
}
