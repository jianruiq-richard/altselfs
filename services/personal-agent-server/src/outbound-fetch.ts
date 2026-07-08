import { ProxyAgent } from 'undici';
import type { ServerConfig } from './config.js';

export type NetworkPolicy = 'direct' | 'proxy' | 'auto';

const DEFAULT_BYPASS_HOSTS = [
  'localhost',
  'host.docker.internal',
  '.local',
  '.internal',
];

const proxyAgents = new Map<string, ProxyAgent>();

export async function externalFetch(
  config: ServerConfig,
  input: string | URL,
  init: RequestInit = {},
  options: { networkPolicy?: NetworkPolicy } = {}
) {
  const url = typeof input === 'string' ? new URL(input) : input;
  if (!shouldUseOutboundProxy(config, url, options.networkPolicy || 'direct')) {
    return fetch(url, init);
  }
  const proxyUrl = config.outboundProxyUrl?.trim();
  if (!proxyUrl) return fetch(url, init);
  return fetch(url, { ...init, dispatcher: getProxyAgent(proxyUrl) } as RequestInit & { dispatcher: ProxyAgent });
}

export function shouldUseOutboundProxy(config: ServerConfig, url: URL, policy: NetworkPolicy) {
  if (policy === 'direct') return false;
  if (!config.outboundProxyUrl?.trim()) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (isProxyBypassedHost(url.hostname, config.outboundProxyBypassHosts)) return false;
  return policy === 'proxy' || policy === 'auto';
}

function getProxyAgent(proxyUrl: string) {
  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }
  return agent;
}

function isProxyBypassedHost(hostname: string, configuredHosts: string[]) {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (isPrivateOrLocalIp(host)) return true;
  if (host.includes('-internal.') || host.includes('.internal.')) return true;
  for (const pattern of [...DEFAULT_BYPASS_HOSTS, ...configuredHosts]) {
    if (matchesHostPattern(host, pattern)) return true;
  }
  return false;
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}

function matchesHostPattern(host: string, pattern: string) {
  const normalized = normalizeHostname(pattern);
  if (!normalized) return false;
  if (host === normalized) return true;
  if (normalized.startsWith('*.')) return host.endsWith(normalized.slice(1));
  if (normalized.startsWith('.')) return host.endsWith(normalized);
  return false;
}

function isPrivateOrLocalIp(host: string) {
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const compactIpv6 = host.replace(/^0+/, '');
  return compactIpv6 === '::1' || compactIpv6.startsWith('fe80:') || compactIpv6.startsWith('fc') || compactIpv6.startsWith('fd');
}

function parseIpv4(host: string) {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((part) => Number(part));
  if (bytes.some((byte, index) => !Number.isInteger(byte) || byte < 0 || byte > 255 || String(byte) !== parts[index])) {
    return undefined;
  }
  return bytes;
}
