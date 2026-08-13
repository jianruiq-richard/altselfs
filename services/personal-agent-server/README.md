# Altselfs Personal Agent Server

This service is the planned multi-tenant "Hermes-style shell + Codex runtime"
backend.

Design:

```text
Altselfs Personal Main Agent
  - user memory / profile snapshots
  - session and thread ownership
  - agent profile registry and legacy LLM routing fallback
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

When `HERMES_SOURCE_RUNTIME_ENABLED=true`, the Hermes source runtime is the
primary loop and no pre-Hermes router LLM decision is made. Hermes decides
whether to answer directly or call Codex as a tool.

The legacy non-source runtime path can still use the Hermes router LLM to return
a structured routing decision. Its raw request/response is emitted in
`main.router.raw` for trace inspection.

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
  "message": "Localized documentation trace canvas",
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

- Use one isolated temporary `CODEX_HOME`, `HERMES_HOME`, and workspace per
  user/thread/run.
- Treat Postgres as the authoritative store.
- Treat local Codex/Hermes runtime files as disposable run artifacts by default.
  The product hot path reconstructs context from stored messages/profile state,
  then deletes the temporary runtime directories after the turn.

## Local Dev

```bash
npm install
npm run typecheck
npm run dev
```

Local development defaults to `AGENT_PROCESS_ROLE=all`, which runs the API and
the background worker in one Node process. Product deployment should split them:

```bash
# API container: handles foreground turns and enqueues background jobs.
AGENT_PROCESS_ROLE=api npm run start

# Worker container: consumes background jobs such as memory review.
AGENT_PROCESS_ROLE=worker npm run start
```

The current local persistence adapters are file-backed. They intentionally sit
behind interfaces so the production adapters can move to PostgreSQL/RDS without
changing the Hermes/Codex orchestration path:

- `PROFILE_STORE_PATH` stores explicit product-side user profile entries.
- `MEMORY_REVIEW_JOB_STORE_PATH` stores queued/running/completed memory review jobs.
- Hermes/Codex native runtime files live under run-scoped local
  `HERMES_HOME` / `CODEX_HOME` / workspace paths while a turn is running.
  `RUNTIME_STATE_MODE=ephemeral` is the default product mode: the runtime
  directories are deleted after the foreground turn and memory review reads the
  clean product-side turn/profile data instead of local `USER.md` files.
- `RUNTIME_STATE_MODE=snapshot` is retained as a debugging/compatibility mode.
  In that mode, `RUNTIME_STATE_SYNC_ENABLED=true` hydrates runtime directories
  from RDS before the turn and flushes compressed snapshots back after the turn.
- `RUNTIME_STATE_MODE=sandbox` keeps a per-user/per-thread workspace under
  `SANDBOX_STORAGE_ROOT/users/{user}/threads/{thread}/workspace`. Uploaded
  originals go to `uploads/`, parsed text and indexes go to `artifacts/`, agent
  generated files should go to `outputs/`, and command audit data goes to
  `.runs/`.
- True command isolation is separate from the state mode. Enable
  `SANDBOX_EXEC_ENABLED=true`, mount the host Docker socket, and set the
  `SANDBOX_EXEC_*` limits to expose `altselfs_sandbox_exec` to non-local Codex
  profiles. The server creates short-lived Docker containers instead of giving
  the model direct host shell access.

PostgreSQL/RDS mode is selected with:

```bash
STORAGE_BACKEND=postgres
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME
```

Before using Postgres mode, apply the schema:

```bash
psql "$DATABASE_URL" -f services/personal-agent-server/docs/schema.sql
```

The Postgres adapter currently covers:

- `agent_memory_entries` for product-side user profile entries.
- `agent_memory_events` for explicit profile write audit events.
- `agent_memory_review_jobs` for API/Worker shared background memory review jobs.
- `agent_runtime_state_snapshots` for optional compressed Hermes/Codex runtime
  state snapshots when `RUNTIME_STATE_MODE=snapshot` is explicitly enabled.
  This is not the default product hot path.

The worker claims jobs with `FOR UPDATE SKIP LOCKED`, so multiple worker
containers can run without processing the same job at the same time.

Productization status page:

```bash
open http://127.0.0.1:8787/productization
```

Memory review job API:

```bash
curl --noproxy '*' 'http://127.0.0.1:8787/v1/memory-review/jobs?limit=20'
```

Environment:

```bash
cp .env.example .env
```

The Codex path requires `codex` on `PATH`.

Known MVP limitations:

- Memory is still in-process only. Restarting the service clears it.
- `codex-general` has native local shell/files/patching disabled. It can use
  `altselfs_web_search` when a provider is configured, and can use
  `altselfs_sandbox_exec` only when sandbox execution is explicitly enabled.
- `codex-engineering` uses an isolated empty workspace unless a product
  workspace is explicitly bound.
- Approval requests are currently declined by default, so write operations are
  not enabled yet.
- `RUNTIME_STATE_MODE=snapshot` currently stores `tar.gz` snapshots in RDS
  `bytea`. Keep `RUNTIME_STATE_MAX_ARCHIVE_BYTES` conservative and move large
  artifacts to OSS before enabling heavy workspace/file capabilities.

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

### Local Hermes + Codex Smoke Test

From the repository root:

```bash
set -a
source .env.local
set +a

PORT=8787 \
HERMES_MODEL=claude-sonnet-4-6 \
HERMES_PROVIDER=apiyi \
HERMES_BASE_URL=https://vip.apiyi.com/v1 \
HERMES_API_KEY_ENV=APIYI_API_KEY \
CODEX_MODEL_PROVIDER=openai \
CODEX_MODEL=gpt-5.5 \
CODEX_MODEL_CONTEXT_WINDOW=128000 \
CODEX_MODEL_AUTO_COMPACT_TOKEN_LIMIT=64000 \
CODEX_TOOL_OUTPUT_TOKEN_LIMIT=12000 \
CODEX_WEB_SEARCH_MODE=live \
CODEX_GENERAL_DISABLE_LOCAL_ENVIRONMENT=true \
npx tsx services/personal-agent-server/src/index.ts
```

`CODEX_MODEL_PROVIDER=openai` runs Codex with the retained ChatGPT OAuth
credential at `CODEX_OPENAI_AUTH_JSON_PATH`. APIYi remains available as an
explicit fallback: set the provider to `apiyi` and use a separate
`CODEX_APIYI_API_KEY` whose group serves the selected GPT model (for example
Default, CodexResponses, or CodexReverse).

For the OpenAI provider, the server owns the OAuth refresh token through an
auth broker. Each Codex app-server receives only the current access token via
Codex's external `chatgptAuthTokens` login protocol. If an access token is near
expiry or Codex receives a 401, the broker takes a short cross-process lock,
re-reads the shared credential, rotates the refresh token once, and atomically
writes the result back with mode `0600`. The lock is never held for the Codex
turn, so `AGENT_TURN_MAX_OPENAI=3` allows three different turns to use the same
ChatGPT account concurrently while each thread remains single-flight. The auth
file must therefore be writable by the server and shared by all workers that
use that account.

Codex model metadata can be supplied per model so OpenRouter model slugs still
have explicit context and compaction limits even when Codex does not know the
model internally. The server writes these values into both `config.toml` and a
generated `model-catalog.json` under each user's `CODEX_HOME`.

The server accepts either an inline JSON catalog:

```bash
CODEX_MODEL_METADATA_JSON='{
  "defaults": {
    "toolOutputTokenLimit": 12000
  },
  "models": {
    "deepseek/deepseek-v3.2": {
      "contextWindow": 128000,
      "autoCompactTokenLimit": 64000,
      "toolOutputTokenLimit": 12000
    },
    "anthropic/claude-sonnet-4.5": {
      "contextWindow": 200000,
      "autoCompactTokenLimit": 100000,
      "toolOutputTokenLimit": 12000
    }
  }
}'
```

or a file path:

```bash
CODEX_MODEL_METADATA_PATH=/absolute/path/to/codex-models.json
```

Metadata keys can be camelCase or Codex TOML-style snake_case. Supported fields:

- `contextWindow` / `model_context_window`
- `autoCompactTokenLimit` / `model_auto_compact_token_limit`
- `toolOutputTokenLimit` / `tool_output_token_limit`
- `reasoningSummary` / `model_reasoning_summary`
- `verbosity` / `model_verbosity`
- `supportsReasoningSummaries` / `model_supports_reasoning_summaries`

For the active model only, simple env overrides are also supported:

```bash
CODEX_MODEL_CONTEXT_WINDOW=128000
CODEX_MODEL_AUTO_COMPACT_TOKEN_LIMIT=64000
CODEX_TOOL_OUTPUT_TOKEN_LIMIT=12000
CODEX_MODEL_REASONING_SUMMARY=none
CODEX_MODEL_VERBOSITY=low
CODEX_MODEL_SUPPORTS_REASONING_SUMMARIES=false
```

Health check:

```bash
curl --noproxy '*' http://127.0.0.1:8787/healthz
```

## Production Container Deployment

The first production-shaped deployment target is a single ECS instance running
Docker Compose. This replaces the temporary bare Node + systemd service while
keeping the same RDS database and `/data/altselfs-agent` runtime data directory.

One-time setup on the server:

```bash
mkdir -p /data/altselfs-agent
cp env.production.example .env.production
```

Fill `.env.production` with the real RDS URL and API keys. Do not commit that
file.

Local or server-side build:

```bash
docker compose -f docker-compose.production.yml build
docker compose -f docker-compose.production.yml up -d
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/productization
```

Future image-registry flow:

```bash
docker build -t registry.example.com/altselfs/personal-agent-server:TAG .
docker push registry.example.com/altselfs/personal-agent-server:TAG

PERSONAL_AGENT_IMAGE=registry.example.com/altselfs/personal-agent-server:TAG \
docker compose -f docker-compose.production.yml pull

PERSONAL_AGENT_IMAGE=registry.example.com/altselfs/personal-agent-server:TAG \
docker compose -f docker-compose.production.yml up -d
```

For the current cloud validation path, keep:

```bash
HERMES_SOURCE_RUNTIME_ENABLED=false
```

This routes requests through the product-side `codex-general` runtime, where web
search and local-environment restrictions are currently enforced. The original
Hermes source runtime should be re-enabled only after it delegates to
`codex-general` instead of bypassing the product tool registry.

### Source Runtime Container

Use this mode when the deployment must match the local controlled kernel:

```text
personal-agent-server
-> agent-sources/hermes-agent source runtime
-> source-built Codex app-server
-> OpenRouter model provider
```

Prepare a Docker build context from the external source checkouts:

```bash
npm run docker:source-runtime-context
```

By default this reads:

```text
/Users/richardjian/work/agent-sources/hermes-agent
/Users/richardjian/work/agent-sources/codex
```

and writes:

```text
/tmp/altselfs-personal-agent-source-runtime-context
```

Build and run with:

```bash
SOURCE_RUNTIME_BUILD_CONTEXT=/tmp/altselfs-personal-agent-source-runtime-context \
docker compose -f docker-compose.source-runtime.yml build

SOURCE_RUNTIME_BUILD_CONTEXT=/tmp/altselfs-personal-agent-source-runtime-context \
docker compose -f docker-compose.source-runtime.yml up -d
```

This compose file overrides the env file and forces:

```text
HERMES_SOURCE_RUNTIME_ENABLED=true
HERMES_SOURCE_ROOT=/opt/altselfs/hermes-agent
CODEX_BIN=/opt/altselfs/codex-bin/codex
UV_BIN=/usr/local/bin/altselfs-hermes-run
```

Hermes expert Skills are enabled in the source-runtime and ACR Compose paths
through the native filesystem catalog:

```text
host:      /data/altselfs-expert-skills/current/skills
container: /opt/altselfs/expert-skills (read-only)
config:    skills.external_dirs + skills.write_approval
tools:     native Hermes skills toolset
```

Before starting a new machine, publish a validated content release at the host
path above. Per-user Hermes homes are marked `.no-bundled-skills`, so upstream
bundled Skills are not seeded. The shared directory is physically read-only,
and Hermes stages any `skill_manage` write behind its native approval gate;
selection and loading remain native LLM function calls.
See [`../../expert-skills/README.md`](../../expert-skills/README.md) for the
three initial fill points, versioned release layout, activation, and rollback.

After the pushed commit has finished building in ACR, the normal semi-automatic
release command is:

```bash
ECS_SSH_TARGET=root@YOUR_ECS_HOST \
bash ../../infra/aliyun/ecs/deploy-personal-agent-server-from-workspace.sh
```

This uploads the matching Skill tree and lets the ECS deployment script switch
the shared mapping as part of the same blue-green release. The deployment keeps
a stable gateway on the public port and alternates between `blue` and `green`
agent containers:

1. pull the new image and start the inactive color in standby;
2. health-check it without allowing its Worker to claim tasks;
3. drain new claims on the active color and atomically switch gateway traffic;
4. activate the new Worker immediately, while the old Worker finishes only the
   tasks it already owns;
5. stop the old color after its turn queue, direct turns, and memory review work
   are empty.

The active color and each container's immutable Skill release survive process
restarts. A failed pre-switch health check leaves the active deployment alone;
a failed switch restores the old gateway color and reactivates the old Worker.
The first release from the legacy single-container layout briefly replaces the
public listener after a database-backed claim barrier has drained current tasks.
Subsequent releases do not restart the public gateway.

Long-running task timeout knobs:

```text
AGENT_TURN_RUN_TIMEOUT_MS=4800000
HERMES_SOURCE_RUNTIME_TIMEOUT_MS=4800000
CODEX_TURN_TIMEOUT_MS=4800000
SANDBOX_EXEC_TIMEOUT_MS=4800000
```

These values are milliseconds. The current defaults are 80 minutes for the
overall worker run, Hermes source runtime process, Codex turn completion, and
sandbox execution.

Use `docker-compose.production.yml` only as the temporary product-side fallback.

Main-agent memory path:

```bash
curl --noproxy '*' -s http://127.0.0.1:8787/v1/turns/start \
  -H 'content-type: application/json' \
  -d '{"userId":"local-test-user","threadId":"local-test-thread","message":"Localized documentation: Localized documentation."}'
```

Codex child-agent path:

```bash
curl --noproxy '*' -s http://127.0.0.1:8787/v1/turns/start \
  -H 'content-type: application/json' \
  -d '{"userId":"local-test-user","threadId":"local-codex-thread","message":"Localized documentationTodayLocalized documentationOPCLocalized documentationTechnicalLocalized documentation."}'
```

Current MVP behavior:

- `modelProvider` should be `openrouter` in the returned `codex.thread.started` event.
- Codex runs inside an isolated per-user/thread workspace under `WORKSPACE_ROOT`.
- `codex-general` should not read local files or run local commands.
- For current-information requests, it should call `altselfs_web_search` before answering.
- Approval requests are currently declined by default, so write operations are not enabled yet.
