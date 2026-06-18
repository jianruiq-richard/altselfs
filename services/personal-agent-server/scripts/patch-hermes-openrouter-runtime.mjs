import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const hermesSourceRoot =
  process.env.ALTSELFS_HERMES_SOURCE_ROOT ||
  "/Users/richardjian/work/agent-sources/hermes-agent";
const runtimeProviderPath = path.join(hermesSourceRoot, "hermes_cli", "runtime_provider.py");
const codexRuntimePath = path.join(hermesSourceRoot, "agent", "codex_runtime.py");
const runAgentPath = path.join(hermesSourceRoot, "run_agent.py");
const backgroundReviewPath = path.join(hermesSourceRoot, "agent", "background_review.py");

const before = `    # {"openai", "openai-codex"}. Default is unchanged.
    "codex_app_server",
}
`;

const after = `    # {"openai", "openai-codex"} in upstream Hermes. Altselfs also allows
    # "openrouter" so the outer Hermes loop can use the same OpenRouter-backed
    # model account as the child Codex app-server.
    "codex_app_server",
}
`;

const providerBefore = `    if provider not in {"openai", "openai-codex"}:
        return api_mode
`;

const providerAfter = `    if provider not in {"openai", "openai-codex", "openrouter"}:
        return api_mode
`;

const docBefore = `    Default behavior is preserved: when the key is unset, "auto", or empty,
    this function is a no-op. Only providers in {"openai", "openai-codex"}
    are eligible — other providers (anthropic, openrouter, etc.) cannot be
    rerouted through codex.
`;

const docAfter = `    Default behavior is preserved: when the key is unset, "auto", or empty,
    this function is a no-op. Upstream Hermes only allows {"openai",
    "openai-codex"} here; Altselfs also allows "openrouter" so model provider
    selection is not coupled to OpenAI/Codex OAuth.
`;

let source = readFileSync(runtimeProviderPath, "utf8");

if (source.includes(providerAfter)) {
  console.log("Hermes OpenRouter codex_app_server runtime patch already applied.");
  console.log(runtimeProviderPath);
} else if (!source.includes(providerBefore)) {
  console.error("Could not find the upstream provider guard to patch.");
  console.error(runtimeProviderPath);
  process.exit(1);
} else {
  source = source.replace(providerBefore, providerAfter);
  if (source.includes(docBefore)) {
    source = source.replace(docBefore, docAfter);
  }
  if (source.includes(before)) {
    source = source.replace(before, after);
  }

  writeFileSync(runtimeProviderPath, source, "utf8");
  console.log("Hermes OpenRouter codex_app_server runtime patch applied.");
  console.log(runtimeProviderPath);
}

let codexRuntime = readFileSync(codexRuntimePath, "utf8");
const flushBefore = `    # External memory provider sync (mirrors line ~15439). Skipped on
    # interrupt/error to avoid feeding partial transcripts to memory.
    if not turn.interrupted and turn.error is None:
        try:
            agent._sync_external_memory_for_turn(
                original_user_message=original_user_message,
                final_response=turn.final_text,
                interrupted=False,
            )
        except Exception:
            logger.debug("external memory sync raised", exc_info=True)
`;

const flushAfter = `    # Persist projected Codex messages before this early-return path exits.
    # The normal chat_completions path reaches finalize_turn(), which flushes
    # messages to Hermes state.db. codex_app_server returns early, so it must
    # do the equivalent explicitly for resume and memory review.
    try:
        if hasattr(agent, "_flush_messages_to_session_db"):
            agent._flush_messages_to_session_db(messages, None)
    except Exception:
        logger.debug("codex app-server session DB flush raised", exc_info=True)

    # External memory provider sync (mirrors line ~15439). Skipped on
    # interrupt/error to avoid feeding partial transcripts to memory.
    if not turn.interrupted and turn.error is None:
        try:
            agent._sync_external_memory_for_turn(
                original_user_message=original_user_message,
                final_response=turn.final_text,
                interrupted=False,
                messages=messages,
            )
        except Exception:
            logger.debug("external memory sync raised", exc_info=True)
`;

const projectedBefore = `    # Splice projected messages into the conversation. The projector emits
    # standard {role, content, tool_calls, tool_call_id} entries, which
    # is exactly what curator.py / sessions DB expect.
    if turn.projected_messages:
        messages.extend(turn.projected_messages)
`;

const projectedAfter = `    # Splice projected messages into the conversation. Hermes already appended
    # the current user message before delegating to Codex, so always drop
    # Codex's echoed leading userMessage while preserving assistant/tool
    # projections.
    projected_messages = list(turn.projected_messages or [])
    if (
        projected_messages
        and isinstance(projected_messages[0], dict)
        and projected_messages[0].get("role") == "user"
    ):
        projected_messages = projected_messages[1:]
    if projected_messages:
        messages.extend(projected_messages)
`;

const projectedCompareAfter = `    # Splice projected messages into the conversation. Hermes already appended
    # the current user message before delegating to Codex, so drop Codex's
    # echoed leading userMessage while preserving assistant/tool projections.
    projected_messages = list(turn.projected_messages or [])
    if (
        projected_messages
        and isinstance(projected_messages[0], dict)
        and projected_messages[0].get("role") == "user"
        and str(projected_messages[0].get("content") or "").strip()
            == str(user_message or "").strip()
    ):
        projected_messages = projected_messages[1:]
    if projected_messages:
        messages.extend(projected_messages)
`;

if (codexRuntime.includes(flushAfter)) {
  console.log("Hermes codex_app_server session DB flush patch already applied.");
  console.log(codexRuntimePath);
} else if (!codexRuntime.includes(flushBefore)) {
  console.error("Could not find the Hermes codex_app_server memory sync block to patch.");
  console.error(codexRuntimePath);
  process.exit(1);
} else {
  codexRuntime = codexRuntime.replace(flushBefore, flushAfter);
  writeFileSync(codexRuntimePath, codexRuntime, "utf8");
  console.log("Hermes codex_app_server session DB flush patch applied.");
  console.log(codexRuntimePath);
}

if (codexRuntime.includes(projectedAfter)) {
  console.log("Hermes codex_app_server duplicate user projection patch already applied.");
  console.log(codexRuntimePath);
} else if (codexRuntime.includes(projectedCompareAfter)) {
  codexRuntime = codexRuntime.replace(projectedCompareAfter, projectedAfter);
  writeFileSync(codexRuntimePath, codexRuntime, "utf8");
  console.log("Hermes codex_app_server duplicate user projection patch updated.");
  console.log(codexRuntimePath);
} else if (!codexRuntime.includes(projectedBefore)) {
  console.error("Could not find the Hermes codex_app_server projected messages block to patch.");
  console.error(codexRuntimePath);
  process.exit(1);
} else {
  codexRuntime = codexRuntime.replace(projectedBefore, projectedAfter);
  writeFileSync(codexRuntimePath, codexRuntime, "utf8");
  console.log("Hermes codex_app_server duplicate user projection patch applied.");
  console.log(codexRuntimePath);
}

let runAgent = readFileSync(runAgentPath, "utf8");
const reviewSpawnBefore = `        t = threading.Thread(target=target, daemon=True, name="bg-review")
        t.start()
`;

const reviewSpawnAfter = `        if os.environ.get("HERMES_BACKGROUND_REVIEW_INLINE", "").lower() in {"1", "true", "yes", "on"}:
            target()
            return
        t = threading.Thread(target=target, daemon=True, name="bg-review")
        t.start()
`;

if (runAgent.includes(reviewSpawnAfter)) {
  console.log("Hermes inline background review patch already applied.");
  console.log(runAgentPath);
} else if (!runAgent.includes(reviewSpawnBefore)) {
  console.error("Could not find the Hermes background review thread spawn block to patch.");
  console.error(runAgentPath);
  process.exit(1);
} else {
  runAgent = runAgent.replace(reviewSpawnBefore, reviewSpawnAfter);
  writeFileSync(runAgentPath, runAgent, "utf8");
  console.log("Hermes inline background review patch applied.");
  console.log(runAgentPath);
}

let backgroundReview = readFileSync(backgroundReviewPath, "utf8");
const reviewRuntimeBefore = `            if _parent_api_mode == "codex_app_server":
                _parent_api_mode = "codex_responses"
`;

const reviewRuntimeAfter = `            if _parent_api_mode == "codex_app_server":
                if (getattr(agent, "provider", "") or "").lower() == "openrouter":
                    _parent_api_mode = "chat_completions"
                else:
                    _parent_api_mode = "codex_responses"
`;

if (backgroundReview.includes(reviewRuntimeAfter)) {
  console.log("Hermes OpenRouter background review runtime patch already applied.");
  console.log(backgroundReviewPath);
} else if (!backgroundReview.includes(reviewRuntimeBefore)) {
  console.error("Could not find the Hermes background review runtime downgrade block to patch.");
  console.error(backgroundReviewPath);
  process.exit(1);
} else {
  backgroundReview = backgroundReview.replace(reviewRuntimeBefore, reviewRuntimeAfter);
  writeFileSync(backgroundReviewPath, backgroundReview, "utf8");
  console.log("Hermes OpenRouter background review runtime patch applied.");
  console.log(backgroundReviewPath);
}
