import { decryptCredentialPayload, isCredentialVaultConfigured } from '../credential-vault.js';
import { externalFetch } from '../outbound-fetch.js';
import { listPersonalConnections, loadPersonalCredential, recordPersonalToolCallAudit, updatePersonalCredentialPayload, } from '../personal-data-store.js';
import { DEFAULT_FEISHU_CLI_FEATURE_PACKAGES, normalizeFeishuCliFeaturePackages, runFeishuCliWithSnapshot, } from '../feishu-cli.js';
import { isRecord, truncate } from '../util.js';
const PERSONAL_TOOL_NAMES = new Set([
    'altselfs_connected_accounts_list',
    'altselfs_gmail_search_messages',
    'altselfs_gmail_get_message',
    'altselfs_gmail_get_thread',
    'altselfs_feishu_list_chats',
    'altselfs_feishu_list_messages',
    'altselfs_feishu_recent_messages',
    'altselfs_feishu_search_messages',
    'altselfs_feishu_search_users',
    'altselfs_feishu_today_calendar',
    'altselfs_feishu_search_docs',
    'altselfs_feishu_fetch_doc',
]);
export function isPersonalDataTool(toolName) {
    return PERSONAL_TOOL_NAMES.has(toolName);
}
export async function createPersonalDataDynamicTools(config, input) {
    const investorId = input.investorId?.trim();
    if (!investorId || !isCredentialVaultConfigured())
        return [];
    let gmailConnections = [];
    let feishuConnections = [];
    try {
        gmailConnections = await listPersonalConnections(config, { investorId, provider: 'gmail' });
        feishuConnections = await listPersonalConnections(config, { investorId, provider: 'feishu' });
    }
    catch {
        return [];
    }
    const tools = [
        {
            namespace: null,
            name: 'altselfs_connected_accounts_list',
            description: 'List the user-connected personal data accounts available to this turn, such as Gmail and Feishu accounts. Use before private-channel research when you need to know what the user has authorized.',
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
    if (feishuConnections.length > 0) {
        tools.push({
            namespace: null,
            name: 'altselfs_feishu_search_messages',
            description: 'Search Feishu/Lark IM messages across chats with the user-authorized lark-cli profile. Prefer this for questions about a person, keyword, today\'s messages, mentions, or follow-ups because it does not require a prior chat list.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Keyword to search, e.g. a person name, project, customer, or topic. Optional for time-window scans if Feishu allows it.' },
                    startTime: { type: 'string', description: 'Optional start time as ISO string, Unix seconds, or milliseconds. Default 24 hours ago.' },
                    endTime: { type: 'string', description: 'Optional end time as ISO string, Unix seconds, or milliseconds. Default now.' },
                    chatType: { type: 'string', description: 'Optional chat type filter: p2p or group.' },
                    isAtMe: { type: 'boolean', description: 'Only messages that mention the authorized user.' },
                    pageSize: { type: 'number', description: 'Page size, default 20, capped at 50.' },
                    pageLimit: { type: 'number', description: 'Auto-pagination page limit, default 1, capped at 5.' },
                    accountId: { type: 'string', description: 'Optional Altselfs connection id. If omitted, searches up to 3 connected Feishu accounts.' },
                    accountEmail: { type: 'string', description: 'Optional Feishu display name/external id. Alternative to accountId.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_feishu_search_users',
            description: 'Search Feishu/Lark contacts by name/email/open id with the user-authorized lark-cli profile. Use before reading a direct conversation by person name; results may include p2p_chat_id/open_id.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Person name, email, or keyword.' },
                    queries: { type: 'string', description: 'Optional comma-separated multi-name search.' },
                    userIds: { type: 'string', description: 'Optional comma-separated open_ids; use me for current user.' },
                    hasChatted: { type: 'boolean', description: 'Restrict to users the authorized user has chatted with. Default true when query is provided.' },
                    excludeExternalUsers: { type: 'boolean', description: 'Exclude external cross-tenant users.' },
                    pageSize: { type: 'number', description: 'Rows per request, default 20, capped at 30.' },
                    accountId: { type: 'string', description: 'Optional Altselfs connection id.' },
                    accountEmail: { type: 'string', description: 'Optional Feishu display name/external id. Alternative to accountId.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_feishu_list_chats',
            description: 'List Feishu/Lark IM chats visible through the user-authorized lark-cli profile. Includes p2p and group chats when Feishu returns them. Prefer search_messages for person/topic questions.',
            inputSchema: {
                type: 'object',
                properties: {
                    accountId: { type: 'string', description: 'Optional Altselfs connection id. If omitted, uses the only connected Feishu account or the first few accounts.' },
                    accountEmail: { type: 'string', description: 'Optional Feishu account external id/email/open id. Alternative to accountId.' },
                    pageSize: { type: 'number', description: 'Max chats to return, default 20, capped at 50.' },
                    pageToken: { type: 'string', description: 'Optional Feishu pagination token.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_feishu_list_messages',
            description: 'Read messages from one Feishu/Lark chat or direct user conversation with the user-authorized lark-cli profile. Provide chatId/containerId or a direct userId/open_id.',
            inputSchema: {
                type: 'object',
                properties: {
                    containerId: { type: 'string', description: 'Feishu chat_id or thread_id.' },
                    userId: { type: 'string', description: 'Feishu user open_id for a direct P2P conversation. Alternative to containerId.' },
                    containerIdType: { type: 'string', description: 'chat or thread. Default chat.' },
                    startTime: { type: 'string', description: 'Optional start time as Unix seconds, milliseconds, or ISO string. Default 24 hours ago.' },
                    endTime: { type: 'string', description: 'Optional end time as Unix seconds, milliseconds, or ISO string. Default now.' },
                    sortType: { type: 'string', description: 'ByCreateTimeDesc or ByCreateTimeAsc. Default ByCreateTimeDesc.' },
                    pageSize: { type: 'number', description: 'Max messages to return, default 20, capped at 50.' },
                    pageToken: { type: 'string', description: 'Optional Feishu pagination token.' },
                    accountId: { type: 'string', description: 'Altselfs connection id. Required when multiple Feishu accounts are connected.' },
                    accountEmail: { type: 'string', description: 'Feishu account external id/email/open id. Alternative to accountId.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_feishu_recent_messages',
            description: 'Best-effort scan of recent Feishu/Lark IM messages across visible chats for a connected account. Use for questions like today\'s Feishu messages, team updates, and pending follow-ups. Access may be partial when app scopes, chat settings, or bot membership limit a chat.',
            inputSchema: {
                type: 'object',
                properties: {
                    startTime: { type: 'string', description: 'Optional start time as Unix seconds, milliseconds, or ISO string. Default 24 hours ago.' },
                    endTime: { type: 'string', description: 'Optional end time as Unix seconds, milliseconds, or ISO string. Default now.' },
                    chatLimit: { type: 'number', description: 'Max chats to scan per account, default 10, capped at 30.' },
                    maxMessagesPerChat: { type: 'number', description: 'Max messages per chat, default 10, capped at 30.' },
                    accountId: { type: 'string', description: 'Optional Altselfs connection id. If omitted, scans up to 3 connected Feishu accounts.' },
                    accountEmail: { type: 'string', description: 'Optional Feishu account external id/email/open id. Alternative to accountId.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_feishu_today_calendar',
            description: 'Read the authorized user\'s Feishu/Lark calendar agenda for a date window with lark-cli. Use for today\'s meetings, schedule, and time commitments.',
            inputSchema: {
                type: 'object',
                properties: {
                    startTime: { type: 'string', description: 'Optional start time as ISO string, Unix seconds, or milliseconds. Default start of today.' },
                    endTime: { type: 'string', description: 'Optional end time as ISO string, Unix seconds, or milliseconds. Default end of start day.' },
                    calendarId: { type: 'string', description: 'Optional calendar id, default primary.' },
                    accountId: { type: 'string', description: 'Optional Altselfs connection id.' },
                    accountEmail: { type: 'string', description: 'Optional Feishu display name/external id. Alternative to accountId.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_feishu_search_docs',
            description: 'Search or browse Feishu/Lark docs, wiki, spreadsheet, and Drive files visible to the authorized user with lark-cli. Use for questions like "what Feishu docs do I have", document discovery, plans, specs, and knowledge base content.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Optional document search keyword. Leave empty to browse by filters such as recently opened/edited, mine, or docTypes.' },
                    pageSize: { type: 'number', description: 'Page size, default 10, capped at 20.' },
                    pageToken: { type: 'string', description: 'Optional pagination token.' },
                    docTypes: { type: 'string', description: 'Optional comma-separated types: doc,sheet,bitable,mindnote,file,wiki,docx,folder,catalog,slides,shortcut.' },
                    mine: { type: 'boolean', description: 'Restrict to docs owned by the authorized user.' },
                    createdByMe: { type: 'boolean', description: 'Restrict to docs originally created by the authorized user.' },
                    onlyTitle: { type: 'boolean', description: 'Match titles only.' },
                    sort: { type: 'string', description: 'Optional sort: default, edit_time, edit_time_asc, open_time, create_time.' },
                    openedSince: { type: 'string', description: 'Optional start of my-opened time window, e.g. 7d, 1m, 2026-04-01, RFC3339, or Unix seconds.' },
                    editedSince: { type: 'string', description: 'Optional start of my-edited time window, e.g. 7d, 1m, 2026-04-01, RFC3339, or Unix seconds.' },
                    createdSince: { type: 'string', description: 'Optional start of document-created time window, e.g. 7d, 1m, 2026-04-01, RFC3339, or Unix seconds.' },
                    folderTokens: { type: 'string', description: 'Optional comma-separated folder tokens. Cannot be combined with spaceIds.' },
                    spaceIds: { type: 'string', description: 'Optional comma-separated wiki space IDs. Cannot be combined with folderTokens.' },
                    accountId: { type: 'string', description: 'Optional Altselfs connection id.' },
                    accountEmail: { type: 'string', description: 'Optional Feishu display name/external id. Alternative to accountId.' },
                },
                additionalProperties: false,
            },
            deferLoading: false,
        }, {
            namespace: null,
            name: 'altselfs_feishu_fetch_doc',
            description: 'Read Feishu/Lark document or wiki content visible to the authorized user with lark-cli docs +fetch. Use after search_docs returns a document URL/token, or when the user provides a Feishu document URL/token.',
            inputSchema: {
                type: 'object',
                properties: {
                    doc: { type: 'string', description: 'Feishu/Lark document URL or token. Supports docx and wiki URLs/tokens.' },
                    docFormat: { type: 'string', description: 'Output format: xml, markdown, or im-markdown. Default markdown for summaries.' },
                    detail: { type: 'string', description: 'Detail level: simple, with-ids, or full. Default simple.' },
                    scope: { type: 'string', description: 'Read scope: full, outline, keyword, section, or range. Default full.' },
                    keyword: { type: 'string', description: 'Keyword for scope=keyword. Use | for OR branches.' },
                    startBlockId: { type: 'string', description: 'Block id for section/range start.' },
                    endBlockId: { type: 'string', description: 'Block id for range end, or -1 through document end.' },
                    maxDepth: { type: 'number', description: 'Outline heading depth or subtree depth. Default chosen by lark-cli.' },
                    contextBefore: { type: 'number', description: 'Sibling top-level blocks before scoped matches.' },
                    contextAfter: { type: 'number', description: 'Sibling top-level blocks after scoped matches.' },
                    accountId: { type: 'string', description: 'Optional Altselfs connection id.' },
                    accountEmail: { type: 'string', description: 'Optional Feishu display name/external id. Alternative to accountId.' },
                },
                required: ['doc'],
                additionalProperties: false,
            },
            deferLoading: false,
        });
    }
    const enabledToolNames = new Set(['altselfs_connected_accounts_list']);
    if (gmailConnections.length > 0) {
        for (const name of ['altselfs_gmail_search_messages', 'altselfs_gmail_get_message', 'altselfs_gmail_get_thread']) {
            enabledToolNames.add(name);
        }
    }
    if (feishuConnections.some((connection) => hasFeishuFeaturePackage(connection, 'messages'))) {
        for (const name of [
            'altselfs_feishu_search_messages',
            'altselfs_feishu_list_chats',
            'altselfs_feishu_list_messages',
            'altselfs_feishu_recent_messages',
        ]) {
            enabledToolNames.add(name);
        }
    }
    if (feishuConnections.some((connection) => hasFeishuFeaturePackage(connection, 'contacts'))) {
        enabledToolNames.add('altselfs_feishu_search_users');
    }
    if (feishuConnections.some((connection) => hasFeishuFeaturePackage(connection, 'calendar'))) {
        enabledToolNames.add('altselfs_feishu_today_calendar');
    }
    if (feishuConnections.some((connection) => hasFeishuFeaturePackage(connection, 'docs'))) {
        enabledToolNames.add('altselfs_feishu_search_docs');
        enabledToolNames.add('altselfs_feishu_fetch_doc');
    }
    return tools.filter((tool) => !isRecord(tool) || typeof tool.name !== 'string' || enabledToolNames.has(tool.name));
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
        if (toolName === 'altselfs_feishu_search_messages') {
            const result = await feishuSearchMessages(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_feishu_search_users') {
            const result = await feishuSearchUsers(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_feishu_list_chats') {
            const result = await feishuListChats(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_feishu_list_messages') {
            const result = await feishuListMessages(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu', result.account?.connectionId);
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_feishu_recent_messages') {
            const result = await feishuRecentMessages(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_feishu_today_calendar') {
            const result = await feishuTodayCalendar(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_feishu_search_docs') {
            const result = await feishuSearchDocs(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu');
            return JSON.stringify(result, null, 2);
        }
        if (toolName === 'altselfs_feishu_fetch_doc') {
            const result = await feishuFetchDoc(config, context, args);
            await audit(config, context, toolName, redactArgs(args), summarizeResult(result), 'SUCCESS', 'feishu');
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
        const messages = await gmailSearch(config, token, { query, maxResults, includeSpamTrash: args.includeSpamTrash === true });
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
    const message = await gmailFetch(config, token, `messages/${encodeURIComponent(messageId)}?format=full`);
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
    const thread = await gmailFetch(config, token, `threads/${encodeURIComponent(threadId)}?format=full`);
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
async function feishuListChats(config, context, args) {
    const pageSize = clampNumber(args.pageSize, 20, 1, 100);
    const connections = await resolveFeishuConnections(config, context, args, { allowAll: true, maxAll: 3, requiredPackage: 'messages' });
    const accounts = [];
    for (const connection of connections) {
        const result = await runFeishuCliForConnection(config, context, connection, [
            'im',
            '+chat-list',
            '--as',
            'user',
            '--types',
            'p2p,group',
            '--sort',
            'active_time',
            '--page-size',
            String(pageSize),
            '--json',
            ...optionalCliArg('--page-token', readArgString(args.pageToken)),
        ]);
        accounts.push({
            account: publicConnection(connection),
            result,
        });
    }
    return {
        source: 'feishu',
        resource: 'lark_cli_im_chats',
        fetchedAt: new Date().toISOString(),
        accounts,
        limitations: [
            'Uses lark-cli im +chat-list with user identity and types=p2p,group.',
            'Feishu may still limit which conversations are enumerable for the authorized app/user.',
        ],
    };
}
async function feishuListMessages(config, context, args) {
    const containerId = readArgString(args.containerId) || readArgString(args.chatId) || readArgString(args.threadId);
    const userId = readArgString(args.userId) || readArgString(args.openId);
    if (!containerId && !userId)
        throw new Error('containerId/chatId or userId is required.');
    const pageSize = clampNumber(args.pageSize, 20, 1, 50);
    const [connection] = await resolveFeishuConnections(config, context, args, { allowAll: false, maxAll: 1, requiredPackage: 'messages' });
    const timeWindow = resolveFeishuTimeWindow(args);
    const result = await runFeishuCliForConnection(config, context, connection, [
        'im',
        '+chat-messages-list',
        '--as',
        'user',
        userId ? '--user-id' : '--chat-id',
        userId || containerId,
        '--start',
        unixSecondsToIso(timeWindow.startTime),
        '--end',
        unixSecondsToIso(timeWindow.endTime),
        '--order',
        normalizeFeishuCliSortOrder(readArgString(args.sortType)),
        '--page-size',
        String(pageSize),
        '--json',
        ...optionalCliArg('--page-token', readArgString(args.pageToken)),
    ]);
    return {
        source: 'feishu',
        resource: 'lark_cli_im_messages',
        fetchedAt: new Date().toISOString(),
        account: publicConnection(connection),
        container: userId ? { id: userId, type: 'user' } : { id: containerId, type: 'chat' },
        timeWindow,
        result,
        limitations: [
            'Uses lark-cli im +chat-messages-list. For direct messages, provide userId/open_id from feishu_search_users.',
            'A chat may be unavailable if app scopes, tenant availability, or enterprise policy do not allow access.',
        ],
    };
}
async function feishuRecentMessages(config, context, args) {
    return feishuSearchMessages(config, context, {
        ...args,
        pageSize: args.maxMessagesPerChat || args.pageSize || 20,
        pageLimit: args.pageLimit || 2,
    });
}
async function feishuSearchMessages(config, context, args) {
    const pageSize = clampNumber(args.pageSize, 20, 1, 50);
    const pageLimit = clampNumber(args.pageLimit, 1, 1, 5);
    const timeWindow = resolveFeishuIsoTimeWindow(args);
    const connections = await resolveFeishuConnections(config, context, args, { allowAll: true, maxAll: 3, requiredPackage: 'messages' });
    const accounts = [];
    for (const connection of connections) {
        const result = await runFeishuCliForConnection(config, context, connection, [
            'im',
            '+messages-search',
            '--as',
            'user',
            '--start',
            timeWindow.startIso,
            '--end',
            timeWindow.endIso,
            '--page-size',
            String(pageSize),
            '--json',
            ...(pageLimit > 1 ? ['--page-all', '--page-limit', String(pageLimit)] : []),
            ...optionalCliArg('--query', readArgString(args.query)),
            ...optionalCliArg('--chat-type', normalizeFeishuChatType(readArgString(args.chatType))),
            ...(args.isAtMe === true ? ['--is-at-me'] : []),
        ]);
        accounts.push({ account: publicConnection(connection), timeWindow, result });
    }
    return {
        source: 'feishu',
        resource: 'lark_cli_message_search',
        fetchedAt: new Date().toISOString(),
        accounts,
        limitations: [
            'Uses lark-cli im +messages-search with user identity.',
            'Search results are limited by the user grant, app scopes, and enterprise policy.',
        ],
    };
}
async function feishuSearchUsers(config, context, args) {
    const query = readArgString(args.query);
    const queries = readArgString(args.queries);
    const userIds = readArgString(args.userIds) || readArgString(args.userId);
    if (!query && !queries && !userIds)
        throw new Error('query, queries, or userIds is required.');
    const pageSize = clampNumber(args.pageSize, 20, 1, 30);
    const [connection] = await resolveFeishuConnections(config, context, args, { allowAll: false, maxAll: 1, requiredPackage: 'contacts' });
    const result = await runFeishuCliForConnection(config, context, connection, [
        'contact',
        '+search-user',
        '--as',
        'user',
        '--page-size',
        String(pageSize),
        '--json',
        ...optionalCliArg('--query', query),
        ...optionalCliArg('--queries', queries),
        ...optionalCliArg('--user-ids', userIds),
        ...(args.hasChatted === false || userIds ? [] : ['--has-chatted']),
        ...(args.excludeExternalUsers === true ? ['--exclude-external-users'] : []),
    ]);
    return {
        source: 'feishu',
        resource: 'lark_cli_contact_search',
        fetchedAt: new Date().toISOString(),
        account: publicConnection(connection),
        result,
    };
}
async function feishuTodayCalendar(config, context, args) {
    const timeWindow = resolveFeishuIsoTimeWindow(args, { defaultToday: true });
    const connections = await resolveFeishuConnections(config, context, args, { allowAll: true, maxAll: 3, requiredPackage: 'calendar' });
    const accounts = [];
    for (const connection of connections) {
        const result = await runFeishuCliForConnection(config, context, connection, [
            'calendar',
            '+agenda',
            '--as',
            'user',
            '--start',
            timeWindow.startIso,
            '--end',
            timeWindow.endIso,
            '--json',
            ...optionalCliArg('--calendar-id', readArgString(args.calendarId)),
        ]);
        accounts.push({ account: publicConnection(connection), timeWindow, result });
    }
    return {
        source: 'feishu',
        resource: 'lark_cli_calendar_agenda',
        fetchedAt: new Date().toISOString(),
        accounts,
    };
}
async function feishuSearchDocs(config, context, args) {
    const query = readArgString(args.query);
    const pageSize = clampNumber(args.pageSize, 10, 1, 20);
    const connections = await resolveFeishuConnections(config, context, args, { allowAll: true, maxAll: 3, requiredPackage: 'docs' });
    const accounts = [];
    for (const connection of connections) {
        const result = await runFeishuCliForConnection(config, context, connection, [
            'drive',
            '+search',
            '--as',
            'user',
            '--page-size',
            String(pageSize),
            '--json',
            ...optionalCliArg('--query', truncateCliArg(query, 30)),
            ...optionalCliArg('--page-token', readArgString(args.pageToken)),
            ...optionalCliArg('--doc-types', readArgString(args.docTypes)),
            ...(args.mine === true ? ['--mine'] : []),
            ...(args.createdByMe === true ? ['--created-by-me'] : []),
            ...(args.onlyTitle === true ? ['--only-title'] : []),
            ...optionalCliArg('--sort', normalizeFeishuDocSearchSort(readArgString(args.sort))),
            ...optionalCliArg('--opened-since', readArgString(args.openedSince)),
            ...optionalCliArg('--edited-since', readArgString(args.editedSince)),
            ...optionalCliArg('--created-since', readArgString(args.createdSince)),
            ...optionalCliArg('--folder-tokens', readArgString(args.folderTokens)),
            ...optionalCliArg('--space-ids', readArgString(args.spaceIds)),
        ]);
        accounts.push({ account: publicConnection(connection), result });
    }
    return {
        source: 'feishu',
        resource: 'lark_cli_drive_search',
        fetchedAt: new Date().toISOString(),
        accounts,
        limitations: [
            'Uses lark-cli drive +search with user identity.',
            'Search/browse results are limited by the user grant, app scopes, enterprise policy, and Feishu search indexing.',
            'Use altselfs_feishu_fetch_doc with a returned URL/token when document body content is needed.',
        ],
    };
}
async function feishuFetchDoc(config, context, args) {
    const doc = readArgString(args.doc) || readArgString(args.url) || readArgString(args.token);
    if (!doc)
        throw new Error('doc is required.');
    const [connection] = await resolveFeishuConnections(config, context, args, { allowAll: false, maxAll: 1, requiredPackage: 'docs' });
    const result = await runFeishuCliForConnection(config, context, connection, [
        'docs',
        '+fetch',
        '--as',
        'user',
        '--doc',
        doc,
        '--doc-format',
        normalizeFeishuDocFormat(readArgString(args.docFormat)),
        '--detail',
        normalizeFeishuDocDetail(readArgString(args.detail)),
        '--json',
        ...optionalCliArg('--scope', normalizeFeishuDocFetchScope(readArgString(args.scope))),
        ...optionalCliArg('--keyword', readArgString(args.keyword)),
        ...optionalCliArg('--start-block-id', readArgString(args.startBlockId)),
        ...optionalCliArg('--end-block-id', readArgString(args.endBlockId)),
        ...optionalNumericCliArg('--max-depth', args.maxDepth),
        ...optionalNumericCliArg('--context-before', args.contextBefore),
        ...optionalNumericCliArg('--context-after', args.contextAfter),
    ]);
    return {
        source: 'feishu',
        resource: 'lark_cli_doc_fetch',
        fetchedAt: new Date().toISOString(),
        account: publicConnection(connection),
        document: { input: doc },
        result,
        limitations: [
            'Uses lark-cli docs +fetch with user identity.',
            'Embedded sheets, bitables, and media may require additional dedicated tools to fetch their internal content.',
        ],
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
    const refreshed = await refreshGoogleAccessToken(config, payload.refreshToken);
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
async function resolveFeishuConnections(config, context, args, options) {
    const allConnections = await listPersonalConnections(config, { investorId: context.investorId, provider: 'feishu' });
    const connections = options.requiredPackage
        ? allConnections.filter((connection) => hasFeishuFeaturePackage(connection, options.requiredPackage))
        : allConnections;
    if (connections.length === 0)
        throw new Error('No connected Feishu account is available for this user.');
    const accountId = readArgString(args.accountId) || readArgString(args.connectionId);
    const accountEmail = (readArgString(args.accountEmail) || readArgString(args.email) || readArgString(args.account)).toLowerCase();
    if (accountId) {
        const matched = allConnections.find((item) => item.id === accountId);
        if (!matched)
            throw new Error(`Feishu account not found for accountId=${accountId}.`);
        if (options.requiredPackage && !hasFeishuFeaturePackage(matched, options.requiredPackage)) {
            throw new Error(`Feishu account ${matched.displayName} has not enabled the ${options.requiredPackage} feature package.`);
        }
        return [matched];
    }
    if (accountEmail && accountEmail !== 'all') {
        const matched = allConnections.find((item) => item.externalAccountId.toLowerCase() === accountEmail ||
            item.displayName.toLowerCase() === accountEmail);
        if (!matched)
            throw new Error(`Feishu account not found for accountEmail=${accountEmail}.`);
        if (options.requiredPackage && !hasFeishuFeaturePackage(matched, options.requiredPackage)) {
            throw new Error(`Feishu account ${matched.displayName} has not enabled the ${options.requiredPackage} feature package.`);
        }
        return [matched];
    }
    if (options.allowAll)
        return connections.slice(0, options.maxAll);
    if (connections.length === 1)
        return connections;
    throw new Error('Multiple Feishu accounts are connected. Provide accountId or accountEmail.');
}
function hasFeishuFeaturePackage(connection, featurePackage) {
    if (connection.provider !== 'feishu' || connection.connectionType !== 'lark_cli_user')
        return false;
    const metadata = connection.metadata || {};
    if (Object.prototype.hasOwnProperty.call(metadata, 'feature_packages')) {
        return normalizeFeishuCliFeaturePackages(metadata.feature_packages, []).includes(featurePackage);
    }
    return DEFAULT_FEISHU_CLI_FEATURE_PACKAGES.includes(featurePackage);
}
async function loadFeishuCliCredential(config, context, connection) {
    const credential = await loadPersonalCredential(config, { investorId: context.investorId, connectionId: connection.id });
    if (!credential)
        throw new Error(`Credential not found for Feishu account ${connection.displayName}.`);
    const payload = decryptCredentialPayload({
        keyProvider: credential.keyProvider,
        encryptedPayload: credential.encryptedPayload,
        encryptedDataKey: credential.encryptedDataKey,
    });
    if (payload.authMode !== 'lark_cli_user' && connection.connectionType !== 'lark_cli_user') {
        throw new Error(`Feishu account ${connection.displayName} was bound with the legacy API connector. Rebind Feishu to use the new lark-cli connector.`);
    }
    const profileName = payload.cliProfileName || (typeof connection.metadata.cli_profile_name === 'string' ? connection.metadata.cli_profile_name : '');
    if (!profileName)
        throw new Error(`Feishu account ${connection.displayName} is missing its lark-cli profile. Rebind Feishu.`);
    if (!payload.cliProfileSnapshot) {
        throw new Error(`Feishu account ${connection.displayName} is missing its encrypted lark-cli profile snapshot. Rebind Feishu.`);
    }
    return { profileName, payload };
}
async function runFeishuCliForConnection(config, context, connection, args) {
    const { profileName, payload } = await loadFeishuCliCredential(config, context, connection);
    const { result, profileSnapshot } = await runFeishuCliWithSnapshot(config, profileName, payload.cliProfileSnapshot, args);
    await updatePersonalCredentialPayload(config, {
        investorId: context.investorId,
        connectionId: connection.id,
        payload: {
            ...payload,
            provider: 'feishu',
            authMode: 'lark_cli_user',
            accountId: payload.accountId || connection.externalAccountId,
            cliProfileName: profileName,
            cliProfileSnapshot: profileSnapshot,
            scope: payload.scope || connection.scopes.join(' '),
            expiresAt: null,
        },
    });
    return result;
}
async function refreshGoogleAccessToken(config, refreshToken) {
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
    const res = await externalFetch(config, 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    }, { networkPolicy: 'proxy' });
    const data = await res.json();
    if (!res.ok)
        throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`);
    return data;
}
async function gmailSearch(config, accessToken, input) {
    const params = new URLSearchParams();
    params.set('maxResults', String(input.maxResults));
    if (input.query)
        params.set('q', input.query);
    if (input.includeSpamTrash)
        params.set('includeSpamTrash', 'true');
    const list = await gmailFetch(config, accessToken, `messages?${params.toString()}`);
    const ids = (list.messages || []).slice(0, input.maxResults);
    const messages = [];
    for (const item of ids) {
        const params = new URLSearchParams({ format: 'metadata' });
        for (const header of ['Subject', 'From', 'To', 'Cc', 'Date'])
            params.append('metadataHeaders', header);
        const message = await gmailFetch(config, accessToken, `messages/${encodeURIComponent(item.id)}?${params.toString()}`);
        messages.push(metadataMessageDigest(message));
    }
    return messages;
}
async function gmailFetch(config, accessToken, path) {
    const res = await externalFetch(config, `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    }, { networkPolicy: 'proxy' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
        throw new Error(`Gmail API failed: ${JSON.stringify(data).slice(0, 1000)}`);
    return data;
}
function resolveFeishuTimeWindow(args) {
    const endTime = toFeishuSeconds(args.endTime, Date.now());
    const startTime = toFeishuSeconds(args.startTime, Date.now() - 24 * 60 * 60 * 1000);
    return { startTime, endTime };
}
function resolveFeishuIsoTimeWindow(args, options = {}) {
    const now = new Date();
    const defaultStart = options.defaultToday
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        : Date.now() - 24 * 60 * 60 * 1000;
    const defaultEnd = options.defaultToday
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, -1).getTime()
        : Date.now();
    return {
        startIso: toIsoTime(args.startTime, defaultStart),
        endIso: toIsoTime(args.endTime, defaultEnd),
    };
}
function toFeishuSeconds(value, fallbackMs) {
    const fallback = Math.floor(fallbackMs / 1000);
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(Math.floor(value > 10_000_000_000 ? value / 1000 : value));
    }
    if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) {
            const number = Number(trimmed);
            if (Number.isFinite(number))
                return String(Math.floor(number > 10_000_000_000 ? number / 1000 : number));
        }
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed))
            return String(Math.floor(parsed / 1000));
    }
    return String(fallback);
}
function toIsoTime(value, fallbackMs) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
    }
    if (typeof value === 'string' && value.trim()) {
        const trimmed = value.trim();
        if (/^\d+$/.test(trimmed)) {
            const number = Number(trimmed);
            if (Number.isFinite(number))
                return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
        }
        const parsed = Date.parse(trimmed);
        if (Number.isFinite(parsed))
            return new Date(parsed).toISOString();
    }
    return new Date(fallbackMs).toISOString();
}
function unixSecondsToIso(value) {
    const number = Number(value);
    if (!Number.isFinite(number))
        return new Date().toISOString();
    return new Date(number * 1000).toISOString();
}
function optionalCliArg(flag, value) {
    return value ? [flag, value] : [];
}
function optionalNumericCliArg(flag, value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return [];
    return [flag, String(Math.round(value))];
}
function truncateCliArg(value, maxChars) {
    return Array.from(value).slice(0, maxChars).join('');
}
function normalizeFeishuCliSortOrder(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'asc' || normalized === 'bycreatetimeasc')
        return 'asc';
    return 'desc';
}
function normalizeFeishuChatType(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'p2p' || normalized === 'group')
        return normalized;
    return '';
}
function normalizeFeishuDocSearchSort(value) {
    const normalized = value.trim().toLowerCase();
    if (['default', 'edit_time', 'edit_time_asc', 'open_time', 'create_time'].includes(normalized))
        return normalized;
    return '';
}
function normalizeFeishuDocFormat(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'xml' || normalized === 'markdown' || normalized === 'im-markdown')
        return normalized;
    return 'markdown';
}
function normalizeFeishuDocDetail(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'simple' || normalized === 'with-ids' || normalized === 'full')
        return normalized;
    return 'simple';
}
function normalizeFeishuDocFetchScope(value) {
    const normalized = value.trim().toLowerCase();
    if (['full', 'outline', 'range', 'keyword', 'section'].includes(normalized))
        return normalized;
    return '';
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
        connectionType: connection.connectionType,
        accountEmail: connection.externalAccountId,
        displayName: connection.displayName,
        scopes: connection.scopes,
        featurePackages: connection.provider === 'feishu'
            ? (Object.prototype.hasOwnProperty.call(connection.metadata || {}, 'feature_packages')
                ? normalizeFeishuCliFeaturePackages(connection.metadata.feature_packages, [])
                : connection.connectionType === 'lark_cli_user'
                    ? DEFAULT_FEISHU_CLI_FEATURE_PACKAGES
                    : [])
            : undefined,
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
    if (Array.isArray(result.messages))
        return { messageCount: result.messages.length };
    if (Array.isArray(result.chats))
        return { chatCount: result.chats.length };
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
