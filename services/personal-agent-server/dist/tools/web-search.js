import { isRecord } from '../util.js';
export function createWebSearchDynamicTool() {
    return {
        namespace: null,
        name: 'altselfs_web_search',
        description: 'Search the public web for current external information. Use this when public web facts, news, industry updates, market information, or web research are needed and no more specific registered channel/tool is better. Returns compact search results with title, URL, and snippet.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query.' },
                recency: { type: 'string', description: 'Optional recency hint such as today, 24h, week, month.' },
            },
            required: ['query'],
            additionalProperties: false,
        },
        deferLoading: false,
    };
}
export async function runWebSearchTool(argumentsValue, config) {
    const args = isRecord(argumentsValue) ? argumentsValue : {};
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const recency = typeof args.recency === 'string' ? args.recency.trim() : undefined;
    if (!query)
        return JSON.stringify({ error: 'query is required' });
    const provider = resolveWebSearchProvider(config);
    if (!provider) {
        return JSON.stringify({
            query,
            recency,
            error: 'No web search provider is configured. Set SERPAPI_API_KEY, SERPER_API_KEY, GOOGLE_CSE_API_KEY plus GOOGLE_CSE_ID, or BING_SEARCH_API_KEY.',
        });
    }
    try {
        const results = await runProviderSearch(provider, query, recency, config);
        return JSON.stringify({ query, recency, source: provider, results }, null, 2);
    }
    catch (error) {
        return JSON.stringify({
            query,
            recency,
            source: provider,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
export function resolveWebSearchProvider(config) {
    const configured = config.webSearchProvider;
    if (configured !== 'auto') {
        if (configured === 'serpapi' && !process.env[config.serpApiKeyEnv]?.trim())
            return null;
        if (configured === 'serper' && !process.env[config.serperApiKeyEnv]?.trim())
            return null;
        if (configured === 'google_cse' &&
            (!process.env[config.googleCseApiKeyEnv]?.trim() || !process.env[config.googleCseIdEnv]?.trim())) {
            return null;
        }
        if (configured === 'bing' && !process.env[config.bingSearchApiKeyEnv]?.trim())
            return null;
        return configured;
    }
    if (process.env[config.serpApiKeyEnv]?.trim())
        return 'serpapi';
    if (process.env[config.serperApiKeyEnv]?.trim())
        return 'serper';
    if (process.env[config.googleCseApiKeyEnv]?.trim() && process.env[config.googleCseIdEnv]?.trim()) {
        return 'google_cse';
    }
    if (process.env[config.bingSearchApiKeyEnv]?.trim())
        return 'bing';
    return 'duckduckgo';
}
async function runProviderSearch(provider, query, recency, config) {
    if (provider === 'serpapi')
        return serpApiSearch(query, recency, process.env[config.serpApiKeyEnv] || '');
    if (provider === 'serper')
        return serperSearch(query, recency, process.env[config.serperApiKeyEnv] || '');
    if (provider === 'google_cse') {
        return googleCseSearch(query, process.env[config.googleCseApiKeyEnv] || '', process.env[config.googleCseIdEnv] || '');
    }
    if (provider === 'bing')
        return bingSearch(query, recency, config);
    return duckDuckGoHtmlSearch(query);
}
async function serpApiSearch(query, recency, apiKey) {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', query);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', '8');
    url.searchParams.set('hl', 'zh-cn');
    url.searchParams.set('gl', 'cn');
    const timeRange = googleTimeRange(recency);
    if (timeRange)
        url.searchParams.set('tbs', timeRange);
    const response = await fetchJsonWithTimeout(url.toString(), { method: 'GET' });
    const organic = Array.isArray(response.organic_results) ? response.organic_results : [];
    return organic.slice(0, 8).map((item) => ({
        title: String(item.title || ''),
        url: String(item.link || ''),
        snippet: String(item.snippet || ''),
        publishedDate: typeof item.date === 'string' ? item.date : undefined,
    }));
}
async function serperSearch(query, recency, apiKey) {
    const response = await fetchJsonWithTimeout('https://google.serper.dev/search', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify({
            q: query,
            num: 8,
            ...(googleTimeRange(recency) ? { tbs: googleTimeRange(recency) } : {}),
        }),
    });
    const organic = Array.isArray(response.organic) ? response.organic : [];
    return organic.slice(0, 8).map((item) => ({
        title: String(item.title || ''),
        url: String(item.link || ''),
        snippet: String(item.snippet || ''),
        publishedDate: typeof item.date === 'string' ? item.date : undefined,
    }));
}
function googleTimeRange(recency) {
    const value = recency?.toLowerCase() || '';
    if (value.includes('today') || value.includes('24h') || value.includes('day'))
        return 'qdr:d';
    if (value.includes('week') || value.includes('7d'))
        return 'qdr:w';
    if (value.includes('month') || value.includes('30d'))
        return 'qdr:m';
    return '';
}
async function googleCseSearch(query, apiKey, cx) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '8');
    const response = await fetchJsonWithTimeout(url.toString(), { method: 'GET' });
    const items = Array.isArray(response.items) ? response.items : [];
    return items.slice(0, 8).map((item) => ({
        title: String(item.title || ''),
        url: String(item.link || ''),
        snippet: String(item.snippet || ''),
    }));
}
async function bingSearch(query, recency, config) {
    const endpoint = new URL(config.bingSearchEndpoint);
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('count', '8');
    endpoint.searchParams.set('mkt', 'zh-CN');
    const freshness = bingFreshness(recency);
    if (freshness)
        endpoint.searchParams.set('freshness', freshness);
    const response = await fetchJsonWithTimeout(endpoint.toString(), {
        method: 'GET',
        headers: {
            'Ocp-Apim-Subscription-Key': process.env[config.bingSearchApiKeyEnv] || '',
        },
    });
    const values = isRecord(response.webPages) && Array.isArray(response.webPages.value) ? response.webPages.value : [];
    return values.slice(0, 8).map((item) => ({
        title: String(item.name || ''),
        url: String(item.url || ''),
        snippet: String(item.snippet || ''),
        publishedDate: typeof item.dateLastCrawled === 'string' ? item.dateLastCrawled : undefined,
    }));
}
function bingFreshness(recency) {
    const value = recency?.toLowerCase() || '';
    if (value.includes('today') || value.includes('24h') || value.includes('day'))
        return 'Day';
    if (value.includes('week') || value.includes('7d'))
        return 'Week';
    if (value.includes('month') || value.includes('30d'))
        return 'Month';
    return '';
}
async function fetchJsonWithTimeout(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`search request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 300)}` : ''}`);
        }
        return await response.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
async function duckDuckGoHtmlSearch(query) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'user-agent': 'AltselfsPersonalAgent/0.1',
            },
        });
        if (!response.ok)
            throw new Error(`search request failed with HTTP ${response.status}`);
        const html = await response.text();
        return parseDuckDuckGoResults(html).slice(0, 8);
    }
    finally {
        clearTimeout(timeout);
    }
}
function parseDuckDuckGoResults(html) {
    const results = [];
    const blocks = html.split(/<div class="result results_links/).slice(1);
    for (const block of blocks) {
        const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!linkMatch)
            continue;
        const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
        const rawUrl = decodeHtml(linkMatch[1]);
        results.push({
            title: cleanHtml(linkMatch[2]),
            url: extractDuckDuckGoTarget(rawUrl),
            snippet: cleanHtml(snippetMatch?.[1] || snippetMatch?.[2] || ''),
        });
    }
    return results;
}
function extractDuckDuckGoTarget(rawUrl) {
    try {
        const parsed = new URL(rawUrl, 'https://duckduckgo.com');
        const target = parsed.searchParams.get('uddg');
        return target ? decodeURIComponent(target) : parsed.toString();
    }
    catch {
        return rawUrl;
    }
}
function cleanHtml(value) {
    return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
function decodeHtml(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#x27;|&#39;/g, "'");
}
