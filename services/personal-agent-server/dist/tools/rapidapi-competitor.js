import { isRecord } from '../util.js';
const TOOLS = [
    {
        source: 'similarweb-api1',
        host: 'similarweb-api1.p.rapidapi.com',
        name: 'altselfs_similarweb_api1',
        description: 'Use RapidAPI similarweb-api1 visitsInfo for competitor traffic intelligence. Best for total visits, visit trend, countries, devices, engagement, traffic sources, keywords, AI traffic, and competitor/source discovery when covered.',
        inputSchema: domainInputSchema('Target domain, for example figurelabs.ai. Do not include protocol.'),
        run: async (args, config) => {
            const domain = normalizeDomain(readString(args.domain));
            if (!domain)
                return missingInput('domain');
            return rapidApiJson({
                config,
                host: 'similarweb-api1.p.rapidapi.com',
                url: 'https://similarweb-api1.p.rapidapi.com/v1/visitsInfo',
                init: {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ q: domain }),
                },
                publicInput: { domain },
            });
        },
    },
    {
        source: 'semrush13',
        host: 'semrush13.p.rapidapi.com',
        name: 'altselfs_semrush13',
        description: 'Use RapidAPI semrush13 domain-data for competitor intelligence. Best for covered domains with visits, growth history, search traffic, countries, devices, traffic journey, backlinks summary, keywords, competitors, and AI traffic. Does not provide backlink URL lists.',
        inputSchema: domainInputSchema('Target domain, for example magiclight.ai. Do not include protocol.'),
        run: async (args, config) => {
            const domain = normalizeDomain(readString(args.domain));
            if (!domain)
                return missingInput('domain');
            const url = new URL('https://semrush13.p.rapidapi.com/domain-data');
            url.searchParams.set('domain', domain);
            return rapidApiJson({
                config,
                host: 'semrush13.p.rapidapi.com',
                url: url.toString(),
                publicInput: { domain },
            });
        },
    },
    {
        source: 'semrush8',
        host: 'semrush8.p.rapidapi.com',
        name: 'altselfs_semrush8',
        description: 'Use RapidAPI semrush8 url_traffic for lightweight SEO summary when richer sources do not cover the domain. Returns Semrush-like rank, keyword count, traffic estimate, cost estimate, and link counts.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'Target URL, for example https://figurelabs.ai/.' },
                domain: { type: 'string', description: 'Target domain. Used to construct https://domain/ if url is omitted.' },
            },
            additionalProperties: false,
        },
        run: async (args, config) => {
            const targetUrl = normalizeUrl(readString(args.url), readString(args.domain));
            if (!targetUrl)
                return missingInput('url or domain');
            const url = new URL('https://semrush8.p.rapidapi.com/url_traffic');
            url.searchParams.set('url', targetUrl);
            return rapidApiJson({
                config,
                host: 'semrush8.p.rapidapi.com',
                url: url.toString(),
                publicInput: { url: targetUrl },
            });
        },
    },
    {
        source: 'domain-metrics-check',
        host: 'domain-metrics-check.p.rapidapi.com',
        name: 'altselfs_domain_metrics_check',
        description: 'Use RapidAPI Domain Metrics Check for SEO authority and backlink summary. Returns Moz, Majestic, and Ahrefs-style metrics such as DA, PA, spam score, Trust Flow, Citation Flow, DR, backlinks, referring domains, organic keywords, and traffic proxy.',
        inputSchema: domainInputSchema('Target domain, for example figurelabs.ai. Do not include protocol.'),
        run: async (args, config) => {
            const domain = normalizeDomain(readString(args.domain));
            if (!domain)
                return missingInput('domain');
            return rapidApiJson({
                config,
                host: 'domain-metrics-check.p.rapidapi.com',
                url: `https://domain-metrics-check.p.rapidapi.com/domain-metrics/${encodeURIComponent(domain)}/`,
                publicInput: { domain },
            });
        },
    },
];
export function createRapidApiCompetitorDynamicTools() {
    return TOOLS.map((tool) => ({
        namespace: null,
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        deferLoading: false,
    }));
}
export async function runRapidApiCompetitorTool(toolName, argumentsValue, config) {
    const tool = TOOLS.find((item) => item.name === toolName);
    if (!tool)
        return JSON.stringify({ source: 'rapidapi-competitor', error: `Unsupported tool: ${toolName}` });
    const args = isRecord(argumentsValue) ? argumentsValue : {};
    const configured = Boolean(process.env[config.rapidApiKeyEnv]?.trim());
    const fetchedAt = new Date().toISOString();
    if (!configured) {
        return JSON.stringify({
            source: tool.source,
            fetchedAt,
            error: `RapidAPI platform key is not configured. Set ${config.rapidApiKeyEnv} before executing ${tool.name}.`,
            limitations: ['The competitive intelligence profile can see this tool, but the platform key is missing in this environment.'],
        }, null, 2);
    }
    try {
        const data = await tool.run(args, config);
        return JSON.stringify({
            source: tool.source,
            host: tool.host,
            fetchedAt,
            input: publicArgs(args),
            data,
            confidence: 'medium',
            limitations: [
                'RapidAPI providers are third-party wrappers and may differ from official Semrush, Similarweb, Moz, Majestic, or Ahrefs APIs.',
                'Traffic, user, revenue, backlink, and keyword numbers are estimates or proxy signals; present them with source and confidence labels.',
            ],
        }, null, 2);
    }
    catch (error) {
        return JSON.stringify({
            source: tool.source,
            host: tool.host,
            fetchedAt,
            input: publicArgs(args),
            error: error instanceof Error ? error.message : String(error),
            limitations: ['The RapidAPI request failed, the provider rate-limited the request, or the domain is not covered.'],
        }, null, 2);
    }
}
export function isRapidApiCompetitorTool(toolName) {
    return TOOLS.some((tool) => tool.name === toolName);
}
function domainInputSchema(description) {
    return {
        type: 'object',
        properties: {
            domain: { type: 'string', description },
        },
        required: ['domain'],
        additionalProperties: false,
    };
}
async function rapidApiJson(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.config.rapidApiRequestTimeoutMs);
    try {
        const response = await fetch(input.url, {
            ...input.init,
            signal: controller.signal,
            headers: {
                ...(input.init?.headers || {}),
                'x-rapidapi-host': input.host,
                'x-rapidapi-key': process.env[input.config.rapidApiKeyEnv] || '',
            },
        });
        const text = await response.text();
        const body = parseBody(text);
        if (!response.ok) {
            throw new Error(`RapidAPI request failed with HTTP ${response.status}: ${text.slice(0, 1000)}`);
        }
        return {
            request: input.publicInput,
            status: response.status,
            body,
        };
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`RapidAPI request timed out after ${input.config.rapidApiRequestTimeoutMs}ms`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeout);
    }
}
function parseBody(text) {
    const trimmed = text.trim();
    if (!trimmed)
        return null;
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return trimmed;
    }
}
function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeDomain(value) {
    if (!value)
        return '';
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
        return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
    }
    catch {
        return value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
    }
}
function normalizeUrl(urlValue, domainValue) {
    if (urlValue)
        return /^https?:\/\//i.test(urlValue) ? urlValue : `https://${urlValue}`;
    const domain = normalizeDomain(domainValue);
    return domain ? `https://${domain}/` : '';
}
function missingInput(name) {
    return { error: `${name} is required.` };
}
function publicArgs(args) {
    const allowed = ['domain', 'url'];
    return Object.fromEntries(Object.entries(args).filter(([key]) => allowed.includes(key)));
}
