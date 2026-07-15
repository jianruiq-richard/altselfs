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
  supabaseDbBytes: number | null;
  supabaseStorageBytes: number | null;
  agentRdsBytes: number | null;
  ecsDiskBytes: number | null;
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
  storageBytes: number | null;
  projectNote: string | null;
  resources: ResourceSnapshot[];
};

type AgentUserResource = {
  userId: string;
  investorId: string;
  ecsDiskBytes: number;
  agentRdsBytes: number;
  agentMessages: number;
  agentArtifacts: number;
  agentRuns: number;
  agentThreads: number;
};

type AgentSnapshot = {
  connected: boolean;
  note: string;
  resources: ResourceSnapshot[];
  userResources: AgentUserResource[];
  apiAccounts: ApiAccountSnapshot[];
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
    ...rapidApiAccountsFromAgent(agentSnapshot),
  ];

  const resources: ResourceSnapshot[] = [
    appDatabaseResource,
    ...mergeEcsDiskResources(agentSnapshot.resources, aliyunResources),
    ...supabaseSnapshot.resources,
    ...vercelResources,
    ...aliyunResources.filter((resource) => resource.metadata?.kind !== 'ecs_disk'),
  ];

  const summary: OpsMetric[] = [
    { label: 'Users', value: String(appStats.userCount), detail: `${appStats.investorCount} investors / ${appStats.candidateCount} candidates`, status: 'ok' },
    { label: 'Messages in last 7 days', value: String(appStats.recentMessageCount), detail: 'Candidate chat and agent context messages', status: 'ok' },
    { label: 'OpenRouter balance', value: openRouter.balance, detail: openRouter.note || openRouter.usage, status: openRouter.status },
    {
      label: 'Agent server',
      value: agentSnapshot.connected ? 'Connected' : 'Unknown',
      detail: agentSnapshot.note,
      status: agentSnapshot.connected ? 'ok' : 'unknown',
    },
  ];

  const users = mergeUserResources(appStats.users, agentSnapshot.userResources, supabaseSnapshot);
  const alerts = buildAlerts(apiAccounts, resources, users);

  return {
    collectedAt,
    summary,
    apiAccounts,
    resources,
    users,
    alerts,
    notes: [
      'Clerk user counts, database usage, OpenRouter credits, and Agent server usage are combined in this view.',
      'Token counts are estimates. For precise LLM and tool cost tracking, add rows to ops_usage_events.',
      'Supabase, Vercel, and Aliyun API data depends on available API tokens and configured limit environment variables.',
    ],
  };
}

async function getAppStats() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const databaseDescriptor = describeDatabaseUrl();
  const [userCount, investorCount, candidateCount, recentMessageCount, users, databaseSize, appUserDbBytes] = await Promise.all([
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
    readAppUserDbBytes(),
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
        supabaseDbBytes: appUserDbBytes.get(user.id) || 0,
        supabaseStorageBytes: null,
        agentRdsBytes: null,
        ecsDiskBytes: null,
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
      resource: databaseDescriptor.resource,
      used: databaseSize ? formatBytes(databaseSize) : 'Unknown',
      total: 'Unknown',
      percent: null,
      status: databaseSize ? 'ok' as const : 'unknown' as const,
      updatedAt: new Date().toISOString(),
      note: databaseSize ? `Measured with pg_database_size(current_database()) · ${databaseDescriptor.host}` : 'Database size check failed',
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

async function readAppUserDbBytes() {
  const rows = await prisma.$queryRaw<Array<{ user_id: string; bytes: bigint | number | null }>>`
    with usage_rows as (
      select
        u.id as user_id,
        octet_length(coalesce(u.email, ''))
          + octet_length(coalesce(u.name, ''))
          + octet_length(coalesce(u.nickname, '')) as bytes
      from users u

      union all

      select
        c."candidateId" as user_id,
        octet_length(m.content) as bytes
      from messages m
      join chats c on c.id = m."chatId"

      union all

      select
        a."investorId" as user_id,
        octet_length(coalesce(a.name, ''))
          + octet_length(coalesce(a.description, ''))
          + octet_length(coalesce(a."systemPrompt", '')) as bytes
      from avatars a

      union all

      select
        t."investorId" as user_id,
        octet_length(am.content) + coalesce(octet_length(am.meta::text), 0) as bytes
      from agent_messages am
      join agent_threads t on t.id = am."threadId"

      union all

      select
        t."investorId" as user_id,
        coalesce(octet_length(tc."toolArgs"::text), 0)
          + coalesce(octet_length(tc."toolResult"::text), 0) as bytes
      from agent_tool_calls tc
      join agent_threads t on t.id = tc."threadId"

      union all

      select
        i."investorId" as user_id,
        coalesce(octet_length(i."accountEmail"), 0)
          + coalesce(octet_length(i."accountName"), 0)
          + coalesce(octet_length(i."assistantCustomPrompt"), 0) as bytes
      from investor_integrations i
    )
    select user_id, coalesce(sum(bytes), 0) as bytes
    from usage_rows
    group by user_id
  `;
  return new Map(rows.map((row) => [row.user_id, typeof row.bytes === 'bigint' ? Number(row.bytes) : typeof row.bytes === 'number' ? row.bytes : 0]));
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
        balance: 'Check failed',
        usage: `HTTP ${response.status}`,
        status: 'warning',
        updatedAt: new Date().toISOString(),
        note: 'OpenRouter credits API returned an unexpected response',
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
      balance: balance === null ? 'Unknown' : formatUsd(balance),
      usage: totalUsage === null ? 'Unknown' : `Used ${formatUsd(totalUsage)}`,
      status: balance === null ? 'unknown' : balance < 5 ? 'critical' : balance < 20 ? 'warning' : 'ok',
      updatedAt: new Date().toISOString(),
      note: totalCredits === null ? 'Credits API did not return total_credits' : `Total credits ${formatUsd(totalCredits)}`,
    };
  } catch (error) {
    return {
      provider: 'OpenRouter',
      account: 'Platform key',
      fingerprint: fingerprint(apiKey),
      balance: 'Check failed',
      usage: 'Unknown',
      status: 'warning',
      updatedAt: new Date().toISOString(),
      note: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getAgentSnapshot(): Promise<AgentSnapshot> {
  const baseUrl = process.env.OPS_AGENT_BASE_URL?.trim();
  const token = process.env.OPS_AGENT_TOKEN?.trim();
  if (!baseUrl || !token) {
    return { connected: false, note: 'Configure OPS_AGENT_BASE_URL and OPS_AGENT_TOKEN to read ECS/workspace usage.', resources: [], userResources: [], apiAccounts: [] };
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/internal/ops/snapshot`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    const data = await response.json().catch(() => null) as unknown;
    if (!response.ok || !isRecord(data)) {
      return { connected: false, note: `Agent ops endpoint returned HTTP ${response.status}`, resources: [], userResources: [], apiAccounts: [] };
    }
    const resources = Array.isArray(data.resources)
      ? data.resources
          .filter(isRecord)
          .filter((item) => typeof item.usedBytes === 'number' && typeof item.totalBytes === 'number')
          .map((item): ResourceSnapshot => ({
            provider: 'Agent ECS',
            resource: String(item.resource || 'unknown'),
            used: typeof item.usedBytes === 'number' ? formatBytes(item.usedBytes) : 'Unknown',
            total: typeof item.totalBytes === 'number' ? formatBytes(item.totalBytes) : 'Unknown',
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
    const userResources = Array.isArray(data.userResources)
      ? data.userResources.filter(isRecord).map((item): AgentUserResource => ({
          userId: typeof item.userId === 'string' ? item.userId : '',
          investorId: typeof item.investorId === 'string' ? item.investorId : '',
          ecsDiskBytes: readNumber(item.ecsDiskBytes) || 0,
          agentRdsBytes: readNumber(item.agentRdsBytes) || 0,
          agentMessages: readNumber(item.agentMessages) || 0,
          agentArtifacts: readNumber(item.agentArtifacts) || 0,
          agentRuns: readNumber(item.agentRuns) || 0,
          agentThreads: readNumber(item.agentThreads) || 0,
        }))
      : [];
    const apiAccounts = Array.isArray(data.apiAccounts)
      ? data.apiAccounts.filter(isRecord).map((item): ApiAccountSnapshot => ({
          provider: typeof item.provider === 'string' ? item.provider : 'Agent API',
          account: typeof item.account === 'string' ? item.account : 'unknown',
          fingerprint: typeof item.fingerprint === 'string' ? item.fingerprint : 'ECS',
          balance: typeof item.balance === 'string' ? item.balance : 'Unknown',
          usage: typeof item.usage === 'string' ? item.usage : 'Unknown',
          status: isOpsStatus(item.status) ? item.status : 'unknown',
          updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
          note: typeof item.note === 'string' ? item.note : undefined,
        }))
      : [];
    return { connected: true, note: 'Read from personal-agent-server /internal/ops/snapshot', resources, userResources, apiAccounts };
  } catch (error) {
    return { connected: false, note: error instanceof Error ? error.message : String(error), resources: [], userResources: [], apiAccounts: [] };
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
          used: 'Check failed',
          total: `HTTP ${response.status}`,
          percent: null,
          status: 'warning',
          updatedAt: now,
          note: 'Supabase Management API returned an unexpected response',
        });
      }
    } catch (error) {
      resources.push(apiErrorResource('Supabase API', `Project ${projectRef}`, error));
    }
  } else if (token && !projectRef) {
    resources.push({
      provider: 'Supabase API',
      resource: 'Project metadata',
      used: 'Token configured',
      total: 'Missing project ref',
      percent: null,
      status: 'unknown',
      updatedAt: now,
      note: 'Configure SUPABASE_PROJECT_REF to read project metadata.',
    });
  }

  const storageBytes = await readSupabaseStorageBytes();
  if (storageBytes !== null || storageLimit !== null || token) {
    resources.push({
      provider: 'Supabase',
      resource: 'Object Storage / bucket usage',
      used: storageBytes === null ? 'Unknown' : formatBytes(storageBytes),
      total: storageLimit === null ? 'Unknown' : formatBytes(storageLimit),
      percent: storageBytes !== null && storageLimit ? (storageBytes / storageLimit) * 100 : null,
      status: statusFromPercent(storageBytes !== null && storageLimit ? (storageBytes / storageLimit) * 100 : null),
      updatedAt: now,
      note: storageBytes === null
        ? 'Unable to read bucket object sizes from storage.objects.'
        : `Measured from storage.objects metadata.size${storageLimitSource ? ` · Limit source ${storageLimitSource}` : ''}`,
    });
  }

  return {
    databaseLimitBytes,
    databaseLimitSource,
    storageBytes,
    projectNote,
    resources,
  };
}

async function readSupabaseStorageBytes() {
  try {
    const countRows = await prisma.$queryRaw<Array<{ object_count: bigint | number | null }>>`
      select count(*) as object_count
      from storage.objects
    `;
    const objectCountValue = countRows[0]?.object_count;
    const objectCount = typeof objectCountValue === 'bigint'
      ? Number(objectCountValue)
      : typeof objectCountValue === 'number'
        ? objectCountValue
        : null;
    if (objectCount === 0) return 0;

    const rows = await prisma.$queryRaw<Array<{ bytes: bigint | number | null }>>`
      select coalesce(
        sum(
          case
            when raw_size ~ '^[0-9]+$' then raw_size::bigint
            else 0
          end
        ),
        0
      ) as bytes
      from (
        select coalesce(
          metadata->>'size',
          metadata->>'contentLength',
          metadata->>'content_length'
        ) as raw_size
        from storage.objects
      ) objects
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
      supabase.databaseLimitSource ? `Limit source ${supabase.databaseLimitSource}` : null,
    ].filter(Boolean).join(' · '),
  };
}

function mergeUserResources(users: UserUsageRow[], agentResources: AgentUserResource[], supabase: SupabaseSnapshot) {
  const agentByKey = new Map<string, AgentUserResource>();
  for (const item of agentResources) {
    if (item.investorId) agentByKey.set(item.investorId, item);
    if (item.userId) agentByKey.set(item.userId, item);
  }

  return users.map((user) => {
    const agent = agentByKey.get(user.userId) || agentByKey.get(user.email);
    return {
      ...user,
      supabaseStorageBytes: supabase.storageBytes === 0 ? 0 : null,
      agentRdsBytes: agent ? agent.agentRdsBytes : null,
      ecsDiskBytes: agent ? agent.ecsDiskBytes : null,
    };
  });
}

function rapidApiAccountsFromAgent(agentSnapshot: AgentSnapshot) {
  if (agentSnapshot.apiAccounts.length > 0) return agentSnapshot.apiAccounts;
  return [staticKeyStatus('RapidAPI', 'RAPIDAPI_KEY')];
}

function describeDatabaseUrl() {
  const raw = process.env.DATABASE_URL?.trim().replace(/^['"]|['"]$/g, '');
  if (!raw) return { provider: 'PostgreSQL', resource: 'App database', host: 'DATABASE_URL not configured' };
  try {
    const url = new URL(raw);
    const host = url.hostname;
    if (host.includes('supabase.co') || host.includes('supabase.com')) {
      return { provider: 'Supabase', resource: 'Postgres database / App data', host };
    }
    if (host.includes('rds.aliyuncs.com')) {
      return { provider: 'Aliyun RDS', resource: 'Postgres database / App data', host };
    }
    return { provider: 'PostgreSQL', resource: 'App database', host };
  } catch {
    return { provider: 'PostgreSQL', resource: 'App database', host: 'DATABASE_URL parse failed' };
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
      used: 'Token configured',
      total: 'Missing project ID',
      percent: null,
      status: 'unknown',
      updatedAt: new Date().toISOString(),
      note: 'Configure VERCEL_PROJECT_ID. VERCEL_TEAM_ID is required for team projects.',
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
        note: typeof project.updatedAt === 'number' ? `updated ${new Date(project.updatedAt).toISOString()}` : 'Vercel Project API',
      });
    } else {
      resources.push({
        provider: 'Vercel',
        resource: `Project ${target}`,
        used: 'Check failed',
        total: `HTTP ${projectResponse.status}`,
        percent: null,
        status: 'warning',
        updatedAt: now,
        note: 'Check VERCEL_PROJECT_ID, VERCEL_TEAM_ID, and token scope.',
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
      used: latest ? String(latest.state || 'unknown') : 'No deployments',
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
      used: accessKeySecret ? 'AccessKeySecret configured' : 'Missing AccessKeySecret',
      total: regionId ? regionId : 'Missing RegionId',
      percent: null,
      status: 'unknown',
      updatedAt: new Date().toISOString(),
      note: 'Configure ALIYUN_ACCESS_KEY_SECRET and ALIYUN_REGION_ID to read ECS/RDS resources.',
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
      used: 'Not configured',
      total: regionId,
      percent: null,
      status: 'unknown',
      updatedAt: new Date().toISOString(),
      note: 'Configure ALIYUN_ECS_DISK_IDS or ALIYUN_RDS_INSTANCE_ID to read resources.',
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
      note: `Matched Aliyun disk ${diskName} / ${device} / ${size} / ${cloudStatus}`,
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
        note: 'DescribeDisks returned no disks. Check ALIYUN_ECS_DISK_IDS or ALIYUN_ECS_INSTANCE_ID.',
      }];
    }
    return disks.map((disk) => {
      const sizeGiB = readNumber(disk.Size);
      const status = String(disk.Status || 'unknown');
      return {
        provider: 'Aliyun',
        resource: `ECS disk ${String(disk.DiskName || disk.DiskId || 'unknown')}`,
        used: status,
        total: sizeGiB === null ? 'Unknown' : `${sizeGiB} GiB provisioned`,
        percent: null,
        status: status === 'In_use' || status === 'Available' ? 'ok' : 'unknown',
        updatedAt: new Date().toISOString(),
        note: String(disk.Device || disk.Type || 'ECS DescribeDisks'),
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
        used: 'Check failed',
        total: 'Unknown',
        percent: null,
        status: 'warning',
        updatedAt: new Date().toISOString(),
        note: 'DescribeDBInstanceAttribute returned no instance attributes',
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
      total: totalGiB === null ? 'Unknown' : `${totalGiB} GiB provisioned`,
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
    balance: 'API key configured',
    usage: 'Unknown',
    status: 'unknown',
    updatedAt: new Date().toISOString(),
    note: 'Key is configured. Balance or quota is not available from this API.',
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
    used: configured ? 'Configured' : 'Missing',
    total: configured ? 'Not available' : 'Not configured',
    percent: null,
    status: 'unknown',
    updatedAt: new Date().toISOString(),
    note: configured ? `${envKey} is configured, but this API does not expose usage.` : `Configure ${envKey}.`,
  };
}

function missingAccount(provider: string, envKey: string): ApiAccountSnapshot {
  return {
    provider,
    account: envKey,
    fingerprint: 'Missing',
    balance: 'Not configured',
    usage: 'Unknown',
    status: 'unknown',
    updatedAt: new Date().toISOString(),
    note: `Configure ${envKey}.`,
  };
}

function buildAlerts(apiAccounts: ApiAccountSnapshot[], resources: ResourceSnapshot[], users: UserUsageRow[]) {
  const alerts: Array<{ severity: OpsStatus; title: string; detail: string }> = [];
  for (const account of apiAccounts) {
    if (account.status === 'critical' || account.status === 'warning') {
      alerts.push({ severity: account.status, title: `${account.provider} needs attention`, detail: `${account.balance} · ${account.note || account.usage}` });
    }
  }
  for (const resource of resources) {
    if (resource.status === 'critical' || resource.status === 'warning') {
      alerts.push({ severity: resource.status, title: `${resource.provider} ${resource.resource} needs attention`, detail: `${resource.used} / ${resource.total}` });
    }
  }
  const topUser = users[0];
  if (topUser && topUser.estimatedTokens > 100_000) {
    alerts.push({
      severity: 'warning',
      title: 'High estimated token usage',
      detail: `${topUser.email} used about ${topUser.estimatedTokens.toLocaleString()} tokens`,
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
    used: 'Check failed',
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
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown';
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

function isOpsStatus(value: unknown): value is OpsStatus {
  return value === 'ok' || value === 'warning' || value === 'critical' || value === 'unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
