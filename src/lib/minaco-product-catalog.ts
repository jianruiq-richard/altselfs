import { BILLING_PLANS } from '@/lib/billing-plans';

export type PublicAgent = {
  id: string;
  name: string;
  vendor: string;
  description: string;
  status: 'available' | 'experimental';
};

export type PublicModelRate = {
  provider: string;
  model: string;
  label: string;
  engines: string[];
  version: string;
  input: number;
  cachedInput: number;
  cacheWrite?: number;
  output: number;
  unit: 'credits' | 'microUSD';
};

export type PublicRelease = {
  version: string;
  releasedAt: string;
  platform: string;
  url: string;
  bytes: number;
  sha256: string;
};

export type MinacoProductCatalog = {
  generatedAt: string;
  plans: typeof BILLING_PLANS;
  agents: PublicAgent[];
  models: PublicModelRate[];
  release: PublicRelease | null;
  sources: {
    plans: 'minaco-billing';
    agentsAndModels: 'minaco-desktop-api' | 'unavailable';
    release: 'minaco-desktop-manifest' | 'unavailable';
  };
};

type DesktopConfig = {
  releaseManifestUrl?: unknown;
  engines?: unknown;
};

const defaultDesktopApiUrl = 'https://desktop-api.minaco.ai';

export async function loadMinacoProductCatalog(
  fetcher: typeof fetch = fetch,
  desktopApiUrl = process.env.MINACO_DESKTOP_API_URL || defaultDesktopApiUrl,
): Promise<MinacoProductCatalog> {
  const base = trustedServiceUrl(desktopApiUrl);
  const [configResult, modelsResult] = await Promise.allSettled([
    fetchJson(fetcher, new URL('/v1/public/config', base)),
    fetchJson(fetcher, new URL('/v1/public/models', base)),
  ]);

  const config = configResult.status === 'fulfilled' && isRecord(configResult.value)
    ? configResult.value as DesktopConfig
    : null;
  const agents = config ? publicAgents(config.engines) : [];
  const models = modelsResult.status === 'fulfilled' ? publicModels(modelsResult.value) : [];

  let release: PublicRelease | null = null;
  if (config && typeof config.releaseManifestUrl === 'string') {
    try {
      release = publicRelease(await fetchJson(fetcher, trustedPublicUrl(config.releaseManifestUrl)));
    } catch {
      release = null;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    plans: BILLING_PLANS,
    agents,
    models,
    release,
    sources: {
      plans: 'minaco-billing',
      agentsAndModels: agents.length || models.length ? 'minaco-desktop-api' : 'unavailable',
      release: release ? 'minaco-desktop-manifest' : 'unavailable',
    },
  };
}

async function fetchJson(fetcher: typeof fetch, url: URL): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) throw new Error(`Catalog request failed with ${response.status}.`);
  return response.json();
}

function publicAgents(value: unknown): PublicAgent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PublicAgent[] => {
    if (!isRecord(entry)) return [];
    const status = entry.status;
    if (status !== 'available' && status !== 'experimental') return [];
    if (![entry.id, entry.name, entry.vendor, entry.description].every((item) => typeof item === 'string')) return [];
    return [{
      id: entry.id as string,
      name: entry.name as string,
      vendor: entry.vendor as string,
      description: entry.description as string,
      status,
    }];
  });
}

function publicModels(value: unknown): PublicModelRate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): PublicModelRate[] => {
    if (!isRecord(entry)) return [];
    const unit = entry.unit === 'microUSD' ? 'microUSD' : 'credits';
    if (
      ![entry.provider, entry.model, entry.version].every((item) => typeof item === 'string') ||
      ![entry.input, entry.cachedInput, entry.output].every((item) => typeof item === 'number' && Number.isFinite(item))
    ) return [];
    return [{
      provider: entry.provider as string,
      model: entry.model as string,
      label: typeof entry.label === 'string' ? entry.label : entry.model as string,
      engines: Array.isArray(entry.engines) ? entry.engines.filter((item): item is string => typeof item === 'string') : [],
      version: entry.version as string,
      input: entry.input as number,
      cachedInput: entry.cachedInput as number,
      ...(typeof entry.cacheWrite === 'number' && Number.isFinite(entry.cacheWrite) && entry.cacheWrite >= 0 ? { cacheWrite: entry.cacheWrite } : {}),
      output: entry.output as number,
      unit,
    }];
  });
}

function publicRelease(value: unknown): PublicRelease | null {
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.releasedAt !== 'string' || !Array.isArray(value.assets)) return null;
  const asset = value.assets.find((item) => isRecord(item) && item.platform === 'darwin-arm64');
  if (!isRecord(asset) || typeof asset.url !== 'string' || typeof asset.bytes !== 'number' || typeof asset.sha256 !== 'string') return null;
  const url = trustedPublicUrl(asset.url);
  if (!url.pathname.toLowerCase().endsWith('.dmg')) return null;
  return {
    version: value.version,
    releasedAt: value.releasedAt,
    platform: 'darwin-arm64',
    url: url.href,
    bytes: asset.bytes,
    sha256: asset.sha256,
  };
}

function trustedServiceUrl(value: string): URL {
  const url = new URL(value);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Desktop catalog requires HTTPS.');
  return url;
}

function trustedPublicUrl(value: string): URL {
  const url = new URL(value);
  const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new Error('Public catalog URL requires HTTPS.');
  if (url.username || url.password) throw new Error('Credentialed catalog URLs are not allowed.');
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
