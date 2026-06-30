import { prisma } from '@/lib/prisma';

export type OpsStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export type OpsMetric = {
  label: string;
  value: string;
  detail?: string;
  status: OpsStatus;
};

export type ApiAccountSnapshot = {
  provider: string;
  account: string;
  fingerprint: string;
  balance: string;
  usage: string;
  status: OpsStatus;
  updatedAt: string;
  note?: string;
};

export type ResourceSnapshot = {
  provider: string;
  resource: string;
  used: string;
  total: string;
  percent: number | null;
  status: OpsStatus;
  updatedAt: string;
  note?: string;
};

export type UserUsageRow = {
  userId: string;
  email: string;
  role: string;
  messages: number;
  agentMessages: number;
  chats: number;
  agentThreads: number;
  estimatedTokens: number;
  lastActiveAt: string;
};

export type OpsDashboardData = {
  collectedAt: string;
  summary: OpsMetric[];
  apiAccounts: ApiAccountSnapshot[];
  resources: ResourceSnapshot[];
  users: UserUsageRow[];
  alerts: Array<{ severity: OpsStatus; title: string; detail: string }>;
  notes: string[];
};

type SizeRow = { database_size: bigint | number | null };

export async function getOpsDashboardData(): Promise<OpsDashboardData> {
  const collectedAt = new Date().toISOString();
  const [appStats, openRouter, agentSnapshot] = await Promise.all([
    getAppStats(),
    getOpenRouterAccount(),
    getAgentSnapshot(),
  ]);

  const apiAccounts: ApiAccountSnapshot[] = [
    openRouter,
    staticKeyStatus('Clerk', 'CLERK_SECRET_KEY'),
    staticKeyStatus('wxrank', 'WXRANK_API_KEY'),
    staticKeyStatus('dajiala', 'DAJIALA_API_KEY'),
    staticKeyStatus('XHS Spider', 'XHS_SPIDER_SECRET'),
    staticKeyStatus('RapidAPI', 'RAPIDAPI_KEY'),
  ];

  const resources: ResourceSnapshot[] = [
    appStats.databaseResource,
    ...agentSnapshot.resources,
    staticResourceStatus('Supabase', 'Database / Storage', 'SUPABASE_ACCESS_TOKEN'),
    staticResourceStatus('Vercel', 'Usage / Functions / Bandwidth', 'VERCEL_ACCESS_TOKEN'),
    staticResourceStatus('Aliyun', 'ECS / RDS / OSS CloudMonitor', 'ALIYUN_ACCESS_KEY_ID'),
  ];

  const summary: OpsMetric[] = [
    { label: '用户数', value: String(appStats.userCount), detail: `${appStats.investorCount} 投资人 / ${appStats.candidateCount} 候选人`, status: 'ok' },
    { label: '近 7 日消息', value: String(appStats.recentMessageCount), detail: '产品聊天消息，不含 agent context 表', status: 'ok' },
    { label: 'OpenRouter 余额', value: openRouter.balance, detail: openRouter.note || openRouter.usage, status: openRouter.status },
    {
      label: 'Agent 服务',
      value: agentSnapshot.connected ? '已接入' : '未接入',
      detail: agentSnapshot.note,
      status: agentSnapshot.connected ? 'ok' : 'unknown',
    },
  ];

  const alerts = buildAlerts(apiAccounts, resources, appStats.users);

  return {
    collectedAt,
    summary,
    apiAccounts,
    resources,
    users: appStats.users,
    alerts,
    notes: [
      '一期已接入 Clerk 管理权限、主库统计、OpenRouter credits、可选 Agent server 磁盘快照。',
      '用户 token 成本目前用消息字符数估算；下一步需要在每次 LLM/tool 调用后写 ops_usage_events 才能做到精确计费。',
      'Supabase、Vercel、阿里云资源 API 已预留位置；配置对应管理 API 后可替换当前“未接入”状态。',
    ],
  };
}

async function getAppStats() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [userCount, investorCount, candidateCount, recentMessageCount, users, databaseSize] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'INVESTOR' } }),
    prisma.user.count({ where: { role: 'CANDIDATE' } }),
    prisma.message.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    prisma.user.findMany({
      take: 20,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        updatedAt: true,
        _count: {
          select: {
            chatsAsCandidate: true,
            agentThreads: true,
          },
        },
        chatsAsCandidate: {
          select: {
            _count: { select: { messages: true } },
          },
        },
        agentThreads: {
          select: {
            _count: { select: { messages: true } },
          },
        },
      },
    }),
    readDatabaseSize(),
  ]);

  const rows = users
    .map((user) => {
      const messages = user.chatsAsCandidate.reduce((sum, chat) => sum + chat._count.messages, 0);
      const agentMessages = user.agentThreads.reduce((sum, thread) => sum + thread._count.messages, 0);
      const estimatedTokens = Math.round((messages + agentMessages) * 220);
      return {
        userId: user.id,
        email: user.email,
        role: user.role,
        messages,
        agentMessages,
        chats: user._count.chatsAsCandidate,
        agentThreads: user._count.agentThreads,
        estimatedTokens,
        lastActiveAt: user.updatedAt.toISOString(),
      };
    })
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens);

  return {
    userCount,
    investorCount,
    candidateCount,
    recentMessageCount,
    users: rows,
    databaseResource: {
      provider: 'PostgreSQL',
      resource: 'App database',
      used: databaseSize ? formatBytes(databaseSize) : '未知',
      total: '需接入云厂商配额',
      percent: null,
      status: databaseSize ? 'ok' as const : 'unknown' as const,
      updatedAt: new Date().toISOString(),
      note: databaseSize ? '来自 pg_database_size(current_database())' : '当前数据库不支持容量读取或查询失败',
    },
  };
}

async function readDatabaseSize() {
  try {
    const rows = await prisma.$queryRaw<SizeRow[]>`select pg_database_size(current_database()) as database_size`;
    const value = rows[0]?.database_size;
    return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

async function getOpenRouterAccount(): Promise<ApiAccountSnapshot> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return missingAccount('OpenRouter', 'OPENROUTER_API_KEY');

  try {
    const response = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    const raw = await response.json().catch(() => null) as unknown;
    if (!response.ok || !isRecord(raw)) {
      return {
        provider: 'OpenRouter',
        account: 'Platform key',
        fingerprint: fingerprint(apiKey),
        balance: '读取失败',
        usage: `HTTP ${response.status}`,
        status: 'warning',
        updatedAt: new Date().toISOString(),
        note: 'OpenRouter credits API 返回异常',
      };
    }

    const data = isRecord(raw.data) ? raw.data : raw;
    const totalCredits = readNumber(data.total_credits) ?? readNumber(data.totalCredits);
    const totalUsage = readNumber(data.total_usage) ?? readNumber(data.totalUsage);
    const balance = totalCredits !== null && totalUsage !== null ? totalCredits - totalUsage : null;
    return {
      provider: 'OpenRouter',
      account: 'Platform key',
      fingerprint: fingerprint(apiKey),
      balance: balance === null ? '未知' : formatUsd(balance),
      usage: totalUsage === null ? '未知' : `已用 ${formatUsd(totalUsage)}`,
      status: balance === null ? 'unknown' : balance < 5 ? 'critical' : balance < 20 ? 'warning' : 'ok',
      updatedAt: new Date().toISOString(),
      note: totalCredits === null ? 'credits API 未返回 total_credits' : `总额度 ${formatUsd(totalCredits)}`,
    };
  } catch (error) {
    return {
      provider: 'OpenRouter',
      account: 'Platform key',
      fingerprint: fingerprint(apiKey),
      balance: '读取失败',
      usage: '未知',
      status: 'warning',
      updatedAt: new Date().toISOString(),
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getAgentSnapshot(): Promise<{ connected: boolean; note: string; resources: ResourceSnapshot[] }> {
  const baseUrl = process.env.OPS_AGENT_BASE_URL?.trim();
  const token = process.env.OPS_AGENT_TOKEN?.trim();
  if (!baseUrl || !token) {
    return { connected: false, note: '配置 OPS_AGENT_BASE_URL 和 OPS_AGENT_TOKEN 后显示 ECS/workspace 磁盘', resources: [] };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/internal/ops/snapshot`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null) as unknown;
    if (!response.ok || !isRecord(data)) {
      return { connected: false, note: `Agent ops 接口 HTTP ${response.status}`, resources: [] };
    }
    const resources = Array.isArray(data.resources)
      ? data.resources
          .filter(isRecord)
          .map((item): ResourceSnapshot => ({
            provider: 'Agent ECS',
            resource: String(item.resource || 'unknown'),
            used: typeof item.usedBytes === 'number' ? formatBytes(item.usedBytes) : '未知',
            total: typeof item.totalBytes === 'number' ? formatBytes(item.totalBytes) : '未知',
            percent: typeof item.percent === 'number' ? item.percent : null,
            status: statusFromPercent(typeof item.percent === 'number' ? item.percent : null),
            updatedAt: typeof data.collectedAt === 'string' ? data.collectedAt : new Date().toISOString(),
            note: typeof item.note === 'string' ? item.note : undefined,
          }))
      : [];
    return { connected: true, note: '来自 personal-agent-server /internal/ops/snapshot', resources };
  } catch (error) {
    return { connected: false, note: error instanceof Error ? error.message : String(error), resources: [] };
  }
}

function staticKeyStatus(provider: string, envKey: string): ApiAccountSnapshot {
  const value = process.env[envKey]?.trim();
  if (!value) return missingAccount(provider, envKey);
  return {
    provider,
    account: envKey,
    fingerprint: fingerprint(value),
    balance: '未接入余额 API',
    usage: '待埋点统计',
    status: 'unknown',
    updatedAt: new Date().toISOString(),
    note: 'key 已配置，但该供应商的一期余额拉取尚未接入',
  };
}

function staticResourceStatus(provider: string, resource: string, envKey: string): ResourceSnapshot {
  const configured = Boolean(process.env[envKey]?.trim());
  return {
    provider,
    resource,
    used: configured ? '待采集' : '未配置',
    total: configured ? '待采集' : '未配置',
    percent: null,
    status: 'unknown',
    updatedAt: new Date().toISOString(),
    note: configured ? `${envKey} 已配置，待接入管理 API` : `配置 ${envKey} 后接入`,
  };
}

function missingAccount(provider: string, envKey: string): ApiAccountSnapshot {
  return {
    provider,
    account: envKey,
    fingerprint: '未配置',
    balance: '未知',
    usage: '未知',
    status: 'unknown',
    updatedAt: new Date().toISOString(),
    note: `缺少 ${envKey}`,
  };
}

function buildAlerts(apiAccounts: ApiAccountSnapshot[], resources: ResourceSnapshot[], users: UserUsageRow[]) {
  const alerts: Array<{ severity: OpsStatus; title: string; detail: string }> = [];
  for (const account of apiAccounts) {
    if (account.status === 'critical' || account.status === 'warning') {
      alerts.push({ severity: account.status, title: `${account.provider} 需要关注`, detail: `${account.balance} · ${account.note || account.usage}` });
    }
  }
  for (const resource of resources) {
    if (resource.status === 'critical' || resource.status === 'warning') {
      alerts.push({ severity: resource.status, title: `${resource.provider} ${resource.resource} 容量偏高`, detail: `${resource.used} / ${resource.total}` });
    }
  }
  const topUser = users[0];
  if (topUser && topUser.estimatedTokens > 100_000) {
    alerts.push({
      severity: 'warning',
      title: '存在高用量用户',
      detail: `${topUser.email} 估算 ${topUser.estimatedTokens.toLocaleString()} tokens`,
    });
  }
  return alerts;
}

function fingerprint(value: string) {
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function formatUsd(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusFromPercent(percent: number | null): OpsStatus {
  if (percent === null) return 'unknown';
  if (percent >= 90) return 'critical';
  if (percent >= 80) return 'warning';
  return 'ok';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
