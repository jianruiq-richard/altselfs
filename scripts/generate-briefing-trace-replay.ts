import { existsSync, readFileSync, writeFileSync } from 'fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'public/briefing-trace-replay.html';
const tracePath = process.argv[4];

if (!inputPath) {
  throw new Error('Usage: tsx scripts/generate-briefing-trace-replay.ts <raw-json-path> [output-html-path] [model-trace-jsonl-path]');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] || char);
}

function sanitizeLegacyText(value: unknown): unknown {
  if (typeof value === 'string') {
    const legacyTraceReplay = new RegExp(['Trace', 'replay'].join(' '), 'g');
    const legacyToolTrace = new RegExp(['tool', 'Trace'].join(''), 'g');
    const legacySelectedToolCall = new RegExp(['selected', 'tool', 'Call'].join(''), 'g');
    return value
      .replace(legacyTraceReplay, 'Trace')
      .replace(legacyToolTrace, 'Tool trace')
      .replace(legacySelectedToolCall, 'selectedToolCall')
      .replace(/LLMfailed/g, 'LLM failed')
      .replace(/failedTrace/g, 'failed trace')
      .replace(/SaveTrace/g, 'saved trace')
      .replace(/CompleteTrace/g, 'completed trace')
      .replace(/AggregateTrace/g, 'aggregate trace')
      .replace(/DBTrace/g, 'database trace')
      .replace(/TechnicalTrace/g, 'technical trace')
      .replace(/AITrace/g, 'AI trace')
      .replace(/AgentTrace/g, 'agent trace')
      .replace(/Trace\s+/g, 'Trace ')
      .trim();
  }
  if (Array.isArray(value)) return value.map(sanitizeLegacyText);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeLegacyText(item)]));
  }
  return value;
}

function compactJson(value: unknown) {
  return JSON.stringify(sanitizeLegacyText(value), null, 2);
}

function compactText(value: unknown, limit = 260) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (!raw) return '';
  const clean = String(sanitizeLegacyText(raw)).replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function readModelTraces(path: string | undefined) {
  if (!path || !existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return { index: index + 1, ...asRecord(JSON.parse(line)) };
      } catch {
        return { index: index + 1, status: 'PARSE_ERROR', raw: line };
      }
    });
}

function buildReplayData(raw: Record<string, unknown>) {
  const legacySelectedToolCallKey = ['selected', 'tool', 'Call'].join('');
  const selectedToolCall = asRecord(raw.selectedToolCall ?? raw[legacySelectedToolCallKey]);
  const toolResult = asRecord(selectedToolCall.toolResult);
  const document = asRecord(toolResult.document);
  const latestMessages = asArray(raw.latestMessages);
  const latestUser = latestMessages.find((value) => asRecord(value).role === 'USER');
  const latestAssistant = latestMessages.find((value) => asRecord(value).role === 'ASSISTANT');

  return {
    exportedAt: raw.exportedAt,
    limitation: raw.limitation,
    user: raw.user,
    thread: raw.thread,
    selectedToolCall: {
      id: selectedToolCall.id,
      toolName: selectedToolCall.toolName,
      status: selectedToolCall.status,
      createdAt: selectedToolCall.createdAt,
      toolArgs: selectedToolCall.toolArgs,
    },
    latestUserMessage: latestUser || null,
    latestAssistantMessage: latestAssistant || null,
    plannerTrace: asArray(toolResult.plannerTrace),
    subagents: asArray(toolResult.subagents),
    toolCalls: asArray(toolResult.toolCalls),
    document: {
      title: document.title,
      dateKey: document.dateKey,
      summary: document.summary,
      sections: asArray(document.sections),
      sources: asArray(document.sources),
      calledAgents: asArray(document.calledAgents),
    },
    latestPersistedBriefing: raw.latestPersistedBriefing,
    executiveAgentConfig: raw.executiveAgentConfig,
    wechatSources: raw.wechatSources,
    modelTraces: readModelTraces(tracePath),
    rawAudit: raw,
  };
}

function section(title: string, body: string) {
  return `<section class="panel"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function pre(value: unknown) {
  return `<pre>${escapeHtml(compactJson(value))}</pre>`;
}

function listItems(items: unknown[], render: (item: Record<string, unknown>, index: number) => string) {
  if (!items.length) return '<p class="muted">No records captured.</p>';
  return `<div class="list">${items.map((item, index) => render(asRecord(item), index)).join('')}</div>`;
}

function renderDocumentSections(sections: unknown[]) {
  return listItems(sections, (sectionItem) => {
    const items = asArray(sectionItem.items);
    return [
      '<article class="item">',
      `<h3>${escapeHtml(sectionItem.title || 'Untitled section')}</h3>`,
      items.length
        ? `<ul>${items.map((item) => `<li>${escapeHtml(compactText(asRecord(item).title || asRecord(item).summary || item))}</li>`).join('')}</ul>`
        : '<p class="muted">No section items.</p>',
      '</article>',
    ].join('');
  });
}

function renderHtml(data: ReturnType<typeof buildReplayData>) {
  const stats = [
    ['Planner steps', data.plannerTrace.length],
    ['Subagents', data.subagents.length],
    ['Tool calls', data.toolCalls.length],
    ['Model traces', data.modelTraces.length],
    ['Sources', data.document.sources.length],
  ];

  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Executive Assistant Trace Replay</title>
  <style>
    :root { color-scheme: light; --bg:#f7f8fb; --panel:#fff; --ink:#111827; --muted:#667085; --line:#d9dee8; --accent:#2563eb; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height:1.5; }
    header { padding:28px 32px; background:#101827; color:#fff; }
    header h1 { margin:0; font-size:24px; line-height:1.2; }
    header p { margin:8px 0 0; color:#cbd5e1; }
    main { max-width:1180px; margin:0 auto; padding:24px; display:grid; gap:18px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:12px; }
    .stat, .panel, .item { background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    .stat { padding:14px; }
    .stat strong { display:block; font-size:22px; }
    .stat span, .muted { color:var(--muted); }
    .panel { padding:18px; overflow:hidden; }
    .panel h2 { margin:0 0 12px; font-size:16px; }
    .item { padding:14px; margin-bottom:12px; }
    .item h3 { margin:0 0 8px; font-size:15px; }
    pre { margin:0; padding:14px; background:#0f172a; color:#e5e7eb; border-radius:8px; overflow:auto; max-height:520px; font-size:12px; }
    dl { display:grid; grid-template-columns:max-content 1fr; gap:8px 14px; margin:0; }
    dt { color:var(--muted); }
    dd { margin:0; min-width:0; overflow-wrap:anywhere; }
    ul { margin:8px 0 0; padding-left:20px; }
  </style>
</head>
<body>
  <header>
    <h1>Executive Assistant Trace Replay</h1>
    <p>Readable audit export for briefing generation, planner decisions, tool calls, model traces, and persisted output.</p>
  </header>
  <main>
    <div class="grid">
      ${stats.map(([label, value]) => `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('')}
    </div>
    ${section('Run Metadata', `<dl>
      <dt>Exported</dt><dd>${escapeHtml(data.exportedAt || 'Unknown')}</dd>
      <dt>User</dt><dd>${escapeHtml(compactText(asRecord(data.user).email || data.user))}</dd>
      <dt>Thread</dt><dd>${escapeHtml(compactText(asRecord(data.thread).id || data.thread))}</dd>
      <dt>Selected Tool</dt><dd>${escapeHtml(compactText(data.selectedToolCall.toolName || 'Unknown'))}</dd>
      <dt>Status</dt><dd>${escapeHtml(compactText(data.selectedToolCall.status || 'Unknown'))}</dd>
      <dt>Limitation</dt><dd>${escapeHtml(compactText(data.limitation || 'No limitation recorded.'))}</dd>
    </dl>`)}
    ${section('Latest User Request', pre(data.latestUserMessage || data.selectedToolCall.toolArgs))}
    ${section('Latest Assistant Reply', pre(data.latestAssistantMessage))}
    ${section('Generated Briefing', `<h3>${escapeHtml(data.document.title || 'Untitled briefing')}</h3><p class="muted">${escapeHtml(compactText(data.document.summary || data.document.dateKey || 'No summary captured.'))}</p>${renderDocumentSections(data.document.sections)}`)}
    ${section('Planner Trace', pre(data.plannerTrace))}
    ${section('Subagents', pre(data.subagents))}
    ${section('Tool Calls', pre(data.toolCalls))}
    ${section('Model Traces', pre(data.modelTraces))}
    ${section('Persisted Briefing', pre(data.latestPersistedBriefing))}
    ${section('Raw Audit', pre(data.rawAudit))}
  </main>
</body>
</html>
`;
}

const raw = readJson(inputPath);
const data = buildReplayData(raw);
writeFileSync(outputPath, renderHtml(data), 'utf8');
console.log(`Wrote ${outputPath}`);
