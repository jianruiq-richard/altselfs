import type { ServerConfig } from './config.js';
import { decryptCredentialPayload, encryptCredentialPayload } from './credential-vault.js';
import { normalizeFeishuCliFeaturePackages, type FeishuCliFeaturePackage, type LarkCliProfileSnapshot } from './feishu-cli.js';
import { id } from './util.js';

type PgPool = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

let sharedPool: PgPool | null = null;
let sharedUrl = '';
let schemaReady: Promise<void> | null = null;

export type PersonalConnection = {
  id: string;
  capabilityId: string;
  investorId: string;
  userId: string;
  provider: string;
  connectionType: string;
  externalAccountId: string;
  displayName: string;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type GmailCredentialPayload = {
  provider: 'gmail';
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string | null;
  accountEmail: string;
};

export type FeishuCredentialPayload = {
  provider: 'feishu';
  authMode?: 'oauth_user' | 'lark_cli_user';
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string | null;
  accountId: string;
  cliProfileName?: string;
  cliProfileSnapshot?: LarkCliProfileSnapshot;
  featurePackages?: FeishuCliFeaturePackage[] | string[];
  openId?: string;
  unionId?: string;
  tenantKey?: string;
};

export type MetaInstagramAsset = {
  id: string;
  username?: string;
  name?: string;
  profilePictureUrl?: string;
  pageId?: string;
  pageName?: string;
};

export type MetaPageAsset = {
  id: string;
  name?: string;
  category?: string;
  accessToken?: string;
  tasks?: string[];
  instagramAccount?: MetaInstagramAsset;
};

export type MetaCredentialPayload = {
  provider: 'meta';
  accessToken: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string | null;
  accountId: string;
  accountEmail?: string;
  profile?: Record<string, unknown>;
  pages: MetaPageAsset[];
  instagramAccounts: MetaInstagramAsset[];
};

export type PersonalCredentialPayload = GmailCredentialPayload | FeishuCredentialPayload | MetaCredentialPayload;

export type PersonalCredentialRecord = {
  id: string;
  connectionId: string;
  encryptedPayload: string;
  encryptedDataKey: string;
  keyProvider: string;
  keyVersion: string;
  expiresAt: string | null;
};

export function isPersonalDataStoreConfigured(config: ServerConfig) {
  return Boolean((config.contextDatabaseUrl || config.databaseUrl || '').trim());
}

export async function listPersonalConnections(config: ServerConfig, input: {
  investorId: string;
  userId?: string;
  provider?: string;
  includeDisabled?: boolean;
}) {
  const pool = await getPersonalDataPool(config);
  const values: unknown[] = [input.investorId];
  const userId = input.userId?.trim();
  const where = userId && userId !== input.investorId
    ? [`(investor_id = $1 or user_id = $${values.push(userId)})`]
    : ['investor_id = $1'];
  if (input.provider) {
    values.push(input.provider);
    where.push(`provider = $${values.length}`);
  }
  if (!input.includeDisabled) where.push("status = 'connected'");
  const result = await pool.query(
    [
      'select id, capability_id, investor_id, user_id, provider, connection_type, external_account_id,',
      'display_name, scopes, status, expires_at, metadata, updated_at',
      'from personal_external_connections',
      `where ${where.join(' and ')}`,
      'order by case when investor_id = $1 then 0 else 1 end, provider asc, updated_at desc',
    ].join(' '),
    values
  );
  return result.rows.map(rowToConnection);
}

export async function upsertGmailOAuthConnection(config: ServerConfig, input: {
  investorId: string;
  userId: string;
  accountEmail: string;
  accountName?: string;
  token: {
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresIn?: number | null;
  };
  profile?: Record<string, unknown>;
}) {
  const pool = await getPersonalDataPool(config);
  const capabilityId = await upsertCapability(pool, {
    investorId: input.investorId,
    userId: input.userId,
    capabilityKey: 'gmail',
    capabilityType: 'oauth_account',
    displayName: 'Gmail',
  });
  const accountEmail = input.accountEmail.trim().toLowerCase();
  const expiresAt = input.token.expiresIn && input.token.expiresIn > 0
    ? new Date(Date.now() + input.token.expiresIn * 1000).toISOString()
    : null;

  const existing = await pool.query(
    [
      'select c.id, cr.encrypted_payload, cr.encrypted_data_key, cr.key_provider',
      'from personal_external_connections c',
      'left join personal_credentials cr on cr.connection_id = c.id and cr.status = $4',
      'where c.investor_id = $1 and c.provider = $2 and c.external_account_id = $3',
      'limit 1',
    ].join(' '),
    [input.investorId, 'gmail', accountEmail, 'active']
  );
  const connectionId = existing.rows[0]?.id ? String(existing.rows[0].id) : id('conn');
  let refreshToken = input.token.refreshToken;
  if (!refreshToken && existing.rows[0]?.encrypted_payload && existing.rows[0]?.encrypted_data_key && existing.rows[0]?.key_provider) {
    const current = decryptCredentialPayload<GmailCredentialPayload>({
      keyProvider: String(existing.rows[0].key_provider),
      encryptedPayload: String(existing.rows[0].encrypted_payload),
      encryptedDataKey: String(existing.rows[0].encrypted_data_key),
    });
    refreshToken = current.refreshToken;
  }
  const encrypted = encryptCredentialPayload({
    provider: 'gmail',
    accessToken: input.token.accessToken,
    refreshToken,
    tokenType: input.token.tokenType,
    scope: input.token.scope,
    expiresAt,
    accountEmail,
  } satisfies GmailCredentialPayload);

  await pool.query(
    [
      'insert into personal_external_connections',
      '(id, capability_id, investor_id, user_id, provider, connection_type, external_account_id, display_name, scopes, status, expires_at, metadata, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::jsonb, now(), now())',
      'on conflict (investor_id, provider, external_account_id) do update set',
      'capability_id = excluded.capability_id, user_id = excluded.user_id, display_name = excluded.display_name, scopes = excluded.scopes,',
      "status = 'connected', expires_at = excluded.expires_at, metadata = excluded.metadata, updated_at = now()",
    ].join(' '),
    [
      connectionId,
      capabilityId,
      input.investorId,
      input.userId,
      'gmail',
      'oauth_user',
      accountEmail,
      input.accountName || accountEmail,
      parseScopes(input.token.scope),
      'connected',
      expiresAt,
      JSON.stringify(input.profile || {}),
    ]
  );

  await pool.query(
    [
      'insert into personal_credentials',
      '(id, connection_id, investor_id, user_id, credential_type, encrypted_payload, encrypted_data_key, key_provider, key_version, expires_at, status, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, now(), now())',
      'on conflict (connection_id) do update set',
      'investor_id = excluded.investor_id, user_id = excluded.user_id, credential_type = excluded.credential_type,',
      'encrypted_payload = excluded.encrypted_payload, encrypted_data_key = excluded.encrypted_data_key,',
      'key_provider = excluded.key_provider, key_version = excluded.key_version, expires_at = excluded.expires_at,',
      "status = 'active', updated_at = now()",
    ].join(' '),
    [
      id('cred'),
      connectionId,
      input.investorId,
      input.userId,
      'oauth_token',
      encrypted.encryptedPayload,
      encrypted.encryptedDataKey,
      encrypted.keyProvider,
      encrypted.keyVersion,
      expiresAt,
      'active',
    ]
  );

  const connections = await listPersonalConnections(config, { investorId: input.investorId, provider: 'gmail' });
  return connections.find((connection) => connection.id === connectionId) || null;
}

export async function upsertMetaOAuthConnection(config: ServerConfig, input: {
  investorId: string;
  userId: string;
  accountId: string;
  accountName?: string;
  accountEmail?: string;
  token: {
    accessToken: string;
    tokenType?: string;
    scope?: string;
    expiresIn?: number | null;
  };
  profile?: Record<string, unknown>;
  pages?: unknown[];
  instagramAccounts?: unknown[];
}) {
  const pool = await getPersonalDataPool(config);
  const capabilityId = await upsertCapability(pool, {
    investorId: input.investorId,
    userId: input.userId,
    capabilityKey: 'meta',
    capabilityType: 'oauth_account',
    displayName: 'Instagram / Facebook',
  });
  const accountId = input.accountId.trim();
  if (!accountId) throw new Error('Meta accountId is required.');
  const accountEmail = input.accountEmail?.trim().toLowerCase() || undefined;
  const expiresAt = input.token.expiresIn && input.token.expiresIn > 0
    ? new Date(Date.now() + input.token.expiresIn * 1000).toISOString()
    : null;
  const pages = normalizeMetaPages(input.pages || []);
  const instagramAccounts = normalizeMetaInstagramAccounts(input.instagramAccounts || [], pages);
  const metadata = {
    profile: sanitizeRecord(input.profile || {}),
    account_email: accountEmail || null,
    page_count: pages.length,
    instagram_account_count: instagramAccounts.length,
    pages: pages.map((page) => sanitizeMetaPage(page)),
    instagram_accounts: instagramAccounts.map((account) => sanitizeMetaInstagramAccount(account)),
  };

  const existing = await pool.query(
    [
      'select id',
      'from personal_external_connections',
      'where investor_id = $1 and provider = $2 and external_account_id = $3',
      'limit 1',
    ].join(' '),
    [input.investorId, 'meta', accountId]
  );
  const connectionId = existing.rows[0]?.id ? String(existing.rows[0].id) : id('conn');
  const encrypted = encryptCredentialPayload({
    provider: 'meta',
    accessToken: input.token.accessToken,
    tokenType: input.token.tokenType,
    scope: input.token.scope,
    expiresAt,
    accountId,
    accountEmail,
    profile: input.profile || {},
    pages,
    instagramAccounts,
  } satisfies MetaCredentialPayload);

  await pool.query(
    [
      'insert into personal_external_connections',
      '(id, capability_id, investor_id, user_id, provider, connection_type, external_account_id, display_name, scopes, status, expires_at, metadata, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::jsonb, now(), now())',
      'on conflict (investor_id, provider, external_account_id) do update set',
      'capability_id = excluded.capability_id, user_id = excluded.user_id, display_name = excluded.display_name, scopes = excluded.scopes,',
      "status = 'connected', expires_at = excluded.expires_at, metadata = excluded.metadata, updated_at = now()",
    ].join(' '),
    [
      connectionId,
      capabilityId,
      input.investorId,
      input.userId,
      'meta',
      'facebook_login',
      accountId,
      input.accountName || accountEmail || accountId,
      parseScopes(input.token.scope),
      'connected',
      expiresAt,
      JSON.stringify(metadata),
    ]
  );

  await pool.query(
    [
      'insert into personal_credentials',
      '(id, connection_id, investor_id, user_id, credential_type, encrypted_payload, encrypted_data_key, key_provider, key_version, expires_at, status, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, now(), now())',
      'on conflict (connection_id) do update set',
      'investor_id = excluded.investor_id, user_id = excluded.user_id, credential_type = excluded.credential_type,',
      'encrypted_payload = excluded.encrypted_payload, encrypted_data_key = excluded.encrypted_data_key,',
      'key_provider = excluded.key_provider, key_version = excluded.key_version, expires_at = excluded.expires_at,',
      "status = 'active', updated_at = now()",
    ].join(' '),
    [
      id('cred'),
      connectionId,
      input.investorId,
      input.userId,
      'oauth_token',
      encrypted.encryptedPayload,
      encrypted.encryptedDataKey,
      encrypted.keyProvider,
      encrypted.keyVersion,
      expiresAt,
      'active',
    ]
  );

  const connections = await listPersonalConnections(config, { investorId: input.investorId, provider: 'meta' });
  return connections.find((connection) => connection.id === connectionId) || null;
}

export async function upsertFeishuOAuthConnection(config: ServerConfig, input: {
  investorId: string;
  userId: string;
  accountId: string;
  accountName?: string;
  token: {
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    scope?: string;
    expiresIn?: number | null;
  };
  profile?: Record<string, unknown>;
}) {
  const pool = await getPersonalDataPool(config);
  const capabilityId = await upsertCapability(pool, {
    investorId: input.investorId,
    userId: input.userId,
    capabilityKey: 'feishu',
    capabilityType: 'oauth_account',
    displayName: 'instruction',
  });
  const accountId = input.accountId.trim();
  if (!accountId) throw new Error('Feishu accountId is required.');
  const expiresAt = input.token.expiresIn && input.token.expiresIn > 0
    ? new Date(Date.now() + input.token.expiresIn * 1000).toISOString()
    : null;

  const existing = await pool.query(
    [
      'select c.id, cr.encrypted_payload, cr.encrypted_data_key, cr.key_provider',
      'from personal_external_connections c',
      'left join personal_credentials cr on cr.connection_id = c.id and cr.status = $4',
      'where c.investor_id = $1 and c.provider = $2 and c.external_account_id = $3',
      'limit 1',
    ].join(' '),
    [input.investorId, 'feishu', accountId, 'active']
  );
  const connectionId = existing.rows[0]?.id ? String(existing.rows[0].id) : id('conn');
  let refreshToken = input.token.refreshToken;
  if (!refreshToken && existing.rows[0]?.encrypted_payload && existing.rows[0]?.encrypted_data_key && existing.rows[0]?.key_provider) {
    const current = decryptCredentialPayload<FeishuCredentialPayload>({
      keyProvider: String(existing.rows[0].key_provider),
      encryptedPayload: String(existing.rows[0].encrypted_payload),
      encryptedDataKey: String(existing.rows[0].encrypted_data_key),
    });
    refreshToken = current.refreshToken;
  }

  const metadata = input.profile || {};
  const encrypted = encryptCredentialPayload({
    provider: 'feishu',
    accessToken: input.token.accessToken,
    refreshToken,
    tokenType: input.token.tokenType,
    scope: input.token.scope,
    expiresAt,
    accountId,
    openId: typeof metadata.open_id === 'string' ? metadata.open_id : undefined,
    unionId: typeof metadata.union_id === 'string' ? metadata.union_id : undefined,
    tenantKey: typeof metadata.tenant_key === 'string' ? metadata.tenant_key : undefined,
  } satisfies FeishuCredentialPayload);

  await pool.query(
    [
      'insert into personal_external_connections',
      '(id, capability_id, investor_id, user_id, provider, connection_type, external_account_id, display_name, scopes, status, expires_at, metadata, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz, $12::jsonb, now(), now())',
      'on conflict (investor_id, provider, external_account_id) do update set',
      'capability_id = excluded.capability_id, user_id = excluded.user_id, display_name = excluded.display_name, scopes = excluded.scopes,',
      "status = 'connected', expires_at = excluded.expires_at, metadata = excluded.metadata, updated_at = now()",
    ].join(' '),
    [
      connectionId,
      capabilityId,
      input.investorId,
      input.userId,
      'feishu',
      'oauth_user',
      accountId,
      input.accountName || accountId,
      parseScopes(input.token.scope),
      'connected',
      expiresAt,
      JSON.stringify(metadata),
    ]
  );

  await pool.query(
    [
      'insert into personal_credentials',
      '(id, connection_id, investor_id, user_id, credential_type, encrypted_payload, encrypted_data_key, key_provider, key_version, expires_at, status, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11, now(), now())',
      'on conflict (connection_id) do update set',
      'investor_id = excluded.investor_id, user_id = excluded.user_id, credential_type = excluded.credential_type,',
      'encrypted_payload = excluded.encrypted_payload, encrypted_data_key = excluded.encrypted_data_key,',
      'key_provider = excluded.key_provider, key_version = excluded.key_version, expires_at = excluded.expires_at,',
      "status = 'active', updated_at = now()",
    ].join(' '),
    [
      id('cred'),
      connectionId,
      input.investorId,
      input.userId,
      'oauth_token',
      encrypted.encryptedPayload,
      encrypted.encryptedDataKey,
      encrypted.keyProvider,
      encrypted.keyVersion,
      expiresAt,
      'active',
    ]
  );

  const connections = await listPersonalConnections(config, { investorId: input.investorId, provider: 'feishu' });
  return connections.find((connection) => connection.id === connectionId) || null;
}

export async function upsertFeishuCliConnection(config: ServerConfig, input: {
  investorId: string;
  userId: string;
  accountId: string;
  accountName?: string;
  profileName: string;
  profileSnapshot: LarkCliProfileSnapshot;
  scopes?: string[];
  featurePackages?: unknown;
}) {
  const pool = await getPersonalDataPool(config);
  const capabilityId = await upsertCapability(pool, {
    investorId: input.investorId,
    userId: input.userId,
    capabilityKey: 'feishu',
    capabilityType: 'oauth_account',
    displayName: 'instruction',
  });
  const accountId = input.accountId.trim();
  if (!accountId) throw new Error('Feishu accountId is required.');
  const profileName = input.profileName.trim();
  if (!profileName) throw new Error('Feishu CLI profileName is required.');

  const existing = await pool.query(
    [
      'select id',
      'from personal_external_connections',
      'where investor_id = $1 and provider = $2 and external_account_id = $3',
      'limit 1',
    ].join(' '),
    [input.investorId, 'feishu', accountId]
  );
  const connectionId = existing.rows[0]?.id ? String(existing.rows[0].id) : id('conn');
  const featurePackages = normalizeFeishuCliFeaturePackages(input.featurePackages, []);
  const metadata = {
    auth_mode: 'lark_cli_user',
    cli_profile_name: profileName,
    credential_source: 'encrypted_rds_snapshot',
    snapshot_captured_at: input.profileSnapshot.capturedAt,
    feature_packages: featurePackages,
  };
  const encrypted = encryptCredentialPayload({
    provider: 'feishu',
    authMode: 'lark_cli_user',
    accountId,
    cliProfileName: profileName,
    cliProfileSnapshot: input.profileSnapshot,
    featurePackages,
    scope: (input.scopes || []).join(' '),
    expiresAt: null,
  } satisfies FeishuCredentialPayload);

  await pool.query(
    [
      'insert into personal_external_connections',
      '(id, capability_id, investor_id, user_id, provider, connection_type, external_account_id, display_name, scopes, status, expires_at, metadata, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null, $11::jsonb, now(), now())',
      'on conflict (investor_id, provider, external_account_id) do update set',
      'capability_id = excluded.capability_id, user_id = excluded.user_id, connection_type = excluded.connection_type,',
      'display_name = excluded.display_name, scopes = excluded.scopes,',
      "status = 'connected', expires_at = null, metadata = excluded.metadata, updated_at = now()",
    ].join(' '),
    [
      connectionId,
      capabilityId,
      input.investorId,
      input.userId,
      'feishu',
      'lark_cli_user',
      accountId,
      input.accountName || accountId,
      input.scopes || [],
      'connected',
      JSON.stringify(metadata),
    ]
  );

  await pool.query(
    [
      'insert into personal_credentials',
      '(id, connection_id, investor_id, user_id, credential_type, encrypted_payload, encrypted_data_key, key_provider, key_version, expires_at, status, created_at, updated_at)',
      'values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, $10, now(), now())',
      'on conflict (connection_id) do update set',
      'investor_id = excluded.investor_id, user_id = excluded.user_id, credential_type = excluded.credential_type,',
      'encrypted_payload = excluded.encrypted_payload, encrypted_data_key = excluded.encrypted_data_key,',
      'key_provider = excluded.key_provider, key_version = excluded.key_version, expires_at = null,',
      "status = 'active', updated_at = now()",
    ].join(' '),
    [
      id('cred'),
      connectionId,
      input.investorId,
      input.userId,
      'lark_cli_profile_snapshot',
      encrypted.encryptedPayload,
      encrypted.encryptedDataKey,
      encrypted.keyProvider,
      encrypted.keyVersion,
      'active',
    ]
  );

  const connections = await listPersonalConnections(config, { investorId: input.investorId, provider: 'feishu' });
  return connections.find((connection) => connection.id === connectionId) || null;
}

export async function updateFeishuConnectionFeaturePackages(config: ServerConfig, input: {
  investorId: string;
  userId?: string;
  connectionId: string;
  featurePackages: unknown;
}) {
  const pool = await getPersonalDataPool(config);
  const featurePackages = normalizeFeishuCliFeaturePackages(input.featurePackages, []);
  const values: unknown[] = [input.investorId];
  const userId = input.userId?.trim();
  const ownerWhere = userId && userId !== input.investorId
    ? `(c.investor_id = $1 or c.user_id = $${values.push(userId)})`
    : 'c.investor_id = $1';
  values.push(input.connectionId);
  const connectionParam = values.length;
  values.push('active');
  const credentialStatusParam = values.length;
  const current = await pool.query(
    [
      'select c.id, c.investor_id, c.provider, c.metadata, cr.encrypted_payload, cr.encrypted_data_key, cr.key_provider',
      'from personal_external_connections c',
      `left join personal_credentials cr on cr.connection_id = c.id and cr.status = $${credentialStatusParam}`,
      `where ${ownerWhere} and c.id = $${connectionParam}`,
      'limit 1',
    ].join(' '),
    values
  );
  const row = current.rows[0];
  if (!row) return null;
  if (String(row.provider) !== 'feishu') throw new Error('Only Feishu connections support feature package updates.');
  const ownerInvestorId = String(row.investor_id || input.investorId);

  const metadata = typeof row.metadata === 'object' && row.metadata && !Array.isArray(row.metadata)
    ? { ...(row.metadata as Record<string, unknown>) }
    : {};
  metadata.feature_packages = featurePackages;
  await pool.query(
    [
      'update personal_external_connections',
      'set metadata = $3::jsonb, updated_at = now()',
      'where investor_id = $1 and id = $2',
    ].join(' '),
    [ownerInvestorId, input.connectionId, JSON.stringify(metadata)]
  );

  if (row.encrypted_payload && row.encrypted_data_key && row.key_provider) {
    const payload = decryptCredentialPayload<FeishuCredentialPayload>({
      keyProvider: String(row.key_provider),
      encryptedPayload: String(row.encrypted_payload),
      encryptedDataKey: String(row.encrypted_data_key),
    });
    await updatePersonalCredentialPayload(config, {
      investorId: ownerInvestorId,
      connectionId: input.connectionId,
      payload: {
        ...payload,
        provider: 'feishu',
        featurePackages,
      },
    });
  }

  const connections = await listPersonalConnections(config, { investorId: input.investorId, userId: input.userId, provider: 'feishu' });
  return connections.find((connection) => connection.id === input.connectionId) || null;
}

export async function disablePersonalConnection(config: ServerConfig, input: {
  investorId: string;
  userId?: string;
  connectionId: string;
}) {
  const pool = await getPersonalDataPool(config);
  const values: unknown[] = [input.investorId];
  const userId = input.userId?.trim();
  const ownerWhere = userId && userId !== input.investorId
    ? `(investor_id = $1 or user_id = $${values.push(userId)})`
    : 'investor_id = $1';
  values.push(input.connectionId);
  const connectionParam = values.length;
  const updated = await pool.query(
    [
      'update personal_external_connections',
      "set status = 'disabled', updated_at = now()",
      `where ${ownerWhere} and id = $${connectionParam}`,
      'returning id, investor_id',
    ].join(' '),
    values
  );
  if (!updated.rows[0]) return false;
  const ownerInvestorId = String(updated.rows[0].investor_id || input.investorId);
  await pool.query(
    [
      'update personal_credentials',
      "set status = 'revoked', updated_at = now()",
      'where investor_id = $1 and connection_id = $2',
    ].join(' '),
    [ownerInvestorId, input.connectionId]
  );
  return true;
}

export async function loadPersonalCredential(config: ServerConfig, input: {
  investorId: string;
  connectionId: string;
}) {
  const pool = await getPersonalDataPool(config);
  const result = await pool.query(
    [
      'select id, connection_id, encrypted_payload, encrypted_data_key, key_provider, key_version, expires_at',
      'from personal_credentials',
      "where investor_id = $1 and connection_id = $2 and status = 'active'",
      'limit 1',
    ].join(' '),
    [input.investorId, input.connectionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    connectionId: String(row.connection_id),
    encryptedPayload: String(row.encrypted_payload),
    encryptedDataKey: String(row.encrypted_data_key),
    keyProvider: String(row.key_provider),
    keyVersion: String(row.key_version),
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : typeof row.expires_at === 'string' ? row.expires_at : null,
  } satisfies PersonalCredentialRecord;
}

export async function updatePersonalCredentialPayload(config: ServerConfig, input: {
  investorId: string;
  connectionId: string;
  payload: PersonalCredentialPayload;
}) {
  const encrypted = encryptCredentialPayload(input.payload);
  const pool = await getPersonalDataPool(config);
  await pool.query(
    [
      'update personal_credentials',
      'set encrypted_payload = $3, encrypted_data_key = $4, key_provider = $5, key_version = $6, expires_at = $7::timestamptz, updated_at = now()',
      'where investor_id = $1 and connection_id = $2',
    ].join(' '),
    [
      input.investorId,
      input.connectionId,
      encrypted.encryptedPayload,
      encrypted.encryptedDataKey,
      encrypted.keyProvider,
      encrypted.keyVersion,
      input.payload.expiresAt || null,
    ]
  );
}

export async function recordPersonaltoolCallAudit(config: ServerConfig, input: {
  investorId: string;
  userId: string;
  threadId?: string;
  runId?: string;
  toolName: string;
  provider?: string;
  connectionId?: string;
  argsSummary?: unknown;
  resultSummary?: unknown;
  status: string;
  error?: string;
}) {
  try {
    const pool = await getPersonalDataPool(config);
    await pool.query(
      [
        'insert into personal_tool_call_audits',
        '(id, investor_id, user_id, thread_id, run_id, tool_name, provider, connection_id, args_summary, result_summary, status, error, created_at)',
        'values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, now())',
      ].join(' '),
      [
        id('audit'),
        input.investorId,
        input.userId,
        input.threadId || null,
        input.runId || null,
        input.toolName,
        input.provider || null,
        input.connectionId || null,
        JSON.stringify(input.argsSummary ?? null),
        JSON.stringify(input.resultSummary ?? null),
        input.status,
        input.error || null,
      ]
    );
  } catch {
    // Audit must never break the user-facing tool call.
  }
}

async function upsertCapability(pool: PgPool, input: {
  investorId: string;
  userId: string;
  capabilityKey: string;
  capabilityType: string;
  displayName: string;
}) {
  const capabilityId = id('cap');
  const result = await pool.query(
    [
      'insert into personal_user_capabilities',
      '(id, investor_id, user_id, capability_key, capability_type, status, display_name, config, created_at, updated_at)',
      "values ($1, $2, $3, $4, $5, 'enabled', $6, '{}'::jsonb, now(), now())",
      'on conflict (investor_id, capability_key) do update set',
      "user_id = excluded.user_id, status = 'enabled', display_name = excluded.display_name, updated_at = now()",
      'returning id',
    ].join(' '),
    [capabilityId, input.investorId, input.userId, input.capabilityKey, input.capabilityType, input.displayName]
  );
  return String(result.rows[0].id);
}

async function getPersonalDataPool(config: ServerConfig): Promise<PgPool> {
  const connectionString = (config.contextDatabaseUrl || config.databaseUrl || '').trim();
  if (!connectionString) throw new Error('AGENT_CONTEXT_DATABASE_URL or DATABASE_URL is required for personal data credentials.');
  if (sharedPool && sharedUrl === connectionString) return sharedPool;
  let pg: { Pool: new (options: { connectionString: string }) => PgPool };
  try {
    pg = (await import('pg')) as { Pool: new (options: { connectionString: string }) => PgPool };
  } catch (error) {
    throw new Error(`Personal data DB requires the "pg" package: ${error instanceof Error ? error.message : String(error)}`);
  }
  sharedUrl = connectionString;
  sharedPool = new pg.Pool({ connectionString });
  if (!schemaReady) schemaReady = createPersonalDataSchema(sharedPool);
  await schemaReady;
  return sharedPool;
}

async function createPersonalDataSchema(pool: PgPool) {
  await pool.query(`
    create table if not exists personal_user_capabilities (
      id text primary key,
      investor_id text not null,
      user_id text not null,
      capability_key text not null,
      capability_type text not null,
      status text not null default 'enabled',
      display_name text,
      config jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (investor_id, capability_key)
    )
  `);
  await pool.query('create index if not exists personal_user_capabilities_investor_idx on personal_user_capabilities(investor_id, status, updated_at desc)');
  await pool.query(`
    create table if not exists personal_external_connections (
      id text primary key,
      capability_id text not null references personal_user_capabilities(id) on delete cascade,
      investor_id text not null,
      user_id text not null,
      provider text not null,
      connection_type text not null,
      external_account_id text not null,
      display_name text,
      scopes text[],
      status text not null default 'connected',
      expires_at timestamptz,
      metadata jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (investor_id, provider, external_account_id)
    )
  `);
  await pool.query('create index if not exists personal_external_connections_investor_provider_idx on personal_external_connections(investor_id, provider, status, updated_at desc)');
  await pool.query(`
    create table if not exists personal_credentials (
      id text primary key,
      connection_id text not null unique references personal_external_connections(id) on delete cascade,
      investor_id text not null,
      user_id text not null,
      credential_type text not null,
      encrypted_payload text not null,
      encrypted_data_key text not null,
      key_provider text not null,
      key_version text not null,
      expires_at timestamptz,
      refresh_expires_at timestamptz,
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await pool.query('create index if not exists personal_credentials_investor_status_idx on personal_credentials(investor_id, status, updated_at desc)');
  await pool.query(`
    create table if not exists personal_tool_call_audits (
      id text primary key,
      investor_id text not null,
      user_id text not null,
      thread_id text,
      run_id text,
      tool_name text not null,
      provider text,
      connection_id text,
      args_summary jsonb,
      result_summary jsonb,
      status text not null,
      error text,
      created_at timestamptz not null default now()
    )
  `);
  await pool.query('create index if not exists personal_tool_call_audits_investor_created_idx on personal_tool_call_audits(investor_id, created_at desc)');
  await pool.query('create index if not exists personal_tool_call_audits_run_created_idx on personal_tool_call_audits(run_id, created_at desc)');
}

function normalizeMetaPages(value: unknown[]) {
  return value.map((item) => normalizeMetaPage(item)).filter(Boolean) as MetaPageAsset[];
}

function normalizeMetaPage(value: unknown): MetaPageAsset | null {
  if (!isPlainRecord(value)) return null;
  const idValue = readRecordString(value, 'id');
  if (!idValue) return null;
  const instagram = normalizeMetaInstagramAccount(value.instagram_business_account, {
    pageId: idValue,
    pageName: readRecordString(value, 'name') || undefined,
  });
  return {
    id: idValue,
    name: readRecordString(value, 'name') || undefined,
    category: readRecordString(value, 'category') || undefined,
    accessToken: readRecordString(value, 'access_token') || readRecordString(value, 'accessToken') || undefined,
    tasks: Array.isArray(value.tasks) ? value.tasks.map(String).filter(Boolean) : undefined,
    instagramAccount: instagram || undefined,
  };
}

function normalizeMetaInstagramAccounts(value: unknown[], pages: MetaPageAsset[]) {
  const accounts = value.map((item) => normalizeMetaInstagramAccount(item, undefined)).filter(Boolean) as MetaInstagramAsset[];
  const seen = new Set(accounts.map((account) => account.id));
  for (const page of pages) {
    if (page.instagramAccount && !seen.has(page.instagramAccount.id)) {
      accounts.push(page.instagramAccount);
      seen.add(page.instagramAccount.id);
    }
  }
  return accounts;
}

function normalizeMetaInstagramAccount(value: unknown, page?: { pageId?: string; pageName?: string }): MetaInstagramAsset | null {
  if (!isPlainRecord(value)) return null;
  const idValue = readRecordString(value, 'id');
  if (!idValue) return null;
  return {
    id: idValue,
    username: readRecordString(value, 'username') || undefined,
    name: readRecordString(value, 'name') || undefined,
    profilePictureUrl: readRecordString(value, 'profile_picture_url') || readRecordString(value, 'profilePictureUrl') || undefined,
    pageId: readRecordString(value, 'page_id') || readRecordString(value, 'pageId') || page?.pageId,
    pageName: readRecordString(value, 'page_name') || readRecordString(value, 'pageName') || page?.pageName,
  };
}

function sanitizeMetaPage(page: MetaPageAsset) {
  return {
    id: page.id,
    name: page.name || null,
    category: page.category || null,
    tasks: page.tasks || [],
    instagramAccount: page.instagramAccount ? sanitizeMetaInstagramAccount(page.instagramAccount) : null,
  };
}

function sanitizeMetaInstagramAccount(account: MetaInstagramAsset) {
  return {
    id: account.id,
    username: account.username || null,
    name: account.name || null,
    profilePictureUrl: account.profilePictureUrl || null,
    pageId: account.pageId || null,
    pageName: account.pageName || null,
  };
}

function sanitizeRecord(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !/token|secret|authorization/i.test(key))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readRecordString(value: Record<string, unknown>, key: string) {
  const current = value[key];
  return typeof current === 'string' && current.trim() ? current.trim() : '';
}

function parseScopes(scope?: string) {
  return (scope || '').split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

function rowToConnection(row: Record<string, unknown>): PersonalConnection {
  return {
    id: String(row.id),
    capabilityId: String(row.capability_id),
    investorId: String(row.investor_id),
    userId: String(row.user_id),
    provider: String(row.provider),
    connectionType: String(row.connection_type),
    externalAccountId: String(row.external_account_id),
    displayName: typeof row.display_name === 'string' ? row.display_name : String(row.external_account_id),
    scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
    status: String(row.status),
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : typeof row.expires_at === 'string' ? row.expires_at : null,
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata as Record<string, unknown> : {},
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : typeof row.updated_at === 'string' ? row.updated_at : new Date().toISOString(),
  };
}
