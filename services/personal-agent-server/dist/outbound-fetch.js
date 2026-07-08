import { ProxyAgent } from 'undici';
const DEFAULT_BYPASS_HOSTS = [
    'localhost',
    'host.docker.internal',
    '.local',
    '.internal',
];
const proxyAgents = new Map();
export async function externalFetch(config, input, init = {}, options = {}) {
    const url = typeof input === 'string' ? new URL(input) : input;
    if (!shouldUseOutboundProxy(config, url, options.networkPolicy || 'direct')) {
        return fetch(url, init);
    }
    const proxyUrl = config.outboundProxyUrl?.trim();
    if (!proxyUrl)
        return fetch(url, init);
    return fetch(url, { ...init, dispatcher: getProxyAgent(proxyUrl) });
}
export function shouldUseOutboundProxy(config, url, policy) {
    if (policy === 'direct')
        return false;
    if (!config.outboundProxyUrl?.trim())
        return false;
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
        return false;
    if (isProxyBypassedHost(url.hostname, config.outboundProxyBypassHosts))
        return false;
    return policy === 'proxy' || policy === 'auto';
}
function getProxyAgent(proxyUrl) {
    let agent = proxyAgents.get(proxyUrl);
    if (!agent) {
        agent = new ProxyAgent(proxyUrl);
        proxyAgents.set(proxyUrl, agent);
    }
    return agent;
}
function isProxyBypassedHost(hostname, configuredHosts) {
    const host = normalizeHostname(hostname);
    if (!host)
        return true;
    if (isPrivateOrLocalIp(host))
        return true;
    if (host.includes('-internal.') || host.includes('.internal.'))
        return true;
    for (const pattern of [...DEFAULT_BYPASS_HOSTS, ...configuredHosts]) {
        if (matchesHostPattern(host, pattern))
            return true;
    }
    return false;
}
function normalizeHostname(hostname) {
    return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
}
function matchesHostPattern(host, pattern) {
    const normalized = normalizeHostname(pattern);
    if (!normalized)
        return false;
    if (host === normalized)
        return true;
    if (normalized.startsWith('*.'))
        return host.endsWith(normalized.slice(1));
    if (normalized.startsWith('.'))
        return host.endsWith(normalized);
    return false;
}
function isPrivateOrLocalIp(host) {
    const ipv4 = parseIpv4(host);
    if (ipv4) {
        const [a, b] = ipv4;
        return (a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168));
    }
    const compactIpv6 = host.replace(/^0+/, '');
    return compactIpv6 === '::1' || compactIpv6.startsWith('fe80:') || compactIpv6.startsWith('fc') || compactIpv6.startsWith('fd');
}
function parseIpv4(host) {
    const parts = host.split('.');
    if (parts.length !== 4)
        return undefined;
    const bytes = parts.map((part) => Number(part));
    if (bytes.some((byte, index) => !Number.isInteger(byte) || byte < 0 || byte > 255 || String(byte) !== parts[index])) {
        return undefined;
    }
    return bytes;
}
