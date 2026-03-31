import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export type IntegrationProvider = 'gmail' | 'feishu';
export type IntegrationProviderDb = 'GMAIL' | 'FEISHU';

type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

type GmailHeader = { name: string; value: string };
type GmailPartBody = { size?: number; data?: string; attachmentId?: string };
type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailPartBody;
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

type GmailMessageDigest = {
  id: string;
  threadId: string | null;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  bodyText: string;
  attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    hasAttachmentId: boolean;
  }>;
  status: {
    unread: boolean;
    starred: boolean;
    important: boolean;
    inbox: boolean;
    sent: boolean;
    draft: boolean;
    trash: boolean;
    spam: boolean;
    categories: string[];
    labels: string[];
  };
  sizeEstimate: number;
  receivedAt: string | null;
};

export type GmailRealtimeMessage = GmailMessageDigest;

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

export function providerToDb(provider: IntegrationProvider): IntegrationProviderDb {
  return provider === 'gmail' ? 'GMAIL' : 'FEISHU';
}

export function parseProvider(input: string): IntegrationProvider | null {
  if (input === 'gmail' || input === 'feishu') {
    return input;
  }
  return null;
}

export function getOAuthRedirectUri(provider: IntegrationProvider, origin: string): string {
  const envName = provider === 'gmail' ? 'GOOGLE_REDIRECT_URI' : 'FEISHU_REDIRECT_URI';
  return process.env[envName] || `${origin}/api/investor/integrations/callback/${provider}`;
}

export function buildGoogleAuthUrl(origin: string, state: string): string {
  const redirectUri = getOAuthRedirectUri('gmail', origin);
  const clientId = getEnv('GOOGLE_CLIENT_ID');
  const scope = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ].join(' ');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildFeishuAuthUrl(origin: string, state: string): string {
  const redirectUri = getOAuthRedirectUri('feishu', origin);
  const appId = getEnv('FEISHU_APP_ID');
  const params = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    state,
  });
  return `https://accounts.feishu.cn/open-apis/authen/v1/authorize?${params.toString()}`;
}

export async function exchangeGoogleCode(origin: string, code: string) {
  const redirectUri = getOAuthRedirectUri('gmail', origin);
  const body = new URLSearchParams({
    client_id: getEnv('GOOGLE_CLIENT_ID'),
    client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${JSON.stringify(data)}`);
  }

  return data as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope: string;
    token_type: string;
    id_token?: string;
  };
}

export async function refreshGoogleAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    client_id: getEnv('GOOGLE_CLIENT_ID'),
    client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${JSON.stringify(data)}`);
  }
  return data as {
    access_token: string;
    expires_in: number;
    scope?: string;
    token_type: string;
    id_token?: string;
  };
}

export async function exchangeFeishuCode(origin: string, code: string) {
  const redirectUri = getOAuthRedirectUri('feishu', origin);
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: getEnv('FEISHU_APP_ID'),
      client_secret: getEnv('FEISHU_APP_SECRET'),
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0) {
    throw new Error(`Feishu token exchange failed: ${JSON.stringify(data)}`);
  }

  return data.data as {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  };
}

export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail profile failed: ${JSON.stringify(data)}`);
  }
  return data;
}

async function gmailFetch<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gmail API failed (${path}): ${JSON.stringify(data)}`);
  }
  return data as T;
}

async function gmailFetchText(accessToken: string, path: string, init?: RequestInit): Promise<string> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail API failed (${path}): ${text}`);
  }
  return text;
}

function headerValue(headers: GmailHeader[] | undefined, key: string) {
  return headers?.find((h) => h.name.toLowerCase() === key.toLowerCase())?.value || '';
}

function decodeBase64Url(input?: string): string {
  if (!input) return '';
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 ? '='.repeat(4 - (normalized.length % 4)) : '';
  return Buffer.from(normalized + padding, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectParts(part: GmailPart | undefined, bucket: GmailPart[] = []) {
  if (!part) return bucket;
  bucket.push(part);
  for (const child of part.parts || []) {
    collectParts(child, bucket);
  }
  return bucket;
}

function extractBodyText(payload: GmailPart | undefined): string {
  const parts = collectParts(payload);
  const textPlain = parts
    .filter((p) => p.mimeType === 'text/plain')
    .map((p) => decodeBase64Url(p.body?.data))
    .join('\n')
    .trim();

  if (textPlain) return textPlain;

  const textHtml = parts
    .filter((p) => p.mimeType === 'text/html')
    .map((p) => stripHtml(decodeBase64Url(p.body?.data)))
    .join('\n')
    .trim();

  if (textHtml) return textHtml;

  return decodeBase64Url(payload?.body?.data);
}

function extractAttachments(payload: GmailPart | undefined) {
  const parts = collectParts(payload);
  return parts
    .filter((p) => Boolean(p.filename))
    .map((p) => ({
      filename: p.filename || 'unnamed',
      mimeType: p.mimeType || 'application/octet-stream',
      size: p.body?.size || 0,
      hasAttachmentId: Boolean(p.body?.attachmentId),
    }));
}

function digestGmailMessage(message: GmailMessageFull): GmailMessageDigest {
  const headers = message.payload?.headers || [];
  const labels = message.labelIds || [];
  const categories = labels
    .filter((l) => l.startsWith('CATEGORY_'))
    .map((l) => l.replace('CATEGORY_', '').toLowerCase());

  return {
    id: message.id,
    threadId: message.threadId || null,
    subject: headerValue(headers, 'Subject') || '无主题',
    from: headerValue(headers, 'From') || '未知发件人',
    to: headerValue(headers, 'To') || '未知收件人',
    date: headerValue(headers, 'Date') || '',
    snippet: (message.snippet || '').trim(),
    bodyText: extractBodyText(message.payload),
    attachments: extractAttachments(message.payload),
    status: {
      unread: labels.includes('UNREAD'),
      starred: labels.includes('STARRED'),
      important: labels.includes('IMPORTANT'),
      inbox: labels.includes('INBOX'),
      sent: labels.includes('SENT'),
      draft: labels.includes('DRAFT'),
      trash: labels.includes('TRASH'),
      spam: labels.includes('SPAM'),
      categories,
      labels,
    },
    sizeEstimate: message.sizeEstimate || 0,
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
  };
}

export async function searchGmailMessages(
  accessToken: string,
  options?: {
    query?: string;
    maxResults?: number;
    includeSpamTrash?: boolean;
  }
) {
  const maxResults = Math.max(1, Math.min(options?.maxResults ?? 10, 20));
  const params = new URLSearchParams({
    maxResults: String(maxResults),
    includeSpamTrash: options?.includeSpamTrash ? 'true' : 'false',
  });
  if (options?.query?.trim()) {
    params.set('q', options.query.trim());
  }

  const list = await gmailFetch<{ messages?: Array<{ id: string }> }>(
    accessToken,
    `messages?${params.toString()}`
  );
  const ids = (list.messages || []).map((m) => m.id);
  if (ids.length === 0) return [] as GmailRealtimeMessage[];

  const details = await Promise.all(
    ids.map((id) => gmailFetch<GmailMessageFull>(accessToken, `messages/${id}?format=full`))
  );
  return details.map(digestGmailMessage);
}

export async function getGmailMessageById(accessToken: string, messageId: string) {
  const cleanId = messageId.trim();
  if (!cleanId) {
    throw new Error('messageId is required');
  }
  const full = await gmailFetch<GmailMessageFull>(accessToken, `messages/${cleanId}?format=full`);
  return digestGmailMessage(full);
}

function toBase64Url(input: string) {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeMimeHeader(value: string) {
  const encoded = Buffer.from(value, 'utf-8').toString('base64');
  return `=?UTF-8?B?${encoded}?=`;
}

export async function sendGmailMessage(
  accessToken: string,
  payload: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
  }
) {
  const to = payload.to.trim();
  const subject = payload.subject.trim();
  const body = payload.body.trim();

  if (!to || !subject || !body) {
    throw new Error('to, subject and body are required');
  }

  const lines = [
    `To: ${to}`,
    payload.cc?.trim() ? `Cc: ${payload.cc.trim()}` : null,
    payload.bcc?.trim() ? `Bcc: ${payload.bcc.trim()}` : null,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].filter(Boolean) as string[];

  const raw = toBase64Url(lines.join('\r\n'));
  const responseText = await gmailFetchText(accessToken, 'messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ raw }),
  });

  const sent = JSON.parse(responseText) as { id?: string; threadId?: string; labelIds?: string[] };
  return {
    id: sent.id || '',
    threadId: sent.threadId || null,
    labelIds: sent.labelIds || [],
  };
}

async function fetchAllGmailMessages(accessToken: string) {
  const pageSize = 500;
  const maxMessages = Number(process.env.GMAIL_SYNC_MAX_MESSAGES || 2000);
  const ids: string[] = [];
  let pageToken: string | undefined;
  let hasMore = false;

  do {
    const params = new URLSearchParams({
      maxResults: String(pageSize),
      includeSpamTrash: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const list = await gmailFetch<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      accessToken,
      `messages?${params.toString()}`
    );

    for (const m of list.messages || []) {
      ids.push(m.id);
      if (ids.length >= maxMessages) {
        hasMore = true;
        break;
      }
    }

    if (ids.length >= maxMessages) break;
    pageToken = list.nextPageToken;
  } while (pageToken);

  const concurrency = 5;
  const digests: GmailMessageDigest[] = [];

  for (let i = 0; i < ids.length; i += concurrency) {
    const chunk = ids.slice(i, i + concurrency);
    const details = await Promise.all(
      chunk.map((id) =>
        gmailFetch<GmailMessageFull>(accessToken, `messages/${id}?format=full`)
      )
    );
    for (const d of details) {
      digests.push(digestGmailMessage(d));
    }
  }

  digests.sort((a, b) => (b.receivedAt || '').localeCompare(a.receivedAt || ''));
  return { digests, hasMore, fetchedCount: ids.length, maxMessages };
}

function summarizeGmailDigests(
  profile: GmailProfile,
  digests: GmailMessageDigest[],
  hasMore: boolean,
  maxMessages: number
) {
  const unread = digests.filter((m) => m.status.unread).length;
  const withAttachments = digests.filter((m) => m.attachments.length > 0).length;
  const totalAttachments = digests.reduce((n, m) => n + m.attachments.length, 0);
  const inbox = digests.filter((m) => m.status.inbox).length;
  const sent = digests.filter((m) => m.status.sent).length;
  const important = digests.filter((m) => m.status.important).length;

  const latestLines = digests.slice(0, 8).map((m, idx) => {
    const attach = m.attachments.length > 0 ? ` | 附件 ${m.attachments.length}` : '';
    const status = [
      m.status.unread ? '未读' : null,
      m.status.important ? '重要' : null,
      m.status.starred ? '星标' : null,
    ].filter(Boolean).join('/');
    const statusText = status ? ` | ${status}` : '';
    return `${idx + 1}. ${m.subject}（${m.from}）${statusText}${attach}`;
  });

  const summary = [
    `Gmail 账户 ${profile.emailAddress} 概览：`,
    `已抓取邮件 ${digests.length} 封（全部模式${hasMore ? `，达到上限 ${maxMessages}` : ''}）。`,
    `未读 ${unread}，重要 ${important}，收件箱 ${inbox}，已发送 ${sent}。`,
    `含附件邮件 ${withAttachments} 封，附件总数 ${totalAttachments}。`,
    '最近邮件：',
    ...(latestLines.length > 0 ? latestLines : ['暂无邮件数据。']),
    hasMore
      ? `提示：当前为了稳定性仅同步到 ${maxMessages} 封，可通过环境变量 GMAIL_SYNC_MAX_MESSAGES 提高上限。`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  return summary;
}

export async function buildGmailSummary(accessToken: string) {
  const profile = await fetchGmailProfile(accessToken);
  const { digests, hasMore, maxMessages } = await fetchAllGmailMessages(accessToken);
  const summary = summarizeGmailDigests(profile, digests, hasMore, maxMessages);

  return {
    accountEmail: profile.emailAddress,
    accountName: profile.emailAddress,
    summary,
    raw: {
      profile,
      allMessages: digests,
      hasMore,
      maxMessages,
    },
  };
}

export async function fetchFeishuUserInfo(accessToken: string) {
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0) {
    throw new Error(`Feishu user info failed: ${JSON.stringify(data)}`);
  }
  return data.data as {
    name?: string;
    en_name?: string;
    avatar_url?: string;
    open_id?: string;
    union_id?: string;
    email?: string;
  };
}

export async function buildFeishuSummary(accessToken: string) {
  const info = await fetchFeishuUserInfo(accessToken);

  const summary = [
    `飞书账户 ${info.name || info.en_name || '未命名用户'} 已绑定。`,
    `当前已获取基础身份信息（open_id: ${info.open_id || '未知'}）。`,
    '如需生成飞书邮件摘要，请在飞书应用后台继续开通 Mail 读取权限后再刷新摘要。',
  ].join('\n');

  return {
    accountEmail: info.email || null,
    accountName: info.name || info.en_name || '飞书用户',
    summary,
    raw: info,
  };
}

export async function saveIntegrationSnapshot(params: {
  investorId: string;
  provider: IntegrationProvider;
  accountEmail?: string | null;
  accountName?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
  expiresIn?: number | null;
  summary?: string;
  raw?: unknown;
}) {
  const dbProvider = providerToDb(params.provider);
  const expiresAt =
    params.expiresIn && params.expiresIn > 0 ? new Date(Date.now() + params.expiresIn * 1000) : null;

  const integration = await prisma.investorIntegration.upsert({
    where: {
      investorId_provider: {
        investorId: params.investorId,
        provider: dbProvider,
      },
    },
    update: {
      status: 'CONNECTED',
      accountEmail: params.accountEmail ?? undefined,
      accountName: params.accountName ?? undefined,
      accessToken: params.accessToken ?? undefined,
      refreshToken: params.refreshToken ?? undefined,
      scope: params.scope ?? undefined,
      expiresAt: expiresAt ?? undefined,
      connectedAt: new Date(),
    },
    create: {
      investorId: params.investorId,
      provider: dbProvider,
      status: 'CONNECTED',
      accountEmail: params.accountEmail ?? null,
      accountName: params.accountName ?? null,
      accessToken: params.accessToken ?? null,
      refreshToken: params.refreshToken ?? null,
      scope: params.scope ?? null,
      expiresAt,
    },
  });

  if (params.summary) {
    await prisma.integrationSnapshot.create({
      data: {
        integrationId: integration.id,
        provider: dbProvider,
        summary: params.summary,
        raw:
          params.raw === undefined
            ? undefined
            : params.raw === null
            ? Prisma.JsonNull
            : (params.raw as Prisma.InputJsonValue),
      },
    });
  }

  return integration;
}
