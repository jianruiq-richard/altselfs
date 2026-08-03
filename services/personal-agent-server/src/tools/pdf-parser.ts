import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  getAgentContextArtifactByWorkspacePath,
  patchAgentContextArtifactMetadata,
} from '../agent-context-store.js';
import { callOpenRouterFileParser } from '../artifact-ingestion.js';
import { PRODUCT_BRAND } from '../brand.js';
import type { ServerConfig } from '../config.js';
import { isRecord, nowIso, truncate } from '../util.js';

export type PdfParserContext = {
  workspace?: string;
  runId?: string;
  userId?: string;
  investorId?: string;
  threadId?: string;
};

const TOOL_NAME = 'altselfs_pdf_openrouter_parse';
const DEFAULT_PREVIEW_CHARS = 4_000;

export function createPdfOpenRouterParserDynamictool() {
  return {
    namespace: null,
    name: TOOL_NAME,
    description:
      `Parse a PDF that is already in the current ${PRODUCT_BRAND.name} workspace with OpenRouter file-parser. Use this only after you have inspected the local parsed Markdown/text-layer extraction and, by model judgment, it appears incomplete, header/footer-only, scanned, or missing user-requested正文. This tool prompt is parse-only: “只解析当前文档并返回短确认，不要总结和思考。” The server uses Mistral OCR by default, extracts OpenRouter file annotations instead of relying on the model reply, saves the full parsed Markdown under artifacts/parsed, and returns the saved path plus annotation hash. Pass only a workspace-relative PDF path.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path to the PDF, for example uploads/0-contract.pdf.',
        },
        engine: {
          type: 'string',
          description: 'Optional OpenRouter PDF engine. Default is mistral-ocr. Supported values include mistral-ocr, cloudflare-ai, and native.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    deferLoading: false,
  };
}

export function isPdfOpenRouterParsertool(toolName: string) {
  return toolName === TOOL_NAME;
}

export async function runPdfOpenRouterParsertool(
  argumentsValue: unknown,
  config: ServerConfig,
  context: PdfParserContext = {}
) {
  const fetchedAt = nowIso();
  const args = isRecord(argumentsValue) ? argumentsValue : {};
  const inputPath = typeof args.path === 'string' ? args.path.trim() : '';
  const engine = typeof args.engine === 'string' && args.engine.trim() ? args.engine.trim() : undefined;
  if (!inputPath) {
    return JSON.stringify({ source: TOOL_NAME, fetchedAt, ok: false, error: 'path is required' }, null, 2);
  }

  const apiKey = process.env[config.openRouterApiKeyEnv]?.trim();
  if (!apiKey) {
    return JSON.stringify({
      source: TOOL_NAME,
      fetchedAt,
      ok: false,
      error: `OpenRouter API key is not configured in ${config.openRouterApiKeyEnv}`,
    }, null, 2);
  }

  const workspace = context.workspace?.trim();
  if (!workspace) {
    return JSON.stringify({ source: TOOL_NAME, fetchedAt, ok: false, error: 'workspace is unavailable' }, null, 2);
  }

  const resolved = resolveWorkspaceFile(workspace, inputPath);
  if ('error' in resolved) {
    return JSON.stringify({ source: TOOL_NAME, fetchedAt, ok: false, error: resolved.error, path: inputPath }, null, 2);
  }

  try {
    const stat = await fs.stat(resolved.absolutePath);
    if (!stat.isFile()) throw new Error('path is not a file');
    if (!resolved.relativePath.toLowerCase().endsWith('.pdf')) {
      throw new Error('path must point to a PDF file');
    }

    const bytes = await fs.readFile(resolved.absolutePath);
    const remote = await callOpenRouterFileParser(config, {
      name: path.basename(resolved.relativePath),
      dataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`,
      engine,
    });
    const parsedDir = path.join(resolved.workspaceRoot, 'artifacts', 'parsed');
    await fs.mkdir(parsedDir, { recursive: true });
    const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const outputName = `${safeFileStem(path.basename(resolved.relativePath))}.${sourceHash.slice(0, 12)}.openrouter.md`;
    const outputPath = path.join(parsedDir, outputName);
    await fs.writeFile(outputPath, remote.text, 'utf8');
    const outputRelativePath = path.relative(resolved.workspaceRoot, outputPath);
    const outputBytes = Buffer.byteLength(remote.text, 'utf8');
    const effectiveEngine = engine || process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'mistral-ocr';
    await appendIndexEntry(resolved.workspaceRoot, {
      pdfPath: resolved.relativePath,
      parsedTextPath: outputRelativePath,
      annotationHash: remote.annotationHash || '',
      generationId: remote.generationId || '',
      engine: effectiveEngine,
    });
    const artifactMetadata = await registerOpenRouterParsedText(config, context, {
      sourcePdfRelativePath: resolved.relativePath,
      sourcePdfWorkspacePath: resolved.absolutePath,
      parsedTextPath: outputPath,
      parsedTextRelativePath: outputRelativePath,
      parsedAt: fetchedAt,
      engine: effectiveEngine,
      annotationHash: remote.annotationHash || '',
      generationId: remote.generationId || '',
      outputBytes,
    });

    return JSON.stringify({
      source: TOOL_NAME,
      fetchedAt,
      ok: true,
      input: { path: resolved.relativePath },
      engine: effectiveEngine,
      parsedTextPath: outputRelativePath,
      annotationHash: remote.annotationHash || null,
      openRouterGenerationId: remote.generationId || null,
      outputBytes,
      artifactMetadata,
      preview: truncate(remote.text, DEFAULT_PREVIEW_CHARS),
      nextStep: 'Inspect parsedTextPath in the workspace before answering from the PDF.',
    }, null, 2);
  } catch (error) {
    return JSON.stringify({
      source: TOOL_NAME,
      fetchedAt,
      ok: false,
      input: { path: resolved.relativePath },
      error: error instanceof Error ? error.message : String(error),
    }, null, 2);
  }
}

type OpenRouterParsedTextMetadataPatchInput = {
  existingMetadata?: Record<string, unknown> | null;
  parsedTextPath: string;
  parsedTextRelativePath: string;
  parsedAt: string;
  engine: string;
  annotationHash?: string;
  generationId?: string;
  outputBytes: number;
};

export function buildOpenRouterParsedTextMetadataPatch(input: OpenRouterParsedTextMetadataPatchInput) {
  const existingMetadata = isRecord(input.existingMetadata) ? input.existingMetadata : {};
  const existingParsedTextPath = metadataString(existingMetadata, 'parsedTextPath');
  const existingParsedTextRelativePath = metadataString(existingMetadata, 'parsedTextRelativePath');
  const existingParser = metadataString(existingMetadata, 'parser');
  const patch: Record<string, unknown> = {
    parser: 'openrouter_file_parser',
    bestParsedTextSource: 'openrouter_file_parser',
    parsedTextPath: input.parsedTextPath,
    parsedTextRelativePath: input.parsedTextRelativePath,
    openRouterParsedTextPath: input.parsedTextPath,
    openRouterParsedTextRelativePath: input.parsedTextRelativePath,
    openRouterParsedAt: input.parsedAt,
    openRouterPdfEngine: input.engine,
    openRouterOutputBytes: input.outputBytes,
    inlineInContext: false,
  };
  const parserModel = process.env.OPENROUTER_FILE_PARSER_MODEL?.trim();
  if (parserModel) patch.openRouterFileParserModel = parserModel;
  if (input.annotationHash) patch.annotationHash = input.annotationHash;
  if (input.generationId) patch.openRouterGenerationId = input.generationId;
  if (existingParsedTextPath && existingParsedTextPath !== input.parsedTextPath) {
    patch.localParsedTextPath = metadataString(existingMetadata, 'localParsedTextPath') || existingParsedTextPath;
  }
  if (existingParsedTextRelativePath && existingParsedTextRelativePath !== input.parsedTextRelativePath) {
    patch.localParsedTextRelativePath =
      metadataString(existingMetadata, 'localParsedTextRelativePath') || existingParsedTextRelativePath;
  }
  if (existingParser && !existingParser.startsWith('openrouter_file_parser')) {
    patch.localParser = metadataString(existingMetadata, 'localParser') || existingParser;
  }
  return patch;
}

async function registerOpenRouterParsedText(
  config: ServerConfig,
  context: PdfParserContext,
  input: {
    sourcePdfRelativePath: string;
    sourcePdfWorkspacePath: string;
    parsedTextPath: string;
    parsedTextRelativePath: string;
    parsedAt: string;
    engine: string;
    annotationHash: string;
    generationId: string;
    outputBytes: number;
  }
) {
  const investorId = context.investorId?.trim() || context.userId?.trim() || '';
  const threadId = context.threadId?.trim() || '';
  if (!config.contextDatabaseUrl) return { patched: false, reason: 'context database is not configured' };
  if (!investorId || !threadId) return { patched: false, reason: 'investorId or threadId is missing' };

  try {
    const artifact = await getAgentContextArtifactByWorkspacePath(config, {
      investorId,
      threadId,
      relativePath: input.sourcePdfRelativePath,
      workspacePath: input.sourcePdfWorkspacePath,
    });
    if (!artifact) {
      return {
        patched: false,
        reason: 'matching source PDF artifact was not found',
        sourcePdfPath: input.sourcePdfRelativePath,
      };
    }
    await patchAgentContextArtifactMetadata(config, {
      artifactId: artifact.id,
      investorId,
      threadId,
      runId: context.runId || artifact.runId || undefined,
      metadata: buildOpenRouterParsedTextMetadataPatch({
        existingMetadata: artifact.metadata,
        parsedTextPath: input.parsedTextPath,
        parsedTextRelativePath: input.parsedTextRelativePath,
        parsedAt: input.parsedAt,
        engine: input.engine,
        annotationHash: input.annotationHash,
        generationId: input.generationId,
        outputBytes: input.outputBytes,
      }),
    });
    return {
      patched: true,
      artifactId: artifact.id,
      sourcePdfPath: input.sourcePdfRelativePath,
      parsedTextPath: input.parsedTextRelativePath,
    };
  } catch (error) {
    return {
      patched: false,
      reason: error instanceof Error ? error.message : String(error),
      sourcePdfPath: input.sourcePdfRelativePath,
    };
  }
}

function resolveWorkspaceFile(workspace: string, inputPath: string) {
  if (path.isAbsolute(inputPath)) return { error: 'path must be workspace-relative, not absolute' };
  const workspaceRoot = path.resolve(workspace);
  const absolutePath = path.resolve(workspaceRoot, inputPath);
  if (absolutePath !== workspaceRoot && !absolutePath.startsWith(`${workspaceRoot}${path.sep}`)) {
    return { error: 'path escapes the workspace' };
  }
  return {
    workspaceRoot,
    absolutePath,
    relativePath: path.relative(workspaceRoot, absolutePath),
  };
}

async function appendIndexEntry(
  workspaceRoot: string,
  input: {
    pdfPath: string;
    parsedTextPath: string;
    annotationHash: string;
    generationId: string;
    engine: string;
  }
) {
  const indexPath = path.join(workspaceRoot, 'artifacts', 'index.md');
  const existing = await fs.readFile(indexPath, 'utf8').catch(() => '');
  if (existing.includes(input.parsedTextPath)) return;
  const lines = [
    existing.trimEnd(),
    existing.trim() ? '' : '# Workspace Artifacts',
    existing.trim() ? '' : '',
    `- OpenRouter PDF parse for ${input.pdfPath}`,
    `  - parsed_text: ${input.parsedTextPath}`,
    `  - parser: openrouter_file_parser`,
    `  - pdf_engine: ${input.engine}`,
    input.annotationHash ? `  - annotation_hash: ${input.annotationHash}` : '',
    input.generationId ? `  - openrouter_generation_id: ${input.generationId}` : '',
    '',
  ].filter((line) => line !== '').join('\n');
  await fs.writeFile(indexPath, `${lines}\n`, 'utf8');
}

function safeFileStem(name: string) {
  const stem = name.replace(/\.[^.]+$/, '') || 'pdf';
  return stem.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'pdf';
}

function metadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}
