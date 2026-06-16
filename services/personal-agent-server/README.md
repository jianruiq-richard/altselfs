# Altselfs Personal Agent Server

This service is the planned multi-tenant "Hermes-style shell + Codex runtime"
backend.

Design:

```text
Altselfs Personal Main Agent
  - user memory / profile snapshots
  - session and thread ownership
  - agent profile registry and LLM routing
  - memory write suggestions
  - trace persistence boundary

Codex app-server child runtime
  - original Codex runtime
  - shell / file / patch / sandbox / MCP execution
  - one active turn per isolated user/thread workspace
```

Codex is **not** a skill here. It is an execution backend registered behind
multiple agent profiles. Skills are procedural memories that the main agent may
inject or use when deciding how to route a turn.

Default profiles:

- `codex-general`: ChatGPT-like discussion, reasoning, research, and tool-using
  tasks. Its workspace is internal scratchpad only.
- `codex-engineering`: repository inspection, code editing, shell commands,
  tests, builds, debugging, and deployment work.

The Hermes router LLM sees the registered profiles and returns a structured
routing decision. The raw router request/response is emitted in `main.router.raw`
for trace inspection.

## MVP Endpoints

```text
GET  /healthz
POST /v1/turns/start
```

Request:

```json
{
  "userId": "user_123",
  "threadId": "thread_abc",
  "message": "帮我修改后台 trace canvas",
  "allowedAgents": ["codex"]
}
```

Response:

```json
{
  "threadId": "thread_abc",
  "route": "codex",
  "reply": "...",
  "events": []
}
```

## Runtime Notes

- Use one isolated `CODEX_HOME` per user.
- Use one isolated workspace per user/thread.
- Treat Postgres as the authoritative store.
- Treat local Codex state as runtime/cache state that can be rebuilt from
  Postgres + object storage snapshots.

## Local Dev

```bash
npm install
npm run typecheck
npm run dev
```

Environment:

```bash
cp .env.example .env
```

The Codex path requires `codex` on `PATH`.

Known MVP limitations:

- Memory is still in-process only. Restarting the service clears it.
- `codex-general` has local shell/files/patching disabled. It can use the
  `altselfs_web_search` dynamic tool when a provider is configured.
- `codex-engineering` uses an isolated empty workspace unless a product
  workspace is explicitly bound.
- Approval requests are currently declined by default, so write operations are
  not enabled yet.

### Web Search Providers

`codex-general` exposes one dynamic tool to the Codex app-server:
`altselfs_web_search`.

Provider selection is controlled by env vars:

```bash
# auto | serpapi | serper | google_cse | bing | duckduckgo
WEB_SEARCH_PROVIDER=auto

# Preferred Google-results path.
SERPAPI_API_KEY=...

# Alternative Google-results path.
SERPER_API_KEY=...

# Official Google Programmable Search path, for accounts that already have it.
GOOGLE_CSE_API_KEY=...
GOOGLE_CSE_ID=...

# Bing path.
BING_SEARCH_API_KEY=...
BING_SEARCH_ENDPOINT=https://api.bing.microsoft.com/v7.0/search
```

When `WEB_SEARCH_PROVIDER=auto`, the server chooses `serpapi` first, then
`serper`, then `google_cse`, then `bing`, then `duckduckgo`.

### Local OpenRouter + Codex Smoke Test

From the repository root:

```bash
set -a
source .env.local
set +a

PORT=8787 \
CODEX_MODEL_PROVIDER=openrouter \
CODEX_MODEL=deepseek/deepseek-v3.2 \
CODEX_WEB_SEARCH_MODE=live \
CODEX_GENERAL_DISABLE_LOCAL_ENVIRONMENT=true \
npx tsx services/personal-agent-server/src/index.ts
```

Health check:

```bash
curl --noproxy '*' http://127.0.0.1:8787/healthz
```

Main-agent memory path:

```bash
curl --noproxy '*' -s http://127.0.0.1:8787/v1/turns/start \
  -H 'content-type: application/json' \
  -d '{"userId":"local-test-user","threadId":"local-test-thread","message":"记住：我喜欢看每一步的原始输入输出。"}'
```

Codex child-agent path:

```bash
curl --noproxy '*' -s http://127.0.0.1:8787/v1/turns/start \
  -H 'content-type: application/json' \
  -d '{"userId":"local-test-user","threadId":"local-codex-thread","message":"请帮我搜集一下今日关于OPC相关的行业或者技术信息。"}'
```

Current MVP behavior:

- `modelProvider` should be `openrouter` in the returned `codex.thread.started` event.
- Codex runs inside an isolated per-user/thread workspace under `WORKSPACE_ROOT`.
- `codex-general` should not read local files or run local commands.
- For current-information requests, it should call `altselfs_web_search` before answering.
- Approval requests are currently declined by default, so write operations are not enabled yet.
