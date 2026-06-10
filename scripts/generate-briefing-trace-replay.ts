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

function summarizeToolCall(call: unknown, index: number) {
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
  const selectedToolCall = asRecord(raw.selectedToolCall);
  const latestMessages = asArray(raw.latestMessages);
  const latestUser = latestMessages.find((value) => asRecord(value).role === 'USER');
  const latestAssistant = latestMessages.find((value) => asRecord(value).role === 'ASSISTANT');
  const startValue = asRecord(latestUser).createdAt || selectedToolCall.createdAt;
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
  if (firstSystem.includes('动态planner')) return 'planner';
  if (firstSystem.includes('微信公众号源选择器')) return 'wechat_source_selector';
  if (firstSystem.includes('联网搜索助手') && firstSystem.includes('Step1')) return 'web_search_collect';
  if (firstSystem.includes('联网搜索助手') && firstSystem.includes('Step2')) return 'web_search_summarize';
  if (firstSystem.includes('联网搜索助手') && firstSystem.includes('Step3')) return 'web_search_structure';
  if (firstSystem.includes('微信公众号文章初筛器')) return 'wechat_article_selector';
  if (firstSystem.includes('微信公众号文章分析员')) return 'wechat_article_insight';
  if (firstSystem.includes('晨报生成器')) return 'briefing_summary';
  if (firstSystem.includes('只负责“信息汇总”模块')) return 'structure_informationSummary';
  if (firstSystem.includes('只负责“今日to do”模块')) return 'structure_todayTodo';
  if (firstSystem.includes('只负责“分身推荐”模块')) return 'structure_twinRecommendation';
  if (firstSystem.includes('晨报聚合agent')) return 'aggregate_structured_briefing';
  if (messages.length === 3) return 'generate_reply';
  return 'unknown_model_call';
}

function buildReplayData(raw: Record<string, unknown>) {
  const selectedToolCall = asRecord(raw.selectedToolCall);
  const toolResult = asRecord(selectedToolCall.toolResult);
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
  const toolCalls = asArray(toolResult.toolCalls).map(summarizeToolCall);
  const plannerTrace = asArray(toolResult.plannerTrace);
  const latestMessages = asArray(raw.latestMessages);
  const latestUser = latestMessages.find((value) => asRecord(value).role === 'USER');
  const latestAssistant = latestMessages.find((value) => asRecord(value).role === 'ASSISTANT');
  const persisted = asRecord(raw.latestPersistedBriefing);
  const sections = asArray(document.sections);
  const displaySections = sections.filter((value) => asRecord(value).title !== '总览');
  const modelTraces = readModelTraces(tracePath, raw);

  return {
    rawAudit: raw,
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
    request: selectedToolCall.toolArgs || {},
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
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>总裁秘书晨报 Trace 动态复现</title>
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
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #ffffff;
    }
    #callCanvas {
      display: block;
      min-height: 420px;
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
        <h1>总裁秘书晨报 Trace 动态复现</h1>
        <p id="subtitle">使用历史日志复现，不会调用任何接口。</p>
      </div>
      <div class="controls">
        <button class="btn primary" id="startBtn">更新晨报</button>
        <button class="btn ghost" id="prevBtn">上一步</button>
        <button class="btn ghost" id="nextBtn">下一步</button>
        <button class="btn ghost" id="pauseBtn" disabled>暂停</button>
        <button class="btn ghost" id="resetBtn">重置</button>
        <label class="speed">播放速度 <input id="speedInput" type="range" min="80" max="1400" value="420" /></label>
      </div>
    </header>

    <aside>
      <section class="card meta">
        <h2>账户与运行</h2>
        <div class="kv" id="meta"></div>
      </section>
      <section class="stats" id="stats"></section>
      <nav class="nav" id="nav"></nav>
    </aside>

    <main>
      <section class="card runbar">
        <div>
          <p class="status-line" id="statusLine">等待点击“更新晨报”。</p>
          <div class="progress"><span id="progressFill"></span></div>
        </div>
        <span class="badge" id="runStatus">READY</span>
      </section>

      <section class="card canvas-panel">
        <div class="canvas-head">
          <div>
            <h2>Canvas 调用栈时序图</h2>
            <p>横向是时间，纵向是调用栈。外层函数在未完成前保持 RUNNING；大模型调用按函数节点展示。</p>
          </div>
          <div class="canvas-legend">
            <span class="legend-item"><span class="legend-dot" style="background:#dbeafe"></span>代码函数</span>
            <span class="legend-item"><span class="legend-dot" style="background:#ede9fe"></span>大模型函数</span>
            <span class="legend-item"><span class="legend-dot" style="background:#dcfce7"></span>完成</span>
            <span class="legend-item"><span class="legend-dot" style="background:#fee2e2"></span>失败</span>
          </div>
        </div>
        <div class="canvas-wrap" id="canvasWrap">
          <canvas id="callCanvas"></canvas>
        </div>
      </section>

      <div class="grid">
        <section class="card panel">
          <h2>调用链路播放</h2>
          <div class="timeline" id="timeline"></div>
        </section>
        <section class="card panel">
          <h2>子 Agent 与工具</h2>
          <div class="agents" id="agents"></div>
          <h2 style="margin-top:16px">大模型调用</h2>
          <div class="tool-list" id="models"></div>
          <h2 style="margin-top:16px">工具调用明细</h2>
          <div class="tool-list" id="tools"></div>
        </section>
      </div>

      <section class="card panel" style="margin-top:16px">
        <h2>最终晨报模块</h2>
        <div class="sections" id="sections"></div>
      </section>
    </main>

    <section class="detail">
      <h2 id="detailTitle">输入 / 输出检查器</h2>
      <p class="summary" id="detailSummary">点击左侧步骤、子 agent、工具调用或晨报条目查看当时记录的输入输出。</p>
      <div class="tabs">
        <button id="tabCode" class="active">函数调用</button>
        <button id="tabInput">输入 / 可观测上下文</button>
        <button id="tabOutput">输出 / 可观测结果</button>
        <button id="tabRaw">原始 JSON</button>
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
      canvasNodes: []
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
      if (!value) return '未知';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    };
    const modelPurposeLabels = {
      planner: '动态 planner',
      wechat_source_selector: '微信源选择',
      web_search_collect: '联网搜索 Step1',
      web_search_summarize: '联网搜索 Step2',
      web_search_structure: '联网搜索 Step3',
      wechat_article_selector: '微信文章初筛',
      wechat_article_insight: '微信逐篇摘要',
      briefing_summary: '晨报摘要',
      structure_informationSummary: '结构化信息汇总',
      structure_todayTodo: '结构化今日to do',
      structure_twinRecommendation: '结构化分身推荐',
      aggregate_structured_briefing: '聚合结构化晨报',
      generate_reply: '秘书最终回复',
      unknown_model_call: '未知模型调用'
    };
    const callKind = (step) => {
      const id = step?.id || '';
      if (id === 'plan_subagents' || id === 'generate_briefing_summary' || id.startsWith('structure_') || id === 'aggregate_structured_briefing' || id === 'generate_reply') {
        return { key: 'model', label: '大模型' };
      }
      if (id === 'call_wechat_agent' || id === 'call_web_search') return { key: 'mixed', label: '混合编排' };
      if (id === 'persist_briefing') return { key: 'db', label: '数据库写入' };
      if (id === 'load_context' || id === 'merge_results') return { key: 'code', label: '代码函数' };
      if (id.includes('gmail') || id.includes('feishu') || id.includes('xiaohongshu')) return { key: 'code', label: '代码跳过' };
      return { key: 'code', label: '代码函数' };
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
    const usageForStep = (step, index) => {
      const id = step?.id || '';
      const finalEvent = finalEventForStep(step, index);
      const base = {
        eventStatus: step.status,
        finalStatusForSameStepId: finalEvent.status,
        isAppendOnlyTraceEvent: finalEvent !== step,
        note: finalEvent !== step
          ? 'plannerTrace 是追加式事件日志；这条记录保留当时状态，后面同 id 记录才代表该步骤最终状态。'
          : '这是该 step id 在 trace 中的最后一条事件。'
      };
      if (id === 'load_context') {
        return {
          ...base,
          producedBy: '代码函数 loadExecutiveContext / loadBriefing 查询数据库并组装内存对象',
          usedByNext: ['动态 planner 的 accountContext', 'buildBriefingSummary 的 internalFacts/baseBriefing', 'mergeResults 的基础晨报'],
          persistence: '不单独落库；只作为本轮内存上下文存在。关键摘要会间接进入 executive_assistant_runs.plannerTrace/result 和最终 executive_briefings。'
        };
      }
      if (id === 'plan_subagents') {
        return {
          ...base,
          producedBy: '大模型 EXECUTIVE_PLANNER，失败时使用 fallbackExecutivePlan',
          usedByNext: ['决定调用哪些 skill/subagent', '生成每个 step', '构造 wechatTaskSpec/webSearchIntent'],
          persistence: 'planner 和 plannerTrace 会持续写入 executive_assistant_runs；最终 toolResult 也会保留 plannerTrace。'
        };
      }
      if (id === 'call_wechat_agent') {
        return {
          ...base,
          producedBy: '混合编排：代码查询公众号源和微信 provider，多个模型负责筛源/筛文章/逐篇摘要',
          usedByNext: ['subagentResults[].briefingItems 进入 merge_results', 'toolCalls 进入审计', 'debug 用于排查采集数量'],
          persistence: '子 agent 结果最终写入 executive_assistant_runs.result.subagents/toolCalls；其 briefingItems 进入 executive_briefings.sources/sections。'
        };
      }
      if (id === 'call_web_search') {
        return {
          ...base,
          producedBy: '混合编排：OpenRouter web_search/web_fetch 工具 + Step2/Step3 模型结构化',
          usedByNext: ['WEB_SEARCH briefingItems 进入 merge_results', 'citations/findings/searchLog 进入 toolCalls/debug'],
          persistence: '搜索结果摘要写入 executive_assistant_runs.result.subagents/toolCalls；最终被选中的条目进入 executive_briefings。完整 raw 模型输入输出来自 .debug/openrouter-traces。'
        };
      }
      if (id === 'merge_results') {
        return {
          ...base,
          producedBy: '代码函数 mergeBriefingWithItems',
          usedByNext: ['buildBriefingSummary 的 briefing 输入', 'buildDocument 的总览内容'],
          persistence: '不单独落库；合并后的结果随 run result 和最终 briefing document 保存。'
        };
      }
      if (id === 'generate_briefing_summary') {
        return {
          ...base,
          producedBy: '大模型 EXECUTIVE 生成摘要',
          usedByNext: ['三个结构化子 agent 的 generatedSummary 输入', '最终回复参考'],
          persistence: '摘要本身不作为单独字段落库；聚合后 summary 会进入 executive_briefings.summary。完整 prompt/output 在 modelCalls 中。'
        };
      }
      if (id.startsWith('structure_')) {
        return {
          ...base,
          producedBy: '大模型 EXECUTIVE_STRUCTURER，单模块结构化；失败时 fallbackStructuredModule 降级',
          usedByNext: ['aggregate_structured_briefing 校验', 'buildDocument 组装 sections'],
          persistence: '模块 items 最终进入 executive_briefings.sections；完整 prompt/output 在 modelCalls 中。'
        };
      }
      if (id === 'aggregate_structured_briefing') {
        return {
          ...base,
          producedBy: '大模型 EXECUTIVE_STRUCTURER 聚合 agent',
          usedByNext: ['buildDocument.title', 'buildDocument.summary', 'persist_briefing'],
          persistence: 'title/summary 写入 executive_briefings；完整 prompt/output 在 modelCalls 中。'
        };
      }
      if (id === 'persist_briefing') {
        return {
          ...base,
          producedBy: '代码函数 prisma.executiveBriefing.upsert',
          usedByNext: ['前端 GET/轮询完成后展示 persistedBriefing', '下次打开页面作为已持久化晨报'],
          persistence: '落库到 executive_briefings，唯一键是 investorId + dateKey。'
        };
      }
      if (id === 'generate_reply') {
        return {
          ...base,
          producedBy: '大模型 EXECUTIVE 生成最终秘书回复',
          usedByNext: ['写入 AgentMessage', '前端聊天/复现页面展示'],
          persistence: 'assistant message 写入 agent_messages；executionSnapshot 压缩后写入 message.meta。完整 prompt/output 在 modelCalls 中。'
        };
      }
      return {
        ...base,
        producedBy: '代码路径或动态 planner 生成的步骤',
        usedByNext: ['视具体 step id 而定'],
        persistence: '至少会作为 plannerTrace 事件写入 executive_assistant_runs。'
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
            role: '异步 run 包装层：claim run、读取 request、持久化 plannerTrace/result'
          },
          {
            function: 'runExecutiveAssistantTurn',
            file: codeLocation.routeRun,
            role: '秘书一轮对话主流程：写用户消息、调用晨报更新、写工具审计、生成回复'
          },
          {
            function: 'updateTodayExecutiveBriefing',
            file: codeLocation.updateBriefing,
            role: '晨报更新主 orchestrator；多数 planner step 都在这个函数内部发生'
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
            planPayloadPersistedInPlannerTrace: step.payload || null,
            relatedRawModelCalls: modelIoForStep(step).outputs
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
            callExpression: 'subagentTasks.push(runWebSearchAgent({ investorId, userQuery, mode: "briefing", context: { webSearchIntent, subagentResults: [], taskSpec } }).then(...))',
            observedArguments: {
              investorId: data.user?.id,
              userQuery: data.request?.userQuery,
              mode: 'briefing',
              webSearchIntent: step.payload?.webSearchIntent || step.payload || null
            }
          },
          directChildCalls: [
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
              suffix: '本次晨报已合并 ' + data.subagents.flatMap((item) => item.briefingItems).length + ' 条子Agent信息。'
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
              role: '异步 run 包装层'
            },
            {
              function: 'runExecutiveAssistantTurn',
              file: codeLocation.routeRun,
              role: '秘书一轮对话主流程；generate_reply 在 updateTodayExecutiveBriefing 返回之后执行'
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
      ctx.restore();
    }

    function setModelDetail(trace) {
      const label = modelPurposeLabels[trace.purpose] || trace.purpose;
      setDetail('大模型调用: ' + label, '模型：' + trace.model + '；类型：' + trace.type + '；耗时：' + (trace.durationMs || '未知') + 'ms', {
        messages: trace.messages,
        tools: trace.tools,
        maxTokens: trace.maxTokens
      }, {
        output: trace.output,
        rawMessage: trace.rawMessage,
        rawCompletion: trace.rawCompletion,
        error: trace.error
      }, trace, { key: 'model', label: '大模型函数' }, {
        producedBy: '.debug/openrouter-traces JSONL 捕获的 OpenRouter 调用',
        usedByNext: ['调用方代码解析 output/rawMessage 后生成 planner、briefingItems、sections 或最终回复'],
        persistence: '这类完整 prompt/completion 当前来自本地 debug trace；数据库审计通常只保存被解析后的业务结果。'
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
      const width = Math.max(wrap.clientWidth || 760, left + columns * colW + 80);
      const height = 470;
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
      const spanW = Math.max(260, columns * colW + 20);
      const parentNodes = [
        {
          kind: 'parent',
          x: 20,
          y: 18,
          w: spanW,
          h: 46,
          title: 'executeExecutiveAssistantRun',
          subtitle: '异步 run 包装层',
          status: runStatus,
          codeTrace: { function: 'executeExecutiveAssistantRun', file: codeLocation.asyncRun, callStackRole: 'claim run、读取 request、持久化 plannerTrace/result' }
        },
        {
          kind: 'parent',
          x: 52,
          y: 82,
          w: Math.max(230, spanW - 32),
          h: 46,
          title: 'runExecutiveAssistantTurn',
          subtitle: '秘书一轮对话主流程',
          status: runStatus,
          codeTrace: { function: 'runExecutiveAssistantTurn', file: codeLocation.routeRun, callStackRole: '写用户消息、调用晨报更新、写工具审计、生成回复' }
        },
        {
          kind: 'parent',
          x: 84,
          y: 146,
          w: Math.max(200, spanW - 64),
          h: 46,
          title: 'updateTodayExecutiveBriefing',
          subtitle: '晨报更新 orchestrator',
          status: updateStatus,
          codeTrace: { function: 'updateTodayExecutiveBriefing', file: codeLocation.updateBriefing, callStackRole: '读取上下文、规划、调用子 agent、合并、落库' }
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
        ctx.moveTo(x, 202);
        ctx.lineTo(x, height - 28);
        ctx.stroke();
      }
      ctx.fillStyle = '#64748b';
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText('外层函数未结束时保持 RUNNING；下面每列是一个 plannerTrace 事件。', 20, height - 12);

      visibleSteps.forEach((step, index) => {
        const x = left + index * colW;
        const io = deriveStepIO(step, index);
        const fn = io.codeTrace?.currentOuterCall?.function || step.id;
        const stepNode = {
          kind: 'step',
          index,
          x,
          y: 218,
          w: 164,
          h: 72,
          title: (index + 1) + '. ' + fn,
          subtitle: step.title || step.id,
          status: step.status,
          active: index === state.index,
          codeTrace: io.codeTrace
        };
        drawBox(ctx, stepNode);
        state.canvasNodes.push(stepNode);

        ctx.strokeStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.moveTo(x + 82, 192);
        ctx.lineTo(x + 82, 218);
        ctx.stroke();

        const modelCalls = modelCallsForStep(step);
        const modelLimit = Math.min(modelCalls.length, 3);
        for (let j = 0; j < modelLimit; j += 1) {
          const trace = modelCalls[j];
          const label = modelPurposeLabels[trace.purpose] || trace.purpose;
          const modelNode = {
            kind: 'model',
            traceIndex: data.modelTraces.indexOf(trace),
            x,
            y: 315 + j * 48,
            w: 164,
            h: 38,
            title: 'LLM: ' + label,
            subtitle: trace.model || '',
            status: trace.status,
            palette: trace.status === 'SUCCESS'
              ? { bg: '#ede9fe', border: '#8b5cf6', text: '#4c1d95' }
              : canvasStatus(trace.status)
          };
          drawBox(ctx, modelNode);
          state.canvasNodes.push(modelNode);
          ctx.strokeStyle = '#c4b5fd';
          ctx.beginPath();
          ctx.moveTo(x + 82, 290);
          ctx.lineTo(x + 82, modelNode.y);
          ctx.stroke();
        }
        if (modelCalls.length > modelLimit) {
          const moreNode = {
            kind: 'modelGroup',
            stepIndex: index,
            x,
            y: 315 + modelLimit * 48,
            w: 164,
            h: 34,
            title: '+' + (modelCalls.length - modelLimit) + ' 次 LLM',
            subtitle: '点击看本步骤详情',
            status: 'RUNNING',
            palette: { bg: '#f5f3ff', border: '#a78bfa', text: '#5b21b6' }
          };
          drawBox(ctx, moreNode);
          state.canvasNodes.push(moreNode);
        }
      });
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
        const step = data.plannerTrace[index];
        const io = deriveStepIO(step, index);
        setDetail('步骤 ' + (index + 1) + ': ' + (step.title || step.id), step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
        renderCallCanvas();
        return;
      }
      if (node.kind === 'model') {
        setModelDetail(data.modelTraces[node.traceIndex]);
        renderCallCanvas();
        return;
      }
      if (node.kind === 'parent') {
        setDetail('函数: ' + node.title, node.subtitle, node.codeTrace, { status: node.status }, node.codeTrace, { key: 'code', label: '代码函数' }, {
          producedBy: 'Canvas 调用栈中的外层函数节点',
          usedByNext: ['包裹并调度下层函数调用'],
          persistence: '这个父级函数状态由 plannerTrace 播放进度推断；不是单独落库的 span。'
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
      const toolArgs = data.selectedToolCall.toolArgs || {};
      const explanation = usageForStep(step, index);
      if (id === 'load_context') {
        return {
          codeTrace: codeTraceForStep(step, index),
          callType: callKind(step),
          relatedModelCalls: [],
          input: {
            provenance: '代码函数 load_context 的精确函数调用参数未被单独持久化；以下是本次 raw audit 中可观测到、会影响该函数执行的上下文。',
            rawFunctionInvocationInputPersisted: false,
            nearestObservedInputsFromAudit: {
              user: data.user,
              thread: data.thread,
              selectedToolCallArgs: data.selectedToolCall.toolArgs
            }
          },
          output: {
            provenance: '这是 load_context 之后在 raw audit / 导出数据中可观测到的上下文结果，不等同于函数 return value 的逐字节快照。',
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
            selectedToolCallArgs: toolArgs,
            rawModelInputs: modelIo.inputs
          },
          output: {
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
              selectedToolCallArgs: toolArgs,
              sources: data.wechatSources
            },
            rawModelInputs: modelIo.inputs
          },
          output: {
            rawPlannerTraceEvent: step,
            rawSubagentResultFromToolResult: agent || null,
            rawToolCallsForWechat: data.toolCalls.filter((tool) => String(tool.toolName || '').toLowerCase().includes('wechat')),
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
              selectedToolCallArgs: toolArgs,
              plannerTracePayload: step.payload || null
            },
            rawModelInputs: modelIo.inputs
          },
          output: {
            rawPlannerTraceEvent: step,
            rawSubagentResultFromToolResult: agent || null,
            rawToolCallsForWebSearch: data.toolCalls.filter((tool) => String(tool.toolName || '').toLowerCase().includes('web')),
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
            selectedToolCallArgs: toolArgs,
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
          selectedToolCallArgs: toolArgs,
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
      const typeText = callType ? \`调用类型：\${callType.label}。 \` : '';
      $('detailSummary').textContent = typeText + (summary || '查看本节点的持久化输入输出。');
      renderJson();
      renderExplanation();
    }

    function renderJson() {
      if (!state.selected) {
        $('jsonBox').innerHTML = '<div class="json-tree"><div class="json-leaf">点击“更新晨报”开始播放，或点选任意节点查看详情。</div></div>';
        $('explainBox').innerHTML = '<strong>机制解读（非原始日志）</strong><p>这里会显示我对当前节点用途和下游影响的解释，和上面的原始 JSON 分开。</p>';
        return;
      }
      $('tabCode').classList.toggle('active', state.tab === 'code');
      $('tabInput').classList.toggle('active', state.tab === 'input');
      $('tabOutput').classList.toggle('active', state.tab === 'output');
      $('tabRaw').classList.toggle('active', state.tab === 'raw');
      const value =
        state.tab === 'code'
          ? state.selected.codeTrace || { note: '当前节点没有对应的代码函数映射。' }
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
        $('explainBox').innerHTML = '<strong>机制解读（非原始日志）</strong><p>当前节点没有额外注释；上方 JSON 是日志里能看到的原始或最近似原始记录。</p>';
        return;
      }
      const usedByNext = Array.isArray(explanation.usedByNext) ? explanation.usedByNext.join('；') : explanation.usedByNext;
      const rows = [
        ['事件状态', explanation.eventStatus],
        ['最终状态', explanation.finalStatusForSameStepId],
        ['日志形态', explanation.note],
        ['由谁产生', explanation.producedBy],
        ['后续怎么用', usedByNext],
        ['暂存/落库位置', explanation.persistence]
      ].filter(([, value]) => value !== undefined && value !== null && value !== '');
      $('explainBox').innerHTML = '<strong>机制解读（非原始日志）</strong><dl>' + rows.map(([key, value]) => \`<div><dt>\${escapeHtml(key)}</dt><dd>\${escapeHtml(value)}</dd></div>\`).join('') + '</dl>';
    }

    function renderMeta() {
      const user = data.user || {};
      const thread = data.thread || {};
      const call = data.selectedToolCall || {};
      $('subtitle').textContent = \`账户 \${user.email || '未知'}，复现 \${shortDate(call.createdAt)} 的最近一次晨报更新 trace。\`;
      $('meta').innerHTML = [
        ['账户', user.email || '未知'],
        ['用户 ID', user.id || '未知'],
        ['线程', thread.id || '未知'],
        ['工具调用', call.toolName || '未知'],
        ['运行状态', call.status || '未知'],
        ['执行时间', shortDate(call.createdAt)],
        ['导出时间', shortDate(data.exportedAt)]
      ].map(([k, v]) => \`<div><span>\${escapeHtml(k)}</span><span>\${escapeHtml(v)}</span></div>\`).join('');
      const stats = [
        ['步骤', data.stats.plannerTraceCount],
        ['子 Agent', data.stats.subagentCount],
        ['大模型调用', data.stats.modelCallCount],
        ['工具调用', data.stats.toolCallCount],
        ['信息源条目', data.stats.sourceCount]
      ];
      $('stats').innerHTML = stats.map(([label, value]) => \`<div class="stat"><strong>\${escapeHtml(value)}</strong><span>\${escapeHtml(label)}</span></div>\`).join('');
      const navItems = [
        ['timeline', '调用链路'],
        ['agents', '子 Agent'],
        ['tools', '工具调用'],
        ['briefing', '最终晨报'],
        ['raw', '完整审计摘要']
      ];
      $('nav').innerHTML = navItems.map(([id, label]) => \`<button data-view="\${id}" class="\${state.view === id ? 'active' : ''}">\${label}</button>\`).join('');
      $('nav').querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          state.view = button.dataset.view;
          if (state.view === 'raw') {
            setDetail(
              '完整审计摘要',
              data.limitation || '',
              { selectedToolCallArgs: data.selectedToolCall.toolArgs },
              { stats: data.stats },
              data.rawAudit,
              { key: 'code', label: '原始导出' },
              {
                producedBy: 'scripts/export-executive-run-audit.ts 从本地数据库导出的原始审计对象',
                usedByNext: ['本静态 HTML 页面用于复现展示'],
                persistence: '页面内嵌 JSON；不会回写数据库，也不会调用接口。'
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
        return \`<article class="step \${cls}" data-index="\${index}" style="\${visible ? '' : 'opacity:.38'}">
          <h3><span>\${index + 1}. \${escapeHtml(step.title || step.id)}</span><span class="badge \${cls}">事件 \${escapeHtml(visible ? step.status : 'PENDING')}</span></h3>
          <p><span class="kind \${kind.key}">\${escapeHtml(kind.label)}</span> \${modelCallsForStep(step).length ? \`<span class="kind model">\${modelCallsForStep(step).length} 次模型调用</span>\` : ''}</p>
          <p><span class="badge \${finalCls}">最终 \${escapeHtml(finalEvent.status || step.status)}</span> \${finalEvent !== step ? '后续同一步骤已更新状态' : '该步骤最终事件'}</p>
          <p>\${escapeHtml(visible ? (step.detail || step.error || step.description || '') : '等待执行')}</p>
        </article>\`;
      }).join('');
      $('timeline').querySelectorAll('.step').forEach((el) => {
        el.addEventListener('click', () => {
          const index = Number(el.dataset.index);
          const step = data.plannerTrace[index];
          const io = deriveStepIO(step, index);
          setDetail(\`步骤 \${index + 1}: \${step.title || step.id}\`, step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
        });
      });
    }

    function renderAgents() {
      $('agents').innerHTML = data.subagents.map((agent) => {
        const cls = agent.briefingItems.length > 0 ? 'success' : 'skipped';
        return \`<article class="agent" data-agent="\${escapeHtml(agent.agentType)}">
          <strong>\${escapeHtml(agent.agentType)}</strong>
          <span>\${agent.briefingItems.length} 条 briefingItems · debug: \${Object.keys(agent.debug || {}).length} 个字段</span>
        </article>\`;
      }).join('') || '<div class="empty">没有实际执行的子 Agent。</div>';
      $('agents').querySelectorAll('.agent').forEach((el) => {
        el.addEventListener('click', () => {
          const agent = data.subagents.find((item) => item.agentType === el.dataset.agent);
          setDetail(\`子 Agent: \${agent.agentType}\`, agent.answer || '', {
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
          }, agent, { key: 'mixed', label: '子 Agent 结果' }, {
            producedBy: \`\${agent.agentType} 子 agent 的执行结果，来自 selectedToolCall.toolResult.subagents\`,
            usedByNext: ['merge_results 合并晨报候选信息', '最终 executive_briefings.sections/sources'],
            persistence: '已作为 selectedToolCall.toolResult 的一部分落库；async run 中也会进入 executive_assistant_runs.result。'
          });
        });
      });
    }

    function renderTools() {
      $('tools').innerHTML = data.toolCalls.map((tool, index) => {
        const cls = statusClass(tool.status);
        return \`<article class="tool" data-index="\${index}">
          <strong>\${tool.index}. \${escapeHtml(tool.toolName)}</strong>
          <span class="badge \${cls}">\${escapeHtml(tool.status)}</span>
        </article>\`;
      }).join('') || '<div class="empty">没有工具调用。</div>';
      $('tools').querySelectorAll('.tool').forEach((el) => {
        el.addEventListener('click', () => {
          const tool = data.toolCalls[Number(el.dataset.index)];
          setDetail(\`工具调用: \${tool.toolName}\`, \`状态：\${tool.status}\`, tool.args, tool.result, tool, { key: 'code', label: '工具/代码调用' }, {
            producedBy: 'agent_tool_calls 或 selectedToolCall.toolResult.toolCalls 中记录的工具调用审计',
            usedByNext: ['对应 agent 的 debug/briefingItems', '最终晨报候选来源'],
            persistence: '工具调用参数和结果已随审计日志保存；是否另有业务表取决于具体 tool。'
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
      }).join('') || '<div class="empty">没有找到 OpenRouter raw trace。</div>';
      $('models').querySelectorAll('.tool').forEach((el) => {
        el.addEventListener('click', () => {
          const trace = data.modelTraces[Number(el.dataset.index)];
          const label = modelPurposeLabels[trace.purpose] || trace.purpose;
          setDetail(\`大模型调用: \${label}\`, \`模型：\${trace.model}；类型：\${trace.type}；耗时：\${trace.durationMs || '未知'}ms\`, {
            messages: trace.messages,
            tools: trace.tools,
            maxTokens: trace.maxTokens
          }, {
            output: trace.output,
            rawMessage: trace.rawMessage,
            rawCompletion: trace.rawCompletion,
            error: trace.error
          }, trace, { key: 'model', label: '大模型' }, {
            producedBy: '.debug/openrouter-traces JSONL 捕获的 OpenRouter 调用',
            usedByNext: ['调用方代码解析 output/rawMessage 后生成 planner、briefingItems、sections 或最终回复'],
            persistence: '这类完整 prompt/completion 当前来自本地 debug trace；数据库审计通常只保存被解析后的业务结果。'
          });
        });
      });
    }

    function renderSections() {
      const sections = data.document.displaySections || [];
      $('sections').innerHTML = sections.map((section, sectionIndex) => {
        const items = section.items || [];
        return \`<section class="section">
          <header><h3>\${escapeHtml(section.title)}</h3><span class="badge">\${items.length} 条</span></header>
          <div class="items">
            \${items.map((item, itemIndex) => \`<article class="item" data-section="\${sectionIndex}" data-item="\${itemIndex}">
              <h4>\${escapeHtml(item.title || '未命名')}</h4>
              <p>\${escapeHtml((item.summary || '').slice(0, 180))}</p>
              <p>\${escapeHtml(item.source || '')}\${item.url ? ' · ' + escapeHtml(item.url) : ''}</p>
            </article>\`).join('') || '<div class="empty">没有条目。</div>'}
          </div>
        </section>\`;
      }).join('');
      $('sections').querySelectorAll('.item').forEach((el) => {
        el.addEventListener('click', () => {
          const section = sections[Number(el.dataset.section)];
        const item = (section.items || [])[Number(el.dataset.item)];
          setDetail(\`晨报条目: \${item.title || section.title}\`, item.summary || '', {
            section: section.title,
            sourceCount: data.document.sources.length
          }, item, { section, item }, { key: 'code', label: '展示数据' }, {
            producedBy: '结构化晨报 document.sections 中的条目',
            usedByNext: ['前端晨报页面展示', '后续用户阅读、追问或决策分身推荐'],
            persistence: '最终落在 executive_briefings.sections；来源引用落在 executive_briefings.sources。'
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
        $('statusLine').textContent = '等待点击“更新晨报”。';
        $('runStatus').textContent = 'READY';
        $('runStatus').className = 'badge';
      } else if (state.index >= total - 1 && !state.playing) {
        $('statusLine').textContent = '复现完成：已展示这次历史晨报更新的完整持久化调用链路。';
        $('runStatus').textContent = 'SUCCESS';
        $('runStatus').className = 'badge success';
      } else {
        const current = data.plannerTrace[state.index];
        $('statusLine').textContent = current?.detail || current?.title || '正在播放历史 trace。';
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
      $('pauseBtn').textContent = '暂停';
    }

    function selectPlannerIndex(index) {
      stopPlaybackForManualStep();
      const total = data.plannerTrace.length;
      state.index = Math.max(-1, Math.min(total - 1, index));
      if (state.index < 0) {
        setDetail('请求输入', '点击“更新晨报”会提交这个用户请求；本页面只使用历史日志复现。', data.request, { note: '未调用接口，未创建新任务。' }, data.rawAudit, { key: 'code', label: '前端请求' }, {
          producedBy: '历史 selectedToolCall.toolArgs',
          usedByNext: ['播放复现入口'],
          persistence: '页面内嵌历史日志；不会调用接口。'
        });
      } else {
        const step = data.plannerTrace[state.index];
        const io = deriveStepIO(step, state.index);
        setDetail(\`步骤 \${state.index + 1}: \${step.title || step.id}\`, step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
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
        const step = data.plannerTrace[state.index];
        const io = deriveStepIO(step, state.index);
        setDetail(\`步骤 \${state.index + 1}: \${step.title || step.id}\`, step.detail || step.error || step.description, io.input, io.output, { step, relatedModelCalls: io.relatedModelCalls }, io.callType, io.explanation, io.codeTrace);
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
      $('startBtn').disabled = true;
      $('pauseBtn').disabled = false;
      $('pauseBtn').textContent = '暂停';
      setDetail('请求输入', '点击“更新晨报”后前端提交给后台的固定提示词。', data.request, { runId: '(历史日志复现，无实际新建 run)' }, data.selectedToolCall, { key: 'code', label: '前端请求' }, {
        producedBy: '前端“更新晨报”按钮提交的用户请求；本页面使用历史日志复现',
        usedByNext: ['POST /api/investor/executive-assistant?async=1', '后台创建 run 并执行 planner'],
        persistence: '真实运行中会进入 AgentMessage/AgentToolCall/ExecutiveAssistantRun；本页面不会创建新记录。'
      });
      renderPlayback();
      state.timer = window.setTimeout(tick, 260);
    }

    function pause() {
      if (!state.playing) return;
      state.paused = !state.paused;
      $('pauseBtn').textContent = state.paused ? '继续' : '暂停';
      if (!state.paused) {
        state.timer = window.setTimeout(tick, Number($('speedInput').value));
      }
    }

    function reset() {
      window.clearTimeout(state.timer);
      state.playing = false;
      state.paused = false;
      state.index = -1;
      $('startBtn').disabled = false;
      $('pauseBtn').disabled = true;
      $('pauseBtn').textContent = '暂停';
      setDetail('请求输入', '点击“更新晨报”会提交这个用户请求；本页面只使用历史日志复现。', data.request, { note: '未调用接口，未创建新任务。' }, data.rawAudit, { key: 'code', label: '前端请求' }, {
        producedBy: '历史 selectedToolCall.toolArgs',
        usedByNext: ['播放复现入口'],
        persistence: '页面内嵌历史日志；不会调用接口。'
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
    renderTools();
    renderSections();
    reset();
  </script>
</body>
</html>`;

writeFileSync(outputPath, html, 'utf8');
console.log(JSON.stringify({ inputPath, outputPath, bytes: Buffer.byteLength(html) }, null, 2));
