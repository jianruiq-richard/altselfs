import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from './config.js';
import { isRecord, id, truncate } from './util.js';

export type LarkCliJson = Record<string, unknown>;
export type LarkCliProfileSnapshot = {
  format: 'lark-cli-profile-snapshot-v1';
  profileName: string;
  capturedAt: string;
  files: Array<{
    path: string;
    contentBase64: string;
    mode?: number;
  }>;
};

export const FEISHU_CLI_FEATURE_PACKAGES = ['messages', 'contacts', 'calendar', 'docs', 'meetings'] as const;
export type FeishuCliFeaturePackage = (typeof FEISHU_CLI_FEATURE_PACKAGES)[number];

export const DEFAULT_FEISHU_CLI_FEATURE_PACKAGES: FeishuCliFeaturePackage[] = ['messages', 'contacts', 'calendar', 'docs'];

const FEISHU_CLI_FEATURE_PACKAGE_CONFIG: Record<FeishuCliFeaturePackage, { domains: string[]; scopes: string[] }> = {
  messages: { domains: ['im'], scopes: ['search:message'] },
  contacts: { domains: ['contact'], scopes: ['contact:user.basic_profile:readonly'] },
  calendar: { domains: ['calendar'], scopes: ['calendar:calendar.event:read'] },
  docs: { domains: ['docs', 'drive'], scopes: ['search:docs:read'] },
  meetings: { domains: ['vc', 'minutes', 'note'], scopes: [] },
};

type RunOptions = {
  profileName?: string;
  cliHome?: string;
  stdin?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
};

const URL_RE = /^https?:\/\//i;
const URL_SEARCH_RE = /https?:\/\/[^\s"'<>))]+/i;
const SNAPSHOT_FORMAT = 'lark-cli-profile-snapshot-v1' as const;
const SNAPSHOT_MAX_FILES = 300;
const SNAPSHOT_MAX_FILE_BYTES = 1024 * 1024;
const SNAPSHOT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_EXCLUDED_NAMES = new Set(['.DS_Store', '.npm', 'node_modules']);
const FEISHU_CLI_BIND_SESSION_TTL_MS = 30 * 60 * 1000;
const FEISHU_CLI_SETUP_URL_WAIT_MS = 15_000;
const FEISHU_CLI_SESSION_OUTPUT_MAX = 16_000;

type FeishuCliCompletedAuthorization = {
  profileName: string;
  accountId: string;
  displayName: string;
  scopes: string[];
  profileSnapshot: LarkCliProfileSnapshot;
  whoami: LarkCliJson;
  authStatus: LarkCliJson;
  requestedFeaturePackages?: FeishuCliFeaturePackage[];
};

type FeishuCliBindSession = {
  sessionId: string;
  investorId: string;
  userId: string;
  profileName: string;
  featurePackages: FeishuCliFeaturePackage[];
  authRequest: { domains: string[]; scopes: string[] };
  cliHome: string;
  phase: 'app_setup' | 'app_configured' | 'user_auth' | 'completed' | 'failed';
  createdAt: string;
  expiresAt: string;
  setupUrl: string;
  setupOutput: string;
  setupProcess: ReturnType<typeof spawn> | null;
  setupClosed: boolean;
  setupExitCode: number | null;
  setupError: string;
  authUrl: string;
  deviceCode: string;
  userCode: string | null;
  authExpiresAt: string | null;
  completed?: FeishuCliCompletedAuthorization;
  cleanupTimer: NodeJS.Timeout;
};

const feishuCliBindSessions = new Map<string, FeishuCliBindSession>();

export async function startFeishuCliAuthorization(config: ServerConfig, input: {
  investorId: string;
  userId: string;
  featurePackages?: unknown;
}) {
  sweepExpiredFeishuCliBindSessions(config);
  const profileName = makeFeishuCliProfileName(input.investorId);
  const featurePackages = normalizeFeishuCliFeaturePackages(input.featurePackages, DEFAULT_FEISHU_CLI_FEATURE_PACKAGES);
  const authRequest = buildFeishuCliAuthRequest(config, featurePackages);

  const sessionId = id('feishu');
  const cliHome = path.join(
    path.resolve(config.larkCliHomeRoot),
    'bind-sessions',
    `${normalizeProfileName(profileName)}_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  );
  await fs.mkdir(cliHome, { recursive: true, mode: 0o700 });

  const expiresAt = new Date(Date.now() + FEISHU_CLI_BIND_SESSION_TTL_MS).toISOString();
  const session: FeishuCliBindSession = {
    sessionId,
    investorId: input.investorId,
    userId: input.userId,
    profileName,
    featurePackages,
    authRequest,
    cliHome,
    phase: 'app_setup',
    createdAt: new Date().toISOString(),
    expiresAt,
    setupUrl: '',
    setupOutput: '',
    setupProcess: null,
    setupClosed: false,
    setupExitCode: null,
    setupError: '',
    authUrl: '',
    deviceCode: '',
    userCode: null,
    authExpiresAt: null,
    cleanupTimer: setTimeout(() => {
      void destroyFeishuCliBindSession(config, sessionId, 'expired');
    }, FEISHU_CLI_BIND_SESSION_TTL_MS + 30_000),
  };
  feishuCliBindSessions.set(sessionId, session);

  try {
    startFeishuCliConfigInitProcess(config, session);
    await waitForFeishuCliSetupUrl(session, FEISHU_CLI_SETUP_URL_WAIT_MS);
    return publicFeishuCliBindSession(session);
  } catch (error) {
    await destroyFeishuCliBindSession(config, sessionId, 'failed');
    throw error;
  }
}

export async function continueFeishuCliAuthorization(config: ServerConfig, input: {
  investorId: string;
  sessionId: string;
}) {
  const session = getFeishuCliBindSession(input.sessionId, input.investorId);
  if (!session) throw new Error('instructionConnectinstruction, instructionConnect.');
  if (isFeishuCliBindSessionExpired(session)) {
    await destroyFeishuCliBindSession(config, session.sessionId, 'expired');
    throw new Error('instructionConnectinstruction, instructionConnect.');
  }

  if (session.phase === 'app_setup') {
    if (!session.setupClosed) {
      const profileConfigured = await isFeishuCliAppProfileConfigured(config, session);
      if (!profileConfigured) return publicFeishuCliBindSession(session);
      session.setupClosed = true;
      session.setupExitCode = 0;
      if (session.setupProcess) {
        session.setupProcess.kill('SIGTERM');
        session.setupProcess = null;
      }
    }
    if (session.setupExitCode !== 0) {
      session.phase = 'failed';
      throw new Error(`lark-cli config init failed: ${truncate(session.setupError || session.setupOutput || `exit ${session.setupExitCode}`, 1500)}`);
    }
    session.phase = 'app_configured';
  }

  if (session.phase === 'app_configured') {
    const authStatus = await runLarkCliJson(config, ['auth', 'status', '--json', '--verify'], {
      profileName: session.profileName,
      cliHome: session.cliHome,
      allowFailure: true,
    });
    if (hasFeishuCliUserIdentity(authStatus)) {
      session.completed = await captureCompletedFeishuCliAuthorization(config, session);
      session.phase = 'completed';
      const completed = { ...publicFeishuCliBindSession(session), completed: session.completed };
      await destroyFeishuCliBindSession(config, session.sessionId, 'completed');
      return completed;
    }
    await startFeishuCliUserAuth(config, session);
  }

  return publicFeishuCliBindSession(session);
}

export async function completeFeishuCliAuthorization(config: ServerConfig, input: {
  investorId?: string;
  sessionId?: string;
  profileName?: string;
  deviceCode?: string;
}) {
  if (input.sessionId) {
    const session = getFeishuCliBindSession(input.sessionId, input.investorId);
    if (!session) throw new Error('instructionConnectinstruction, instructionConnect.');
    if (isFeishuCliBindSessionExpired(session)) {
      await destroyFeishuCliBindSession(config, session.sessionId, 'expired');
      throw new Error('instructionConnectinstruction, instructionConnect.');
    }
    if (session.phase === 'app_setup' || session.phase === 'app_configured') {
      throw new Error('instructionCompleteinstruction CLI instruction, instructionaccountsinstruction.');
    }
    if (session.phase === 'completed' && session.completed) return session.completed;
    if (session.phase !== 'user_auth' || !session.deviceCode) {
      throw new Error('instructionaccountsinstruction, instructionConnect.');
    }
    await runLarkCliJson(config, ['auth', 'login', '--device-code', session.deviceCode, '--json'], {
      profileName: session.profileName,
      cliHome: session.cliHome,
    });
    const completed = await captureCompletedFeishuCliAuthorization(config, session);
    session.completed = completed;
    session.phase = 'completed';
    await destroyFeishuCliBindSession(config, session.sessionId, 'completed');
    return completed;
  }

  const profileName = normalizeProfileName(input.profileName || '');
  if (!profileName) throw new Error('profileName is required.');
  const deviceCode = (input.deviceCode || '').trim();
  if (!deviceCode) throw new Error('deviceCode is required.');

  return withTemporaryFeishuCliHome(config, profileName, async (cliHome) => {
    await ensureFeishuCliProfile(config, profileName, cliHome);
    await runLarkCliJson(config, ['auth', 'login', '--device-code', deviceCode, '--json'], { profileName, cliHome });
    const [whoami, authStatus] = await Promise.all([
      runLarkCliJson(config, ['whoami', '--json'], { profileName, cliHome, allowFailure: true }),
      runLarkCliJson(config, ['auth', 'status', '--json', '--verify'], { profileName, cliHome, allowFailure: true }),
    ]);
    const profileSnapshot = await captureFeishuCliProfileSnapshot(config, profileName, { cliHome });
    const accountId =
      findFirstString(whoami, ['open_id', 'openId', 'union_id', 'unionId', 'user_id', 'userId', 'id']) ||
      findFirstString(authStatus, ['open_id', 'openId', 'union_id', 'unionId', 'user_id', 'userId', 'id']) ||
      profileName;
    const displayName =
      findFirstString(whoami, ['name', 'display_name', 'displayName', 'localized_name', 'localizedName', 'email']) ||
      findFirstString(authStatus, ['name', 'display_name', 'displayName', 'email']) ||
      'instruction';
    return {
      profileName,
      accountId,
      displayName,
      scopes: findStringArray(authStatus, ['scopes', 'scope']) || findStringArray(whoami, ['scopes', 'scope']) || [],
      profileSnapshot,
      whoami,
      authStatus,
      requestedFeaturePackages: undefined,
    };
  });
}

export async function runFeishuCliForProfile(
  config: ServerConfig,
  profileName: string,
  args: string[],
  options: { timeoutMs?: number } = {}
) {
  const normalized = normalizeProfileName(profileName);
  if (!normalized) throw new Error('Feishu CLI profile is missing. Reconnect the Feishu account.');
  return withTemporaryFeishuCliHome(config, normalized, async (cliHome) => {
    await ensureFeishuCliProfile(config, normalized, cliHome);
    return runLarkCliJson(config, args, {
      profileName: normalized,
      cliHome,
      timeoutMs: options.timeoutMs,
    });
  });
}

export async function runFeishuCliWithSnapshot(
  config: ServerConfig,
  profileName: string,
  snapshot: LarkCliProfileSnapshot,
  args: string[],
  options: { timeoutMs?: number } = {}
) {
  const normalized = normalizeProfileName(profileName);
  if (!normalized) throw new Error('Feishu CLI profile is missing. Reconnect the Feishu account.');
  return withTemporaryFeishuCliHome(config, normalized, async (cliHome) => {
    await restoreFeishuCliProfileSnapshot(config, normalized, snapshot, { cliHome });
    const result = await runLarkCliJson(config, args, {
      profileName: normalized,
      cliHome,
      timeoutMs: options.timeoutMs,
    });
    const profileSnapshot = await captureFeishuCliProfileSnapshot(config, normalized, { cliHome });
    return { result, profileSnapshot };
  });
}

export async function runFeishuCliRawWithSnapshot(
  config: ServerConfig,
  profileName: string,
  snapshot: LarkCliProfileSnapshot,
  args: string[],
  options: { timeoutMs?: number } = {}
) {
  const normalized = normalizeProfileName(profileName);
  if (!normalized) throw new Error('Feishu CLI profile is missing. Reconnect the Feishu account.');
  return withTemporaryFeishuCliHome(config, normalized, async (cliHome) => {
    await restoreFeishuCliProfileSnapshot(config, normalized, snapshot, { cliHome });
    const result = await runLarkCli(config, ['--profile', normalized, ...args], {
      profileName: normalized,
      cliHome,
      timeoutMs: options.timeoutMs,
    });
    const profileSnapshot = await captureFeishuCliProfileSnapshot(config, normalized, { cliHome });
    return { result, profileSnapshot };
  });
}

export async function captureFeishuCliProfileSnapshot(
  config: ServerConfig,
  profileName: string,
  options: { cliHome?: string } = {}
): Promise<LarkCliProfileSnapshot> {
  const normalized = normalizeProfileName(profileName);
  if (!normalized) throw new Error('profileName is required.');
  const root = resolveLarkCliHome(config, normalized, options.cliHome);
  const files: LarkCliProfileSnapshot['files'] = [];
  const budget = { totalBytes: 0 };
  await collectSnapshotFiles(root, '', files, budget);
  if (files.length === 0) {
    throw new Error(`lark-cli profile ${normalized} produced no local credential snapshot.`);
  }
  return {
    format: SNAPSHOT_FORMAT,
    profileName: normalized,
    capturedAt: new Date().toISOString(),
    files,
  };
}

export async function restoreFeishuCliProfileSnapshot(
  config: ServerConfig,
  profileName: string,
  snapshot: LarkCliProfileSnapshot,
  options: { cliHome?: string } = {}
) {
  const normalized = normalizeProfileName(profileName);
  if (!normalized) throw new Error('profileName is required.');
  if (!snapshot || snapshot.format !== SNAPSHOT_FORMAT || !Array.isArray(snapshot.files)) {
    throw new Error('Invalid lark-cli profile snapshot. Rebind Feishu.');
  }
  const snapshotProfile = normalizeProfileName(snapshot.profileName || normalized);
  if (snapshotProfile && snapshotProfile !== normalized) {
    throw new Error('lark-cli profile snapshot does not match the requested Feishu account.');
  }
  const root = resolveLarkCliHome(config, normalized, options.cliHome);
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  for (const file of snapshot.files) {
    const relativePath = normalizeSnapshotPath(file.path);
    if (!relativePath) continue;
    const destination = path.join(root, relativePath);
    if (!destination.startsWith(`${root}${path.sep}`)) continue;
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.writeFile(destination, Buffer.from(file.contentBase64, 'base64'), { mode: 0o600 });
    if (file.mode && Number.isFinite(file.mode)) {
      await fs.chmod(destination, file.mode & 0o777).catch(() => null);
    }
  }
}

export function makeFeishuCliProfileName(investorId: string) {
  const safeInvestor = investorId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'user';
  return normalizeProfileName(`altselfs_${safeInvestor}_${id('l')}`);
}

export function normalizeProfileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 64);
}

export function normalizeFeishuCliFeaturePackages(value: unknown, fallback: FeishuCliFeaturePackage[] = []): FeishuCliFeaturePackage[] {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const allowed = new Set<string>(FEISHU_CLI_FEATURE_PACKAGES);
  const seen = new Set<string>();
  for (const item of rawItems) {
    const normalized = typeof item === 'string' ? item.trim().toLowerCase() : '';
    if (!allowed.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
  }
  const packages = Array.from(seen) as FeishuCliFeaturePackage[];
  return packages.length > 0 || rawItems.length > 0 ? packages : [...fallback];
}

function buildFeishuCliAuthRequest(config: ServerConfig, featurePackages: FeishuCliFeaturePackage[]) {
  const domains = new Set<string>();
  const scopes = new Set<string>();
  for (const featurePackage of featurePackages) {
    const packageConfig = FEISHU_CLI_FEATURE_PACKAGE_CONFIG[featurePackage];
    for (const domain of packageConfig.domains) domains.add(domain);
    for (const scope of packageConfig.scopes) scopes.add(scope);
  }
  if (featurePackages.length === 0) {
    for (const domain of config.feishuCliAuthDomains) domains.add(domain);
    for (const scope of config.feishuCliAuthExtraScopes) scopes.add(scope);
  }
  return {
    domains: Array.from(domains),
    scopes: Array.from(scopes),
  };
}

function startFeishuCliConfigInitProcess(config: ServerConfig, session: FeishuCliBindSession) {
  const args = [
    'config',
    'init',
    '--new',
    '--name',
    session.profileName,
    '--brand',
    'feishu',
    '--lang',
    'zh_cn',
    '--force-init',
  ];
  const child = spawn(config.larkCliBin, args, {
    cwd: session.cliHome,
    env: buildLarkCliEnv(config, session.cliHome),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  session.setupProcess = child;
  child.stdin.end();

  const append = (chunk: Buffer) => {
    session.setupOutput = truncateSessionOutput(`${session.setupOutput}${chunk.toString('utf8')}`);
    if (!session.setupUrl) {
      const found = extractFirstUrl(session.setupOutput);
      if (found) session.setupUrl = found;
    }
  };

  child.stdout.on('data', (chunk) => append(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => append(Buffer.from(chunk)));
  child.on('error', (error) => {
    session.setupClosed = true;
    session.setupExitCode = -1;
    session.setupError = error instanceof Error ? error.message : String(error);
    session.phase = 'failed';
  });
  child.on('close', (code) => {
    session.setupClosed = true;
    session.setupExitCode = code || 0;
    session.setupProcess = null;
    if (session.setupExitCode !== 0) {
      session.phase = 'failed';
      session.setupError = session.setupOutput;
    }
  });
}

async function startFeishuCliUserAuth(config: ServerConfig, session: FeishuCliBindSession) {
  const args = ['auth', 'login', '--no-wait', '--json', '--recommend'];
  if (session.authRequest.domains.length > 0) args.push('--domain', session.authRequest.domains.join(','));
  if (session.authRequest.scopes.length > 0) args.push('--scope', session.authRequest.scopes.join(' '));
  if (config.feishuCliAuthExcludeScopes.length > 0) args.push('--exclude', config.feishuCliAuthExcludeScopes.join(' '));

  const data = await runLarkCliJson(config, args, {
    profileName: session.profileName,
    cliHome: session.cliHome,
  });
  const authUrl = findFirstString(data, ['verification_uri_complete', 'verification_url', 'auth_url', 'url'], URL_RE);
  const deviceCode = findFirstString(data, ['device_code', 'deviceCode']);
  const userCode = findFirstString(data, ['user_code', 'userCode']);
  const expiresIn = findFirstNumber(data, ['expires_in', 'expiresIn']);
  if (!authUrl || !deviceCode) {
    throw new Error(`lark-cli did not return authorization URL/device code: ${JSON.stringify(data).slice(0, 1000)}`);
  }
  session.phase = 'user_auth';
  session.authUrl = authUrl;
  session.deviceCode = deviceCode;
  session.userCode = userCode || null;
  session.authExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
}

async function isFeishuCliAppProfileConfigured(config: ServerConfig, session: FeishuCliBindSession) {
  const authStatus = await runLarkCliJson(config, ['auth', 'status', '--json', '--verify'], {
    profileName: session.profileName,
    cliHome: session.cliHome,
    allowFailure: true,
    timeoutMs: 10_000,
  }).catch(() => null);
  if (isFeishuCliProfileMissing(authStatus)) return false;
  const profileSnapshot = await captureFeishuCliProfileSnapshot(config, session.profileName, {
    cliHome: session.cliHome,
  }).catch(() => null);
  return Boolean(profileSnapshot?.files.length);
}

async function captureCompletedFeishuCliAuthorization(
  config: ServerConfig,
  session: Pick<FeishuCliBindSession, 'profileName' | 'cliHome' | 'featurePackages'>
): Promise<FeishuCliCompletedAuthorization> {
  const [whoami, authStatus] = await Promise.all([
    runLarkCliJson(config, ['whoami', '--json'], {
      profileName: session.profileName,
      cliHome: session.cliHome,
      allowFailure: true,
    }),
    runLarkCliJson(config, ['auth', 'status', '--json', '--verify'], {
      profileName: session.profileName,
      cliHome: session.cliHome,
      allowFailure: true,
    }),
  ]);
  const profileSnapshot = await captureFeishuCliProfileSnapshot(config, session.profileName, { cliHome: session.cliHome });
  const accountId =
    findFirstString(whoami, ['open_id', 'openId', 'union_id', 'unionId', 'user_id', 'userId', 'id']) ||
    findFirstString(authStatus, ['open_id', 'openId', 'union_id', 'unionId', 'user_id', 'userId', 'id']) ||
    session.profileName;
  const displayName =
    findFirstString(whoami, ['name', 'display_name', 'displayName', 'localized_name', 'localizedName', 'email']) ||
    findFirstString(authStatus, ['name', 'display_name', 'displayName', 'email']) ||
    'instruction';
  return {
    profileName: session.profileName,
    accountId,
    displayName,
    scopes: findStringArray(authStatus, ['scopes', 'scope']) || findStringArray(whoami, ['scopes', 'scope']) || [],
    profileSnapshot,
    whoami,
    authStatus,
    requestedFeaturePackages: [...session.featurePackages],
  };
}

function publicFeishuCliBindSession(session: FeishuCliBindSession) {
  return {
    sessionId: session.sessionId,
    phase: session.phase,
    profileName: session.profileName,
    setupUrl: session.setupUrl || null,
    authUrl: session.authUrl || null,
    userCode: session.userCode || null,
    expiresAt: session.expiresAt,
    authExpiresAt: session.authExpiresAt,
    requestedFeaturePackages: [...session.featurePackages],
    requestedDomains: [...session.authRequest.domains],
    requestedScopes: [...session.authRequest.scopes],
    setupComplete: session.setupClosed && session.setupExitCode === 0,
  };
}

function getFeishuCliBindSession(sessionId: string, investorId?: string) {
  const session = feishuCliBindSessions.get(sessionId.trim());
  if (!session) return null;
  if (investorId && session.investorId !== investorId) return null;
  return session;
}

function isFeishuCliBindSessionExpired(session: FeishuCliBindSession) {
  return Date.parse(session.expiresAt) <= Date.now();
}

function sweepExpiredFeishuCliBindSessions(config: ServerConfig) {
  for (const session of feishuCliBindSessions.values()) {
    if (isFeishuCliBindSessionExpired(session)) {
      void destroyFeishuCliBindSession(config, session.sessionId, 'expired');
    }
  }
}

async function destroyFeishuCliBindSession(
  config: ServerConfig,
  sessionId: string,
  _reason: 'completed' | 'expired' | 'failed'
) {
  const session = feishuCliBindSessions.get(sessionId);
  if (!session) return;
  feishuCliBindSessions.delete(sessionId);
  clearTimeout(session.cleanupTimer);
  if (session.setupProcess && !session.setupClosed) {
    session.setupProcess.kill('SIGTERM');
  }
  const root = path.resolve(config.larkCliHomeRoot);
  const cliHome = path.resolve(session.cliHome);
  if (cliHome.startsWith(`${root}${path.sep}`)) {
    await fs.rm(cliHome, { recursive: true, force: true }).catch(() => null);
  }
}

function waitForFeishuCliSetupUrl(session: FeishuCliBindSession, timeoutMs: number) {
  const startedAt = Date.now();
  return new Promise<void>((resolve, reject) => {
    const interval = setInterval(() => {
      if (session.setupUrl) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (session.setupClosed) {
        clearInterval(interval);
        reject(new Error(`lark-cli config init exited before returning setup URL: ${truncate(session.setupError || session.setupOutput || `exit ${session.setupExitCode}`, 1500)}`));
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(interval);
        reject(new Error('lark-cli config init did not return setup URL in time.'));
      }
    }, 250);
  });
}

function extractFirstUrl(value: string) {
  const cleaned = stripAnsi(value);
  const match = URL_SEARCH_RE.exec(cleaned);
  return match?.[0] ? match[0].replace(/[.,;, .; ]+$/, '') : '';
}

function stripAnsi(value: string) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function truncateSessionOutput(value: string) {
  return value.length > FEISHU_CLI_SESSION_OUTPUT_MAX
    ? value.slice(value.length - FEISHU_CLI_SESSION_OUTPUT_MAX)
    : value;
}

function hasFeishuCliUserIdentity(value: unknown) {
  const queue = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, entry] of Object.entries(current)) {
      if (key.toLowerCase() === 'user' && isRecord(entry)) {
        const available = entry.available;
        const status = typeof entry.status === 'string' ? entry.status.toLowerCase() : '';
        if (available === true || status === 'ready' || status === 'ok' || status === 'authenticated') return true;
      }
      if (isRecord(entry) || Array.isArray(entry)) queue.push(entry);
    }
  }
  return false;
}

function isFeishuCliProfileMissing(value: unknown) {
  const text = JSON.stringify(value || {}).toLowerCase();
  return (
    (text.includes('profile') || text.includes('instruction')) &&
    (text.includes('not found') ||
      text.includes('not exist') ||
      text.includes('missing') ||
      text.includes('instruction') ||
      text.includes('instruction'))
  );
}

async function ensureFeishuCliProfile(config: ServerConfig, profileName: string, cliHome?: string) {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error('FEISHU_APP_ID and FEISHU_APP_SECRET must be configured on personal-agent-server.');
  const result = await runLarkCli(config, ['profile', 'add', '--name', profileName, '--app-id', appId, '--app-secret-stdin', '--brand', 'feishu'], {
    profileName,
    cliHome,
    stdin: `${appSecret}\n`,
    allowFailure: true,
  });
  if (result.code !== 0 && !`${result.stderr}\n${result.stdout}`.toLowerCase().includes('already')) {
    throw new Error(`lark-cli profile add failed: ${truncate(result.stderr || result.stdout, 1000)}`);
  }
}

async function runLarkCliJson(config: ServerConfig, args: string[], options: RunOptions = {}): Promise<LarkCliJson> {
  const result = await runLarkCli(config, [
    ...(options.profileName ? ['--profile', options.profileName] : []),
    ...args,
  ], options);
  const raw = result.code === 0 ? result.stdout : result.stderr || result.stdout;
  const parsed = parseJsonEnvelope(raw);
  if (result.code !== 0 && !options.allowFailure) {
    throw new Error(`lark-cli ${args.join(' ')} failed: ${truncate(raw || `exit ${result.code}`, 1500)}`);
  }
  return parsed || {
    ok: result.code === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

async function runLarkCli(config: ServerConfig, args: string[], options: RunOptions = {}) {
  const cliHome = resolveLarkCliHome(config, options.profileName, options.cliHome);
  await fs.mkdir(cliHome, { recursive: true, mode: 0o700 });
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(config.larkCliBin, args, {
      cwd: cliHome,
      env: buildLarkCliEnv(config, cliHome),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`lark-cli timed out after ${options.timeoutMs || config.larkCliTimeoutMs}ms`));
    }, options.timeoutMs || config.larkCliTimeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        code: code || 0,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

async function withTemporaryFeishuCliHome<T>(
  config: ServerConfig,
  profileName: string,
  fn: (cliHome: string) => Promise<T>
) {
  const root = path.resolve(config.larkCliHomeRoot);
  const runtimeRoot = path.join(root, 'runtime');
  const normalized = normalizeProfileName(profileName) || 'profile';
  const cliHome = path.join(runtimeRoot, `${normalized}_${id('run').replace(/[^a-zA-Z0-9_-]/g, '')}`);
  await fs.mkdir(cliHome, { recursive: true, mode: 0o700 });
  try {
    return await fn(cliHome);
  } finally {
    await fs.rm(cliHome, { recursive: true, force: true }).catch(() => null);
  }
}

function resolveLarkCliHome(config: ServerConfig, profileName?: string, cliHome?: string) {
  if (cliHome) return path.resolve(cliHome);
  const root = path.resolve(config.larkCliHomeRoot);
  const normalized = profileName ? normalizeProfileName(profileName) : '';
  return normalized ? path.join(root, 'runtime', normalized) : root;
}

function buildLarkCliEnv(config: ServerConfig, cliHome: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: cliHome,
    XDG_CONFIG_HOME: path.join(cliHome, '.config'),
    XDG_CACHE_HOME: path.join(cliHome, '.cache'),
    npm_config_cache: path.join(cliHome, '.npm'),
    CI: '1',
    NO_UPDATE_NOTIFIER: '1',
  };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    delete env[key];
  }
  if (config.larkCliProxyUrl) {
    env.HTTP_PROXY = config.larkCliProxyUrl;
    env.HTTPS_PROXY = config.larkCliProxyUrl;
    env.http_proxy = config.larkCliProxyUrl;
    env.https_proxy = config.larkCliProxyUrl;
  }
  return env;
}

async function collectSnapshotFiles(
  root: string,
  relativeDir: string,
  files: LarkCliProfileSnapshot['files'],
  budget: { totalBytes: number }
) {
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean; isSymbolicLink: () => boolean }>;
  try {
    entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (SNAPSHOT_EXCLUDED_NAMES.has(entry.name) || entry.isSymbolicLink()) continue;
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      await collectSnapshotFiles(root, relativePath, files, budget);
      continue;
    }
    if (!entry.isFile()) continue;
    const fullPath = path.join(root, relativePath);
    const stat = await fs.stat(fullPath);
    if (stat.size > SNAPSHOT_MAX_FILE_BYTES) continue;
    if (files.length >= SNAPSHOT_MAX_FILES) throw new Error('lark-cli profile snapshot has too many files.');
    if (budget.totalBytes + stat.size > SNAPSHOT_MAX_TOTAL_BYTES) throw new Error('lark-cli profile snapshot is too large.');
    const content = await fs.readFile(fullPath);
    budget.totalBytes += content.length;
    files.push({
      path: relativePath.split(path.sep).join('/'),
      contentBase64: content.toString('base64'),
      mode: stat.mode & 0o777,
    });
  }
}

function normalizeSnapshotPath(value: string) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const normalized = path.normalize(value.replace(/\\/g, '/'));
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) return '';
  return normalized;
}

function parseJsonEnvelope(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as LarkCliJson;
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as LarkCliJson;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function findFirstString(value: unknown, keys: string[], pattern?: RegExp): string {
  const found = findValue(value, keys, (item) => typeof item === 'string' && (!pattern || pattern.test(item)));
  return typeof found === 'string' ? found : '';
}

function findFirstNumber(value: unknown, keys: string[]): number | null {
  const found = findValue(value, keys, (item) => typeof item === 'number' && Number.isFinite(item));
  return typeof found === 'number' ? found : null;
}

function findStringArray(value: unknown, keys: string[]) {
  const found = findValue(value, keys, (item) => (
    Array.isArray(item) && item.every((entry) => typeof entry === 'string')
  ) || typeof item === 'string');
  if (typeof found === 'string') return found.split(/\s+|,/).map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(found)) return found.map(String);
  return null;
}

function findValue(value: unknown, keys: string[], predicate: (value: unknown) => boolean): unknown {
  const queue = [value];
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (!isRecord(current)) continue;
    for (const [key, entry] of Object.entries(current)) {
      if (wanted.has(key.toLowerCase()) && predicate(entry)) return entry;
      if (isRecord(entry) || Array.isArray(entry)) queue.push(entry);
    }
  }
  return undefined;
}
