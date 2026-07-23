# Credits and billing

## Commercial model

- `1 USD = 1,000 credits`.
- Direct metered model cost is converted at `2x` to cover infrastructure, failed work, support, and margin.
- Codex currently runs through the shared ChatGPT Pro entitlement, so its token usage is converted through a configurable internal usage-credit proxy.
- Storage is not billed in the first release.

| Plan | Monthly price | Included credits | Concurrent tasks | Scheduled tasks |
| --- | ---: | ---: | ---: | ---: |
| Free | $0 | 1,000 welcome credits | 1 | 0 |
| Starter | $20 | 20,000 | 3 | 5 |
| Pro | $40 | 40,000 | 10 | 20 |
| Scale | $200 | 200,000 | 20 | 20 |

Payment checkout, recurring grants, and plan changes remain disabled until a payment provider is connected.

## Task lifecycle

1. **Submit**: the authenticated Next.js API stores the visible user message as `AUTHORIZING` and forwards the request. It never reads or mutates the ledger directly.
2. **Authorize**: `personal-agent-server` opens a serializable transaction in the Supabase billing database, checks the subscription, same-thread lock, plan concurrency, and available Credits, then creates one hold per stable `runId`.
3. **Queue**: only an authorized task is written to Alibaba Cloud RDS as `QUEUED` and added to the Hermes/Codex conversation context.
4. **Execute**: the personal-agent worker claims the RDS task and runs Hermes and any Codex tasks.
5. **Measure**:
   - Hermes usage is read from the native `state.db` session counters.
   - Codex usage is read from native JSONL `token_count` events for the current run.
6. **Capture**: successful runs atomically release the hold and debit measured credits in Supabase. A final action may create a negative balance.
7. **Release**: failed, cancelled, or timed-out runs release the hold without a charge. Admission rejections never create a hold.
8. **Reconcile**: terminal RDS runs create `agent_billing_outbox` events. Workers claim events with `FOR UPDATE SKIP LOCKED` and retry Supabase settlement with exponential backoff. A 24-hour terminal-run scan recreates events missed by a process crash.

Every state transition is idempotent. A repeated request with the same `runId` cannot reserve or charge twice.

## Accounting records

- `credit_accounts`: materialized balance and reserved amount for low-latency checks.
- `credit_subscriptions`: current plan and billing period.
- `credit_reservations`: per-run authorization and settlement status.
- `credit_ledger_entries`: immutable balance and reservation movements.
- `agent_usage_records`: measured Hermes/Codex usage and the pricing version used.

`availableCredits = balanceCredits - reservedCredits`.

The ledger is the audit source. Materialized account totals can be rebuilt and reconciled from it.

The `20260723150000_backfill_welcome_credits` migration gives every existing
product user the same 1,000-Credit welcome grant as a new user. The
`welcome:{investorId}` ledger idempotency key prevents duplicate grants.

## Configuration

Personal-agent server and workers:

```dotenv
AGENT_CONTEXT_DATABASE_URL=postgres://... # Alibaba Cloud RDS queue/runtime
BILLING_DATABASE_URL=postgres://...       # Supabase Credits ledger
AGENT_DIRECT_TURN_EXECUTION_ENABLED=false
CREDITS_ENFORCEMENT_MODE=observe
CREDITS_WELCOME_GRANT=1000
CREDITS_CONCURRENCY_HOLD=50
CREDITS_RESERVATION_TTL_MINUTES=120
AGENT_TURN_MAX_PER_USER=20
AGENT_TURN_MAX_PER_THREAD=1
AGENT_TURN_CANCEL_POLL_MS=1500
CREDITS_PER_USD=1000
CREDITS_COST_MARKUP=2
CREDITS_MINIMUM_RUN_CHARGE=5
CODEX_USAGE_UNCACHED_INPUT_RATE=125
CODEX_USAGE_CACHED_INPUT_RATE=12.5
CODEX_USAGE_OUTPUT_RATE=750
CODEX_USAGE_CREDIT_MULTIPLIER=7.5
```

`AGENT_TURN_MAX_PER_USER` is only a deployment capacity ceiling. Subscription limits (Free 1, Starter 3, Pro 10, Scale 20) are enforced by the Supabase authorization transaction before RDS queue insertion. `AGENT_TURN_MAX_PER_THREAD=1` must remain enabled because one Hermes/Codex session cannot safely execute two turns concurrently.

At task submission, `personal-agent-server` reserves one plan concurrency slot for every queued or running task. In enforcement mode it also requires and holds the full configured concurrency amount. The frontend displays a non-authoritative capacity snapshot but always submits to ECS for the decision.

Supabase is the only Credits system of record. Alibaba Cloud RDS contains task queue/runtime state plus billing delivery events; Vercel contains no ledger mutation logic. The RDS outbox is not a second ledger and stores only the terminal action and usage envelope required to reach Supabase.

The API tier is stateless for product traffic. A stop request sets `cancel_requested` in RDS; the Worker that owns the Hermes/Codex child process discovers the flag through one batched poll and terminates it locally. Queued tasks are cancelled directly in RDS. This works unchanged when API and Worker roles share one ECS or run on separate ECS groups.

`AGENT_PROCESS_ROLE=all` keeps the current single-ECS deployment. With `AGENT_PROCESS_ROLE=worker`, the process exposes its Hermes provider proxy and tool bridge only on `127.0.0.1`; product API traffic remains on API-role instances.

## Enforcement rollout

`CREDITS_ENFORCEMENT_MODE=observe` records projected consumption without deducting or blocking. This is the default until checkout and credit purchases are available.

`CREDITS_ENFORCEMENT_MODE=enforce` requires at least `CREDITS_CONCURRENCY_HOLD` available Credits, places that hold, and charges measured usage at completion. The final action may make the balance negative. New tasks are blocked until the configured hold can be authorized again.

Recommended rollout:

1. Run in `observe` and compare projected charges with provider invoices.
2. Adjust the Codex proxy multiplier, model rates, and concurrency hold.
3. Add payment-provider webhooks and monthly grant idempotency.
4. Enable `enforce` for internal accounts, then production accounts.

## Payment-provider integration

Before commercial launch, add:

- signed checkout and customer-portal sessions;
- idempotent webhook ingestion;
- monthly `PLAN_GRANT` entries keyed by provider invoice ID;
- `PURCHASE` entries for top-ups;
- expiring grant lots consumed FIFO when plans require expiration;
- reconciliation for provider invoices, ledger totals, and account materializations.

Provider secrets must remain in server-side deployment secrets. They must never be embedded in Docker images or browser bundles.
