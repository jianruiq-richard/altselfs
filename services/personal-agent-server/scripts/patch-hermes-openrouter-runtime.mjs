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

const dynamictoolHelpersMarker = `def _altselfs_dynamic_tools() -> list[dict[str, Any]]:`;
const dynamictoolHelpers = `
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

_ALTSELFS_READ_ARTIFACT_TOOL = {
    "namespace": None,
    "name": "altselfs_read_artifact",
    "description": (
        "Read a user-uploaded artifact or parsed text file from the current "
        "Altselfs workspace. Use this when the host context lists an artifact "
        "path and the user asks about the uploaded file. Only listed "
        "workspace uploads, artifacts, outputs, or external-memory files are allowed."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute artifact path from workspace_path or parsed_text_path."},
            "maxChars": {
                "type": "number",
                "description": "Optional maximum characters to read, default 20000.",
            },
        },
        "required": ["path"],
        "additionalProperties": False,
    },
    "deferLoading": False,
}

_ALTSELFS_SANDBOX_EXEC_TOOL = {
    "namespace": None,
    "name": "altselfs_sandbox_exec",
    "description": (
        "Run a short Python or shell command in the current Altselfs sandbox "
        "workspace when deterministic computation, parsing, scraping, or file "
        "transformation is needed. The command runs in an isolated Docker "
        "container with limited CPU, memory, process count, timeout, and "
        "workspace-only filesystem access. Prefer registered platform tools "
        "for third-party data. Do not use this for repository edits or package builds."
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Shell command or Python script to run inside /workspace."},
            "cwd": {"type": "string", "description": "Optional working directory relative to /workspace, default '.'."},
            "stdin": {"type": "string", "description": "Optional stdin passed to the command."},
            "timeoutMs": {"type": "number", "description": "Optional timeout in milliseconds, capped by server policy."},
            "useProxy": {"type": "boolean", "description": "Set true only when network access needs the configured proxy/VPN."},
        },
        "required": ["command"],
        "additionalProperties": False,
    },
    "deferLoading": False,
}

_ALTSELFS_COMPETITOR_TOOLS = [
    {
        "namespace": None,
        "name": "altselfs_similarweb_api1",
        "description": (
            "Use RapidAPI similarweb-api1 visitsInfo for competitor traffic intelligence. "
            "Best for total visits, visit trend, countries, devices, engagement, traffic "
            "sources, keywords, AI traffic, and competitor/source discovery when covered."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "domain": {"type": "string", "description": "Target domain, for example figurelabs.ai. Do not include protocol."},
            },
            "required": ["domain"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_semrush13",
        "description": (
            "Use RapidAPI semrush13 domain-data for competitor intelligence. Best for "
            "covered domains with visits, growth history, search traffic, countries, "
            "devices, traffic journey, backlinks summary, keywords, competitors, and AI traffic. "
            "Does not provide backlink URL lists."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "domain": {"type": "string", "description": "Target domain, for example magiclight.ai. Do not include protocol."},
            },
            "required": ["domain"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_semrush8",
        "description": (
            "Use RapidAPI semrush8 url_traffic for lightweight SEO summary when richer "
            "sources do not cover the domain. Returns Semrush-like rank, keyword count, "
            "traffic estimate, cost estimate, and link counts."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Target URL, for example https://figurelabs.ai/."},
                "domain": {"type": "string", "description": "Target domain. Used to construct https://domain/ if url is omitted."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_domain_metrics_check",
        "description": (
            "Use RapidAPI Domain Metrics Check for SEO authority and backlink summary. "
            "Returns Moz, Majestic, and Ahrefs-style metrics such as DA, PA, spam score, "
            "Trust Flow, Citation Flow, DR, backlinks, referring domains, organic keywords, "
            "and traffic proxy."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "domain": {"type": "string", "description": "Target domain, for example figurelabs.ai. Do not include protocol."},
            },
            "required": ["domain"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
]


_ALTSELFS_PERSONAL_DATA_TOOLS = [
    {
        "namespace": None,
        "name": "altselfs_connected_accounts_list",
        "description": (
            "List the user-connected personal data accounts available to this turn, "
            "such as Gmail and Feishu accounts. Use before private-channel research when you "
            "need to know what the user has authorized."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "provider": {"type": "string", "description": "Optional provider filter, for example gmail."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_gmail_search_messages",
        "description": (
            "Search the user-authorized Gmail account(s). Best for recent email, "
            "inbox triage, todos, follow-ups, sender/subject queries, and "
            "date-window scans. Returns compact message metadata and snippets; "
            "call get_message for full body only when needed."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Gmail search query, e.g. newer_than:1d, from:alice@example.com, subject:(invoice)."},
                "maxResults": {"type": "number", "description": "Max messages per account, default 10, capped at 20."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id. If omitted, searches all connected Gmail accounts."},
                "accountEmail": {"type": "string", "description": "Optional Gmail email. If omitted, searches all connected Gmail accounts."},
                "includeSpamTrash": {"type": "boolean", "description": "Whether to include spam/trash. Default false."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_gmail_get_message",
        "description": (
            "Read one full Gmail message from a user-authorized account. Use only "
            "after search finds a relevant message or the user provides a message id."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "messageId": {"type": "string", "description": "Gmail message id."},
                "accountId": {"type": "string", "description": "Altselfs connection id. Required when multiple Gmail accounts are connected."},
                "accountEmail": {"type": "string", "description": "Gmail email. Alternative to accountId."},
            },
            "required": ["messageId"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_gmail_get_thread",
        "description": (
            "Read a Gmail thread from a user-authorized account. Use when thread "
            "context is needed for follow-up decisions or summaries."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "threadId": {"type": "string", "description": "Gmail thread id."},
                "maxMessages": {"type": "number", "description": "Max thread messages to return, default 10, capped at 20."},
                "accountId": {"type": "string", "description": "Altselfs connection id. Required when multiple Gmail accounts are connected."},
                "accountEmail": {"type": "string", "description": "Gmail email. Alternative to accountId."},
            },
            "required": ["threadId"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_lark_cli",
        "description": (
            "Run the original lark-cli with the user-authorized Feishu/Lark account. "
            "Prefer this native CLI tool for Feishu tasks not covered by a specialized "
            "shortcut: inspect help, read embedded skills, inspect schemas, search/read "
            "docs, work with calendar, IM, Drive, contacts, or call raw lark-cli api "
            "commands. The backend restores the encrypted user profile from RDS before "
            "execution and saves the updated profile snapshot after execution."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Arguments after lark-cli. Examples: drive +search --as user --query instruction --json; skills read lark-doc references/lark-doc-fetch.md; api GET /open-apis/drive/v1/files. Do not include the lark-cli binary name.",
                },
                "timeoutMs": {"type": "number", "description": "Optional timeout in milliseconds, default lark-cli timeout, capped at 120000."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id. Required when multiple Feishu accounts are connected."},
                "accountEmail": {"type": "string", "description": "Optional Feishu display name/external id. Alternative to accountId."},
            },
            "required": ["args"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_list_chats",
        "description": (
            "List Feishu/Lark IM chats visible through the user-authorized account "
            "and app scopes. Use before reading Feishu messages when a chat id is "
            "needed. This covers IM chats only, not Feishu Mail, Calendar, Docs, or Drive."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "accountId": {"type": "string", "description": "Optional Altselfs connection id. If omitted, uses the only connected Feishu account or the first few accounts."},
                "accountEmail": {"type": "string", "description": "Optional Feishu account external id/email/open id. Alternative to accountId."},
                "pageSize": {"type": "number", "description": "Max chats to return, default 20, capped at 50."},
                "pageToken": {"type": "string", "description": "Optional Feishu pagination token."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_list_messages",
        "description": (
            "Read messages from one Feishu/Lark IM chat or thread that the user/app "
            "can access. Requires containerId (chat_id or thread_id). This does not "
            "read Feishu Mail, Calendar, Docs, or Drive."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "containerId": {"type": "string", "description": "Feishu chat_id or thread_id."},
                "containerIdType": {"type": "string", "description": "chat or thread. Default chat."},
                "startTime": {"type": "string", "description": "Optional start time as Unix seconds, milliseconds, or ISO string. Default 24 hours ago."},
                "endTime": {"type": "string", "description": "Optional end time as Unix seconds, milliseconds, or ISO string. Default now."},
                "sortType": {"type": "string", "description": "ByCreateTimeDesc or ByCreateTimeAsc. Default ByCreateTimeDesc."},
                "pageSize": {"type": "number", "description": "Max messages to return, default 20, capped at 50."},
                "pageToken": {"type": "string", "description": "Optional Feishu pagination token."},
                "accountId": {"type": "string", "description": "Altselfs connection id. Required when multiple Feishu accounts are connected."},
                "accountEmail": {"type": "string", "description": "Feishu account external id/email/open id. Alternative to accountId."},
            },
            "required": ["containerId"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_recent_messages",
        "description": (
            "Best-effort scan of recent Feishu/Lark IM messages across visible chats "
            "for a connected account. Use for questions like today Feishu messages, "
            "team updates, and pending follow-ups. Access may be partial when app "
            "scopes, chat settings, or bot membership limit a chat."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "startTime": {"type": "string", "description": "Optional start time as Unix seconds, milliseconds, or ISO string. Default 24 hours ago."},
                "endTime": {"type": "string", "description": "Optional end time as Unix seconds, milliseconds, or ISO string. Default now."},
                "chatLimit": {"type": "number", "description": "Max chats to scan per account, default 10, capped at 30."},
                "maxMessagesPerChat": {"type": "number", "description": "Max messages per chat, default 10, capped at 30."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id. If omitted, scans up to 3 connected Feishu accounts."},
                "accountEmail": {"type": "string", "description": "Optional Feishu account external id/email/open id. Alternative to accountId."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_search_messages",
        "description": (
            "Search Feishu/Lark IM messages across chats with the user-authorized "
            "lark-cli profile. Prefer this for questions about a person, keyword, "
            "today messages, mentions, or follow-ups because it does not require "
            "a prior chat list."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Keyword to search, e.g. a person name, project, customer, or topic. Optional for time-window scans if Feishu allows it."},
                "startTime": {"type": "string", "description": "Optional start time as ISO string, Unix seconds, or milliseconds. Default 24 hours ago."},
                "endTime": {"type": "string", "description": "Optional end time as ISO string, Unix seconds, or milliseconds. Default now."},
                "chatType": {"type": "string", "description": "Optional chat type filter: p2p or group."},
                "isAtMe": {"type": "boolean", "description": "Only messages that mention the authorized user."},
                "pageSize": {"type": "number", "description": "Page size, default 20, capped at 50."},
                "pageLimit": {"type": "number", "description": "Auto-pagination page limit, default 1, capped at 5."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id. If omitted, searches up to 3 connected Feishu accounts."},
                "accountEmail": {"type": "string", "description": "Optional Feishu display name/external id. Alternative to accountId."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_search_users",
        "description": (
            "Search Feishu/Lark contacts by name/email/open id with the user-authorized "
            "lark-cli profile. Use before reading a direct conversation by person name; "
            "results may include p2p_chat_id/open_id."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Person name, email, or keyword."},
                "queries": {"type": "string", "description": "Optional comma-separated multi-name search."},
                "userIds": {"type": "string", "description": "Optional comma-separated open_ids; use me for current user."},
                "hasChatted": {"type": "boolean", "description": "Restrict to users the authorized user has chatted with. Default true when query is provided."},
                "excludeExternalUsers": {"type": "boolean", "description": "Exclude external cross-tenant users."},
                "pageSize": {"type": "number", "description": "Rows per request, default 20, capped at 30."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id."},
                "accountEmail": {"type": "string", "description": "Optional Feishu display name/external id. Alternative to accountId."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_today_calendar",
        "description": (
            "Read the authorized user's Feishu/Lark calendar agenda for a date window "
            "with lark-cli. Use for today meetings, schedule, and time commitments."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "startTime": {"type": "string", "description": "Optional start time as ISO string, Unix seconds, or milliseconds. Default start of today."},
                "endTime": {"type": "string", "description": "Optional end time as ISO string, Unix seconds, or milliseconds. Default end of start day."},
                "calendarId": {"type": "string", "description": "Optional calendar id, default primary."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id."},
                "accountEmail": {"type": "string", "description": "Optional Feishu display name/external id. Alternative to accountId."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_search_docs",
        "description": (
            "Search or browse Feishu/Lark docs, wiki, spreadsheet, and Drive files visible "
            "to the authorized user with lark-cli. Use for questions like what Feishu docs "
            "the user has, document discovery, plans, specs, and knowledge base content."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Optional document search keyword. Leave empty to browse by filters such as recently opened/edited, mine, or docTypes."},
                "pageSize": {"type": "number", "description": "Page size, default 10, capped at 20."},
                "pageToken": {"type": "string", "description": "Optional pagination token."},
                "docTypes": {"type": "string", "description": "Optional comma-separated types: doc,sheet,bitable,mindnote,file,wiki,docx,folder,catalog,slides,shortcut."},
                "mine": {"type": "boolean", "description": "Restrict to docs owned by the authorized user."},
                "createdByMe": {"type": "boolean", "description": "Restrict to docs originally created by the authorized user."},
                "onlyTitle": {"type": "boolean", "description": "Match titles only."},
                "sort": {"type": "string", "description": "Optional sort: default, edit_time, edit_time_asc, open_time, create_time."},
                "openedSince": {"type": "string", "description": "Optional start of my-opened time window, e.g. 7d, 1m, 2026-04-01, RFC3339, or Unix seconds."},
                "editedSince": {"type": "string", "description": "Optional start of my-edited time window, e.g. 7d, 1m, 2026-04-01, RFC3339, or Unix seconds."},
                "createdSince": {"type": "string", "description": "Optional start of document-created time window, e.g. 7d, 1m, 2026-04-01, RFC3339, or Unix seconds."},
                "folderTokens": {"type": "string", "description": "Optional comma-separated folder tokens. Cannot be combined with spaceIds."},
                "spaceIds": {"type": "string", "description": "Optional comma-separated wiki space IDs. Cannot be combined with folderTokens."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id."},
                "accountEmail": {"type": "string", "description": "Optional Feishu display name/external id. Alternative to accountId."},
            },
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
    {
        "namespace": None,
        "name": "altselfs_feishu_fetch_doc",
        "description": (
            "Read Feishu/Lark document or wiki content visible to the authorized user "
            "with lark-cli docs +fetch. Use after search_docs returns a document URL/token, "
            "or when the user provides a Feishu document URL/token."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "doc": {"type": "string", "description": "Feishu/Lark document URL or token. Supports docx and wiki URLs/tokens."},
                "docFormat": {"type": "string", "description": "Output format: xml, markdown, or im-markdown. Default markdown for summaries."},
                "detail": {"type": "string", "description": "Detail level: simple, with-ids, or full. Default simple."},
                "scope": {"type": "string", "description": "Read scope: full, outline, keyword, section, or range. Default full."},
                "keyword": {"type": "string", "description": "Keyword for scope=keyword. Use | for OR branches."},
                "startBlockId": {"type": "string", "description": "Block id for section/range start."},
                "endBlockId": {"type": "string", "description": "Block id for range end, or -1 through document end."},
                "maxDepth": {"type": "number", "description": "Outline heading depth or subtree depth. Default chosen by lark-cli."},
                "contextBefore": {"type": "number", "description": "Sibling top-level blocks before scoped matches."},
                "contextAfter": {"type": "number", "description": "Sibling top-level blocks after scoped matches."},
                "accountId": {"type": "string", "description": "Optional Altselfs connection id."},
                "accountEmail": {"type": "string", "description": "Optional Feishu display name/external id. Alternative to accountId."},
            },
            "required": ["doc"],
            "additionalProperties": False,
        },
        "deferLoading": False,
    },
]


_ALTSELFS_COMPETITOR_TOOL_ALIASES = {
    "similarweb_api1": "altselfs_similarweb_api1",
    "similarweb-api1": "altselfs_similarweb_api1",
    "altselfs_similarweb_api1": "altselfs_similarweb_api1",
    "semrush13": "altselfs_semrush13",
    "altselfs_semrush13": "altselfs_semrush13",
    "semrush8": "altselfs_semrush8",
    "altselfs_semrush8": "altselfs_semrush8",
    "domain_metrics_check": "altselfs_domain_metrics_check",
    "domain-metrics-check": "altselfs_domain_metrics_check",
    "altselfs_domain_metrics_check": "altselfs_domain_metrics_check",
}


def _altselfs_enabled_competitor_tool_names() -> set[str]:
    configured = os.environ.get("ALTSELFS_CODEX_COMPETITOR_DYNAMIC_TOOLS", "false").strip().lower()
    if configured in {"1", "true", "yes", "on"}:
        return {tool["name"] for tool in _ALTSELFS_COMPETITOR_TOOLS}
    if configured in {"", "0", "false", "no", "off"}:
        return set()
    enabled: set[str] = set()
    for raw_name in configured.split(","):
        name = raw_name.strip().lower()
        if not name:
            continue
        tool_name = _ALTSELFS_COMPETITOR_TOOL_ALIASES.get(name)
        if tool_name:
            enabled.add(tool_name)
    return enabled


def _altselfs_enabled_personal_data_tool_names() -> set[str]:
    configured = os.environ.get("ALTSELFS_CODEX_PERSONAL_DATA_DYNAMIC_TOOLS", "").strip()
    if not configured:
        return set()
    available = {tool["name"] for tool in _ALTSELFS_PERSONAL_DATA_TOOLS}
    enabled: set[str] = set()
    for raw_name in configured.split(","):
        name = raw_name.strip()
        if name in available:
            enabled.add(name)
    return enabled


def _altselfs_dynamic_tools() -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = []
    web_enabled = os.environ.get("ALTSELFS_CODEX_WEB_SEARCH_DYNAMIC_TOOL", "true").lower()
    if web_enabled not in {"0", "false", "no", "off"}:
        tools.append(_ALTSELFS_WEB_SEARCH_TOOL)
    artifact_enabled = os.environ.get("ALTSELFS_CODEX_READ_ARTIFACT_DYNAMIC_TOOL", "true").lower()
    if artifact_enabled not in {"0", "false", "no", "off"}:
        tools.append(_ALTSELFS_READ_ARTIFACT_TOOL)
    sandbox_enabled = os.environ.get("ALTSELFS_CODEX_SANDBOX_EXEC_DYNAMIC_TOOL", "false").lower()
    if sandbox_enabled not in {"0", "false", "no", "off"}:
        tools.append(_ALTSELFS_SANDBOX_EXEC_TOOL)
    enabled_competitor_tools = _altselfs_enabled_competitor_tool_names()
    if enabled_competitor_tools:
        tools.extend([tool for tool in _ALTSELFS_COMPETITOR_TOOLS if tool["name"] in enabled_competitor_tools])
    enabled_personal_data_tools = _altselfs_enabled_personal_data_tool_names()
    if enabled_personal_data_tools:
        tools.extend([tool for tool in _ALTSELFS_PERSONAL_DATA_TOOLS if tool["name"] in enabled_personal_data_tools])
    return tools


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


def _call_altselfs_read_artifact_tool_bridge(arguments: Any) -> dict[str, Any]:
    bridge_url = os.environ.get(
        "ALTSELFS_READ_ARTIFACT_BRIDGE_URL",
        "http://127.0.0.1:8787/internal/tools/read-artifact",
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


def _call_altselfs_sandbox_exec_tool_bridge(arguments: Any) -> dict[str, Any]:
    bridge_url = os.environ.get(
        "ALTSELFS_SANDBOX_EXEC_BRIDGE_URL",
        "http://127.0.0.1:8787/internal/tools/sandbox-exec",
    )
    payload = arguments if isinstance(arguments, dict) else {}
    payload = {
        **payload,
        "_context": {
            "runId": os.environ.get("ALTSELFS_RUN_ID", ""),
            "userId": os.environ.get("ALTSELFS_USER_ID", ""),
            "threadId": os.environ.get("ALTSELFS_THREAD_ID", ""),
            "workspace": os.environ.get("ALTSELFS_WORKSPACE", ""),
        },
    }
    request = urllib.request.Request(
        bridge_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=130) as response:
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


def _call_altselfs_competitor_tool_bridge(tool: str, arguments: Any) -> dict[str, Any]:
    bridge_url = os.environ.get(
        "ALTSELFS_RAPIDAPI_COMPETITOR_BRIDGE_URL",
        "http://127.0.0.1:8787/internal/tools/rapidapi-competitor",
    )
    payload = {
        "toolName": tool,
        "arguments": arguments if isinstance(arguments, dict) else {},
    }
    request = urllib.request.Request(
        bridge_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
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


def _call_altselfs_personal_data_tool_bridge(tool: str, arguments: Any) -> dict[str, Any]:
    bridge_url = os.environ.get(
        "ALTSELFS_PERSONAL_DATA_BRIDGE_URL",
        "http://127.0.0.1:8787/internal/tools/personal-data",
    )
    payload = {
        "toolName": tool,
        "arguments": arguments if isinstance(arguments, dict) else {},
        "_context": {
            "runId": os.environ.get("ALTSELFS_RUN_ID", ""),
            "userId": os.environ.get("ALTSELFS_USER_ID", ""),
            "investorId": os.environ.get("ALTSELFS_INVESTOR_ID", ""),
            "threadId": os.environ.get("ALTSELFS_THREAD_ID", ""),
        },
    }
    request = urllib.request.Request(
        bridge_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
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
const helpersEndAnchor = `# Permission profile mapping mirrors the docstring in PR proposal:`;

if (
  codexAppServerSession.includes(dynamictoolHelpersMarker) &&
  codexAppServerSession.includes("_call_altselfs_personal_data_tool_bridge") &&
  codexAppServerSession.includes("altselfs_feishu_lark_cli")
) {
  console.log("Hermes Codex dynamic tool helper patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (codexAppServerSession.includes(dynamictoolHelpersMarker)) {
  const helperStart = codexAppServerSession.indexOf("_ALTSELFS_WEB_SEARCH_TOOL = {");
  const helperEnd = codexAppServerSession.indexOf(helpersEndAnchor);
  if (helperStart < 0 || helperEnd < 0 || helperEnd <= helperStart) {
    console.error("Could not find the Hermes Codex dynamic tool helper block to upgrade.");
    console.error(codexAppServerSessionPath);
    process.exit(1);
  }
  codexAppServerSession = `${codexAppServerSession.slice(0, helperStart)}${dynamictoolHelpers}${codexAppServerSession.slice(helperEnd)}`;
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool helper patch upgraded.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(helpersAnchor)) {
  console.error("Could not find the Hermes Codex app-server helper insertion point.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(helpersAnchor, `${helpersAnchor}${dynamictoolHelpers}`);
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
            params["dynamictools"] = dynamic_tools
        result = self._client.request("thread/start", params, timeout=15)
`;

const threadParamsBlockAfter = `        params: dict[str, Any] = {"cwd": self._cwd}
        dynamic_tools = _altselfs_dynamic_tools()
        if dynamic_tools:
            params["dynamictools"] = dynamic_tools
        if os.environ.get("ALTSELFS_CODEX_DISABLE_LOCAL_ENVIRONMENT", "false").lower() in {"1", "true", "yes", "on"}:
            params["environments"] = []
        developer_instructions = os.environ.get("ALTSELFS_CODEX_DEVELOPER_INSTRUCTIONS", "").strip()
        if developer_instructions:
            params["developerInstructions"] = developer_instructions
        personality = os.environ.get("ALTSELFS_CODEX_PERSONALITY", "pragmatic").strip()
        if personality:
            params["personality"] = personality
`;

const threadParamsAfter = `${threadParamsBlockAfter}        result = self._client.request("thread/start", params, timeout=15)
`;

function hasCompleteThreadStartPatch(source) {
  return (
    source.includes('        dynamic_tools = _altselfs_dynamic_tools()') &&
    source.includes('            params["dynamictools"] = dynamic_tools') &&
    source.includes("ALTSELFS_CODEX_DISABLE_LOCAL_ENVIRONMENT") &&
    source.includes("ALTSELFS_CODEX_DEVELOPER_INSTRUCTIONS") &&
    source.includes("ALTSELFS_CODEX_PERSONALITY") &&
    source.includes('self._client.request("thread/start", params')
  );
}

function patchThreadStartParams(source) {
  const threadStartRequest = '        result = self._client.request("thread/start", params, timeout=15)\n';
  const requestIndex = source.indexOf(threadStartRequest);
  if (requestIndex < 0) {
    return null;
  }

  const prefix = source.slice(0, requestIndex);
  const paramsLineMatches = [...prefix.matchAll(/\n        params(?:: dict\[str, Any\])? = \{"cwd": self\._cwd\}\n/g)];
  const paramsLineMatch = paramsLineMatches.at(-1);
  if (!paramsLineMatch || typeof paramsLineMatch.index !== "number") {
    return null;
  }

  const paramsStart = paramsLineMatch.index + 1;
  const instrumentationAnchors = [
    '        emit_altselfs_hermes_timing(\n            "codex_app_server.thread_start.start"',
    "        thread_start_started_at = time.monotonic()\n",
    "        try:\n",
  ];
  let blockEnd = requestIndex;
  for (const anchor of instrumentationAnchors) {
    const anchorIndex = source.indexOf(anchor, paramsStart);
    if (anchorIndex >= paramsStart && anchorIndex < blockEnd) {
      blockEnd = anchorIndex;
    }
  }

  return `${source.slice(0, paramsStart)}${threadParamsBlockAfter}${source.slice(blockEnd)}`;
}

if (hasCompleteThreadStartPatch(codexAppServerSession)) {
  console.log("Hermes Codex dynamic tool registration patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (codexAppServerSession.includes(threadParamsPreviousPatch)) {
  codexAppServerSession = codexAppServerSession.replace(threadParamsPreviousPatch, threadParamsAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool registration patch upgraded.");
  console.log(codexAppServerSessionPath);
} else if (codexAppServerSession.includes(threadParamsBefore)) {
  codexAppServerSession = codexAppServerSession.replace(threadParamsBefore, threadParamsAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool registration patch applied.");
  console.log(codexAppServerSessionPath);
} else {
  const patchedCodexAppServerSession = patchThreadStartParams(codexAppServerSession);
  if (!patchedCodexAppServerSession) {
    console.error("Could not find the Hermes Codex thread/start params block to patch.");
    console.error(codexAppServerSessionPath);
    process.exit(1);
  }
  codexAppServerSession = patchedCodexAppServerSession;
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

const dynamictoolMethodMarker = `    def _handle_dynamic_tool_call(self, rid: Any, params: dict) -> None:`;
const dynamictoolMethod = `    def _handle_dynamic_tool_call(self, rid: Any, params: dict) -> None:
        if self._client is None:
            return
        namespace = params.get("namespace") or ""
        tool = params.get("tool") or ""
        is_web_search = (
            (not namespace and tool == "altselfs_web_search")
            or (namespace == "altselfs" and tool == "web_search")
        )
        is_read_artifact = (
            (not namespace and tool == "altselfs_read_artifact")
            or (namespace == "altselfs" and tool == "read_artifact")
        )
        is_sandbox_exec = (
            (not namespace and tool == "altselfs_sandbox_exec")
            or (namespace == "altselfs" and tool == "sandbox_exec")
        )
        is_competitor = (
            not namespace
            and tool in {
                "altselfs_similarweb_api1",
                "altselfs_semrush13",
                "altselfs_semrush8",
                "altselfs_domain_metrics_check",
            }
        )
        is_personal_data = (
            not namespace
            and tool in {
                "altselfs_connected_accounts_list",
                "altselfs_gmail_search_messages",
                "altselfs_gmail_get_message",
                "altselfs_gmail_get_thread",
                "altselfs_feishu_lark_cli",
                "altselfs_feishu_list_chats",
                "altselfs_feishu_list_messages",
                "altselfs_feishu_recent_messages",
                "altselfs_feishu_search_messages",
                "altselfs_feishu_search_users",
                "altselfs_feishu_today_calendar",
                "altselfs_feishu_search_docs",
                "altselfs_feishu_fetch_doc",
            }
        )
        if not is_web_search and not is_read_artifact and not is_sandbox_exec and not is_competitor and not is_personal_data:
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
            if is_read_artifact:
                result = _call_altselfs_read_artifact_tool_bridge(params.get("arguments") or {})
            elif is_sandbox_exec:
                result = _call_altselfs_sandbox_exec_tool_bridge(params.get("arguments") or {})
            elif is_competitor:
                result = _call_altselfs_competitor_tool_bridge(tool, params.get("arguments") or {})
            elif is_personal_data:
                result = _call_altselfs_personal_data_tool_bridge(tool, params.get("arguments") or {})
            else:
                result = _call_altselfs_tool_bridge(params.get("arguments") or {})
            self._client.respond(rid, result)
        except Exception as exc:
            logger.exception("Altselfs dynamic tool failed")
            self._client.respond(
                rid,
                {
                    "contentItems": [
                        {
                            "type": "inputText",
                            "text": f"Altselfs dynamic tool failed: {exc}",
                        }
                    ],
                    "success": False,
                },
            )

`;

const dynamictoolMethodAnchor = `    def _decide_exec_approval(self, params: dict) -> str:
`;

if (
  codexAppServerSession.includes(dynamictoolMethodMarker) &&
  codexAppServerSession.includes("is_personal_data = (") &&
  codexAppServerSession.includes("altselfs_feishu_lark_cli")
) {
  console.log("Hermes Codex dynamic tool handler patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (codexAppServerSession.includes(dynamictoolMethodMarker)) {
  const methodStart = codexAppServerSession.indexOf(dynamictoolMethodMarker);
  const methodEnd = codexAppServerSession.indexOf(dynamictoolMethodAnchor);
  if (methodStart < 0 || methodEnd < 0 || methodEnd <= methodStart) {
    console.error("Could not find the Hermes Codex dynamic tool handler block to upgrade.");
    console.error(codexAppServerSessionPath);
    process.exit(1);
  }
  codexAppServerSession = `${codexAppServerSession.slice(0, methodStart)}${dynamictoolMethod}${codexAppServerSession.slice(methodEnd)}`;
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool handler patch upgraded.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(dynamictoolMethodAnchor)) {
  console.error("Could not find the Hermes Codex dynamic tool handler insertion point.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(dynamictoolMethodAnchor, `${dynamictoolMethod}${dynamictoolMethodAnchor}`);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex dynamic tool handler patch applied.");
  console.log(codexAppServerSessionPath);
}

codexAppServerSession = readFileSync(codexAppServerSessionPath, "utf8");

const posttoolQuietTimeoutBefore = `        post_tool_quiet_timeout: float = 90.0,
`;

const posttoolQuietTimeoutAfter = `        post_tool_quiet_timeout: float = 300.0,
`;

if (codexAppServerSession.includes(posttoolQuietTimeoutAfter)) {
  console.log("Hermes Codex post-tool quiet timeout patch already applied.");
  console.log(codexAppServerSessionPath);
} else if (!codexAppServerSession.includes(posttoolQuietTimeoutBefore)) {
  console.error("Could not find the Hermes Codex post-tool quiet timeout default to patch.");
  console.error(codexAppServerSessionPath);
  process.exit(1);
} else {
  codexAppServerSession = codexAppServerSession.replace(posttoolQuietTimeoutBefore, posttoolQuietTimeoutAfter);
  writeFileSync(codexAppServerSessionPath, codexAppServerSession, "utf8");
  console.log("Hermes Codex post-tool quiet timeout patch applied.");
  console.log(codexAppServerSessionPath);
}
