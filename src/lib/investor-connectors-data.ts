import { personalAgentInternalFetch } from '@/lib/personal-agent-internal';
import { prisma } from '@/lib/prisma';
import type { ServerTiming } from '@/lib/server-timing';

type ConnectorType = 'app' | 'data_source';

type InvestorIdentity = {
  id: string;
  email?: string | null;
};

type PersonalAccount = {
  connectionId?: unknown;
  provider?: unknown;
  accountEmail?: unknown;
  displayName?: unknown;
  status?: unknown;
  updatedAt?: unknown;
};

export type ConnectorAccount = {
  connectionId: string;
  provider: string;
  accountEmail: string;
  displayName: string;
  status: string;
  updatedAt: string;
};

export type ConnectorItem = {
  key: string;
  type: ConnectorType;
  label: string;
  description: string;
  connected: boolean;
  enabledByDefault: boolean;
  conversationAvailable?: boolean;
  connectionIds: string[];
  accounts: ConnectorAccount[];
  platformConfigured?: boolean;
  connectHref?: string;
  manageHref?: string;
  updatedAt?: string | null;
};

export type InvestorConnectorsData = {
  connectors: ConnectorItem[];
  warnings: string[];
};

const PERSONAL_CONNECTORS = [
  {
    key: 'gmail',
    type: 'app' as ConnectorType,
    label: 'Gmail',
    description: 'Email, inbox context, threads, and send actions.',
    connectHref: '/api/investor/personal-data/gmail/connect',
  },
  {
    key: 'feishu',
    type: 'app' as ConnectorType,
    label: 'Lark',
    description: 'Messages, contacts, calendar, docs, and meetings.',
    connectHref: '/api/investor/personal-data/feishu/connect',
  },
  {
    key: 'meta',
    type: 'app' as ConnectorType,
    label: 'Instagram / Facebook',
    description: 'Meta accounts, Instagram business assets, and Facebook Pages.',
    connectHref: '/api/investor/personal-data/meta/connect',
  },
] as const;

const COMPETITIVE_CONNECTORS = [
  {
    key: 'similarweb_api1',
    label: 'Similarweb',
    description: 'Website traffic, engagement, rankings, traffic channels, geography, referrals, and similar-site signals.',
    dbProvider: 'SIMILARWEB_API1',
  },
  {
    key: 'semrush13',
    label: 'Semrush',
    description: 'Domain SEO intelligence: traffic estimates, organic and paid keywords, backlinks, competitors, geography, and visibility signals.',
    dbProvider: 'SEMRUSH13',
  },
  {
    key: 'semrush8',
    label: 'Semrush8',
    description: 'SEO rank, keyword, backlink, and URL traffic analysis.',
    dbProvider: 'SEMRUSH8',
  },
  {
    key: 'domain_metrics_check',
    label: 'Domain Metrics Check',
    description: 'Domain authority checks across DA/PA, spam score, Trust Flow, Citation Flow, DR, backlinks, and referring domains.',
    dbProvider: 'DOMAIN_METRICS_CHECK',
  },
] as const;

const ENABLED_CONNECTOR_KEYS = new Set([
  'gmail',
  'feishu',
  'similarweb_api1',
  'semrush13',
  'domain_metrics_check',
]);

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalizeAccount(account: PersonalAccount): ConnectorAccount {
  return {
    connectionId: readString(account.connectionId),
    provider: readString(account.provider),
    accountEmail: readString(account.accountEmail),
    displayName: readString(account.displayName),
    status: readString(account.status),
    updatedAt: readString(account.updatedAt),
  };
}

export async function loadInvestorConnectors(
  investor: InvestorIdentity,
  timing?: ServerTiming,
): Promise<InvestorConnectorsData> {
  const warnings: string[] = [];
  const time = <T>(name: string, operation: () => Promise<T>, description: string) => (
    timing ? timing.time(name, operation, description) : operation()
  );

  const personalAccountsPromise = time(
    'upstream_accounts',
    async () => {
      try {
        const query = new URLSearchParams({ investorId: investor.id });
        if (investor.email) query.set('userId', investor.email);
        const data = await personalAgentInternalFetch<{ accounts?: PersonalAccount[] }>(
          `/internal/personal-data/accounts?${query.toString()}`,
          {},
          { attempts: 1, timeoutMs: 5000 },
        );
        return Array.isArray(data.accounts) ? data.accounts.map(normalizeAccount) : [];
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : 'personal-agent-server unavailable');
        return [] as ConnectorAccount[];
      }
    },
    'personal-agent connected accounts',
  );

  const connectorRowsPromise = time(
    'db_connectors',
    () => Promise.all([
      prisma.investorIntegration.findMany({
        where: {
          investorId: investor.id,
          provider: {
            in: [...COMPETITIVE_CONNECTORS.map((connector) => connector.dbProvider), 'XIAOHONGSHU'],
          },
        },
        select: {
          provider: true,
          status: true,
          accountEmail: true,
          accountName: true,
          updatedAt: true,
        },
      }),
      prisma.investorWechatSource.findMany({
        where: { investorId: investor.id },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, displayName: true, updatedAt: true },
      }),
    ]),
    'Connector integrations and WeChat sources',
  );

  const [personalAccounts, [integrations, wechatSources]] = await Promise.all([
    personalAccountsPromise,
    connectorRowsPromise,
  ]);
  const integrationMap = new Map(integrations.map((integration) => [integration.provider, integration]));
  const rapidApiConfigured = Boolean(process.env.RAPIDAPI_KEY?.trim());

  const personal: ConnectorItem[] = PERSONAL_CONNECTORS.map((connector) => {
    const accounts = personalAccounts.filter((account) => account.provider === connector.key && account.status === 'connected');
    return {
      key: connector.key,
      type: connector.type,
      label: connector.label,
      description: connector.description,
      connected: accounts.length > 0,
      enabledByDefault: accounts.length > 0,
      conversationAvailable: true,
      connectionIds: accounts.map((account) => account.connectionId).filter(Boolean),
      accounts,
      connectHref: connector.connectHref,
      manageHref: '/investor/info-ops',
    };
  });

  const xiaohongshu = integrationMap.get('XIAOHONGSHU');
  const managedSources: ConnectorItem[] = [
    {
      key: 'wechat',
      type: 'app',
      label: 'WeChat',
      description: 'Manage selected Official Account sources and their latest updates.',
      connected: wechatSources.length > 0,
      enabledByDefault: false,
      conversationAvailable: false,
      connectionIds: [],
      accounts: wechatSources.map((source) => ({
        connectionId: source.id,
        provider: 'wechat',
        accountEmail: '',
        displayName: source.displayName,
        status: 'connected',
        updatedAt: source.updatedAt.toISOString(),
      })),
      manageHref: '/investor/info-ops?assistant=wechat',
    },
    {
      key: 'xiaohongshu',
      type: 'app',
      label: 'Xiaohongshu',
      description: 'Manage the connected Xiaohongshu collection workflow and content signals.',
      connected: xiaohongshu?.status === 'CONNECTED',
      enabledByDefault: false,
      conversationAvailable: false,
      connectionIds: [],
      accounts: xiaohongshu?.status === 'CONNECTED'
        ? [{
            connectionId: 'xiaohongshu',
            provider: 'xiaohongshu',
            accountEmail: xiaohongshu.accountEmail || '',
            displayName: xiaohongshu.accountName || 'Xiaohongshu workflow',
            status: 'connected',
            updatedAt: xiaohongshu.updatedAt.toISOString(),
          }]
        : [],
      manageHref: '/investor/info-ops?assistant=xiaohongshu',
    },
  ];

  const competitive: ConnectorItem[] = COMPETITIVE_CONNECTORS.map((connector) => {
    const integration = integrationMap.get(connector.dbProvider);
    const connected = integration?.status === 'CONNECTED';
    return {
      key: connector.key,
      type: 'data_source',
      label: connector.label,
      description: connector.description,
      connected,
      enabledByDefault: false,
      conversationAvailable: true,
      connectionIds: [],
      accounts: [],
      platformConfigured: rapidApiConfigured,
      updatedAt: integration?.updatedAt.toISOString() || null,
      manageHref: '/investor/info-ops?assistant=semrush',
    };
  });

  return {
    connectors: [...personal, ...managedSources, ...competitive].filter((connector) => ENABLED_CONNECTOR_KEYS.has(connector.key)),
    warnings,
  };
}
