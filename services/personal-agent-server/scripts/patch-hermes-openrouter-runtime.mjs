import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const hermesSourceRoot =
  process.env.ALTSELFS_HERMES_SOURCE_ROOT ||
  "/Users/richardjian/work/agent-sources/hermes-agent";
const runtimeProviderPath = path.join(hermesSourceRoot, "hermes_cli", "runtime_provider.py");
const codexRuntimePath = path.join(hermesSourceRoot, "agent", "codex_runtime.py");
const codexAppServerSessionPath = path.join(hermesSourceRoot, "agent", "transports", "codex_app_server_session.py");
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

let codexAppServerSession = readFileSync(codexAppServerSessionPath, "utf8");

const importsBefore = `import logging
import os
import threading
import time
`;

const importsAfter = `import json
import logging
import os
import threading
import time
import urllib.request
`;

if (codexAppServerSession.includes(importsAfter)) {
  console.log("Hermes Codex dynamic tool imports patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(importsBefore)) {
  console.error("Could not find the Hermes Codex app-server imports block to patch.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(importsBefore, importsAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool imports patch applied.");
  console.log(codexAppServerSessionPath);
}

codexAppServerSession = readFileSync(codexAppServerSessionPath, "utf8");

const dynamicToolHelpersMarker = `def _altselfs_dynamic_tools() -> list[dict[str, Any]]:`;
const dynamicToolHelpers = `
_ALTSELFS_WEB_SEARCH_TOOL = {
    "namespace": None,
    "name": "altselfs_web_search",
    "description": (
        "Search the public web for current external information. Use this "
        "when public web facts, news, industry updates, market information, "
        "or web research are needed and no more specific registered "
        "channel/tool is better. Returns compact search results with title, "
        "URL, and snippet."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query."},
            "recency": {
                "type": "string",
                "description": "Optional recency hint such as today, 24h, week, month.",
            },
        },
        "required": ["query"],
        "additionalProperties": False,
    },
    "deferLoading": False,
}


def _altselfs_dynamic_tools() -> list[dict[str, Any]]:
    enabled = os.environ.get("ALTSELFS_CODEX_WEB_SEARCH_DYNAMIC_TOOL", "true").lower()
    if enabled in {"0", "false", "no", "off"}:
        return []
    return [_ALTSELFS_WEB_SEARCH_TOOL]


def _call_altselfs_tool_bridge(arguments: Any) -> dict[str, Any]:
    bridge_url = os.environ.get(
        "ALTSELFS_TOOL_BRIDGE_URL",
        "http://127.0.0.1:8787/internal/tools/web-search",
    )
    payload = arguments if isinstance(arguments, dict) else {}
    request = urllib.request.Request(
        bridge_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
    parsed = json.loads(raw) if raw.strip() else {}
    if isinstance(parsed, dict) and "contentItems" in parsed:
        return parsed
    return {
        "contentItems": [
            {
                "type": "inputText",
                "text": json.dumps(parsed, ensure_ascii=False),
            }
        ],
        "success": True,
    }

`;

const helpersAnchor = `# How many tailing stderr lines from the codex subprocess to attach to a
# user-facing error when we don't have a more specific classification (OAuth,
# wedge watchdog, etc.). Small enough to keep error messages legible, large
# enough to surface a config/provider/auth diagnostic.
_STDERR_TAIL_LINES = 12
`;

if (codexAppServerSession.includes(dynamicToolHelpersMarker)) {
  console.log("Hermes Codex dynamic tool helper patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(helpersAnchor)) {
  console.error("Could not find the Hermes Codex app-server helper insertion point.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(helpersAnchor, `${helpersAnchor}${dynamicToolHelpers}`);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool helper patch applied.");
  console.log(codexAppServerSessionPath);
}

codexAppServerSession = readFileSync(codexAppServerSessionPath, "utf8");

const initializeBefore = `        self._client.initialize(
            client_name="hermes",
            client_title="Hermes Agent",
            client_version=_get_hermes_version(),
        )
`;

const initializeAfter = `        self._client.initialize(
            client_name="hermes",
            client_title="Hermes Agent",
            client_version=_get_hermes_version(),
            capabilities={"experimentalApi": True},
        )
`;

if (codexAppServerSession.includes(initializeAfter)) {
  console.log("Hermes Codex experimental API patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(initializeBefore)) {
  console.error("Could not find the Hermes Codex initialize block to patch.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(initializeBefore, initializeAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex experimental API patch applied.");
  console.log(codexAppServerSessionPath);
}

codexAppServerSession = readFileSync(codexAppServerSessionPath, "utf8");

const threadParamsBefore = `        params: dict[str, Any] = {"cwd": self._cwd}
        result = self._client.request("thread/start", params, timeout=15)
`;

const threadParamsPreviousPatch = `        params: dict[str, Any] = {"cwd": self._cwd}
        dynamic_tools = _altselfs_dynamic_tools()
        if dynamic_tools:
            params["dynamicTools"] = dynamic_tools
        result = self._client.request("thread/start", params, timeout=15)
`;

const threadParamsAfter = `        params: dict[str, Any] = {"cwd": self._cwd}
        dynamic_tools = _altselfs_dynamic_tools()
        if dynamic_tools:
            params["dynamicTools"] = dynamic_tools
        if os.environ.get("ALTSELFS_CODEX_DISABLE_LOCAL_ENVIRONMENT", "false").lower() in {"1", "true", "yes", "on"}:
            params["environments"] = []
        developer_instructions = os.environ.get("ALTSELFS_CODEX_DEVELOPER_INSTRUCTIONS", "").strip()
        if developer_instructions:
            params["developerInstructions"] = developer_instructions
        personality = os.environ.get("ALTSELFS_CODEX_PERSONALITY", "pragmatic").strip()
        if personality:
            params["personality"] = personality
        result = self._client.request("thread/start", params, timeout=15)
`;

if (codexAppServerSession.includes(threadParamsAfter)) {
  console.log("Hermes Codex dynamic tool registration patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (codexAppServerSession.includes(threadParamsPreviousPatch)) {
  codexAppServerSession = codexAppServerSession.replace(threadParamsPreviousPatch, threadParamsAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool registration patch upgraded.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(threadParamsBefore)) {
  console.error("Could not find the Hermes Codex thread/start params block to patch.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(threadParamsBefore, threadParamsAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool registration patch applied.");
  console.log(codexAppServerSessionPath);
}

codexAppServerSession = readFileSync(codexAppServerSessionPath, "utf8");

const toolCallBranchBefore = `        elif method == "item/permissions/requestApproval":
            # Codex sometimes asks to escalate permissions mid-turn. We
`;

const toolCallBranchAfter = `        elif method == "item/tool/call":
            self._handle_dynamic_tool_call(rid, params)
        elif method == "item/permissions/requestApproval":
            # Codex sometimes asks to escalate permissions mid-turn. We
`;

if (codexAppServerSession.includes(toolCallBranchAfter)) {
  console.log("Hermes Codex dynamic tool request branch patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(toolCallBranchBefore)) {
  console.error("Could not find the Hermes Codex server request branch insertion point.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(toolCallBranchBefore, toolCallBranchAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool request branch patch applied.");
  console.log(codexAppServerSessionPath);
}

codexAppServerSession = readFileSync(codexAppServerSessionPath, "utf8");

const dynamicToolMethodMarker = `    def _handle_dynamic_tool_call(self, rid: Any, params: dict) -> None:`;
const dynamicToolMethod = `    def _handle_dynamic_tool_call(self, rid: Any, params: dict) -> None:
        if self._client is None:
            return
        namespace = params.get("namespace") or ""
        tool = params.get("tool") or ""
        is_web_search = (
            (not namespace and tool == "altselfs_web_search")
            or (namespace == "altselfs" and tool == "web_search")
        )
        if not is_web_search:
            self._client.respond(
                rid,
                {
                    "contentItems": [
                        {
                            "type": "inputText",
                            "text": f"Unsupported dynamic tool: {namespace}.{tool}",
                        }
                    ],
                    "success": False,
                },
            )
            return
        try:
            result = _call_altselfs_tool_bridge(params.get("arguments") or {})
            self._client.respond(rid, result)
        except Exception as exc:
            logger.exception("Altselfs web search dynamic tool failed")
            self._client.respond(
                rid,
                {
                    "contentItems": [
                        {
                            "type": "inputText",
                            "text": f"Altselfs web search failed: {exc}",
                        }
                    ],
                    "success": False,
                },
            )

`;

const dynamicToolMethodAnchor = `    def _decide_exec_approval(self, params: dict) -> str:
`;

if (codexAppServerSession.includes(dynamicToolMethodMarker)) {
  console.log("Hermes Codex dynamic tool handler patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(dynamicToolMethodAnchor)) {
  console.error("Could not find the Hermes Codex dynamic tool handler insertion point.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(dynamicToolMethodAnchor, `${dynamicToolMethod}${dynamicToolMethodAnchor}`);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool handler patch applied.");
  console.log(codexAppServerSessionPath);
}
