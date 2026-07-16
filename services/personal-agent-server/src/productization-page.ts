import type { ServerConfig } from './config.js';
import type { MemoryReviewJob } from './memory-review-queue.js';

export function renderProductizationPage(config: ServerConfig, jobs: MemoryReviewJob[]) {
  const rows = jobs
    .slice(0, 12)
    .map(
      (job) => `
        <tr>
          <td><code>${escapeHtml(job.id)}</code></td>
          <td><span class="pill ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></td>
          <td>${escapeHtml(job.userId)}</td>
          <td>${escapeHtml(job.threadId)}</td>
          <td>${escapeHtml(job.updatedAt)}</td>
          <td>${escapeHtml(job.error || '')}</td>
        </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en-US">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Altselfs Personal Agent Status</title>
  <style>
    :root { color-scheme: light; --ink:#182030; --muted:#667085; --line:#d8dee8; --band:#f7f8fb; --ok:#087443; --warn:#a15c00; --err:#b42318; --blue:#155eef; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); background:#fff; line-height:1.55; }
    header { padding:32px 44px 20px; border-bottom:1px solid var(--line); background:var(--band); }
    main { padding:28px 44px 48px; max-width:1280px; }
    h1 { margin:0 0 8px; font-size:30px; letter-spacing:0; }
    h2 { margin:0 0 14px; font-size:20px; letter-spacing:0; }
    h3 { margin:18px 0 8px; font-size:16px; letter-spacing:0; }
    p { margin:0 0 10px; }
    section { padding:22px 0; border-bottom:1px solid var(--line); }
    .muted { color:var(--muted); }
    .grid { display:grid; gap:16px; grid-template-columns:repeat(3, minmax(0, 1fr)); }
    .grid.two { grid-template-columns:repeat(2, minmax(0, 1fr)); }
    .panel { border:1px solid var(--line); border-radius:8px; padding:16px; background:#fff; min-height:120px; }
    ul { margin:8px 0 0; padding-left:20px; }
    li { margin:6px 0; }
    code { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:.92em; background:#f2f4f7; padding:1px 5px; border-radius:4px; }
    table { width:100%; border-collapse:collapse; font-size:14px; }
    th, td { border-bottom:1px solid var(--line); text-align:left; padding:10px 8px; vertical-align:top; }
    th { color:var(--muted); font-weight:600; background:var(--band); }
    .pill { display:inline-block; border-radius:999px; padding:2px 8px; font-size:12px; border:1px solid var(--line); }
    .success { color:var(--ok); border-color:#abefc6; background:#ecfdf3; }
    .queued, .running { color:var(--blue); border-color:#b2ccff; background:#eff4ff; }
    .error { color:var(--err); border-color:#fecdca; background:#fef3f2; }
    .pending { color:var(--warn); border-color:#fedf89; background:#fffaeb; }
    .warn { color:var(--warn); }
    @media (max-width: 900px) { header, main { padding-left:18px; padding-right:18px; } .grid { grid-template-columns:1fr; } table { display:block; overflow-x:auto; white-space:nowrap; } }
  </style>
</head>
<body>
  <header>
    <h1>Altselfs Personal Agent Status</h1>
    <p class="muted">Hermes owns long-term user profile and the outer personal loop. Codex General owns capability orchestration and tool execution. Runtime state is isolated by user and thread.</p>
  </header>
  <main>
    <section>
      <h2>Runtime Configuration</h2>
      <div class="grid">
        <div class="panel">
          <h3>Runtime</h3>
          <p><code>AGENT_PROCESS_ROLE</code>: ${escapeHtml(config.processRole)}</p>
          <p><code>STORAGE_BACKEND</code>: ${escapeHtml(config.storageBackend)}</p>
          <p><code>HERMES_SOURCE_RUNTIME_ENABLED</code>: ${String(config.hermesSourceRuntimeEnabled)}</p>
          <p><code>RUNTIME_STATE_MODE</code>: ${escapeHtml(config.runtimeStateMode)}</p>
          <p><code>SANDBOX_STORAGE_ROOT</code>: ${escapeHtml(config.sandboxStorageRoot)}</p>
          <p><code>HERMES_MODEL</code>: ${escapeHtml(config.hermesModel)}</p>
          <p><code>HERMES_PROVIDER</code>: ${escapeHtml(config.hermesProvider)}</p>
          <p><code>HERMES_BASE_URL</code>: ${escapeHtml(config.hermesBaseUrl)}</p>
          <p><code>CODEX_MODEL</code>: ${escapeHtml(config.codexModel || '')}</p>
        </div>
        <div class="panel">
          <h3>Memory Review</h3>
          <p><code>MEMORY_REVIEW_MODE</code>: ${escapeHtml(config.memoryReviewMode)}</p>
          <p><code>MEMORY_REVIEW_JOB_STORE_PATH</code>: ${escapeHtml(config.memoryReviewJobStorePath)}</p>
          <p><code>MEMORY_REVIEW_MAX_TURNS</code>: ${config.memoryReviewMaxTurns}</p>
        </div>
        <div class="panel">
          <h3>User Isolation</h3>
          <p>Hermes profile state is user-scoped. Codex sessions and workspaces are thread-scoped.</p>
          <p><code>HERMES_HOME_ROOT</code>: ${escapeHtml(config.hermesHomeRoot)}</p>
          <p><code>CODEX_HOME_ROOT</code>: ${escapeHtml(config.codexHomeRoot)}</p>
          <p><code>PROFILE_STORE_PATH</code>: ${escapeHtml(config.profileStorePath)}</p>
        </div>
      </div>
    </section>

    <section>
      <h2>Operating Model</h2>
      <div class="grid two">
        <div class="panel"><h3>Request Flow</h3><p>The product UI sends the current user message. The ECS runtime resolves user and thread state, loads profile context, runs Hermes, delegates complex work to Codex General, and returns the main reply without waiting for background memory review.</p></div>
        <div class="panel"><h3>Persistence</h3><p>Postgres stores control-plane state, memory review jobs, profile data, run traces, artifact metadata, and tool summaries. The sandbox filesystem stores workspace state where enabled.</p></div>
        <div class="panel"><h3>Current Defaults</h3><p><code>RUNTIME_STATE_MODE=ephemeral</code> remains the default product path. Sandbox mode is available for persistent ECS workspace testing. Snapshot mode is retained for debugging and compatibility.</p></div>
        <div class="panel"><h3>Production Notes</h3><p>API and worker processes should be split for production. Public test ports should move behind HTTPS, gateway-level authentication, and allowlisted service ingress.</p></div>
      </div>
    </section>

    <section>
      <h2>Recent Memory Review Jobs</h2>
      <table>
        <thead>
          <tr><th>Job</th><th>Status</th><th>User</th><th>Thread</th><th>Updated</th><th>Error</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">No jobs yet</td></tr>'}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
