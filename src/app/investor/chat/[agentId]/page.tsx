'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, ChevronDown, LoaderCircle, MessageSquare, Paperclip, Plus, Square, X } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';
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
};

type AgentSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  preview?: string;
};

type PendingAttachmentKind = 'image' | 'video' | 'pdf' | 'document' | 'file';

type PendingAttachment = {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  kind: PendingAttachmentKind;
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

const EXECUTIVE_ACTIVE_RUN_STORAGE_KEY = 'altselfs:executive-active-run-id';
const CODEX_MODEL_STORAGE_KEY = 'altselfs:personal-agent-codex-model';

type CodexModelOption = {
  value: 'deepseek/deepseek-v3.2' | 'gpt-5.5';
  label: string;
  detail: string;
};

const codexModelOptions: CodexModelOption[] = [
  {
    value: 'deepseek/deepseek-v3.2',
    label: 'DeepSeek 3.2',
    detail: 'OpenRouter',
  },
  {
    value: 'gpt-5.5',
    label: 'ChatGPT 5.5',
    detail: 'OpenAI + web.run',
  },
];

function normalizeCodexModelOption(value: unknown): CodexModelOption['value'] {
  return codexModelOptions.find((option) => option.value === value)?.value || 'deepseek/deepseek-v3.2';
}

const suggestedQuestions = [
  '请帮我搜集一下今日关于 OPC 相关的行业或者技术信息。',
  '帮我分析一下这个产品想法是否值得做。',
  '今天 AI agent 领域有什么值得关注的变化？',
  '帮我把一个复杂问题拆成行动计划。',
  '记住：我喜欢看结论、依据和下一步建议。',
];

const plannerStatusLabel: Record<PlannerStepStatus, string> = {
  PENDING: '待执行',
  RUNNING: '执行中',
  SUCCESS: '完成',
  ERROR: '错误',
  SKIPPED: '跳过',
};

const plannerStatusClass: Record<PlannerStepStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-500',
  RUNNING: 'bg-blue-100 text-blue-700',
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  ERROR: 'bg-red-100 text-red-700',
  SKIPPED: 'bg-amber-100 text-amber-700',
};

const attachmentAccept =
  'image/*,application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_ATTACHMENT_FILES = 6;
const MAX_ATTACHMENT_FILE_BYTES = 20 * 1024 * 1024;

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

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', {
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
  };
}

function formatAttachmentList(attachments: PendingAttachment[]) {
  if (attachments.length === 0) return '';
  return attachments.map((attachment) => `- ${attachment.name}（${formatBytes(attachment.size)}）`).join('\n');
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

function describeCodexItem(item: Record<string, unknown>) {
  const type = String(item.type || 'item');
  const command = typeof item.command === 'string' ? item.command : '';
  const tool = typeof item.tool === 'string' ? item.tool : '';
  const namespace = typeof item.namespace === 'string' ? item.namespace : '';
  const path = typeof item.path === 'string' ? item.path : typeof item.file === 'string' ? item.file : '';
  const text = extractCodexText(item).trim();

  if (type.toLowerCase().includes('command')) {
    return { title: '运行命令', detail: command || '命令执行中', content: text };
  }
  if (type.toLowerCase().includes('tool') || tool) {
    return { title: '调用工具', detail: [namespace, tool].filter(Boolean).join('.') || '工具调用中', content: text };
  }
  if (type.toLowerCase().includes('file') || type.toLowerCase().includes('patch')) {
    return { title: '更新文件', detail: path || type, content: text };
  }
  if (type.toLowerCase().includes('agentmessage') || type === 'message') {
    return { title: '生成回复', detail: '正在输出 assistant message', content: text };
  }
  return { title: '处理项目', detail: type, content: text };
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
      title: '执行失败',
      detail: typeof envelope.error === 'string' ? envelope.error : '执行过程中发生错误',
      status: 'error',
      timestamp: now,
    };
  }

  if (envelopeType !== 'event' || !isRecord(envelope.event)) return null;

  const event = envelope.event;
  const type = String(event.type || 'agent.event');
  const timestamp = typeof event.timestamp === 'string' ? event.timestamp : now;
  const payload = getEventPayload(event);

  if (type === 'codex.server_request.item/tool/call') {
    const request = isRecord(payload.request) ? payload.request : {};
    const params = isRecord(request.params) ? request.params : {};
    const namespace = typeof params.namespace === 'string' ? params.namespace : '';
    const tool = typeof params.tool === 'string' ? params.tool : '';
    return {
      id: `codex-server-request-${timestamp}-${index}`,
      title: '调用工具',
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
        : 'Codex runtime 返回错误';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'codex.web_search.not_used' ? '搜索未执行' : 'Codex 执行失败',
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
      title: '更新计划',
      detail: typeof payload.callId === 'string' && payload.callId ? `callId: ${payload.callId}` : 'update_plan',
      status: 'completed',
      timestamp,
      method: type,
      content,
    };
  }

  if (type === 'codex.tool.call') {
    const name = typeof payload.name === 'string' ? payload.name : '工具';
    const content = isRecord(payload.parsedArguments)
      ? formatStreamPayload(payload.parsedArguments)
      : typeof payload.arguments === 'string'
        ? payload.arguments
        : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: '调用工具',
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
      title: '工具返回',
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
      title: '生成中间回复',
      detail: 'Codex assistant message',
      status: 'running',
      timestamp,
      method: type,
      content: message,
    };
  }

  if (type === 'codex.task_complete') {
    const message = typeof payload.lastAgentMessage === 'string' ? payload.lastAgentMessage : '';
    return {
      id: `${type}-${timestamp}-${index}`,
      title: 'Codex 完成任务',
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
      title: 'Codex 回合中断',
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
      title: 'Codex 事件桥接失败',
      detail: typeof payload.error === 'string' ? payload.error : 'rollout bridge error',
      status: 'error',
      timestamp,
      method: type,
    };
  }

  if (type === 'codex.session.starting' || type === 'codex.thread.started' || type === 'codex.turn.started') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'codex.session.starting' ? '启动 Codex' : type === 'codex.thread.started' ? '创建线程' : '开始回合',
      detail: type.replace('codex.', ''),
      status: type === 'codex.thread.started' ? 'completed' : 'running',
      timestamp,
      method: type,
    };
  }

  if (type === 'agent_context.input_persisted' || type === 'agent_context.async_turn_started') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'agent_context.async_turn_started' ? '后台任务已创建' : '创建任务',
      detail: typeof payload.runId === 'string' ? `runId: ${payload.runId}` : '已记录本轮输入',
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
      title: type === 'agent_context.queue_claimed' ? '开始执行后台任务' : '任务超时，正在停止',
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
      title: '解析附件',
      detail: count > 0 ? `已处理 ${count} 个附件` : '无附件或解析警告',
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
      title: '加载上下文',
      detail: `摘要 ${summaryChars} 字符，历史消息 ${messageCount} 条，附件 ${artifactCount} 个`,
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
      diskBytes === null ? '' : `磁盘 ${formatBytes(diskBytes)}`,
    ].filter(Boolean);
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'agent_context.sandbox_state_failed' ? '记录沙盒状态失败' : '记录沙盒状态',
      detail: detailParts.join(' · ') || type.replace('agent_context.', ''),
      status: type === 'agent_context.sandbox_state_failed' || status === 'ERROR' ? 'error' : 'completed',
      timestamp,
      method: type,
    };
  }

  if (type === 'hermes.profile.updated' || type === 'hermes.profile.loaded') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: type === 'hermes.profile.updated' ? '更新用户画像' : '加载用户画像',
      detail: type === 'hermes.profile.loaded'
        ? `画像条目 ${typeof payload.entryCount === 'number' ? payload.entryCount : 0} 条`
        : '已记录新的长期偏好/画像线索',
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
      title: '启动 Hermes/Codex',
      detail: [model, sessionMode].filter(Boolean).join(' · ') || '正在进入 agent loop',
      status: 'running',
      timestamp,
      method: type,
    };
  }

  if (type === 'hermes.source_runtime.completed') {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: '完成 Hermes/Codex',
      detail: typeof payload.sessionId === 'string' ? `sessionId: ${payload.sessionId}` : 'agent loop 已完成',
      status: 'completed',
      timestamp,
      method: type,
    };
  }

  if (type.startsWith('runtime_state.')) {
    return {
      id: `${type}-${timestamp}-${index}`,
      title: '同步运行状态',
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
        title: 'Codex 警告',
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
        title: '完成回合',
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
      title: 'Codex 事件',
      detail: method || type,
      status: method.includes('completed') ? 'completed' : 'running',
      timestamp,
      method,
    };
  }

  if (!type.startsWith('codex.')) return null;

  return {
    id: `${type}-${timestamp}-${index}`,
    title: 'Agent 事件',
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
  const detail = typeof data.error === 'string' && data.error.trim() ? data.error.trim() : '查询任务状态失败';
  return `查询任务状态失败（HTTP ${status}）：${detail}`;
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
  if (item.status === 'error') return item.title || '执行失败';
  if (method.includes('tool') || item.title.includes('工具')) {
    return item.status === 'completed' ? '已调用工具' : '正在调用工具';
  }
  if (method.includes('queue_claimed')) return '开始执行';
  if (method.includes('queue_timeout')) return '执行超时';
  if (method.includes('plan') || item.title.includes('计划')) return '正在规划';
  if (method.includes('thread') || method.includes('session')) return '准备会话';
  if (method.includes('agent_context') || method.includes('runtime_state')) return '读取上下文';
  if (method.includes('workspace_artifacts')) return '处理附件';
  if (method.includes('profile')) return '读取记忆';
  if (method.includes('task_complete') || method.includes('completed')) return '完成处理';
  return item.status === 'running' ? '正在思考' : item.title;
}

function codexCompletedActionLabel(item: CodexStreamItem) {
  const method = item.method || '';
  if (item.status === 'error') return item.title || '执行失败';
  if (method.includes('tool') || item.title.includes('工具')) return '调用工具';
  if (method.includes('queue_claimed')) return '开始执行';
  if (method.includes('queue_timeout')) return '执行超时';
  if (method.includes('plan') || item.title.includes('计划')) return '规划';
  if (method.includes('thread') || method.includes('session')) return '准备会话';
  if (method.includes('agent_context') || method.includes('runtime_state')) return '读取上下文';
  if (method.includes('workspace_artifacts')) return '处理附件';
  if (method.includes('profile')) return '读取记忆';
  if (method.includes('hermes.source_runtime')) return '运行 Hermes/Codex';
  if (method.includes('codex.agent_message')) return '生成回复';
  if (method.includes('task_complete') || method.includes('completed')) return '完成处理';
  return item.title.replace(/^正在/, '');
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

function CodexActivityIcon({ item }: { item: CodexStreamItem }) {
  if (item.status === 'error') return <AlertCircle className="h-4 w-4 text-red-500" />;
  if (item.status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  return <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />;
}

function CompletedCodexActivitySummary({ activity }: { activity: CompletedCodexActivity }) {
  const items = activity.items.slice(-18);
  const completedAtMs =
    timestampMs(activity.completedAt) ||
    timestampMs(items[items.length - 1]?.timestamp || '') ||
    0;

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-2xl border-b border-slate-200 pb-3 text-sm text-slate-600">
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-0 py-1 text-sm font-medium text-slate-500 hover:text-slate-900">
            <span>已处理 {formatDuration(activity.durationMs)}</span>
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
                        {item.method ? <span>来源 {item.method}</span> : null}
                        <span>耗时 {formatDuration(stepDuration(items, index, completedAtMs))}</span>
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
                      {content ? (
                        <details className="group/output mt-2">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
                            <ChevronDown className="h-3 w-3 transition group-open/output:rotate-180" />
                            输出
                          </summary>
                          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100">
                            {content}
                          </pre>
                        </details>
                      ) : null}
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
  throw new Error('晨报执行仍未完成，请稍后刷新查看结果');
}

function CodexStreamOutput({ items, active }: { items: CodexStreamItem[]; active: boolean }) {
  if (items.length === 0 && !active) return null;
  const visibleItems = items.length > 0
    ? items.slice(-5)
    : [
        {
          id: 'agent-stream-preparing',
          title: '正在思考',
          detail: '正在创建任务并读取上下文',
          status: 'running' as const,
          timestamp: new Date().toISOString(),
        },
      ];
  const latestItem = [...visibleItems].reverse().find((item) => item.status === 'running') || visibleItems[visibleItems.length - 1];
  const activeTitle = latestItem ? codexActionLabel(latestItem) : '正在思考';
  const activeDetail = latestItem ? codexCompactDetail(latestItem) : '正在创建任务并读取上下文';

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
                <span className="shrink-0 font-medium text-slate-950">{active ? activeTitle : '处理完成'}</span>
                {active ? <span className="h-1 w-1 shrink-0 rounded-full bg-slate-300" /> : null}
                <span className="min-w-0 truncate text-slate-500">{active ? activeDetail : '已生成回复'}</span>
              </div>
              <details className="group mt-2">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900">
                  <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                  查看过程
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
                            {content ? (
                              <details className="group/output mt-2">
                                <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
                                  <ChevronDown className="h-3 w-3 transition group-open/output:rotate-180" />
                                  输出
                                </summary>
                                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-100">
                                  {content}
                                </pre>
                              </details>
                            ) : null}
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
        <MarkdownMessage content={content} />
      </div>
    </div>
  );
}

export default function InvestorAgentChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;
  const isExecutive = agentId === '100';

  const [threadId, setThreadId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [creatingSession, setCreatingSession] = useState(false);
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
  const [codexModel, setCodexModel] = useState<CodexModelOption['value']>('deepseek/deepseek-v3.2');
  const promptEditorRef = useRef<HTMLDivElement | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const liveStreamRunIdRef = useRef<string | null>(null);
  const requestedStopRunIdRef = useRef<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const loadingOlderMessagesRef = useRef(false);
  const suppressNextAutoScrollRef = useRef(false);
  const codexEventIndexRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const title = useMemo(() => (isExecutive ? '个人 Hermes Agent' : 'AI 助手'), [isExecutive]);
  const showExecutiveControls = false;
  const latestPlannerStatuses = useMemo(() => getLatestPlannerStatuses(plannerTrace), [plannerTrace]);
  const hasPlannerErrors = plannerTrace.some((item) => item.status === 'ERROR');
  const plannerButtonText = sending
    ? '正在执行，查看过程'
    : plannerTrace.length > 0
      ? hasPlannerErrors
        ? '查看上次过程和错误'
        : '查看上次执行过程'
        : '等待本轮 planner';
  const selectedCodexModel = codexModelOptions.find((option) => option.value === codexModel) || codexModelOptions[0];

  useEffect(() => {
    const stored = window.localStorage.getItem(CODEX_MODEL_STORAGE_KEY);
    if (stored) setCodexModel(normalizeCodexModelOption(stored));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CODEX_MODEL_STORAGE_KEY, codexModel);
  }, [codexModel]);
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
        setError(run.error || (typeof data.error === 'string' ? data.error : '发送失败'));
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
        setError(err instanceof Error ? `网络错误：${err.message}` : '网络错误，请稍后重试');
      } finally {
        activeRunIdRef.current = null;
        setActiveRunId(null);
        setSending(false);
        setStoppingRun(false);
      }
    },
    [applyTerminalRun]
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
        setError(typeof data.error === 'string' ? data.error : '停止任务失败');
        return;
      }
      activeRunIdRef.current = null;
      setActiveRunId(null);
      setSending(false);
      clearStoredActiveRunId(runId);
      setPlannerTrace(normalizePlannerTrace(data.plannerTrace || (isRecord(data.result) ? data.result.plannerTrace : null)));
      setError('已停止本次执行。');
    } catch (err) {
      setError(err instanceof Error ? `停止任务失败：${err.message}` : '停止任务失败，请稍后重试');
    } finally {
      setStoppingRun(false);
    }
  }, [activeRunId, stoppingRun]);

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
        setError(typeof data.error === 'string' ? data.error : '停止任务失败');
        return;
      }
      setCodexStreamItems((prev) => [
        ...prev,
        {
          id: `personal-agent-stopped-${Date.now()}`,
          title: '已请求停止',
          detail: `runId: ${runId}`,
          status: 'completed' as const,
          timestamp: new Date().toISOString(),
        },
      ].slice(-18));
    } catch (err) {
      setError(err instanceof Error ? `停止任务失败：${err.message}` : '停止任务失败，请稍后重试');
    } finally {
      setStoppingRun(false);
    }
  }, [activeRunId, stoppingRun, threadId]);

  const refreshPersonalAgentStatus = useCallback(async (
    targetThreadId?: string | null
  ): Promise<PersonalAgentStatusRecoveryResult> => {
    try {
      const query = new URLSearchParams({
        status: '1',
      });
      if (targetThreadId) query.set('threadId', targetThreadId);
      const res = await fetch(`/api/investor/personal-agent?${query.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return 'unavailable';
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
      const recentEvents = Array.isArray(data.recentEvents) ? data.recentEvents : [];
      const projected = recentEvents
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
        if (projected.length > 0) setCodexStreamItems(projected.slice(-18));
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
              ? '已停止本次执行。'
              : latestTerminalStatus === 'TIMEOUT'
                ? '执行超时。'
              : '发送失败';
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
  }, []);

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
        setError(data.error || '加载失败');
        return;
      }
      resetPersonalAgentRunState();
      setThreadId(data.threadId || null);
      setSessions(Array.isArray(data.sessions) ? (data.sessions as AgentSessionSummary[]) : []);
      const loadedMessages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
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
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
      setRecoveringRunState(false);
    }
  }, [isExecutive, refreshPersonalAgentStatus, resetPersonalAgentRunState, resumeExecutiveRun, showExecutiveControls]);

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
        setError(data.error || '创建新会话失败');
        return;
      }
      resetPersonalAgentRunState();
      setThreadId(typeof data.threadId === 'string' ? data.threadId : null);
      setMessages([]);
      setHasMoreMessages(false);
      setSessions(Array.isArray(data.sessions) ? (data.sessions as AgentSessionSummary[]) : []);
      setInput('');
      setAttachments([]);
      window.requestAnimationFrame(() => {
        messagesViewportRef.current?.scrollTo({ top: 0 });
      });
    } catch {
      setError('创建新会话失败，请稍后重试');
    } finally {
      setCreatingSession(false);
      setRecoveringRunState(false);
    }
  }, [creatingSession, recoveringRunState, resetPersonalAgentRunState, sending]);

  const switchSession = useCallback(async (targetThreadId: string) => {
    if (!targetThreadId || targetThreadId === threadId || sending || recoveringRunState) return;
    setInput('');
    setAttachments([]);
    await loadData(targetThreadId);
  }, [loadData, recoveringRunState, sending, threadId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (suppressNextAutoScrollRef.current) {
        suppressNextAutoScrollRef.current = false;
        return;
      }
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
        setError(data.error || '加载更早消息失败');
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
      setError('加载更早消息失败，请稍后重试');
    } finally {
      loadingOlderMessagesRef.current = false;
      setLoadingOlderMessages(false);
    }
  }, [hasMoreMessages, messages, threadId]);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport || viewport.scrollTop > 80) return;
    if (!hasMoreMessages || loadingOlderMessagesRef.current || loading) return;
    void loadOlderMessages();
  }, [hasMoreMessages, loadOlderMessages, loading]);

  useEffect(() => {
    const prompt = searchParams.get('prompt')?.trim();
    if (prompt) setInput(prompt);
  }, [searchParams]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    const oversized = selectedFiles.find((file) => file.size > MAX_ATTACHMENT_FILE_BYTES);
    if (oversized) {
      setError(`附件 ${oversized.name} 超过 ${formatBytes(MAX_ATTACHMENT_FILE_BYTES)}，请压缩后再上传。`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setAttachments((prev) => [...prev, ...selectedFiles.map(createPendingAttachment)].slice(0, MAX_ATTACHMENT_FILES));
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
    if (!res.ok) return [];
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
  }, []);

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
    setCodexStreamItems((prev) => [
      ...prev,
      {
        id: `stream-recovery-${Date.now()}`,
        title: '连接中断，正在恢复',
        detail: '正在确认后台任务是否已创建',
        status: 'running' as const,
        timestamp: new Date().toISOString(),
      },
    ].slice(-18));

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
          setCodexStreamItems((prev) => [
            ...prev,
            {
              id: `stream-recovery-active-${Date.now()}`,
              title: '已切换为后台恢复',
              detail: '网络连接断开过，结果完成后会自动同步到当前会话',
              status: 'running' as const,
              timestamp: new Date().toISOString(),
            },
          ].slice(-18));
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
  }, [hasSyncedCurrentUserTurn, refreshPersonalAgentStatus, threadId]);

  const handleSend = async (textFromSuggestion?: string) => {
    const content = (textFromSuggestion || input).trim();
    const requestAttachments = attachments;
    const hasAttachments = requestAttachments.length > 0;
    if ((!content && !hasAttachments) || sending || recoveringRunState || !isExecutive) return;

    const attachmentList = formatAttachmentList(requestAttachments);
    const displayContent = [
      content || '请分析我上传的附件。',
      attachmentList ? `附件：\n${attachmentList}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const nextMessages = [...messages, { role: 'user' as const, content: displayContent }];
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
        hasAttachments
          ? (() => {
          const formData = new FormData();
          if (threadId) formData.append('threadId', threadId);
          formData.append('message', content);
          formData.append('displayMessage', displayContent);
          formData.append('codexModel', codexModel);
          formData.append('clientRequestId', clientRequestId);
          requestAttachments.forEach((attachment) => {
            formData.append('attachments', attachment.file, attachment.name);
          });
          return formData;
        })()
          : JSON.stringify({
            threadId,
            message: content,
            displayMessage: displayContent,
            codexModel,
            clientRequestId,
          })
      );

      let res: Response | null = null;
      let lastStartError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await fetch('/api/investor/personal-agent?async=1', {
            method: 'POST',
            ...(hasAttachments ? {} : { headers: { 'Content-Type': 'application/json' } }),
            body: buildRequestBody(),
            credentials: 'same-origin',
          });
          break;
        } catch (err) {
          lastStartError = err;
          if (attempt >= 2) break;
          setCodexStreamItems((prev) => [
            ...prev,
            {
              id: `personal-agent-start-retry-${clientRequestId}-${attempt}`,
              title: '创建任务连接中断，正在重试',
              detail: `第 ${attempt + 2} 次尝试`,
              status: 'running' as const,
              timestamp: new Date().toISOString(),
            },
          ].slice(-18));
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
        setError(typeof data.error === 'string' ? data.error : '发送失败');
        setMessages(nextMessages);
        setInput(content);
        setAttachments(requestAttachments);
        return;
      }

      const asyncThreadId = typeof data.threadId === 'string' ? data.threadId : threadId;
      const runId = typeof data.runId === 'string' ? data.runId : '';
      if (!runId) {
        setError('后台任务启动失败：未返回 runId');
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
          title: '后台任务已启动',
          detail: `runId: ${runId}`,
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
        setError('网络连接中断，本轮消息已保存；请稍后刷新当前会话查看结果。');
        return;
      }

      setError(err instanceof Error ? `网络错误：${err.message}` : '网络错误，请稍后重试');
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
      setPromptMessage('system prompt 不能为空。');
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
        setPromptMessage(data.error || '保存 system prompt 失败');
        return;
      }

      applyAgentConfig(data.agentConfig);
      setPromptMessage(resetToDefault ? '已恢复默认 system prompt，后续对话生效。' : '已保存，后续对话生效。');
    } catch {
      setPromptMessage('网络错误，请稍后重试');
    } finally {
      setPromptSaving(false);
    }
  };

  if (!isExecutive) {
    return (
      <FigmaShell
        homeHref="/dashboard"
        title="AI助手"
        subtitle="当前仅开放总裁秘书Momo入口"
        actions={
          <Link href="/dashboard" className="text-sm text-blue-700 hover:underline">
            返回工作台
          </Link>
        }
      >
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-600">
          暂不支持该助手，请返回工作台使用总裁秘书Momo入口。
        </div>
      </FigmaShell>
    );
  }

  return (
    <FigmaShell
      homeHref="/dashboard"
      title={title}
      subtitle="长期记忆、联网研究和多 Agent 调度入口"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {showExecutiveControls ? (
            <button
              type="button"
              onClick={openPromptEditor}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {promptEditorOpen ? '收起 system prompt' : '编辑 system prompt'}
            </button>
          ) : null}
          <Link href="/dashboard" className="px-2 text-sm text-blue-700 hover:underline">
            返回工作台
          </Link>
        </div>
      }
    >
      {showExecutiveControls && promptEditorOpen ? (
        <div ref={promptEditorRef} className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">总裁秘书 system prompt</h2>
              <p className="mt-1 text-sm text-slate-500">
                当前账户专属配置。保存后，Momo 后续生成回复会使用这段系统提示词。
              </p>
            </div>
            <span
              className={`self-start rounded-full px-2 py-1 text-xs ${
                hasCustomPrompt ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {hasCustomPrompt ? '已自定义' : '默认配置'}
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
            placeholder="输入总裁秘书 Momo 的 system prompt..."
          />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              当前长度 {promptDraft.length}/30000
              {promptDraft !== promptSaved ? ' · 有未保存修改' : ''}
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
                撤销修改
              </button>
              <button
                type="button"
                disabled={promptSaving || !defaultPrompt}
                onClick={() => void savePrompt(true)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                恢复默认
              </button>
              <button
                type="button"
                disabled={promptSaving || !promptDraft.trim()}
                onClick={() => void savePrompt(false)}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {promptSaving ? '保存中...' : '保存并生效'}
              </button>
            </div>
          </div>
          {promptMessage ? (
            <p className={`mt-3 text-sm ${promptMessage.includes('失败') || promptMessage.includes('错误') || promptMessage.includes('不能为空') ? 'text-red-600' : 'text-emerald-700'}`}>
              {promptMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {showExecutiveControls ? (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">秘书 Planner</h2>
            <p className="mt-1 text-sm text-slate-500">
              Momo 会根据每条指令动态生成本轮计划；发送后实时显示，完成后自动收起。
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
                {stoppingRun ? '停止中...' : '强制停止'}
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
              {plannerPanelOpen ? '收起过程' : plannerButtonText}
            </button>
          </div>
        </div>

        {plannerPanelOpen ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-900">本轮动态 planner</h3>
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
                  <p className="text-sm text-slate-500">发送一条指令后，这里会显示 Momo 为本轮任务动态生成的计划。</p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-950 p-3 text-slate-100">
              <h3 className="text-sm font-semibold">过程详细</h3>
              <div className="mt-3 max-h-96 space-y-3 overflow-y-auto pr-1">
                {plannerTrace.length > 0 ? (
                  plannerTrace.map((item, index) => {
                    const payloadText = formatPlannerPayload(item.payload);
                    return (
                      <div key={`${item.id}-${item.timestamp}-${index}`} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{item.title}</p>
                            <p className="mt-1 text-xs text-slate-400">{item.timestamp || '时间未知'}</p>
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
                  <p className="text-sm text-slate-400">发送“更新今天的晨报...”后，这里会实时追加执行过程。</p>
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
                <span>会话</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                用户画像和长期偏好跨会话共享；对话上下文、附件和工作区按会话隔离。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                <span className="text-xs font-medium text-slate-500">模型</span>
                <select
                  value={codexModel}
                  onChange={(event) => setCodexModel(normalizeCodexModelOption(event.target.value))}
                  disabled={sending || recoveringRunState}
                  title={`当前：${selectedCodexModel.detail}`}
                  className="bg-transparent text-sm font-semibold text-slate-900 outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {codexModelOptions.map((option) => (
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
                title="新建会话"
                className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {creatingSession ? '创建中...' : '新会话'}
              </button>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {sessions.length > 0 ? (
              sessions.map((session) => {
                const active = session.id === threadId;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => void switchSession(session.id)}
                    disabled={active || sending || recoveringRunState}
                    title={session.title}
                    className={[
                      'min-w-[11rem] max-w-[14rem] rounded-lg border px-3 py-2 text-left transition disabled:cursor-default',
                      active
                        ? 'border-blue-300 bg-blue-50 text-blue-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60',
                    ].join(' ')}
                  >
                    <span className="block truncate text-sm font-medium">{session.title || '新会话'}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {session.messageCount} 条消息{formatSessionTime(session.updatedAt) ? ` · ${formatSessionTime(session.updatedAt)}` : ''}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
                发送第一条消息后会自动创建会话。
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
            <div className="py-8 text-center text-slate-600">加载中...</div>
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
                      {loadingOlderMessages ? '加载中...' : '加载更早消息'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">已到最早消息</span>
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
                return (
                  <div key={message.id || `${message.role}-${index}`} className="space-y-3">
                    {showCompletedActivity ? <CompletedCodexActivitySummary activity={completedCodexActivity} /> : null}
                    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-xs lg:max-w-md ${
                          message.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-900'
                        }`}
                      >
                        <MarkdownMessage content={message.content} inverted={message.role === 'user'} />
                      </div>
                    </div>
                  </div>
                );
              })}
              <CodexStreamOutput items={codexStreamItems} active={sending} />
              <StreamingAssistantMessage content={assistantDraft} />
              {messages.length === 0 ? <div className="py-8 text-center text-slate-500">开始和你的个人 Hermes Agent 对话吧。</div> : null}
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
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex max-w-full items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700"
                  >
                    <span className="min-w-0 truncate">{attachment.name}</span>
                    <span className="shrink-0 text-slate-400">{formatBytes(attachment.size)}</span>
                    <span className="hidden shrink-0 text-slate-400 sm:inline">发送时上传</span>
                    <button
                      type="button"
                      title="移除附件"
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
                placeholder="输入你的问题..."
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
                  title="添加附件"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sending || recoveringRunState}
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
                        ? '正在恢复任务状态'
                        : activeRunId
                          ? '停止本轮任务'
                          : '正在创建本轮任务'
                    }
                  >
                    {recoveringRunState ? null : <Square className="h-3.5 w-3.5 fill-current" />}
                    {recoveringRunState ? '恢复中...' : stoppingRun ? '停止中...' : activeRunId ? '停止' : '准备中...'}
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim() && attachments.length === 0}
                    className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 sm:py-2"
                  >
                    发送
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
