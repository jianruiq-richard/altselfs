import { existsSync, readFileSync, writeFileSync } from 'fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3] || 'public/briefing-trace-replay.html';
const tracePath = process.argv[4];

if (!inputPath) {
  throw new Error('Usage: tsx scripts/generate-briefing-trace-replay.ts <raw-json-path> [output-html-path]');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function summarizetoolCall(call: unknown, index: number) {
  const item = asRecord(call);
  return {
    index: index + 1,
    toolName: String(item.toolName || 'unknown'),
    status: String(item.status || 'UNKNOWN'),
    args: item.args ?? item.toolArgs ?? null,
    result: item.result ?? item.toolResult ?? null,
  };
}

function readModelTraces(path: string | undefined, raw: Record<string, unknown>) {
  if (!path || !existsSync(path)) return [];
  const selectedtoolCall = asRecord(raw.selectedtoolCall);
  const latestMessages = asArray(raw.latestMessages);
  const latestUser = latestMessages.find((value) => asRecord(value).role === 'USER');
  const latestAssistant = latestMessages.find((value) => asRecord(value).role === 'ASSISTANT');
  const startValue = asRecord(latestUser).createdAt || selectedtoolCall.createdAt;
  const endValue = asRecord(latestAssistant).createdAt || raw.exportedAt;
  const start = new Date(String(startValue || 0)).getTime() - 2 * 60 * 1000;
  const end = new Date(String(endValue || Date.now())).getTime() + 2 * 60 * 1000;

  return readFileSync(path, 'utf8')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => {
      const time = new Date(String(entry.timestamp || '')).getTime();
      return Number.isFinite(time) && time >= start && time <= end;
    })
    .map((entry, index) => {
      const messages = asArray(entry.messages);
      const firstSystem = String(asRecord(messages[0]).content || '');
      return {
        id: `model-${index + 1}`,
        index: index + 1,
        timestamp: entry.timestamp,
        type: entry.type,
        status: entry.status,
        model: entry.model,
        durationMs: entry.durationMs,
        maxTokens: entry.maxTokens,
        tools: entry.tools || [],
        purpose: inferModelPurpose(firstSystem, messages),
        firstSystemPreview: firstSystem.slice(0, 220),
        messages,
        output: entry.output ?? null,
        rawMessage: entry.rawMessage ?? null,
        rawCompletion: entry.rawCompletion ?? null,
        error: entry.error ?? null,
      };
    });
}

function inferModelPurpose(firstSystem: string, messages: unknown[]) {
  if (firstSystem.includes('Trace replayplanner')) return 'planner';
  if (firstSystem.includes('WeChat Official AccountsTrace replay')) return 'wechat_source_selector';
  if (firstSystem.includes('Trace replay') && firstSystem.includes('Step1')) return 'web_search_collect';
  if (firstSystem.includes('Trace replay') && firstSystem.includes('Step2')) return 'web_search_summarize';
  if (firstSystem.includes('Trace replay') && firstSystem.includes('Step3')) return 'web_search_structure';
  if (firstSystem.includes('WeChat Official AccountsTrace replay')) return 'wechat_article_selector';
  if (firstSystem.includes('WeChat Official AccountsTrace replay')) return 'wechat_article_insight';
  if (firstSystem.includes('Trace replay')) return 'briefing_summary';
  if (firstSystem.includes('Trace replay"Information Digest"Trace replay')) return 'structure_informationSummary';
  if (firstSystem.includes('Trace replay"Today To-Dos"Trace replay')) return 'structure_todayTodo';
  if (firstSystem.includes('Trace replay"Twin Recommendations"Trace replay')) return 'structure_twinRecommendation';
  if (firstSystem.includes('Trace replayAggregateagent')) return 'aggregate_structured_briefing';
  if (messages.length === 3) return 'generate_reply';
  return 'unknown_model_call';
}

function buildReplayData(raw: Record<string, unknown>) {
  const selectedtoolCall = asRecord(raw.selectedtoolCall);
  const toolResult = asRecord(selectedtoolCall.toolResult);
  const document = asRecord(toolResult.document);
  const subagents = asArray(toolResult.subagents).map((value) => {
    const item = asRecord(value);
    return {
      agentType: item.agentType,
      answer: item.answer,
      briefingItems: asArray(item.briefingItems),
      debug: item.debug ?? null,
    };
  });
  const toolCalls = asArray(toolResult.toolCalls).map(summarizetoolCall);
  const plannerTrace = asArray(toolResult.plannerTrace);
  const latestMessages = asArray(raw.latestMessages);
  const latestUser = latestMessages.find((value) => asRecord(value).role === 'USER');
  const latestAssistant = latestMessages.find((value) => asRecord(value).role === 'ASSISTANT');
  const persisted = asRecord(raw.latestPersistedBriefing);
  const sections = asArray(document.sections);
  const displaySections = sections.filter((value) => asRecord(value).title !== 'Trace replay');
  const modelTraces = readModelTraces(tracePath, raw);

  return {
    rawAudit: raw,
    exportedAt: raw.exportedAt,
    limitation: raw.limitation,
    user: raw.user,
    thread: raw.thread,
    selectedtoolCall: {
      id: selectedtoolCall.id,
      toolName: selectedtoolCall.toolName,
      status: selectedtoolCall.status,
      createdAt: selectedtoolCall.createdAt,
      toolArgs: selectedtoolCall.toolArgs,
    },
    latestUserMessage: latestUser || null,
    latestAssistantMessage: latestAssistant || null,
    request: selectedtoolCall.toolArgs || {},
    plannerTrace,
    subagents,
    toolCalls,
    document: {
      dateKey: document.dateKey,
      title: document.title,
      summary: document.summary,
      sections,
      displaySections,
      sources: asArray(document.sources),
      calledAgents: asArray(document.calledAgents),
    },
    latestPersistedBriefing: persisted,
    executiveAgentConfig: raw.executiveAgentConfig,
    wechatSources: asArray(raw.wechatSources).map((value) => {
      const source = asRecord(value);
      return {
        id: source.id,
        displayName: source.displayName,
        biz: source.biz,
        description: source.description,
        profile: source.profile,
        profileUpdatedAt: source.profileUpdatedAt,
        profileConfidence: source.profileConfidence,
        lastScannedAt: source.lastScannedAt,
      };
    }),
    modelTraces,
    stats: {
      plannerTraceCount: plannerTrace.length,
      subagentCount: subagents.length,
      toolCallCount: toolCalls.length,
      modelCallCount: modelTraces.length,
      sourceCount: asArray(document.sources).length,
      sectionCounts: displaySections.map((value) => {
        const section = asRecord(value);
        return {
          title: section.title,
          itemCount: asArray(section.items).length,
        };
      }),
      subagentItemCounts: subagents.map((agent) => ({
        agentType: agent.agentType,
        itemCount: agent.briefingItems.length,
      })),
    },
  };
}

function scriptJson(value: unknown) {
  return JSON.stringify(value).replace(/<\//g, '<\\/');
}

const raw = JSON.parse(readFileSync(inputPath, 'utf8')) as Record<string, unknown>;
const replayData = buildReplayData(raw);

const html = `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Executive AssistantTrace replay Trace Trace replay</title>
  <style>
    :root {
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d9dee7;
      --blue: #2563eb;
      --green: #059669;
      --amber: #b45309;
      --red: #dc2626;
      --purple: #7c3aed;
      --slate: #334155;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.5;
    }
    button, input, select { font: inherit; }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr) 430px;
      grid-template-rows: auto 1fr;
    }
    header {
      grid-column: 1 / -1;
      background: #101827;
      color: white;
      padding: 18px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      border-bottom: 1px solid #243044;
    }
    .title h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      font-weight: 720;
    }
    .title p {
      margin: 7px 0 0;
      color: #cbd5e1;
      font-size: 13px;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .btn {
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 9px 13px;
      cursor: pointer;
      background: #e5e7eb;
      color: #111827;
      min-height: 38px;
    }
    .btn.primary { background: var(--blue); color: white; }
    .btn.ghost { background: transparent; color: #e5e7eb; border-color: #475569; }
    .btn:disabled { opacity: .55; cursor: default; }
    .speed {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #cbd5e1;
      font-size: 13px;
    }
    .speed input { width: 130px; }
    aside, main, .detail {
      min-height: 0;
      overflow: auto;
    }
    aside {
      border-right: 1px solid var(--line);
      background: #eef2f7;
      padding: 18px;
    }
    main {
      padding: 20px;
    }
    .detail {
      border-left: 1px solid var(--line);
      background: #f9fafb;
      padding: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
    }
    .meta {
      padding: 14px;
      margin-bottom: 14px;
    }
    .meta h2, .panel h2, .detail h2 {
      margin: 0 0 10px;
      font-size: 14px;
      color: #111827;
    }
    .kv {
      display: grid;
      gap: 8px;
      font-size: 12px;
    }
    .kv div {
      display: grid;
      gap: 2px;
    }
    .kv span:first-child {
      color: var(--muted);
    }
    .kv span:last-child {
      color: var(--ink);
      overflow-wrap: anywhere;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .stat {
      padding: 12px;
      background: white;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .stat strong {
      display: block;
      font-size: 24px;
      line-height: 1;
      color: #0f172a;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
    }
    .nav {
      display: grid;
      gap: 8px;
    }
    .nav button {
      text-align: left;
      background: white;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      color: #334155;
    }
    .nav button.active {
      border-color: var(--blue);
      box-shadow: inset 3px 0 0 var(--blue);
      color: #111827;
    }
    .runbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      margin-bottom: 16px;
      padding: 14px;
    }
    .progress {
      height: 9px;
      background: #e5e7eb;
      border-radius: 999px;
      overflow: hidden;
    }
    .progress > span {
      display: block;
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #2563eb, #059669);
      transition: width .25s ease;
    }
    .status-line {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .canvas-panel {
      padding: 16px;
      margin-bottom: 16px;
    }
    .canvas-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 10px;
    }
    .canvas-head h2 { margin: 0; }
    .canvas-head p {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 12px;
    }
    .canvas-wrap {
      overflow: auto;
      max-height: 68vh;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
    }
    .canvas-inputs {
      margin-top: 10px;
      border: 1px solid var(--line);
      background: #f8fafc;
      border-radius: 8px;
      padding: 11px 12px;
    }
    .canvas-inputs h3 {
      margin: 0 0 8px;
      font-size: 13px;
    }
    .input-source-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
    }
    .input-source {
      border: 1px solid #d9dee7;
      background: white;
      border-radius: 7px;
      padding: 8px;
      min-width: 0;
    }
    .input-source strong {
      display: block;
      font-size: 12px;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .input-source p {
      margin: 0;
      color: #475569;
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .input-source .tag {
      display: inline-block;
      margin-bottom: 5px;
      padding: 2px 6px;
      border-radius: 999px;
      background: #e0f2fe;
      color: #075985;
      font-size: 10px;
      font-weight: 700;
    }
    #callCanvas {
      display: block;
      min-width: 760px;
      min-height: 520px;
      cursor: pointer;
    }
    .canvas-legend {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      display: inline-block;
      border: 1px solid rgba(15, 23, 42, .18);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr);
      gap: 16px;
    }
    .panel {
      padding: 16px;
      min-height: 140px;
    }
    .timeline {
      position: relative;
      padding-left: 14px;
      display: grid;
      gap: 10px;
    }
    .timeline:before {
      content: "";
      position: absolute;
      left: 5px;
      top: 8px;
      bottom: 8px;
      width: 2px;
      background: #dbe3ef;
    }
    .step {
      position: relative;
      border: 1px solid var(--line);
      background: white;
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
    }
    .step:before {
      content: "";
      position: absolute;
      left: -13px;
      top: 14px;
      width: 9px;
      height: 9px;
      background: #94a3b8;
      border: 2px solid #eef2f7;
      border-radius: 999px;
    }
    .step.running { border-color: #93c5fd; background: #eff6ff; }
    .step.running:before { background: var(--blue); }
    .step.success { border-color: #a7f3d0; }
    .step.success:before { background: var(--green); }
    .step.error { border-color: #fecaca; background: #fef2f2; }
    .step.error:before { background: var(--red); }
    .step.skipped { border-color: #fde68a; background: #fffbeb; }
    .step.skipped:before { background: var(--amber); }
    .step h3 {
      margin: 0;
      font-size: 14px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }
    .step p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      background: #e2e8f0;
      color: #334155;
      white-space: nowrap;
      height: 21px;
    }
    .badge.success { background: #d1fae5; color: #065f46; }
    .badge.running { background: #dbeafe; color: #1d4ed8; }
    .badge.error { background: #fee2e2; color: #991b1b; }
    .badge.skipped { background: #fef3c7; color: #92400e; }
    .kind {
      display: inline-flex;
      align-items: center;
      border-radius: 6px;
      padding: 2px 7px;
      font-size: 11px;
      background: #eef2ff;
      color: #3730a3;
      white-space: nowrap;
    }
    .kind.code { background: #f1f5f9; color: #334155; }
    .kind.model { background: #ede9fe; color: #6d28d9; }
    .kind.mixed { background: #ecfeff; color: #0e7490; }
    .kind.db { background: #dcfce7; color: #166534; }
    .kind.tool { background: #fff7ed; color: #9a3412; }
    .agents {
      display: grid;
      gap: 10px;
    }
    .agent {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: white;
      cursor: pointer;
    }
    .agent strong { display: block; }
    .agent span { color: var(--muted); font-size: 12px; }
    .sections {
      display: grid;
      gap: 12px;
    }
    .section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: white;
      overflow: hidden;
    }
    .section header {
      display: flex;
      justify-content: space-between;
      background: #f8fafc;
      color: #0f172a;
      padding: 10px 12px;
      border: 0;
      border-bottom: 1px solid var(--line);
    }
    .section header h3 { margin: 0; font-size: 14px; }
    .items {
      display: grid;
      gap: 8px;
      padding: 10px;
    }
    .item {
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      padding: 10px;
      cursor: pointer;
    }
    .item h4 { margin: 0 0 6px; font-size: 13px; }
    .item p { margin: 0; color: var(--muted); font-size: 12px; }
    .item a { color: var(--blue); text-decoration: none; }
    .tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .tabs button {
      border: 1px solid var(--line);
      background: white;
      border-radius: 999px;
      padding: 7px 10px;
      cursor: pointer;
      color: #334155;
    }
    .tabs button.active {
      background: #111827;
      color: white;
      border-color: #111827;
    }
    .jsonbox {
      background: #0b1020;
      color: #dbeafe;
      border-radius: 8px;
      padding: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      overflow: auto;
      max-height: 56vh;
      overflow-wrap: anywhere;
    }
    .json-tree {
      display: grid;
      gap: 2px;
      line-height: 1.45;
      min-width: 320px;
    }
    .json-tree details {
      margin-left: 14px;
      border-left: 1px solid rgba(148, 163, 184, .22);
      padding-left: 8px;
    }
    .json-tree > details,
    .json-tree > .json-leaf {
      margin-left: 0;
      border-left: 0;
      padding-left: 0;
    }
    .json-tree summary {
      cursor: pointer;
      color: #bfdbfe;
      list-style-position: outside;
      white-space: nowrap;
    }
    .json-key {
      color: #93c5fd;
      font-weight: 700;
    }
    .json-meta {
      color: #94a3b8;
      margin-left: 6px;
    }
    .json-leaf {
      margin-left: 18px;
      min-height: 18px;
      white-space: pre-wrap;
    }
    .json-string { color: #bbf7d0; }
    .json-number { color: #fde68a; }
    .json-boolean { color: #fca5a5; }
    .json-null { color: #c4b5fd; }
    .detail .summary {
      color: var(--muted);
      font-size: 13px;
      margin: 0 0 12px;
    }
    .explain {
      margin-top: 12px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      border-radius: 8px;
      padding: 11px 12px;
      color: #334155;
      font-size: 12px;
    }
    .explain strong {
      display: block;
      margin-bottom: 7px;
      color: #111827;
      font-size: 12px;
    }
    .explain dl {
      display: grid;
      gap: 7px;
      margin: 0;
    }
    .explain div {
      display: grid;
      gap: 2px;
    }
    .explain dt {
      color: #64748b;
      font-weight: 700;
    }
    .explain dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .tool-list {
      display: grid;
      gap: 8px;
      max-height: 360px;
      overflow: auto;
    }
    .tool {
      background: white;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 9px;
      cursor: pointer;
    }
    .tool strong { display: block; font-size: 12px; }
    .tool span { color: var(--muted); font-size: 11px; }
    .empty {
      color: var(--muted);
      font-size: 13px;
      padding: 16px;
      text-align: center;
      border: 1px dashed var(--line);
      border-radius: 8px;
      background: white;
    }
    @media (max-width: 1180px) {
      .app { grid-template-columns: 260px minmax(0, 1fr); }
      .detail { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--line); max-height: none; }
    }
    @media (max-width: 820px) {
      .app { display: block; }
      header { align-items: flex-start; flex-direction: column; }
      .controls { justify-content: flex-start; }
      aside, main, .detail { overflow: visible; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div class="title">
        <h1>Executive AssistantTrace replay Trace Trace replay</h1>
        <p id="subtitle">Trace replay, Trace replay.</p>
      </div>
      <div class="controls">
        <button class="btn primary" id="startBtn">Trace replay</button>
        <button class="btn ghost" id="prevBtn">Trace replay</button>
        <button class="btn ghost" id="nextBtn">Trace replay</button>
        <button class="btn ghost" id="pauseBtn" disabled>Trace replay</button>
        <button class="btn ghost" id="resetBtn">Trace replay</button>
        <label class="speed">Trace replay <input id="speedInput" type="range" min="80" max="1400" value="420" /></label>
      </div>
    </header>

    <aside>
      <section class="card meta">
        <h2>Trace replay</h2>
        <div class="kv" id="meta"></div>
      </section>
      <section class="stats" id="stats"></section>
      <nav class="nav" id="nav"></nav>
    </aside>

    <main>
      <section class="card runbar">
        <div>
          <p class="status-line" id="statusLine">Trace replay"Trace replay".</p>
          <div class="progress"><span id="progressFill"></span></div>
        </div>
        <span class="badge" id="runStatus">READY</span>
      </section>

      <section class="card canvas-panel">
        <div class="canvas-head">
          <div>
            <h2>Canvas Trace replay</h2>
            <p>Trace replay, Trace replay.Trace replayCompleteTrace replay RUNNING; Trace replay.</p>
          </div>
          <div class="canvas-legend">
            <span class="legend-item"><span class="legend-dot" style="background:#dbeafe"></span>Trace replay</span>
            <span class="legend-item"><span class="legend-dot" style="background:#ede9fe"></span>Trace replay</span>
            <span class="legend-item"><span class="legend-dot" style="background:#dcfce7"></span>Complete</span>
            <span class="legend-item"><span class="legend-dot" style="background:#fee2e2"></span>failed</span>
          </div>
        </div>
        <div class="canvas-wrap" id="canvasWrap">
          <canvas id="callCanvas"></canvas>
        </div>
        <div class="canvas-inputs" id="canvasInputs"></div>
      </section>

      <div class="grid">
        <section class="card panel">
          <h2>Trace replay</h2>
          <div class="timeline" id="timeline"></div>
        </section>
        <section class="card panel">
          <h2>Trace replay Agent Trace replaytool</h2>
          <div class="agents" id="agents"></div>
          <h2 style="margin-top:16px">Trace replay</h2>
          <div class="tool-list" id="models"></div>
          <h2 style="margin-top:16px">toolTrace replay</h2>
          <div class="tool-list" id="tools"></div>
        </section>
      </div>

      <section class="card panel" style="margin-top:16px">
        <h2>Trace replay</h2>
        <div class="sections" id="sections"></div>
      </section>
    </main>

    <section class="detail">
      <h2 id="detailTitle">Trace replay / Trace replay</h2>
      <p class="summary" id="detailSummary">Trace replay, Trace replay agent, toolTrace replay.</p>
      <div class="tabs">
        <button id="tabCode" class="active">Trace replay</button>
        <button id="tabInput">Trace replay / Trace replay</button>
        <button id="tabOutput">Trace replay / Trace replay</button>
        <button id="tabRaw">Trace replay JSON</button>
      </div>
      <div class="jsonbox" id="jsonBox"></div>
      <aside class="explain" id="explainBox"></aside>
    </section>
  </div>

  <script id="replay-data" type="application/json">${scriptJson(replayData)}</script>
  <script>
    const data = JSON.parse(document.getElementById('replay-data').textContent);
    const state = {
      playing: false,
      paused: false,
      index: -1,
      timer: null,
      selected: null,
      tab: 'code',
      view: 'timeline',
      canvasNodes: [],
      canvasFocus: null
    };

    const $ = (id) => document.getElementById(id);
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
    const formatJson = (value) => JSON.stringify(value ?? null, null, 2);
    const jsonType = (value) => {
      if (value === null) return 'null';
      if (Array.isArray(value)) return 'array';
      return typeof value;
    };
    const jsonPreview = (value) => {
      const type = jsonType(value);
      if (type === 'array') return \`Array(\${value.length})\`;
      if (type === 'object') return \`Object(\${Object.keys(value).length})\`;
      if (type === 'string') {
        const text = String(value);
        return JSON.stringify(text.length > 90 ? text.slice(0, 90) + '...' : text);
      }
      return String(value);
    };
    const renderJsonLeaf = (key, value) => {
      const type = jsonType(value);
      const keyHtml = key === null ? '' : \`<span class="json-key">\${escapeHtml(key)}</span>: \`;
      if (type === 'string') return \`<div class="json-leaf">\${keyHtml}<span class="json-string">\${escapeHtml(JSON.stringify(value))}</span></div>\`;
      if (type === 'number') return \`<div class="json-leaf">\${keyHtml}<span class="json-number">\${escapeHtml(value)}</span></div>\`;
      if (type === 'boolean') return \`<div class="json-leaf">\${keyHtml}<span class="json-boolean">\${escapeHtml(value)}</span></div>\`;
      if (type === 'undefined') return \`<div class="json-leaf">\${keyHtml}<span class="json-null">undefined</span></div>\`;
      return \`<div class="json-leaf">\${keyHtml}<span class="json-null">null</span></div>\`;
    };
    const renderJsonNode = (key, value, depth = 0) => {
      const type = jsonType(value);
      if (type !== 'object' && type !== 'array') return renderJsonLeaf(key, value);
      const entries = type === 'array'
        ? value.map((item, index) => [index, item])
        : Object.entries(value);
      const keyHtml = key === null ? '<span class="json-key">root</span>' : \`<span class="json-key">\${escapeHtml(key)}</span>\`;
      const open = depth < 1 ? ' open' : '';
      const children = entries.length
        ? entries.map(([childKey, childValue]) => renderJsonNode(childKey, childValue, depth + 1)).join('')
        : '<div class="json-leaf"><span class="json-null">(empty)</span></div>';
      return \`<details\${open}><summary>\${keyHtml}<span class="json-meta">\${escapeHtml(jsonPreview(value))}</span></summary>\${children}</details>\`;
    };
    const renderJsonTree = (value) => \`<div class="json-tree">\${renderJsonNode(null, value)}</div>\`;
    const statusClass = (status) => {
      const s = String(status || '').toLowerCase();
      if (s === 'success') return 'success';
      if (s === 'running') return 'running';
      if (s === 'error') return 'error';
      if (s === 'skipped') return 'skipped';
      return '';
    };
    const shortDate = (value) => {
      if (!value) return 'Trace replay';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour12: false });
    };
    const modelPurposeLabels = {
      planner: 'Trace replay planner',
      wechat_source_selector: 'Trace replay',
      web_search_collect: 'Trace replay Step1',
      web_search_summarize: 'Trace replay Step2',
      web_search_structure: 'Trace replay Step3',
      wechat_article_selector: 'Trace replay',
      wechat_article_insight: 'Trace replay',
      briefing_summary: 'Trace replay',
      structure_informationSummary: 'Trace replayInformation Digest',
      structure_todayTodo: 'Trace replayToday To-Dos',
      structure_twinRecommendation: 'Trace replayTwin Recommendations',
      aggregate_structured_briefing: 'AggregateTrace replay',
      generate_reply: 'Trace replay',
      unknown_model_call: 'Trace replay'
    };
    const callKind = (step) => {
      const id = step?.id || '';
      if (id === 'plan_subagents' || id === 'generate_briefing_summary' || id.startsWith('structure_') || id === 'aggregate_structured_briefing' || id === 'generate_reply') {
        return { key: 'model', label: 'Trace replay' };
      }
      if (id === 'call_wechat_agent' || id === 'call_web_search') return { key: 'mixed', label: 'Trace replay' };
      if (id === 'persist_briefing') return { key: 'db', label: 'Trace replay' };
      if (id === 'load_context' || id === 'merge_results') return { key: 'code', label: 'Trace replay' };
      if (id.includes('gmail') || id.includes('feishu') || id.includes('xiaohongshu')) return { key: 'code', label: 'Trace replaySkipped' };
      return { key: 'code', label: 'Trace replay' };
    };
    const modelPurposesForStep = (step) => {
      const id = step?.id || '';
      if (id === 'plan_subagents') return ['planner'];
      if (id === 'call_wechat_agent') return ['wechat_source_selector', 'wechat_article_selector', 'wechat_article_insight'];
      if (id === 'call_web_search') return ['web_search_collect', 'web_search_summarize', 'web_search_structure'];
      if (id === 'generate_briefing_summary') return ['briefing_summary'];
      if (id === 'structure_informationSummary') return ['structure_informationSummary'];
      if (id === 'structure_todayTodo') return ['structure_todayTodo'];
      if (id === 'structure_twinRecommendation') return ['structure_twinRecommendation'];
      if (id === 'aggregate_structured_briefing') return ['aggregate_structured_briefing'];
      if (id === 'generate_reply') return ['generate_reply'];
      return [];
    };
    const modelCallsForStep = (step) => {
      const purposes = new Set(modelPurposesForStep(step));
      return data.modelTraces.filter((trace) => purposes.has(trace.purpose));
    };
    const formatDuration = (ms) => {
      if (!Number.isFinite(ms) || ms < 0) return '';
      if (ms < 1000) return Math.round(ms) + 'ms';
      const totalSeconds = ms / 1000;
      if (totalSeconds < 60) return totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0) + 's';
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = Math.round(totalSeconds % 60);
      if (minutes < 60) return minutes + 'm' + String(seconds).padStart(2, '0') + 's';
      const hours = Math.floor(minutes / 60);
      const remainMinutes = minutes % 60;
      return hours + 'h' + String(remainMinutes).padStart(2, '0') + 'm';
    };
    const timeMs = (value) => {
      const time = new Date(value || '').getTime();
      return Number.isFinite(time) ? time : null;
    };
    const plannerMetaFromStep = (step) => {
      const detail = String(step?.detail || '');
      const sourceMatch = detail.match(/PlannerSource: ([^ ]+)/);
      const reasonMatch = detail.match(/PlannerTrace replay: (.+)$/);
      return {
        plannerSource: sourceMatch?.[1] || null,
        fallbackReason: reasonMatch?.[1] || null,
        isFallback: sourceMatch?.[1] === 'FALLBACK'
      };
    };
    const canvasBadgesForStep = (step, index) => {
      const id = step?.id || '';
      const meta = plannerMetaFromStep(step);
      if (id === 'load_context') return ['Trace replay', 'DBTrace replay', 'Trace replay'];
      if (id === 'plan_subagents') {
        if (meta.isFallback) return ['LLMfailed', 'fallbackTrace replay', 'Trace replay+Trace replay'];
        return ['LLM planner', step.status === 'RUNNING' ? 'Trace replay' : 'planTrace replay'];
      }
      if (id === 'call_wechat_agent') return ['Trace replay', 'Trace replay', 'Trace replay'];
      if (id === 'call_web_search') return ['tool+LLM', 'Trace replay', 'Trace replay'];
      if (id.includes('xiaohongshu') || id.includes('gmail') || id.includes('feishu')) return ['Trace replay', 'SKIPPED'];
      if (id === 'merge_results') return ['Trace replay', 'Trace replay'];
      if (id === 'generate_briefing_summary') return ['LLMTrace replay', 'Trace replay'];
      if (id.startsWith('structure_')) return ['LLMTrace replay', 'Trace replay'];
      if (id === 'aggregate_structured_briefing') return ['LLMAggregate', 'Trace replay/Trace replay'];
      if (id === 'persist_briefing') return ['DB upsert', 'Trace replay'];
      if (id === 'generate_reply') return ['LLMTrace replay', 'Trace replay'];
      return ['traceTrace replay'];
    };
    const canvasBadgesForModel = (trace) => {
      if (trace.purpose === 'planner') return ['systemTrace replay', 'userTrace replay', 'JSONTrace replay'];
      if (trace.purpose === 'wechat_source_selector') return ['Trace replay', 'Trace replaytask+sources'];
      if (trace.purpose === 'wechat_article_selector') return ['Trace replay', 'Trace replay'];
      if (trace.purpose === 'wechat_article_insight') return ['Trace replay', 'Trace replayx5'];
      if (trace.purpose === 'web_search_collect') return ['Trace replay', 'web tool'];
      if (trace.purpose === 'web_search_summarize') return ['Trace replay'];
      if (trace.purpose === 'web_search_structure') return ['Trace replay'];
      if (trace.purpose === 'briefing_summary') return ['Trace replay'];
      if (String(trace.purpose || '').startsWith('structure_')) return ['Trace replay'];
      if (trace.purpose === 'aggregate_structured_briefing') return ['AggregateTrace replay'];
      if (trace.purpose === 'generate_reply') return ['Trace replay'];
      return ['LLM'];
    };
    const compactText = (value, limit = 180) => {
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      if (!raw) return '';
      return raw.length > limit ? raw.slice(0, limit) + '...' : raw;
    };
    const parseModelUserJson = (trace) => {
      const message = (trace?.messages || []).find((item) => item.role === 'user');
      if (!message?.content) return null;
      try {
        return JSON.parse(message.content);
      } catch {
        return null;
      }
    };
    const sourceCard = (kind, label, value, note) => ({ kind, label, value: compactText(value), rawValue: value, note });
    const inputSourcesForModel = (trace) => {
      const userJson = parseModelUserJson(trace);
      const system = (trace?.messages || []).find((item) => item.role === 'system')?.content || '';
      if (trace?.purpose === 'planner') {
        return [
          sourceCard('Trace replayprompt', 'system prompt', system, 'Trace replay planner Trace replay.'),
          sourceCard('Trace replay', 'userQuery', userJson?.userQuery, 'Trace replay.'),
          sourceCard('Trace replay', 'executiveSystemPrompt', userJson?.executiveSystemPrompt, 'Trace replayExecutive AssistantTrace replay, Trace replay planner Trace replay.'),
          sourceCard('DBTrace replay', 'accountContext', userJson?.accountContext, 'Trace replay loadExecutiveContext Trace replay.'),
          sourceCard('Trace replay', 'availableSkills', userJson?.availableSkills?.map((item) => ({ skillId: item.skillId, available: item.available, implemented: item.implemented })), 'Trace replay skill registry + Trace replay.'),
        ];
      }
      if (trace?.purpose === 'wechat_source_selector') {
        return [
          sourceCard('Trace replayprompt', 'system prompt', system, 'Trace replayWeChat Official AccountsTrace replay.'),
          sourceCard('Trace replay', 'task.objective', userJson?.task?.objective, 'Trace replayExecutive Assistant planner/fallback Trace replay taskSpec.'),
          sourceCard('Trace replay', 'task.sourceSelectionCriteria', userJson?.task?.sourceSelectionCriteria, 'Trace replay buildWechatTaskSpec; Trace replay executiveSystemPrompt.'),
          sourceCard('Trace replaydefault', 'task.timeWindow', userJson?.task?.timeWindow, 'resolveTaskSpec Trace replay.'),
          sourceCard('DBTrace replay', 'sources', userJson?.sources?.map((item) => ({ name: item.name, domains: item.domains, topics: item.topics })), 'Trace replay investorWechatSource Trace replay profile/inferProfile.'),
        ];
      }
      if (trace?.purpose === 'wechat_article_selector') {
        return [
          sourceCard('Trace replayprompt', 'system prompt', system, 'Trace replay.'),
          sourceCard('Trace replay', 'task', userJson?.task, 'Trace replay taskSpec.'),
          sourceCard('toolTrace replay', 'articles', userJson?.articles?.slice?.(0, 8), 'Trace replay listArticlesByAccount Trace replay.'),
          sourceCard('Trace replay', 'maxSelected', userJson?.maxSelected, 'SELECTED_DETAIL_LIMIT.'),
        ];
      }
      if (trace?.purpose === 'wechat_article_insight') {
        return [
          sourceCard('Trace replayprompt', 'system prompt', system, 'Trace replay.'),
          sourceCard('Trace replay', 'executiveRequest', userJson?.executiveRequest, 'Trace replay.'),
          sourceCard('Trace replay', 'task', userJson?.task, 'Trace replay taskSpec.'),
          sourceCard('Trace replay', 'article', userJson?.article, 'Trace replay + Trace replay.'),
        ];
      }
      return [
        sourceCard('Trace replayprompt', 'system prompt', system, 'Trace replay/Trace replay.'),
        sourceCard('Trace replay', 'user JSON/text', userJson || (trace?.messages || []).find((item) => item.role === 'user')?.content, 'Trace replay user message.'),
      ];
    };
    const inputSourcesForStep = (step, index) => {
      const id = step?.id || '';
      const relatedModels = modelCallsForStep(step);
      if (id === 'load_context') {
        return [
          sourceCard('Trace replay', 'investorId', data.user?.id, 'Trace replay loadExecutiveContext Trace replay id.'),
          sourceCard('DBTrace replay', 'user/thread', { user: data.user?.email, threadId: data.thread?.id }, 'Trace replay raw audit Trace replay.'),
          sourceCard('DBTrace replay', 'wechatSources', data.wechatSources.map((item) => item.displayName), 'Trace replay investorWechatSource.'),
          sourceCard('Trace replay', 'plannerTrace payload', step.payload, 'RUNNING Trace replay payload; SUCCESS Trace replay.'),
        ];
      }
      if (id === 'plan_subagents') {
        const plannerJson = parseModelUserJson(relatedModels[0]);
        return [
          sourceCard('Trace replay', 'userQuery', data.request?.userQuery, 'Trace replay.'),
          sourceCard('Trace replay', 'executiveSystemPrompt', plannerJson?.executiveSystemPrompt || data.executiveAgentConfig?.systemPrompt, 'Trace replay planner Trace replayExecutive AssistantTrace replay.'),
          sourceCard('DBTrace replay', 'accountContext', plannerJson?.accountContext, 'Trace replay loadExecutiveContext Trace replay planner.'),
          sourceCard('Trace replay', 'availableSkills', plannerJson?.availableSkills?.map((item) => ({ skillId: item.skillId, available: item.available })), 'skill registry + Trace replay.'),
          sourceCard('fallback', 'plannerMeta', plannerMetaFromStep(step), 'Trace replay LLM failed, Trace replay fallbackExecutivePlan Trace replay.'),
        ];
      }
      if (id === 'call_wechat_agent') {
        const sourceSelector = data.modelTraces.find((trace) => trace.purpose === 'wechat_source_selector');
        const sourceJson = parseModelUserJson(sourceSelector);
        return [
          sourceCard('Trace replay', 'wechat taskSpec', sourceJson?.task, 'Trace replay planner/fallback buildWechatTaskSpec.'),
          sourceCard('DBTrace replay', 'sources', sourceJson?.sources?.map((item) => ({ name: item.name, domains: item.domains, topics: item.topics })), 'Trace replay.'),
          sourceCard('tool/Provider', 'selected agent debug', data.subagents.find((item) => item.agentType === 'WECHAT')?.debug, 'Trace replay agent Trace replay debug.'),
          sourceCard('LLMTrace replay', 'model calls', relatedModels.map((trace) => ({ purpose: trace.purpose, status: trace.status })), 'Trace replay, Trace replay, Trace replay.'),
        ];
      }
      if (id === 'call_web_search') {
        return [
          sourceCard('Trace replay', 'channelInstruction / historical userQuery', data.request?.userQuery, 'Trace replay; Trace replay.'),
          sourceCard('Trace replay', 'webSearchIntent', step.payload?.webSearchIntent || step.payload, 'Trace replay buildWebSearchChannelInstruction + executiveSystemPrompt Trace replay, Trace replayInformation DigestTrace replay.Trace replay raw input Trace replay.'),
          sourceCard('LLM/tool', 'model calls', relatedModels.map((trace) => ({ purpose: trace.purpose, status: trace.status })), 'Trace replay, Trace replay, Trace replay.'),
        ];
      }
      if (id === 'merge_results') {
        return [
          sourceCard('Trace replay', 'subagentResults', data.subagents.map((item) => ({ agentType: item.agentType, itemCount: item.briefingItems?.length || 0 })), 'Trace replay/Trace replay agent Trace replay.'),
          sourceCard('Trace replay', 'baseBriefing', 'context.baseBriefing', 'Trace replay, Trace replay loadExecutiveContext.'),
        ];
      }
      if (id === 'persist_briefing') {
        return [
          sourceCard('Trace replay', 'document', { dateKey: data.document.dateKey, title: data.document.title, sections: data.document.sections?.map((section) => ({ title: section.title, items: section.items?.length || 0 })) }, 'buildDocument Trace replay.'),
          sourceCard('DB key', 'investorId_dateKey', { investorId: data.user?.id, dateKey: data.document.dateKey }, 'prisma.upsert Trace replay.'),
        ];
      }
      return [
        sourceCard('traceTrace replay', 'step', { id: step.id, status: step.status, detail: step.detail, payload: step.payload }, 'plannerTrace Trace replay.'),
        sourceCard('Trace replayLLM', 'model calls', relatedModels.map((trace) => ({ purpose: trace.purpose, status: trace.status })), 'Trace replay, Trace replay/DB/tool.'),
      ];
    };
    const inputSourcesForParent = (node) => [
      sourceCard('Trace replay', node.title, node.codeTrace, 'Canvas Trace replay.Trace replay span, Trace replay.'),
      sourceCard('Trace replay', 'request', data.request, 'Trace replay.'),
      sourceCard('Trace replay', 'user/thread', { user: data.user, thread: data.thread }, 'Trace replay.')
    ];
    function activeCanvasInputSubject() {
      if (state.canvasFocus?.kind === 'step' && data.plannerTrace[state.canvasFocus.index]) {
        return { type: 'step', index: state.canvasFocus.index, step: data.plannerTrace[state.canvasFocus.index] };
      }
      if (state.canvasFocus?.kind === 'model' && data.modelTraces[state.canvasFocus.traceIndex]) {
        return { type: 'model', traceIndex: state.canvasFocus.traceIndex, trace: data.modelTraces[state.canvasFocus.traceIndex] };
      }
      if (state.canvasFocus?.kind === 'parent') {
        return { type: 'parent', node: state.canvasFocus.node };
      }
      if (state.index >= 0 && data.plannerTrace[state.index]) {
        return { type: 'step', index: state.index, step: data.plannerTrace[state.index] };
      }
      return { type: 'request' };
    }
    function renderCanvasInputPanel() {
      const panel = $('canvasInputs');
      if (!panel) return;
      const subject = activeCanvasInputSubject();
      let title = 'Trace replay';
      let sources = [];
      if (subject.type === 'step') {
        title = 'Trace replaySource: Trace replay ' + (subject.index + 1) + ' · ' + (subject.step.title || subject.step.id);
        sources = inputSourcesForStep(subject.step, subject.index);
      } else if (subject.type === 'model') {
        const label = modelPurposeLabels[subject.trace.purpose] || subject.trace.purpose;
        title = 'Trace replaySource: LLM · ' + label;
        sources = inputSourcesForModel(subject.trace);
      } else if (subject.type === 'parent') {
        title = 'Trace replaySource: Trace replay · ' + subject.node.title;
        sources = inputSourcesForParent(subject.node);
      } else {
        title = 'Trace replaySource: Trace replay';
        sources = [
          sourceCard('Trace replay', 'userQuery', data.request?.userQuery, 'Trace replay"Trace replay"Trace replay.Trace replay.'),
          sourceCard('Trace replay', 'user', data.user, 'Trace replay.'),
          sourceCard('toolTrace replay', 'selectedtoolCall.toolArgs', data.selectedtoolCall?.toolArgs, 'Trace replaytoolTrace replay.')
        ];
      }
      panel.innerHTML = '<h3>' + escapeHtml(title) + '</h3>' +
        '<div class="input-source-grid">' + sources.map((source, index) =>
          '<article class="input-source" data-source-index="' + index + '">' +
            '<span class="tag">' + escapeHtml(source.kind) + '</span>' +
            '<strong>' + escapeHtml(source.label) + '</strong>' +
            '<p>' + escapeHtml(source.value) + '</p>' +
            '<p style="margin-top:6px;color:#64748b">' + escapeHtml(source.note || '') + '</p>' +
          '</article>'
        ).join('') + '</div>';
      panel.querySelectorAll('.input-source').forEach((el) => {
        el.addEventListener('click', () => {
          const source = sources[Number(el.dataset.sourceIndex)];
          setDetail('Trace replay: ' + source.label, source.note || '', {
            kind: source.kind,
            label: source.label,
            value: source.rawValue,
            compactValue: source.value,
            note: source.note
          }, {
            usedAs: 'Trace replay, Trace replay user/system message, Trace replay.'
          }, source, { key: 'code', label: 'Trace replay' }, {
            producedBy: source.kind,
            usedByNext: [source.note || 'Trace replay'],
            persistence: 'Trace replay raw trace Trace replay message, Trace replaySaveTrace replay .debug/openrouter-traces; Trace replay, Trace replay.'
          });
        });
      });
    }
    const codeLocation = {
      routeRun: 'src/app/api/investor/executive-assistant/route.ts:305',
      asyncRun: 'src/app/api/investor/executive-assistant/route.ts:565',
      updateBriefing: 'src/lib/agents/executive-orchestrator.ts:1373',
      loadContext: 'src/lib/agents/executive-orchestrator.ts:786',
      planTurn: 'src/lib/agents/executive-orchestrator.ts:697',
      merge: 'src/lib/agents/executive-orchestrator.ts:897',
      summary: 'src/lib/agents/executive-orchestrator.ts:925',
      structured: 'src/lib/agents/executive-orchestrator.ts:1247',
      structuredModule: 'src/lib/agents/executive-orchestrator.ts:1091',
      aggregator: 'src/lib/agents/executive-orchestrator.ts:1178',
      buildDocument: 'src/lib/agents/executive-orchestrator.ts:1312',
      reply: 'src/app/api/investor/executive-assistant/route.ts:133'
    };
    const finalEventForStep = (step, index) => {
      let finalEvent = step;
      for (let i = index + 1; i < data.plannerTrace.length; i += 1) {
        if (data.plannerTrace[i].id === step.id) finalEvent = data.plannerTrace[i];
      }
      return finalEvent;
    };
    const runningEventForStep = (step, index) => {
      if (step?.status === 'RUNNING') return step;
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = data.plannerTrace[i];
        if (candidate.id === step.id && candidate.status === 'RUNNING') return candidate;
      }
      return null;
    };
    const stepDurationInfo = (step, index) => {
      const startEvent = runningEventForStep(step, index);
      const endEvent = finalEventForStep(step, index);
      const start = timeMs(startEvent?.timestamp);
      const end = timeMs(endEvent?.timestamp);
      if (start === null || end === null || end < start) return { ms: null, label: '', startEvent, endEvent };
      return { ms: end - start, label: formatDuration(end - start), startEvent, endEvent };
    };
    const durationSemanticsForStep = (step) => {
      const id = step?.id || '';
      if (id === 'structure_briefing_json') {
        return {
          prefix: 'Includes ',
          label: 'Trace replay',
          note: 'Trace replay inclusive duration, Trace replayInformation Digest, Today To-Dos, Twin RecommendationsTrace replayAggregateTrace replay, Trace replay.'
        };
      }
      if (id === 'structure_informationSummary' || id === 'structure_todayTodo' || id === 'structure_twinRecommendation') {
        return {
          prefix: 'Trace replay ',
          label: 'Trace replay',
          note: 'Trace replay; Trace replay, Trace replayComplete.'
        };
      }
      if (id === 'aggregate_structured_briefing') {
        return {
          prefix: 'Trace replay ',
          label: 'Trace replayAggregateTrace replay',
          note: 'Trace replayAllTrace replay, Aggregate agent Trace replay.'
        };
      }
      return {
        prefix: '',
        label: 'Trace replay',
        note: 'Trace replay step id Trace replay RUNNING Trace replay.'
      };
    };
    const stepDurationDisplayInfo = (step, index) => {
      const duration = stepDurationInfo(step, index);
      const semantics = durationSemanticsForStep(step);
      return {
        ...duration,
        rawLabel: duration.label,
        label: duration.label ? semantics.prefix + duration.label : '',
        semantics,
      };
    };
    const overallDurationInfo = () => {
      const first = data.plannerTrace[0];
      const last = data.plannerTrace[data.plannerTrace.length - 1];
      const start = timeMs(first?.timestamp);
      const end = timeMs(last?.timestamp);
      if (start === null || end === null || end < start) return { ms: null, label: '' };
      return { ms: end - start, label: formatDuration(end - start) };
    };
    const modelDurationLabel = (trace) => formatDuration(Number(trace?.durationMs));
    const modelDurationSumLabel = (traces) => {
      const total = traces.reduce((sum, trace) => {
        const value = Number(trace?.durationMs);
        return Number.isFinite(value) ? sum + value : sum;
      }, 0);
      return total > 0 ? 'sum ' + formatDuration(total) : '';
    };
    const usageForStep = (step, index) => {
      const id = step?.id || '';
      const finalEvent = finalEventForStep(step, index);
      const duration = stepDurationDisplayInfo(step, index);
      const base = {
        eventStatus: step.status,
        finalStatusForSameStepId: finalEvent.status,
        duration: duration.label || undefined,
        durationMs: duration.ms,
        durationSemantics: duration.semantics?.label,
        isAppendOnlyTraceEvent: finalEvent !== step,
        note: finalEvent !== step
          ? 'plannerTrace Trace replay; Trace replay, Trace replay id Trace replay.' + (duration.semantics?.note ? ' ' + duration.semantics.note : '')
          : 'Trace replay step id Trace replay trace Trace replay.' + (duration.semantics?.note ? ' ' + duration.semantics.note : '')
      };
      if (id === 'load_context') {
        return {
          ...base,
          producedBy: 'Trace replay loadExecutiveContext / loadBriefing Trace replay',
          usedByNext: ['Trace replay planner Trace replay accountContext', 'buildBriefingSummary Trace replay internalFacts/baseBriefing', 'mergeResults Trace replay'],
          persistence: 'Trace replay; Trace replay.Trace replay executive_assistant_runs.plannerTrace/result Trace replay executive_briefings.'
        };
      }
      if (id === 'plan_subagents') {
        return {
          ...base,
          producedBy: 'Trace replay EXECUTIVE_PLANNER, failedTrace replay fallbackExecutivePlan',
          usedByNext: ['Trace replay skill/subagent', 'Trace replaystep', 'Trace replay wechatTaskSpec/webSearchIntent'],
          persistence: 'planner Trace replay plannerTrace Trace replay executive_assistant_runs; Trace replay toolResult Trace replay plannerTrace.'
        };
      }
      if (id === 'call_wechat_agent') {
        return {
          ...base,
          producedBy: 'Trace replay: Trace replay provider, Trace replay/Trace replay/Trace replay',
          usedByNext: ['subagentResults[].briefingItems Trace replay merge_results', 'toolCalls Trace replay', 'debug Trace replay'],
          persistence: 'Trace replay agent Trace replay executive_assistant_runs.result.subagents/toolCalls; Trace replay briefingItems Trace replay executive_briefings.sources/sections.'
        };
      }
      if (id === 'call_web_search') {
        return {
          ...base,
          producedBy: 'Trace replay: OpenRouter web_search/web_fetch tool + Step2/Step3 Trace replay',
          usedByNext: ['WEB_SEARCH briefingItems Trace replay merge_results', 'citations/findings/searchLog Trace replay toolCalls/debug'],
          persistence: 'Trace replay executive_assistant_runs.result.subagents/toolCalls; Trace replay executive_briefings.Trace replay raw Trace replay .debug/openrouter-traces.'
        };
      }
      if (id === 'merge_results') {
        return {
          ...base,
          producedBy: 'Trace replay mergeBriefingWithItems',
          usedByNext: ['buildBriefingSummary Trace replay briefing Trace replay', 'buildDocument Trace replay'],
          persistence: 'Trace replay; Trace replay run result Trace replay briefing document Save.'
        };
      }
      if (id === 'generate_briefing_summary') {
        return {
          ...base,
          producedBy: 'Trace replay EXECUTIVE Trace replay',
          usedByNext: ['Trace replay agent Trace replay generatedSummary Trace replay', 'Trace replay'],
          persistence: 'Trace replay; AggregateTrace replay summary Trace replay executive_briefings.summary.Trace replay prompt/output Trace replay modelCalls Trace replay.'
        };
      }
      if (id.startsWith('structure_')) {
        return {
          ...base,
          producedBy: 'Trace replay EXECUTIVE_STRUCTURER, Trace replay; failedTrace replay fallbackStructuredModule Trace replay',
          usedByNext: ['aggregate_structured_briefing Trace replay', 'buildDocument Trace replay sections'],
          persistence: 'Trace replay items Trace replay executive_briefings.sections; Trace replay prompt/output Trace replay modelCalls Trace replay.'
        };
      }
      if (id === 'aggregate_structured_briefing') {
        return {
          ...base,
          producedBy: 'Trace replay EXECUTIVE_STRUCTURER Aggregate agent',
          usedByNext: ['buildDocument.title', 'buildDocument.summary', 'persist_briefing'],
          persistence: 'title/summary Trace replay executive_briefings; Trace replay prompt/output Trace replay modelCalls Trace replay.'
        };
      }
      if (id === 'persist_briefing') {
        return {
          ...base,
          producedBy: 'Trace replay prisma.executiveBriefing.upsert',
          usedByNext: ['Trace replay GET/Trace replayCompleteTrace replay persistedBriefing', 'Trace replay'],
          persistence: 'Trace replay executive_briefings, Trace replay investorId + dateKey.'
        };
      }
      if (id === 'generate_reply') {
        return {
          ...base,
          producedBy: 'Trace replay EXECUTIVE Trace replay',
          usedByNext: ['Trace replay AgentMessage', 'Trace replay/Trace replay'],
          persistence: 'assistant message Trace replay agent_messages; executionSnapshot Trace replay message.meta.Trace replay prompt/output Trace replay modelCalls Trace replay.'
        };
      }
      return {
        ...base,
        producedBy: 'Trace replay planner Trace replay',
        usedByNext: ['Trace replay step id Trace replay'],
        persistence: 'Trace replay plannerTrace Trace replay executive_assistant_runs.'
      };
    };
    const contextCallInput = () => ({
      investorId: data.user?.id,
      userQuery: data.request?.userQuery,
      executiveSystemPrompt: data.executiveAgentConfig?.systemPrompt || data.executiveAgentConfig?.defaultSystemPrompt || '(not exported as full value)',
      onPlannerEvent: 'emitPlannerEvent / persistPlannerEvent callback'
    });
    const codeTraceForStep = (step, index) => {
      const id = step?.id || '';
      const base = {
        traceStepId: id,
        traceEventIndex: index + 1,
        eventStatus: step.status,
        parentCallStack: [
          {
            function: 'executeExecutiveAssistantRun',
            file: codeLocation.asyncRun,
            role: 'Trace replay run Trace replay: claim run, Trace replay request, Trace replay plannerTrace/result'
          },
          {
            function: 'runExecutiveAssistantTurn',
            file: codeLocation.routeRun,
            role: 'Trace replay: Trace replay, Trace replay, Trace replaytoolTrace replay, Generate reply'
          },
          {
            function: 'updateTodayExecutiveBriefing',
            file: codeLocation.updateBriefing,
            role: 'Trace replay orchestrator; Trace replay planner step Trace replay'
          }
        ],
        outerFunctionObservedInput: contextCallInput(),
        exactLocalVariablesPersisted: false
      };
      if (id === 'load_context') {
        return {
          ...base,
          currentOuterCall: {
            function: 'loadExecutiveContext',
            file: codeLocation.loadContext,
            callExpression: 'const context = await loadExecutiveContext(params.investorId);',
            observedArguments: { investorId: data.user?.id }
          },
          directChildCalls: [
            'emitPlannerStep(onPlannerEvent, "load_context", "RUNNING", ...)',
            'prisma.user.findUnique({ where: { id: investorId }, select: { id: true } })',
            'prisma.investorIntegration.findMany({ where: { investorId } })',
            'prisma.integrationSnapshot.findMany(...)',
            'prisma.investorWechatSource.findMany({ where: { investorId } })',
            'prisma.avatar.findMany({ where: { investorId }, include: { chats: ... } })',
            'prisma.investorTeamHire.findMany({ where: { investorId } })',
            'prisma.agentThread.findMany({ where: { investorId } })',
            'resolveHiredTeamKeys(...)',
            'buildExecutiveDailyBriefing(...)',
            'emitPlannerStep(onPlannerEvent, "load_context", "SUCCESS", { payload })'
          ],
          observedVariablesAfterCall: {
            contextPayloadPersistedInPlannerTrace: step.payload || null,
            exportedRowsUsedToInferContext: {
              executiveAgentConfig: data.executiveAgentConfig,
              wechatSources: data.wechatSources,
              latestPersistedBriefing: data.latestPersistedBriefing
            }
          },
          returnedVariable: 'context: LoadedExecutiveContext | null',
          returnedVariableVisibleFields: step.payload || null,
          returnedVariableHiddenFieldsNotPersisted: ['baseBriefing', 'hiredTeamKeys Set object', 'integrationProviders Set object', 'internalFacts full array']
        };
      }
      if (id === 'plan_subagents') {
        return {
          ...base,
          currentOuterCall: {
            function: 'planExecutiveTurn',
            file: codeLocation.planTurn,
            callExpression: 'const plan = await planExecutiveTurn({ userQuery: params.userQuery, context, executiveSystemPrompt });',
            observedArguments: {
              userQuery: data.request?.userQuery,
              contextVisibleFromPreviousStep: data.plannerTrace.find((item) => item.id === 'load_context' && item.status === 'SUCCESS')?.payload || null,
              executiveSystemPrompt: data.executiveAgentConfig?.systemPrompt || '(not fully exported)'
            }
          },
          directChildCalls: [
            'createJsonChatCompletion(messages, schema, getOpenRouterModel("EXECUTIVE_PLANNER"))',
            'normalizeExecutivePlan(...)',
            'fallbackExecutivePlan(...) when model fails',
            'params.onPlannerEvent({ type: "planner", steps: plan.steps, plan })',
            'emitPlannerStep(..., "plan_subagents", "SUCCESS", { payload })'
          ],
          observedVariablesAfterCall: {
            plannerMeta: plannerMetaFromStep(step),
            planPayloadPersistedInPlannerTrace: step.payload || null,
            relatedRawModelCalls: modelIoForStep(step).outputs,
            fallbackPlanRuleSummary: [
              'fallbackExecutivePlan Trace replay JSON; Trace replay.',
              'Trace replay userQuery Decide updateBriefing.',
              'Trace replay userQuery/executiveSystemPrompt Decide useWebSearch.',
              'Trace replay, Trace replay wechat_articles.',
              'Trace replay updateBriefing=true, Trace replay persist_briefing.',
              'internal_briefing Trace replay chat_reply Trace replay.'
            ]
          },
          returnedVariable: 'plan: ExecutiveTurnPlan',
          returnedVariableVisibleFields: step.payload || null
        };
      }
      if (id === 'call_wechat_agent') {
        return {
          ...base,
          currentOuterCall: {
            function: 'runWechatAgent',
            file: 'src/lib/agents/wechat-agent.ts',
            callExpression: 'subagentTasks.push(runWechatAgent({ investorId, userQuery, mode: "briefing", context: { taskSpec } }).then(...))',
            observedArguments: {
              investorId: data.user?.id,
              userQuery: data.request?.userQuery,
              mode: 'briefing',
              sourcesVisibleToRun: data.wechatSources,
              plannerTracePayload: step.payload || null
            }
          },
          directChildCalls: [
            'emitPlannerStep(..., "call_wechat_agent", "RUNNING", ...)',
            'buildWechatTaskSpec(...) when planner did not provide taskSpec',
            'runWechatAgent(...)',
            '.then(result => emitPlannerStep(..., "SUCCESS", { payload: result.debug }))',
            '.catch(error => emitPlannerStep(..., "ERROR", ...))'
          ],
          observedVariablesAfterCall: {
            result: data.subagents.find((item) => item.agentType === 'WECHAT') || null,
            toolCalls: data.toolCalls.filter((tool) => String(tool.toolName || '').toLowerCase().includes('wechat')),
            relatedRawModelCalls: modelIoForStep(step).outputs
          },
          returnedVariable: 'Promise<AgentRunResult> pushed into subagentTasks'
        };
      }
      if (id === 'call_web_search') {
        return {
          ...base,
          currentOuterCall: {
            function: 'runWebSearchAgent',
            file: 'src/lib/agents/web-search-agent.ts',
            callExpression: 'subagentTasks.push(runWebSearchAgent({ investorId, userQuery: webSearchChannelInstruction, mode: "briefing", context: { webSearchIntent, subagentResults: [], taskSpec } }).then(...))',
            observedArguments: {
              investorId: data.user?.id,
              historicalUserQuery: data.request?.userQuery,
              currentCodeUserQuery: 'buildWebSearchChannelInstruction(params.userQuery)',
              mode: 'briefing',
              webSearchIntent: step.payload?.webSearchIntent || step.payload || null
            }
          },
          directChildCalls: [
            'buildWebSearchChannelInstruction(params.userQuery)',
            'buildWebSearchIntent(params.userQuery, params.executiveSystemPrompt)',
            'emitPlannerStep(..., "call_web_search", "RUNNING", { payload: { webSearchIntent } })',
            'runWebSearchAgent(...)',
            '.then(webResult => emitPlannerStep(..., "SUCCESS", { payload: webResult.debug }))',
            '.catch(error => emitPlannerStep(..., "ERROR", ...))'
          ],
          observedVariablesAfterCall: {
            webResult: data.subagents.find((item) => item.agentType === 'WEB_SEARCH') || null,
            toolCalls: data.toolCalls.filter((tool) => String(tool.toolName || '').toLowerCase().includes('web')),
            relatedRawModelCalls: modelIoForStep(step).outputs
          },
          returnedVariable: 'Promise<AgentRunResult> pushed into subagentTasks'
        };
      }
      if (id === 'merge_results') {
        return {
          ...base,
          currentOuterCall: {
            function: 'mergeBriefingWithItems',
            file: codeLocation.merge,
            callExpression: 'const mergedBriefing = mergeBriefingWithItems(context.baseBriefing, briefingItems, suffix);',
            observedArguments: {
              briefing: 'context.baseBriefing (full object not persisted as exact local variable)',
              briefingItems: data.subagents.flatMap((item) => item.briefingItems),
              suffix: 'Trace replay ' + data.subagents.flatMap((item) => item.briefingItems).length + ' Trace replayAgentTrace replay.'
            }
          },
          directChildCalls: [
            'const briefingItems = subagentResults.flatMap(item => item.briefingItems)',
            'mergeBriefingWithItems(...)',
            'emitPlannerStep(..., "merge_results", "SUCCESS", ...)'
          ],
          observedVariablesAfterCall: {
            briefingItemsCount: data.subagents.flatMap((item) => item.briefingItems).length,
            mergedBriefingVisibleLaterAsDocumentInputs: data.document
          },
          returnedVariable: 'mergedBriefing: ExecutiveDailyBriefing'
        };
      }
      if (id === 'generate_briefing_summary') {
        return {
          ...base,
          currentOuterCall: {
            function: 'buildBriefingSummary',
            file: codeLocation.summary,
            callExpression: 'summary = await buildBriefingSummary({ userQuery, executiveSystemPrompt, briefing: mergedBriefing, subagentResults, internalFacts, useWeb });',
            observedArguments: {
              userQuery: data.request?.userQuery,
              subagentResults: data.subagents,
              useWeb: Boolean(data.subagents.find((item) => item.agentType === 'WEB_SEARCH')),
              mergedBriefing: 'not persisted as exact local variable; see document and model input'
            }
          },
          directChildCalls: [
            'fallbackSummary(mergedBriefing, subagentResults)',
            'emitPlannerStep(..., "generate_briefing_summary", "RUNNING", ...)',
            'createChatCompletion(messages, getOpenRouterModel("EXECUTIVE"))',
            'emitPlannerStep(..., "generate_briefing_summary", "SUCCESS", ...)'
          ],
          observedVariablesAfterCall: {
            summaryFromModelOutputs: modelIoForStep(step).outputs,
            finalDocumentSummary: data.document.summary
          },
          returnedVariable: 'summary: string'
        };
      }
      if (id.startsWith('structure_')) {
        return {
          ...base,
          currentOuterCall: {
            function: 'runStructuredModuleAgent',
            file: codeLocation.structuredModule,
            callExpression: 'await Promise.all(STRUCTURED_MODULE_PLANS.map(module => runStructuredModuleAgent({ ... })))',
            observedArguments: {
              moduleStep: id,
              moduleTitle: step.title,
              summaryInput: 'generatedSummary is visible in raw model messages',
              sources: data.document.sources
            }
          },
          directChildCalls: [
            'emitPlannerStep(..., stepId, "RUNNING", ...)',
            'createJsonChatCompletion(messages, schema, getOpenRouterModel("EXECUTIVE_STRUCTURER"))',
            'normalizeModuleAgentOutput(raw, module)',
            'emitPlannerStep(..., stepId, "SUCCESS", { payload })'
          ],
          observedVariablesAfterCall: {
            modulePlannerPayload: step.payload || null,
            relatedRawModelCalls: modelIoForStep(step).outputs
          },
          returnedVariable: 'StructuredBriefingModule'
        };
      }
      if (id === 'aggregate_structured_briefing') {
        return {
          ...base,
          currentOuterCall: {
            function: 'runStructuredBriefingAggregator',
            file: codeLocation.aggregator,
            callExpression: 'const aggregate = await runStructuredBriefingAggregator({ userQuery, summary, modules, sources, ... });',
            observedArguments: {
              modules: data.document.displaySections,
              sources: data.document.sources,
              userQuery: data.request?.userQuery
            }
          },
          directChildCalls: [
            'emitPlannerStep(..., "aggregate_structured_briefing", "RUNNING", ...)',
            'createJsonChatCompletion(messages, schema, getOpenRouterModel("EXECUTIVE_STRUCTURER"))',
            'normalizeAggregatorOutput(raw)',
            'emitPlannerStep(..., "aggregate_structured_briefing", "SUCCESS", { payload })'
          ],
          observedVariablesAfterCall: {
            aggregatePlannerPayload: step.payload || null,
            finalDocumentTitle: data.document.title,
            finalDocumentSummary: data.document.summary,
            relatedRawModelCalls: modelIoForStep(step).outputs
          },
          returnedVariable: '{ title: string; summary: string }'
        };
      }
      if (id === 'persist_briefing') {
        return {
          ...base,
          currentOuterCall: {
            function: 'prisma.executiveBriefing.upsert',
            file: codeLocation.updateBriefing,
            callExpression: 'await prisma.executiveBriefing.upsert({ where: { investorId_dateKey }, update, create });',
            observedArguments: {
              where: {
                investorId_dateKey: {
                  investorId: data.user?.id,
                  dateKey: data.document.dateKey
                }
              },
              update: {
                title: data.document.title,
                summary: data.document.summary,
                sections: data.document.sections,
                sources: data.document.sources
              },
              create: {
                investorId: data.user?.id,
                dateKey: data.document.dateKey,
                title: data.document.title,
                summary: data.document.summary,
                sections: data.document.sections,
                sources: data.document.sources
              }
            }
          },
          directChildCalls: [
            'emitPlannerStep(..., "persist_briefing", "RUNNING", ...)',
            'prisma.executiveBriefing.upsert(...)',
            'emitPlannerStep(..., "persist_briefing", "SUCCESS", ...)'
          ],
          observedVariablesAfterCall: {
            persistedBriefing: data.latestPersistedBriefing,
            plannerTraceEvent: step
          },
          returnedVariable: 'void from upsert path; final updateTodayExecutiveBriefing returns document separately'
        };
      }
      if (id === 'generate_reply') {
        return {
          ...base,
          parentCallStack: [
            {
              function: 'executeExecutiveAssistantRun',
              file: codeLocation.asyncRun,
              role: 'Trace replay run Trace replay'
            },
            {
              function: 'runExecutiveAssistantTurn',
              file: codeLocation.routeRun,
              role: 'Trace replay; generate_reply Trace replay updateTodayExecutiveBriefing Trace replay'
            }
          ],
          currentOuterCall: {
            function: 'generateExecutiveReply',
            file: codeLocation.reply,
            callExpression: 'reply = await generateExecutiveReply(params.messages, briefing, promptConfig.systemPrompt, executionSnapshot);',
            observedArguments: {
              messages: [data.latestUserMessage].filter(Boolean),
              briefing: 'updated briefing variable; exact local object not persisted, see latestAssistantMessage.meta.executionSnapshot/document',
              executionSnapshot: data.latestAssistantMessage?.meta?.executionSnapshot || null
            }
          },
          directChildCalls: [
            'buildBriefingContext(briefing)',
            'buildExecutionContext(executionSnapshot)',
            'createChatCompletion(chatMessages, getOpenRouterModel("EXECUTIVE"))',
            'appendThreadMessage({ role: "ASSISTANT", content: reply, meta: { executionSnapshot } })'
          ],
          observedVariablesAfterCall: {
            reply: data.latestAssistantMessage?.content || null,
            assistantMessage: data.latestAssistantMessage,
            relatedRawModelCalls: modelIoForStep(step).outputs
          },
          returnedVariable: 'reply: string'
        };
      }
      return {
        ...base,
        currentOuterCall: {
          function: 'emitPlannerStep / skipped branch',
          file: codeLocation.updateBriefing,
          callExpression: 'await emitPlannerStep(params.onPlannerEvent, "' + id + '", "' + step.status + '", ...);',
          observedArguments: { plannerTraceEvent: step }
        },
        directChildCalls: ['emitPlannerStep(...)'],
        observedVariablesAfterCall: { plannerTraceEvent: step },
        returnedVariable: 'planner trace event only'
      };
    };

    const modelInput = (trace) => ({
      id: trace.id,
      purpose: trace.purpose,
      type: trace.type,
      model: trace.model,
      timestamp: trace.timestamp,
      messages: trace.messages,
      tools: trace.tools,
      maxTokens: trace.maxTokens
    });
    const modelOutput = (trace) => ({
      id: trace.id,
      purpose: trace.purpose,
      status: trace.status,
      durationMs: trace.durationMs,
      output: trace.output,
      rawMessage: trace.rawMessage,
      rawCompletion: trace.rawCompletion,
      error: trace.error
    });

    function canvasStatus(status) {
      const s = String(status || '').toUpperCase();
      if (s === 'SUCCESS') return { bg: '#dcfce7', border: '#22c55e', text: '#14532d' };
      if (s === 'ERROR') return { bg: '#fee2e2', border: '#ef4444', text: '#7f1d1d' };
      if (s === 'SKIPPED') return { bg: '#f1f5f9', border: '#94a3b8', text: '#475569' };
      if (s === 'RUNNING') return { bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a' };
      return { bg: '#f8fafc', border: '#cbd5e1', text: '#475569' };
    }

    function drawRoundRect(ctx, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }

    function fitCanvasText(ctx, text, maxWidth) {
      const value = String(text || '');
      if (ctx.measureText(value).width <= maxWidth) return value;
      let out = value;
      while (out.length > 1 && ctx.measureText(out + '...').width > maxWidth) {
        out = out.slice(0, -1);
      }
      return out.length > 1 ? out + '...' : value.slice(0, 1);
    }

    function drawBox(ctx, node) {
      const palette = node.palette || canvasStatus(node.status);
      drawRoundRect(ctx, node.x, node.y, node.w, node.h, 8);
      ctx.fillStyle = palette.bg;
      ctx.fill();
      ctx.lineWidth = node.active ? 2.5 : 1.2;
      ctx.strokeStyle = node.active ? '#111827' : palette.border;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      drawRoundRect(ctx, node.x, node.y, node.w, node.h, 8);
      ctx.clip();
      const statusText = node.status ? String(node.status) : '';
      let titleMaxWidth = node.w - 20;
      if (statusText) {
        ctx.font = '700 10px Inter, sans-serif';
        const pillW = Math.min(64, Math.max(44, ctx.measureText(statusText).width + 14));
        const pillX = node.x + node.w - pillW - 8;
        const pillY = node.y + 8;
        drawRoundRect(ctx, pillX, pillY, pillW, 18, 9);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.86;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = palette.border;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = palette.text;
        ctx.textBaseline = 'middle';
        ctx.fillText(fitCanvasText(ctx, statusText, pillW - 12), pillX + 7, pillY + 9);
        ctx.textBaseline = 'alphabetic';
        titleMaxWidth = Math.max(52, pillX - node.x - 18);
      }
      ctx.fillStyle = palette.text;
      ctx.font = '700 12px Inter, sans-serif';
      ctx.fillText(fitCanvasText(ctx, node.title || '', titleMaxWidth), node.x + 10, node.y + 19);
      if (node.h >= 46) {
        ctx.font = '11px Inter, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.fillText(fitCanvasText(ctx, node.subtitle || '', node.w - 20), node.x + 10, node.y + 40);
      }
      if (node.durationLabel) {
        ctx.font = '700 10px Inter, sans-serif';
        const durationLabel = fitCanvasText(ctx, node.durationLabel, 72);
        const durationW = Math.min(82, Math.max(42, ctx.measureText(durationLabel).width + 14));
        const durationX = node.x + node.w - durationW - 8;
        const durationY = node.h >= 64 ? node.y + node.h - 46 : node.y + node.h - 20;
        drawRoundRect(ctx, durationX, durationY, durationW, 18, 9);
        ctx.fillStyle = '#111827';
        ctx.globalAlpha = 0.82;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(durationLabel, durationX + 7, durationY + 9);
        ctx.textBaseline = 'alphabetic';
      }
      if (Array.isArray(node.badges) && node.badges.length > 0 && node.h >= 64) {
        let badgeX = node.x + 10;
        const badgeY = node.y + node.h - 24;
        ctx.font = '700 10px Inter, sans-serif';
        for (const badge of node.badges.slice(0, 3)) {
          const label = fitCanvasText(ctx, badge, 70);
          const badgeW = Math.min(78, Math.max(34, ctx.measureText(label).width + 12));
          if (badgeX + badgeW > node.x + node.w - 8) break;
          drawRoundRect(ctx, badgeX, badgeY, badgeW, 17, 8);
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.72;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = 'rgba(100, 116, 139, .28)';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = '#334155';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, badgeX + 6, badgeY + 8.5);
          ctx.textBaseline = 'alphabetic';
          badgeX += badgeW + 5;
        }
      }
      ctx.restore();
    }

    function drawStructureGroup(ctx, group) {
      drawRoundRect(ctx, group.x, group.y, group.w, group.h, 12);
      ctx.fillStyle = '#fff7ed';
      ctx.globalAlpha = 0.62;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#f97316';
      ctx.stroke();
      ctx.restore();

      ctx.font = '700 12px Inter, sans-serif';
      ctx.fillStyle = '#9a3412';
      ctx.fillText(fitCanvasText(ctx, group.title, group.w - 170), group.x + 14, group.y + 22);

      ctx.font = '700 10px Inter, sans-serif';
      const label = fitCanvasText(ctx, group.durationLabel || '', 96);
      const labelW = Math.min(110, Math.max(54, ctx.measureText(label).width + 16));
      drawRoundRect(ctx, group.x + group.w - labelW - 12, group.y + 8, labelW, 20, 10);
      ctx.fillStyle = '#9a3412';
      ctx.globalAlpha = 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fdba74';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#9a3412';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, group.x + group.w - labelW - 4, group.y + 18);
      ctx.textBaseline = 'alphabetic';

      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = '#c2410c';
      ctx.fillText(fitCanvasText(ctx, group.subtitle, group.w - 28), group.x + 14, group.y + group.h - 14);
    }

    function setModelDetail(trace) {
      const label = modelPurposeLabels[trace.purpose] || trace.purpose;
      setDetail('Trace replay: ' + label, 'Trace replay: ' + trace.model + '; Trace replay: ' + trace.type + '; Trace replay: ' + (trace.durationMs || 'Trace replay') + 'ms', {
        messages: trace.messages,
        tools: trace.tools,
        maxTokens: trace.maxTokens
      }, {
        output: trace.output,
        rawMessage: trace.rawMessage,
        rawCompletion: trace.rawCompletion,
        error: trace.error
      }, trace, { key: 'model', label: 'Trace replay' }, {
        producedBy: '.debug/openrouter-traces JSONL Trace replay OpenRouter Trace replay',
        usedByNext: ['Trace replay output/rawMessage Trace replay planner, briefingItems, sections Trace replay'],
        persistence: 'Trace replay prompt/completion Trace replay debug trace; Trace replaySaveTrace replay.'
      }, {
        currentOuterCall: {
          function: 'createChatCompletion / createJsonChatCompletion',
          file: 'src/lib/openrouter.ts',
          callExpression: 'OpenRouter chat completion request',
          observedArguments: modelInput(trace)
        },
        observedVariablesAfterCall: modelOutput(trace),
        returnedVariable: 'model output string / parsed JSON'
      });
    }

    function renderCallCanvas() {
      const canvas = $('callCanvas');
      const wrap = $('canvasWrap');
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const visibleCount = Math.max(0, state.index + 1);
      const columns = Math.max(1, visibleCount);
      const left = 230;
      const colW = 190;
      const maxVisibleModelCalls = data.plannerTrace
        .slice(0, visibleCount)
        .reduce((max, step) => Math.max(max, Math.min(modelCallsForStep(step).length, 4)), 0);
      const width = Math.max(wrap.clientWidth || 760, left + columns * colW + 80);
      const height = Math.max(660, 440 + maxVisibleModelCalls * 62);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      state.canvasNodes = [];

      const total = data.plannerTrace.length;
      const complete = state.index >= total - 1 && !state.playing;
      const runStatus = state.index < 0 ? 'PENDING' : complete ? 'SUCCESS' : 'RUNNING';
      const visibleSteps = data.plannerTrace.slice(0, visibleCount);
      const updateDone = complete || visibleSteps.some((step) => step.id === 'generate_reply');
      const updateStatus = state.index < 0 ? 'PENDING' : updateDone ? 'SUCCESS' : 'RUNNING';
      const overallDuration = overallDurationInfo();
      const spanW = Math.max(260, columns * colW + 20);
      const parentNodes = [
        {
          kind: 'parent',
          x: 20,
          y: 18,
          w: spanW,
          h: 68,
          title: 'executeExecutiveAssistantRun',
          subtitle: 'Trace replay run Trace replay',
          status: runStatus,
          durationLabel: overallDuration.label,
          badges: ['Trace replay', 'Trace replayrun', 'Trace replayrunTrace replay'],
          codeTrace: { function: 'executeExecutiveAssistantRun', file: codeLocation.asyncRun, callStackRole: 'claim run, Trace replay request, Trace replay plannerTrace/result' }
        },
        {
          kind: 'parent',
          x: 52,
          y: 96,
          w: Math.max(230, spanW - 32),
          h: 68,
          title: 'runExecutiveAssistantTurn',
          subtitle: 'Trace replay',
          status: runStatus,
          durationLabel: overallDuration.label,
          badges: ['Trace replay', 'Trace replay', 'Trace replay'],
          codeTrace: { function: 'runExecutiveAssistantTurn', file: codeLocation.routeRun, callStackRole: 'Trace replay, Trace replay, Trace replaytoolTrace replay, Generate reply' }
        },
        {
          kind: 'parent',
          x: 84,
          y: 174,
          w: Math.max(200, spanW - 64),
          h: 68,
          title: 'updateTodayExecutiveBriefing',
          subtitle: 'Trace replayUpdate orchestrator',
          status: updateStatus,
          durationLabel: overallDuration.label,
          badges: ['Trace replay', 'Trace replay', 'plannerTrace'],
          codeTrace: { function: 'updateTodayExecutiveBriefing', file: codeLocation.updateBriefing, callStackRole: 'Trace replay, Trace replay, Trace replay agent, Trace replay, Trace replay' }
        }
      ];
      parentNodes.forEach((node) => {
        drawBox(ctx, node);
        state.canvasNodes.push(node);
      });

      ctx.strokeStyle = '#dbe3ef';
      ctx.lineWidth = 1;
      for (let i = 0; i < columns; i += 1) {
        const x = left + i * colW + 72;
        ctx.beginPath();
        ctx.moveTo(x, 250);
        ctx.lineTo(x, height - 28);
        ctx.stroke();
      }
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('Trace replay RUNNING; Trace replay, Trace replay.', 20, height - 12);

      const structureIds = new Set([
        'structure_briefing_json',
        'structure_informationSummary',
        'structure_todayTodo',
        'structure_twinRecommendation',
        'aggregate_structured_briefing',
      ]);
      const visibleStructureIndices = visibleSteps
        .map((step, index) => (structureIds.has(step.id) ? index : -1))
        .filter((index) => index >= 0);
      const structureParentIndex = visibleSteps.findIndex((step) => step.id === 'structure_briefing_json');
      if (structureParentIndex >= 0 && visibleStructureIndices.length > 0) {
        const minIndex = Math.min(...visibleStructureIndices);
        const maxIndex = Math.max(...visibleStructureIndices);
        const parentDuration = stepDurationDisplayInfo(visibleSteps[structureParentIndex], structureParentIndex);
        const groupNode = {
          kind: 'structureGroup',
          x: left + minIndex * colW - 14,
          y: 258,
          w: (maxIndex - minIndex + 1) * colW - 12,
          h: 128,
          title: 'structure_briefing_json Trace replay',
          subtitle: 'Trace replay, Trace replayAggregate; Trace replay.',
          status: finalEventForStep(visibleSteps[structureParentIndex], structureParentIndex).status,
          durationLabel: parentDuration.label,
          stepIndex: structureParentIndex,
          codeTrace: {
            function: 'buildStructuredBriefing',
            file: codeLocation.structured,
            callStackRole: 'Trace replay: Promise.all Trace replay, Trace replayAggregate agent.'
          }
        };
        drawStructureGroup(ctx, groupNode);
        state.canvasNodes.push(groupNode);
      }

      visibleSteps.forEach((step, index) => {
        const x = left + index * colW;
        const io = deriveStepIO(step, index);
        const fn = io.codeTrace?.currentOuterCall?.function || step.id;
        const stepDuration = stepDurationDisplayInfo(step, index);
        const stepNode = {
          kind: 'step',
          index,
          x,
          y: 274,
          w: 164,
          h: 92,
          title: (index + 1) + '. ' + fn,
          subtitle: step.title || step.id,
          status: step.status,
          durationLabel: stepDuration.label,
          badges: canvasBadgesForStep(step, index),
          active: state.canvasFocus?.kind === 'step' ? state.canvasFocus.index === index : index === state.index,
          codeTrace: io.codeTrace
        };
        drawBox(ctx, stepNode);
        state.canvasNodes.push(stepNode);

        ctx.strokeStyle = '#cbd5e1';
          ctx.beginPath();
          ctx.moveTo(x + 82, 242);
          ctx.lineTo(x + 82, 274);
          ctx.stroke();

        const modelCalls = modelCallsForStep(step);
        const modelLimit = Math.min(modelCalls.length, 4);
        for (let j = 0; j < modelLimit; j += 1) {
          const trace = modelCalls[j];
          const label = modelPurposeLabels[trace.purpose] || trace.purpose;
          const modelNode = {
            kind: 'model',
            traceIndex: data.modelTraces.indexOf(trace),
            x,
            y: 400 + j * 58,
            w: 164,
            h: 52,
            title: 'LLM: ' + label,
            subtitle: trace.model || '',
            status: trace.status,
            durationLabel: modelDurationLabel(trace),
            badges: canvasBadgesForModel(trace),
            active: state.canvasFocus?.kind === 'model' && state.canvasFocus.traceIndex === data.modelTraces.indexOf(trace),
            palette: trace.status === 'SUCCESS'
              ? { bg: '#ede9fe', border: '#8b5cf6', text: '#4c1d95' }
              : canvasStatus(trace.status)
          };
          drawBox(ctx, modelNode);
          state.canvasNodes.push(modelNode);
          ctx.strokeStyle = '#c4b5fd';
          ctx.beginPath();
          ctx.moveTo(x + 82, 366);
          ctx.lineTo(x + 82, modelNode.y);
          ctx.stroke();
        }
        if (modelCalls.length > modelLimit) {
          const moreNode = {
            kind: 'modelGroup',
            stepIndex: index,
            x,
            y: 400 + modelLimit * 58,
            w: 164,
            h: 40,
            title: '+' + (modelCalls.length - modelLimit) + ' Trace replay LLM',
            subtitle: 'Trace replay',
            status: 'RUNNING',
            durationLabel: modelDurationSumLabel(modelCalls.slice(modelLimit)),
            palette: { bg: '#f5f3ff', border: '#a78bfa', text: '#5b21b6' }
          };
          drawBox(ctx, moreNode);
          state.canvasNodes.push(moreNode);
        }
      });
      renderCanvasInputPanel();
    }

    function handleCanvasClick(event) {
      const canvas = $('callCanvas');
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const node = [...state.canvasNodes].reverse().find((item) => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h);
      if (!node) return;
      state.tab = 'code';
      if (node.kind === 'step' || node.kind === 'modelGroup') {
        const index = node.kind === 'step' ? node.index : node.stepIndex;
        state.canvasFocus = { kind: 'step', index };
        const step = data.plannerTrace[index];
        const io = deriveStepIO(step, index);
        setDetail('Trace replay ' + (index + 1) + ': ' + (step.title || step.id), step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
        renderCallCanvas();
        return;
      }
      if (node.kind === 'model') {
        state.canvasFocus = { kind: 'model', traceIndex: node.traceIndex };
        setModelDetail(data.modelTraces[node.traceIndex]);
        renderCallCanvas();
        return;
      }
      if (node.kind === 'structureGroup') {
        state.canvasFocus = { kind: 'structureGroup', node };
        const step = data.plannerTrace[node.stepIndex];
        const duration = stepDurationDisplayInfo(step, node.stepIndex);
        setDetail('Trace replay: ' + node.title, node.subtitle, {
          parentFunction: node.codeTrace,
          parentStep: step,
          childSteps: data.plannerTrace.filter((item) =>
            ['structure_informationSummary', 'structure_todayTodo', 'structure_twinRecommendation', 'aggregate_structured_briefing'].includes(item.id)
          ),
        }, {
          duration: duration.label,
          durationSemantics: duration.semantics,
          note: 'Trace replayAggregateTrace replay.Trace replayComplete, Trace replayAggregate.',
        }, node, { key: 'code', label: 'Trace replay' }, {
          eventStatus: step.status,
          finalStatusForSameStepId: finalEventForStep(step, node.stepIndex).status,
          duration: duration.label,
          durationSemantics: duration.semantics?.label,
          producedBy: 'buildStructuredBriefing Trace replay',
          usedByNext: ['Trace replayComplete', 'Trace replay aggregate_structured_briefing', 'Trace replay document.sections'],
          persistence: 'Trace replay plannerTrace Trace replay structure_briefing_json Trace replay; Trace replay step id Trace replay.'
        }, node.codeTrace);
        renderCallCanvas();
        return;
      }
      if (node.kind === 'parent') {
        state.canvasFocus = { kind: 'parent', node };
        setDetail('Trace replay: ' + node.title, node.subtitle, node.codeTrace, { status: node.status }, node.codeTrace, { key: 'code', label: 'Trace replay' }, {
          producedBy: 'Canvas Trace replay',
          usedByNext: ['Trace replay'],
          persistence: 'Trace replay plannerTrace Trace replay; Trace replay span.'
        }, node.codeTrace);
        renderCallCanvas();
      }
    }

    const modelIoForStep = (step) => {
      const related = modelCallsForStep(step);
      return {
        inputs: related.map(modelInput),
        outputs: related.map(modelOutput)
      };
    };

    function deriveStepIO(step, index) {
      const id = step.id || '';
      const toolArgs = data.selectedtoolCall.toolArgs || {};
      const explanation = usageForStep(step, index);
      if (id === 'load_context') {
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls: [],
          input: {
            provenance: 'Trace replay load_context Trace replay; Trace replay raw audit Trace replay, Trace replay.',
            rawFunctionInvocationInputPersisted: false,
            nearestObservedInputsFromAudit: {
              user: data.user,
              thread: data.thread,
              selectedtoolCallArgs: data.selectedtoolCall.toolArgs
            }
          },
          output: {
            provenance: 'Trace replay load_context Trace replay raw audit / Trace replay, Trace replay return value Trace replay.',
            rawPlannerTraceEvent: step,
            exportedContextRows: {
              executiveAgentConfig: data.executiveAgentConfig,
              wechatSources: data.wechatSources,
              latestPersistedBriefing: data.latestPersistedBriefing
            }
          },
          explanation
        };
      }
      if (id === 'plan_subagents') {
        const relatedModelCalls = modelCallsForStep(step);
        const modelIo = modelIoForStep(step);
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls,
          input: {
            selectedtoolCallArgs: toolArgs,
            rawModelInputs: modelIo.inputs
          },
          output: {
            plannerMeta: plannerMetaFromStep(step),
            rawPlannerTraceEvent: step,
            rawModelOutputs: modelIo.outputs
          },
          explanation
        };
      }
      if (id === 'call_wechat_agent') {
        const agent = data.subagents.find((item) => item.agentType === 'WECHAT');
        const relatedModelCalls = modelCallsForStep(step);
        const modelIo = modelIoForStep(step);
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls,
          input: {
            rawSubagentFunctionInputPersisted: false,
            nearestObservedInputsFromAudit: {
              mode: 'briefing',
              selectedtoolCallArgs: toolArgs,
              sources: data.wechatSources
            },
            rawModelInputs: modelIo.inputs
          },
          output: {
            rawPlannerTraceEvent: step,
            rawSubagentResultFromtoolResult: agent || null,
            rawtoolCallsForWechat: data.toolCalls.filter((tool) => String(tool.toolName || '').toLowerCase().includes('wechat')),
            rawModelOutputs: modelIo.outputs
          },
          explanation
        };
      }
      if (id === 'call_web_search') {
        const agent = data.subagents.find((item) => item.agentType === 'WEB_SEARCH');
        const relatedModelCalls = modelCallsForStep(step);
        const modelIo = modelIoForStep(step);
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls,
          input: {
            rawSubagentFunctionInputPersisted: false,
            nearestObservedInputsFromAudit: {
              mode: 'briefing',
              selectedtoolCallArgs: toolArgs,
              plannerTracePayload: step.payload || null
            },
            rawModelInputs: modelIo.inputs
          },
          output: {
            rawPlannerTraceEvent: step,
            rawSubagentResultFromtoolResult: agent || null,
            rawtoolCallsForWebSearch: data.toolCalls.filter((tool) => String(tool.toolName || '').toLowerCase().includes('web')),
            rawModelOutputs: modelIo.outputs
          },
          explanation
        };
      }
      if (id.startsWith('structure_')) {
        const relatedModelCalls = modelCallsForStep(step);
        const modelIo = modelIoForStep(step);
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls,
          input: {
            rawPlannerTraceEventBeforeModel: step,
            rawModelInputs: modelIo.inputs
          },
          output: {
            rawPlannerTraceEvent: step,
            rawModelOutputs: modelIo.outputs
          },
          explanation
        };
      }
      if (id === 'persist_briefing') {
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls: [],
          input: {
            rawDocumentPassedToPersistence: data.document
          },
          output: {
            rawPlannerTraceEvent: step,
            persistedBriefingFromAudit: data.latestPersistedBriefing
          },
          explanation
        };
      }
      if (id === 'generate_reply') {
        const relatedModelCalls = modelCallsForStep(step);
        const modelIo = modelIoForStep(step);
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls,
          input: {
            latestUserMessage: data.latestUserMessage,
            selectedtoolCallArgs: toolArgs,
            rawModelInputs: modelIo.inputs
          },
          output: {
            rawPlannerTraceEvent: step,
            latestAssistantMessage: data.latestAssistantMessage,
            rawModelOutputs: modelIo.outputs
          },
          explanation
        };
      }
      const relatedModelCalls = modelCallsForStep(step);
      const modelIo = modelIoForStep(step);
      return {
        codeTrace: codeTraceForStep(step, index),
        callType: callKind(step),
        relatedModelCalls,
        input: {
          selectedtoolCallArgs: toolArgs,
          rawModelInputs: modelIo.inputs
        },
        output: {
          rawPlannerTraceEvent: step,
          rawModelOutputs: modelIo.outputs
        },
        explanation
      };
    }

    function setDetail(title, summary, input, output, raw, callType, explanation, codeTrace) {
      state.selected = { title, summary, input, output, raw, callType, explanation, codeTrace };
      $('detailTitle').textContent = title;
      const typeText = callType ? \`Trace replay: \${callType.label}. \` : '';
      $('detailSummary').textContent = typeText + (summary || 'Trace replay.');
      renderJson();
      renderExplanation();
    }

    function renderJson() {
      if (!state.selected) {
        $('jsonBox').innerHTML = '<div class="json-tree"><div class="json-leaf">Trace replay"Trace replay"Trace replay, Trace replay.</div></div>';
        $('explainBox').innerHTML = '<strong>Trace replay (Trace replay)</strong><p>Trace replay, Trace replay JSON Trace replay.</p>';
        return;
      }
      $('tabCode').classList.toggle('active', state.tab === 'code');
      $('tabInput').classList.toggle('active', state.tab === 'input');
      $('tabOutput').classList.toggle('active', state.tab === 'output');
      $('tabRaw').classList.toggle('active', state.tab === 'raw');
      const value =
        state.tab === 'code'
          ? state.selected.codeTrace || { note: 'Trace replay.' }
          : state.tab === 'input'
            ? state.selected.input
            : state.tab === 'output'
              ? state.selected.output
              : state.selected.raw;
      $('jsonBox').innerHTML = renderJsonTree(value);
    }

    function renderExplanation() {
      const explanation = state.selected?.explanation;
      if (!explanation) {
        $('explainBox').innerHTML = '<strong>Trace replay (Trace replay)</strong><p>Trace replay; Trace replay JSON Trace replay.</p>';
        return;
      }
      const usedByNext = Array.isArray(explanation.usedByNext) ? explanation.usedByNext.join('; ') : explanation.usedByNext;
      const rows = [
        ['Trace replay', explanation.eventStatus],
        ['Trace replay', explanation.finalStatusForSameStepId],
        ['Trace replay', explanation.duration],
        ['Trace replay', explanation.durationSemantics],
        ['Trace replay', explanation.note],
        ['Trace replay', explanation.producedBy],
        ['Trace replay', usedByNext],
        ['Trace replay/Trace replay', explanation.persistence]
      ].filter(([, value]) => value !== undefined && value !== null && value !== '');
      $('explainBox').innerHTML = '<strong>Trace replay (Trace replay)</strong><dl>' + rows.map(([key, value]) => \`<div><dt>\${escapeHtml(key)}</dt><dd>\${escapeHtml(value)}</dd></div>\`).join('') + '</dl>';
    }

    function renderMeta() {
      const user = data.user || {};
      const thread = data.thread || {};
      const call = data.selectedtoolCall || {};
      $('subtitle').textContent = \`Trace replay \${user.email || 'Trace replay'}, Trace replay \${shortDate(call.createdAt)} Trace replayUpdate trace.\`;
      $('meta').innerHTML = [
        ['Trace replay', user.email || 'Trace replay'],
        ['Trace replay ID', user.id || 'Trace replay'],
        ['Trace replay', thread.id || 'Trace replay'],
        ['toolTrace replay', call.toolName || 'Trace replay'],
        ['Trace replay', call.status || 'Trace replay'],
        ['Trace replay', shortDate(call.createdAt)],
        ['Trace replay', shortDate(data.exportedAt)]
      ].map(([k, v]) => \`<div><span>\${escapeHtml(k)}</span><span>\${escapeHtml(v)}</span></div>\`).join('');
      const stats = [
        ['Trace replay', data.stats.plannerTraceCount],
        ['Trace replay Agent', data.stats.subagentCount],
        ['Trace replay', data.stats.modelCallCount],
        ['toolTrace replay', data.stats.toolCallCount],
        ['Trace replay', data.stats.sourceCount]
      ];
      $('stats').innerHTML = stats.map(([label, value]) => \`<div class="stat"><strong>\${escapeHtml(value)}</strong><span>\${escapeHtml(label)}</span></div>\`).join('');
      const navItems = [
        ['timeline', 'Trace replay'],
        ['agents', 'Trace replay Agent'],
        ['tools', 'toolTrace replay'],
        ['briefing', 'Trace replay'],
        ['raw', 'Trace replay']
      ];
      $('nav').innerHTML = navItems.map(([id, label]) => \`<button data-view="\${id}" class="\${state.view === id ? 'active' : ''}">\${label}</button>\`).join('');
      $('nav').querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          state.view = button.dataset.view;
          if (state.view === 'raw') {
            setDetail(
              'Trace replay',
              data.limitation || '',
              { selectedtoolCallArgs: data.selectedtoolCall.toolArgs },
              { stats: data.stats },
              data.rawAudit,
              { key: 'code', label: 'Trace replay' },
              {
                producedBy: 'scripts/export-executive-run-audit.ts Trace replay',
                usedByNext: ['Trace replay HTML Trace replay'],
                persistence: 'Trace replay JSON; Trace replay, Trace replay.'
              }
            );
          }
          renderMeta();
        });
      });
    }

    function renderTimeline() {
      const active = Math.max(state.index, -1);
      $('timeline').innerHTML = data.plannerTrace.map((step, index) => {
        const visible = index <= active;
        const cls = visible ? statusClass(step.status) : '';
        const kind = callKind(step);
        const finalEvent = finalEventForStep(step, index);
        const finalCls = statusClass(finalEvent.status);
        const duration = stepDurationDisplayInfo(step, index);
        return \`<article class="step \${cls}" data-index="\${index}" style="\${visible ? '' : 'opacity:.38'}">
          <h3><span>\${index + 1}. \${escapeHtml(step.title || step.id)}</span><span class="badge \${cls}">Trace replay \${escapeHtml(visible ? step.status : 'PENDING')}</span></h3>
          <p><span class="kind \${kind.key}">\${escapeHtml(kind.label)}</span> \${modelCallsForStep(step).length ? \`<span class="kind model">\${modelCallsForStep(step).length} Trace replay</span>\` : ''}</p>
          <p><span class="badge \${finalCls}">Trace replay \${escapeHtml(finalEvent.status || step.status)}</span> \${duration.label ? \`<span class="badge">Trace replay \${escapeHtml(duration.label)}</span>\` : ''} \${finalEvent !== step ? 'Trace replay' : 'Trace replay'}</p>
          <p>\${escapeHtml(visible ? (step.detail || step.error || step.description || '') : 'Trace replayPending')}</p>
        </article>\`;
      }).join('');
      $('timeline').querySelectorAll('.step').forEach((el) => {
        el.addEventListener('click', () => {
          const index = Number(el.dataset.index);
          state.canvasFocus = { kind: 'step', index };
          const step = data.plannerTrace[index];
          const io = deriveStepIO(step, index);
          setDetail(\`Trace replay \${index + 1}: \${step.title || step.id}\`, step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
          renderCallCanvas();
        });
      });
    }

    function renderAgents() {
      $('agents').innerHTML = data.subagents.map((agent) => {
        const cls = agent.briefingItems.length > 0 ? 'success' : 'skipped';
        return \`<article class="agent" data-agent="\${escapeHtml(agent.agentType)}">
          <strong>\${escapeHtml(agent.agentType)}</strong>
          <span>\${agent.briefingItems.length} Trace replay briefingItems · debug: \${Object.keys(agent.debug || {}).length} Trace replay</span>
        </article>\`;
      }).join('') || '<div class="empty">Trace replay Agent.</div>';
      $('agents').querySelectorAll('.agent').forEach((el) => {
        el.addEventListener('click', () => {
          const agent = data.subagents.find((item) => item.agentType === el.dataset.agent);
          setDetail(\`Trace replay Agent: \${agent.agentType}\`, agent.answer || '', {
            rawSubagentInvocationInputPersisted: false,
            nearestObservedInputsFromAudit: {
              userQuery: data.request?.userQuery,
              mode: 'briefing'
            }
          }, {
            answer: agent.answer,
            itemCount: agent.briefingItems.length,
            briefingItems: agent.briefingItems,
            debug: agent.debug
          }, agent, { key: 'mixed', label: 'Trace replay Agent Trace replay' }, {
            producedBy: \`\${agent.agentType} Trace replay agent Trace replay, Trace replay selectedtoolCall.toolResult.subagents\`,
            usedByNext: ['merge_results Trace replay', 'Trace replay executive_briefings.sections/sources'],
            persistence: 'Trace replay selectedtoolCall.toolResult Trace replay; async run Trace replay executive_assistant_runs.result.'
          });
        });
      });
    }

    function rendertools() {
      $('tools').innerHTML = data.toolCalls.map((tool, index) => {
        const cls = statusClass(tool.status);
        return \`<article class="tool" data-index="\${index}">
          <strong>\${tool.index}. \${escapeHtml(tool.toolName)}</strong>
          <span class="badge \${cls}">\${escapeHtml(tool.status)}</span>
        </article>\`;
      }).join('') || '<div class="empty">Trace replaytoolTrace replay.</div>';
      $('tools').querySelectorAll('.tool').forEach((el) => {
        el.addEventListener('click', () => {
          const tool = data.toolCalls[Number(el.dataset.index)];
          setDetail(\`toolTrace replay: \${tool.toolName}\`, \`Trace replay: \${tool.status}\`, tool.args, tool.result, tool, { key: 'code', label: 'tool/Trace replay' }, {
            producedBy: 'agent_tool_calls Trace replay selectedtoolCall.toolResult.toolCalls Trace replaytoolTrace replay',
            usedByNext: ['Trace replay agent Trace replay debug/briefingItems', 'Trace replay'],
            persistence: 'toolTrace replaySave; Trace replay tool.'
          });
        });
      });
    }

    function renderModels() {
      $('models').innerHTML = data.modelTraces.map((trace, index) => {
        const cls = statusClass(trace.status);
        const label = modelPurposeLabels[trace.purpose] || trace.purpose;
        return \`<article class="tool" data-index="\${index}">
          <strong>\${trace.index}. \${escapeHtml(label)}</strong>
          <span class="badge \${cls}">\${escapeHtml(trace.status)}</span>
          <span>\${escapeHtml(trace.type)} · \${escapeHtml(trace.model)} · \${escapeHtml(shortDate(trace.timestamp))}</span>
        </article>\`;
      }).join('') || '<div class="empty">Trace replay OpenRouter raw trace.</div>';
      $('models').querySelectorAll('.tool').forEach((el) => {
        el.addEventListener('click', () => {
          const trace = data.modelTraces[Number(el.dataset.index)];
          state.canvasFocus = { kind: 'model', traceIndex: Number(el.dataset.index) };
          const label = modelPurposeLabels[trace.purpose] || trace.purpose;
          setDetail(\`Trace replay: \${label}\`, \`Trace replay: \${trace.model}; Trace replay: \${trace.type}; Trace replay: \${trace.durationMs || 'Trace replay'}ms\`, {
            messages: trace.messages,
            tools: trace.tools,
            maxTokens: trace.maxTokens
          }, {
            output: trace.output,
            rawMessage: trace.rawMessage,
            rawCompletion: trace.rawCompletion,
            error: trace.error
          }, trace, { key: 'model', label: 'Trace replay' }, {
            producedBy: '.debug/openrouter-traces JSONL Trace replay OpenRouter Trace replay',
            usedByNext: ['Trace replay output/rawMessage Trace replay planner, briefingItems, sections Trace replay'],
            persistence: 'Trace replay prompt/completion Trace replay debug trace; Trace replaySaveTrace replay.'
          });
          renderCallCanvas();
        });
      });
    }

    function renderSections() {
      const sections = data.document.displaySections || [];
      $('sections').innerHTML = sections.map((section, sectionIndex) => {
        const items = section.items || [];
        return \`<section class="section">
          <header><h3>\${escapeHtml(section.title)}</h3><span class="badge">\${items.length} Trace replay</span></header>
          <div class="items">
            \${items.map((item, itemIndex) => \`<article class="item" data-section="\${sectionIndex}" data-item="\${itemIndex}">
              <h4>\${escapeHtml(item.title || 'Trace replay')}</h4>
              <p>\${escapeHtml((item.summary || '').slice(0, 180))}</p>
              <p>\${escapeHtml(item.source || '')}\${item.url ? ' · ' + escapeHtml(item.url) : ''}</p>
            </article>\`).join('') || '<div class="empty">Trace replay.</div>'}
          </div>
        </section>\`;
      }).join('');
      $('sections').querySelectorAll('.item').forEach((el) => {
        el.addEventListener('click', () => {
          const section = sections[Number(el.dataset.section)];
        const item = (section.items || [])[Number(el.dataset.item)];
          setDetail(\`Trace replay: \${item.title || section.title}\`, item.summary || '', {
            section: section.title,
            sourceCount: data.document.sources.length
          }, item, { section, item }, { key: 'code', label: 'Trace replay' }, {
            producedBy: 'Trace replay document.sections Trace replay',
            usedByNext: ['Trace replay', 'Trace replay, Trace replayTwin Recommendations'],
            persistence: 'Trace replay executive_briefings.sections; Trace replay executive_briefings.sources.'
          });
        });
      });
    }

    function renderPlayback() {
      const total = data.plannerTrace.length;
      const done = Math.max(0, Math.min(total, state.index + 1));
      const pct = total ? Math.round((done / total) * 100) : 0;
      $('progressFill').style.width = pct + '%';
      if (state.index < 0) {
        $('statusLine').textContent = 'Trace replay"Trace replay".';
        $('runStatus').textContent = 'READY';
        $('runStatus').className = 'badge';
      } else if (state.index >= total - 1 && !state.playing) {
        $('statusLine').textContent = 'Trace replayComplete: Trace replay.';
        $('runStatus').textContent = 'SUCCESS';
        $('runStatus').className = 'badge success';
      } else {
        const current = data.plannerTrace[state.index];
        $('statusLine').textContent = current?.detail || current?.title || 'Trace replay trace.';
        const cls = statusClass(current?.status || 'RUNNING');
        $('runStatus').textContent = current?.status || 'RUNNING';
        $('runStatus').className = 'badge ' + cls;
      }
      $('prevBtn').disabled = state.index < 0;
      $('nextBtn').disabled = state.index >= total - 1;
      renderTimeline();
      renderCallCanvas();
    }

    function stopPlaybackForManualStep() {
      window.clearTimeout(state.timer);
      state.playing = false;
      state.paused = false;
      $('startBtn').disabled = false;
      $('pauseBtn').disabled = true;
      $('pauseBtn').textContent = 'Trace replay';
    }

    function selectPlannerIndex(index) {
      stopPlaybackForManualStep();
      const total = data.plannerTrace.length;
      state.index = Math.max(-1, Math.min(total - 1, index));
      if (state.index < 0) {
        state.canvasFocus = null;
        setDetail('Trace replay', 'Trace replay"Trace replay"Trace replay; Trace replay.', data.request, { note: 'Trace replay, Trace replay.' }, data.rawAudit, { key: 'code', label: 'Trace replay' }, {
          producedBy: 'Trace replay selectedtoolCall.toolArgs',
          usedByNext: ['Trace replay'],
          persistence: 'Trace replay; Trace replay.'
        });
      } else {
        state.canvasFocus = { kind: 'step', index: state.index };
        const step = data.plannerTrace[state.index];
        const io = deriveStepIO(step, state.index);
        setDetail(\`Trace replay \${state.index + 1}: \${step.title || step.id}\`, step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
      }
      renderPlayback();
    }

    function previousStep() {
      selectPlannerIndex(state.index - 1);
    }

    function nextStep() {
      selectPlannerIndex(state.index + 1);
    }

    function tick() {
      if (!state.playing || state.paused) return;
      if (state.index < data.plannerTrace.length - 1) {
        state.index += 1;
        state.canvasFocus = { kind: 'step', index: state.index };
        const step = data.plannerTrace[state.index];
        const io = deriveStepIO(step, state.index);
        setDetail(\`Trace replay \${state.index + 1}: \${step.title || step.id}\`, step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
        renderPlayback();
        state.timer = window.setTimeout(tick, Number($('speedInput').value));
      } else {
        state.playing = false;
        state.paused = false;
        $('startBtn').disabled = false;
        $('pauseBtn').disabled = true;
        renderPlayback();
      }
    }

    function start() {
      window.clearTimeout(state.timer);
      state.playing = true;
      state.paused = false;
      state.index = -1;
      state.canvasFocus = null;
      $('startBtn').disabled = true;
      $('pauseBtn').disabled = false;
      $('pauseBtn').textContent = 'Trace replay';
      setDetail('Trace replay', 'Trace replay"Trace replay"Trace replay.', data.request, { runId: '(Trace replay, Trace replay run)' }, data.selectedtoolCall, { key: 'code', label: 'Trace replay' }, {
        producedBy: 'Trace replay"Trace replay"Trace replay; Trace replay',
        usedByNext: ['POST /api/investor/executive-assistant?async=1', 'Trace replay run Trace replay planner'],
        persistence: 'Trace replayRunningTrace replay AgentMessage/AgenttoolCall/ExecutiveAssistantRun; Trace replay.'
      });
      renderPlayback();
      state.timer = window.setTimeout(tick, 260);
    }

    function pause() {
      if (!state.playing) return;
      state.paused = !state.paused;
      $('pauseBtn').textContent = state.paused ? 'Trace replay' : 'Trace replay';
      if (!state.paused) {
        state.timer = window.setTimeout(tick, Number($('speedInput').value));
      }
    }

    function reset() {
      window.clearTimeout(state.timer);
      state.playing = false;
      state.paused = false;
      state.index = -1;
      state.canvasFocus = null;
      $('startBtn').disabled = false;
      $('pauseBtn').disabled = true;
      $('pauseBtn').textContent = 'Trace replay';
      setDetail('Trace replay', 'Trace replay"Trace replay"Trace replay; Trace replay.', data.request, { note: 'Trace replay, Trace replay.' }, data.rawAudit, { key: 'code', label: 'Trace replay' }, {
        producedBy: 'Trace replay selectedtoolCall.toolArgs',
        usedByNext: ['Trace replay'],
        persistence: 'Trace replay; Trace replay.'
      });
      renderPlayback();
    }

    $('startBtn').addEventListener('click', start);
    $('prevBtn').addEventListener('click', previousStep);
    $('nextBtn').addEventListener('click', nextStep);
    $('pauseBtn').addEventListener('click', pause);
    $('resetBtn').addEventListener('click', reset);
    $('callCanvas').addEventListener('click', handleCanvasClick);
    window.addEventListener('resize', renderCallCanvas);
    $('tabCode').addEventListener('click', () => { state.tab = 'code'; renderJson(); });
    $('tabInput').addEventListener('click', () => { state.tab = 'input'; renderJson(); });
    $('tabOutput').addEventListener('click', () => { state.tab = 'output'; renderJson(); });
    $('tabRaw').addEventListener('click', () => { state.tab = 'raw'; renderJson(); });

    renderMeta();
    renderAgents();
    renderModels();
    rendertools();
    renderSections();
    reset();
  </script>
</body>
</html>`;

writeFileSync(outputPath, html, 'utf8');
console.log(JSON.stringify({ inputPath, outputPath, bytes: Buffer.byteLength(html) }, null, 2));
