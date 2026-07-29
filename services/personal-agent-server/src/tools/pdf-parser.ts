import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { callOpenRouterFileParser } from '../artifact-ingestion.js';
import type { ServerConfig } from '../config.js';
import { isRecord, nowIso, truncate } from '../util.js';

export type PdfParserContext = {
  workspace?: string;
  runId?: string;
  userId?: string;
  threadId?: string;
};

const TOOL_NAME = 'altselfs_pdf_openrouter_parse';
const DEFAULT_PREVIEW_CHARS = 4_000;

export function createPdfOpenRouterParserDynamictool() {
  return {
    namespace: null,
    name: TOOL_NAME,
    description:
      'Parse a PDF that is already in the current Altselfs workspace with OpenRouter file-parser. Use this only after you have inspected the local parsed Markdown/text-layer extraction and, by model judgment, it appears incomplete, header/footer-only, scanned, or missing user-requested正文. The server uses Mistral OCR by default, saves the full parsed Markdown under artifacts/parsed, and returns the saved path plus annotation hash. Pass only a workspace-relative PDF path.',
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
    await appendIndexEntry(resolved.workspaceRoot, {
      pdfPath: resolved.relativePath,
      parsedTextPath: outputRelativePath,
      annotationHash: remote.annotationHash || '',
      generationId: remote.generationId || '',
      engine: engine || process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'mistral-ocr',
    });

    return JSON.stringify({
      source: TOOL_NAME,
      fetchedAt,
      ok: true,
      input: { path: resolved.relativePath },
      engine: engine || process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'mistral-ocr',
      parsedTextPath: outputRelativePath,
      annotationHash: remote.annotationHash || null,
      openRouterGenerationId: remote.generationId || null,
      outputBytes: Buffer.byteLength(remote.text, 'utf8'),
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
