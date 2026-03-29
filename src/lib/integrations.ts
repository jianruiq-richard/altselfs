import { prisma } from '@/lib/prisma';

export type IntegrationProvider = 'gmail' | 'feishu';
export type IntegrationProviderDb = 'GMAIL' | 'FEISHU';

type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

type GmailMessage = {
  id: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
  internalDate?: string;
};

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

async function fetchGmailRecentMessages(accessToken: string) {
  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=8&labelIds=INBOX&q=newer_than:14d',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  );
  const listData = await listRes.json();
  if (!listRes.ok) {
    throw new Error(`Gmail message list failed: ${JSON.stringify(listData)}`);
  }

  const ids: string[] = (listData.messages || []).map((m: { id: string }) => m.id);
  const detailIds = ids.slice(0, 5);
  const details = await Promise.all(
    detailIds.map(async (id) => {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: 'no-store',
        }
      );
      const detailData = await detailRes.json();
      if (!detailRes.ok) {
        throw new Error(`Gmail message detail failed: ${JSON.stringify(detailData)}`);
      }
      return detailData as GmailMessage;
    })
  );

  return details;
}

function headerValue(message: GmailMessage, key: string) {
  return (
    message.payload?.headers?.find((h) => h.name.toLowerCase() === key.toLowerCase())?.value || '未知'
  );
}

export async function buildGmailSummary(accessToken: string) {
  const profile = await fetchGmailProfile(accessToken);
  const details = await fetchGmailRecentMessages(accessToken);

  const lines = details.map((m, idx) => {
    const subject = headerValue(m, 'Subject');
    const from = headerValue(m, 'From');
    const snippet = (m.snippet || '').trim().slice(0, 80);
    return `${idx + 1}. ${subject}（发件人：${from}）${snippet ? ` - ${snippet}` : ''}`;
  });

  const summary = [
    `Gmail 账户 ${profile.emailAddress} 概览：`,
    `总邮件约 ${profile.messagesTotal} 封，线程约 ${profile.threadsTotal} 个。`,
    `近 14 天收件箱最近消息：`,
    ...(lines.length > 0 ? lines : ['暂无近 14 天收件箱消息。']),
  ].join('\n');

  return {
    accountEmail: profile.emailAddress,
    accountName: profile.emailAddress,
    summary,
    raw: {
      profile,
      recentMessages: details,
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
        raw: params.raw as object | null | undefined,
      },
    });
  }

  return integration;
}
