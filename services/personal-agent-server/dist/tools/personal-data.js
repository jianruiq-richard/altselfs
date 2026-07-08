import { decryptCredentialPayload, isCredentialVaultConfigured } from '../credential-vault.js';
import { listPersonalConnections, loadPersonalCredential, recordPersonalToolCallAudit, updatePersonalCredentialPayload, } from '../personal-data-store.js';
import { isRecord, truncate } from '../util.js';
const PERSONAL_TOOL_NAMES = new Set([
    'altselfs_connected_accounts_list',
    'altselfs_gmail_search_messages',
    'altselfs_gmail_get_message',
    'altselfs_gmail_get_thread',
]);
export function isPersonalDataTool(toolName) {
    return PERSONAL_TOOL_NAMES.has(toolName);
}
export async function createPersonalDataDynamicTools(config, input) {
    const investorId = input.investorId?.trim();
    if (!investorId || !isCredentialVaultConfigured())
        return [];
    let gmailConnections = [];
    try {
        gmailConnections = await listPersonalConnections(config, { investorId, provider: 'gmail' });
    }
    catch {
        return [];
    }
    const tools = [
        {
            namespace: null,
            name: 'altselfs_connected_accounts_list',
            description: 'List the user-connected personal data accounts available to this turn, such as Gmail accounts. Use before private-channel research when you need to know what the user has authorized.',
            inputSchema: {
                type: 'object',
                properties: {
                    provider: { type: 'string', description: 'Optional provider filter, for example gmail.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        },
    ];
    if (gmailConnections.length > 0) {
        tools.push({
            namespace: null,
            name: 'altselfs_gmail_search_messages',
            description: 'Search the user-authorized Gmail account(s). Best for recent email, inbox triage, todos, follow-ups, sender/subject queries, and date-window scans. Returns compact message metadata and snippets; call get_message for full body only when needed.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Gmail search query, e.g. newer_than:1d, from:alice@example.com, subject:(invoice).' },
                    maxResults: { type: 'number', description: 'Max messages per account, default 10, capped at 20.' },
                    accountId: { type: 'string', description: 'Optional Altselfs connection id. If omitted, searches all connected Gmail accounts.' },
                    accountEmail: { type: 'string', description: 'Optional Gmail email. If omitted, searches all connected Gmail accounts.' },
                    includeSpamTrash: { type: 'boolean', description: 'Whether to include spam/trash. Default false.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_gmail_get_message',
            description: 'Read one full Gmail message from a user-authorized account. Use only after search finds a relevant message or the user provides a message id.',
            inputSchema: {
                type: 'object',
                properties: {
                    messageId: { type: 'string', description: 'Gmail message id.' },
                    accountId: { type: 'string', description: 'Altselfs connection id. Required when multiple Gmail accounts are connected.' },
                    accountEmail: { type: 'string', description: 'Gmail email. Alternative to accountId.' },
                },
                required: ['messageId'],
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_gmail_get_thread',
            description: 'Read a Gmail thread from a user-authorized account. Use when thread context is needed for follow-up decisions or summaries.',
            inputSchema: {
                type: 'object',
                properties: {
                    threadId: { type: 'string', description: 'Gmail thread id.' },
                    maxMessages: { type: 'number', description: 'Max thread messages to return, default 10, capped at 20.' },
                    accountId: { type: 'string', description: 'Altselfs connection id. Required when multiple Gmail accounts are connected.' },
                    accountEmail: { type: 'string', description: 'Gmail email. Alternative to accountId.' },
                },
                required: ['threadId'],
                additionalProperties: false,
            },
            deferLoading: false,
        });
    }
    return tools;
}
export async function runPersonalDataTool(toolName, argumentsValue, config, context) {
    const args = isRecord(argumentsValue) ? argumentsValue : {};
    try {
        if (toolName === 'altselfs_connected_accounts_list') {
            const result = await connectedAccountsList(config, context, args);
            await audit(config, context, toolName, args, result, 'SUCCESS');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_gmail_search_messages') {
            const result = await gmailSearchMessages(config, context, args);
            await audit(config, context, toolName, args, summarizeResult(result), 'SUCCESS', 'gmail');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_gmail_get_message') {
            const result = await gmailGetMessage(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'gmail', result.account?.connectionId);
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_gmail_get_thread') {
            const result = await gmailGetThread(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'gmail', result.account?.connectionId);
            return JSON.stringify(result, null, 2);
        }
        return JSON.stringify({ source: 'personal-data-tools', error: `Unsupported personal data tool: ${toolName}` }, null, 2);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await audit(config, context, toolName, redactArgs(args), null, 'ERROR', undefined, undefined, detail);
        return JSON.stringify({
            source: 'personal-data-tools',
            toolName,
            error: detail,
            limitations: ['The account may be disconnected, the OAuth token may be expired/revoked, or the credential vault may be unavailable.'],
        }, null, 2);
    }
}
async function connectedAccountsList(config, context, args) {
    const provider = typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim().toLowerCase() : undefined;
    const connections = await listPersonalConnections(config, { investorId: context.investorId, provider });
    return {
        source: 'personal-data-connections',
        fetchedAt: new Date().toISOString(),
        accounts: connections.map(publicConnection),
    };
}
async function gmailSearchMessages(config, context, args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const maxResults = clampNumber(args.maxResults, 10, 1, 20);
    const connections = await resolveGmailConnections(config, context, args, { allowAll: true });
    const accounts = [];
    for (const connection of connections) {
        const token = await getFreshGmailAccessToken(config, context, connection);
        const messages = await gmailSearch(token, { query, maxResults, includeSpamTrash: args.includeSpamTrash === true });
        accounts.push({
            account: publicConnection(connection),
            query,
            messages,
        });
    }
    return {
        source: 'gmail',
        fetchedAt: new Date().toISOString(),
        confidence: 'high',
        accounts,
        limitations: ['Search results are limited by Gmail query syntax, account OAuth scope, and the maxResults cap.'],
    };
}
async function gmailGetMessage(config, context, args) {
    const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
    if (!messageId)
        throw new Error('messageId is required.');
    const [connection] = await resolveGmailConnections(config, context, args, { allowAll: false });
    const token = await getFreshGmailAccessToken(config, context, connection);
    const message = await gmailFetch(token, `messages/${encodeURIComponent(messageId)}?format=full`);
    return {
        source: 'gmail',
        fetchedAt: new Date().toISOString(),
        account: publicConnection(connection),
        message: fullMessageDigest(message),
    };
}
async function gmailGetThread(config, context, args) {
    const threadId = typeof args.threadId === 'string' ? args.threadId.trim() : '';
    if (!threadId)
        throw new Error('threadId is required.');
    const maxMessages = clampNumber(args.maxMessages, 10, 1, 20);
    const [connection] = await resolveGmailConnections(config, context, args, { allowAll: false });
    const token = await getFreshGmailAccessToken(config, context, connection);
    const thread = await gmailFetch(token, `threads/${encodeURIComponent(threadId)}?format=full`);
    return {
        source: 'gmail',
        fetchedAt: new Date().toISOString(),
        account: publicConnection(connection),
        thread: {
            id: thread.id,
            historyId: thread.historyId || null,
            messages: (thread.messages || []).slice(0, maxMessages).map(fullMessageDigest),
            omittedMessages: Math.max(0, (thread.messages || []).length - maxMessages),
        },
    };
}
async function resolveGmailConnections(config, context, args, options) {
    const connections = await listPersonalConnections(config, { investorId: context.investorId, provider: 'gmail' });
    if (connections.length === 0)
        throw new Error('No connected Gmail account is available for this user.');
    const accountId = readArgString(args.accountId) || readArgString(args.connectionId);
    const accountEmail = (readArgString(args.accountEmail) || readArgString(args.email) || readArgString(args.account)).toLowerCase();
    if (accountId) {
        const matched = connections.find((item) => item.id === accountId);
        if (!matched)
            throw new Error(`Gmail account not found for accountId=${accountId}.`);
        return [matched];
    }
    if (accountEmail && accountEmail !== 'all') {
        const matched = connections.find((item) => item.externalAccountId.toLowerCase() === accountEmail);
        if (!matched)
            throw new Error(`Gmail account not found for accountEmail=${accountEmail}.`);
        return [matched];
    }
    if (options.allowAll)
        return connections.slice(0, 5);
    if (connections.length === 1)
        return connections;
    throw new Error('Multiple Gmail accounts are connected. Provide accountId or accountEmail.');
}
async function getFreshGmailAccessToken(config, context, connection) {
    const credential = await loadPersonalCredential(config, { investorId: context.investorId, connectionId: connection.id });
    if (!credential)
        throw new Error(`Credential not found for Gmail account ${connection.externalAccountId}.`);
    const payload = decryptCredentialPayload({
        keyProvider: credential.keyProvider,
        encryptedPayload: credential.encryptedPayload,
        encryptedDataKey: credential.encryptedDataKey,
    });
    const expiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : 0;
    if (payload.accessToken && (!expiresAt || expiresAt > Date.now() + 60_000))
        return payload.accessToken;
    if (!payload.refreshToken)
        throw new Error(`Gmail account ${connection.externalAccountId} needs reconnect: no refresh token is available.`);
    const refreshed = await refreshGoogleAccessToken(payload.refreshToken);
    const nextPayload = {
        ...payload,
        accessToken: refreshed.access_token,
        tokenType: refreshed.token_type || payload.tokenType,
        scope: refreshed.scope || payload.scope,
        expiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null,
    };
    await updatePersonalCredentialPayload(config, {
        investorId: context.investorId,
        connectionId: connection.id,
        payload: nextPayload,
    });
    return nextPayload.accessToken;
}
async function refreshGoogleAccessToken(refreshToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret)
        throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured on personal-agent-server.');
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const data = await res.json();
    if (!res.ok)
        throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`);
    return data;
}
async function gmailSearch(accessToken, input) {
    const params = new URLSearchParams();
    params.set('maxResults', String(input.maxResults));
    if (input.query)
        params.set('q', input.query);
    if (input.includeSpamTrash)
        params.set('includeSpamTrash', 'true');
    const list = await gmailFetch(accessToken, `messages?${params.toString()}`);
    const ids = (list.messages || []).slice(0, input.maxResults);
    const messages = [];
    for (const item of ids) {
        const params = new URLSearchParams({ format: 'metadata' });
        for (const header of ['Subject', 'From', 'To', 'Cc', 'Date'])
            params.append('metadataHeaders', header);
        const message = await gmailFetch(accessToken, `messages/${encodeURIComponent(item.id)}?${params.toString()}`);
        messages.push(metadataMessageDigest(message));
    }
    return messages;
}
async function gmailFetch(accessToken, path) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(`Gmail API failed: ${JSON.stringify(data).slice(0, 1000)}`);
    return data;
}
function metadataMessageDigest(message) {
    const headers = headersMap(message.payload?.headers || []);
    return {
        id: message.id,
        threadId: message.threadId || null,
        subject: headers.subject || '',
        from: headers.from || '',
        to: headers.to || '',
        cc: headers.cc || '',
        date: headers.date || '',
        snippet: message.snippet || '',
        labels: message.labelIds || [],
        internalDate: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
    };
}
function fullMessageDigest(message) {
    return {
        ...metadataMessageDigest(message),
        bodyText: truncate(extractBodyText(message.payload), 8000),
        attachments: collectAttachments(message.payload),
        sizeEstimate: message.sizeEstimate || 0,
    };
}
function headersMap(headers) {
    const map = {};
    for (const header of headers)
        map[header.name.toLowerCase()] = header.value;
    return map;
}
function extractBodyText(part) {
    if (!part)
        return '';
    if (part.mimeType === 'text/plain' && part.body?.data)
        return decodeGmailBody(part.body.data);
    const nested = (part.parts || []).map(extractBodyText).filter(Boolean).join('\n\n');
    if (nested)
        return nested;
    if (part.mimeType === 'text/html' && part.body?.data)
        return stripHtml(decodeGmailBody(part.body.data));
    return '';
}
function collectAttachments(part) {
    if (!part)
        return [];
    const own = part.filename
        ? [{
                filename: part.filename,
                mimeType: part.mimeType || '',
                size: part.body?.size || 0,
                hasAttachmentId: Boolean(part.body?.attachmentId),
            }]
        : [];
    return [...own, ...(part.parts || []).flatMap(collectAttachments)];
}
function decodeGmailBody(value) {
    return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function stripHtml(value) {
    return value
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function publicConnection(connection) {
    return {
        connectionId: connection.id,
        provider: connection.provider,
        accountEmail: connection.externalAccountId,
        displayName: connection.displayName,
        scopes: connection.scopes,
        status: connection.status,
        updatedAt: connection.updatedAt,
    };
}
function clampNumber(value, fallback, min, max) {
    const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(number))
        return fallback;
    return Math.max(min, Math.min(max, Math.floor(number)));
}
function readArgString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function redactArgs(args) {
    return Object.fromEntries(Object.entries(args).filter(([key]) => !/token|secret|authorization/i.test(key)));
}
function summarizeResult(result) {
    if (!isRecord(result))
        return null;
    if (Array.isArray(result.accounts)) {
        return { accountCount: result.accounts.length };
    }
    if (isRecord(result.message))
        return { messageId: result.message.id, threadId: result.message.threadId };
    if (isRecord(result.thread))
        return { threadId: result.thread.id, messageCount: Array.isArray(result.thread.messages) ? result.thread.messages.length : 0 };
    return null;
}
async function audit(config, context, toolName, args, result, status, provider, connectionId, error) {
    await recordPersonalToolCallAudit(config, {
        investorId: context.investorId,
        userId: context.userId,
        threadId: context.threadId,
        runId: context.runId,
        toolName,
        provider,
        connectionId,
        argsSummary: redactArgs(isRecord(args) ? args : {}),
        resultSummary: result,
        status,
        error,
    });
}
