import { NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { prisma } from '@/lib/prisma';

type ConnectorType = 'app' | 'data_source';

type PersonalAccount = {
  connectionId?: unknown;
  provider?: unknown;
  accountEmail?: unknown;
  displayName?: unknown;
  status?: unknown;
  updatedAt?: unknown;
};

const PERSONAL_CONNECTORS = [
  {
    key: 'gmail',
    type: 'app' as ConnectorType,
    label: 'Gmail',
    description: '搜索邮件、读取邮件正文和线程上下文。',
    connectHref: '/api/investor/personal-data/gmail/connect',
  },
  {
    key: 'feishu',
    type: 'app' as ConnectorType,
    label: '飞书',
    description: '读取消息、联系人、日历和云文档。',
    connectHref: '/api/investor/personal-data/feishu/connect',
  },
  {
    key: 'meta',
    type: 'app' as ConnectorType,
    label: 'Instagram / Facebook',
    description: '读取 Meta 账号、Instagram 媒体和 Facebook Page 内容。',
    connectHref: '/api/investor/personal-data/meta/connect',
  },
] as const;

const COMPETITIVE_CONNECTORS = [
  {
    key: 'similarweb_api1',
    label: 'Similarweb API1',
    description: '访问量、趋势、国家、设备、渠道、关键词和竞品发现信号。',
    dbProvider: 'SIMILARWEB_API1',
  },
  {
    key: 'semrush13',
    label: 'Semrush13',
    description: '域名流量、增长、搜索、渠道、关键词、竞品和外链摘要。',
    dbProvider: 'SEMRUSH13',
  },
  {
    key: 'semrush8',
    label: 'Semrush8',
    description: '轻量 SEO rank、关键词、流量估计、流量价值和 URL traffic。',
    dbProvider: 'SEMRUSH8',
  },
  {
    key: 'domain_metrics_check',
    label: 'Domain Metrics Check',
    description: 'DA/PA、Spam Score、Trust Flow、DR、外链和引用域代理指标。',
    dbProvider: 'DOMAIN_METRICS_CHECK',
  },
] as const;

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalizeAccount(account: PersonalAccount) {
  return {
    connectionId: readString(account.connectionId),
    provider: readString(account.provider),
    accountEmail: readString(account.accountEmail),
    displayName: readString(account.displayName),
    status: readString(account.status),
    updatedAt: readString(account.updatedAt),
  };
}

export async function GET() {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const warnings: string[] = [];
  let personalAccounts: ReturnType<typeof normalizeAccount>[] = [];
  try {
    const query = new URLSearchParams({ investorId: investor.id });
    if (investor.email) query.set('userId', investor.email);
    const data = await personalAgentInternalFetch<{ accounts?: PersonalAccount[] }>(
      `/internal/personal-data/accounts?${query.toString()}`,
      {},
      { attempts: 1, timeoutMs: 5000 }
    );
    personalAccounts = Array.isArray(data.accounts) ? data.accounts.map(normalizeAccount) : [];
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : 'personal-agent-server unavailable');
  }

  const integrations = await prisma.investorIntegration.findMany({
    where: {
      investorId: investor.id,
      provider: {
        in: COMPETITIVE_CONNECTORS.map((connector) => connector.dbProvider),
      },
    },
    select: {
      provider: true,
      status: true,
      updatedAt: true,
    },
  });
  const integrationMap = new Map(integrations.map((integration) => [integration.provider, integration]));
  const rapidApiConfigured = Boolean(process.env.RAPIDAPI_KEY?.trim());

  const personal = PERSONAL_CONNECTORS.map((connector) => {
    const accounts = personalAccounts.filter((account) => account.provider === connector.key && account.status === 'connected');
    return {
      key: connector.key,
      type: connector.type,
      label: connector.label,
      description: connector.description,
      connected: accounts.length > 0,
      enabledByDefault: accounts.length > 0,
      connectionIds: accounts.map((account) => account.connectionId).filter(Boolean),
      accounts,
      connectHref: connector.connectHref,
      manageHref: '/investor/info-ops',
    };
  });

  const competitive = COMPETITIVE_CONNECTORS.map((connector) => {
    const integration = integrationMap.get(connector.dbProvider);
    const connected = integration?.status === 'CONNECTED';
    return {
      key: connector.key,
      type: 'data_source' as ConnectorType,
      label: connector.label,
      description: connector.description,
      connected,
      enabledByDefault: connected,
      connectionIds: [],
      accounts: [],
      platformConfigured: rapidApiConfigured,
      updatedAt: integration?.updatedAt.toISOString() || null,
      manageHref: '/investor/info-ops?assistant=semrush',
    };
  });

  return NextResponse.json({
    connectors: [...personal, ...competitive],
    warnings,
  });
}
