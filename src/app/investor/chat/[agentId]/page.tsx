'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, Archive, ArrowUp, Check, CheckCircle2, ChevronDown, CircleGauge, Clock3, Download, ExternalLink, FileText, Film, ImageIcon, Info, LoaderCircle, MessageSquare, MoreHorizontal, Paperclip, Pencil, Plug, Plus, Settings2, ShieldCheck, Square, Trash2, X } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FigmaShell } from '@/components/figma-shell';
import { AstromarWorkspaceShell } from '@/components/astromar-workspace-shell';
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
  submission?: {
    status: 'AUTHORIZING' | 'QUEUED' | 'RUNNING' | 'REJECTED';
    runId?: string | null;
    code?: string | null;
    error?: string | null;
  };
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
  code?: string;
};

type BillingCapacityData = {
  mode: 'observe' | 'enforce';
  account: {
    balanceCredits: number;
    reservedCredits: number;
    availableCredits: number;
  };
  subscription: {
    planKey: string;
    planName: string;
    concurrentTaskLimit: number;
  };
  capacity: {
    activeTaskCount: number;
    availableTaskSlots: number;
    concurrencyHoldCredits: number;
    hasCreditAuthorization: boolean;
    canStartTask: boolean;
  };
  activeTasks: Array<{
    runId: string;
    threadId: string | null;
    reservedCredits: number;
    createdAt: string;
    expiresAt: string;
  }>;
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
  conversationAvailable?: boolean;
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

function dragEventHasFiles(event: ReactDragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types || []).includes('Files');
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
  const hasLiveAgentMessage = nativeVisible.some((item) => (
    item.method === 'codex.agent_message.delta' ||
    item.method === 'codex.agent_message.final'
  ));
  const visible = hasTaskComplete && !hasLiveAgentMessage
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
      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.055] px-4 py-3 text-sm leading-6 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-white/10 bg-white/[0.045] px-2.5 py-1 text-xs font-semibold text-zinc-400 hover:border-white/20 hover:text-zinc-100">
        <ChevronDown className="h-3 w-3 transition group-open/output:rotate-180" />
        Output
      </summary>
      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/[0.35] px-3 py-2 text-xs leading-5 text-zinc-200">
        {content}
      </pre>
    </details>
  );
}

function CodexActivityIcon({ item }: { item: CodexStreamItem }) {
  if (item.status === 'error') {
    return (
      <span className="grid h-8 w-8 place-items-center rounded-xl border border-red-400/25 bg-red-400/10">
        <AlertCircle className="h-4 w-4 text-red-300" />
      </span>
    );
  }
  if (item.status === 'completed') {
    return (
      <span className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-400/10">
        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
      </span>
    );
  }
  return (
    <span className="grid h-8 w-8 place-items-center rounded-xl border border-blue-400/25 bg-blue-400/10">
      <span className="h-3.5 w-3.5 rounded-full bg-gradient-to-br from-blue-400 to-violet-400 shadow-[0_0_18px_rgba(52,120,246,0.65)] agent-activity-pulse" />
    </span>
  );
}

function ActivityStepShell({
  item,
  index,
  total,
  durationMs,
  active,
}: {
  item: CodexStreamItem;
  index: number;
  total: number;
  durationMs?: number;
  active?: boolean;
}) {
  const content = item.content ? formatCodexContent(item.content) : '';
  const links = extractLinks(item.detail, content);
  const status = active && item.status !== 'error' ? 'running' : item.status === 'error' ? 'error' : 'completed';
  const displayItem: CodexStreamItem = { ...item, status };
  const showExpanded = active || status === 'error' || Boolean(content) || links.length > 0;

  return (
    <article
      className={[
        'agent-activity-enter relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3',
        index < total - 1 ? 'pb-3' : '',
      ].join(' ')}
      style={{ animationDelay: `${Math.min(index * 45, 240)}ms` }}
    >
      <div className="relative z-10">
        <CodexActivityIcon item={displayItem} />
        {index < total - 1 ? (
          <span className="absolute left-4 top-9 h-[calc(100%+0.5rem)] w-px bg-gradient-to-b from-white/18 to-white/5" />
        ) : null}
      </div>
      <div
        className={[
          'min-w-0 rounded-2xl border px-4 py-3 transition-all',
          active
            ? 'border-white/[0.14] bg-white/[0.065] shadow-[0_22px_70px_rgba(0,0,0,0.34)] agent-activity-glow'
            : 'border-transparent bg-transparent',
        ].join(' ')}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="break-words text-[0.98rem] font-semibold text-zinc-50">
                {active ? codexActionLabel(item) : codexCompletedActionLabel(item)}
              </span>
              {item.method ? (
                <span className="max-w-full truncate rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-xs font-semibold text-zinc-400">
                  {item.method.replace(/^codex\./, '')}
                </span>
              ) : null}
            </div>
            <p className="mt-1 break-words text-sm leading-6 text-zinc-400">{codexCompactDetail(item)}</p>
          </div>
          <div className="shrink-0 text-right text-xs text-zinc-500">
            <div>{index + 1} / {total}</div>
            {typeof durationMs === 'number' && durationMs > 0 ? <div className="mt-1">{formatDuration(durationMs)}</div> : null}
          </div>
        </div>

        {showExpanded ? (
          <div className="mt-3 border-l border-white/10 pl-4">
            {links.length > 0 ? (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {links.map((link) => (
                  <a
                    key={link}
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-full truncate rounded-full border border-blue-300/20 bg-blue-400/10 px-2.5 py-1 text-xs font-medium text-blue-200 hover:border-blue-200/40 hover:bg-blue-400/20"
                  >
                    {link}
                  </a>
                ))}
              </div>
            ) : null}
            <ActivityContent item={displayItem} content={content} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function CompletedCodexActivitySummary({ activity }: { activity: CompletedCodexActivity }) {
  const items = compactCodexStreamItems(activity.items, 18);
  const completedAtMs =
    timestampMs(activity.completedAt) ||
    timestampMs(items[items.length - 1]?.timestamp || '') ||
    0;

  if (items.length === 0) return null;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-4xl rounded-[1.65rem] border border-white/10 bg-[#1f1f1f] px-4 py-4 text-sm text-zinc-300 shadow-[0_24px_90px_rgba(0,0,0,0.34)]">
        <details className="group" open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-400/10">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-zinc-50">Processed {formatDuration(activity.durationMs)}</p>
                <p className="truncate text-xs text-zinc-500">{items.length} execution updates captured</p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition group-open:rotate-180" />
          </summary>

          <div className="mt-4">
            {items.map((item, index) => (
              <ActivityStepShell
                key={`${item.id}-${index}`}
                item={{ ...item, status: item.status === 'error' ? 'error' : 'completed' }}
                index={index}
                total={items.length}
                durationMs={stepDuration(items, index, completedAtMs)}
              />
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}

function ArtifactPreviewCard({ artifact, inverted = false }: { artifact: ChatArtifact; inverted?: boolean }) {
  const borderClass = inverted ? 'border-white/25 bg-white/10' : 'border-white/10 bg-white/[0.045]';
  const mutedClass = inverted ? 'text-blue-100' : 'text-zinc-500';
  const titleClass = inverted ? 'text-white' : 'text-zinc-100';
  const iconClass = inverted ? 'border-white/20 bg-white/15 text-white' : 'border-white/10 bg-white/[0.06] text-zinc-300';
  const actionClass = inverted
    ? 'border-white/20 bg-white/10 text-white hover:bg-white/20'
    : 'border-white/10 bg-white/[0.06] text-zinc-300 hover:border-blue-300/30 hover:bg-blue-400/10 hover:text-blue-200';
  const previewBackgroundClass = inverted ? 'bg-white/10' : 'bg-black/20';
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
  const hasRealItems = items.length > 0;
  const visibleItems = items.length > 0
    ? compactCodexStreamItems(items, 8)
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
      <div className="w-full max-w-4xl py-1 agent-activity-text">
        <div className="overflow-hidden rounded-[1.7rem] border border-white/10 bg-[#1f1f1f] text-zinc-100 shadow-[0_26px_90px_rgba(0,0,0,0.36)]">
          <div className="flex min-w-0 items-start gap-4 px-4 py-4 sm:px-5">
            <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.055]">
              {active ? (
                <span className="h-4 w-4 rounded-full bg-gradient-to-br from-blue-400 to-violet-400 shadow-[0_0_22px_rgba(52,120,246,0.75)] agent-activity-pulse" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <span className="shrink-0 text-base font-semibold text-zinc-50">{active ? activeTitle : 'Completed'}</span>
                {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300 agent-activity-stream" /> : null}
                <span className="min-w-0 truncate text-sm text-zinc-400">{active ? activeDetail : 'Reply generated'}</span>
              </div>
              {hasRealItems ? (
                <details className="group mt-3" open>
                  <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-white/10 bg-white/[0.045] px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:border-white/20 hover:text-zinc-50">
                    <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                    Activity
                  </summary>

                  <div className="mt-4">
                    {visibleItems.map((item, index) => (
                      <ActivityStepShell
                        key={`${item.id}-${index}`}
                        item={item}
                        index={index}
                        total={visibleItems.length}
                        active={active && item.id === latestItem?.id}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
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
      <div className="max-w-[92%] rounded-[1.35rem] border border-white/10 bg-white/[0.055] px-4 py-3 text-zinc-100 shadow-[0_16px_50px_rgba(0,0,0,0.18)] sm:max-w-2xl agent-activity-text">
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
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [billingCapacity, setBillingCapacity] = useState<BillingCapacityData | null>(null);
  const [billingCapacityLoading, setBillingCapacityLoading] = useState(false);
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
  const selectedThreadIdRef = useRef<string | null>(null);
  const submissionInFlightRef = useRef(false);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const messagesAutoFollowRef = useRef(true);
  const loadingOlderMessagesRef = useRef(false);
  const suppressNextAutoScrollRef = useRef(false);
  const codexEventIndexRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDragDepthRef = useRef(0);
  const connectorSelectionInitializedRef = useRef(false);
  const initialLoadStartedRef = useRef(false);

  const selectThreadId = useCallback((nextThreadId: string | null) => {
    selectedThreadIdRef.current = nextThreadId;
    setThreadId(nextThreadId);
  }, []);

  const handleSessionExpired = useCallback(() => {
    setError(AUTH_EXPIRED_MESSAGE);
    router.replace(buildSignInRedirectUrl());
  }, [router]);

  const loadBillingCapacity = useCallback(async (
    options: { showLoading?: boolean } = {},
  ): Promise<BillingCapacityData | null> => {
    if (options.showLoading) setBillingCapacityLoading(true);
    try {
      const response = await fetch('/api/billing/capacity', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await response.json().catch(() => ({}))) as BillingCapacityData & { error?: string };
      if (!response.ok) {
        if (response.status === 401) handleSessionExpired();
        return null;
      }
      setBillingCapacity(data);
      return data;
    } catch {
      return null;
    } finally {
      if (options.showLoading) setBillingCapacityLoading(false);
    }
  }, [handleSessionExpired]);

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
  const canAttachFiles = isExecutive && !sending && !recoveringRunState && !attachmentUploadBusy;
  const showBlockingConversationLoading = loading && messages.length === 0 && !sending;

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

      selectThreadId(typeof data.threadId === 'string' ? data.threadId : null);
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
    [applyAgentConfig, selectThreadId]
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
      const requestedThreadId = targetThreadId || selectedThreadIdRef.current || threadId;
      const query = new URLSearchParams({
        status: '1',
      });
      if (requestedThreadId) query.set('threadId', requestedThreadId);
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
      if (
        requestedThreadId &&
        selectedThreadIdRef.current !== requestedThreadId
      ) {
        return 'idle';
      }
      const recoveredThreadId = typeof data.threadId === 'string' ? data.threadId : '';
      if (recoveredThreadId) selectThreadId(recoveredThreadId);
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
        const submissionStatus = activeRunStatus === 'RUNNING' || status === 'ACTIVE'
          ? 'RUNNING'
          : 'QUEUED';
        setMessages((currentMessages) => currentMessages.map((message) => (
          message.submission?.runId === nextRunId &&
          message.submission.status !== submissionStatus
            ? {
                ...message,
                submission: {
                  ...message.submission,
                  status: submissionStatus,
                },
              }
            : message
        )));
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
  }, [activeRunId, handleSessionExpired, selectThreadId, threadId]);

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

  const loadData = useCallback(async (
    targetThreadId?: string | null,
    options?: { showBlockingLoading?: boolean }
  ) => {
    if (!isExecutive) return;
    const requestedThreadId = targetThreadId || null;
    if (requestedThreadId) selectedThreadIdRef.current = requestedThreadId;
    const showBlockingLoading = options?.showBlockingLoading ?? true;
    if (showBlockingLoading) setLoading(true);
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
        setError(data.error || 'Failed to load discussion');
        return;
      }
      if (
        requestedThreadId &&
        selectedThreadIdRef.current &&
        selectedThreadIdRef.current !== requestedThreadId
      ) {
        return;
      }
      resetPersonalAgentRunState();
      const loadedThreadId = typeof data.threadId === 'string' ? data.threadId : null;
      selectThreadId(loadedThreadId);
      setSessions(Array.isArray(data.sessions) ? (data.sessions as AgentSessionSummary[]) : []);
      const loadedMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
      messagesAutoFollowRef.current = true;
      setMessages(loadedMessages);
      setHasMoreMessages(Boolean(data.hasMore));
      setBriefing(null);
      setPersistedBriefing(null);
      setPlannerSteps([]);
      if (loadedThreadId) {
        await refreshPersonalAgentStatus(loadedThreadId);
      }
      if (showExecutiveControls && getStoredActiveRunId()) {
        void resumeExecutiveRun(getStoredActiveRunId(), loadedMessages, { closePlannerOnSuccess: false });
      }
    } catch {
      setError('Network error. Please try again later.');
    } finally {
      if (showBlockingLoading) setLoading(false);
      setRecoveringRunState(false);
    }
  }, [handleSessionExpired, isExecutive, refreshPersonalAgentStatus, resetPersonalAgentRunState, resumeExecutiveRun, selectThreadId, showExecutiveControls]);

  useEffect(() => {
    if (!threadId || !activeRunId) return;
    const timer = window.setInterval(() => {
      void refreshPersonalAgentStatus(threadId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeRunId, refreshPersonalAgentStatus, threadId]);

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void loadData(null, { showBlockingLoading: true });
  }, [loadData]);

  useEffect(() => {
    void loadBillingCapacity({ showLoading: true });
  }, [loadBillingCapacity]);

  useEffect(() => {
    if (!billingCapacity || billingCapacity.capacity.activeTaskCount <= 0) return;
    const timer = window.setInterval(() => {
      void loadBillingCapacity();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [billingCapacity, loadBillingCapacity]);

  const createNewSession = useCallback(async () => {
    if (creatingSession || startingRun || recoveringRunState) return;
    selectedThreadIdRef.current = null;
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
        setError(data.error || 'Failed to create a new discussion');
        return;
      }
      resetPersonalAgentRunState();
      selectThreadId(typeof data.threadId === 'string' ? data.threadId : null);
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
      setError('Failed to create a new discussion. Please try again.');
    } finally {
      setCreatingSession(false);
      setRecoveringRunState(false);
    }
  }, [creatingSession, handleSessionExpired, recoveringRunState, resetPersonalAgentRunState, selectThreadId, startingRun]);

  const switchSession = useCallback(async (targetThreadId: string) => {
    if (!targetThreadId || targetThreadId === threadId || startingRun || recoveringRunState) return;
    selectedThreadIdRef.current = targetThreadId;
    setInput('');
    setAttachments([]);
    setOpenSessionMenuId(null);
    await loadData(targetThreadId, { showBlockingLoading: true });
  }, [loadData, recoveringRunState, startingRun, threadId]);

  const handleSessionAction = useCallback(async (
    session: AgentSessionSummary,
    action: 'rename' | 'archive' | 'delete'
  ) => {
    if (startingRun || recoveringRunState || sessionActionBusyId) return;
    const sessionHasActiveTask = billingCapacity?.activeTasks.some((task) => task.threadId === session.id) ?? false;
    if (sessionHasActiveTask && action !== 'rename') {
      setError('Stop the active task before archiving or deleting this discussion.');
      return;
    }
    setOpenSessionMenuId(null);

    let title: string | undefined;
    if (action === 'rename') {
      const nextTitle = window.prompt('Rename discussion', session.title || 'New discussion');
      if (nextTitle === null) return;
      title = nextTitle.replace(/\s+/g, ' ').trim();
      if (!title) {
        setError('Discussion title cannot be empty.');
        return;
      }
    }

    if (action === 'delete') {
      const confirmed = window.confirm('Delete this discussion? It will no longer be visible or accessible.');
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
        setError(data.error || `Failed to ${action} discussion`);
        return;
      }

      const nextSessions = Array.isArray(data.sessions) ? data.sessions : [];
      setSessions(nextSessions);

      if ((action === 'archive' || action === 'delete') && session.id === threadId) {
        await loadData(nextSessions[0]?.id || null, { showBlockingLoading: true });
      }
    } catch {
      setError(`Failed to ${action} conversation. Please try again.`);
    } finally {
      setSessionActionBusyId(null);
    }
  }, [billingCapacity, handleSessionExpired, loadData, recoveringRunState, sessionActionBusyId, startingRun, threadId]);

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
  }, [messages, sending, codexStreamItems, assistantDraft]);

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
      if (uploadThreadId) selectThreadId(uploadThreadId);
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
  }, [handleSessionExpired, selectThreadId, threadId]);

  const handleFilesSelected = useCallback((files: FileList | null) => {
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
  }, [attachments.length, uploadPendingAttachments]);

  const resetAttachmentDrag = useCallback(() => {
    attachmentDragDepthRef.current = 0;
    setAttachmentDragActive(false);
  }, []);

  const handleAttachmentDragEnter = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    attachmentDragDepthRef.current += 1;
    setAttachmentDragActive(true);
  }, []);

  const handleAttachmentDragOver = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = canAttachFiles ? 'copy' : 'none';
  }, [canAttachFiles]);

  const handleAttachmentDragLeave = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    attachmentDragDepthRef.current = Math.max(0, attachmentDragDepthRef.current - 1);
    if (attachmentDragDepthRef.current === 0) setAttachmentDragActive(false);
  }, []);

  const handleAttachmentDrop = useCallback((event: ReactDragEvent<HTMLFormElement>) => {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    resetAttachmentDrag();
    if (!canAttachFiles) {
      setError(attachmentUploadBusy ? 'Please wait for the current upload to finish.' : 'Please wait for the current response to finish before attaching files.');
      return;
    }
    handleFilesSelected(event.dataTransfer.files);
  }, [attachmentUploadBusy, canAttachFiles, handleFilesSelected, resetAttachmentDrag]);

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
    if (syncedThreadId) selectThreadId(syncedThreadId);
    if (Array.isArray(data.sessions)) {
      setSessions(data.sessions as AgentSessionSummary[]);
    }
    if (typeof data.hasMore === 'boolean') {
      setHasMoreMessages(data.hasMore);
    }
    const syncedMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
    if (syncedMessages.length > 0) setMessages(syncedMessages);
    return syncedMessages;
  }, [handleSessionExpired, selectThreadId]);

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
    if (
      (!content && !hasAttachments) ||
      sending ||
      startingRun ||
      recoveringRunState ||
      submissionInFlightRef.current ||
      !isExecutive
    ) return;
    const unfinishedAttachment = requestAttachments.find((attachment) => attachment.uploadStatus !== 'uploaded');
    if (unfinishedAttachment) {
      setError(
        unfinishedAttachment.uploadStatus === 'error'
          ? `${unfinishedAttachment.name} failed to upload. Remove it or try attaching it again.`
          : 'Please wait for attachments to finish uploading.'
      );
      return;
    }
    submissionInFlightRef.current = true;
    setStartingRun(true);
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
    const nextMessages: ChatMessage[] = [
      ...messages,
      {
        role: 'user',
        content: displayContent,
        submission: {
          status: 'AUTHORIZING',
          runId: null,
          code: null,
          error: null,
        },
      },
    ];
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
        void loadBillingCapacity();
        if (res.status === 401) {
          setMessages(nextMessages);
          setInput(content);
          setAttachments(requestAttachments);
          handleSessionExpired();
          return;
        }
        const failure = typeof data.error === 'string' ? data.error : 'Failed to authorize task';
        setError(failure);
        if ([402, 409, 429, 503].includes(res.status)) {
          setMessages(
            Array.isArray(data.messages)
              ? data.messages
              : nextMessages.map((message, index) => (
                  index === nextMessages.length - 1
                    ? {
                        ...message,
                        submission: {
                          status: 'REJECTED' as const,
                          runId: data.runId || null,
                          code: data.code || 'TASK_REJECTED',
                          error: failure,
                        },
                      }
                    : message
                ))
          );
          setCodexStreamItems([]);
          setCompletedCodexActivity(null);
          setAssistantDraft('');
          return;
        }
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

      if (asyncThreadId) selectThreadId(asyncThreadId);
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
      void loadBillingCapacity();
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
      submissionInFlightRef.current = false;
      setStartingRun(false);
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

  const activeSession = sessions.find((session) => session.id === threadId);
  const connectedConnectors = connectors.filter((connector) => connector.connected && connector.conversationAvailable !== false);
  const latestWorkItem = codexStreamItems[codexStreamItems.length - 1];
  const activeTaskThreadIds = new Set(
    (billingCapacity?.activeTasks || [])
      .map((task) => task.threadId)
      .filter((value): value is string => Boolean(value)),
  );
  const capacityBlocked = billingCapacity ? !billingCapacity.capacity.canStartTask : false;
  const capacityStatusText = billingCapacity
    ? `${billingCapacity.capacity.activeTaskCount}/${billingCapacity.subscription.concurrentTaskLimit} active · ${billingCapacity.account.availableCredits.toLocaleString('en-US')} credits available`
    : 'Task capacity unavailable';

  const sessionSidebar = (
    <div className="min-w-0 max-w-full px-2.5 pb-5">
      <div className="mb-2 mt-5 flex items-center justify-between px-2 text-[10px] font-extrabold uppercase text-zinc-600">
        <span>Discussions</span>
        <span>{sessions.length}</span>
      </div>
      <div className="grid min-w-0 max-w-full gap-0.5">
        {sessions.map((session) => {
          const active = session.id === threadId;
          const actionBusy = sessionActionBusyId === session.id;
          const taskActive = activeTaskThreadIds.has(session.id);
          return (
            <div
              key={session.id}
              data-session-menu-root="true"
              className={`group relative grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_32px] items-center overflow-visible rounded-[7px] ${active ? 'bg-white/[0.075]' : 'hover:bg-white/[0.05]'}`}
            >
              <button
                type="button"
                onClick={() => void switchSession(session.id)}
                disabled={active || startingRun || recoveringRunState || actionBusy}
                title={session.title}
                className="block min-h-[54px] min-w-0 max-w-full overflow-hidden rounded-l-[7px] py-2 pl-2.5 pr-1 text-left disabled:cursor-default"
              >
                <span className={`flex min-w-0 max-w-full items-center gap-2 text-[13px] font-semibold ${active ? 'text-white' : 'text-zinc-400'}`}>
                  {taskActive ? <i className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#8eb3ff]" /> : null}
                  <span className="min-w-0 truncate">{session.title || 'New discussion'}</span>
                </span>
                <span className="mt-1 block min-w-0 max-w-full truncate text-[10px] text-zinc-600">
                  {taskActive ? 'Working' : formatSessionTime(session.updatedAt) || 'Recent'} · {session.messageCount} messages
                </span>
              </button>
              <button
                type="button"
                title="Discussion options"
                aria-label={`More options for ${session.title || 'discussion'}`}
                aria-haspopup="menu"
                aria-expanded={openSessionMenuId === session.id}
                disabled={startingRun || recoveringRunState || actionBusy}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenSessionMenuId((current) => current === session.id ? null : session.id);
                }}
                className={`relative z-10 grid h-7 w-7 place-items-center justify-self-center rounded-md border text-zinc-500 transition ${
                  openSessionMenuId === session.id
                    ? 'border-white/10 bg-[#1a1b1d] opacity-100 text-white'
                    : 'pointer-events-none border-transparent bg-[#17181a] opacity-0 hover:border-white/10 hover:text-white group-hover:pointer-events-auto group-hover:opacity-100'
                }`}
              >
                {actionBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
              </button>
              {openSessionMenuId === session.id ? (
                <div role="menu" className="absolute right-1.5 top-10 z-40 w-[142px] overflow-hidden rounded-[7px] border border-white/15 bg-[#18191b] p-1 text-xs shadow-[0_18px_48px_rgba(0,0,0,.55)]">
                  <button type="button" role="menuitem" onClick={() => void handleSessionAction(session, 'rename')} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-zinc-300 hover:bg-white/[0.07] hover:text-white"><Pencil className="h-3.5 w-3.5" />Rename</button>
                  <button type="button" role="menuitem" disabled={taskActive} onClick={() => void handleSessionAction(session, 'archive')} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-zinc-300 hover:bg-white/[0.07] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"><Archive className="h-3.5 w-3.5" />Archive</button>
                  <button type="button" role="menuitem" disabled={taskActive} onClick={() => void handleSessionAction(session, 'delete')} className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-red-300 hover:bg-red-400/[0.09] disabled:cursor-not-allowed disabled:opacity-35"><Trash2 className="h-3.5 w-3.5" />Delete</button>
                </div>
              ) : null}
            </div>
          );
        })}
        {!loading && sessions.length === 0 ? <p className="px-2 py-6 text-center text-[11px] text-zinc-600">No discussions yet.</p> : null}
      </div>
    </div>
  );

  const rightRail = (
    <div className="grid h-full min-h-0 grid-rows-[64px_minmax(0,1fr)]">
      <div className="flex items-center justify-between border-b border-white/[0.09] px-4">
        <strong className="text-sm text-zinc-100">Discussion context</strong>
        <span className="inline-flex items-center gap-2 text-[11px] text-zinc-400"><i className="h-1.5 w-1.5 rounded-full bg-[#46d19a] shadow-[0_0_9px_rgba(70,209,154,.5)]" />Ready</span>
      </div>
      <div className="astromar-scrollbar min-h-0 overflow-y-auto px-4 py-5">
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[13px] font-semibold text-zinc-200">Active work</h2><Clock3 className="h-3.5 w-3.5 text-zinc-600" /></div>
          {sending || latestWorkItem ? (
            <div className="rounded-[7px] border border-white/[0.09] bg-white/[0.027] p-3.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[12px] font-semibold leading-5 text-zinc-100">{latestWorkItem?.title || activeSession?.title || 'Agent task'}</h3>
                <span className={`inline-flex shrink-0 items-center gap-1.5 text-[9px] font-extrabold uppercase ${sending ? 'text-[#8eb3ff]' : 'text-[#46d19a]'}`}><i className={`h-1.5 w-1.5 rounded-full ${sending ? 'bg-[#8eb3ff]' : 'bg-[#46d19a]'}`} />{sending ? 'Running' : 'Ready'}</span>
              </div>
              <p className="mt-2 text-[10px] leading-4 text-zinc-500">{latestWorkItem?.detail || (sending ? 'Astromar is working through the current request.' : 'The latest result is ready in this discussion.')}</p>
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.08]"><i className={`block h-full ${sending ? 'w-2/3 bg-[#8eb3ff]' : 'w-full bg-[#46d19a]'}`} /></div>
            </div>
          ) : (
            <div className="rounded-[7px] border border-dashed border-white/[0.09] px-3 py-5 text-center text-[11px] text-zinc-600">No active work in this discussion.</div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div><h2 className="text-[13px] font-semibold text-zinc-200">Connector context</h2><p className="mt-1 text-[9px] text-zinc-600">{activeConnectors.length}/{connectedConnectors.length} enabled</p></div>
            <Link href="/connectors" className="grid h-7 w-7 place-items-center rounded-md text-zinc-600 hover:bg-white/5 hover:text-white" title="Manage connectors"><Settings2 className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="grid gap-1">
            {connectedConnectors.map((connector) => {
              const selected = selectedConnectorKeys.includes(connector.key);
              const accountLabel = connector.accounts.map((account) => account.displayName || account.accountEmail).filter(Boolean).join(', ') || 'Connected';
              return (
                <div key={connector.key} className="grid min-h-14 grid-cols-[34px_minmax(0,1fr)_30px] items-center gap-2.5 rounded-[7px] px-2 hover:bg-white/[0.025]">
                  <span className="grid h-8 w-8 place-items-center rounded-md border border-white/[0.09] text-zinc-400"><Plug className="h-3.5 w-3.5" /></span>
                  <span className="grid min-w-0"><strong className="truncate text-xs text-zinc-100">{connector.label}</strong><span className="truncate text-[10px] text-zinc-600">{accountLabel}</span></span>
                  <button
                    type="button"
                    onClick={() => toggleConnector(connector.key)}
                    disabled={sending || recoveringRunState}
                    aria-pressed={selected}
                    aria-label={`${selected ? 'Disable' : 'Enable'} ${connector.label}`}
                    className={`relative h-[18px] w-[30px] rounded-full border transition disabled:opacity-50 ${selected ? 'border-[#46d19a]/25 bg-[#46d19a]/10' : 'border-white/15 bg-white/5'}`}
                  >
                    <span className={`absolute top-[3px] h-[10px] w-[10px] rounded-full transition-transform ${selected ? 'left-[15px] bg-[#46d19a]' : 'left-[3px] bg-zinc-500'}`} />
                  </button>
                </div>
              );
            })}
            {!connectorsLoading && connectedConnectors.length === 0 ? <Link href="/connectors" className="rounded-[7px] border border-dashed border-white/[0.09] px-3 py-4 text-center text-[11px] text-zinc-500 hover:text-zinc-300">Connect a source</Link> : null}
          </div>
          <div className="mt-4 flex items-start gap-2 border-t border-white/[0.09] px-2 pt-3 text-[10px] leading-4 text-zinc-600"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Enabled sources are available only to this discussion. Workspace memory remains shared.</span></div>
        </section>
      </div>
    </div>
  );

  return (
    <AstromarWorkspaceShell
      mobileTitle={activeSession?.title || 'Discussion'}
      sidebarContent={sessionSidebar}
      rightRail={rightRail}
      onNewDiscussion={() => void createNewSession()}
      newDiscussionBusy={creatingSession}
      newDiscussionDisabled={startingRun || recoveringRunState || loading}
    >
      <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] md:grid-rows-[64px_minmax(0,1fr)_auto]">
        <header className="hidden items-center justify-between gap-4 border-b border-white/[0.09] px-6 md:flex">
          <div className="min-w-0">
            <strong className="block truncate text-[13px] text-zinc-100">{activeSession?.title || 'New discussion'}</strong>
            <span className="mt-0.5 block truncate text-[10px] text-zinc-600">AI cofounder workspace · Context scoped to this discussion</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select value={hermesModel} onChange={(event) => setHermesModel(normalizeHermesModelOption(event.target.value))} disabled={sending || recoveringRunState} title={`Current: ${selectedHermesModel.detail}`} className="h-9 rounded-[7px] border border-white/[0.09] bg-[#111214] px-3 text-[11px] font-semibold text-zinc-300 outline-none hover:border-white/15 disabled:opacity-50">
              {hermesModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[7px] text-zinc-600 hover:bg-white/5 hover:text-white" title="Discussion details"><Info className="h-4 w-4" /></button>
          </div>
        </header>

        <main ref={messagesViewportRef} onScroll={handleMessagesScroll} className="astromar-scrollbar min-h-0 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[820px]">
            {showBlockingConversationLoading ? (
              <div className="grid min-h-[50vh] place-items-center text-xs text-zinc-600"><span className="inline-flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" />Loading discussion...</span></div>
            ) : (
              <div className="space-y-7">
                {messages.length > 0 ? (
                  <div className="flex items-center gap-3 text-[9px] uppercase text-zinc-700"><i className="h-px flex-1 bg-white/[0.09]" /><span>Today</span><i className="h-px flex-1 bg-white/[0.09]" /></div>
                ) : null}
                {hasMoreMessages ? (
                  <div className="flex justify-center"><button type="button" onClick={() => void loadOlderMessages()} disabled={loadingOlderMessages} className="rounded-full border border-white/[0.09] px-3 py-1 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50">{loadingOlderMessages ? 'Loading...' : 'Load earlier messages'}</button></div>
                ) : null}
                {messages.map((message, index) => {
                  const artifacts = messageArtifacts(message);
                  const visibleContent = message.role === 'assistant' && artifacts.length > 0 ? stripGeneratedFileLinks(message.content) : message.content;
                  const showCompletedActivity = completedCodexActivity && message.role === 'assistant' && index === messages.length - 1 && !sending && !assistantDraft;
                  if (message.role === 'user') {
                    return (
                      <div key={message.id || `user-${index}`} className="flex justify-end">
                        <div className={`max-w-[82%] rounded-[8px_8px_2px_8px] border px-4 py-3 text-[13px] leading-6 text-zinc-100 ${message.submission?.status === 'REJECTED' ? 'border-red-400/25 bg-red-400/[0.06]' : 'border-white/[0.09] bg-white/[0.075]'}`}>
                          <MarkdownMessage content={visibleContent} inverted renderMediaPreview={({ href, label, kind, key }) => <InlineMediaPreview key={key} href={href} label={label} kind={kind} inverted />} />
                          <GeneratedArtifactPreviews artifacts={artifacts} inverted />
                          {message.submission ? (
                            <div className={`mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-[10px] leading-4 ${message.submission.status === 'REJECTED' ? 'border-red-300/15 text-red-200' : 'border-white/[0.08] text-zinc-500'}`}>
                              {message.submission.status === 'AUTHORIZING' || message.submission.status === 'RUNNING'
                                ? <LoaderCircle className="h-3 w-3 animate-spin" />
                                : message.submission.status === 'QUEUED'
                                  ? <Clock3 className="h-3 w-3" />
                                  : <AlertCircle className="h-3 w-3" />}
                              <span>
                                {message.submission.status === 'AUTHORIZING'
                                  ? 'Authorizing task'
                                  : message.submission.status === 'QUEUED'
                                    ? 'Queued'
                                    : message.submission.status === 'RUNNING'
                                      ? 'Running'
                                      : message.submission.error || 'Task rejected'}
                              </span>
                              {message.submission.status === 'REJECTED' ? (
                                <button type="button" onClick={() => setInput(message.content)} className="ml-auto rounded-md border border-red-200/15 px-2 py-0.5 text-red-100 hover:bg-red-200/10">Edit and retry</button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={message.id || `assistant-${index}`} className="space-y-3">
                      {showCompletedActivity ? <CompletedCodexActivitySummary activity={completedCodexActivity} /> : null}
                      <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                        <span className="grid h-7 w-7 place-items-center rounded-[7px] border border-white/15 bg-[linear-gradient(145deg,rgba(255,255,255,.15),rgba(255,255,255,.03))]"><i className="h-2 w-2 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,.52)]" /></span>
                        <div className="min-w-0">
                          <div className="mb-2 text-[10px] font-bold uppercase text-zinc-600">Astromar</div>
                          <div className="text-[14px] leading-7 text-zinc-300">
                            {visibleContent ? <MarkdownMessage content={visibleContent} renderMediaPreview={({ href, label, kind, key }) => <InlineMediaPreview key={key} href={href} label={label} kind={kind} />} /> : null}
                            <GeneratedArtifactPreviews artifacts={artifacts} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <CodexStreamOutput items={codexStreamItems} active={sending} />
                <StreamingAssistantMessage content={assistantDraft} />
                {messages.length === 0 ? (
                  <div className="grid min-h-[42vh] place-items-center text-center">
                    <div><span className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[8px] border border-white/15 bg-white/[0.035]"><MessageSquare className="h-4 w-4 text-zinc-500" /></span><h1 className="text-xl font-semibold text-zinc-100">What should we move forward?</h1><p className="mt-2 text-xs text-zinc-500">Start with a decision, question, or task.</p></div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </main>

        <div className="bg-[linear-gradient(180deg,rgba(9,10,10,0),#090a0a_20%)] px-3 pb-3 pt-2 sm:px-6 md:px-8 md:pb-5">
          {messages.length === 0 ? (
            <div className="astromar-scrollbar mx-auto mb-2 flex max-w-[820px] gap-1.5 overflow-x-auto">
              {suggestedQuestions.map((question) => <button key={question} type="button" onClick={() => setInput(question)} disabled={sending} className="h-7 shrink-0 rounded-md border border-white/[0.09] px-2.5 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-50">{question}</button>)}
            </div>
          ) : null}
          <form
            onSubmit={(event) => { event.preventDefault(); void handleSend(); }}
            onDragEnter={handleAttachmentDragEnter}
            onDragOver={handleAttachmentDragOver}
            onDragLeave={handleAttachmentDragLeave}
            onDrop={handleAttachmentDrop}
            className={`relative mx-auto w-full max-w-[820px] overflow-hidden rounded-[8px] border bg-[linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025)),#111214] shadow-[0_20px_60px_rgba(0,0,0,.34),inset_0_1px_0_rgba(255,255,255,.06)] transition-[border-color,box-shadow,background-color] ${attachmentDragActive ? 'border-[#8eb3ff]/50 shadow-[0_20px_70px_rgba(0,0,0,.38),0_0_0_1px_rgba(142,179,255,.15),inset_0_1px_0_rgba(255,255,255,.08)]' : 'border-white/[0.16]'}`}
          >
            {attachmentDragActive ? (
              <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[8px] border border-[#8eb3ff]/25 bg-[#0b0d10]/85 backdrop-blur-sm">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.12] bg-white/[0.06] px-3 py-2 text-xs font-semibold text-zinc-100 shadow-[0_18px_45px_rgba(0,0,0,.35)]">
                  <Paperclip className="h-4 w-4 text-[#8eb3ff]" />
                  Drop files to upload
                </div>
              </div>
            ) : null}
            <div className="astromar-scrollbar flex items-center gap-1.5 overflow-x-auto px-2.5 pt-2">
              {connectedConnectors.map((connector) => {
                const selected = selectedConnectorKeys.includes(connector.key);
                return <button key={connector.key} type="button" onClick={() => toggleConnector(connector.key)} disabled={sending || recoveringRunState} className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] ${selected ? 'border-[#8eb3ff]/25 bg-[#8eb3ff]/[0.07] text-[#dfe8ff]' : 'border-white/[0.09] text-zinc-600 hover:text-zinc-300'} disabled:opacity-50`}><i className={`h-1.5 w-1.5 rounded-full ${selected ? 'bg-[#8eb3ff]' : 'bg-zinc-600'}`} />{connector.label}</button>;
              })}
              <Link href="/connectors" className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/[0.09] text-zinc-600 hover:bg-white/5 hover:text-white" title="Manage connectors"><Plus className="h-3.5 w-3.5" /></Link>
              {connectorsLoading ? <span className="px-2 text-[10px] text-zinc-600">Loading context...</span> : null}
            </div>

            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-3 pt-2">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex max-w-full items-center gap-2 rounded-md border border-white/[0.09] bg-white/[0.04] px-2 py-1 text-[10px] text-zinc-400">
                    <span className="max-w-52 truncate">{attachment.name}</span><span className="text-zinc-600">{formatBytes(attachment.size)}</span>
                    {attachment.uploadStatus === 'uploaded' ? <CheckCircle2 className="h-3 w-3 text-[#46d19a]" /> : attachment.uploadStatus === 'error' ? <AlertCircle className="h-3 w-3 text-red-300" /> : <LoaderCircle className="h-3 w-3 animate-spin" />}
                    <button type="button" onClick={() => removeAttachment(attachment.id)} title="Remove attachment"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            ) : null}

            <textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask your AI cofounder anything..." rows={3} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSend(); } }} className="block h-[76px] w-full resize-none bg-transparent px-4 py-3 text-base leading-6 text-zinc-100 outline-none placeholder:text-zinc-600" />
            <div className="flex items-center justify-between gap-3 px-2.5 pb-2.5">
              <div className="flex items-center gap-1">
                <input ref={fileInputRef} type="file" multiple accept={attachmentAccept} className="hidden" onChange={(event) => handleFilesSelected(event.target.files)} />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!canAttachFiles} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[10px] text-zinc-500 hover:bg-white/5 hover:text-white disabled:opacity-50" title="Attach files"><Paperclip className="h-3.5 w-3.5" />Attach</button>
                <span className="hidden items-center gap-1.5 rounded-md border border-white/[0.09] px-2 py-1.5 text-[10px] text-zinc-500 sm:inline-flex"><Check className="h-3.5 w-3.5" />Think</span>
              </div>
              {sending || recoveringRunState ? (
                <button type="button" onClick={() => void stopPersonalAgentRun()} disabled={recoveringRunState || stoppingRun || !activeRunId} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-red-500/85 px-3 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"><Square className="h-3 w-3 fill-current" />{recoveringRunState ? 'Recovering' : stoppingRun ? 'Stopping' : 'Stop'}</button>
              ) : (
                <button type="submit" disabled={(!input.trim() && attachments.length === 0) || attachmentUploadBusy || attachmentUploadFailed || startingRun} className="grid h-8 w-8 place-items-center rounded-md border border-white bg-zinc-100 text-[#090909] hover:bg-white disabled:opacity-35" title="Send"><ArrowUp className="h-4 w-4" /></button>
              )}
            </div>
          </form>
          <div className={`mx-auto mt-2 flex max-w-[820px] items-center gap-1.5 text-[10px] ${capacityBlocked ? 'text-amber-300' : 'text-zinc-600'}`}>
            {billingCapacityLoading ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <CircleGauge className="h-3 w-3" />}
            <span>{capacityStatusText}</span>
          </div>
          {connectorsError ? <p className="mx-auto mt-2 max-w-[820px] text-[10px] text-amber-300">{connectorsError}</p> : null}
          {error ? <p className="mx-auto mt-2 max-w-[820px] text-[11px] text-red-300">{error}</p> : null}
        </div>
      </div>
    </AstromarWorkspaceShell>
  );
}
