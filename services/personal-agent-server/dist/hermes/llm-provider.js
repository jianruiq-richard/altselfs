const APIYI_CLAUDE_SONNET_4_6 = 'claude-sonnet-4-6';
const OPENROUTER_DEEPSEEK_V3_2 = 'deepseek/deepseek-v3.2';
export function normalizeHermesModel(model) {
    if (typeof model !== 'string')
        return undefined;
    const value = model.trim();
    if (!value)
        return undefined;
    const normalized = value.toLowerCase();
    if (normalized === APIYI_CLAUDE_SONNET_4_6 ||
        normalized === 'claude-sonnet-4.6' ||
        normalized === 'claude-sonnet-4_6' ||
        normalized === 'sonnet-4-6' ||
        normalized === 'sonnet-4.6') {
        return APIYI_CLAUDE_SONNET_4_6;
    }
    if (normalized === OPENROUTER_DEEPSEEK_V3_2 ||
        normalized === 'deepseek-v3.2' ||
        normalized === 'deepseek3.2') {
        return OPENROUTER_DEEPSEEK_V3_2;
    }
    return value;
}
export function resolveHermesModelSelection(config, requested) {
    const model = normalizeHermesModel(requested) || normalizeHermesModel(config.hermesModel) || APIYI_CLAUDE_SONNET_4_6;
    if (model === APIYI_CLAUDE_SONNET_4_6) {
        return {
            model,
            provider: 'apiyi',
            baseUrl: config.hermesBaseUrl || 'https://api.apiyi.com/v1',
            apiKeyEnv: config.hermesApiKeyEnv || 'APIYI_API_KEY',
            apiMode: 'chat_completions',
        };
    }
    if (model === OPENROUTER_DEEPSEEK_V3_2) {
        return {
            model,
            provider: 'openrouter',
            baseUrl: config.openRouterBaseUrl,
            apiKeyEnv: config.openRouterApiKeyEnv,
            apiMode: 'chat_completions',
        };
    }
    return {
        model,
        provider: config.hermesProvider || 'custom',
        baseUrl: config.hermesBaseUrl || config.openRouterBaseUrl,
        apiKeyEnv: config.hermesApiKeyEnv || config.openRouterApiKeyEnv,
        apiMode: 'chat_completions',
    };
}
export function resolveHermesApiKey(selection) {
    return process.env[selection.apiKeyEnv]?.trim() || '';
}
export function hermesChatCompletionsUrl(selection) {
    return `${selection.baseUrl.replace(/\/$/, '')}/chat/completions`;
}
export function hermesChatHeaders(config, selection) {
    const headers = {
        authorization: `Bearer ${resolveHermesApiKey(selection)}`,
        'content-type': 'application/json',
    };
    if (selection.provider === 'openrouter') {
        headers['x-openrouter-title'] = config.openRouterAppTitle;
    }
    return headers;
}
