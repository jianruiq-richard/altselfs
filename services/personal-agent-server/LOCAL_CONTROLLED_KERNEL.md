# Local Controlled Agent Kernel

This is the Phase 1 path for running Altselfs against source-controlled agent
cores:

- Hermes Agent source owns the outer loop, memory/profile review, sessions, and
  ACP process.
- Codex source owns the child app-server loop, thread/turn state, tool runtime,
  sandboxing, and compaction behavior.
- Altselfs owns orchestration, per-user isolation, product API boundaries, and
  later cloud persistence.

## Source Locations

Default local paths:

```text
ALTSELFS_CODEX_SOURCE_ROOT=/Users/richardjian/work/agent-sources/codex
ALTSELFS_HERMES_SOURCE_ROOT=/Users/richardjian/work/agent-sources/hermes-agent
```

The current source check expects:

```text
codex/codex-rs/app-server/README.md
codex/codex-rs/app-server-test-client/README.md
hermes-agent/acp_adapter/entry.py
hermes-agent/agent/transports/codex_app_server.py
hermes-agent/agent/transports/codex_app_server_session.py
```

Hermes already has a native `codex_app_server` runtime. Upstream Hermes only
allows that runtime for `openai` / `openai-codex` providers. Altselfs applies a
small local source patch so `openrouter` can also enter this runtime, decoupling
the model provider from OpenAI/Codex OAuth.

The important switch is stored in `HERMES_HOME/config.yaml`:

```yaml
model:
  provider: openrouter
  default: "deepseek/deepseek-v3.2"
  openai_runtime: codex_app_server
```

That switch only decides that Hermes should hand the turn to `codex app-server`.
The actual model/provider used by the child Codex runtime is read from
`CODEX_HOME/config.toml`.

## Local State Layout

The preparation script writes isolated local state under:

```text
/private/tmp/altselfs-local-agent-kernel/
  hermes-home/local-user/
    config.yaml
    .env
  codex-home/local-user/
    config.toml
  workspace/local-user/
```

This mirrors the later production model: one isolated Hermes home and one
isolated Codex home per user.

## Commands

From `services/personal-agent-server`:

```bash
npm run sources:inspect
npm run kernel:prepare
npm run kernel:patch-hermes-openrouter
npm run kernel:write-codex-wrapper
npm run kernel:build-codex
npm run kernel:hermes-check
```

`kernel:build-codex` requires Rust/Cargo. The current machine did not have
`cargo` installed when this workflow was added, so installing Rust is the first
external prerequisite before Codex can be built from source.

The default build compiles only the `codex-app-server` binary, then writes a
small `target/debug/codex` wrapper that supports the command shape Hermes uses:

```bash
codex app-server
```

To build the full Codex CLI/TUI shell instead:

```bash
ALTSELFS_CODEX_BUILD_MODE=cli npm run kernel:build-codex
```

If crates.io is unstable from the current network, use a sparse registry mirror:

```bash
ALTSELFS_CARGO_REGISTRY_MIRROR=tuna npm run kernel:build-codex
```

`kernel:hermes-check` runs Hermes from source through `uv`:

```bash
uv run --extra acp python -m acp_adapter.entry --check
```

The first run may download Python dependencies.

`kernel:patch-hermes-openrouter` applies the local Altselfs source patch to
Hermes:

```python
if provider not in {"openai", "openai-codex", "openrouter"}:
    return api_mode
```

Without this patch, Hermes can use OpenRouter directly, but will not hand the
turn to Codex app-server.

`kernel:write-codex-wrapper` writes the lightweight `codex app-server` wrapper
without running Cargo. Use it when `codex-app-server` is already built and only
the wrapper needs to be refreshed.

`kernel:hermes-auth` is only needed when testing the upstream `openai-codex`
provider path. It starts the original Hermes `openai-codex` auth flow using the
prepared isolated `HERMES_HOME`:

```bash
npm run kernel:hermes-auth
```

If the browser callback cannot reach the local CLI process, use manual paste:

```bash
npm run kernel:hermes-auth -- --no-browser --manual-paste
```

This auth belongs to Hermes itself. The default Altselfs local path now avoids
that dependency by using OpenRouter for both Hermes and Codex.

## Provider Mode

The local preparation defaults both Hermes and Codex to OpenRouter:

```text
ALTSELFS_CODEX_PROVIDER_MODE=openrouter
ALTSELFS_CODEX_MODEL=deepseek/deepseek-v3.2
ALTSELFS_HERMES_PROVIDER_MODE=openrouter
ALTSELFS_HERMES_MODEL=deepseek/deepseek-v3.2
```

This writes a `model_providers.openrouter` entry using `wire_api = "responses"`.
If OpenRouter does not support the exact Responses API surface required by this
Codex source version, switch Codex back to the OpenAI/Codex login path:

```bash
ALTSELFS_CODEX_PROVIDER_MODE=openai npm run kernel:prepare
```

Then authenticate Codex using the source-built or installed `codex login` flow.

## Phase 1 Acceptance

Phase 1 is complete when:

1. `sources:inspect` shows the expected Codex and Hermes source commits and all
   required files.
2. `kernel:build-codex` produces
   `/Users/richardjian/work/agent-sources/codex/codex-rs/target/debug/codex`.
3. `kernel:patch-hermes-openrouter` applies the OpenRouter
   `codex_app_server` provider patch to Hermes source.
4. `kernel:write-codex-wrapper` creates the lightweight absolute-path wrapper
   at Codex `target/debug/codex`.
5. `kernel:hermes-check` prints `Hermes ACP check OK`.
6. A local Hermes ACP turn can start with `HERMES_HOME` and `CODEX_HOME` pointing
   at the prepared isolated homes.
7. A user message reaches Hermes, Hermes uses `codex_app_server`, Codex creates a
   thread/turn, and the final assistant response is returned.

After that, the product server can replace the current hand-written
Hermes-style router with an ACP client that talks to the source-run Hermes
process.
