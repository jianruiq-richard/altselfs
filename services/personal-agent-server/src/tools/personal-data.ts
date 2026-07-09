import type { ServerConfig } from '../config.js';
import { decryptCredentialPayload, isCredentialVaultConfigured } from '../credential-vault.js';
import { externalFetch } from '../outbound-fetch.js';
import {
  listPersonalConnections,
  loadPersonalCredential,
  recordPersonalToolCallAudit,
  updatePersonalCredentialPayload,
  type FeishuCredentialPayload,
  type GmailCredentialPayload,
  type PersonalConnection,
} from '../personal-data-store.js';
import { isRecord, truncate } from '../util.js';

type PersonalToolContext = {
  userId: string;
  investorId: string;
  threadId?: string;
  runId?: string;
};

const PERSONAL_TOOL_NAMES = new Set([
  'altselfs_connected_accounts_list',
  'altselfs_gmail_search_messages',
  'altselfs_gmail_get_message',
  'altselfs_gmail_get_thread',
  'altselfs_feishu_list_chats',
  'altselfs_feishu_list_messages',
  'altselfs_feishu_recent_messages',
]);

export function isPersonalDataTool(toolName: string) {
  return PERSONAL_TOOL_NAMES.has(toolName);
}

export async function createPersonalDataDynamicTools(config: ServerConfig, input: {
  investorId?: string;
}) {
  const investorId = input.investorId?.trim();
  if (!investorId || !isCredentialVaultConfigured()) return [];
  let gmailConnections: PersonalConnection[] = [];
  let feishuConnections: PersonalConnection[] = [];
  try {
    gmailConnections = await listPersonalConnections(config, { investorId, provider: 'gmail' });
    feishuConnections = await listPersonalConnections(config, { investorId, provider: 'feishu' });
  } catch {
    return [];
  }
  const tools: unknown[] = [
    {
      namespace: null,
      name: 'altselfs_connected_accounts_list',
      description:
        'List the user-connected personal data accounts available to this turn, such as Gmail and Feishu accounts. Use before private-channel research when you need to know what the user has authorized.',
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
    tools.push(
      {
        namespace: null,
        name: 'altselfs_gmail_search_messages',
        description:
          'Search the user-authorized Gmail account(s). Best for recent email, inbox triage, todos, follow-ups, sender/subject queries, and date-window scans. Returns compact message metadata and snippets; call get_message for full body only when needed.',
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
      },
      {
        namespace: null,
        name: 'altselfs_gmail_get_message',
        description:
          'Read one full Gmail message from a user-authorized account. Use only after search finds a relevant message or the user provides a message id.',
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
      },
      {
        namespace: null,
        name: 'altselfs_gmail_get_thread',
        description:
          'Read a Gmail thread from a user-authorized account. Use when thread context is needed for follow-up decisions or summaries.',
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
      }
    );
  }
  if (feishuConnections.length > 0) {
    tools.push(
      {
        namespace: null,
        name: 'altselfs_feishu_list_chats',
        description:
          'List Feishu/Lark IM chats visible through the user-authorized account and app scopes. Use before reading Feishu messages when a chat id is needed. This covers IM chats only, not Feishu Mail, Calendar, Docs, or Drive.',
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
      },
      {
        namespace: null,
        name: 'altselfs_feishu_list_messages',
        description:
          'Read messages from one Feishu/Lark IM chat or thread that the user/app can access. Requires containerId (chat_id or thread_id). This does not read Feishu Mail, Calendar, Docs, or Drive.',
        inputSchema: {
          type: 'object',
          properties: {
            containerId: { type: 'string', description: 'Feishu chat_id or thread_id.' },
            containerIdType: { type: 'string', description: 'chat or thread. Default chat.' },
            startTime: { type: 'string', description: 'Optional start time as Unix seconds, milliseconds, or ISO string. Default 24 hours ago.' },
            endTime: { type: 'string', description: 'Optional end time as Unix seconds, milliseconds, or ISO string. Default now.' },
            sortType: { type: 'string', description: 'ByCreateTimeDesc or ByCreateTimeAsc. Default ByCreateTimeDesc.' },
            pageSize: { type: 'number', description: 'Max messages to return, default 20, capped at 50.' },
            pageToken: { type: 'string', description: 'Optional Feishu pagination token.' },
            accountId: { type: 'string', description: 'Altselfs connection id. Required when multiple Feishu accounts are connected.' },
            accountEmail: { type: 'string', description: 'Feishu account external id/email/open id. Alternative to accountId.' },
          },
          required: ['containerId'],
          additionalProperties: false,
        },
        deferLoading: false,
      },
      {
        namespace: null,
        name: 'altselfs_feishu_recent_messages',
        description:
          'Best-effort scan of recent Feishu/Lark IM messages across visible chats for a connected account. Use for questions like today\'s Feishu messages, team updates, and pending follow-ups. Access may be partial when app scopes, chat settings, or bot membership limit a chat.',
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
      }
    );
  }
  return tools;
}

export async function runPersonalDataTool(
  toolName: string,
  argumentsValue: unknown,
  config: ServerConfig,
  context: PersonalToolContext
) {
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
    return JSON.stringify({ source: 'personal-data-tools', error: `Unsupported personal data tool: ${toolName}` }, null, 2);
  } catch (error) {
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

async function connectedAccountsList(config: ServerConfig, context: PersonalToolContext, args: Record<string, unknown>) {
  const provider = typeof args.provider === 'string' && args.provider.trim() ? args.provider.trim().toLowerCase() : undefined;
  const connections = await listPersonalConnections(config, { investorId: context.investorId, provider });
  return {
    source: 'personal-data-connections',
    fetchedAt: new Date().toISOString(),
    accounts: connections.map(publicConnection),
  };
}

async function gmailSearchMessages(config: ServerConfig, context: PersonalToolContext, args: Record<string, unknown>) {
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

async function gmailGetMessage(config: ServerConfig, context: PersonalToolContext, args: Record<string, unknown>) {
  const messageId = typeof args.messageId === 'string' ? args.messageId.trim() : '';
  if (!messageId) throw new Error('messageId is required.');
  const [connection] = await resolveGmailConnections(config, context, args, { allowAll: false });
  const token = await getFreshGmailAccessToken(config, context, connection);
  const message = await gmailFetch<GmailMessageFull>(config, token, `messages/${encodeURIComponent(messageId)}?format=full`);
  return {
    source: 'gmail',
    fetchedAt: new Date().toISOString(),
    account: publicConnection(connection),
    message: fullMessageDigest(message),
  };
}

async function gmailGetThread(config: ServerConfig, context: PersonalToolContext, args: Record<string, unknown>) {
  const threadId = typeof args.threadId === 'string' ? args.threadId.trim() : '';
  if (!threadId) throw new Error('threadId is required.');
  const maxMessages = clampNumber(args.maxMessages, 10, 1, 20);
  const [connection] = await resolveGmailConnections(config, context, args, { allowAll: false });
  const token = await getFreshGmailAccessToken(config, context, connection);
  const thread = await gmailFetch<GmailThreadFull>(config, token, `threads/${encodeURIComponent(threadId)}?format=full`);
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

async function feishuListChats(config: ServerConfig, context: PersonalToolContext, args: Record<string, unknown>) {
  const pageSize = clampNumber(args.pageSize, 20, 1, 50);
  const connections = await resolveFeishuConnections(config, context, args, { allowAll: true, maxAll: 3 });
  const accounts = [];
  for (const connection of connections) {
    const token = await getFreshFeishuAccessToken(config, context, connection);
    const result = await feishuFetch<FeishuChatList>(config, token, 'im/v1/chats', {
      page_size: String(pageSize),
      page_token: readArgString(args.pageToken),
    });
    accounts.push({
      account: publicConnection(connection),
      chats: (result.items || []).map(chatDigest),
      hasMore: Boolean(result.has_more),
      nextPageToken: result.page_token || null,
    });
  }
  return {
    source: 'feishu',
    resource: 'im_chats',
    fetchedAt: new Date().toISOString(),
    accounts,
    limitations: [
      'Only Feishu/Lark IM chats visible to the authorized user and app scopes are returned.',
      'Feishu Mail, Calendar, Docs, Wiki, and Drive require separate APIs and scopes.',
    ],
  };
}

async function feishuListMessages(config: ServerConfig, context: PersonalToolContext, args: Record<string, unknown>) {
  const containerId = readArgString(args.containerId) || readArgString(args.chatId) || readArgString(args.threadId);
  if (!containerId) throw new Error('containerId is required.');
  const containerIdType = normalizeFeishuContainerType(readArgString(args.containerIdType) || (readArgString(args.threadId) ? 'thread' : 'chat'));
  const pageSize = clampNumber(args.pageSize, 20, 1, 50);
  const [connection] = await resolveFeishuConnections(config, context, args, { allowAll: false, maxAll: 1 });
  const token = await getFreshFeishuAccessToken(config, context, connection);
  const timeWindow = resolveFeishuTimeWindow(args);
  const result = await feishuFetch<FeishuMessageList>(config, token, 'im/v1/messages', {
    container_id_type: containerIdType,
    container_id: containerId,
    start_time: timeWindow.startTime,
    end_time: timeWindow.endTime,
    sort_type: normalizeFeishuSortType(readArgString(args.sortType)),
    page_size: String(pageSize),
    page_token: readArgString(args.pageToken),
  });
  return {
    source: 'feishu',
    resource: 'im_messages',
    fetchedAt: new Date().toISOString(),
    account: publicConnection(connection),
    container: { id: containerId, type: containerIdType },
    timeWindow,
    messages: (result.items || []).map(messageDigest),
    hasMore: Boolean(result.has_more),
    nextPageToken: result.page_token || null,
    limitations: [
      'This reads Feishu/Lark IM messages only.',
      'A chat may be unavailable if app scopes, tenant availability, chat settings, or bot membership do not allow access.',
    ],
  };
}

async function feishuRecentMessages(config: ServerConfig, context: PersonalToolContext, args: Record<string, unknown>) {
  const chatLimit = clampNumber(args.chatLimit, 10, 1, 30);
  const maxMessagesPerChat = clampNumber(args.maxMessagesPerChat, 10, 1, 30);
  const connections = await resolveFeishuConnections(config, context, args, { allowAll: true, maxAll: 3 });
  const timeWindow = resolveFeishuTimeWindow(args);
  const accounts = [];
  for (const connection of connections) {
    const token = await getFreshFeishuAccessToken(config, context, connection);
    const chatResult = await feishuFetch<FeishuChatList>(config, token, 'im/v1/chats', {
      page_size: String(chatLimit),
    });
    const chats = (chatResult.items || []).slice(0, chatLimit);
    const scanned = [];
    const errors = [];
    for (const chat of chats) {
      if (!chat.chat_id) continue;
      try {
        const messages = await feishuFetch<FeishuMessageList>(config, token, 'im/v1/messages', {
          container_id_type: 'chat',
          container_id: chat.chat_id,
          start_time: timeWindow.startTime,
          end_time: timeWindow.endTime,
          sort_type: 'ByCreateTimeDesc',
          page_size: String(maxMessagesPerChat),
        });
        scanned.push({
          chat: chatDigest(chat),
          messages: (messages.items || []).map(messageDigest),
          hasMore: Boolean(messages.has_more),
          nextPageToken: messages.page_token || null,
        });
      } catch (error) {
        errors.push({
          chat: chatDigest(chat),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    accounts.push({
      account: publicConnection(connection),
      timeWindow,
      scannedChatCount: scanned.length,
      unavailableChatCount: errors.length,
      chats: scanned,
      errors,
    });
  }
  return {
    source: 'feishu',
    resource: 'recent_im_messages',
    fetchedAt: new Date().toISOString(),
    accounts,
    limitations: [
      'Best-effort scan over the first visible chats returned by Feishu; it may not cover every chat the user can see in the native client.',
      'Feishu Mail, Calendar, Docs, Wiki, and Drive are not included in this IM message scan.',
    ],
  };
}

async function resolveGmailConnections(
  config: ServerConfig,
  context: PersonalToolContext,
  args: Record<string, unknown>,
  options: { allowAll: boolean }
) {
  const connections = await listPersonalConnections(config, { investorId: context.investorId, provider: 'gmail' });
  if (connections.length === 0) throw new Error('No connected Gmail account is available for this user.');
  const accountId = readArgString(args.accountId) || readArgString(args.connectionId);
  const accountEmail = (readArgString(args.accountEmail) || readArgString(args.email) || readArgString(args.account)).toLowerCase();
  if (accountId) {
    const matched = connections.find((item) => item.id === accountId);
    if (!matched) throw new Error(`Gmail account not found for accountId=${accountId}.`);
    return [matched];
  }
  if (accountEmail && accountEmail !== 'all') {
    const matched = connections.find((item) => item.externalAccountId.toLowerCase() === accountEmail);
    if (!matched) throw new Error(`Gmail account not found for accountEmail=${accountEmail}.`);
    return [matched];
  }
  if (options.allowAll) return connections.slice(0, 5);
  if (connections.length === 1) return connections;
  throw new Error('Multiple Gmail accounts are connected. Provide accountId or accountEmail.');
}

async function getFreshGmailAccessToken(config: ServerConfig, context: PersonalToolContext, connection: PersonalConnection) {
  const credential = await loadPersonalCredential(config, { investorId: context.investorId, connectionId: connection.id });
  if (!credential) throw new Error(`Credential not found for Gmail account ${connection.externalAccountId}.`);
  const payload = decryptCredentialPayload<GmailCredentialPayload>({
    keyProvider: credential.keyProvider,
    encryptedPayload: credential.encryptedPayload,
    encryptedDataKey: credential.encryptedDataKey,
  });
  const expiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : 0;
  if (payload.accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) return payload.accessToken;
  if (!payload.refreshToken) throw new Error(`Gmail account ${connection.externalAccountId} needs reconnect: no refresh token is available.`);
  const refreshed = await refreshGoogleAccessToken(config, payload.refreshToken);
  const nextPayload: GmailCredentialPayload = {
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

async function resolveFeishuConnections(
  config: ServerConfig,
  context: PersonalToolContext,
  args: Record<string, unknown>,
  options: { allowAll: boolean; maxAll: number }
) {
  const connections = await listPersonalConnections(config, { investorId: context.investorId, provider: 'feishu' });
  if (connections.length === 0) throw new Error('No connected Feishu account is available for this user.');
  const accountId = readArgString(args.accountId) || readArgString(args.connectionId);
  const accountEmail = (readArgString(args.accountEmail) || readArgString(args.email) || readArgString(args.account)).toLowerCase();
  if (accountId) {
    const matched = connections.find((item) => item.id === accountId);
    if (!matched) throw new Error(`Feishu account not found for accountId=${accountId}.`);
    return [matched];
  }
  if (accountEmail && accountEmail !== 'all') {
    const matched = connections.find((item) =>
      item.externalAccountId.toLowerCase() === accountEmail ||
      item.displayName.toLowerCase() === accountEmail
    );
    if (!matched) throw new Error(`Feishu account not found for accountEmail=${accountEmail}.`);
    return [matched];
  }
  if (options.allowAll) return connections.slice(0, options.maxAll);
  if (connections.length === 1) return connections;
  throw new Error('Multiple Feishu accounts are connected. Provide accountId or accountEmail.');
}

async function getFreshFeishuAccessToken(config: ServerConfig, context: PersonalToolContext, connection: PersonalConnection) {
  const credential = await loadPersonalCredential(config, { investorId: context.investorId, connectionId: connection.id });
  if (!credential) throw new Error(`Credential not found for Feishu account ${connection.displayName}.`);
  const payload = decryptCredentialPayload<FeishuCredentialPayload>({
    keyProvider: credential.keyProvider,
    encryptedPayload: credential.encryptedPayload,
    encryptedDataKey: credential.encryptedDataKey,
  });
  const expiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : 0;
  if (payload.accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) return payload.accessToken;
  if (!payload.refreshToken) throw new Error(`Feishu account ${connection.displayName} needs reconnect: no refresh token is available.`);
  const refreshed = await refreshFeishuAccessToken(config, payload.refreshToken);
  const nextPayload: FeishuCredentialPayload = {
    ...payload,
    accessToken: refreshed.access_token,
    tokenType: refreshed.token_type || payload.tokenType,
    scope: refreshed.scope || payload.scope,
    expiresAt: refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null,
    refreshToken: refreshed.refresh_token || payload.refreshToken,
  };
  await updatePersonalCredentialPayload(config, {
    investorId: context.investorId,
    connectionId: connection.id,
    payload: nextPayload,
  });
  return nextPayload.accessToken;
}

async function refreshFeishuAccessToken(config: ServerConfig, refreshToken: string) {
  const clientId = process.env.FEISHU_APP_ID?.trim();
  const clientSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be configured on personal-agent-server.');
  const res = await externalFetch(config, 'https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json().catch(() => ({})) as FeishuApiResponse<Record<string, unknown>> & Record<string, unknown>;
  if (!res.ok || (typeof data.code === 'number' && data.code !== 0)) throw new Error(`Feishu token refresh failed: ${JSON.stringify(data).slice(0, 1000)}`);
  return normalizeFeishuOAuthToken(data, 'refresh');
}

async function refreshGoogleAccessToken(config: ServerConfig, refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured on personal-agent-server.');
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
  if (!res.ok) throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`);
  return data as { access_token: string; expires_in?: number; scope?: string; token_type?: string };
}

async function gmailSearch(config: ServerConfig, accessToken: string, input: { query: string; maxResults: number; includeSpamTrash: boolean }) {
  const params = new URLSearchParams();
  params.set('maxResults', String(input.maxResults));
  if (input.query) params.set('q', input.query);
  if (input.includeSpamTrash) params.set('includeSpamTrash', 'true');
  const list = await gmailFetch<GmailMessageList>(config, accessToken, `messages?${params.toString()}`);
  const ids = (list.messages || []).slice(0, input.maxResults);
  const messages = [];
  for (const item of ids) {
    const params = new URLSearchParams({ format: 'metadata' });
    for (const header of ['Subject', 'From', 'To', 'Cc', 'Date']) params.append('metadataHeaders', header);
    const message = await gmailFetch<GmailMessageFull>(config, accessToken, `messages/${encodeURIComponent(item.id)}?${params.toString()}`);
    messages.push(metadataMessageDigest(message));
  }
  return messages;
}

async function gmailFetch<T>(config: ServerConfig, accessToken: string, path: string): Promise<T> {
  const res = await externalFetch(config, `https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, { networkPolicy: 'proxy' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail API failed: ${JSON.stringify(data).slice(0, 1000)}`);
  return data as T;
}

async function feishuFetch<T>(config: ServerConfig, accessToken: string, path: string, params?: Record<string, string>) {
  const url = new URL(`https://open.feishu.cn/open-apis/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value) url.searchParams.set(key, value);
  }
  const res = await externalFetch(config, url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({})) as FeishuApiResponse<T>;
  if (!res.ok || data.code !== 0) {
    throw new Error(`Feishu API failed (${path}): ${JSON.stringify(data).slice(0, 1000)}`);
  }
  return (data.data || {}) as T;
}

function chatDigest(chat: FeishuChat) {
  return {
    chatId: chat.chat_id || '',
    name: chat.name || '',
    description: chat.description || '',
    chatType: chat.chat_type || '',
    chatMode: chat.chat_mode || '',
    chatStatus: chat.chat_status || '',
    chatTag: chat.chat_tag || '',
    ownerId: chat.owner_id || '',
    external: typeof chat.external === 'boolean' ? chat.external : null,
  };
}

function messageDigest(message: FeishuMessage) {
  const parsedContent = parseFeishuContent(message.body?.content);
  return {
    messageId: message.message_id || '',
    rootId: message.root_id || null,
    parentId: message.parent_id || null,
    threadId: message.thread_id || null,
    chatId: message.chat_id || null,
    messageType: message.msg_type || '',
    sender: message.sender || null,
    createTime: normalizeFeishuApiTime(message.create_time),
    updateTime: normalizeFeishuApiTime(message.update_time),
    deleted: Boolean(message.deleted),
    updated: Boolean(message.updated),
    mentions: message.mentions || [],
    contentText: truncate(extractFeishuContentText(parsedContent), 5000),
    content: parsedContent,
  };
}

function parseFeishuContent(raw?: string) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function extractFeishuContentText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(extractFeishuContentText).filter(Boolean).join(' ');
  if (typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const priority = ['text', 'title', 'content', 'href', 'name'];
  const parts = [];
  for (const key of priority) {
    if (record[key] !== undefined) parts.push(extractFeishuContentText(record[key]));
  }
  if (parts.some(Boolean)) return parts.filter(Boolean).join(' ');
  return Object.values(record).map(extractFeishuContentText).filter(Boolean).join(' ');
}

function resolveFeishuTimeWindow(args: Record<string, unknown>) {
  const endTime = toFeishuSeconds(args.endTime, Date.now());
  const startTime = toFeishuSeconds(args.startTime, Date.now() - 24 * 60 * 60 * 1000);
  return { startTime, endTime };
}

function toFeishuSeconds(value: unknown, fallbackMs: number) {
  const fallback = Math.floor(fallbackMs / 1000);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.floor(value > 10_000_000_000 ? value / 1000 : value));
  }
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      const number = Number(trimmed);
      if (Number.isFinite(number)) return String(Math.floor(number > 10_000_000_000 ? number / 1000 : number));
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) return String(Math.floor(parsed / 1000));
  }
  return String(fallback);
}

function normalizeFeishuApiTime(value?: string) {
  if (!value) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
}

function normalizeFeishuContainerType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'thread') return 'thread';
  return 'chat';
}

function normalizeFeishuSortType(value: string) {
  return value === 'ByCreateTimeAsc' ? 'ByCreateTimeAsc' : 'ByCreateTimeDesc';
}

function normalizeFeishuOAuthToken(raw: FeishuApiResponse<Record<string, unknown>> & Record<string, unknown>, operation: string) {
  const body = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
    ? raw.data as Record<string, unknown>
    : raw;
  const accessToken = readRecordString(body, 'access_token') || readRecordString(body, 'user_access_token');
  if (!accessToken) {
    throw new Error(`Feishu token ${operation} returned no access token. responseKeys=${Object.keys(raw).join(',')}; dataKeys=${Object.keys(body).join(',')}`);
  }
  return {
    access_token: accessToken,
    refresh_token: readRecordString(body, 'refresh_token') || undefined,
    expires_in: readRecordNumber(body, 'expires_in') || readRecordNumber(body, 'expire') || undefined,
    scope: readRecordString(body, 'scope') || undefined,
    token_type: readRecordString(body, 'token_type') || undefined,
  };
}

function readRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readRecordNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function metadataMessageDigest(message: GmailMessageFull) {
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

function fullMessageDigest(message: GmailMessageFull) {
  return {
    ...metadataMessageDigest(message),
    bodyText: truncate(extractBodyText(message.payload), 8000),
    attachments: collectAttachments(message.payload),
    sizeEstimate: message.sizeEstimate || 0,
  };
}

function headersMap(headers: GmailHeader[]) {
  const map: Record<string, string> = {};
  for (const header of headers) map[header.name.toLowerCase()] = header.value;
  return map;
}

function extractBodyText(part?: GmailPart): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeGmailBody(part.body.data);
  const nested = (part.parts || []).map(extractBodyText).filter(Boolean).join('\n\n');
  if (nested) return nested;
  if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(decodeGmailBody(part.body.data));
  return '';
}

function collectAttachments(part?: GmailPart): Array<{ filename: string; mimeType: string; size: number; hasAttachmentId: boolean }> {
  if (!part) return [];
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

function decodeGmailBody(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function stripHtml(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function publicConnection(connection: PersonalConnection) {
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

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function readArgString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function redactArgs(args: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(args).filter(([key]) => !/token|secret|authorization/i.test(key)));
}

function summarizeResult(result: unknown) {
  if (!isRecord(result)) return null;
  if (Array.isArray(result.accounts)) {
    return { accountCount: result.accounts.length };
  }
  if (isRecord(result.message)) return { messageId: result.message.id, threadId: result.message.threadId };
  if (isRecord(result.thread)) return { threadId: result.thread.id, messageCount: Array.isArray(result.thread.messages) ? result.thread.messages.length : 0 };
  if (Array.isArray(result.messages)) return { messageCount: result.messages.length };
  if (Array.isArray(result.chats)) return { chatCount: result.chats.length };
  return null;
}

async function audit(
  config: ServerConfig,
  context: PersonalToolContext,
  toolName: string,
  args: unknown,
  result: unknown,
  status: string,
  provider?: string,
  connectionId?: string,
  error?: string
) {
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

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};
type GmailMessageFull = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPart;
  sizeEstimate?: number;
  internalDate?: string;
};
type GmailThreadFull = {
  id: string;
  historyId?: string;
  messages?: GmailMessageFull[];
};
type GmailMessageList = {
  messages?: Array<{ id: string; threadId?: string }>;
};

type FeishuApiResponse<T> = {
  code?: number;
  msg?: string;
  data?: T;
};
type FeishuChat = {
  chat_id?: string;
  name?: string;
  description?: string;
  chat_type?: string;
  chat_mode?: string;
  chat_status?: string;
  chat_tag?: string;
  owner_id?: string;
  external?: boolean;
};
type FeishuChatList = {
  items?: FeishuChat[];
  has_more?: boolean;
  page_token?: string;
};
type FeishuMessage = {
  message_id?: string;
  root_id?: string;
  parent_id?: string;
  thread_id?: string;
  chat_id?: string;
  msg_type?: string;
  create_time?: string;
  update_time?: string;
  deleted?: boolean;
  updated?: boolean;
  sender?: Record<string, unknown>;
  body?: { content?: string };
  mentions?: unknown[];
};
type FeishuMessageList = {
  items?: FeishuMessage[];
  has_more?: boolean;
  page_token?: string;
};
