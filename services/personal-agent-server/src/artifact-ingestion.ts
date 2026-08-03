import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PRODUCT_BRAND } from './brand.js';
import type { ServerConfig } from './config.js';
import {
  getAgentContextArtifactsByIds,
  persistAgentArtifacts,
  type AgentContextArtifactInput,
  type AgentContextArtifactRecord,
} from './agent-context-store.js';
import {
  buildGeneratedObjectKey,
  downloadObjectToBuffer,
  isArtifactObjectStorageConfigured,
  uploadBufferToObject,
} from './artifact-storage.js';
import type { RuntimePaths } from './sandbox-runtime.js';
import type { TurnStartRequest } from './types.js';
import { id, isRecord, nowIso, truncate } from './util.js';

type WorkspaceAttachment = {
  name: string;
  type: string;
  size: number;
  kind: string;
  dataUrl: string;
};

export type IngestWorkspaceAttachmentsResult = {
  artifacts: AgentContextArtifactInput[];
  warnings: string[];
};

export type GeneratedWorkspaceArtifactsResult = {
  artifacts: AgentContextArtifactInput[];
  warnings: string[];
};

type ParsedAttachment = {
  text: string;
  parser: string;
  annotationHash?: string;
  generationId?: string;
  pdfTextStats?: PdfTextStats;
};

const DEFAULT_OPENROUTER_FILE_PARSER_MODEL = 'deepseek/deepseek-v3.2';
const OPENROUTER_FILE_PARSER_CONFIRMATION_PROMPT = '只解析当前文档并返回短确认，不要总结和思考。';

type PdfTextStats = {
  pageCount: number;
  textPageCount: number;
  densePageCount: number;
  nonWhitespaceChars: number;
  charsPerPage: number;
  textPageRatio: number;
  densePageRatio: number;
};

export async function ingestWorkspaceAttachments(
  config: ServerConfig,
  request: TurnStartRequest,
  paths: RuntimePaths,
  runId: string
): Promise<IngestWorkspaceAttachmentsResult> {
  const attachments = getWorkspaceAttachments(request);
  const artifactRefs = getWorkspaceArtifactRefs(request);
  const warnings: string[] = [];
  if (attachments.length === 0 && artifactRefs.length === 0) return { artifacts: [], warnings };

  const investorId = metadataString(request, 'investorId') || request.userId;
  const threadId = request.threadId || 'default';
  const artifactsDir = path.join(paths.workspace, 'artifacts');
  const uploadsDir = path.join(paths.workspace, 'uploads');
  const parsedDir = path.join(artifactsDir, 'parsed');
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(parsedDir, { recursive: true });

  const persisted: AgentContextArtifactInput[] = [];
  const indexLines = ['# Workspace Artifacts', '', `Updated: ${nowIso()}`, ''];

  for (const [index, attachment] of attachments.entries()) {
    try {
      const decoded = decodeDataUrl(attachment.dataUrl);
      const basename = buildArtifactFileName(index, attachment.name, decoded.mimeType || attachment.type);
      const filePath = path.join(uploadsDir, basename);
      await fs.writeFile(filePath, decoded.bytes);

      const parsed = await parseAttachment(config, attachment, decoded, filePath).catch((error) => {
        warnings.push(`${attachment.name}: parser failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      const parsedTextPath = parsed?.text
        ? path.join(parsedDir, `${basename}.md`)
        : '';
      if (parsed?.text && parsedTextPath) {
        await fs.writeFile(parsedTextPath, parsed.text, 'utf8');
      }

      const metadata = {
        storedAsFile: true,
        workspacePath: filePath,
        relativePath: path.relative(paths.workspace, filePath),
        parsedTextPath: parsedTextPath || null,
        parsedTextRelativePath: parsedTextPath ? path.relative(paths.workspace, parsedTextPath) : null,
        originalName: attachment.name,
        sha256: crypto.createHash('sha256').update(decoded.bytes).digest('hex'),
        parser: parsed?.parser || null,
        annotationHash: parsed?.annotationHash || null,
        openRouterGenerationId: parsed?.generationId || null,
        pdfTextStats: parsed?.pdfTextStats || null,
        inlineInContext: false,
      };
      const artifact: AgentContextArtifactInput = {
        id: id('art'),
        investorId,
        threadId,
        runId,
        kind: `uploaded_${attachment.kind || 'file'}`,
        name: attachment.name || basename,
        mimeType: decoded.mimeType || attachment.type || null,
        sizeBytes: decoded.bytes.length,
        contentText: null,
        metadata,
      };
      persisted.push(artifact);
      indexLines.push(
        `- ${attachment.name || basename}`,
        `  - path: ${metadata.relativePath}`,
        parsedTextPath ? `  - parsed_text: ${metadata.parsedTextRelativePath}` : '  - parsed_text: unavailable',
        metadata.annotationHash ? `  - annotation_hash: ${metadata.annotationHash}` : '',
        metadata.pdfTextStats ? `  - pdf_text_stats: ${formatPdfTextStats(metadata.pdfTextStats)}` : '',
        `  - mime_type: ${artifact.mimeType || 'unknown'}`,
        `  - size_bytes: ${artifact.sizeBytes || 0}`,
        ''
      );
    } catch (error) {
      warnings.push(`${attachment.name}: ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (artifactRefs.length > 0) {
    const referencedArtifacts = await getAgentContextArtifactsByIds(config, {
      investorId,
      threadId,
      artifactIds: artifactRefs,
    }).catch((error) => {
      warnings.push(`uploaded artifact lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    });
    const artifactById = new Map(referencedArtifacts.map((artifact) => [artifact.id, artifact]));
    for (const [offset, artifactId] of artifactRefs.entries()) {
      const artifactRecord = artifactById.get(artifactId);
      if (!artifactRecord) {
        warnings.push(`${artifactId}: uploaded artifact metadata was not found`);
        continue;
      }
      const stored = await ingestObjectStorageArtifact({
        config,
        artifact: artifactRecord,
        index: attachments.length + offset,
        uploadsDir,
        parsedDir,
        workspace: paths.workspace,
        investorId,
        threadId,
        runId,
        indexLines,
      }).catch((error) => {
        warnings.push(`${artifactRecord.name}: object storage ingest failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (stored) persisted.push(stored);
    }
  }

  if (persisted.length > 0) {
    const indexPath = path.join(artifactsDir, 'index.md');
    await fs.writeFile(indexPath, indexLines.join('\n'), 'utf8');
    await persistAgentArtifacts(config, persisted);
  }

  return { artifacts: persisted, warnings };
}

export async function collectGeneratedWorkspaceArtifacts(
  config: ServerConfig,
  request: TurnStartRequest,
  paths: RuntimePaths,
  runId: string,
  startedAtMs: number
): Promise<GeneratedWorkspaceArtifactsResult> {
  const warnings: string[] = [];
  const outputsDir = path.join(paths.workspace, 'outputs');
  const entries = await listRecentOutputFiles(outputsDir, startedAtMs).catch((error) => {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      warnings.push(`generated output scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  });
  if (entries.length === 0) return { artifacts: [], warnings };

  const maxFiles = readGeneratedMaxFiles();
  const maxBytes = readGeneratedMaxFileBytes(config);
  const investorId = metadataString(request, 'investorId') || request.userId;
  const threadId = request.threadId || 'default';
  const persisted: AgentContextArtifactInput[] = [];
  for (const entry of entries.slice(0, maxFiles)) {
    try {
      if (entry.sizeBytes > maxBytes) {
        warnings.push(`${entry.relativePath}: generated file exceeds ${maxBytes} bytes`);
        continue;
      }
      const artifactId = id('art');
      const mimeType = inferMimeType(entry.relativePath, '');
      const metadata: Record<string, unknown> = {
        workspacePath: entry.path,
        relativePath: path.relative(paths.workspace, entry.path),
        outputRelativePath: entry.relativePath,
        generatedByRunId: runId,
        generatedAt: nowIso(),
        inlineInContext: false,
      };
      if (isArtifactObjectStorageConfigured(config)) {
        const bytes = await fs.readFile(entry.path);
        const objectKey = buildGeneratedObjectKey({
          userId: request.userId,
          threadId,
          runId,
          relativePath: entry.relativePath,
        });
        await uploadBufferToObject(config, { objectKey, bytes, mimeType });
        metadata.storageProvider = 'aliyun_oss';
        metadata.ossObjectKey = objectKey;
        metadata.downloadPath = `/api/investor/artifacts/download/${encodeURIComponent(artifactId)}?threadId=${encodeURIComponent(threadId)}`;
      } else {
        metadata.storageProvider = 'workspace';
      }
      persisted.push({
        id: artifactId,
        investorId,
        threadId,
        runId,
        kind: 'generated_file',
        name: path.basename(entry.relativePath),
        mimeType,
        sizeBytes: entry.sizeBytes,
        contentText: null,
        metadata,
      });
    } catch (error) {
      warnings.push(`${entry.relativePath}: generated artifact persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (persisted.length > 0) await persistAgentArtifacts(config, persisted);
  return { artifacts: persisted, warnings };
}

async function ingestObjectStorageArtifact(input: {
  config: ServerConfig;
  artifact: AgentContextArtifactRecord;
  index: number;
  uploadsDir: string;
  parsedDir: string;
  workspace: string;
  investorId: string;
  threadId: string;
  runId: string;
  indexLines: string[];
}): Promise<AgentContextArtifactInput | null> {
  const objectKey = metadataStringValue(input.artifact.metadata.ossObjectKey) || metadataStringValue(input.artifact.metadata.objectKey);
  if (!objectKey) throw new Error('missing OSS object key');
  const bytes = await downloadObjectToBuffer(input.config, objectKey);
  const mimeType = input.artifact.mimeType || inferMimeType(input.artifact.name, '');
  const basename = buildArtifactFileName(input.index, input.artifact.name, mimeType);
  const filePath = path.join(input.uploadsDir, basename);
  await fs.writeFile(filePath, bytes);
  const attachment: WorkspaceAttachment = {
    name: input.artifact.name,
    type: mimeType,
    size: bytes.length,
    kind: input.artifact.kind.replace(/^uploaded_/, '') || 'file',
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
  };
  const parsed = await parseAttachment(input.config, attachment, { mimeType, bytes }, filePath).catch(() => null);
  const parsedTextPath = parsed?.text
    ? path.join(input.parsedDir, `${basename}.md`)
    : '';
  if (parsed?.text && parsedTextPath) {
    await fs.writeFile(parsedTextPath, parsed.text, 'utf8');
  }
  const metadata = {
    ...input.artifact.metadata,
    storageProvider: 'aliyun_oss',
    ossObjectKey: objectKey,
    storedAsFile: true,
    materializedFromObjectStorage: true,
    materializedAt: nowIso(),
    workspacePath: filePath,
    relativePath: path.relative(input.workspace, filePath),
    parsedTextPath: parsedTextPath || null,
    parsedTextRelativePath: parsedTextPath ? path.relative(input.workspace, parsedTextPath) : null,
    originalName: input.artifact.name,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    parser: parsed?.parser || null,
    annotationHash: parsed?.annotationHash || null,
    openRouterGenerationId: parsed?.generationId || null,
    pdfTextStats: parsed?.pdfTextStats || null,
    inlineInContext: false,
  };
  const artifact: AgentContextArtifactInput = {
    id: input.artifact.id,
    investorId: input.investorId,
    threadId: input.threadId,
    runId: input.runId,
    kind: input.artifact.kind || `uploaded_${attachment.kind}`,
    name: input.artifact.name || basename,
    mimeType,
    sizeBytes: bytes.length,
    contentText: null,
    metadata,
  };
  input.indexLines.push(
    `- ${artifact.name || basename}`,
    `  - path: ${metadata.relativePath}`,
    parsedTextPath ? `  - parsed_text: ${metadata.parsedTextRelativePath}` : '  - parsed_text: unavailable',
    metadata.annotationHash ? `  - annotation_hash: ${metadata.annotationHash}` : '',
    metadata.pdfTextStats ? `  - pdf_text_stats: ${formatPdfTextStats(metadata.pdfTextStats)}` : '',
    `  - mime_type: ${artifact.mimeType || 'unknown'}`,
    `  - size_bytes: ${artifact.sizeBytes || 0}`,
    ''
  );
  return artifact;
}

async function listRecentOutputFiles(root: string, startedAtMs: number) {
  const results: Array<{ path: string; relativePath: string; sizeBytes: number; mtimeMs: number }> = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = await fs.stat(fullPath);
      if (stat.size <= 0 || stat.mtimeMs < startedAtMs - 1000) continue;
      results.push({
        path: fullPath,
        relativePath: path.relative(root, fullPath),
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  await walk(root);
  return results.sort((a, b) => a.mtimeMs - b.mtimeMs || a.relativePath.localeCompare(b.relativePath));
}

function getWorkspaceAttachments(request: TurnStartRequest): WorkspaceAttachment[] {
  const raw = request.metadata?.workspaceAttachments;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!isRecord(item)) return null;
      const dataUrl = typeof item.dataUrl === 'string' ? item.dataUrl : '';
      if (!dataUrl.startsWith('data:')) return null;
      return {
        name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'attachment',
        type: typeof item.type === 'string' ? item.type : 'application/octet-stream',
        size: typeof item.size === 'number' ? item.size : 0,
        kind: typeof item.kind === 'string' ? item.kind : 'file',
        dataUrl,
      };
    })
    .filter((item): item is WorkspaceAttachment => Boolean(item));
}

function getWorkspaceArtifactRefs(request: TurnStartRequest) {
  const raw = request.metadata?.workspaceArtifactRefs;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (!isRecord(item)) return '';
      return typeof item.id === 'string' ? item.id.trim() : '';
    })
    .filter(Boolean);
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error('invalid data URL');
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  return {
    mimeType,
    bytes: isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8'),
  };
}

function buildArtifactFileName(index: number, name: string, mimeType: string) {
  const fallbackExt = extensionForMimeType(mimeType);
  const sanitized = name
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const base = sanitized || `attachment${fallbackExt}`;
  return `${String(index + 1).padStart(2, '0')}-${base.includes('.') ? base : `${base}${fallbackExt}`}`;
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'text/plain') return '.txt';
  if (mimeType === 'text/markdown') return '.md';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'text/csv') return '.csv';
  if (mimeType === 'text/tab-separated-values') return '.tsv';
  if (mimeType === 'application/msword') return '.doc';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return '.xlsx';
  if (mimeType === 'application/vnd.ms-excel.sheet.macroenabled.12') return '.xlsm';
  return '';
}

function inferMimeType(name: string, providedType: string) {
  const normalizedType = providedType.trim().toLowerCase();
  if (normalizedType) return normalizedType;
  const lowerName = name.toLowerCase();
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  if (lowerName.endsWith('.doc')) return 'application/msword';
  if (lowerName.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lowerName.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lowerName.endsWith('.csv')) return 'text/csv';
  if (lowerName.endsWith('.tsv')) return 'text/tab-separated-values';
  if (lowerName.endsWith('.txt')) return 'text/plain';
  if (lowerName.endsWith('.md')) return 'text/markdown';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  if (lowerName.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

async function parseAttachment(
  config: ServerConfig,
  attachment: WorkspaceAttachment,
  decoded: { mimeType: string; bytes: Buffer },
  filePath: string
): Promise<ParsedAttachment | null> {
  const mimeType = decoded.mimeType || attachment.type || 'application/octet-stream';
  const pdf = isPdfFile(mimeType, attachment.name);
  if (isImageMimeType(mimeType)) {
    const text = await callOpenRouterImageParser(config, {
      name: attachment.name,
      dataUrl: attachment.dataUrl,
      mimeType,
    });
    return text ? { text, parser: 'openrouter_vision_parser' } : null;
  }
  if (isLocalStructuredFile(mimeType, attachment.name)) {
    const local = await parseWithLocalPython(filePath, mimeType, attachment.name).catch(() => null);
    if (local?.text) return local;
    if (pdf) {
      const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
      if (!apiKey) return local;
      try {
        const remote = await callOpenRouterFileParser(config, {
          name: attachment.name,
          dataUrl: attachment.dataUrl,
        });
        return {
          text: remote.text,
          parser: 'openrouter_file_parser_mistral_ocr',
          annotationHash: remote.annotationHash,
          generationId: remote.generationId,
          pdfTextStats: local?.pdfTextStats,
        };
      } catch {
        return local;
      }
    }
  }
  if (decoded.mimeType.startsWith('text/') || decoded.mimeType === 'application/json') {
    return {
      text: truncate(decoded.bytes.toString('utf8'), readParserMaxChars()),
      parser: 'local_text_parser',
    };
  }
  const local = await parseWithLocalPython(filePath, mimeType, attachment.name).catch(() => null);
  if (local?.text) return local;

  const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
  if (!apiKey) return null;
  const remote = await callOpenRouterFileParser(config, {
    name: attachment.name,
    dataUrl: attachment.dataUrl,
  });
  return {
    text: remote.text,
    parser: 'openrouter_file_parser',
    annotationHash: remote.annotationHash,
    generationId: remote.generationId,
  };
}

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith('image/');
}

function isPdfFile(mimeType: string, name: string) {
  return mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
}

function isLocalStructuredFile(mimeType: string, name: string) {
  const lowerName = name.toLowerCase();
  return (
    mimeType === 'application/pdf'
    || mimeType === 'text/csv'
    || mimeType === 'text/tab-separated-values'
    || mimeType === 'application/msword'
    || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || mimeType === 'application/vnd.ms-excel.sheet.macroenabled.12'
    || lowerName.endsWith('.pdf')
    || lowerName.endsWith('.csv')
    || lowerName.endsWith('.tsv')
    || lowerName.endsWith('.docx')
    || lowerName.endsWith('.xlsx')
    || lowerName.endsWith('.xlsm')
  );
}

async function parseWithLocalPython(filePath: string, mimeType: string, name: string): Promise<ParsedAttachment | null> {
  const result = await runPythonArtifactParser({ filePath, mimeType, name, maxChars: readParserMaxChars() });
  if (!result.text.trim()) return null;
  const pdfTextStats = isPdfFile(mimeType, name)
    ? extractPdfTextStats(result.stats)
    : undefined;
  return {
    text: result.text,
    parser: result.parser || 'local_python_parser',
    pdfTextStats,
  };
}

function runPythonArtifactParser(input: { filePath: string; mimeType: string; name: string; maxChars: number }) {
  return new Promise<{
    text: string;
    parser: string;
    stats?: {
      pageCount: number;
      textPageCount: number;
      densePageCount: number;
      nonWhitespaceChars: number;
    };
  }>((resolve, reject) => {
    const child = spawn(process.env.ARTIFACT_PYTHON_BIN || 'python3', ['-c', PYTHON_ARTIFACT_PARSER], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('local python parser timed out'));
    }, readLocalParserTimeoutMs());
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`local python parser exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as unknown;
        if (!isRecord(parsed)) throw new Error('parser output is not an object');
        if (typeof parsed.error === 'string' && parsed.error) throw new Error(parsed.error);
        resolve({
          text: typeof parsed.text === 'string' ? parsed.text.slice(0, input.maxChars) : '',
          parser: typeof parsed.parser === 'string' ? parsed.parser : 'local_python_parser',
          stats: isRecord(parsed.stats) ? {
            pageCount: readNonNegativeNumber(parsed.stats.pageCount),
            textPageCount: readNonNegativeNumber(parsed.stats.textPageCount),
            densePageCount: readNonNegativeNumber(parsed.stats.densePageCount),
            nonWhitespaceChars: readNonNegativeNumber(parsed.stats.nonWhitespaceChars),
          } : undefined,
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`, 'utf8');
  });
}

export function extractPdfTextStats(stats?: {
  pageCount: number;
  textPageCount: number;
  densePageCount: number;
  nonWhitespaceChars: number;
}): PdfTextStats {
  const pageCount = Math.max(1, stats?.pageCount || 0);
  const textPageCount = Math.min(pageCount, stats?.textPageCount || 0);
  const densePageCount = Math.min(pageCount, stats?.densePageCount || 0);
  const nonWhitespaceChars = stats?.nonWhitespaceChars || 0;
  const charsPerPage = nonWhitespaceChars / pageCount;
  const textPageRatio = textPageCount / pageCount;
  const densePageRatio = densePageCount / pageCount;
  return {
    pageCount,
    textPageCount,
    densePageCount,
    nonWhitespaceChars,
    charsPerPage,
    textPageRatio,
    densePageRatio,
  };
}

function formatPdfTextStats(stats: PdfTextStats) {
  return [
    `pages=${stats.pageCount}`,
    `text_pages=${stats.textPageCount}`,
    `dense_pages=${stats.densePageCount}`,
    `chars=${stats.nonWhitespaceChars}`,
    `chars_per_page=${Math.round(stats.charsPerPage)}`,
  ].join(' ');
}

function readNonNegativeNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

const PYTHON_ARTIFACT_PARSER = String.raw`
import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import traceback
import zipfile
import xml.etree.ElementTree as ET

def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False))

def clip(text, max_chars):
    return (text or "")[:max_chars]

def read_text_file(path, max_chars):
    data = open(path, "rb").read()
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "latin-1"):
        try:
            return data.decode(encoding)[:max_chars]
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", errors="replace")[:max_chars]

def parse_csv(path, delimiter, max_chars):
    text = read_text_file(path, max_chars * 2)
    output = io.StringIO()
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    for row_index, row in enumerate(reader, start=1):
        output.write("\\t".join(cell.strip() for cell in row))
        output.write("\\n")
        if output.tell() >= max_chars:
            break
    return output.getvalue()[:max_chars]

def pdf_stats(page_texts):
    counts = [len(re.sub(r"\\s+", "", text or "")) for text in page_texts]
    return {
        "pageCount": len(page_texts),
        "textPageCount": sum(1 for count in counts if count > 0),
        "densePageCount": sum(1 for count in counts if count >= 120),
        "nonWhitespaceChars": sum(counts),
    }

def render_pdf_pages(page_texts, max_chars):
    chunks = []
    length = 0
    for page_index, text in enumerate(page_texts, start=1):
        chunk = f"\\n\\n--- Page {page_index} ---\\n\\n{text or ''}"
        chunks.append(chunk)
        length += len(chunk)
        if length >= max_chars:
            break
    return "".join(chunks)[:max_chars]

def parse_pdf(path, max_chars):
    if shutil.which("pdfinfo") and shutil.which("pdftotext"):
        try:
            info = subprocess.run(
                ["pdfinfo", path],
                check=True,
                capture_output=True,
                text=True,
                timeout=20,
            ).stdout
            page_match = re.search(r"^Pages:\\s+(\\d+)\\s*$", info, re.MULTILINE)
            page_count = int(page_match.group(1)) if page_match else 0
            extracted = subprocess.run(
                ["pdftotext", "-layout", "-enc", "UTF-8", path, "-"],
                check=True,
                capture_output=True,
                text=True,
                timeout=30,
            ).stdout
            page_texts = extracted.split("\\f")
            if page_texts and not page_texts[-1].strip():
                page_texts.pop()
            if page_count > len(page_texts):
                page_texts.extend([""] * (page_count - len(page_texts)))
            if page_texts:
                return render_pdf_pages(page_texts, max_chars), "local_pdf_poppler", pdf_stats(page_texts)
        except Exception:
            pass
    try:
        import pdfplumber
        page_texts = []
        with pdfplumber.open(path) as pdf:
            for page_index, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                tables = page.extract_tables() or []
                page_chunks = [text]
                for table_index, table in enumerate(tables, start=1):
                    page_chunks.append(f"\\n\\n#### Table {table_index}\\n")
                    for row in table:
                        page_chunks.append("\\t".join("" if cell is None else str(cell) for cell in row))
                page_texts.append("\\n".join(page_chunks))
        return render_pdf_pages(page_texts, max_chars), "local_pdf_pdfplumber", pdf_stats(page_texts)
    except Exception:
        pass
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        page_texts = [(page.extract_text() or "") for page in reader.pages]
        return render_pdf_pages(page_texts, max_chars), "local_pdf_pypdf", pdf_stats(page_texts)
    except Exception as exc:
        raise RuntimeError(f"PDF parser unavailable or failed: {exc}")

def parse_docx(path, max_chars):
    try:
        from docx import Document
    except Exception as exc:
        raise RuntimeError(f"python-docx unavailable: {exc}")
    document = Document(path)
    chunks = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            chunks.append(text)
    for table_index, table in enumerate(document.tables, start=1):
        chunks.append(f"\\n--- Table {table_index} ---")
        for row in table.rows:
            chunks.append("\\t".join(cell.text.strip() for cell in row.cells))
    return "\\n".join(chunks)[:max_chars], "local_docx_python_docx"

def parse_docx_zip_fallback(path, max_chars):
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml")
    root = ET.fromstring(xml)
    paragraphs = []
    for paragraph in root.findall(".//w:p", namespace):
        texts = [node.text or "" for node in paragraph.findall(".//w:t", namespace)]
        line = "".join(texts).strip()
        if line:
            paragraphs.append(line)
    return "\\n".join(paragraphs)[:max_chars], "local_docx_zip_xml"

def parse_xlsx(path, max_chars):
    try:
        import openpyxl
    except Exception as exc:
        raise RuntimeError(f"openpyxl unavailable: {exc}")
    workbook = openpyxl.load_workbook(path, data_only=True, read_only=True)
    chunks = []
    for sheet in workbook.worksheets:
        chunks.append(f"\\n--- Sheet: {sheet.title} ---")
        for row in sheet.iter_rows(values_only=True):
            if row is None:
                continue
            values = ["" if cell is None else str(cell) for cell in row]
            if any(value.strip() for value in values):
                chunks.append("\\t".join(values))
            if sum(len(chunk) for chunk in chunks) >= max_chars:
                return "\\n".join(chunks)[:max_chars], "local_xlsx_openpyxl"
    return "\\n".join(chunks)[:max_chars], "local_xlsx_openpyxl"

def main():
    request = json.loads(sys.stdin.read() or "{}")
    path = request.get("filePath") or ""
    mime_type = (request.get("mimeType") or "").lower()
    name = (request.get("name") or os.path.basename(path)).lower()
    max_chars = int(request.get("maxChars") or 60000)
    ext = os.path.splitext(name)[1].lower()

    if not path or not os.path.isfile(path):
        raise RuntimeError("file not found")
    stats = None
    if mime_type == "application/pdf" or ext == ".pdf":
        text, parser, stats = parse_pdf(path, max_chars)
    elif ext == ".docx" or mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        try:
            text, parser = parse_docx(path, max_chars)
        except Exception:
            text, parser = parse_docx_zip_fallback(path, max_chars)
    elif ext in (".xlsx", ".xlsm") or mime_type in ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel.sheet.macroenabled.12"):
        text, parser = parse_xlsx(path, max_chars)
    elif ext == ".csv" or mime_type == "text/csv":
        text, parser = parse_csv(path, ",", max_chars), "local_csv_python"
    elif ext == ".tsv" or mime_type == "text/tab-separated-values":
        text, parser = parse_csv(path, "\\t", max_chars), "local_tsv_python"
    elif mime_type.startswith("text/") or ext in (".txt", ".md", ".json", ".xml", ".html", ".log"):
        text, parser = read_text_file(path, max_chars), "local_text_python"
    else:
        raise RuntimeError(f"unsupported local parser for mime={mime_type} ext={ext}")
    emit({"text": clip(text, max_chars), "parser": parser, "stats": stats})

try:
    main()
except Exception as exc:
    emit({"text": "", "parser": "", "error": str(exc), "trace": traceback.format_exc(limit=3)})
`;

async function callOpenRouterImageParser(
  config: ServerConfig,
  image: { name: string; dataUrl: string; mimeType: string }
) {
  const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
  if (!apiKey) return '';
  const response = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-title': config.openRouterAppTitle,
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_IMAGE_PARSER_MODEL || process.env.OPENROUTER_FILE_PARSER_MODEL || 'qwen/qwen3.6-flash',
      temperature: 0,
      max_tokens: Number(process.env.OPENROUTER_IMAGE_PARSER_MAX_TOKENS || 4000),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: [
                'You are a document and image extraction tool.',
                'Extract visible text from the image. Preserve headings, labels, tables, names, dates, amounts, and URLs as accurately as possible.',
                'Return concise Markdown only.',
              ].join('\n'),
            },
            {
              type: 'image_url',
              image_url: { url: image.dataUrl },
            },
          ],
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new Error(`OpenRouter image parser HTTP ${response.status}: ${extractErrorMessage(payload)}`);
  }
  const text = extractMessageText(payload).trim();
  if (!text) throw new Error('OpenRouter image parser returned empty text');
  return text.slice(0, readParserMaxChars());
}

export async function callOpenRouterFileParser(
  config: ServerConfig,
  file: { name: string; dataUrl: string; engine?: string }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), readOpenRouterFileParserTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env[config.openRouterApiKeyEnv]}`,
        'content-type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || process.env.NEXT_PUBLIC_APP_URL || PRODUCT_BRAND.appBaseUrl,
        'X-Title': config.openRouterAppTitle,
        'X-OpenRouter-Title': config.openRouterAppTitle,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENROUTER_FILE_PARSER_MODEL || DEFAULT_OPENROUTER_FILE_PARSER_MODEL,
        temperature: 0,
        max_tokens: Number(process.env.OPENROUTER_FILE_PARSER_MAX_TOKENS || 16),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: process.env.OPENROUTER_FILE_PARSER_PROMPT || OPENROUTER_FILE_PARSER_CONFIRMATION_PROMPT,
              },
              {
                type: 'file',
                file: {
                  filename: file.name,
                  file_data: file.dataUrl,
                },
              },
            ],
          },
        ],
        plugins: [
          {
            id: 'file-parser',
            pdf: {
              engine: file.engine || process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'mistral-ocr',
            },
          },
        ],
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`OpenRouter file parser timed out after ${readOpenRouterFileParserTimeoutMs()}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => ({}))) as unknown;
  const annotation = extractFileAnnotation(payload);
  if (!response.ok) {
    if (annotation.text) {
      return {
        text: annotation.text.slice(0, readParserMaxChars()),
        annotationHash: annotation.hash,
        generationId: extractGenerationId(payload, response),
      };
    }
    throw new Error(`OpenRouter file parser HTTP ${response.status}: ${extractErrorMessage(payload)}`);
  }
  const text = (annotation.text || extractMessageText(payload)).trim();
  if (!text) {
    throw new Error(`OpenRouter file parser returned empty text${describeFileAnnotationExtraction(payload)}`);
  }
  return {
    text: text.slice(0, readParserMaxChars()),
    annotationHash: annotation.hash,
    generationId: extractGenerationId(payload, response),
  };
}

export function extractFileAnnotation(payload: unknown) {
  const annotations = extractFileAnnotations(payload);
  if (annotations[0]) {
    return {
      text: annotations[0].text,
      hash: annotations[0].hash,
    };
  }
  return { text: '', hash: '' };
}

type ExtractedFileAnnotation = {
  text: string;
  hash: string;
  name: string;
};

function extractFileAnnotations(payload: unknown): ExtractedFileAnnotation[] {
  if (!isRecord(payload)) return [];
  const candidates: unknown[] = [];
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!isRecord(choice)) continue;
    const message = isRecord(choice.message) ? choice.message : {};
    if (Array.isArray(message.annotations)) candidates.push(...message.annotations);
  }
  const error = isRecord(payload.error) ? payload.error : {};
  const errorMetadata = isRecord(error.metadata) ? error.metadata : {};
  if (Array.isArray(errorMetadata.file_annotations)) candidates.push(...errorMetadata.file_annotations);
  collectNestedFileAnnotations(payload, candidates);

  const deduped = new Map<string, ExtractedFileAnnotation>();
  for (const candidate of candidates) {
    const annotation = normalizeFileAnnotation(candidate);
    if (!annotation?.text) continue;
    const key = annotation.hash || `${annotation.name}:${annotation.text.slice(0, 128)}`;
    const existing = deduped.get(key);
    if (!existing || annotation.text.length > existing.text.length) {
      deduped.set(key, annotation);
    }
  }
  return Array.from(deduped.values()).sort((a, b) => b.text.length - a.text.length);
}

function normalizeFileAnnotation(annotation: unknown): ExtractedFileAnnotation | null {
  if (!isRecord(annotation)) return null;
  const file = isRecord(annotation.file) ? annotation.file : annotation;
  const text = extractTextParts(file.content).trim();
  if (!text) return null;
  return {
    text,
    hash: typeof file.hash === 'string' ? file.hash : '',
    name: typeof file.name === 'string' ? file.name : '',
  };
}

function collectNestedFileAnnotations(value: unknown, output: unknown[], seen = new WeakSet<object>()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectNestedFileAnnotations(item, output, seen);
    return;
  }

  if (!isRecord(value)) return;
  if (isRecord(value.file) && (value.type === 'file' || value.file.content !== undefined)) {
    output.push(value);
  } else if (value.content !== undefined && (typeof value.hash === 'string' || typeof value.name === 'string')) {
    output.push(value);
  }

  for (const child of Object.values(value)) {
    collectNestedFileAnnotations(child, output, seen);
  }
}

function describeFileAnnotationExtraction(payload: unknown) {
  if (!isRecord(payload)) return ' (payload is not an object)';
  const annotations = extractFileAnnotations(payload);
  const choices = Array.isArray(payload.choices) ? payload.choices.length : 0;
  const error = isRecord(payload.error) ? payload.error : {};
  const errorMetadata = isRecord(error.metadata) ? error.metadata : {};
  const metadataAnnotations = Array.isArray(errorMetadata.file_annotations) ? errorMetadata.file_annotations.length : 0;
  return ` (choices=${choices}, errorFileAnnotations=${metadataAnnotations}, extractedAnnotations=${annotations.length}, error=${extractErrorMessage(payload)})`;
}

function extractGenerationId(payload: unknown, response: Response) {
  if (isRecord(payload) && typeof payload.id === 'string') return payload.id;
  return response.headers.get('x-generation-id') || '';
}

function extractMessageText(payload: unknown) {
  if (!isRecord(payload)) return '';
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices.find(isRecord);
  const message = isRecord(first?.message) ? first.message : {};
  const direct = extractTextParts(message.content);
  if (direct) return direct;
  const annotations = Array.isArray(message.annotations) ? message.annotations : [];
  return annotations
    .map((annotation) => {
      if (!isRecord(annotation)) return '';
      const file = isRecord(annotation.file) ? annotation.file : {};
      return extractTextParts(file.content);
    })
    .filter(Boolean)
    .join('\n\n');
}

function extractTextParts(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (!isRecord(part)) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function extractErrorMessage(payload: unknown) {
  if (!isRecord(payload)) return 'unknown error';
  if (typeof payload.error === 'string') return payload.error;
  if (isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message;
  if (typeof payload.message === 'string') return payload.message;
  return 'unknown error';
}

function metadataString(request: TurnStartRequest, key: string) {
  const value = request.metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function metadataStringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readParserMaxChars() {
  const value = Number(process.env.OPENROUTER_FILE_PARSER_MAX_CHARS || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1_000_000;
}

function readLocalParserTimeoutMs() {
  const value = Number(process.env.ARTIFACT_LOCAL_PARSER_TIMEOUT_MS || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 30_000;
}

function readOpenRouterFileParserTimeoutMs() {
  const value = Number(process.env.OPENROUTER_FILE_PARSER_TIMEOUT_MS || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20 * 60 * 1000;
}

function readGeneratedMaxFiles() {
  const value = Number(process.env.ARTIFACT_GENERATED_MAX_FILES || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
}

function readGeneratedMaxFileBytes(config: ServerConfig) {
  const value = Number(process.env.ARTIFACT_GENERATED_MAX_FILE_BYTES || '');
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : Math.max(1, config.artifactObjectStorageUploadMaxBytes || 50 * 1024 * 1024);
}
