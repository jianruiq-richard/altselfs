export function renderProductizationPage(config, jobs) {
    const rows = jobs
        .slice(0, 12)
        .map((job) => `
        <tr>
          <td><code>${escapeHtml(job.id)}</code></td>
          <td><span class="pill ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span></td>
          <td>${escapeHtml(job.userId)}</td>
          <td>${escapeHtml(job.threadId)}</td>
          <td>${escapeHtml(job.updatedAt)}</td>
          <td>${escapeHtml(job.error || '')}</td>
        </tr>`)
        .join('');
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Altselfs Personal Agent 产品化状态</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #182030;
      --muted: #667085;
      --line: #d8dee8;
      --band: #f7f8fb;
      --ok: #087443;
      --warn: #a15c00;
      --err: #b42318;
      --blue: #155eef;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: #ffffff;
      line-height: 1.55;
    }
    header {
      padding: 32px 44px 20px;
      border-bottom: 1px solid var(--line);
      background: var(--band);
    }
    h1 { margin: 0 0 8px; font-size: 30px; letter-spacing: 0; }
    h2 { margin: 0 0 14px; font-size: 20px; letter-spacing: 0; }
    h3 { margin: 20px 0 8px; font-size: 16px; letter-spacing: 0; }
    p { margin: 0 0 10px; }
    main { padding: 28px 44px 48px; max-width: 1280px; }
    section { padding: 22px 0; border-bottom: 1px solid var(--line); }
    .muted { color: var(--muted); }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      background: #fff;
      min-height: 120px;
    }
    .flow {
      display: grid;
      grid-template-columns: repeat(5, minmax(120px, 1fr));
      gap: 10px;
      align-items: stretch;
    }
    .step {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
      min-height: 98px;
    }
    .step strong { display: block; margin-bottom: 6px; }
    .arrow { text-align: center; color: var(--muted); align-self: center; }
    ul { margin: 8px 0 0; padding-left: 20px; }
    li { margin: 6px 0; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.92em;
      background: #f2f4f7;
      padding: 1px 5px;
      border-radius: 4px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border-bottom: 1px solid var(--line); text-align: left; padding: 10px 8px; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; background: var(--band); }
    .pill {
      display: inline-block;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      border: 1px solid var(--line);
    }
    .success { color: var(--ok); border-color: #abefc6; background: #ecfdf3; }
    .queued, .running { color: var(--blue); border-color: #b2ccff; background: #eff4ff; }
    .error { color: var(--err); border-color: #fecdca; background: #fef3f2; }
    .pending { color: var(--warn); border-color: #fedf89; background: #fffaeb; }
    .warn { color: var(--warn); }
    @media (max-width: 900px) {
      header, main { padding-left: 18px; padding-right: 18px; }
      .grid, .flow { grid-template-columns: 1fr; }
      .arrow { display: none; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Altselfs Personal Agent 产品化状态</h1>
    <p class="muted">目标：Hermes 负责长期用户画像和主 Agent 外层，Codex General 负责能力统筹和工具执行；多用户隔离，后续迁移到容器服务和数据库。</p>
  </header>
  <main>
    <section>
      <h2>当前运行配置</h2>
      <div class="grid">
        <div class="panel">
          <h3>Runtime</h3>
          <p><code>AGENT_PROCESS_ROLE</code>: ${escapeHtml(config.processRole)}</p>
          <p><code>STORAGE_BACKEND</code>: ${escapeHtml(config.storageBackend)}</p>
          <p><code>HERMES_SOURCE_RUNTIME_ENABLED</code>: ${String(config.hermesSourceRuntimeEnabled)}</p>
          <p><code>RUNTIME_STATE_MODE</code>: ${escapeHtml(config.runtimeStateMode)}</p>
          <p><code>HERMES_MODEL</code>: ${escapeHtml(config.hermesModel)}</p>
          <p><code>CODEX_MODEL</code>: ${escapeHtml(config.codexModel || config.hermesModel)}</p>
        </div>
        <div class="panel">
          <h3>Memory Review</h3>
          <p><code>MEMORY_REVIEW_MODE</code>: ${escapeHtml(config.memoryReviewMode)}</p>
          <p><code>MEMORY_REVIEW_JOB_STORE_PATH</code>: ${escapeHtml(config.memoryReviewJobStorePath)}</p>
          <p><code>MEMORY_REVIEW_MAX_TURNS</code>: ${config.memoryReviewMaxTurns}</p>
        </div>
        <div class="panel">
          <h3>User Isolation</h3>
          <p><code>HERMES_HOME_ROOT</code>: ${escapeHtml(config.hermesHomeRoot)}</p>
          <p><code>CODEX_HOME_ROOT</code>: ${escapeHtml(config.codexHomeRoot)}</p>
          <p><code>PROFILE_STORE_PATH</code>: ${escapeHtml(config.profileStorePath)}</p>
        </div>
      </div>
    </section>

    <section>
      <h2>目标链路</h2>
      <div class="flow">
        <div class="step"><strong>1. 前端 / Supabase</strong>AI 助手入口只保存和发送当前用户消息；Supabase 只服务聊天 UI 展示。</div>
        <div class="step"><strong>2. Context RDS</strong>Next API 把当前纯消息、附件解析文本、run 和 trace 镜像写入阿里云 RDS context 表。</div>
        <div class="step"><strong>3. Hermes 外层</strong>ECS 从 RDS 加载用户画像、线程摘要、最近纯对话和 artifacts，准备本轮临时目录。</div>
        <div class="step"><strong>4. Codex General</strong>处理对话、搜索、工具调用和能力统筹。</div>
        <div class="step"><strong>5. 返回用户</strong>主回答同步返回，不等待长期记忆整理。</div>
        <div class="step"><strong>6. Memory Job</strong>后台 review turn，必要时写入产品侧用户画像表。</div>
      </div>
    </section>

    <section>
      <h2>当前进度</h2>
      <ul>
        <li><span class="pill success">完成</span> 本地 Hermes 源码 runtime 可由 product server 调起。</li>
        <li><span class="pill success">完成</span> Codex app-server 使用 OpenRouter DeepSeek，不依赖 OpenAI/Codex OAuth。</li>
        <li><span class="pill success">完成</span> 每个 turn 使用独立临时 <code>HERMES_HOME</code>、<code>CODEX_HOME</code> 和 workspace。</li>
        <li><span class="pill success">完成</span> 产品侧 profile 会从数据库/文件存储加载并注入当前轮。</li>
        <li><span class="pill success">完成</span> Memory review 已改为异步 job，不阻塞用户看到主回答。</li>
        <li><span class="pill success">完成</span> 默认 <code>RUNTIME_STATE_MODE=ephemeral</code>：主回答后删除本轮临时 runtime 目录。</li>
        <li><span class="pill success">完成</span> 保留 <code>RUNTIME_STATE_MODE=snapshot</code> 作为调试/兼容模式，可恢复旧的 runtime state 快照同步。</li>
        <li><span class="pill success">完成</span> 阿里云 ECS 正式 <code>8787</code> 已运行 source-runtime 镜像；当前产品路径使用产品侧 Hermes router + source-built Codex app-server。</li>
        <li><span class="pill success">完成</span> Personal Agent 上下文已拆库：Supabase 只做 UI 对话展示，阿里云 RDS <code>agent_context_*</code> 表保存 run、artifact、summary、tool trace 和 ECS 可加载的纯消息镜像。</li>
        <li><span class="pill queued">进行中</span> source Hermes 直通模式的 Codex 动态工具桥接已在本地源码补丁中实现，待重建镜像并云端验证后可重新开启。</li>
        <li><span class="pill queued">进行中</span> 本地文件队列后续要替换成数据库 job 表和独立 worker 服务。</li>
      </ul>
    </section>

    <section>
      <h2>产品化路线图</h2>
      <div class="grid two">
        <div class="panel">
          <h3>阶段 1：本地可控内核</h3>
          <ul>
            <li><span class="pill success">完成</span> 本地 Hermes 源码 + Codex app-server 跑通。</li>
            <li><span class="pill success">完成</span> OpenRouter DeepSeek 接入，解耦 OpenAI/Codex OAuth。</li>
            <li><span class="pill success">完成</span> 每轮运行级 <code>HERMES_HOME</code> / <code>CODEX_HOME</code> / workspace 隔离。</li>
            <li><span class="pill success">完成</span> 产品侧用户画像注入 Codex 当前轮。</li>
          </ul>
        </div>
        <div class="panel">
          <h3>阶段 2：产品体验闭环</h3>
          <ul>
            <li><span class="pill success">完成</span> Altselfs AI 助手入口接入 personal-agent-server。</li>
            <li><span class="pill success">完成</span> Memory review 改为异步 job，不阻塞主回答。</li>
            <li><span class="pill pending">待做</span> 前端展示后台 memory review 状态或静默完成策略。</li>
            <li><span class="pill pending">待做</span> 对纯查询类 turn 跳过 review，降低 LLM 成本。</li>
          </ul>
        </div>
        <div class="panel">
          <h3>阶段 3：数据库化</h3>
          <ul>
            <li><span class="pill success">完成</span> 新增 <code>STORAGE_BACKEND=file|postgres</code> 选择。</li>
            <li><span class="pill success">完成</span> 新增 Postgres 版 profile 和 memory review job adapter。</li>
            <li><span class="pill success">完成</span> 新增 runtime state snapshot adapter；当前默认不走热路径，仅作为调试/兼容模式。</li>
            <li><span class="pill success">完成</span> Worker claim 使用 <code>FOR UPDATE SKIP LOCKED</code>。</li>
            <li><span class="pill success">完成</span> 阿里云 RDS PostgreSQL 联调，云端已使用 <code>STORAGE_BACKEND=postgres</code>。</li>
            <li><span class="pill success">完成</span> 新增 <code>AGENT_CONTEXT_DATABASE_URL</code> 专用连接，Personal Agent 的 artifact、run event、summary、tool trace 不再写 Supabase。</li>
            <li><span class="pill queued">进行中</span> 消息、线程、run event、job event 的完整审计视图。</li>
          </ul>
        </div>
        <div class="panel">
          <h3>阶段 4：容器云部署</h3>
          <ul>
            <li><span class="pill success">完成</span> 构建 personal-agent-server Docker 镜像。</li>
            <li><span class="pill success">完成</span> 当前 ECS 已由 Docker Compose 容器接管 <code>8787</code>。</li>
            <li><span class="pill success">完成</span> 当前 ECS 已部署 source-runtime 镜像，容器内包含 Hermes 源码和 Codex app-server 源码。</li>
            <li><span class="pill success">完成</span> 云端 smoke test 已验证 <code>/healthz</code>、<code>/v1/turns/start</code>、<code>altselfs_web_search</code> 和异步 memory review job。</li>
            <li><span class="pill queued">进行中</span> source Hermes 直通模式的 <code>altselfs_web_search</code> 动态工具桥接已实现，待重建 source-runtime 镜像和云端 smoke test。</li>
            <li><span class="pill pending">待做</span> 拆分 API 容器和 worker 容器。</li>
            <li><span class="pill pending">待做</span> 推送到阿里云 ACR，并把 ECS 从本地 build 改为拉取镜像 tag。</li>
            <li><span class="pill pending">待做</span> 配置日志归集、弹性伸缩和滚动发布。</li>
          </ul>
        </div>
        <div class="panel">
          <h3>阶段 5：持久化与多用户</h3>
          <ul>
            <li><span class="pill success">完成</span> 默认把 Codex/Hermes 本地 runtime 目录视为每轮临时产物，完成后清理。</li>
            <li><span class="pill success">完成</span> 长期用户画像由产品侧 profile store / RDS 承载，不依赖 <code>USER.md</code> 本地文件。</li>
            <li><span class="pill success">完成</span> 每轮上下文从 RDS 的干净材料拼接：用户画像、thread summary、最近纯对话、当前用户消息和 artifacts；不保存历史完整 prompt 作为长期状态。</li>
            <li><span class="pill pending">待做</span> 未来真实文件产物迁移到阿里云 OSS，RDS 只保留 metadata、checksum 和 object key。</li>
            <li><span class="pill pending">待做</span> 每用户资源配额、并发限制、超时和强制停止。</li>
            <li><span class="pill pending">待做</span> 备份、恢复、数据导出和删除。</li>
          </ul>
        </div>
        <div class="panel">
          <h3>阶段 6：安全和权限</h3>
          <ul>
            <li><span class="pill pending">待做</span> Codex General 禁用本地工程文件和 shell 执行类能力。</li>
            <li><span class="pill pending">待做</span> 工具白名单：搜索、产品内数据、秘书晨报、渠道 agent。</li>
            <li><span class="pill pending">待做</span> OpenRouter key 管理、供应商路由、成本审计。</li>
            <li><span class="pill pending">待做</span> 用户数据隔离审计和 prompt 注入防护策略。</li>
          </ul>
        </div>
      </div>
    </section>

    <section>
      <h2>目标云端架构</h2>
      <div class="flow">
        <div class="step"><strong>Vercel / Web</strong>Altselfs 前端和产品 API。</div>
        <div class="step"><strong>Agent API</strong>容器化 personal-agent-server，接收 turn。</div>
        <div class="step"><strong>Worker</strong>异步 memory review、晨报等后台任务。</div>
        <div class="step"><strong>Supabase</strong>只保存前端聊天 UI 需要的纯用户/助手消息。</div>
        <div class="step"><strong>Context Database</strong>阿里云 RDS PostgreSQL 保存 Agent 可加载的消息镜像、附件文本、summary、run、tool trace、job、画像和审计索引。</div>
        <div class="step"><strong>Storage</strong>对象存储保存未来文件产物；Hermes/Codex runtime 目录默认不长期保存。</div>
      </div>
      <p class="muted">短期可以继续保留前端在 Vercel；Agent API 和 Worker 更适合放在阿里云容器服务，数据库优先用 RDS PostgreSQL。</p>
    </section>

    <section>
      <h2>服务拆分</h2>
      <div class="grid two">
        <div class="panel">
          <h3>Agent API 容器</h3>
          <p>启动方式：<code>AGENT_PROCESS_ROLE=api npm run start</code></p>
          <ul>
            <li>接收前端 <code>/v1/turns/start</code>。</li>
            <li>执行 Hermes/Codex 主回答。</li>
            <li>把 memory review 写入 job store。</li>
            <li>不消费后台 job。</li>
          </ul>
        </div>
        <div class="panel">
          <h3>Agent Worker 容器</h3>
          <p>启动方式：<code>AGENT_PROCESS_ROLE=worker npm run start</code></p>
          <ul>
            <li>轮询 memory review job store。</li>
            <li>调用轻量 LLM review 当前 turn。</li>
            <li>将长期偏好/画像写入产品侧 profile store / RDS。</li>
            <li>后续也会承载晨报、渠道同步等后台任务。</li>
          </ul>
        </div>
      </div>
      <p class="muted">本地默认 <code>AGENT_PROCESS_ROLE=all</code>，API 和 Worker 同进程，便于调试；线上应拆成两个容器。</p>
    </section>

    <section>
      <h2>异步 B 方案</h2>
      <p>同步部分只覆盖用户正在等待的主回答：前端 -> personal-agent-server -> Hermes -> Codex app-server -> OpenRouter -> 前端。</p>
      <p>异步部分独立消费 job：主回答完成后写入 memory review job store，worker 使用轻量 LLM 判断本轮是否产生长期偏好/画像，再写入产品侧 profile store / RDS。</p>
      <p class="muted">这意味着下一轮对话读取的是“已经完成”的画像；如果 review job 尚未完成，刚刚产生的新偏好可能要再下一轮才生效。</p>
    </section>

    <section>
      <h2>临时改动和待清理点</h2>
      <ul>
        <li><span class="warn">临时</span> 当前 ECS 已使用 Docker Compose，但镜像仍在服务器本地构建；下一步要推送到阿里云 ACR 或其他镜像仓库。</li>
        <li><span class="warn">临时</span> source-runtime 构建上下文目前由本地打包上传到 ECS；其中 Cargo vendor 和 <code>rusty_v8</code> 静态库是为绕过云端 GitHub 下载不稳定做的临时构建加速。</li>
        <li><span class="warn">临时</span> source Hermes 直通模式此前会绕过产品侧 <code>CodexAgentRuntime</code> 的动态工具注册；目前已补上本机工具桥接，但云端仍需重建镜像验证后再把 <code>HERMES_SOURCE_RUNTIME_ENABLED</code> 切回 <code>true</code>。</li>
        <li><span class="warn">临时</span> worker 和 API server 在同一个容器进程里，生产应拆成独立 worker 容器。</li>
        <li><span class="warn">临时</span> 本地 Hermes/Codex 源码在 <code>/Users/richardjian/work/agent-sources</code>，生产要固化为镜像构建步骤。</li>
        <li><span class="warn">临时</span> 对 Hermes 源码有 OpenRouter 和本地运行补丁，后续要整理为可重复 patch 或 fork。</li>
        <li><span class="warn">临时</span> Codex General 的工具权限仍是本地验证配置，生产要禁用本地文件/命令类能力，只保留产品允许的工具。</li>
        <li><span class="warn">临时</span> <code>RUNTIME_STATE_MODE=snapshot</code> 仍保留旧的 RDS runtime 快照方案，但默认产品路径已改为 <code>ephemeral</code>。</li>
        <li><span class="warn">临时</span> 异步 review worker 现在和 API 同进程，线上要拆成独立进程，避免 API 重启影响 job。</li>
        <li><span class="warn">临时</span> review prompt 是产品侧精简版，后续要继续对齐 Hermes 原生 review 标准，但持久化目标保持产品侧 RDS。</li>
        <li><span class="warn">临时</span> 云端 ECS 的 <code>8787</code> 端口当前只用于手动测试，应只对白名单公网 IP 开放；接入 Vercel 后要改为 API Gateway / SLB / HTTPS + 服务层鉴权，不能长期裸露测试端口。</li>
        <li><span class="warn">临时</span> 当前测试安全组曾放行本机公网 IP；正式接入 Vercel 后，访问来源会变成 Vercel 出口或服务网关，不应继续依赖本机 IP 白名单。</li>
        <li><span class="warn">临时</span> ECS 系统盘构建后剩余空间约 6.5GB，需要清理旧构建上下文、Docker builder cache，或把系统盘扩容到 80GB+。</li>
      </ul>
    </section>

    <section>
      <h2>最近 Memory Review Jobs</h2>
      <table>
        <thead>
          <tr><th>Job</th><th>Status</th><th>User</th><th>Thread</th><th>Updated</th><th>Error</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="6" class="muted">暂无 job</td></tr>'}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
