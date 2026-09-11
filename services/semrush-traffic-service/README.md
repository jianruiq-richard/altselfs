# Semrush Traffic Destinations service

This sidecar exposes one narrow operation to the Altselfs Codex runtime:

```http
POST /v1/payment-destinations
Authorization: Bearer $SEMRUSH_SERVICE_TOKEN
Content-Type: application/json

{"domain":"tapnow.ai","months":6}
```

To query one exact calendar month while keeping the first-page-only scan:

```http
POST /v1/payment-destinations
Authorization: Bearer $SEMRUSH_SERVICE_TOKEN
Content-Type: application/json

{"domain":"tapnow.ai","month":"2026-05"}
```

The production path uses the authorized Semrush web interface. It selects the
last six completed calendar months, opens **Traffic & Market → Sources &
Destinations → Destinations**, enforces a single target website, reads the
absolute **Visits** column, and returns monthly values plus
rolling six-, three-, and one-month totals for destinations matched by the
explicit payment-platform domain registry.

When `month` is supplied, it must use `YYYY-MM` format and must not be combined
with `months`. The response contains one `monthly` entry for that exact calendar
month. Rolling `last6Months`, `last3Months`, and `last1Month` fields are `null`
because an explicitly selected historical month is not a rolling latest-month
window. `paymentOutboundVisits` contains the selected month's total.

The six-month and exact-month browser paths use a speed-first scan: they read
only the first destination-table page for each month. If that page has no registered payment
platform, the month is reported as zero. Payment destinations that appear only
on later pages are intentionally omitted. A month that fails to render because
of a transient 3ue load issue is retried once in a fresh tab. If both attempts
fail, that month is marked unavailable and the worker continues through the
remaining older months. Failed months are returned as `null`, never as zero;
rolling totals that include a failed month are also `null`. If every requested
month fails, the request fails.

It deliberately does not call an undocumented private endpoint. Browser actions
are serialized at the request level because they share one persistent Chrome
profile and active node-specific Semrush list. Months within a request are read
sequentially from newest to oldest on one warmed report tab. The worker adds
20%-jittered pacing after product and month changes, between months and requests,
and before retries. Semrush load/frequency messages such as `Something went
wrong` use the longer rate-limit cooldown. Pacing waits are logged with a
`pacing stage=... delayMs=...` entry for production diagnosis.

Before a query opens the Semrush report, browser mode reads `API 今日配额` from
the active Semrush subscription card in the long-lived authenticated 3ue
dashboard tab. It polls the existing rendered dashboard first and reloads that
tab once only as a fallback when the live card or quota value does not appear.
The percentage is the amount used today: `100%` means no daily quota remains.
At or above `SEMRUSH_QUOTA_STOP_AT_USED_PERCENT`, the request receives HTTP 429
with code `DAILY_QUOTA_EXHAUSTED` without opening the Semrush report. If the
quota cannot be verified, the worker fails closed with HTTP 503. `GET /healthz`
exposes the most recent quota snapshot and `acceptingQueries`; authenticated
`GET /v1/quota` refreshes the dashboard snapshot without running a report.

## Worker pool

Production uses a fixed dispatcher endpoint and any number of browser workers:

- `SEMRUSH_ROLE=dispatcher` accepts the product request and queues it.
- `SEMRUSH_ROLE=pool-worker` actively connects to `SEMRUSH_DISPATCHER_URL`,
  registers by its unique `SEMRUSH_WORKER_ID`, sends quota/login heartbeats, and
  pulls one job at a time. A worker can run on the dispatcher ECS or another ECS;
  it does not need a public API, Chrome CDP, or VNC port.
- The dispatcher sends work only to fresh workers with `acceptingQueries=true`.
  A deterministic pre-query quota rejection can be reassigned to another account.
  `GET /v1/workers` and `GET /v1/quota` return the combined pool snapshot.

Every 3ue account must use a different persistent browser profile. Never mount
the same data directory into two workers. The current three-account Compose setup
uses `/data/semrush-traffic`, `/data/semrush-traffic-worker-2`, and
`/data/semrush-traffic-worker-3`, with loopback-only noVNC ports 6080-6082.

## Required browser setup

Use a dedicated browser profile for this worker. The 3ue node list is dynamic:
the worker verifies that the selected node is marked available, switches to a
compatible available node when necessary, and creates/reuses a single-domain
list inside that node. Semrush list IDs are node-specific, so do not configure a
fixed `lid` copied from another node.

`SEMRUSH_BROWSER_MANAGE_FILTERS=true` authorizes the worker to add the requested
domain and remove the previous target from the active list. The query fails
if any non-target domain remains, preventing comparison percentages from being
reported as absolute visit counts.

The container runs ordinary Chrome as a long-lived process, then attaches
Playwright over a loopback-only CDP socket. This is different from launching the
browser through Playwright and is required for the observed 3ue CacheClean flow.

For the one-time login of all three same-ECS workers:

```bash
ssh \
  -L 6080:127.0.0.1:6080 \
  -L 6081:127.0.0.1:6081 \
  -L 6082:127.0.0.1:6082 \
  root@YOUR_ECS_HOST
```

Open `http://127.0.0.1:6080/vnc.html`, `http://127.0.0.1:6081/vnc.html`, and
`http://127.0.0.1:6082/vnc.html`. Sign a different 3ue account into each browser,
open Semrush, and navigate once to Sources & Destinations. The Compose file binds
all noVNC ports to ECS loopback only. Do not expose noVNC, Chrome CDP, service
tokens, or the persistent profile directories to the public internet.

The persistent profile is stored under `/data/semrush-traffic`. If the provider
shows a CAPTCHA or requires new authentication, complete it manually; do not add
CAPTCHA bypass logic. Confirm that browser automation is permitted for the
subscribed account.

## Environment

- `PORT` (default `8791`)
- `SEMRUSH_SERVICE_TOKEN`
- `SEMRUSH_PROVIDER=browser`
- `SEMRUSH_BROWSER_REPORT_URL` (use the Sources & Destinations path without `lid`)
- `SEMRUSH_BROWSER_DASHBOARD_URL`
- `SEMRUSH_BROWSER_PROFILE_DIR` (default `/data/semrush-browser-profile`)
- `SEMRUSH_BROWSER_ARTIFACT_DIR` (default `/data/semrush-browser-artifacts`)
- `SEMRUSH_BROWSER_MANAGE_FILTERS` (enable only for the dedicated list)
- Monthly reports reuse one warmed browser tab and switch months through the date picker.
- `SEMRUSH_BROWSER_ACTION_DELAY_MS` (default `2500`; base product-change settling delay)
- `SEMRUSH_BROWSER_MONTH_SWITCH_DELAY_MS` (default `2500`; base post-month-switch settling delay)
- `SEMRUSH_BROWSER_MONTH_GAP_DELAY_MS` (default `4000`; base delay between monthly scans)
- `SEMRUSH_BROWSER_REQUEST_GAP_DELAY_MS` (default `6000`; base gap between queued website requests)
- `SEMRUSH_BROWSER_RETRY_DELAY_MS` (default `12000`; base delay before an ordinary retry)
- `SEMRUSH_BROWSER_RATE_LIMIT_DELAY_MS` (default `35000`; base delay before a frequency/load-error retry and before continuing after a repeated frequency/load error)
- `SEMRUSH_QUEUE_MAX_WAITING` (default `3`; one request runs and at most three wait; additional requests receive HTTP `429`)
- `SEMRUSH_BROWSER_TIMEOUT_MS` (default `90000`)
- `SEMRUSH_BROWSER_HEADLESS` (keep `false` for the managed ECS browser)
- `SEMRUSH_BROWSER_CLEAR_STALE_LOCKS` (default `true`; run only one worker per profile)
- `SEMRUSH_QUOTA_GUARD_ENABLED` (default `true`; verify 3ue quota before every query)
- `SEMRUSH_QUOTA_STOP_AT_USED_PERCENT` (default `100`; 3ue reports used percentage)
- `SEMRUSH_ROLE` (`standalone`, `dispatcher`, or `pool-worker`)
- `SEMRUSH_WORKER_ID` (required and unique for every pool worker)
- `SEMRUSH_DISPATCHER_URL` (required by pool workers)
- `SEMRUSH_DISPATCH_HEARTBEAT_STALE_MS` (default `90000`)
- `SEMRUSH_DISPATCH_JOB_TIMEOUT_MS` (default `900000`)
- `SEMRUSH_DISPATCH_MAX_QUEUED` (default `30`)
- `SEMRUSH_WORKER_HEARTBEAT_MS` (default `15000`)
- `SEMRUSH_WORKER_POLL_MS` (default `2000`)
- `SEMRUSH_WORKER_QUOTA_REFRESH_MS` (default `300000`)

The optional API provider remains available for tests or a future licensed API
deployment, but it is not used by the selected ECS configuration.

## Development and verification

```bash
npm install
npm run typecheck
npm test
npm run build
```

Real-account smoke tests are required after Semrush changes its rendered table.
Six-month responses query each completed month separately. Exact-month responses
query the requested calendar month separately and retain the same first-page-only
scan. Legacy three-month
range-mode responses intentionally return `monthly: null`: the UI supplies one
range total, so the service does not invent per-month values.
