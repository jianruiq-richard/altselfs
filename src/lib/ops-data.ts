import { prisma } from '@/lib/prisma';
import crypto from 'node:crypto';

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
  metadata?: Record<string, string | number | boolean | null>;
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

type SupabaseSnapshot = {
  databaseLimitBytes: number | null;
  databaseLimitSource: string | null;
  projectNote: string | null;
  resources: ResourceSnapshot[];
};

export async function getOpsDashboardData(): Promise<OpsDashboardData> {
  const collectedAt = new Date().toISOString();
  const [appStats, openRouter, agentSnapshot] = await Promise.all([
    getAppStats(),
    getOpenRouterAccount(),
    getAgentSnapshot(),
  ]);
  const [supabaseSnapshot, vercelResources, aliyunResources] = await Promise.all([
    getSupabaseResources(),
    getVercelResources(),
    getAliyunResources(),
  ]);
  const appDatabaseResource = mergeAppDatabaseResource(appStats.databaseResource, supabaseSnapshot);

  const apiAccounts: ApiAccountSnapshot[] = [
    openRouter,
    staticKeyStatus('Clerk', 'CLERK_SECRET_KEY'),
    staticKeyStatus('wxrank', 'WXRANK_API_KEY'),
    staticKeyStatus('dajiala', 'DAJIALA_API_KEY'),
    staticKeyStatus('XHS Spider', 'XHS_SPIDER_SECRET'),
    staticKeyStatus('RapidAPI', 'RAPIDAPI_KEY'),
  ];

  const resources: ResourceSnapshot[] = [
    appDatabaseResource,
    ...mergeEcsDiskResources(agentSnapshot.resources, aliyunResources),
    ...supabaseSnapshot.resources,
    ...vercelResources,
    ...aliyunResources.filter((resource) => resource.metadata?.kind !== 'ecs_disk'),
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
      'Supabase、Vercel、阿里云已接入轻量 API 采集；Supabase 配额优先读 API，读不到时使用 limit env。',
    ],
  };
}

async function getAppStats() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const databaseDescriptor = describeDatabaseUrl();
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
      provider: databaseDescriptor.provider,
      resource: 'App database',
      used: databaseSize ? formatBytes(databaseSize) : '未知',
      total: '需接入云厂商配额',
      percent: null,
      status: databaseSize ? 'ok' as const : 'unknown' as const,
      updatedAt: new Date().toISOString(),
      note: databaseSize ? `来自 pg_database_size(current_database()) · ${databaseDescriptor.host}` : '当前数据库不支持容量读取或查询失败',
      metadata: {
        usedBytes: databaseSize,
      },
    },
    databaseBytes: databaseSize,
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
          .filter((item) => typeof item.usedBytes === 'number' && typeof item.totalBytes === 'number')
          .map((item): ResourceSnapshot => ({
            provider: 'Agent ECS',
            resource: String(item.resource || 'unknown'),
            used: typeof item.usedBytes === 'number' ? formatBytes(item.usedBytes) : '未知',
            total: typeof item.totalBytes === 'number' ? formatBytes(item.totalBytes) : '未知',
            percent: typeof item.percent === 'number' ? item.percent : null,
            status: statusFromPercent(typeof item.percent === 'number' ? item.percent : null),
            updatedAt: typeof data.collectedAt === 'string' ? data.collectedAt : new Date().toISOString(),
            note: typeof item.note === 'string' ? item.note : undefined,
            metadata: {
              kind: 'agent_disk',
              path: typeof item.path === 'string' ? item.path : null,
            },
          }))
      : [];
    return { connected: true, note: '来自 personal-agent-server /internal/ops/snapshot', resources };
  } catch (error) {
    return { connected: false, note: error instanceof Error ? error.message : String(error), resources: [] };
  }
}

async function getSupabaseResources(): Promise<SupabaseSnapshot> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim() || process.env.NEXT_PUBLIC_SUPABASE_PROJECT_REF?.trim();
  const now = new Date().toISOString();
  const resources: ResourceSnapshot[] = [];
  const configuredDbLimit = readBytesEnv('SUPABASE_DB_LIMIT_BYTES');
  const configuredStorageLimit = readBytesEnv('SUPABASE_STORAGE_LIMIT_BYTES');
  let databaseLimitBytes = configuredDbLimit;
  let databaseLimitSource = configuredDbLimit === null ? null : 'SUPABASE_DB_LIMIT_BYTES';
  let projectNote: string | null = null;
  let storageLimit = configuredStorageLimit;
  let storageLimitSource = configuredStorageLimit === null ? null : 'SUPABASE_STORAGE_LIMIT_BYTES';

  if (token && projectRef) {
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const data = await response.json().catch(() => null) as unknown;
      if (response.ok && isRecord(data)) {
        const status = String(data.status || data.state || 'unknown');
        const projectName = typeof data.name === 'string' ? data.name : projectRef;
        const region = typeof data.region === 'string' ? data.region : null;
        projectNote = `${projectName} · ${status}${region ? ` · ${region}` : ''}`;
        const apiDbLimit = readSupabaseLimitBytes(data, ['database_size_limit', 'db_size_limit', 'databaseLimitBytes', 'dbLimitBytes']);
        const apiStorageLimit = readSupabaseLimitBytes(data, ['storage_size_limit', 'storageLimitBytes', 'storageLimit']);
        const inferred = inferSupabasePlanLimits(data);
        if (databaseLimitBytes === null) {
          databaseLimitBytes = apiDbLimit ?? inferred.databaseLimitBytes;
          databaseLimitSource = apiDbLimit === null && inferred.databaseLimitBytes !== null ? inferred.source : apiDbLimit === null ? null : 'Supabase Management API';
        }
        if (storageLimit === null) {
          storageLimit = apiStorageLimit ?? inferred.storageLimitBytes;
          storageLimitSource = apiStorageLimit === null && inferred.storageLimitBytes !== null ? inferred.source : apiStorageLimit === null ? null : 'Supabase Management API';
        }
      } else {
        resources.push({
          provider: 'Supabase API',
          resource: `Project ${projectRef}`,
          used: '读取失败',
          total: `HTTP ${response.status}`,
          percent: null,
          status: 'warning',
          updatedAt: now,
          note: 'Supabase Management API 返回异常',
        });
      }
    } catch (error) {
      resources.push(apiErrorResource('Supabase API', `Project ${projectRef}`, error));
    }
  } else if (token && !projectRef) {
    resources.push({
      provider: 'Supabase API',
      resource: 'Project metadata',
      used: '已配置 token',
      total: '缺项目 ref',
      percent: null,
      status: 'unknown',
      updatedAt: now,
      note: '补充 SUPABASE_PROJECT_REF 后可读取项目和套餐信息',
    });
  }

  const storageBytes = await readSupabaseStorageBytes();
  if (storageBytes !== null || storageLimit !== null || token) {
    resources.push({
      provider: 'Supabase Storage',
      resource: 'Object storage',
      used: storageBytes === null ? '未知' : formatBytes(storageBytes),
      total: storageLimit === null ? '需配置套餐上限' : formatBytes(storageLimit),
      percent: storageBytes !== null && storageLimit ? (storageBytes / storageLimit) * 100 : null,
      status: statusFromPercent(storageBytes !== null && storageLimit ? (storageBytes / storageLimit) * 100 : null),
      updatedAt: now,
      note: storageBytes === null
        ? '未检测到 storage.objects 或权限不足'
        : `来自 storage.objects metadata.size${storageLimitSource ? ` · 上限来自 ${storageLimitSource}` : ''}`,
    });
  }

  return {
    databaseLimitBytes,
    databaseLimitSource,
    projectNote,
    resources,
  };
}

async function readSupabaseStorageBytes() {
  try {
    const rows = await prisma.$queryRaw<Array<{ bytes: bigint | number | null }>>`
      select coalesce(sum((metadata->>'size')::bigint), 0) as bytes
      from storage.objects
      where metadata ? 'size'
    `;
    const value = rows[0]?.bytes;
    return typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}

function mergeAppDatabaseResource(resource: ResourceSnapshot, supabase: SupabaseSnapshot): ResourceSnapshot {
  if (supabase.databaseLimitBytes === null) {
    return {
      ...resource,
      note: [resource.note, supabase.projectNote].filter(Boolean).join(' · '),
    };
  }

  const usedBytes = typeof resource.metadata?.usedBytes === 'number' ? resource.metadata.usedBytes : null;
  const percent = usedBytes === null ? null : (usedBytes / supabase.databaseLimitBytes) * 100;
  return {
    ...resource,
    total: formatBytes(supabase.databaseLimitBytes),
    percent,
    status: statusFromPercent(percent),
    note: [
      resource.note,
      supabase.projectNote,
      supabase.databaseLimitSource ? `上限来自 ${supabase.databaseLimitSource}` : null,
    ].filter(Boolean).join(' · '),
  };
}

function describeDatabaseUrl() {
  const raw = process.env.DATABASE_URL?.trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return { provider: 'PostgreSQL', host: 'DATABASE_URL 未配置' };
  try {
    const url = new URL(raw);
    const host = url.hostname;
    if (host.includes('supabase.co') || host.includes('supabase.com')) {
      return { provider: 'Supabase PostgreSQL', host };
    }
    if (host.includes('rds.aliyuncs.com')) {
      return { provider: 'Aliyun RDS PostgreSQL', host };
    }
    return { provider: 'PostgreSQL', host };
  } catch {
    return { provider: 'PostgreSQL', host: 'DATABASE_URL 解析失败' };
  }
}

function readSupabaseLimitBytes(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const direct = readFlexibleBytes(data[key]);
    if (direct !== null) return direct;
  }
  for (const value of Object.values(data)) {
    if (!isRecord(value)) continue;
    const nested: number | null = readSupabaseLimitBytes(value, keys);
    if (nested !== null) return nested;
  }
  return null;
}

function readFlexibleBytes(value: unknown) {
  const number = readNumber(value);
  if (number === null || number <= 0) return null;
  return number < 10_000 ? number * 1024 * 1024 * 1024 : number;
}

function inferSupabasePlanLimits(data: Record<string, unknown>) {
  const planText = Object.entries(data)
    .filter(([key]) => /plan|tier|subscription|pricing/i.test(key))
    .map(([, value]) => String(value))
    .join(' ')
    .toLowerCase();
  if (!planText.includes('free')) {
    return { databaseLimitBytes: null, storageLimitBytes: null, source: null };
  }
  return {
    databaseLimitBytes: 500 * 1024 * 1024,
    storageLimitBytes: 1024 * 1024 * 1024,
    source: 'Supabase free plan fallback',
  };
}

async function getVercelResources(): Promise<ResourceSnapshot[]> {
  const token = process.env.VERCEL_ACCESS_TOKEN?.trim();
  if (!token) return [staticResourceStatus('Vercel', 'Project / Deployments', 'VERCEL_ACCESS_TOKEN')];

  const oidc = parseVercelOidcPayload(process.env.VERCEL_OIDC_TOKEN);
  const projectId = process.env.VERCEL_PROJECT_ID?.trim() || stringValue(oidc?.project_id) || stringValue(oidc?.project);
  const teamId = process.env.VERCEL_TEAM_ID?.trim() || stringValue(oidc?.owner_id);
  const projectName = process.env.VERCEL_PROJECT_NAME?.trim() || stringValue(oidc?.project);
  const target = projectId || projectName;
  if (!target) {
    return [{
      provider: 'Vercel',
      resource: 'Project',
      used: '已配置 token',
      total: '缺项目 ID',
      percent: null,
      status: 'unknown',
      updatedAt: new Date().toISOString(),
      note: '补充 VERCEL_PROJECT_ID；团队项目再补 VERCEL_TEAM_ID',
    }];
  }

  const now = new Date().toISOString();
  const resources: ResourceSnapshot[] = [];
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
  try {
    const projectResponse = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(target)}${query}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const project = await projectResponse.json().catch(() => null) as unknown;
    if (projectResponse.ok && isRecord(project)) {
      resources.push({
        provider: 'Vercel',
        resource: `Project ${String(project.name || target)}`,
        used: String(project.framework || 'project'),
        total: typeof project.nodeVersion === 'string' ? `Node ${project.nodeVersion}` : 'Project API',
        percent: null,
        status: 'ok',
        updatedAt: now,
        note: typeof project.updatedAt === 'number' ? `updated ${new Date(project.updatedAt).toISOString()}` : '来自 Vercel Project API',
      });
    } else {
      resources.push({
        provider: 'Vercel',
        resource: `Project ${target}`,
        used: '读取失败',
        total: `HTTP ${projectResponse.status}`,
        percent: null,
        status: 'warning',
        updatedAt: now,
        note: '检查 VERCEL_PROJECT_ID / VERCEL_TEAM_ID / token scope',
      });
    }

    const deploymentsQuery = new URLSearchParams({ limit: '10' });
    if (projectId) deploymentsQuery.set('projectId', projectId);
    else deploymentsQuery.set('project', projectName);
    if (teamId) deploymentsQuery.set('teamId', teamId);
    const deploymentsResponse = await fetch(`https://api.vercel.com/v6/deployments?${deploymentsQuery.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const deploymentsData = await deploymentsResponse.json().catch(() => null) as unknown;
    const deployments = isRecord(deploymentsData) && Array.isArray(deploymentsData.deployments) ? deploymentsData.deployments.filter(isRecord) : [];
    const latest = deployments[0];
    resources.push({
      provider: 'Vercel',
      resource: 'Recent deployments',
      used: latest ? String(latest.state || 'unknown') : '无部署',
      total: `${deployments.length} recent`,
      percent: null,
      status: latest && latest.state === 'ERROR' ? 'critical' : deploymentsResponse.ok ? 'ok' : 'warning',
      updatedAt: now,
      note: latest && typeof latest.url === 'string' ? latest.url : `HTTP ${deploymentsResponse.status}`,
    });
  } catch (error) {
    resources.push(apiErrorResource('Vercel', `Project ${target}`, error));
  }
  return resources;
}

async function getAliyunResources(): Promise<ResourceSnapshot[]> {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID?.trim();
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET?.trim();
  const regionId = process.env.ALIYUN_REGION_ID?.trim();
  if (!accessKeyId) return [staticResourceStatus('Aliyun', 'ECS / RDS', 'ALIYUN_ACCESS_KEY_ID')];
  if (!accessKeySecret || !regionId) {
    return [{
      provider: 'Aliyun',
      resource: 'API credentials',
      used: accessKeySecret ? 'AccessKeySecret 已配置' : '缺 AccessKeySecret',
      total: regionId ? regionId : '缺 RegionId',
      percent: null,
      status: 'unknown',
      updatedAt: new Date().toISOString(),
      note: '补充 ALIYUN_ACCESS_KEY_SECRET 和 ALIYUN_REGION_ID 后可查询 ECS/RDS',
    }];
  }

  const resources: ResourceSnapshot[] = [];
  const [ecs, rds] = await Promise.all([
    getAliyunEcsDisks({ accessKeyId, accessKeySecret, regionId }),
    getAliyunRdsInstance({ accessKeyId, accessKeySecret, regionId }),
  ]);
  resources.push(...ecs, ...rds);
  if (resources.length === 0) {
    resources.push({
      provider: 'Aliyun',
      resource: 'ECS / RDS',
      used: '已配置凭证',
      total: regionId,
      percent: null,
      status: 'unknown',
      updatedAt: new Date().toISOString(),
      note: '补充 ALIYUN_ECS_DISK_IDS 或 ALIYUN_RDS_INSTANCE_ID 后可显示指定资源',
    });
  }
  return resources;
}

function mergeEcsDiskResources(agentResources: ResourceSnapshot[], aliyunResources: ResourceSnapshot[]) {
  const ecsDisks = aliyunResources.filter((resource) => resource.metadata?.kind === 'ecs_disk');
  return agentResources.map((agent) => {
    const disk = findMatchingAliyunDisk(agent, ecsDisks);
    if (!disk) return agent;
    const diskName = stringValue(disk.metadata?.diskName) || stringValue(disk.metadata?.diskId) || disk.resource.replace(/^ECS disk\s+/, '');
    const device = stringValue(disk.metadata?.device) || disk.note || '';
    const size = typeof disk.metadata?.sizeGiB === 'number' ? `${disk.metadata.sizeGiB} GiB` : disk.total;
    const cloudStatus = stringValue(disk.metadata?.status) || disk.used;
    return {
      ...agent,
      provider: 'ECS',
      note: `云盘 ${diskName} / ${device} / ${size} / ${cloudStatus}`,
      metadata: {
        ...(agent.metadata || {}),
        aliyunDiskId: stringValue(disk.metadata?.diskId) || null,
        aliyunDiskName: stringValue(disk.metadata?.diskName) || null,
        aliyunDevice: device || null,
      },
    };
  });
}

function findMatchingAliyunDisk(agent: ResourceSnapshot, disks: ResourceSnapshot[]) {
  const resource = agent.resource.toLowerCase();
  if (resource.includes('system disk')) {
    return disks.find((disk) => disk.metadata?.device === '/dev/xvda') || disks.find((disk) => stringValue(disk.metadata?.diskName).toLowerCase().includes('system'));
  }
  if (resource.includes('sandbox storage root')) {
    return (
      disks.find((disk) => disk.metadata?.device === '/dev/xvdb') ||
      disks.find((disk) => stringValue(disk.metadata?.diskName).toLowerCase().includes('workspace')) ||
      disks.find((disk) => stringValue(disk.metadata?.diskName).toLowerCase().includes('data'))
    );
  }
  return null;
}

async function getAliyunEcsDisks(credentials: AliyunCredentials): Promise<ResourceSnapshot[]> {
  const diskIds = readCsvEnv('ALIYUN_ECS_DISK_IDS');
  const instanceId = process.env.ALIYUN_ECS_INSTANCE_ID?.trim();
  const params: Record<string, string> = {};
  if (diskIds.length > 0) params.DiskIds = JSON.stringify(diskIds);
  if (instanceId) params.InstanceId = instanceId;
  if (!params.DiskIds && !params.InstanceId) return [];

  try {
    const data = await aliyunRpc('https://ecs.aliyuncs.com/', '2014-05-26', 'DescribeDisks', credentials, params);
    const disksRaw = readNested(data, ['Disks', 'Disk']);
    const disks = Array.isArray(disksRaw) ? disksRaw.filter(isRecord) : [];
    if (disks.length === 0) {
      return [{
        provider: 'Aliyun',
        resource: 'ECS disks',
        used: '0 disks',
        total: credentials.regionId,
        percent: null,
        status: 'unknown',
        updatedAt: new Date().toISOString(),
        note: 'DescribeDisks 未返回磁盘；检查 ALIYUN_ECS_DISK_IDS / ALIYUN_ECS_INSTANCE_ID',
      }];
    }
    return disks.map((disk) => {
      const sizeGiB = readNumber(disk.Size);
      const status = String(disk.Status || 'unknown');
      return {
        provider: 'Aliyun',
        resource: `ECS disk ${String(disk.DiskName || disk.DiskId || 'unknown')}`,
        used: status,
        total: sizeGiB === null ? '未知' : `${sizeGiB} GiB provisioned`,
        percent: null,
        status: status === 'In_use' || status === 'Available' ? 'ok' : 'unknown',
        updatedAt: new Date().toISOString(),
        note: String(disk.Device || disk.Type || '来自 ECS DescribeDisks'),
        metadata: {
          kind: 'ecs_disk',
          device: typeof disk.Device === 'string' ? disk.Device : null,
          diskId: typeof disk.DiskId === 'string' ? disk.DiskId : null,
          diskName: typeof disk.DiskName === 'string' ? disk.DiskName : null,
          status,
          sizeGiB,
        },
      };
    });
  } catch (error) {
    return [apiErrorResource('Aliyun', 'ECS disks', error)];
  }
}

async function getAliyunRdsInstance(credentials: AliyunCredentials): Promise<ResourceSnapshot[]> {
  const instanceId = process.env.ALIYUN_RDS_INSTANCE_ID?.trim();
  if (!instanceId) return [];

  try {
    const data = await aliyunRpc('https://rds.aliyuncs.com/', '2014-08-15', 'DescribeDBInstanceAttribute', credentials, {
      DBInstanceId: instanceId,
    });
    const attrsRaw = readNested(data, ['Items', 'DBInstanceAttribute']);
    const attrs = Array.isArray(attrsRaw) ? attrsRaw.filter(isRecord) : [];
    const attr = attrs[0];
    if (!attr) {
      return [{
        provider: 'Aliyun',
        resource: `RDS ${instanceId}`,
        used: '读取失败',
        total: '无属性',
        percent: null,
        status: 'warning',
        updatedAt: new Date().toISOString(),
        note: 'DescribeDBInstanceAttribute 未返回实例属性',
      }];
    }
    const totalGiB = readNumber(attr.DBInstanceStorage);
    const usedBytes = readNumber(attr.DBInstanceDiskUsed) ?? readNumber(attr.DiskUsed);
    const totalBytes = totalGiB === null ? null : totalGiB * 1024 * 1024 * 1024;
    const percent = totalBytes && usedBytes !== null ? (usedBytes / totalBytes) * 100 : null;
    return [{
      provider: 'Aliyun',
      resource: `RDS ${String(attr.DBInstanceDescription || instanceId)}`,
      used: usedBytes === null ? String(attr.DBInstanceStatus || 'unknown') : formatBytes(usedBytes),
      total: totalGiB === null ? '未知' : `${totalGiB} GiB provisioned`,
      percent,
      status: percent === null ? (attr.DBInstanceStatus === 'Running' ? 'ok' : 'unknown') : statusFromPercent(percent),
      updatedAt: new Date().toISOString(),
      note: `${String(attr.Engine || 'RDS')} ${String(attr.DBInstanceClass || '')}`.trim(),
    }];
  } catch (error) {
    return [apiErrorResource('Aliyun', `RDS ${instanceId}`, error)];
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

type AliyunCredentials = {
  accessKeyId: string;
  accessKeySecret: string;
  regionId: string;
};

async function aliyunRpc(
  endpoint: string,
  version: string,
  action: string,
  credentials: AliyunCredentials,
  params: Record<string, string>
) {
  const allParams: Record<string, string> = {
    Format: 'JSON',
    Version: version,
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString(),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Action: action,
    RegionId: credentials.regionId,
    ...params,
  };
  const canonicalized = Object.keys(allParams)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(allParams[key])}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  const signature = crypto
    .createHmac('sha1', `${credentials.accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
  const url = `${endpoint}?Signature=${percentEncode(signature)}&${canonicalized}`;
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json().catch(() => null) as unknown;
  if (!response.ok || !isRecord(data) || data.Code || data.ErrorCode) {
    const message = isRecord(data) ? String(data.Message || data.Code || data.ErrorCode || `HTTP ${response.status}`) : `HTTP ${response.status}`;
    throw new Error(`${action} failed: ${message}`);
  }
  return data;
}

function percentEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
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

function readBytesEnv(key: string) {
  const raw = process.env[key]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readCsvEnv(key: string) {
  return (process.env[key] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseVercelOidcPayload(token?: string) {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readNested(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function apiErrorResource(provider: string, resource: string, error: unknown): ResourceSnapshot {
  return {
    provider,
    resource,
    used: '读取失败',
    total: 'API error',
    percent: null,
    status: 'warning',
    updatedAt: new Date().toISOString(),
    note: error instanceof Error ? error.message : String(error),
  };
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
