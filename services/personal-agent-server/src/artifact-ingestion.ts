import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerConfig } from './config.js';
import { persistAgentArtifacts, type AgentContextArtifactInput } from './agent-context-store.js';
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

type ParsedAttachment = {
  text: string;
  parser: string;
};

export async function ingestWorkspaceAttachments(
  config: ServerConfig,
  request: TurnStartRequest,
  paths: RuntimePaths,
  runId: string
): Promise<IngestWorkspaceAttachmentsResult> {
  const attachments = getWorkspaceAttachments(request);
  const warnings: string[] = [];
  if (attachments.length === 0) return { artifacts: [], warnings };

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
        ? path.join(parsedDir, `${basename}.txt`)
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
        `  - mime_type: ${artifact.mimeType || 'unknown'}`,
        `  - size_bytes: ${artifact.sizeBytes || 0}`,
        ''
      );
    } catch (error) {
      warnings.push(`${attachment.name}: ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (persisted.length > 0) {
    const indexPath = path.join(artifactsDir, 'index.md');
    await fs.writeFile(indexPath, indexLines.join('\n'), 'utf8');
    await persistAgentArtifacts(config, persisted);
  }

  return { artifacts: persisted, warnings };
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

async function parseAttachment(
  config: ServerConfig,
  attachment: WorkspaceAttachment,
  decoded: { mimeType: string; bytes: Buffer },
  filePath: string
): Promise<ParsedAttachment | null> {
  const mimeType = decoded.mimeType || attachment.type || 'application/octet-stream';
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
  const text = await callOpenRouterFileParser(config, {
    name: attachment.name,
    dataUrl: attachment.dataUrl,
  });
  return { text, parser: 'openrouter_file_parser' };
}

function isImageMimeType(mimeType: string) {
  return mimeType.startsWith('image/');
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
  return {
    text: result.text,
    parser: result.parser || 'local_python_parser',
  };
}

function runPythonArtifactParser(input: { filePath: string; mimeType: string; name: string; maxChars: number }) {
  return new Promise<{ text: string; parser: string }>((resolve, reject) => {
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
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`, 'utf8');
  });
}

const PYTHON_ARTIFACT_PARSER = String.raw`
import csv
import io
import json
import os
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

def parse_pdf(path, max_chars):
    try:
        import pdfplumber
        chunks = []
        with pdfplumber.open(path) as pdf:
            for page_index, page in enumerate(pdf.pages, start=1):
                text = page.extract_text() or ""
                tables = page.extract_tables() or []
                if text.strip():
                    chunks.append(f"\\n--- Page {page_index} ---\\n{text}")
                for table_index, table in enumerate(tables, start=1):
                    chunks.append(f"\\n--- Page {page_index} Table {table_index} ---")
                    for row in table:
                        chunks.append("\\t".join("" if cell is None else str(cell) for cell in row))
                if sum(len(chunk) for chunk in chunks) >= max_chars:
                    break
        return "\\n".join(chunks)[:max_chars], "local_pdf_pdfplumber"
    except Exception:
        pass
    try:
        from pypdf import PdfReader
        reader = PdfReader(path)
        chunks = []
        for page_index, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            if text.strip():
                chunks.append(f"\\n--- Page {page_index} ---\\n{text}")
            if sum(len(chunk) for chunk in chunks) >= max_chars:
                break
        return "\\n".join(chunks)[:max_chars], "local_pdf_pypdf"
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
    if mime_type == "application/pdf" or ext == ".pdf":
        text, parser = parse_pdf(path, max_chars)
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
    emit({"text": clip(text, max_chars), "parser": parser})

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
                '请作为图片解析工具提取图片中的信息。',
                '如果有文字，请逐字 OCR；如果是图表/截图/照片，请描述关键视觉内容、表格结构、数字和可见上下文。',
                '不要编造看不见的内容。',
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

async function callOpenRouterFileParser(config: ServerConfig, file: { name: string; dataUrl: string }) {
  const response = await fetch(`${config.openRouterBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env[config.openRouterApiKeyEnv]}`,
      'content-type': 'application/json',
      'x-title': config.openRouterAppTitle,
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_FILE_PARSER_MODEL || 'qwen/qwen3.6-flash',
      temperature: 0,
      max_tokens: Number(process.env.OPENROUTER_FILE_PARSER_MAX_TOKENS || 12000),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '请作为文件解析工具逐字提取附件中的可读文本。不要总结，不要补充解释；保留标题、表格、编号、日期和换行。',
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
            engine: process.env.OPENROUTER_MULTIMODAL_PDF_ENGINE || 'cloudflare-ai',
          },
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as unknown;
  if (!response.ok) {
    throw new Error(`OpenRouter file parser HTTP ${response.status}: ${extractErrorMessage(payload)}`);
  }
  const text = extractMessageText(payload).trim();
  if (!text) throw new Error('OpenRouter file parser returned empty text');
  return text.slice(0, readParserMaxChars());
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

function readParserMaxChars() {
  const value = Number(process.env.OPENROUTER_FILE_PARSER_MAX_CHARS || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 60000;
}

function readLocalParserTimeoutMs() {
  const value = Number(process.env.ARTIFACT_LOCAL_PARSER_TIMEOUT_MS || '');
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 30_000;
}
