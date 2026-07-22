import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import { getInvestorOrNull } from '@/lib/investor-auth';
import { prisma } from '@/lib/prisma';
import {
  appendThreadMessage,
  appendtoolCall,
  createThread,
  ensureThread,
  getLatestThreadWithMessages,
  getThreadMessagesPage,
  listAgentThreads,
  renameAgentThread,
  toClientMessages,
  updateAgentThreadStatus,
  type AgentThreadStatus,
} from '@/lib/agent-session';

export const maxDuration = 800;

const PERSONAL_AGENT_TYPE = 'PERSONAL';
const DEFAULT_MULTIMODAL_MAX_FILES = 6;
const DEFAULT_MULTIMODAL_MAX_FILE_BYTES = 20 * 1024 * 1024;
const PERSONAL_AGENT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_HERMES_MODEL = 'claude-sonnet-4-6';

type ClientMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  artifacts?: ClientArtifact[];
};

type ClientArtifact = {
  id?: string;
  name: string;
  kind?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  downloadPath: string;
};

type PersonalAgentResponse = {
  route?: string;
  reply?: string;
  events?: unknown[];
  raw?: unknown;
  runId?: string;
  error?: string;
};

type CompetitorDatatoolAudit = {
  toolName: string;
  toolArgs: unknown;
  eventType: string;
  timestamp?: string;
};

type PersonalAgentStreamResult = PersonalAgentResponse & {
  threadId?: string;
  cancelled?: boolean;
  error?: string;
};

type AttachmentKind = 'image' | 'video' | 'pdf' | 'document' | 'file';

type UploadedAttachment = {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  kind: AttachmentKind;
};

type UploadedArtifactRef = {
  id: string;
  name: string;
  type: string;
  size: number;
  kind: AttachmentKind;
  downloadPath?: string | null;
};

type ConnectorScope = {
  enabledConnectorKeys: string[];
  enabledConnectionIds: string[];
};

type ParsedPostBody = {
  threadId?: string | null;
  messages: ClientMessage[];
  userMessage: string;
  displayUserMessage: string;
  clientRequestId?: string | null;
  hermesModel: 'deepseek/deepseek-v3.2' | typeof DEFAULT_HERMES_MODEL;
  attachments: UploadedAttachment[];
  uploadedArtifacts: UploadedArtifactRef[];
  connectorScope: ConnectorScope;
};

function normalizeHermesModel(value: unknown): ParsedPostBody['hermesModel'] {
  if (typeof value !== 'string') return DEFAULT_HERMES_MODEL;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'claude-sonnet-4-6' ||
    normalized === 'claude-sonnet-4.6' ||
    normalized === 'sonnet-4-6' ||
    normalized === 'sonnet-4.6'
  ) {
    return 'claude-sonnet-4-6';
  }
  if (
    normalized === 'deepseek/deepseek-v3.2' ||
    normalized === 'deepseek-v3.2' ||
    normalized === 'deepseek3.2'
  ) {
    return 'deepseek/deepseek-v3.2';
  }
  return DEFAULT_HERMES_MODEL;
}

function normalizeClientRequestId(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9._:-]{8,160}$/.test(trimmed) ? trimmed : null;
}

function normalizeStringArray(value: unknown, options: { lowercase: boolean }) {
  if (!Array.isArray(value)) return undefined;
  return Array.from(new Set(
    value
      .map((item) => {
        if (typeof item !== 'string') return '';
        const trimmed = item.trim();
        return options.lowercase ? trimmed.toLowerCase() : trimmed;
      })
      .filter(Boolean)
  ));
}

function normalizeConnectorScope(value: unknown): ConnectorScope {
  if (!isRecord(value)) return createEmptyConnectorScope();
  const enabledConnectorKeys = normalizeStringArray(value.enabledConnectorKeys, { lowercase: true });
  const enabledConnectionIds = normalizeStringArray(value.enabledConnectionIds, { lowercase: false });
  return {
    enabledConnectorKeys: enabledConnectorKeys || [],
    enabledConnectionIds: enabledConnectionIds || [],
  };
}

function createEmptyConnectorScope(): ConnectorScope {
  return {
    enabledConnectorKeys: [],
    enabledConnectionIds: [],
  };
}

function normalizeUploadedArtifacts(value: unknown): UploadedArtifactRef[] {
  if (!Array.isArray(value)) return [];
  const artifacts: UploadedArtifactRef[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'attachment';
    const type = inferMimeType(name, typeof item.type === 'string' ? item.type : typeof item.mimeType === 'string' ? item.mimeType : '');
    const size = typeof item.size === 'number'
      ? item.size
      : typeof item.sizeBytes === 'number'
        ? item.sizeBytes
        : 0;
    if (!id) continue;
    artifacts.push({
      id,
      name,
      type,
      size: Number.isFinite(size) && size > 0 ? Math.floor(size) : 0,
      kind: getAttachmentKind(name, type),
      downloadPath: typeof item.downloadPath === 'string' ? item.downloadPath : null,
    });
  }
  return artifacts;
}

function parseConnectorScopeJson(value: string) {
  if (!value) return createEmptyConnectorScope();
  try {
    return normalizeConnectorScope(JSON.parse(value) as unknown);
  } catch {
    throw Object.assign(new Error('connectorScope must be valid JSON.'), { status: 400 });
  }
}

function getPersonalAgentServerUrl() {
  return (process.env.PERSONAL_AGENT_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
}

function stableRunIdFromMessageId(messageId: string | null | undefined) {
  if (!messageId) return undefined;
  return `run_${messageId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function describeFetchError(error: unknown) {
  const base = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && 'cause' in error ? (error as { cause?: unknown }).cause : null;
  if (!isRecord(cause)) return base;
  const details = ['code', 'errno', 'syscall', 'address', 'port']
    .map((key) => {
      const value = cause[key];
      return typeof value === 'string' || typeof value === 'number' ? `${key}=${value}` : '';
    })
    .filter(Boolean);
  return details.length > 0 ? `${base} (${details.join(', ')})` : base;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPersonalAgentServerJson<T>(
  path: string,
  init: RequestInit,
  options?: { attempts?: number; timeoutMs?: number }
) {
  const url = `${getPersonalAgentServerUrl()}${path}`;
  const attempts = Math.max(1, Math.floor(options?.attempts || 1));
  const timeoutMs = Math.max(1_000, Math.floor(options?.timeoutMs || PERSONAL_AGENT_FETCH_TIMEOUT_MS));
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as T;
      return { response, data, url, attempt };
    } catch (error) {
      lastError = error;
      console.error('[personal-agent] upstream fetch failed', {
        path,
        url,
        attempt,
        attempts,
        detail: describeFetchError(error),
      });
      if (attempt < attempts) await wait(600 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(describeFetchError(lastError));
}

function getOpenRouterMultimodalMaxFiles() {
  const parsed = Number(process.env.OPENROUTER_MULTIMODAL_MAX_FILES || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MULTIMODAL_MAX_FILES;
}

function getOpenRouterMultimodalMaxFileBytes() {
  const parsed = Number(process.env.OPENROUTER_MULTIMODAL_MAX_FILE_BYTES || '');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MULTIMODAL_MAX_FILE_BYTES;
}

function normalizeMessages(value: unknown): ClientMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null;
      const content = typeof record.content === 'string' ? record.content.trim() : '';
      if (!role || !content) return null;
      return {
        ...(typeof record.id === 'string' ? { id: record.id } : {}),
        role,
        content,
        ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
      };
    })
    .filter(Boolean) as ClientMessage[];
}

function latestUserMessage(messages: ClientMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content.trim() || '';
}

function getStringFormValue(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseMessagesJson(value: string) {
  if (!value) return [];
  try {
    return normalizeMessages(JSON.parse(value) as unknown);
  } catch {
    throw Object.assign(new Error('messages must be valid JSON.'), { status: 400 });
  }
}

function inferMimeType(name: string, providedType: string) {
  const lowerName = name.toLowerCase();
  const normalizedType = providedType.trim().toLowerCase();
  if (normalizedType === 'video/quicktime') return 'video/mov';
  if (normalizedType) return normalizedType;
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.mp4')) return 'video/mp4';
  if (lowerName.endsWith('.mpeg') || lowerName.endsWith('.mpg')) return 'video/mpeg';
  if (lowerName.endsWith('.mov')) return 'video/mov';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

function getAttachmentKind(name: string, mimeType: string): AttachmentKind {
  const lowerName = name.toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.doc') ||
    lowerName.endsWith('.docx')
  ) {
    return 'document';
  }
  return 'file';
}

async function fileToAttachment(file: File): Promise<UploadedAttachment> {
  const type = inferMimeType(file.name || 'attachment', file.type || '');
  const buffer = Buffer.from(await file.arrayBuffer());
  return {
    name: file.name || 'attachment',
    type,
    size: file.size,
    dataUrl: `data:${type};base64,${buffer.toString('base64')}`,
    kind: getAttachmentKind(file.name || 'attachment', type),
  };
}

async function parsePostBody(req: NextRequest): Promise<ParsedPostBody> {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    const body = (await req.json().catch(() => ({}))) as {
      threadId?: string | null;
      message?: unknown;
      displayMessage?: unknown;
      messages?: unknown;
      hermesModel?: unknown;
      clientRequestId?: unknown;
      connectorScope?: unknown;
      uploadedArtifacts?: unknown;
    };
    const messages = normalizeMessages(body.messages);
    const explicitMessage = typeof body.message === 'string' ? body.message.trim() : '';
    const displayMessage = typeof body.displayMessage === 'string' ? body.displayMessage.trim() : '';
    const uploadedArtifacts = normalizeUploadedArtifacts(body.uploadedArtifacts);
    const userMessage = explicitMessage || latestUserMessage(messages) || (uploadedArtifacts.length > 0 ? 'Please analyze the attached files.' : '');
    return {
      threadId: body.threadId || null,
      messages: userMessage ? [{ role: 'user', content: userMessage }] : messages,
      userMessage,
      displayUserMessage: displayMessage || userMessage,
      clientRequestId: normalizeClientRequestId(body.clientRequestId),
      hermesModel: normalizeHermesModel(body.hermesModel),
      attachments: [],
      uploadedArtifacts,
      connectorScope: normalizeConnectorScope(body.connectorScope),
    };
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw Object.assign(
      new Error('Upload failed. For PDFs and large files, use the running Next.js server and keep each file under the configured size limit.'),
      { status: 413 }
    );
  }
  const explicitMessage = getStringFormValue(form.get('message'));
  const displayMessage = getStringFormValue(form.get('displayMessage'));
  const rawMessages = getStringFormValue(form.get('messages'));
  const messages = parseMessagesJson(rawMessages);
  const maxFiles = getOpenRouterMultimodalMaxFiles();
  const maxFileBytes = getOpenRouterMultimodalMaxFileBytes();
  const files = form
    .getAll('attachments')
    .filter((value): value is File => typeof File !== 'undefined' && value instanceof File && value.size > 0);

  if (files.length > maxFiles) {
    throw Object.assign(new Error(`You can attach up to ${maxFiles} files.`), { status: 400 });
  }

  const oversized = files.find((file) => file.size > maxFileBytes);
  if (oversized) {
    throw Object.assign(new Error(`${oversized.name} exceeds the configured file size limit.`), { status: 400 });
  }

  const attachments = await Promise.all(files.map(fileToAttachment));
  const fallbackMessage = attachments.length > 0 ? 'Please analyze the attached files.' : '';
  const userMessage = explicitMessage || latestUserMessage(messages) || fallbackMessage;
  const displayUserMessage = displayMessage || latestUserMessage(messages) || userMessage;

  return {
    threadId: getStringFormValue(form.get('threadId')) || null,
    messages: [{ role: 'user', content: userMessage }],
    userMessage,
    displayUserMessage,
    clientRequestId: normalizeClientRequestId(getStringFormValue(form.get('clientRequestId'))),
    hermesModel: normalizeHermesModel(getStringFormValue(form.get('hermesModel'))),
    attachments,
    uploadedArtifacts: [],
    connectorScope: parseConnectorScopeJson(getStringFormValue(form.get('connectorScope'))),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getAttachmentMetadata(attachments: UploadedAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
  }));
}

function getUploadedArtifactMetadata(artifacts: UploadedArtifactRef[]) {
  return artifacts.map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    type: artifact.type,
    size: artifact.size,
    kind: artifact.kind,
    ...(artifact.downloadPath ? { downloadPath: artifact.downloadPath } : {}),
  }));
}

function getWorkspaceArtifactRefs(artifacts: UploadedArtifactRef[]) {
  return artifacts.map((artifact) => ({
    id: artifact.id,
    name: artifact.name,
    type: artifact.type,
    size: artifact.size,
    kind: artifact.kind,
  }));
}

function getAttachmentPayloads(attachments: UploadedAttachment[]) {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type,
    size: attachment.size,
    kind: attachment.kind,
    dataUrl: attachment.dataUrl,
  }));
}

const COMPETITOR_DATA_TOOL_NAMES = new Set([
  'altselfs_similarweb_api1',
  'altselfs_semrush13',
  'altselfs_semrush8',
  'altselfs_domain_metrics_check',
]);

function extractCompetitorDatatoolAudit(event: unknown): CompetitorDatatoolAudit | null {
  if (!isRecord(event)) return null;
  const eventType = typeof event.type === 'string' ? event.type : '';
  const payload = isRecord(event.payload) ? event.payload : {};
  const request = isRecord(payload.request) ? payload.request : {};
  const params = isRecord(request.params) ? request.params : {};
  const namespace = typeof params.namespace === 'string' ? params.namespace : '';
  const tool = typeof params.tool === 'string' ? params.tool : '';
  if (namespace || !COMPETITOR_DATA_TOOL_NAMES.has(tool)) return null;
  return {
    toolName: tool.replace(/^altselfs_/, ''),
    toolArgs: params.arguments,
    eventType,
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
  };
}

async function persistCompetitorDatatoolAudits(params: {
  threadId: string;
  messageId: string | null;
  events: unknown[] | undefined;
}) {
  const audits = (params.events || [])
    .map(extractCompetitorDatatoolAudit)
    .filter((audit): audit is CompetitorDatatoolAudit => Boolean(audit));
  for (const audit of audits) {
    await appendtoolCall({
      threadId: params.threadId,
      messageId: params.messageId,
      toolName: audit.toolName,
      status: 'SUCCESS',
      toolArgs: audit.toolArgs,
      toolResult: {
        source: 'personal-agent-server-event',
        eventType: audit.eventType,
        timestamp: audit.timestamp,
      },
    });
  }
}


function buildCurrentTurnMessage(messages: ClientMessage[]) {
  return latestUserMessage(messages);
}

function displayMessages(messages: ClientMessage[]) {
  return messages.map((message) => ({
    ...(message.id ? { id: message.id } : {}),
    role: message.role,
    content: message.content,
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message.artifacts && message.artifacts.length > 0 ? { artifacts: message.artifacts } : {}),
  }));
}

function extractGeneratedArtifacts(raw: unknown): ClientArtifact[] {
  const record = isRecord(raw) ? raw : {};
  const generated = Array.isArray(record.generatedArtifacts) ? record.generatedArtifacts : [];
  const artifacts: ClientArtifact[] = [];
  for (const item of generated) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'artifact';
    const downloadPath = typeof item.downloadPath === 'string' ? item.downloadPath.trim() : '';
    if (!downloadPath) continue;
    artifacts.push({
      id: typeof item.id === 'string' ? item.id : undefined,
      name,
      kind: typeof item.kind === 'string' ? item.kind : null,
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : null,
      sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : null,
      downloadPath,
    });
  }
  return artifacts;
}

function storedRunEventToAgentEvent(row: unknown) {
  if (!isRecord(row)) return null;
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    type: typeof row.type === 'string' ? row.type : 'agent_context.event',
    timestamp: typeof payload.timestamp === 'string'
      ? payload.timestamp
      : typeof row.created_at === 'string'
        ? row.created_at
        : new Date().toISOString(),
    payload: isRecord(payload.payload) ? payload.payload : {},
  };
}

function normalizeTerminalRun(value: unknown) {
  if (!isRecord(value)) return null;
  const status = typeof value.status === 'string' ? value.status : '';
  if (!['SUCCESS', 'ERROR', 'CANCELLED', 'TIMEOUT'].includes(status)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  if (!id) return null;
  return {
    id,
    status,
    route: typeof value.route === 'string' ? value.route : undefined,
    result: isRecord(value.result) ? value.result : {},
    error: typeof value.error === 'string' ? value.error : '',
  };
}

async function syncTerminalPersonalAgentRun(params: {
  threadId: string;
  statusPayload: Record<string, unknown>;
}) {
  const activeRun = normalizeTerminalRun(params.statusPayload.activeRun);
  const recentRuns = Array.isArray(params.statusPayload.recentRuns)
    ? params.statusPayload.recentRuns.map(normalizeTerminalRun).filter(Boolean)
    : [];
  const terminalRun = activeRun || recentRuns[0];
  if (!terminalRun) return false;

  const reply = terminalRun.status === 'SUCCESS'
    ? (typeof terminalRun.result.reply === 'string' && terminalRun.result.reply.trim()
        ? terminalRun.result.reply.trim()
        : 'Agent run completed, but no reply was returned.')
    : terminalRun.status === 'CANCELLED'
      ? 'Run stopped.'
      : terminalRun.status === 'TIMEOUT'
        ? `Run timed out: ${terminalRun.error || 'Unknown timeout error'}`
      : `Execution failed: ${terminalRun.error || 'Send failed'}`;

  const existingMessages = await prisma.agentMessage.findMany({
    where: {
      threadId: params.threadId,
      role: 'ASSISTANT',
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 30,
  });
  const alreadySynced = existingMessages.some((message) => {
    const meta = isRecord(message.meta) ? message.meta : {};
    return meta.runId === terminalRun.id || message.content.trim() === reply;
  });
  if (alreadySynced) return false;

  await appendThreadMessage({
    threadId: params.threadId,
    role: 'ASSISTANT',
    content: reply,
    meta: {
      route: terminalRun.route || (typeof terminalRun.result.route === 'string' ? terminalRun.result.route : undefined),
      raw: terminalRun.result.raw ?? null,
      runId: terminalRun.id,
      error: terminalRun.status === 'ERROR' ? terminalRun.error || 'Send failed' : undefined,
      cancelled: terminalRun.status === 'CANCELLED' || undefined,
      source: 'personal-agent-async',
    },
  });

  const recentEvents = Array.isArray(params.statusPayload.recentEvents)
    ? params.statusPayload.recentEvents.map(storedRunEventToAgentEvent).filter(Boolean)
    : [];
  await persistCompetitorDatatoolAudits({
    threadId: params.threadId,
    messageId: null,
    events: recentEvents,
  });
  return true;
}

async function getEnabledInfoSources(investorId: string) {
  const providerMap: Record<string, string> = {
    SIMILARWEB_API1: 'similarweb_api1',
    SEMRUSH13: 'semrush13',
    SEMRUSH8: 'semrush8',
    DOMAIN_METRICS_CHECK: 'domain_metrics_check',
  };
  const integrations = await prisma.investorIntegration.findMany({
    where: {
      investorId,
      status: 'CONNECTED',
      provider: {
        in: Object.keys(providerMap),
      },
    },
    select: {
      provider: true,
      updatedAt: true,
    },
  });

  return integrations.map((integration) => ({
    provider: providerMap[integration.provider] || integration.provider.toLowerCase(),
    enabledAt: integration.updatedAt.toISOString(),
  }));
}

function applyConnectorScopeToInfoSources(
  enabledInfoSources: Awaited<ReturnType<typeof getEnabledInfoSources>>,
  connectorScope: ConnectorScope
) {
  const allowed = new Set(connectorScope.enabledConnectorKeys);
  return enabledInfoSources.filter((source) => allowed.has(source.provider));
}

export async function GET(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requestedThreadId = req.nextUrl.searchParams.get('threadId')?.trim();
  const includeSessions = req.nextUrl.searchParams.get('sessions') === '1';
  const sessionStatusParam = req.nextUrl.searchParams.get('sessionStatus')?.trim().toLowerCase();
  const sessionStatus: AgentThreadStatus = sessionStatusParam === 'archived' ? 'ARCHIVED' : 'ACTIVE';
  const sessions = includeSessions ? await listAgentThreads(investor.id, PERSONAL_AGENT_TYPE, 100, sessionStatus) : undefined;
  const statusRequested = req.nextUrl.searchParams.get('status') === '1';
  if (statusRequested) {
    const thread = requestedThreadId
      ? await getThreadMessagesPage({
          investorId: investor.id,
          agentType: PERSONAL_AGENT_TYPE,
          threadId: requestedThreadId,
          limit: 60,
        })
      : await getLatestThreadWithMessages(investor.id, PERSONAL_AGENT_TYPE);
    const threadId = requestedThreadId || (thread && 'id' in thread ? thread.id : null);
    const statusMessages = thread && Array.isArray(thread.messages) ? toClientMessages(thread.messages) : [];
    const statusHasMore = thread
      ? 'hasMore' in thread
        ? Boolean(thread.hasMore)
        : '_count' in thread
          ? thread._count.messages > thread.messages.length
          : false
      : false;
    if (!threadId || !thread) {
      return NextResponse.json({
        threadId: threadId || null,
        status: 'IDLE',
        activeRunId: null,
        activeSessionId: null,
        diskBytes: null,
        recentEvents: [],
        messages: [],
        hasMore: false,
        ...(sessions ? { sessions } : {}),
      });
    }

    try {
      const query = new URLSearchParams({
        threadId,
        investorId: investor.id,
        userId: investor.email || investor.id,
        recentEventLimit: '100',
      });
      const runId = req.nextUrl.searchParams.get('runId')?.trim();
      if (runId) query.set('runId', runId);
      const response = await fetch(`${getPersonalAgentServerUrl()}/v1/threads/status?${query.toString()}`, {
        cache: 'no-store',
      });
      const statusPayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        return NextResponse.json(
          { error: typeof statusPayload.error === 'string' ? statusPayload.error : `personal-agent-server HTTP ${response.status}` },
          { status: 502 }
        );
      }
      const syncedTerminalRun = await syncTerminalPersonalAgentRun({
        threadId,
        statusPayload,
      }).catch(() => false);
      const nextThreadPage = syncedTerminalRun
        ? await getThreadMessagesPage({
            investorId: investor.id,
            agentType: PERSONAL_AGENT_TYPE,
            threadId,
            limit: 60,
          }).catch(() => null)
        : null;
      const nextMessages = nextThreadPage
        ? toClientMessages(nextThreadPage.messages)
        : statusMessages;
      return NextResponse.json({
        threadId,
        ...statusPayload,
        messages: nextMessages,
        hasMore: nextThreadPage ? nextThreadPage.hasMore : statusHasMore,
        ...(sessions ? { sessions } : {}),
      });
    } catch (error) {
      return NextResponse.json(
        { error: `Personal Agent status check failed: ${error instanceof Error ? error.message : String(error)}` },
        { status: 502 }
      );
    }
  }

  if (requestedThreadId) {
    const beforeMessageId = req.nextUrl.searchParams.get('before')?.trim() || null;
    const parsedLimit = Number(req.nextUrl.searchParams.get('limit') || '');
    const page = await getThreadMessagesPage({
      investorId: investor.id,
      agentType: PERSONAL_AGENT_TYPE,
      threadId: requestedThreadId,
      beforeMessageId,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 60,
    });

    if (!page) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });

    return NextResponse.json({
      threadId: requestedThreadId,
      messages: toClientMessages(page.messages),
      hasMore: page.hasMore,
      nextBefore: page.nextBeforeMessageId,
      ...(sessions ? { sessions } : {}),
    });
  }

  const thread = await getLatestThreadWithMessages(investor.id, PERSONAL_AGENT_TYPE);
  return NextResponse.json({
    threadId: thread?.id || null,
    messages: thread ? toClientMessages(thread.messages) : [],
    hasMore: thread ? thread._count.messages > thread.messages.length : false,
    ...(sessions ? { sessions } : {}),
  });
}

export async function PUT(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { title?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const thread = await createThread({
    investorId: investor.id,
    agentType: PERSONAL_AGENT_TYPE,
    title: title || 'New discussion',
  });
  const sessions = await listAgentThreads(investor.id, PERSONAL_AGENT_TYPE);

  return NextResponse.json({
    threadId: thread.id,
    messages: [],
    hasMore: false,
    sessions,
  });
}

export async function PATCH(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    threadId?: unknown;
    title?: unknown;
  };
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  if (!threadId) return NextResponse.json({ error: 'threadId is required' }, { status: 400 });

  try {
    if (action === 'rename') {
      const title = typeof body.title === 'string' ? body.title : '';
      await renameAgentThread({
        investorId: investor.id,
        agentType: PERSONAL_AGENT_TYPE,
        threadId,
        title,
      });
    } else if (action === 'archive') {
      await updateAgentThreadStatus({
        investorId: investor.id,
        agentType: PERSONAL_AGENT_TYPE,
        threadId,
        status: 'ARCHIVED',
      });
    } else if (action === 'unarchive') {
      await updateAgentThreadStatus({
        investorId: investor.id,
        agentType: PERSONAL_AGENT_TYPE,
        threadId,
        status: 'ACTIVE',
      });
    } else if (action === 'delete' || action === 'permanent_delete') {
      await updateAgentThreadStatus({
        investorId: investor.id,
        agentType: PERSONAL_AGENT_TYPE,
        threadId,
        status: 'DELETED',
      });
    } else {
      return NextResponse.json({ error: 'Unsupported thread action.' }, { status: 400 });
    }

    const [sessions, archivedSessions] = await Promise.all([
      listAgentThreads(investor.id, PERSONAL_AGENT_TYPE, 100, 'ACTIVE'),
      listAgentThreads(investor.id, PERSONAL_AGENT_TYPE, 100, 'ARCHIVED'),
    ]);

    return NextResponse.json({ ok: true, sessions, archivedSessions });
  } catch (error) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update thread.' },
      { status }
    );
  }
}

export async function POST(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let parsedBody: ParsedPostBody;
  try {
    parsedBody = await parsePostBody(req);
  } catch (error) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 400;
    const detail = error instanceof Error ? error.message : 'Invalid request';
    return NextResponse.json({ error: detail }, { status });
  }

  const { messages, userMessage, displayUserMessage, attachments, uploadedArtifacts, hermesModel, connectorScope } = parsedBody;
  if (!userMessage && attachments.length === 0 && uploadedArtifacts.length === 0) {
    return NextResponse.json({ error: 'Message or attachment is required.' }, { status: 400 });
  }

  let thread: Awaited<ReturnType<typeof ensureThread>>;
  try {
    thread = await ensureThread({
      investorId: investor.id,
      agentType: PERSONAL_AGENT_TYPE,
      threadId: parsedBody.threadId || null,
    });
  } catch (error) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Thread is unavailable.' },
      { status }
    );
  }

  const persistedUserContent = displayUserMessage || userMessage;
  const userMessageMeta = {
    ...(parsedBody.clientRequestId ? { clientRequestId: parsedBody.clientRequestId } : {}),
    connectorScope,
    ...(uploadedArtifacts.length > 0
      ? {
          attachments: getUploadedArtifactMetadata(uploadedArtifacts),
          storedInObjectStorage: true,
          storedInAgentWorkspace: false,
        }
      : {}),
    ...(attachments.length > 0
      ? {
          attachments: getAttachmentMetadata(attachments),
          storedInAgentWorkspace: true,
        }
      : {}),
  };
  const existingUserThreadMessage = parsedBody.clientRequestId
    ? await prisma.agentMessage.findFirst({
        where: {
          threadId: thread.id,
          role: 'USER',
          content: persistedUserContent,
          meta: {
            path: ['clientRequestId'],
            equals: parsedBody.clientRequestId,
          },
        },
        orderBy: { createdAt: 'asc' },
      })
    : null;

  const userThreadMessage = existingUserThreadMessage || await appendThreadMessage({
    threadId: thread.id,
    role: 'USER',
    content: persistedUserContent,
    meta: Object.keys(userMessageMeta).length > 0 ? userMessageMeta : undefined,
  });
  const enabledInfoSources = applyConnectorScopeToInfoSources(await getEnabledInfoSources(investor.id), connectorScope);

  const payload = {
    userId: investor.email || investor.id,
    threadId: thread.id,
    message: buildCurrentTurnMessage(messages),
    allowedAgents: ['codex-general', 'codex-competitive-intelligence'],
    metadata: {
      currentMessageId: userThreadMessage.id,
      investorId: investor.id,
      contextMode: 'ecs_database_context',
      currentUserMessage: userMessage,
      displayUserMessage: displayUserMessage || userMessage,
      currentMessageMetadata: userMessageMeta,
      attachments: uploadedArtifacts.length > 0 ? getUploadedArtifactMetadata(uploadedArtifacts) : getAttachmentMetadata(attachments),
      workspaceArtifactRefs: getWorkspaceArtifactRefs(uploadedArtifacts),
      workspaceAttachments: getAttachmentPayloads(attachments),
      enabledInfoSources,
      connectorScope,
      hermesModel,
      runId: stableRunIdFromMessageId(userThreadMessage.id),
    },
  };

  if (req.nextUrl.searchParams.get('async') === '1') {
    let result: PersonalAgentResponse & { status?: string; pollIntervalMs?: number };
    try {
      const { response, data } = await fetchPersonalAgentServerJson<PersonalAgentResponse & { status?: string; pollIntervalMs?: number }>(
        '/v1/turns/start-async',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { attempts: 2 }
      );
      result = data;
      if (!response.ok) {
        return NextResponse.json(
          { error: result.error || `personal-agent-server HTTP ${response.status}` },
          { status: 502 }
        );
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: `Personal Agent request failed: ${detail}` }, { status: 502 });
    }

    const [page, sessions] = await Promise.all([
      getThreadMessagesPage({
        investorId: investor.id,
        agentType: PERSONAL_AGENT_TYPE,
        threadId: thread.id,
        limit: 60,
      }),
      listAgentThreads(investor.id, PERSONAL_AGENT_TYPE),
    ]);

    return NextResponse.json(
      {
        threadId: thread.id,
        runId: result.runId,
        status: result.status || 'RUNNING',
        pollIntervalMs: typeof result.pollIntervalMs === 'number' ? result.pollIntervalMs : 3000,
        messages: page ? toClientMessages(page.messages) : displayMessages([...messages]),
        hasMore: page ? page.hasMore : false,
        sessions,
      },
      { status: 202 }
    );
  }

  if (req.nextUrl.searchParams.get('stream') === '1') {
    return streamPersonalAgentTurn({
      threadId: thread.id,
      investorId: investor.id,
      userMessageId: userThreadMessage.id,
      userMessage,
      payload,
      messages,
    });
  }

  let result: PersonalAgentResponse;
  try {
    const response = await fetch(`${getPersonalAgentServerUrl()}/v1/turns/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, includeEvents: true }),
      cache: 'no-store',
    });
    result = (await response.json().catch(() => ({}))) as PersonalAgentResponse;
    if (!response.ok) {
      return NextResponse.json(
        { error: result.error || `personal-agent-server HTTP ${response.status}` },
        { status: 502 }
      );
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Personal Agent request failed: ${detail}` }, { status: 502 });
  }

  const reply = typeof result.reply === 'string' && result.reply.trim()
    ? result.reply.trim()
    : 'Agent run completed, but no reply was returned.';
  const generatedArtifacts = extractGeneratedArtifacts(result.raw);

  await appendThreadMessage({
    threadId: thread.id,
    role: 'ASSISTANT',
    content: reply,
    meta: {
      route: result.route,
      raw: result.raw,
    },
  });
  await persistCompetitorDatatoolAudits({
    threadId: thread.id,
    messageId: userThreadMessage.id,
    events: Array.isArray(result.events) ? result.events : [],
  });
  const sessions = await listAgentThreads(investor.id, PERSONAL_AGENT_TYPE);

  return NextResponse.json({
    threadId: thread.id,
    runId: result.runId,
    reply,
    route: result.route,
    messages: displayMessages([...messages, { role: 'assistant', content: reply, artifacts: generatedArtifacts }]),
    sessions,
  });
}

export async function DELETE(req: NextRequest) {
  const investor = await getInvestorOrNull();
  if (!investor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { runId?: unknown; threadId?: unknown };
  const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
  const threadId = typeof body.threadId === 'string' ? body.threadId.trim() : '';
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  if (threadId) {
    const thread = await getThreadMessagesPage({
      investorId: investor.id,
      agentType: PERSONAL_AGENT_TYPE,
      threadId,
      limit: 1,
    });
    if (!thread) return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
  }

  try {
    const response = await fetch(`${getPersonalAgentServerUrl()}/v1/runs/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId,
        threadId: threadId || undefined,
        investorId: investor.id,
        userId: investor.email || investor.id,
      }),
      cache: 'no-store',
    });
    const result = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { error: typeof result.error === 'string' ? result.error : `personal-agent-server HTTP ${response.status}` },
        { status: 502 }
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to stop Personal Agent run: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 }
    );
  }
}

function streamPersonalAgentTurn(params: {
  threadId: string;
  investorId: string;
  userMessageId: string | null;
  userMessage: string;
  payload: {
    userId: string;
    threadId: string;
    message: string;
    allowedAgents: string[];
    metadata: Record<string, unknown>;
  };
  messages: ClientMessage[];
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const write = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The client may have disconnected after receiving the final event.
        }
      };

      void (async () => {
        let finalResult: PersonalAgentStreamResult | null = null;
        const competitorDataEvents: unknown[] = [];
        try {
          write({ type: 'turn_started', timestamp: new Date().toISOString() });
          const response = await fetch(`${getPersonalAgentServerUrl()}/v1/turns/start?stream=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params.payload),
            cache: 'no-store',
          });

          if (!response.ok || !response.body) {
            const errorPayload = (await response.json().catch(() => ({}))) as PersonalAgentResponse;
            write({
              type: 'final',
              status: response.ok ? 500 : response.status,
              data: { error: errorPayload.error || `personal-agent-server HTTP ${response.status}` },
            });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              const parsed = parseStreamLine(line);
              if (!parsed) continue;
              if (parsed.type === 'final' && isRecord(parsed.result)) {
                finalResult = parsed.result as PersonalAgentStreamResult;
                continue;
              }
              if (parsed.type === 'event' && isRecord(parsed.event) && extractCompetitorDatatoolAudit(parsed.event)) {
                competitorDataEvents.push(parsed.event);
              }
              write(parsed);
            }
          }

          if (buffer.trim()) {
            const parsed = parseStreamLine(buffer);
            if (parsed?.type === 'final' && isRecord(parsed.result)) {
              finalResult = parsed.result as PersonalAgentStreamResult;
            } else if (parsed?.type === 'event' && isRecord(parsed.event) && extractCompetitorDatatoolAudit(parsed.event)) {
              competitorDataEvents.push(parsed.event);
              write(parsed);
            } else if (parsed) {
              write(parsed);
            }
          }

          const reply = typeof finalResult?.reply === 'string' && finalResult.reply.trim()
            ? finalResult.reply.trim()
            : 'Agent run completed, but no reply was returned.';
          const generatedArtifacts = extractGeneratedArtifacts(finalResult?.raw);

          if (finalResult?.cancelled || finalResult?.error) {
            const finalErrorMessage = finalResult.error || (finalResult.cancelled ? 'Run stopped.' : 'Send failed');
            const persistedErrorReply = finalResult.cancelled ? finalErrorMessage : `Execution failed: ${finalErrorMessage}`;
            await appendThreadMessage({
              threadId: params.threadId,
              role: 'ASSISTANT',
              content: persistedErrorReply,
              meta: {
                route: finalResult.route,
                raw: finalResult.raw,
                runId: finalResult.runId,
                error: finalErrorMessage,
                cancelled: Boolean(finalResult.cancelled),
              },
            }).catch(() => null);
            const page = await getThreadMessagesPage({
              investorId: params.investorId,
              agentType: PERSONAL_AGENT_TYPE,
              threadId: params.threadId,
              limit: 60,
            }).catch(() => null);
            const sessions = await listAgentThreads(params.investorId, PERSONAL_AGENT_TYPE).catch(() => []);

            write({
              type: 'final',
              status: finalResult.cancelled ? 499 : 500,
              data: {
                threadId: params.threadId,
                runId: finalResult.runId,
                cancelled: Boolean(finalResult.cancelled),
                error: finalErrorMessage,
                messages: page ? toClientMessages(page.messages) : displayMessages([...params.messages, { role: 'assistant', content: persistedErrorReply }]),
                sessions,
              },
            });
            return;
          }

          await appendThreadMessage({
            threadId: params.threadId,
            role: 'ASSISTANT',
            content: reply,
            meta: {
              route: finalResult?.route,
              raw: finalResult?.raw,
            },
          });
          await persistCompetitorDatatoolAudits({
            threadId: params.threadId,
            messageId: params.userMessageId,
            events: competitorDataEvents,
          });
          const sessions = await listAgentThreads(params.investorId, PERSONAL_AGENT_TYPE);

          write({
            type: 'final',
            status: 200,
            data: {
              threadId: params.threadId,
              runId: finalResult?.runId,
              reply,
              route: finalResult?.route,
              messages: displayMessages([...params.messages, { role: 'assistant', content: reply, artifacts: generatedArtifacts }]),
              sessions,
            },
          });
        } catch (error) {
          write({
            type: 'final',
            status: 502,
            data: {
              error: `Personal Agent request failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          });
        } finally {
          close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

function parseStreamLine(line: string) {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}
