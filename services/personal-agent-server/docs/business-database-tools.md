# Built-in Business Database tools

`search_businesses`, `get_business_details`, and `get_business_metrics` are always
registered in the Hermes→Codex bridge, independently of connector selection.
The existing dynamic-tool schema comparison handles resumed Codex sessions.

## Configuration files

- Production secret: `/opt/altselfs/personal-agent-server-docker/.env.production` on ECS.
- Versioned template: `services/personal-agent-server/env.production.example`.
- Development template: `services/personal-agent-server/.env.example`.

The Docker Compose definitions already load `.env.production` through `env_file`.
After changing the secret, recreate the agent containers through the existing
blue-green deployment flow; restarting a container alone does not reload its
environment. Keep database passwords out of Git and the Next.js frontend.

## Deployment

1. Run `node --import tsx scripts/initialize-market-intelligence.ts` from this service using
   the existing migration/admin connection (`AGENT_CONTEXT_DATABASE_URL` or
   `DATABASE_URL`). Schema initialization no longer happens during page reads.
2. By default reuse `AGENT_CONTEXT_DATABASE_URL`, falling back to `DATABASE_URL`.
   No new account or environment secret is required for the first version.
   `BUSINESS_DATABASE_READONLY_URL` remains an optional explicit override for a
   dedicated reader account in the future.
3. The tool handler creates its own pool with read-only sessions; every call
   begins `READ ONLY` and verifies `SHOW transaction_read_only` is `on` before
   issuing fixed, parameterized SELECT queries. It never accepts raw SQL.
   The existing importer pool and account defaults are not changed.
4. Deploy frontend and service together. Validate all three tools with every
   connector deselected, and verify a write attempt within a read-only
   transaction is rejected with PostgreSQL code `25006`.

The reused account itself retains write privileges for the existing import
pipeline. The read-only guarantee applies to this tool execution path, not to
other uses of that account. A dedicated reader remains an optional extra layer.
Database URLs stay in the host handler and are stripped from the Codex child
environment. No initialization, refresh, import, or write is performed by any
tool. Queries have a 10-second statement timeout and 5-second connection timeout.

## Selection handoff

The page stores up to 50 IDs/names, selection time and optional filter/sort scope
in tab-local sessionStorage and opens `/app?newDiscussion=1&businessSelection=1`.
The query string is only a draft-entry flag; it contains no records or metrics.
The draft shows a removable selection with company names. Sending posts the
structured selection with the message. The authenticated API validates it,
records it in message metadata, appends a human-readable selection to the saved
message and includes the exact IDs in the Hermes user turn. Hermes forwards
these to Codex. Follow-up turns retain the IDs in Hermes conversation history.

Filtered analysis re-queries the first 50 IDs with the currently applied filters;
matching total and truncation are shown. IDs are fixed, metrics are fetched later.
Selection survives page changes; applying/resetting filters clears it. Drafts
are not automatically sent. A successful start consumes the stored selection.

## Validation

Run `node --import tsx --test tests/business-database.test.ts` for validation, read-only
transaction, real-data filtering and selection handoff contract tests.
Live verification should execute all three tools and check transaction-level
write rejection against the configured database; unit checks alone do not
verify production reachability.


### Live verification (2026-09-15)

Ran the compiled tool modules from a temporary directory inside the Singapore
ECS agent container, using its existing context-database connection. Search
returned 2 real products, details returned both products, and monthly metrics
returned 4 observations. A zero-row UPDATE inside the same read-only transaction
wrapper was rejected with PostgreSQL `25006`. A separate ordinary connection
remained read-write (`transaction_read_only=off`), so importer defaults were not
changed. Temporary verification files were removed. This verifies the tools
against RDS; it does not deploy the updated service or frontend.
