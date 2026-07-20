'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Archive, CheckCircle2, ChevronDown, Download, ExternalLink, FileText, Film, ImageIcon, LoaderCircle, MessageSquare, MoreHorizontal, Paperclip, Pencil, Plug, Plus, Settings2, Square, Trash2, X } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FigmaShell } from '@/components/figma-shell';
import {
  EXECUTIVE_UPDATE_BRIEFING_PROMPT,
  ExecutiveDailyBriefingBrowser,
} from '@/components/executive-daily-briefing-browser';
import { MarkdownMessage } from '@/components/markdown-message';

type ChatMessage = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  artifacts?: ChatArtifact[];
};

type ChatArtifact = {
  id?: string;
  name: string;
  kind?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  downloadPath: string;
};

type AgentSessionSummary = {
  id: string;
  status?: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview?: string;
};

type PendingAttachmentKind = 'image' | 'video' | 'pdf' | 'document' | 'file';
type PendingAttachmentStatus = 'queued' | 'uploading' | 'uploaded' | 'error';

type PendingAttachment = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  kind: PendingAttachmentKind;
  uploadStatus: PendingAttachmentStatus;
  artifactId?: string;
  threadId?: string;
  downloadPath?: string | null;
  error?: string;
};

type DirectUploadArtifact = {
  id: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  downloadPath?: string | null;
  upload?: {
    method: 'POST';
    url: string;
    fields: Record<string, string>;
  };
};

type UploadPolicyResponse = {
  threadId?: string;
  artifacts?: DirectUploadArtifact[];
  error?: string;
};

type Briefing = {
  date: string;
  generatedTime: string;
  headline: string;
  departmentOverview: Array<{
    department: string;
    status: string;
    summary: string;
    progress: number;
  }>;
  priorityTasks: Array<{
    priority: 'high' | 'medium' | 'low';
    task: string;
    deadline: string;
    assignedBy: string;
  }>;
  externalInsights?: Array<{
    category: string;
    content: string;
    source: string;
  }>;
};

type PersistedBriefing = {
  dateKey: string;
  title: string;
  summary: string;
  sections: unknown;
  updatedAt?: string;
};

type AgentConfig = {
  systemPrompt: string;
  defaultSystemPrompt: string;
  hasCustomPrompt: boolean;
};

type PlannerStepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'ERROR' | 'SKIPPED';

type PlannerStep = {
  id: string;
  title: string;
  description: string;
  agentType?: string;
};

type PlannerTraceItem = PlannerStep & {
  status: PlannerStepStatus;
  detail?: string;
  error?: string;
  timestamp: string;
  payload?: unknown;
};

type ExecutiveRunPollResult = {
  runId?: string;
  status?: string;
  result?: unknown;
  error?: string | null;
  planner?: unknown;
  plannerTrace?: unknown;
  pollIntervalMs?: number;
};

type PersonalAgentFinalData = {
  threadId?: string;
  messages?: ChatMessage[];
  sessions?: AgentSessionSummary[];
  reply?: string;
  error?: string;
  runId?: string;
  cancelled?: boolean;
};

type CodexStreamItemStatus = 'running' | 'completed' | 'error';

type CodexStreamItem = {
  id: string;
  title: string;
  detail: string;
  status: CodexStreamItemStatus;
  timestamp: string;
  method?: string;
  content?: string;
};

type CompletedCodexActivity = {
  id: string;
  durationMs: number;
  items: CodexStreamItem[];
  completedAt: string;
};

type PersonalAgentStatusRecoveryResult = 'active' | 'success' | 'terminal' | 'idle' | 'unavailable';
type PersonalAgentStreamRecoveryResult = 'active' | 'recovered' | 'saved' | 'failed';

type ConnectorItem = {
  key: string;
  type: 'app' | 'data_source';
  label: string;
  description: string;
  connected: boolean;
  enabledByDefault: boolean;
  connectionIds: string[];
  accounts: Array<{
    connectionId: string;
    provider: string;
    accountEmail: string;
    displayName: string;
    status: string;
    updatedAt: string;
  }>;
  platformConfigured?: boolean;
  connectHref?: string;
  manageHref?: string;
};

type ConnectorScopePayload = {
  enabledConnectorKeys: string[];
  enabledConnectionIds: string[];
};

const EXECUTIVE_ACTIVE_RUN_STORAGE_KEY = 'altselfs:executive-active-run-id';
const HERMES_MODEL_STORAGE_KEY = 'altselfs:personal-agent-hermes-model';
const AUTH_EXPIRED_MESSAGE = 'Your sign-in session expired. Please sign in again.';

function buildSignInRedirectUrl() {
  if (typeof window === 'undefined') return '/sign-in';
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const params = new URLSearchParams({ redirect_url: currentPath || '/investor/chat/100' });
  return `/sign-in?${params.toString()}`;
}

type HermesModelOption = {
  value: 'claude-sonnet-4-6' | 'deepseek/deepseek-v3.2';
  label: string;
  detail: string;
};

const DEFAULT_HERMES_MODEL: HermesModelOption['value'] = 'claude-sonnet-4-6';

const hermesModelOptions: HermesModelOption[] = [
  {
    value: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    detail: 'Hermes via APIYI',
  },
  {
    value: 'deepseek/deepseek-v3.2',
    label: 'DeepSeek 3.2',
    detail: 'Hermes via OpenRouter',
  },
];

function normalizeHermesModelOption(value: unknown): HermesModelOption['value'] {
  return hermesModelOptions.find((option) => option.value === value)?.value || DEFAULT_HERMES_MODEL;
}

const suggestedQuestions = [
  'Find today\'s industry and technical updates related to OPC.',
  'Help me analyze whether this product idea is worth pursuing.',
  'What changes in AI agents are worth paying attention to today?',
  'Help me turn a complex problem into an action plan.',
  'Remember: I prefer conclusions, supporting rationale, and next-step recommendations.',
];

const plannerStatusLabel: Record<PlannerStepStatus, string> = {
  PENDING: 'Pending',
  RUNNING: 'Running',
  SUCCESS: 'Complete',
  ERROR: 'Error',
  SKIPPED: 'Skipped',
};

const plannerStatusClass: Record<PlannerStepStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  RUNNING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  ERROR: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-amber-100 text-amber-700',
};

const attachmentAccept =
  'image/*,application/pdf,.pdf,.doc,.docx,.xlsx,.csv,.tsv,.txt,.md,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,text/markdown';
const MAX_ATTACHMENT_FILES = 6;
const MAX_ATTACHMENT_FILE_BYTES = 50 * 1024 * 1024;
const MESSAGE_AUTO_FOLLOW_BOTTOM_THRESHOLD_PX = 120;

function isNearMessagesBottom(viewport: HTMLDivElement) {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= MESSAGE_AUTO_FOLLOW_BOTTOM_THRESHOLD_PX;
}

function getPendingAttachmentKind(file: File): PendingAttachmentKind {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.doc') ||
    name.endsWith('.docx')
  ) {
    return 'document';
  }
  return 'file';
}

function normalizeMessageContentForRecovery(value: string) {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
}

function appendAssistantReplyIfMissing(messages: ChatMessage[], reply: string) {
  const content = reply.trim();
  if (!content) return messages;
  const normalizedReply = normalizeMessageContentForRecovery(content);
  const exists = messages.some((message) => (
    message.role === 'assistant' &&
    normalizeMessageContentForRecovery(message.content) === normalizedReply
  ));
  if (exists) return messages;
  return [...messages, { role: 'assistant' as const, content }];
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function inferArtifactMimeType(name: string, mimeType?: string | null) {
  const normalized = mimeType?.trim().toLowerCase();
  if (normalized) return normalized;
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  if (lowerName.endsWith('.svg')) return 'image/svg+xml';
  if (lowerName.endsWith('.avif')) return 'image/avif';
  if (lowerName.endsWith('.mp4')) return 'video/mp4';
  if (lowerName.endsWith('.webm')) return 'video/webm';
  if (lowerName.endsWith('.mov')) return 'video/quicktime';
  if (lowerName.endsWith('.m4v')) return 'video/x-m4v';
  if (lowerName.endsWith('.mpeg') || lowerName.endsWith('.mpg')) return 'video/mpeg';
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.csv')) return 'text/csv';
  if (lowerName.endsWith('.tsv')) return 'text/tab-separated-values';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.md')) return 'text/markdown';
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return '';
}

function isImageArtifact(artifact: ChatArtifact) {
  return inferArtifactMimeType(artifact.name, artifact.mimeType).startsWith('image/');
}

function isVideoArtifact(artifact: ChatArtifact) {
  return inferArtifactMimeType(artifact.name, artifact.mimeType).startsWith('video/');
}

function isExternalVideoArtifact(artifact: ChatArtifact) {
  return artifact.kind === 'external_video_link';
}

function isPlayableVideoArtifact(artifact: ChatArtifact) {
  return isVideoArtifact(artifact) && !isExternalVideoArtifact(artifact);
}

function artifactTypeLabel(artifact: ChatArtifact) {
  const mimeType = inferArtifactMimeType(artifact.name, artifact.mimeType);
  if (isExternalVideoArtifact(artifact)) return 'External video';
  if (mimeType === 'image/unknown') return 'Image';
  if (mimeType.startsWith('image/')) return mimeType.replace('image/', '').toUpperCase();
  if (mimeType.startsWith('video/')) return 'Video';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'Spreadsheet';
  if (mimeType.includes('wordprocessing') || mimeType === 'application/msword') return 'Document';
  if (mimeType === 'text/csv') return 'CSV';
  if (mimeType === 'text/markdown') return 'Markdown';
  if (mimeType.startsWith('text/')) return 'Text';
  return 'File';
}

function normalizeChatArtifacts(value: unknown): ChatArtifact[] {
  if (!Array.isArray(value)) return [];
  const artifacts: ChatArtifact[] = [];
  for (const item of value) {
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

function safeMediaUrl(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^\/(?!\/)/.test(trimmed)) return trimmed;
  return '';
}

function stripTrailingMediaUrlPunctuation(value: string) {
  return value.trim().replace(/[),.;!?]+$/g, '');
}

function mediaUrlPathname(value: string) {
  const href = safeMediaUrl(value);
  if (!href) return '';
  if (href.startsWith('/')) return href.split(/[?#]/)[0] || '';
  try {
    return new URL(href).pathname;
  } catch {
    return '';
  }
}

function isDirectImageUrl(value: string) {
  return /\.(?:png|jpe?g|webp|gif|svg|avif)$/i.test(mediaUrlPathname(value));
}

function isDirectVideoUrl(value: string) {
  return /\.(?:mp4|webm|mov|m4v|mpeg|mpg)$/i.test(mediaUrlPathname(value));
}

function externalVideoServiceName(value: string) {
  const href = safeMediaUrl(value);
  if (!/^https?:\/\//i.test(href)) return '';
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'YouTube';
    if (host.endsWith('vimeo.com')) return 'Vimeo';
    if (host.endsWith('bilibili.com') || host.endsWith('b23.tv')) return 'Bilibili';
    if (host.endsWith('tiktok.com')) return 'TikTok';
    if (host.endsWith('instagram.com')) return 'Instagram';
    if (host.endsWith('loom.com')) return 'Loom';
  } catch {
    return '';
  }
  return '';
}

function mediaNameFromUrl(value: string, label?: string) {
  const trimmedLabel = label?.trim();
  if (trimmedLabel) return trimmedLabel;
  const serviceName = externalVideoServiceName(value);
  if (serviceName) return `${serviceName} video`;
  const pathname = mediaUrlPathname(value);
  const basename = pathname.split('/').filter(Boolean).pop();
  if (!basename) return 'media';
  try {
    return decodeURIComponent(basename);
  } catch {
    return basename;
  }
}

function previewArtifactFromUrl(rawUrl: string, label?: string, forcedKind?: 'linked_image') {
  const downloadPath = safeMediaUrl(stripTrailingMediaUrlPunctuation(rawUrl));
  if (!downloadPath) return null;
  const externalVideo = externalVideoServiceName(downloadPath);
  const image = forcedKind === 'linked_image' || isDirectImageUrl(downloadPath);
  const video = isDirectVideoUrl(downloadPath);
  if (!image && !video && !externalVideo) return null;
  return {
    name: mediaNameFromUrl(downloadPath, label),
    kind: externalVideo && !video ? 'external_video_link' : image ? 'linked_image' : 'linked_video',
    mimeType: image ? 'image/unknown' : video ? inferArtifactMimeType(downloadPath) : null,
    sizeBytes: null,
    downloadPath,
  };
}

function extractGeneratedFileLinks(content: string): ChatArtifact[] {
  const match = /(?:^|\n)Generated files:\s*\n([\s\S]*)$/i.exec(content);
  if (!match) return [];
  const artifacts: ChatArtifact[] = [];
  for (const item of match[1].matchAll(/^\s*[-*]\s+\[([^\]]+)]\(([^)]+)\)/gm)) {
    const name = item[1]?.replace(/\\]/g, ']').replace(/\\\\/g, '\\').trim() || 'artifact';
    const downloadPath = item[2]?.trim() || '';
    if (!downloadPath) continue;
    artifacts.push({ name, downloadPath });
  }
  return artifacts;
}

function extractPreviewMediaLinks(content: string): ChatArtifact[] {
  const source = stripGeneratedFileLinks(content);
  const artifacts: ChatArtifact[] = [];

  for (const item of source.matchAll(/!\[([^\]]*)]\(([^)\s]+)\)/g)) {
    const artifact = previewArtifactFromUrl(item[2] || '', item[1] || '', 'linked_image');
    if (artifact) artifacts.push(artifact);
  }

  for (const item of source.matchAll(/(^|[^!])\[([^\]]+)]\(([^)\s]+)\)/g)) {
    const artifact = previewArtifactFromUrl(item[3] || '', item[2] || '');
    if (artifact) artifacts.push(artifact);
  }

  for (const item of source.matchAll(/`((?:https?:\/\/|\/)[^`\s]+)`/g)) {
    const artifact = previewArtifactFromUrl(item[1] || '');
    if (artifact) artifacts.push(artifact);
  }

  for (const item of source.matchAll(/(?:^|[\s(])((?:https?:\/\/|\/)[^\s<>()]+)/g)) {
    const artifact = previewArtifactFromUrl(item[1] || '');
    if (artifact) artifacts.push(artifact);
  }

  return artifacts;
}

function stripGeneratedFileLinks(content: string) {
  return content.replace(/(?:^|\n)Generated files:\s*\n(?:\s*[-*]\s+\[[^\]]+]\([^)]+\)\s*\n?)+\s*$/i, '').trim();
}

function messageArtifacts(message: ChatMessage) {
  const structured = normalizeChatArtifacts(message.artifacts);
  const parsed = message.role === 'assistant'
    ? extractGeneratedFileLinks(message.content)
    : [];
  const seen = new Set<string>();
  return [...structured, ...parsed].filter((artifact) => {
    const key = `${artifact.downloadPath}::${artifact.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
  });
}

function createPendingAttachment(file: File): PendingAttachment {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    name: file.name,
    type: file.type,
    size: file.size,
    kind: getPendingAttachmentKind(file),
    uploadStatus: 'queued',
  };
}

function formatAttachmentList(attachments: PendingAttachment[]) {
  if (attachments.length === 0) return '';
  return attachments.map((attachment) => `- ${attachment.name} (${formatBytes(attachment.size)})`).join('\n');
}

async function uploadAttachmentToOss(attachment: PendingAttachment, artifact: DirectUploadArtifact) {
  if (!artifact.upload?.url || !artifact.upload.fields) {
    throw new Error('Upload target is missing.');
  }
  const formData = new FormData();
  Object.entries(artifact.upload.fields).forEach(([key, value]) => {
    formData.append(key, value);
  });
  formData.append('file', attachment.file, attachment.name);
  const response = await fetch(artifact.upload.url, {
    method: artifact.upload.method || 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`OSS upload failed with HTTP ${response.status}`);
  }
}

function attachmentUploadStatusLabel(attachment: PendingAttachment) {
  if (attachment.uploadStatus === 'uploaded') return 'Ready';
  if (attachment.uploadStatus === 'uploading' || attachment.uploadStatus === 'queued') return 'Uploading';
  return 'Failed';
}

function attachmentUploadStatusClass(attachment: PendingAttachment) {
  if (attachment.uploadStatus === 'uploaded') return 'text-emerald-600';
  if (attachment.uploadStatus === 'error') return 'text-red-600';
  return 'text-slate-400';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePlannerSteps(value: unknown): PlannerStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return null;
      return {
        id: item.id,
        title: item.title,
        description: typeof item.description === 'string' ? item.description : '',
        agentType: typeof item.agentType === 'string' ? item.agentType : undefined,
      };
    })
    .filter(Boolean) as PlannerStep[];
}

function normalizePlannerTrace(value: unknown): PlannerTraceItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return null;
      const status = typeof item.status === 'string' ? item.status : 'PENDING';
      if (!['PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'SKIPPED'].includes(status)) return null;
      return {
        id: item.id,
        title: item.title,
        description: typeof item.description === 'string' ? item.description : '',
        agentType: typeof item.agentType === 'string' ? item.agentType : undefined,
        status: status as PlannerStepStatus,
        detail: typeof item.detail === 'string' ? item.detail : undefined,
        error: typeof item.error === 'string' ? item.error : undefined,
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
        payload: item.payload,
      };
    })
    .filter(Boolean) as PlannerTraceItem[];
}

function getLatestPlannerStatuses(trace: PlannerTraceItem[]) {
  const map = new Map<string, PlannerTraceItem>();
  for (const item of trace) {
    map.set(item.id, item);
  }
  return map;
}

function formatPlannerPayload(payload: unknown) {
  if (payload === undefined || payload === null) return '';
  try {
    return JSON.stringify(payload, null, 2).slice(0, 1200);
  } catch {
    return String(payload).slice(0, 1200);
  }
}

function getEventPayload(event: unknown) {
  if (!isRecord(event)) return {};
  return isRecord(event.payload) ? event.payload : {};
}

function parseJsonRecord(value: unknown) {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getCodexNotification(envelope: Record<string, unknown>) {
  if (String(envelope.type || '') !== 'event' || !isRecord(envelope.event)) return null;
  const event = envelope.event;
  if (!String(event.type || '').startsWith('codex.')) return null;
  const payload = getEventPayload(event);
  return parseJsonRecord(payload.notification) || parseJsonRecord(payload.notificationText);
}

function extractCodexText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';
  for (const key of ['text', 'content', 'message', 'finalText']) {
    const item = value[key];
    if (typeof item === 'string') return item;
  }
  const content = value.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .filter(Boolean)
    .join('');
}

function formatStreamPayload(value: unknown, maxLength = 6000) {
  if (typeof value === 'string') {
    return value.length > maxLength ? `${value.slice(0, maxLength)}\n...` : value;
  }
  if (value === null || value === undefined) return '';
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
  } catch {
    return String(value);
  }
}

function isInternalAgentEventType(type: string) {
  if (type === 'codex.timing' || type === 'hermes.timing') return true;
  if (type === 'codex.server_request.item/tool/call') return true;
  if (type === 'codex.mcp.notification' || type === 'codex.mcp.turn_started') return true;
  if (type === 'codex.rollout.first_file_detected') return true;
  if (type === 'codex.rollout.first_event_seen') return true;
  if (type === 'codex.rollout.first_projected_event') return true;
  if (type === 'codex.session.starting' || type === 'codex.thread.started' || type === 'codex.turn.started') return true;
  if (type === 'hermes.profile.loaded' || type === 'hermes.profile.updated') return true;
  if (type === 'hermes.source_runtime.starting' || type === 'hermes.source_runtime.completed') return true;
  if (type.startsWith('runtime_state.')) return true;
  if (
    type.startsWith('agent_context.') &&
    type !== 'agent_context.queue_timeout_requested' &&
    type !== 'agent_context.sandbox_state_failed'
  ) {
    return true;
  }
  return false;
}

function describeCodexItem(item: Record<string, unknown>) {
  const type = String(item.type || 'item');
  const command = typeof item.command === 'string' ? item.command : '';
  const tool = typeof item.tool === 'string' ? item.tool : '';
  const namespace = typeof item.namespace === 'string' ? item.namespace : '';
  const path = typeof item.path === 'string' ? item.path : typeof item.file === 'string' ? item.file : '';
  const text = extractCodexText(item).trim();

  if (type.toLowerCase().includes('command')) {
    return { title: 'Run command', detail: command || 'Command running', content: text };
  }
  if (type.toLowerCase().includes('tool') || tool) {
    return { title: 'Call tool', detail: [namespace, tool].filter(Boolean).join('.') || 'tool call in progress', content: text };
  }
  if (type.toLowerCase().includes('file') || type.toLowerCase().includes('patch')) {
    return { title: 'Update file', detail: path || type, content: text };
  }
  if (type.toLowerCase().includes('agentmessage') || type === 'message') {
    return { title: 'Generate reply', detail: 'Writing assistant message', content: text };
  }
  return { title: 'Process item', detail: type, content: text };
}

function projectCodexStreamItem(envelope: Record<string, unknown>, index: number): CodexStreamItem | null {
  const envelopeType = String(envelope.type || '');
  const now = new Date().toISOString();
  if (envelopeType === 'turn_started') {
    return null;
  }

  if (envelopeType === 'error') {
    return {
      id: `stream-error-${index}`,
      title: 'Execution failed',
      detail: typeof envelope.error === 'string' ? envelope.error : 'An error occurred during execution',
      status: 'error',
      timestamp: now,
    };
  }

  if (envelopeType !== 'event' || !isRecord(envelope.event)) return null;

  const event = envelope.event;
  const type = String(event.type || 'agent.event');
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : now;
  const payload = getEventPayload(event);

  if (isInternalAgentEventType(type)) return null;

  if (type === 'codex.server_request.item/tool/call') {
    const request = isRecord(payload.request) ? payload.request : {};
    const params = isRecord(request.params) ? request.params : {};
    const namespace = typeof params.namespace === 'string' ? params.namespace : '';
    const tool = typeof params.tool === 'string' ? params.tool : '';
    return {
      id: `codex-server-request-${timestamp}-${index}`,
      title: 'Call tool',
      detail: [namespace, tool].filter(Boolean).join('.') || 'item/tool/call',
      status: 'running',
      timestamp,
      method: 'item/tool/call',
    };
  }

  if (type === 'codex.error' || type === 'codex.web_search.not_used') {
    const detail = typeof payload.error === 'string'
      ? payload.error
      : typeof payload.warning === 'string'
        ? payload.warning
        : 'Codex runtime returned an error';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'codex.web_search.not_used' ? 'Search was not run' : 'Codex Execution failed',
      detail,
      status: 'error',
      timestamp,
      method: type,
    };
  }

  if (type === 'codex.plan.updated') {
    const parsedArguments = payload.parsedArguments;
    const content = isRecord(parsedArguments)
      ? formatStreamPayload(parsedArguments)
      : typeof payload.arguments === 'string'
        ? payload.arguments
        : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Update plan',
      detail: typeof payload.callId === 'string' && payload.callId ? `callId: ${payload.callId}` : 'update_plan',
      status: 'completed',
      timestamp,
      method: type,
      content,
    };
  }

  if (type === 'codex.tool.call') {
    const name = typeof payload.name === 'string' ? payload.name : 'tool';
    const content = isRecord(payload.parsedArguments)
      ? formatStreamPayload(payload.parsedArguments)
      : typeof payload.arguments === 'string'
        ? payload.arguments
        : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Call tool',
      detail: name,
      status: 'running',
      timestamp,
      method: type,
      content,
    };
  }

  if (type === 'codex.tool.output') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Tool result',
      detail: typeof payload.callId === 'string' && payload.callId ? `callId: ${payload.callId}` : 'function_call_output',
      status: 'completed',
      timestamp,
      method: type,
      content: typeof payload.output === 'string' ? payload.output : formatStreamPayload(payload.output),
    };
  }

  if (type === 'codex.agent_message') {
    const message = typeof payload.message === 'string' ? payload.message : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Codex update',
      detail: 'Assistant message',
      status: 'running',
      timestamp,
      method: type,
      content: message,
    };
  }

  if (type === 'codex.agent_message.delta' || type === 'codex.agent_message.final') {
    const message = typeof payload.message === 'string'
      ? payload.message
      : typeof payload.delta === 'string'
        ? payload.delta
        : '';
    return {
      id: 'codex-agent-message-live',
      title: type === 'codex.agent_message.final' ? 'Codex result' : 'Codex update',
      detail: type === 'codex.agent_message.final' ? 'Final assistant message' : 'Writing assistant message',
      status: type === 'codex.agent_message.final' ? 'completed' : 'running',
      timestamp,
      method: type,
      content: message,
    };
  }

  if (type === 'codex.task_complete') {
    const message = typeof payload.lastAgentMessage === 'string' ? payload.lastAgentMessage : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Codex completed task',
      detail: 'task_complete',
      status: 'completed',
      timestamp,
      method: type,
      content: message,
    };
  }

  if (type === 'codex.turn_aborted' || type === 'codex.turn_aborted.detected') {
    const reason = typeof payload.reason === 'string' ? payload.reason : 'turn aborted before task_complete';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Codex turn interrupted',
      detail: reason,
      status: 'error',
      timestamp,
      method: type,
      content: typeof payload.lastAgentMessage === 'string' ? payload.lastAgentMessage : undefined,
    };
  }

  if (type === 'codex.rollout.bridge_error') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Codex event bridge failed',
      detail: typeof payload.error === 'string' ? payload.error : 'rollout bridge error',
      status: 'error',
      timestamp,
      method: type,
    };
  }

  if (type === 'codex.session.starting' || type === 'codex.thread.started' || type === 'codex.turn.started') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'codex.session.starting' ? 'Start Codex' : type === 'codex.thread.started' ? 'Create thread' : 'Start turn',
      detail: type.replace('codex.', ''),
      status: type === 'codex.thread.started' ? 'completed' : 'running',
      timestamp,
      method: type,
    };
  }

  if (type === 'agent_context.input_persisted' || type === 'agent_context.async_turn_started') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'agent_context.async_turn_started' ? 'Background task created' : 'Create task',
      detail: typeof payload.runId === 'string' ? `runId: ${payload.runId}` : 'This turn input has been recorded',
      status: 'completed',
      timestamp,
      method: type,
    };
  }

  if (type === 'agent_context.queue_claimed' || type === 'agent_context.queue_timeout_requested') {
    const model = typeof payload.model === 'string' ? payload.model : '';
    const provider = typeof payload.modelProvider === 'string' ? payload.modelProvider : '';
    const workerId = typeof payload.workerId === 'string' ? payload.workerId : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'agent_context.queue_claimed' ? 'Start background task' : 'Task timed out; stopping',
      detail: [model, provider, workerId ? `worker: ${workerId}` : ''].filter(Boolean).join(' · ') || type.replace('agent_context.', ''),
      status: type === 'agent_context.queue_claimed' ? 'running' : 'error',
      timestamp,
      method: type,
    };
  }

  if (type === 'workspace_artifacts.ingested') {
    const count = typeof payload.count === 'number' ? payload.count : 0;
    const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
    const content = artifacts
      .map((artifact) => {
        if (!isRecord(artifact)) return '';
        const name = typeof artifact.name === 'string' ? artifact.name : 'attachment';
        const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
        const parser = typeof metadata.parser === 'string' ? metadata.parser : 'unparsed';
        const parsedText = typeof metadata.parsedTextRelativePath === 'string' ? metadata.parsedTextRelativePath : '';
        return [name, parser, parsedText].filter(Boolean).join(' | ');
      })
      .filter(Boolean)
      .join('\n');
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Parse attachments',
      detail: count > 0 ? `Processed ${count} attachments` : 'No attachments or parse warnings',
      status: Array.isArray(payload.warnings) && payload.warnings.length > 0 ? 'error' : 'completed',
      timestamp,
      method: type,
      content,
    };
  }

  if (type === 'workspace_artifacts.generated') {
    const count = typeof payload.count === 'number' ? payload.count : 0;
    const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
    const content = artifacts
      .map((artifact) => {
        if (!isRecord(artifact)) return '';
        const name = typeof artifact.name === 'string' ? artifact.name : 'artifact';
        const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
        const downloadPath = typeof metadata.downloadPath === 'string' ? metadata.downloadPath : '';
        return [name, downloadPath].filter(Boolean).join(' | ');
      })
      .filter(Boolean)
      .join('\n');
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Publish generated files',
      detail: count > 0 ? `Uploaded ${count} files` : 'No generated files',
      status: Array.isArray(payload.warnings) && payload.warnings.length > 0 ? 'error' : 'completed',
      timestamp,
      method: type,
      content,
    };
  }

  if (type === 'agent_context.loaded') {
    const summaryChars = typeof payload.summaryChars === 'number' ? payload.summaryChars : 0;
    const messageCount = typeof payload.messageCount === 'number' ? payload.messageCount : 0;
    const artifactCount = typeof payload.artifactCount === 'number' ? payload.artifactCount : 0;
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Load context',
      detail: `Summary ${summaryChars} chars, history messages ${messageCount} rows, attachments ${artifactCount}`,
      status: 'completed',
      timestamp,
      method: type,
    };
  }

  if (type === 'agent_context.sandbox_state_updated' || type === 'agent_context.sandbox_state_failed') {
    const status = typeof payload.status === 'string' ? payload.status : '';
    const diskBytes = typeof payload.diskBytes === 'number' ? payload.diskBytes : null;
    const detailParts = [
      status,
      diskBytes === null ? '' : `Disk ${formatBytes(diskBytes)}`,
    ].filter(Boolean);
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'agent_context.sandbox_state_failed' ? 'Failed to save sandbox state' : 'Save sandbox state',
      detail: detailParts.join(' · ') || type.replace('agent_context.', ''),
      status: type === 'agent_context.sandbox_state_failed' || status === 'ERROR' ? 'error' : 'completed',
      timestamp,
      method: type,
    };
  }

  if (type === 'hermes.profile.updated' || type === 'hermes.profile.loaded') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'hermes.profile.updated' ? 'Update profile memory' : 'Load profile memory',
      detail: type === 'hermes.profile.loaded'
        ? `${typeof payload.entryCount === 'number' ? payload.entryCount : 0} profile entries`
        : 'Recorded new long-term preferences',
      status: 'completed',
      timestamp,
      method: type,
    };
  }

  if (type === 'hermes.source_runtime.starting') {
    const model = typeof payload.model === 'string' ? payload.model : '';
    const sessionMode = typeof payload.sessionMode === 'string' ? payload.sessionMode : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Start Hermes/Codex',
      detail: [model, sessionMode].filter(Boolean).join(' · ') || 'Starting agent loop',
      status: 'running',
      timestamp,
      method: type,
    };
  }

  if (type === 'hermes.source_runtime.completed') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Complete Hermes/Codex',
      detail: typeof payload.sessionId === 'string' ? `sessionId: ${payload.sessionId}` : 'Agent loop completed',
      status: 'completed',
      timestamp,
      method: type,
    };
  }

  if (type.startsWith('runtime_state.')) {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Sync runtime state',
      detail: type.replace('runtime_state.', ''),
      status: type.includes('cleaned') || type.includes('flushed') || type.includes('hydrated') ? 'completed' : 'running',
      timestamp,
      method: type,
    };
  }

  const notification = getCodexNotification(envelope);
  if (notification) {
    const method = String(notification.method || '');
    if (
      [
        'thread/status/changed',
        'thread/tokenUsage/updated',
        'account/rateLimits/updated',
        'turn/started',
      ].includes(method)
    ) {
      return null;
    }
    if (method === 'warning') {
      const params = isRecord(notification.params) ? notification.params : {};
      return {
        id: `warning-${timestamp}-${index}`,
        title: 'Codex warning',
        detail: typeof params.message === 'string' ? params.message : 'warning',
        status: 'error',
        timestamp,
        method,
      };
    }
    if (method === 'item/agentMessage/delta') return null;
    if (method === 'turn/completed') {
      return {
        id: 'turn-completed',
        title: 'Turn completed',
        detail: 'turn/completed',
        status: 'completed',
        timestamp,
        method,
      };
    }
    const params = isRecord(notification.params) ? notification.params : {};
    const item = isRecord(params.item) ? params.item : {};
    const itemType = String(item.type || '');
    const role = String(item.role || '');
    if (
      itemType === 'userMessage' ||
      itemType === 'agentMessage' ||
      itemType === 'assistantMessage' ||
      (itemType === 'message' && (role === 'assistant' || role === 'user'))
    ) {
      return null;
    }
    const summary = describeCodexItem(item);
    const itemId = typeof item.id === 'string' ? item.id : `${method}-${timestamp}-${index}`;
    if (method === 'item/started' || method === 'item/completed') {
      return {
        id: itemId,
        title: summary.title,
        detail: summary.detail,
        status: method === 'item/completed' ? 'completed' : 'running',
        timestamp,
        method,
        content: method === 'item/completed' ? summary.content : undefined,
      };
    }
    return {
      id: `${method}-${timestamp}-${index}`,
      title: 'Codex event',
      detail: method || type,
      status: method.includes('completed') ? 'completed' : 'running',
      timestamp,
      method,
    };
  }

  if (!type.startsWith('codex.')) return null;

  return {
    id: `${type}-${timestamp}-${index}`,
    title: 'Agent event',
    detail: type,
    status: type.includes('completed') ? 'completed' : 'running',
    timestamp,
    method: type,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createClientRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function messagesContainUserTurn(value: unknown, expectedUserContent: string) {
  const expected = normalizeMessageContentForRecovery(expectedUserContent);
  if (!expected || !Array.isArray(value)) return false;
  return value.some((message) => {
    if (!isRecord(message)) return false;
    const role = typeof message.role === 'string' ? message.role.toLowerCase() : '';
    const content = typeof message.content === 'string' ? message.content : '';
    return role === 'user' && normalizeMessageContentForRecovery(content) === expected;
  });
}

function getRunPollErrorMessage(data: ExecutiveRunPollResult, status: number) {
  const detail = typeof data.error === 'string' && data.error.trim() ? data.error.trim() : 'Failed to check task status';
  return `Failed to check task status (HTTP ${status}): ${detail}`;
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 1000) return '<1s';
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  return `${seconds}s`;
}

function timestampMs(value: string) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function stepDuration(items: CodexStreamItem[], index: number, fallbackEndMs: number) {
  const start = timestampMs(items[index]?.timestamp || '');
  if (!start) return 0;
  const next = timestampMs(items[index + 1]?.timestamp || '') || fallbackEndMs;
  return Math.max(0, next - start);
}

function extractLinks(...values: Array<string | undefined>) {
  const text = values.filter(Boolean).join('\n');
  const matches = text.match(/https?:\/\/[^\s)"'<>]+/g) || [];
  return Array.from(new Set(matches)).slice(0, 4);
}

function buildCompletedActivityFromStatus(params: {
  run: Record<string, unknown>;
  events: CodexStreamItem[];
}) {
  const completedAt = typeof params.run.completed_at === 'string'
    ? params.run.completed_at
    : typeof params.run.updated_at === 'string'
      ? params.run.updated_at
      : params.events[params.events.length - 1]?.timestamp || '';
  const startedAt = typeof params.run.started_at === 'string'
    ? params.run.started_at
    : typeof params.run.created_at === 'string'
      ? params.run.created_at
      : params.events[0]?.timestamp || completedAt;
  const completedMs = timestampMs(completedAt);
  const startedMs = timestampMs(startedAt);
  const durationMs = completedMs && startedMs ? Math.max(0, completedMs - startedMs) : 0;
  const runId = typeof params.run.id === 'string' ? params.run.id : `activity-${completedAt || startedAt}`;
  return {
    id: runId,
    durationMs,
    items: params.events,
    completedAt: completedAt || new Date(0).toISOString(),
  };
}

function codexActionLabel(item: CodexStreamItem) {
  const method = item.method || '';
  if (item.status === 'error') return item.title || 'Execution failed';
  if (method.includes('codex.agent_message.delta')) return 'Codex is writing';
  if (method.includes('codex.agent_message.final')) return 'Codex finished';
  if (method.includes('codex.agent_message')) return 'Codex update';
  if (method.includes('tool') || item.title.includes('tool')) {
    return item.status === 'completed' ? 'Tool finished' : 'Using tool';
  }
  if (method.includes('queue_claimed')) return 'Starting task';
  if (method.includes('queue_timeout')) return 'Task timed out';
  if (method.includes('plan') || item.title.includes('plan')) return 'Planning';
  if (method.includes('thread') || method.includes('session')) return 'Preparing session';
  if (method.includes('agent_context') || method.includes('runtime_state')) return 'Reading context';
  if (method.includes('workspace_artifacts')) return 'Processing attachments';
  if (method.includes('profile')) return 'Reading memory';
  if (method.includes('task_complete') || method.includes('completed')) return 'Completed';
  return item.status === 'running' ? 'Thinking' : item.title;
}

function codexCompletedActionLabel(item: CodexStreamItem) {
  const method = item.method || '';
  if (item.status === 'error') return item.title || 'Execution failed';
  if (method.includes('codex.agent_message.delta')) return 'Codex update';
  if (method.includes('codex.agent_message.final')) return 'Codex result';
  if (method.includes('codex.agent_message')) return 'Codex update';
  if (method.includes('tool') || item.title.includes('tool')) return item.status === 'running' ? 'Use tool' : 'Tool result';
  if (method.includes('queue_claimed')) return 'Start task';
  if (method.includes('queue_timeout')) return 'Task timeout';
  if (method.includes('plan') || item.title.includes('plan')) return 'Plan';
  if (method.includes('thread') || method.includes('session')) return 'Prepare session';
  if (method.includes('agent_context') || method.includes('runtime_state')) return 'Read context';
  if (method.includes('workspace_artifacts')) return 'Process attachments';
  if (method.includes('profile')) return 'Read memory';
  if (method.includes('hermes.source_runtime')) return 'Run Hermes/Codex';
  if (method.includes('codex.agent_message')) return 'Generate reply';
  if (method.includes('task_complete') || method.includes('completed')) return 'Complete';
  return item.title.replace(/^Running\s+/, '');
}

function codexCompactDetail(item: CodexStreamItem) {
  const detail = item.detail.trim();
  if (!detail) return item.title;
  if (detail === item.title) return detail;
  return detail.length > 120 ? `${detail.slice(0, 120)}...` : detail;
}

function formatCodexContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return '';
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.plan)) {
      return parsed.plan
        .map((step) => {
          if (!isRecord(step)) return '';
          const status = typeof step.status === 'string' ? step.status : '';
          const text = typeof step.step === 'string' ? step.step : '';
          return [status ? `[${status}]` : '', text].filter(Boolean).join(' ');
        })
        .filter(Boolean)
        .join('\n');
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return trimmed;
  }
}

function shouldShowActivityContentInline(item: CodexStreamItem) {
  const method = item.method || '';
  return (
    method === 'codex.agent_message' ||
    method === 'codex.agent_message.delta' ||
    method === 'codex.agent_message.final' ||
    method === 'codex.task_complete' ||
    method === 'codex.plan.updated'
  );
}

function compactCodexStreamItems(items: CodexStreamItem[], limit = 18) {
  const compacted: CodexStreamItem[] = [];
  for (const item of items) {
    if (!item) continue;
    const existingIndex = compacted.findIndex((candidate) => candidate.id === item.id);
    if (existingIndex >= 0) {
      compacted[existingIndex] = {
        ...compacted[existingIndex],
        ...item,
        content: item.content || compacted[existingIndex].content,
      };
    } else {
      compacted.push(item);
    }
  }
  const hasNativeActivity = compacted.some((item) => item.method);
  const nativeVisible = hasNativeActivity
    ? compacted.filter((item) => item.method || item.status === 'error')
    : compacted;
  const hasTaskComplete = nativeVisible.some((item) => item.method === 'codex.task_complete');
  const visible = hasTaskComplete
    ? nativeVisible.filter((item) => (
        item.method !== 'codex.agent_message' &&
        item.method !== 'codex.agent_message.delta' &&
        item.method !== 'codex.agent_message.final'
      ))
    : nativeVisible;
  return visible.slice(-limit);
}

function ActivityContent({ item, content }: { item: CodexStreamItem; content: string }) {
  if (!content) return null;
  if (shouldShowActivityContentInline(item)) {
    return (
      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-800">
        <MarkdownMessage
          content={content}
          renderMediaPreview={({ href, label, kind, key }) => (
            <InlineMediaPreview key={key} href={href} label={label} kind={kind} />
          )}
        />
      </div>
    );
  }
  return (
    <details className="group/output mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
        <ChevronDown className="h-3 w-3 transition group-open/output:rotate-180" />
        Output
      </summary>
      <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100">
        {content}
      </pre>
    </details>
  );
}

function CodexActivityIcon({ item }: { item: CodexStreamItem }) {
  if (item.status === 'error') return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (item.status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  return <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />;
}

function CompletedCodexActivitySummary({ activity }: { activity: CompletedCodexActivity }) {
  const items = compactCodexStreamItems(activity.items, 18);
  const completedAtMs =
    timestampMs(activity.completedAt) ||
    timestampMs(items[items.length - 1]?.timestamp || '') ||
    0;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-2xl border-b border-slate-200 pb-3 text-sm text-slate-600">
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-0 py-1 text-sm font-medium text-slate-500 hover:text-slate-900">
            <span>Processed {formatDuration(activity.durationMs)}</span>
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </summary>

          <div className="mt-3 space-y-2">
            {items.map((item, index) => {
              const settledItem: CodexStreamItem = {
                ...item,
                status: item.status === 'error' ? 'error' : 'completed',
              };
              const content = item.content ? formatCodexContent(item.content) : '';
              const links = extractLinks(item.detail, content);
              return (
                <div key={`${item.id}-${index}`} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="mt-0.5 shrink-0">
                      <CodexActivityIcon item={settledItem} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-medium text-slate-900">{codexCompletedActionLabel(settledItem)}</span>
                        <span className="min-w-0 break-words text-slate-500">{codexCompactDetail(item)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                        <span>Duration {formatDuration(stepDuration(items, index, completedAtMs))}</span>
                      </div>
                      {links.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {links.map((link) => (
                            <a
                              key={link}
                              href={link}
                              target="_blank"
                              rel="noreferrer"
                              className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-blue-700 hover:border-blue-200 hover:bg-blue-50"
                            >
                              {link}
                            </a>
                          ))}
                        </div>
                      ) : null}
                      <ActivityContent item={settledItem} content={content} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </div>
  );
}

function ArtifactPreviewCard({ artifact, inverted = false }: { artifact: ChatArtifact; inverted?: boolean }) {
  const borderClass = inverted ? 'border-white/25 bg-white/10' : 'border-slate-200 bg-white';
  const mutedClass = inverted ? 'text-blue-100' : 'text-slate-500';
  const titleClass = inverted ? 'text-white' : 'text-slate-900';
  const iconClass = inverted ? 'border-white/20 bg-white/15 text-white' : 'border-slate-200 bg-slate-50 text-slate-600';
  const actionClass = inverted
    ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700';
  const previewBackgroundClass = inverted ? 'bg-white/10' : 'bg-slate-50';
  const image = isImageArtifact(artifact);
  const playableVideo = isPlayableVideoArtifact(artifact);
  const video = playableVideo || isExternalVideoArtifact(artifact);
  const sizeText = typeof artifact.sizeBytes === 'number' && artifact.sizeBytes > 0 ? formatBytes(artifact.sizeBytes) : '';
  const typeText = artifactTypeLabel(artifact);
  const mediaMimeType = inferArtifactMimeType(artifact.name, artifact.mimeType);

  return (
    <div className={`overflow-hidden rounded-xl border ${borderClass}`}>
      {image ? (
        <a
          href={artifact.downloadPath}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${artifact.name}`}
          className={`flex max-h-[min(60vh,32rem)] items-center justify-center overflow-hidden ${previewBackgroundClass}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artifact.downloadPath}
            alt={artifact.name}
            loading="lazy"
            className="h-auto max-h-[min(60vh,32rem)] max-w-full object-contain"
          />
        </a>
      ) : null}
      {playableVideo ? (
        <video
          controls
          preload="metadata"
          playsInline
          aria-label={`Preview ${artifact.name}`}
          className="block max-h-[min(65vh,28rem)] w-full bg-black"
        >
          <source src={artifact.downloadPath} type={mediaMimeType || undefined} />
          Your browser does not support video playback.
        </video>
      ) : null}
      <div className="flex min-w-0 items-center gap-3 p-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${iconClass}`}>
          {image ? <ImageIcon className="h-5 w-5" /> : video ? <Film className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${titleClass}`}>{artifact.name}</p>
          <p className={`text-xs ${mutedClass}`}>{[typeText, sizeText].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <a
            href={artifact.downloadPath}
            target="_blank"
            rel="noreferrer"
            title={`Open ${artifact.name}`}
            aria-label={`Open ${artifact.name}`}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${actionClass}`}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <a
            href={artifact.downloadPath}
            download={artifact.name}
            title={`Download ${artifact.name}`}
            aria-label={`Download ${artifact.name}`}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${actionClass}`}
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

function InlineMediaPreview({
  href,
  label,
  kind,
  inverted = false,
}: {
  href: string;
  label: string;
  kind: 'image' | 'link' | 'code' | 'bare';
  inverted?: boolean;
}) {
  const artifact = previewArtifactFromUrl(href, label, kind === 'image' ? 'linked_image' : undefined);
  if (!artifact) return null;
  return (
    <div className="my-2 max-w-full">
      <ArtifactPreviewCard artifact={artifact} inverted={inverted} />
    </div>
  );
}

function GeneratedArtifactPreviews({ artifacts, inverted = false }: { artifacts: ChatArtifact[]; inverted?: boolean }) {
  if (artifacts.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {artifacts.map((artifact, index) => {
        const key = artifact.id || `${artifact.downloadPath}-${index}`;
        return <ArtifactPreviewCard key={key} artifact={artifact} inverted={inverted} />;
      })}
    </div>
  );
}

function getStoredActiveRunId() {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(EXECUTIVE_ACTIVE_RUN_STORAGE_KEY) || '';
}

function storeActiveRunId(runId: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(EXECUTIVE_ACTIVE_RUN_STORAGE_KEY, runId);
}

function clearStoredActiveRunId(runId?: string) {
  if (typeof window === 'undefined') return;
  const current = getStoredActiveRunId();
  if (!runId || current === runId) {
    window.sessionStorage.removeItem(EXECUTIVE_ACTIVE_RUN_STORAGE_KEY);
  }
}

async function waitForExecutiveRun(
  runId: string,
  onUpdate: (run: ExecutiveRunPollResult) => void
) {
  let transientUnauthorizedCount = 0;
  for (let attempt = 0; attempt < 320; attempt += 1) {
    const res = await fetch(`/api/investor/executive-assistant?runId=${encodeURIComponent(runId)}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const data = (await res.json().catch(() => ({}))) as ExecutiveRunPollResult;
    if (!res.ok) {
      if (res.status === 401 && transientUnauthorizedCount < 3) {
        transientUnauthorizedCount += 1;
        await sleep(1500);
        continue;
      }
      throw Object.assign(new Error(getRunPollErrorMessage(data, res.status)), {
        status: res.status,
      });
    }
    transientUnauthorizedCount = 0;
    onUpdate(data);
    if (data.status === 'SUCCESS' || data.status === 'ERROR') return data;
    await sleep(typeof data.pollIntervalMs === 'number' ? data.pollIntervalMs : 3000);
  }
  throw new Error('The briefing run is still in progress. Refresh in a moment to view the result.');
}

function CodexStreamOutput({ items, active }: { items: CodexStreamItem[]; active: boolean }) {
  if (items.length === 0 && !active) return null;
  const visibleItems = items.length > 0
    ? compactCodexStreamItems(items, 5)
    : [
        {
          id: 'agent-stream-preparing',
          title: 'Thinking',
          detail: 'Creating task and reading context',
          status: 'running' as const,
          timestamp: new Date().toISOString(),
        },
      ];
  const latestItem = [...visibleItems].reverse().find((item) => item.status === 'running') || visibleItems[visibleItems.length - 1];
  const activeTitle = latestItem ? codexActionLabel(latestItem) : 'Thinking';
  const activeDetail = latestItem ? codexCompactDetail(latestItem) : 'Creating task and reading context';

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-2xl py-1">
        <div className="rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-900 shadow-sm ring-1 ring-slate-200/70">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
              {active ? (
                <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-medium text-slate-950">{active ? activeTitle : 'Completed'}</span>
                {active ? <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" /> : null}
                <span className="min-w-0 truncate text-slate-500">{active ? activeDetail : 'Reply generated'}</span>
              </div>
              <details className="group mt-2">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900">
                  <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                  View details
                </summary>

                <div className="mt-3 space-y-2 border-l border-slate-200 pl-3">
                  {visibleItems.map((item) => {
                    const settledItem: CodexStreamItem = {
                      ...item,
                      status: item.status === 'error' ? 'error' : 'completed',
                    };
                    const content = item.content ? formatCodexContent(item.content) : '';
                    return (
                      <div key={item.id} className="min-w-0 rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200/70">
                        <div className="flex min-w-0 items-start gap-2">
                          <div className="mt-0.5 shrink-0">
                            <CodexActivityIcon item={settledItem} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                              <span className="font-medium text-slate-900">{codexCompletedActionLabel(item)}</span>
                              <span className="min-w-0 break-words text-slate-500">{codexCompactDetail(item)}</span>
                            </div>
                            <ActivityContent item={settledItem} content={content} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StreamingAssistantMessage({ content }: { content: string }) {
  if (!content.trim()) return null;
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-3 text-slate-900 sm:max-w-2xl">
        <MarkdownMessage
          content={content}
          renderMediaPreview={({ href, label, kind, key }) => (
            <InlineMediaPreview key={key} href={href} label={label} kind={kind} />
          )}
        />
      </div>
    </div>
  );
}

export default function InvestorAgentChatPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;
  const isExecutive = agentId === '100';

  const [threadId, setThreadId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const [sessionActionBusyId, setSessionActionBusyId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [persistedBriefing, setPersistedBriefing] = useState<PersistedBriefing | null>(null);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [promptSaved, setPromptSaved] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [hasCustomPrompt, setHasCustomPrompt] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [plannerSteps, setPlannerSteps] = useState<PlannerStep[]>([]);
  const [plannerTrace, setPlannerTrace] = useState<PlannerTraceItem[]>([]);
  const [plannerPanelOpen, setPlannerPanelOpen] = useState(false);
  const [codexStreamItems, setCodexStreamItems] = useState<CodexStreamItem[]>([]);
  const [completedCodexActivity, setCompletedCodexActivity] = useState<CompletedCodexActivity | null>(null);
  const [assistantDraft, setAssistantDraft] = useState('');
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [stoppingRun, setStoppingRun] = useState(false);
  const [recoveringRunState, setRecoveringRunState] = useState(false);
  const [hermesModel, setHermesModel] = useState<HermesModelOption['value']>(DEFAULT_HERMES_MODEL);
  const [connectors, setConnectors] = useState<ConnectorItem[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [connectorsError, setConnectorsError] = useState<string | null>(null);
  const [selectedConnectorKeys, setSelectedConnectorKeys] = useState<string[]>([]);
  const promptEditorRef = useRef<HTMLDivElement | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const liveStreamRunIdRef = useRef<string | null>(null);
  const requestedStopRunIdRef = useRef<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesAutoFollowRef = useRef(true);
  const loadingOlderMessagesRef = useRef(false);
  const suppressNextAutoScrollRef = useRef(false);
  const codexEventIndexRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const connectorSelectionInitializedRef = useRef(false);

  const handleSessionExpired = useCallback(() => {
    setError(AUTH_EXPIRED_MESSAGE);
    router.replace(buildSignInRedirectUrl());
  }, [router]);

  const title = useMemo(() => (isExecutive ? 'Hermes Agent' : 'AI Assistant'), [isExecutive]);
  const showExecutiveControls = false;
  const latestPlannerStatuses = useMemo(() => getLatestPlannerStatuses(plannerTrace), [plannerTrace]);
  const hasPlannerErrors = plannerTrace.some((item) => item.status === 'ERROR');
  const plannerButtonText = sending
    ? 'Running plan'
    : plannerTrace.length > 0
      ? hasPlannerErrors
        ? 'Planner errors'
        : 'View planner'
        : 'Open planner';
  const selectedHermesModel =
    hermesModelOptions.find((option) => option.value === hermesModel) ||
    hermesModelOptions.find((option) => option.value === DEFAULT_HERMES_MODEL) ||
    hermesModelOptions[0];
  const attachmentUploadBusy = attachments.some((attachment) => attachment.uploadStatus === 'queued' || attachment.uploadStatus === 'uploading');
  const attachmentUploadFailed = attachments.some((attachment) => attachment.uploadStatus === 'error');

  useEffect(() => {
    const stored = window.localStorage.getItem(HERMES_MODEL_STORAGE_KEY);
    if (stored) setHermesModel(normalizeHermesModelOption(stored));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(HERMES_MODEL_STORAGE_KEY, hermesModel);
  }, [hermesModel]);

  useEffect(() => {
    if (!isExecutive) return;
    let cancelled = false;
    setConnectorsLoading(true);
    setConnectorsError(null);
    fetch('/api/investor/connectors', {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { connectors?: ConnectorItem[]; error?: string };
        if (!res.ok) throw new Error(data.error || 'Failed to load connectors');
        return Array.isArray(data.connectors) ? data.connectors : [];
      })
      .then((items) => {
        if (cancelled) return;
        setConnectors(items);
        if (!connectorSelectionInitializedRef.current) {
          setSelectedConnectorKeys(items.filter((item) => item.connected && item.enabledByDefault).map((item) => item.key));
          connectorSelectionInitializedRef.current = true;
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setConnectorsError(err instanceof Error ? err.message : 'Failed to load connectors');
      })
      .finally(() => {
        if (!cancelled) setConnectorsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isExecutive]);

  const activeConnectors = useMemo(
    () => connectors.filter((connector) => connector.connected && selectedConnectorKeys.includes(connector.key)),
    [connectors, selectedConnectorKeys]
  );
  const connectorScope = useMemo<ConnectorScopePayload>(() => ({
    enabledConnectorKeys: activeConnectors.map((connector) => connector.key),
    enabledConnectionIds: activeConnectors.flatMap((connector) => connector.connectionIds || []),
  }), [activeConnectors]);

  const toggleConnector = useCallback((key: string) => {
    setSelectedConnectorKeys((current) => (
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    ));
  }, []);
  const applyAgentConfig = useCallback((agentConfig: AgentConfig | null | undefined) => {
    if (!agentConfig) return;
    const systemPrompt = String(agentConfig.systemPrompt || '');
    setPromptDraft(systemPrompt);
    setPromptSaved(systemPrompt);
    setDefaultPrompt(String(agentConfig.defaultSystemPrompt || ''));
    setHasCustomPrompt(Boolean(agentConfig.hasCustomPrompt));
  }, []);

  const applyTerminalRun = useCallback(
    (
      run: ExecutiveRunPollResult,
      fallbackMessages: ChatMessage[],
      options: { closePlannerOnSuccess: boolean }
    ) => {
      const data = isRecord(run.result) ? run.result : {};
      if (run.status === 'ERROR') {
        setError(run.error || (typeof data.error === 'string' ? data.error : 'Failed to send message'));
        setMessages(fallbackMessages);
        setPlannerTrace(normalizePlannerTrace(run.plannerTrace || data.plannerTrace));
        setPlannerSteps(normalizePlannerSteps(run.planner || data.planner));
        return;
      }

      setThreadId(typeof data.threadId === 'string' ? data.threadId : null);
      const reply = typeof data.reply === 'string' ? data.reply : '';
      if (Array.isArray(data.messages)) {
        setMessages(appendAssistantReplyIfMissing(data.messages as ChatMessage[], reply));
      } else if (reply.trim()) {
        setMessages(appendAssistantReplyIfMissing(fallbackMessages, reply));
      }
      if (data.briefing) {
        setBriefing(data.briefing as Briefing);
      }
      setPersistedBriefing(isRecord(data.persistedBriefing) ? (data.persistedBriefing as PersistedBriefing) : null);
      setPlannerSteps(normalizePlannerSteps(data.planner || run.planner));
      setPlannerTrace(normalizePlannerTrace(data.plannerTrace || run.plannerTrace));
      applyAgentConfig(data.agentConfig as AgentConfig | null | undefined);
      if (options.closePlannerOnSuccess) setPlannerPanelOpen(false);
    },
    [applyAgentConfig]
  );

  const resumeExecutiveRun = useCallback(
    async (
      runId: string,
      fallbackMessages: ChatMessage[],
      options: { closePlannerOnSuccess: boolean }
    ) => {
      if (!runId || activeRunIdRef.current === runId) return;
      activeRunIdRef.current = runId;
      setActiveRunId(runId);
      storeActiveRunId(runId);
      setSending(true);
      setError(null);
      setPlannerPanelOpen(true);

      try {
        const run = await waitForExecutiveRun(runId, (nextRun) => {
          setPlannerSteps(normalizePlannerSteps(nextRun.planner));
          setPlannerTrace(normalizePlannerTrace(nextRun.plannerTrace));
        });
        applyTerminalRun(run, fallbackMessages, options);
        clearStoredActiveRunId(runId);
      } catch (err) {
        if (isRecord(err) && err.status === 404) clearStoredActiveRunId(runId);
        if (isRecord(err) && err.status === 401) {
          handleSessionExpired();
          return;
        }
        setError(err instanceof Error ? `Execution error: ${err.message}` : 'Network error. Please try again later.');
      } finally {
        activeRunIdRef.current = null;
        setActiveRunId(null);
        setSending(false);
        setStoppingRun(false);
      }
    },
    [applyTerminalRun, handleSessionExpired]
  );

  const stopExecutiveRun = useCallback(async () => {
    const runId = activeRunIdRef.current || activeRunId;
    if (!runId || stoppingRun) return;
    setStoppingRun(true);
    setError(null);
    try {
      const res = await fetch('/api/investor/executive-assistant', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const data = (await res.json().catch(() => ({}))) as ExecutiveRunPollResult;
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        setError(typeof data.error === 'string' ? data.error : 'Failed to stop task');
        return;
      }
      activeRunIdRef.current = null;
      setActiveRunId(null);
      setSending(false);
      clearStoredActiveRunId(runId);
      setPlannerTrace(normalizePlannerTrace(data.plannerTrace || (isRecord(data.result) ? data.result.plannerTrace : null)));
      setError('This run has been stopped.');
    } catch (err) {
      setError(err instanceof Error ? `Failed to stop task: ${err.message}` : 'Failed to stop task. Please try again.');
    } finally {
      setStoppingRun(false);
    }
  }, [activeRunId, handleSessionExpired, stoppingRun]);

  const stopPersonalAgentRun = useCallback(async () => {
    const runId = activeRunIdRef.current || activeRunId;
    if (!runId || stoppingRun) return;
    requestedStopRunIdRef.current = runId;
    setStoppingRun(true);
    setError(null);
    try {
      const res = await fetch('/api/investor/personal-agent', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, threadId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        setError(typeof data.error === 'string' ? data.error : 'Failed to stop task');
        return;
      }
      setCodexStreamItems((prev) => compactCodexStreamItems([
        ...prev,
        {
          id: `personal-agent-stopped-${Date.now()}`,
          title: 'Stop requested',
          detail: 'The current task is being stopped',
          status: 'completed' as const,
          timestamp: new Date().toISOString(),
        },
      ]));
    } catch (err) {
      setError(err instanceof Error ? `Failed to stop task: ${err.message}` : 'Failed to stop task. Please try again.');
    } finally {
      setStoppingRun(false);
    }
  }, [activeRunId, handleSessionExpired, stoppingRun, threadId]);

  const refreshPersonalAgentStatus = useCallback(async (
    targetThreadId?: string | null
  ): Promise<PersonalAgentStatusRecoveryResult> => {
    try {
      const query = new URLSearchParams({
        status: '1',
      });
      if (targetThreadId) query.set('threadId', targetThreadId);
      const statusRunId = activeRunIdRef.current || activeRunId || '';
      if (statusRunId) query.set('runId', statusRunId);
      const res = await fetch(`/api/investor/personal-agent?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        if (res.status === 401) handleSessionExpired();
        return 'unavailable';
      }
      const recoveredThreadId = typeof data.threadId === 'string' ? data.threadId : '';
      if (recoveredThreadId) setThreadId(recoveredThreadId);
      if (Array.isArray(data.sessions)) {
        setSessions(data.sessions as AgentSessionSummary[]);
      }
      if (typeof data.hasMore === 'boolean') {
        setHasMoreMessages(data.hasMore);
      }
      const sandbox = isRecord(data.sandbox) ? data.sandbox : {};
      const activeRun = isRecord(data.activeRun) ? data.activeRun : {};
      const status = typeof sandbox.status === 'string'
        ? sandbox.status
        : isRecord(data.thread) && typeof data.thread.status === 'string'
          ? data.thread.status
          : '';
      const activeRunStatus = typeof activeRun.status === 'string' ? activeRun.status : '';
      const nextRunId = typeof sandbox.active_run_id === 'string'
        ? sandbox.active_run_id
        : typeof activeRun.id === 'string'
          ? activeRun.id
          : '';
      const expectedEventRunId = statusRunId || nextRunId;
      const recentEvents = Array.isArray(data.recentEvents) ? data.recentEvents : [];
      const projected = recentEvents
        .filter((row) => {
          if (!expectedEventRunId || !isRecord(row)) return true;
          const rowRunId = typeof row.run_id === 'string'
            ? row.run_id
            : typeof row.runId === 'string'
              ? row.runId
              : '';
          return !rowRunId || rowRunId === expectedEventRunId;
        })
        .map((row, index) => {
          if (!isRecord(row)) return null;
          const storedPayload = isRecord(row.payload) ? row.payload : {};
          const eventPayload = isRecord(storedPayload.payload) ? storedPayload.payload : {};
          const envelope = {
            type: 'event',
            event: {
              type: typeof row.type === 'string' ? row.type : 'agent_context.event',
              timestamp: typeof storedPayload.timestamp === 'string'
                ? storedPayload.timestamp
                : typeof row.created_at === 'string'
                  ? row.created_at
                  : new Date().toISOString(),
              payload: eventPayload,
            },
          };
          return projectCodexStreamItem(envelope, index);
        })
        .filter(Boolean) as CodexStreamItem[];

      if ((status === 'ACTIVE' || activeRunStatus === 'RUNNING' || activeRunStatus === 'QUEUED') && nextRunId) {
        activeRunIdRef.current = nextRunId;
        setActiveRunId(nextRunId);
        setSending(true);
        if (liveStreamRunIdRef.current === nextRunId) return 'active';
        if (projected.length > 0) setCodexStreamItems(compactCodexStreamItems(projected));
        return 'active';
      }

      const recentRuns = Array.isArray(data.recentRuns) ? data.recentRuns.filter(isRecord) : [];
      const latestTerminalRun = [activeRun, ...recentRuns].find((run) => {
        const runStatus = typeof run.status === 'string' ? run.status : '';
        return ['SUCCESS', 'ERROR', 'CANCELLED', 'TIMEOUT'].includes(runStatus);
      });
      const latestTerminalStatus = isRecord(latestTerminalRun) && typeof latestTerminalRun.status === 'string'
        ? latestTerminalRun.status
        : '';
      if (latestTerminalRun && latestTerminalStatus === 'SUCCESS') {
        activeRunIdRef.current = null;
        liveStreamRunIdRef.current = null;
        setActiveRunId(null);
        setSending(false);
        setAssistantDraft('');
        setCodexStreamItems([]);
        if (projected.length > 0) {
          setCompletedCodexActivity(buildCompletedActivityFromStatus({
            run: latestTerminalRun,
            events: projected,
          }));
        }

        const recoveredMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
        const result = isRecord(latestTerminalRun.result) ? latestTerminalRun.result : {};
        const reply = typeof result.reply === 'string' ? result.reply : '';
        if (recoveredMessages.length > 0) {
          setMessages(appendAssistantReplyIfMissing(recoveredMessages, reply));
        } else if (reply.trim()) {
          setMessages((prev) => appendAssistantReplyIfMissing(prev, reply));
        }
        setError(null);
        return 'success';
      }

      if (latestTerminalRun && latestTerminalStatus) {
        activeRunIdRef.current = null;
        liveStreamRunIdRef.current = null;
        setActiveRunId(null);
        setSending(false);
        setAssistantDraft('');
        setCodexStreamItems([]);
        if (projected.length > 0) {
          setCompletedCodexActivity(buildCompletedActivityFromStatus({
            run: latestTerminalRun,
            events: projected,
          }));
        }

        const recoveredMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
        if (recoveredMessages.length > 0) setMessages(recoveredMessages);
        const terminalError = typeof latestTerminalRun.error === 'string' && latestTerminalRun.error.trim()
          ? latestTerminalRun.error.trim()
            : latestTerminalStatus === 'CANCELLED'
              ? 'This run has been stopped.'
              : latestTerminalStatus === 'TIMEOUT'
                ? 'The run timed out.'
              : 'Failed to send message';
        setError(terminalError);
        return 'terminal';
      }

      if (activeRunIdRef.current === nextRunId || !nextRunId) {
        activeRunIdRef.current = null;
        liveStreamRunIdRef.current = null;
        setActiveRunId(null);
        setSending(false);
      }
      const recoveredMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
      if (recoveredMessages.length > 0) setMessages(recoveredMessages);
      return 'idle';
    } catch {
      // Status recovery is best-effort; the normal send flow still reports errors.
      return 'unavailable';
    }
  }, [activeRunId, handleSessionExpired]);

  const resetPersonalAgentRunState = useCallback(() => {
    activeRunIdRef.current = null;
    liveStreamRunIdRef.current = null;
    requestedStopRunIdRef.current = null;
    setActiveRunId(null);
    setSending(false);
    setStoppingRun(false);
    setPlannerTrace([]);
    setCodexStreamItems([]);
    setCompletedCodexActivity(null);
    setAssistantDraft('');
  }, []);

  const loadData = useCallback(async (targetThreadId?: string | null) => {
    if (!isExecutive) return;
    setLoading(true);
    setRecoveringRunState(true);
    setError(null);
    try {
      const query = new URLSearchParams({ sessions: '1' });
      if (targetThreadId) query.set('threadId', targetThreadId);
      const res = await fetch(`/api/investor/personal-agent?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        setError(data.error || 'Failed to load conversation');
        return;
      }
      resetPersonalAgentRunState();
      setThreadId(data.threadId || null);
      setSessions(Array.isArray(data.sessions) ? (data.sessions as AgentSessionSummary[]) : []);
      const loadedMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
      messagesAutoFollowRef.current = true;
      setMessages(loadedMessages);
      setHasMoreMessages(Boolean(data.hasMore));
      setBriefing(null);
      setPersistedBriefing(null);
      setPlannerSteps([]);
      if (data.threadId) {
        await refreshPersonalAgentStatus(String(data.threadId));
      }
      if (showExecutiveControls && getStoredActiveRunId()) {
        void resumeExecutiveRun(getStoredActiveRunId(), loadedMessages, { closePlannerOnSuccess: false });
      }
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      setLoading(false);
      setRecoveringRunState(false);
    }
  }, [handleSessionExpired, isExecutive, refreshPersonalAgentStatus, resetPersonalAgentRunState, resumeExecutiveRun, showExecutiveControls]);

  useEffect(() => {
    if (!threadId || !activeRunId) return;
    const timer = window.setInterval(() => {
      void refreshPersonalAgentStatus(threadId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeRunId, refreshPersonalAgentStatus, threadId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const createNewSession = useCallback(async () => {
    if (creatingSession || sending || recoveringRunState) return;
    setCreatingSession(true);
    setError(null);
    try {
      const res = await fetch('/api/investor/personal-agent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        setError(data.error || 'Failed to create a new chat');
        return;
      }
      resetPersonalAgentRunState();
      setThreadId(typeof data.threadId === 'string' ? data.threadId : null);
      messagesAutoFollowRef.current = true;
      setMessages([]);
      setHasMoreMessages(false);
      setSessions(Array.isArray(data.sessions) ? (data.sessions as AgentSessionSummary[]) : []);
      setInput('');
      setAttachments([]);
      window.requestAnimationFrame(() => {
        messagesViewportRef.current?.scrollTo({ top: 0 });
      });
    } catch {
      setError('Failed to create a new chat. Please try again.');
    } finally {
      setCreatingSession(false);
      setRecoveringRunState(false);
    }
  }, [creatingSession, handleSessionExpired, recoveringRunState, resetPersonalAgentRunState, sending]);

  const switchSession = useCallback(async (targetThreadId: string) => {
    if (!targetThreadId || targetThreadId === threadId || sending || recoveringRunState) return;
    setInput('');
    setAttachments([]);
    setOpenSessionMenuId(null);
    await loadData(targetThreadId);
  }, [loadData, recoveringRunState, sending, threadId]);

  const handleSessionAction = useCallback(async (
    session: AgentSessionSummary,
    action: 'rename' | 'archive' | 'delete'
  ) => {
    if (sending || recoveringRunState || sessionActionBusyId) return;
    setOpenSessionMenuId(null);

    let title: string | undefined;
    if (action === 'rename') {
      const nextTitle = window.prompt('Rename conversation', session.title || 'New conversation');
      if (nextTitle === null) return;
      title = nextTitle.replace(/\s+/g, ' ').trim();
      if (!title) {
        setError('Conversation title cannot be empty.');
        return;
      }
    }

    if (action === 'delete') {
      const confirmed = window.confirm('Delete this conversation? It will no longer be visible or accessible.');
      if (!confirmed) return;
    }

    setSessionActionBusyId(session.id);
    setError(null);
    try {
      const res = await fetch('/api/investor/personal-agent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          action,
          threadId: session.id,
          ...(title ? { title } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        sessions?: AgentSessionSummary[];
      };
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        setError(data.error || `Failed to ${action} conversation`);
        return;
      }

      const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
      setSessions(nextSessions);

      if ((action === 'archive' || action === 'delete') && session.id === threadId) {
        await loadData(nextSessions[0]?.id || null);
      }
    } catch {
      setError(`Failed to ${action} conversation. Please try again.`);
    } finally {
      setSessionActionBusyId(null);
    }
  }, [handleSessionExpired, loadData, recoveringRunState, sending, sessionActionBusyId, threadId]);

  useEffect(() => {
    if (!openSessionMenuId) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-session-menu-root="true"]')) return;
      setOpenSessionMenuId(null);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [openSessionMenuId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (suppressNextAutoScrollRef.current) {
        suppressNextAutoScrollRef.current = false;
        return;
      }
      if (!messagesAutoFollowRef.current) return;
      const viewport = messagesViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, loading, sending, codexStreamItems, assistantDraft]);

  const loadOlderMessages = useCallback(async () => {
    if (!threadId || !hasMoreMessages || loadingOlderMessagesRef.current) return;
    const firstMessageWithId = messages.find((message) => message.id);
    if (!firstMessageWithId?.id) return;

    const viewport = messagesViewportRef.current;
    const previousScrollHeight = viewport?.scrollHeight || 0;
    const previousScrollTop = viewport?.scrollTop || 0;
    loadingOlderMessagesRef.current = true;
    setLoadingOlderMessages(true);
    setError(null);

    try {
      const query = new URLSearchParams({
        threadId,
        before: firstMessageWithId.id,
        limit: '60',
      });
      const res = await fetch(`/api/investor/personal-agent?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        setError(data.error || 'Failed to load older messages');
        return;
      }

      const olderMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
      setHasMoreMessages(Boolean(data.hasMore));
      if (olderMessages.length === 0) return;

      suppressNextAutoScrollRef.current = true;
      setMessages((currentMessages) => {
        const existingIds = new Set(currentMessages.map((message) => message.id).filter(Boolean));
        const dedupedOlderMessages = olderMessages.filter((message) => !message.id || !existingIds.has(message.id));
        return [...dedupedOlderMessages, ...currentMessages];
      });

      window.requestAnimationFrame(() => {
        const nextViewport = messagesViewportRef.current;
        if (!nextViewport) return;
        nextViewport.scrollTop = nextViewport.scrollHeight - previousScrollHeight + previousScrollTop;
      });
    } catch {
      setError('Failed to load older messages. Please try again.');
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [handleSessionExpired, hasMoreMessages, messages, threadId]);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    messagesAutoFollowRef.current = isNearMessagesBottom(viewport);
    if (viewport.scrollTop > 80) return;
    if (!hasMoreMessages || loadingOlderMessagesRef.current || loading) return;
    void loadOlderMessages();
  }, [hasMoreMessages, loadOlderMessages, loading]);

  useEffect(() => {
    const prompt = searchParams.get('prompt')?.trim();
    if (prompt) setInput(prompt);
  }, [searchParams]);

  const uploadPendingAttachments = useCallback(async (items: PendingAttachment[]) => {
    if (items.length === 0) return;
    const itemIds = new Set(items.map((item) => item.id));
    setAttachments((prev) => prev.map((attachment) => (
      itemIds.has(attachment.id)
        ? { ...attachment, uploadStatus: 'uploading' as const, error: undefined }
        : attachment
    )));

    let uploadThreadId = threadId;
    let policyData: UploadPolicyResponse;
    try {
      const policyRes = await fetch('/api/investor/artifacts/upload-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          threadId: uploadThreadId,
          files: items.map((attachment) => ({
            name: attachment.name,
            mimeType: attachment.type || 'application/octet-stream',
            sizeBytes: attachment.size,
          })),
        }),
      });
      policyData = (await policyRes.json().catch(() => ({}))) as UploadPolicyResponse;
      if (!policyRes.ok) {
        if (policyRes.status === 401) {
          handleSessionExpired();
          return;
        }
        throw new Error(policyData.error || 'Failed to prepare attachment upload');
      }
      uploadThreadId = typeof policyData.threadId === 'string' ? policyData.threadId : uploadThreadId;
      if (uploadThreadId) setThreadId(uploadThreadId);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to prepare attachment upload';
      setError(detail);
      setAttachments((prev) => prev.map((attachment) => (
        itemIds.has(attachment.id)
          ? { ...attachment, uploadStatus: 'error' as const, error: detail }
          : attachment
      )));
      return;
    }

    const policyArtifacts = Array.isArray(policyData.artifacts) ? policyData.artifacts : [];
    const completedIds: string[] = [];
    for (const [index, attachment] of items.entries()) {
      const artifact = policyArtifacts[index];
      if (!artifact?.id) {
        const detail = 'Upload policy did not return an artifact id.';
        setAttachments((prev) => prev.map((item) => (
          item.id === attachment.id ? { ...item, uploadStatus: 'error' as const, error: detail } : item
        )));
        continue;
      }
      try {
        await uploadAttachmentToOss(attachment, artifact);
        completedIds.push(artifact.id);
        setAttachments((prev) => prev.map((item) => (
          item.id === attachment.id
            ? {
                ...item,
                uploadStatus: 'uploaded' as const,
                artifactId: artifact.id,
                threadId: uploadThreadId || undefined,
                downloadPath: artifact.downloadPath || null,
                error: undefined,
              }
            : item
        )));
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Attachment upload failed';
        setAttachments((prev) => prev.map((item) => (
          item.id === attachment.id
            ? { ...item, uploadStatus: 'error' as const, artifactId: artifact.id, error: detail }
            : item
        )));
      }
    }

    if (!uploadThreadId || completedIds.length === 0) return;
    try {
      const completeRes = await fetch('/api/investor/artifacts/complete-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          threadId: uploadThreadId,
          artifactIds: completedIds,
        }),
      });
      const completeData = (await completeRes.json().catch(() => ({}))) as { artifacts?: DirectUploadArtifact[]; error?: string };
      if (!completeRes.ok) throw new Error(completeData.error || 'Failed to finalize attachment upload');
      const byId = new Map((completeData.artifacts || []).map((artifact) => [artifact.id, artifact]));
      setAttachments((prev) => prev.map((attachment) => {
        if (!attachment.artifactId) return attachment;
        const artifact = byId.get(attachment.artifactId);
        if (!artifact) return attachment;
        return {
          ...attachment,
          downloadPath: artifact.downloadPath || attachment.downloadPath || null,
        };
      }));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to finalize attachment upload');
    }
  }, [handleSessionExpired, threadId]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    const oversized = selectedFiles.find((file) => file.size > MAX_ATTACHMENT_FILE_BYTES);
    if (oversized) {
      setError(`${oversized.name} exceeds the ${formatBytes(MAX_ATTACHMENT_FILE_BYTES)} file size limit. Please compress it and try again.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (attachments.length + selectedFiles.length > MAX_ATTACHMENT_FILES) {
      setError(`You can attach up to ${MAX_ATTACHMENT_FILES} files.`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const pending = selectedFiles.map(createPendingAttachment);
    setAttachments((prev) => [...prev, ...pending].slice(0, MAX_ATTACHMENT_FILES));
    void uploadPendingAttachments(pending);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== id));
  };

  const syncLatestPersonalAgentMessages = useCallback(async (
    targetThreadId?: string | null
  ): Promise<ChatMessage[]> => {
    const query = new URLSearchParams({ sessions: '1' });
    if (targetThreadId) query.set('threadId', targetThreadId);
    const res = await fetch(`/api/investor/personal-agent?${query.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 401) handleSessionExpired();
      return [];
    }
    const syncedThreadId = typeof data.threadId === 'string' ? data.threadId : '';
    if (syncedThreadId) setThreadId(syncedThreadId);
    if (Array.isArray(data.sessions)) {
      setSessions(data.sessions as AgentSessionSummary[]);
    }
    if (typeof data.hasMore === 'boolean') {
      setHasMoreMessages(data.hasMore);
    }
    const syncedMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
    if (syncedMessages.length > 0) setMessages(syncedMessages);
    return syncedMessages;
  }, [handleSessionExpired]);

  const hasSyncedCurrentUserTurn = useCallback(async (
    expectedUserContent: string,
    targetThreadId?: string | null
  ) => {
    const syncedMessages = await syncLatestPersonalAgentMessages(targetThreadId);
    const expected = normalizeMessageContentForRecovery(expectedUserContent);
    return syncedMessages.some((message) => (
      message.role === 'user' &&
      normalizeMessageContentForRecovery(message.content) === expected
    ));
  }, [syncLatestPersonalAgentMessages]);

  const recoverPersonalAgentStreamState = useCallback(async (
    targetThreadId: string | null | undefined,
    expectedUserContent: string
  ): Promise<PersonalAgentStreamRecoveryResult> => {
    setRecoveringRunState(true);
    setCodexStreamItems((prev) => compactCodexStreamItems([
      ...prev,
      {
        id: `stream-recovery-${Date.now()}`,
        title: 'Connection interrupted; recovering',
        detail: 'Checking whether the background task was created',
        status: 'running' as const,
        timestamp: new Date().toISOString(),
      },
    ]));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const knownRunId = activeRunIdRef.current || liveStreamRunIdRef.current || '';
      try {
        const query = new URLSearchParams({ status: '1' });
        const statusThreadId = targetThreadId || threadId;
        if (statusThreadId) query.set('threadId', statusThreadId);
        const res = await fetch(`/api/investor/personal-agent?${query.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          if (res.status === 401) {
            handleSessionExpired();
            return 'failed';
          }
          await sleep(1000 + attempt * 500);
          continue;
        }

        const hasCurrentTurn = messagesContainUserTurn(data.messages, expectedUserContent);
        const sandbox = isRecord(data.sandbox) ? data.sandbox : {};
        const activeRun = isRecord(data.activeRun) ? data.activeRun : {};
        const status = typeof sandbox.status === 'string'
          ? sandbox.status
          : isRecord(data.thread) && typeof data.thread.status === 'string'
            ? data.thread.status
            : '';
        const activeRunStatus = typeof activeRun.status === 'string' ? activeRun.status : '';
        const nextRunId = typeof sandbox.active_run_id === 'string'
          ? sandbox.active_run_id
          : typeof activeRun.id === 'string'
            ? activeRun.id
            : '';

        if ((status === 'ACTIVE' || activeRunStatus === 'RUNNING' || activeRunStatus === 'QUEUED') && nextRunId) {
          if (!hasCurrentTurn && !knownRunId) return 'failed';
          const applied = await refreshPersonalAgentStatus(statusThreadId);
          if (applied !== 'active') return applied === 'success' || applied === 'terminal' ? 'recovered' : 'failed';
          setError(null);
          setCodexStreamItems((prev) => compactCodexStreamItems([
            ...prev,
            {
              id: `stream-recovery-active-${Date.now()}`,
              title: 'Switched to background recovery',
              detail: 'The connection was interrupted; the result will sync back into this chat when it finishes',
              status: 'running' as const,
              timestamp: new Date().toISOString(),
            },
          ]));
          return 'active';
        }

        const recentRuns = Array.isArray(data.recentRuns) ? data.recentRuns.filter(isRecord) : [];
        const latestTerminalRun = [activeRun, ...recentRuns].find((run) => {
          const runStatus = typeof run.status === 'string' ? run.status : '';
          return ['SUCCESS', 'ERROR', 'CANCELLED', 'TIMEOUT'].includes(runStatus);
        });
        if (latestTerminalRun) {
          if (!hasCurrentTurn && !knownRunId) return 'failed';
          const applied = await refreshPersonalAgentStatus(statusThreadId);
          return applied === 'success' || applied === 'terminal' ? 'recovered' : 'failed';
        }
      } catch {
        // Keep retrying; the outer send path will surface the original network error.
      }
      await sleep(1000 + attempt * 500);
    }

    const hasCurrentTurn = await hasSyncedCurrentUserTurn(expectedUserContent, targetThreadId || threadId);
    if (hasCurrentTurn) return 'saved';
    return 'failed';
  }, [handleSessionExpired, hasSyncedCurrentUserTurn, refreshPersonalAgentStatus, threadId]);

  const handleSend = async (textFromSuggestion?: string) => {
    const content = (textFromSuggestion || input).trim();
    const requestAttachments = attachments;
    const hasAttachments = requestAttachments.length > 0;
    if ((!content && !hasAttachments) || sending || recoveringRunState || !isExecutive) return;
    const unfinishedAttachment = requestAttachments.find((attachment) => attachment.uploadStatus !== 'uploaded');
    if (unfinishedAttachment) {
      setError(
        unfinishedAttachment.uploadStatus === 'error'
          ? `${unfinishedAttachment.name} failed to upload. Remove it or try attaching it again.`
          : 'Please wait for attachments to finish uploading.'
      );
      return;
    }
    const uploadedArtifacts = requestAttachments.map((attachment) => ({
      id: attachment.artifactId || '',
      name: attachment.name,
      type: attachment.type || 'application/octet-stream',
      size: attachment.size,
      kind: attachment.kind,
      downloadPath: attachment.downloadPath || null,
    })).filter((artifact) => artifact.id);
    const attachmentThreadId = requestAttachments.find((attachment) => attachment.threadId)?.threadId || null;
    const requestThreadId = threadId || attachmentThreadId;

    const attachmentList = formatAttachmentList(requestAttachments);
    const displayContent = [
      content || 'Please analyze the attached files.',
      attachmentList ? `Attachments:\n${attachmentList}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const nextMessages = [...messages, { role: 'user' as const, content: displayContent }];
    messagesAutoFollowRef.current = true;
    setMessages(nextMessages);
    setInput('');
    setAttachments([]);
    setSending(true);
    setError(null);
    setPlannerTrace([]);
    setCodexStreamItems([]);
    setCompletedCodexActivity(null);
    setAssistantDraft('');
    setPlannerPanelOpen(false);
    codexEventIndexRef.current = 0;
    activeRunIdRef.current = null;
    liveStreamRunIdRef.current = null;
    setActiveRunId(null);
    requestedStopRunIdRef.current = null;
    let preserveRunStateAfterSend = false;
    const clientRequestId = createClientRequestId();

    try {
      const buildRequestBody = () => (
        JSON.stringify({
          threadId: requestThreadId,
          message: content,
          displayMessage: displayContent,
          hermesModel,
          clientRequestId,
          connectorScope,
          uploadedArtifacts,
        })
      );

      let res: Response | null = null;
      let lastStartError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await fetch('/api/investor/personal-agent?async=1', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: buildRequestBody(),
            credentials: 'same-origin',
          });
          break;
        } catch (err) {
          lastStartError = err;
          if (attempt >= 2) break;
          setCodexStreamItems((prev) => compactCodexStreamItems([
            ...prev,
            {
              id: `personal-agent-start-retry-${clientRequestId}-${attempt}`,
              title: 'Task creation interrupted; retrying',
              detail: `Attempt ${attempt + 2}`,
              status: 'running' as const,
              timestamp: new Date().toISOString(),
            },
          ]));
          await sleep(600 + attempt * 900);
        }
      }
      if (!res) throw lastStartError || new Error('Failed to fetch');

      const data = (await res.json().catch(() => ({}))) as PersonalAgentFinalData & {
        status?: string;
        pollIntervalMs?: number;
        hasMore?: boolean;
      };
      if (!res.ok) {
        if (res.status === 401) {
          setMessages(nextMessages);
          setInput(content);
          setAttachments(requestAttachments);
          handleSessionExpired();
          return;
        }
        setError(typeof data.error === 'string' ? data.error : 'Failed to send message');
        setMessages(nextMessages);
        setInput(content);
        setAttachments(requestAttachments);
        return;
      }

      const asyncThreadId = typeof data.threadId === 'string' ? data.threadId : threadId;
      const runId = typeof data.runId === 'string' ? data.runId : '';
      if (!runId) {
        setError('Failed to start background task: missing runId');
        setMessages(nextMessages);
        setInput(content);
        setAttachments(requestAttachments);
        return;
      }

      if (asyncThreadId) setThreadId(asyncThreadId);
      if (Array.isArray(data.sessions)) setSessions(data.sessions);
      if (typeof data.hasMore === 'boolean') setHasMoreMessages(data.hasMore);
      if (Array.isArray(data.messages) && data.messages.length >= nextMessages.length) {
        setMessages(data.messages);
      }
      activeRunIdRef.current = runId;
      liveStreamRunIdRef.current = null;
      setActiveRunId(runId);
      setCodexStreamItems([
        {
          id: `async-run-${runId}`,
          title: 'Thinking',
          detail: 'Starting the agent loop',
          status: 'running' as const,
          timestamp: new Date().toISOString(),
        },
      ]);
      preserveRunStateAfterSend = true;
      void refreshPersonalAgentStatus(asyncThreadId);
    } catch (err) {
      const recoveryResult = await recoverPersonalAgentStreamState(threadId, displayContent);
      if (recoveryResult === 'active') {
        preserveRunStateAfterSend = true;
        return;
      }
      if (recoveryResult === 'recovered') return;
      if (recoveryResult === 'saved') {
        setError('The network connection was interrupted. This message was saved; refresh this chat later to view the result.');
        return;
      }

      setError(err instanceof Error ? `Network error: ${err.message}` : 'Network error. Please try again later.');
      setMessages(nextMessages);
      setInput(content);
      setAttachments(requestAttachments);
      setCodexStreamItems([]);
      setCompletedCodexActivity(null);
      setAssistantDraft('');
    } finally {
      if (!preserveRunStateAfterSend) {
        activeRunIdRef.current = null;
        liveStreamRunIdRef.current = null;
        setActiveRunId(null);
        setSending(false);
      }
      setStoppingRun(false);
      setRecoveringRunState(false);
    }
  };

  const openPromptEditor = () => {
    const nextOpen = !promptEditorOpen;
    setPromptEditorOpen(nextOpen);
    setPromptMessage(null);
    if (!nextOpen) return;
    window.setTimeout(() => {
      promptEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  const savePrompt = async (resetToDefault = false) => {
    if (promptSaving) return;
    const nextPrompt = resetToDefault ? defaultPrompt : promptDraft.trim();
    if (!resetToDefault && !nextPrompt) {
      setPromptMessage('System prompt cannot be empty.');
      return;
    }

    setPromptSaving(true);
    setPromptMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/investor/executive-assistant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetToDefault ? { resetToDefault: true } : { systemPrompt: nextPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          handleSessionExpired();
          return;
        }
        setPromptMessage(data.error || 'Save system prompt failed');
        return;
      }

      applyAgentConfig(data.agentConfig);
      setPromptMessage(resetToDefault ? 'Default system prompt restored. It will apply to future replies.' : 'Saved. It will apply to future replies.');
    } catch {
      setPromptMessage('Network error. Please try again later.');
    } finally {
      setPromptSaving(false);
    }
  };

  if (!isExecutive) {
    return (
      <FigmaShell
        homeHref="/dashboard"
        title="AI Assistant"
        subtitle="Only Executive Assistant Momo is available right now"
        actions={
          <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
            Back to workspace
          </Link>
        }
      >
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-600">
          This assistant is not available yet. Return to the workspace and use Executive Assistant Momo.
        </div>
      </FigmaShell>
    );
  }

  return (
    <FigmaShell
      homeHref="/dashboard"
      title={title}
      subtitle="Long-term memory, live research, and multi-agent task execution"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {showExecutiveControls ? (
            <button
              type="button"
              onClick={openPromptEditor}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {promptEditorOpen ? 'Collapse system prompt' : 'Edit system prompt'}
            </button>
          ) : null}
          <Link href="/dashboard" className="px-2 text-sm text-blue-700 hover:underline">
            Back to workspace
          </Link>
        </div>
      }
    >
      {showExecutiveControls && promptEditorOpen ? (
        <div ref={promptEditorRef} className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Executive Assistant system prompt</h2>
              <p className="mt-1 text-sm text-slate-500">
                Account-level instructions for Momo. Saved changes apply to future replies.
              </p>
            </div>
            <span
              className={`self-start rounded-full px-2 py-1 text-xs ${
                hasCustomPrompt ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {hasCustomPrompt ? 'Custom' : 'Default'}
            </span>
          </div>

          <textarea
            value={promptDraft}
            onChange={(e) => {
              setPromptDraft(e.target.value);
              setPromptMessage(null);
            }}
            rows={14}
            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm leading-6 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter the system prompt for Executive Assistant Momo..."
          />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Current length {promptDraft.length}/30000
              {promptDraft !== promptSaved ? ' · Unsaved changes' : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={promptSaving || promptDraft === promptSaved}
                onClick={() => {
                  setPromptDraft(promptSaved);
                  setPromptMessage(null);
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Discard changes
              </button>
              <button
                type="button"
                disabled={promptSaving || !defaultPrompt}
                onClick={() => void savePrompt(true)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Restore default
              </button>
              <button
                type="button"
                disabled={promptSaving || !promptDraft.trim()}
                onClick={() => void savePrompt(false)}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {promptSaving ? 'Saving...' : 'Save and apply'}
              </button>
            </div>
          </div>
          {promptMessage ? (
            <p className={`mt-3 text-sm ${promptMessage.includes('failed') || promptMessage.includes('Error') || promptMessage.includes('empty') ? 'text-red-600' : 'text-emerald-700'}`}>
              {promptMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {showExecutiveControls ? (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Momo Planner</h2>
            <p className="mt-1 text-sm text-slate-500">
              Momo generates a plan for each request. The panel opens during execution and collapses when the task is done.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sending && activeRunId ? (
              <button
                type="button"
                onClick={() => void stopExecutiveRun()}
                disabled={stoppingRun}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {stoppingRun ? 'Stopping...' : 'Force stop'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPlannerPanelOpen((open) => !open)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                hasPlannerErrors
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {plannerPanelOpen ? 'Collapse details' : plannerButtonText}
            </button>
          </div>
        </div>

        {plannerPanelOpen ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">Current plan</h3>
              <div className="mt-3 space-y-2">
                {plannerSteps.length > 0 ? (
                  plannerSteps.map((step) => {
                    const trace = latestPlannerStatuses.get(step.id);
                    const status = trace?.status || 'PENDING';
                    return (
                      <div key={step.id} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-900">
                              {step.title}
                              {step.agentType ? <span className="ml-2 text-xs text-slate-400">{step.agentType}</span> : null}
                            </p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{step.description}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${plannerStatusClass[status]}`}>
                            {plannerStatusLabel[status]}
                          </span>
                        </div>
                        {trace?.detail ? <p className="mt-2 text-xs text-slate-600">{trace.detail}</p> : null}
                        {trace?.error ? <p className="mt-2 text-xs text-red-600">{trace.error}</p> : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">Send a request to see the plan Momo generates for this task.</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-slate-100">
              <h3 className="text-sm font-semibold">Execution details</h3>
              <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                {plannerTrace.length > 0 ? (
                  plannerTrace.map((item, index) => {
                    const payloadText = formatPlannerPayload(item.payload);
                    return (
                      <div key={`${item.id}-${item.timestamp}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="mt-1 text-xs text-slate-400">{item.timestamp || 'Time unavailable'}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${plannerStatusClass[item.status]}`}>
                            {plannerStatusLabel[item.status]}
                          </span>
                        </div>
                        {item.detail ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-300">{item.detail}</p> : null}
                        {item.error ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-red-300">{item.error}</p> : null}
                        {payloadText ? (
                          <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-[11px] leading-5 text-slate-300">
                            {payloadText}
                          </pre>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">Send a message to start a new turn.</p>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      ) : null}

      {showExecutiveControls && briefing ? (
        <ExecutiveDailyBriefingBrowser
          briefing={briefing}
          persistedBriefing={persistedBriefing}
          updating={sending}
          onUpdateBriefing={() => void handleSend(EXECUTIVE_UPDATE_BRIEFING_PROMPT)}
          onPromptRequest={(prompt) => setInput(prompt)}
        />
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <MessageSquare className="h-4 w-4 text-slate-500" />
                <span>Conversation</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Profile memory and long-term preferences are shared across chats. Conversation context, attachments, and workspace files stay scoped to each chat.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                <span className="text-xs font-medium text-slate-500">Hermes</span>
                <select
                  value={hermesModel}
                  onChange={(event) => setHermesModel(normalizeHermesModelOption(event.target.value))}
                  disabled={sending || recoveringRunState}
                  title={`Current: ${selectedHermesModel.detail}`}
                  className="bg-transparent text-sm font-semibold text-slate-900 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {hermesModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void createNewSession()}
                disabled={creatingSession || sending || recoveringRunState}
                title="New chat"
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {creatingSession ? 'Creating...' : 'New chat'}
              </button>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {sessions.length > 0 ? (
              sessions.map((session) => {
                const active = session.id === threadId;
                const actionBusy = sessionActionBusyId === session.id;
                return (
                  <div
                    key={session.id}
                    data-session-menu-root="true"
                    className={[
                      'group relative min-w-[11rem] max-w-[14rem] rounded-lg border transition',
                      active
                        ? 'border-blue-300 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      onClick={() => void switchSession(session.id)}
                      disabled={active || sending || recoveringRunState || actionBusy}
                      title={session.title}
                      className="block w-full rounded-lg px-3 py-2 pr-10 text-left disabled:cursor-default disabled:opacity-60"
                    >
                      <span className="block truncate text-sm font-medium">{session.title || 'New chat'}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {session.messageCount} messages{formatSessionTime(session.updatedAt) ? ` · ${formatSessionTime(session.updatedAt)}` : ''}
                      </span>
                    </button>
                    <button
                      type="button"
                      title="More Option"
                      aria-label={`More options for ${session.title || 'conversation'}`}
                      aria-haspopup="menu"
                      aria-expanded={openSessionMenuId === session.id}
                      disabled={sending || recoveringRunState || actionBusy}
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenSessionMenuId((current) => current === session.id ? null : session.id);
                      }}
                      className={[
                        'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border text-slate-500 shadow-sm transition',
                        openSessionMenuId === session.id
                          ? 'border-slate-300 bg-white opacity-100'
                          : 'border-transparent bg-white/80 opacity-0 hover:border-slate-200 hover:bg-white group-hover:opacity-100',
                        'disabled:cursor-not-allowed disabled:opacity-40',
                      ].join(' ')}
                    >
                      {actionBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                    </button>
                    {openSessionMenuId === session.id ? (
                      <div
                        role="menu"
                        className="absolute right-2 top-10 z-40 w-40 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleSessionAction(session, 'rename')}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                        >
                          <Pencil className="h-4 w-4" />
                          Rename
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleSessionAction(session, 'archive')}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"
                        >
                          <Archive className="h-4 w-4" />
                          Archive
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleSessionAction(session, 'delete')}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
                Send the first message to create a chat.
              </div>
            )}
          </div>
        </div>

        <div
          ref={messagesViewportRef}
          onScroll={handleMessagesScroll}
          className="h-[52vh] overflow-y-auto p-4 sm:h-[56vh] sm:p-5"
        >
          {loading ? (
            <div className="py-8 text-center text-slate-600">Loading...</div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.length > 0 ? (
                <div className="flex justify-center">
                  {hasMoreMessages ? (
                    <button
                      type="button"
                      onClick={() => void loadOlderMessages()}
                      disabled={loadingOlderMessages}
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {loadingOlderMessages ? 'Loading...' : 'Load earlier messages'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">Beginning of chat</span>
                  )}
                </div>
              ) : null}
              {messages.map((message, index) => {
                const showCompletedActivity =
                  completedCodexActivity &&
                  message.role === 'assistant' &&
                  index === messages.length - 1 &&
                  !sending &&
                  !assistantDraft;
                const artifacts = messageArtifacts(message);
                const visibleContent = message.role === 'assistant' && artifacts.length > 0
                  ? stripGeneratedFileLinks(message.content)
                  : message.content;
                const hasInlineMedia = message.role === 'assistant' && extractPreviewMediaLinks(visibleContent).length > 0;
                const bubbleWidthClass = message.role === 'assistant' && (artifacts.length > 0 || hasInlineMedia)
                  ? 'max-w-[92%] sm:max-w-2xl lg:max-w-3xl'
                  : 'max-w-[85%] sm:max-w-xs lg:max-w-md';
                return (
                  <div key={message.id || `${message.role}-${index}`} className="space-y-3">
                    {showCompletedActivity ? <CompletedCodexActivitySummary activity={completedCodexActivity} /> : null}
                    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`${bubbleWidthClass} rounded-2xl px-4 py-3 ${
                          message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'
                        }`}
                      >
                        {visibleContent ? (
                          <MarkdownMessage
                            content={visibleContent}
                            inverted={message.role === 'user'}
                            renderMediaPreview={({ href, label, kind, key }) => (
                              <InlineMediaPreview key={key} href={href} label={label} kind={kind} inverted={message.role === 'user'} />
                            )}
                          />
                        ) : null}
                        <GeneratedArtifactPreviews artifacts={artifacts} inverted={message.role === 'user'} />
                      </div>
                    </div>
                  </div>
                );
              })}
              <CodexStreamOutput items={codexStreamItems} active={sending} />
              <StreamingAssistantMessage content={assistantDraft} />
              {messages.length === 0 ? <div className="py-8 text-center text-slate-500">Start a conversation with your Hermes Agent.</div> : null}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto mb-3 flex max-w-3xl flex-wrap gap-2">
            {suggestedQuestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => void handleSend(question)}
                disabled={sending}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="mx-auto flex max-w-3xl flex-col gap-3"
          >
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-600">
                  <Plug className="h-3.5 w-3.5 shrink-0" />
                  <span>Connectors for this turn</span>
                  <span className="text-slate-400">
                    {connectorsLoading ? 'Loading' : `${activeConnectors.length}/${connectors.filter((connector) => connector.connected).length} enabled`}
                  </span>
                </div>
                <Link
                  href="/investor/info-ops"
                  className="inline-flex items-center gap-1 self-start text-xs font-medium text-blue-700 hover:underline sm:self-auto"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  Manage connectors
                </Link>
              </div>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {connectors.length > 0 ? (
                  connectors.map((connector) => {
                    const selected = connector.connected && selectedConnectorKeys.includes(connector.key);
                    const disabled = sending || recoveringRunState || !connector.connected;
                    const accountLabel = connector.accounts.length > 0
                      ? connector.accounts.map((account) => account.displayName || account.accountEmail).filter(Boolean).join(', ')
                      : connector.platformConfigured === false
                        ? 'Platform credentials are not configured'
                        : connector.connected
                          ? 'Connected'
                          : 'Not connected';
                    return (
                      <button
                        key={connector.key}
                        type="button"
                        onClick={() => {
                          if (connector.connected) toggleConnector(connector.key);
                        }}
                        disabled={disabled}
                        title={`${connector.label}: ${connector.description}${accountLabel ? `\n${accountLabel}` : ''}`}
                        className={[
                          'inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border px-2.5 text-xs transition disabled:cursor-not-allowed',
                          selected
                            ? 'border-blue-300 bg-blue-50 text-blue-800'
                            : connector.connected
                              ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-60'
                              : 'border-slate-200 bg-white text-slate-400 opacity-75',
                        ].join(' ')}
                      >
                        <span className={`h-2 w-2 rounded-full ${selected ? 'bg-blue-600' : connector.connected ? 'bg-slate-300' : 'bg-slate-200'}`} />
                        <span className="max-w-36 truncate">{connector.label}</span>
                      </button>
                    );
                  })
                ) : (
                  <span className="text-xs text-slate-400">
                    {connectorsError || (connectorsLoading ? 'Loading connectors...' : 'No connectors available')}
                  </span>
                )}
              </div>
              {connectorsError ? <p className="mt-1 text-xs text-amber-700">{connectorsError}</p> : null}
            </div>

            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    <span className="min-w-0 truncate">{attachment.name}</span>
                    <span className="shrink-0 text-slate-400">{formatBytes(attachment.size)}</span>
                    <span className={`hidden shrink-0 items-center gap-1 sm:inline-flex ${attachmentUploadStatusClass(attachment)}`}>
                      {attachment.uploadStatus === 'uploaded' ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : attachment.uploadStatus === 'error' ? (
                        <AlertCircle className="h-3.5 w-3.5" />
                      ) : (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {attachmentUploadStatusLabel(attachment)}
                    </span>
                    <button
                      type="button"
                      title="Remove attachment"
                      onClick={() => removeAttachment(attachment.id)}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your question..."
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                className="min-h-[7rem] flex-1 resize-none rounded-xl border border-slate-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 sm:min-h-0 sm:py-2"
              />
              <div className="flex gap-2 sm:self-end">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={attachmentAccept}
                  className="hidden"
                  onChange={(e) => handleFilesSelected(e.target.files)}
                />
                <button
                  type="button"
                  title="Add attachment"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || recoveringRunState || attachmentUploadBusy}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50 sm:h-9 sm:w-9"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                {sending || recoveringRunState ? (
                  <button
                    type="button"
                    onClick={() => void stopPersonalAgentRun()}
                    disabled={recoveringRunState || stoppingRun || !activeRunId}
                    className={[
                      'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 sm:py-2',
                      recoveringRunState ? 'bg-slate-500' : 'bg-red-600 hover:bg-red-700',
                    ].join(' ')}
                    title={
                      recoveringRunState
                        ? 'Recovering task state'
                        : activeRunId
                          ? 'Stop this task'
                          : 'Preparing task'
                    }
                  >
                    {recoveringRunState ? null : <Square className="h-3.5 w-3.5 fill-current" />}
                    {recoveringRunState ? 'Recovering...' : stoppingRun ? 'Stopping...' : activeRunId ? 'Stop' : 'Preparing...'}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={(!input.trim() && attachments.length === 0) || attachmentUploadBusy || attachmentUploadFailed}
                    className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:py-2"
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </form>

          {error ? <p className="mx-auto mt-3 max-w-3xl text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    </FigmaShell>
  );
}
