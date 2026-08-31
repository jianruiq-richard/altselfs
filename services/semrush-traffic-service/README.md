# Semrush Traffic Destinations service

This sidecar exposes one narrow operation to the Altselfs Codex runtime:

```http
POST /v1/payment-destinations
Authorization: Bearer $SEMRUSH_SERVICE_TOKEN
Content-Type: application/json

{"domain":"tapnow.ai","months":6}
```

The production path uses the authorized Semrush web interface. It selects the
last six completed calendar months, opens **Traffic & Market → Sources &
Destinations → Destinations**, enforces a single target website, reads the
absolute **Visits** column, and returns monthly values plus
rolling six-, three-, and one-month totals for destinations matched by the
explicit payment-platform domain registry.

The six-month browser path uses a speed-first scan: it reads only the first
destination-table page for each month. If that page has no registered payment
platform, the month is reported as zero. Payment destinations that appear only
on later pages are intentionally omitted. A month that fails to render because
of a transient 3ue load issue is retried once in a fresh tab.

It deliberately does not call an undocumented private endpoint. Browser actions
are serialized at the request level because they share one persistent Chrome
profile and active node-specific Semrush list. Within one six-month request,
independent month tabs use bounded concurrency.

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

For a one-time login or renewed session on ECS:

```bash
ssh -L 6080:127.0.0.1:6080 root@YOUR_ECS_HOST
```

Open `http://127.0.0.1:6080/vnc.html`, sign in at the 3ue dashboard, open
Semrush, and navigate once to Sources & Destinations. The Compose files bind
noVNC to ECS loopback only. Do not expose port 6080, Chrome CDP, or
`/data/semrush-traffic` to the public internet.

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
- `SEMRUSH_QUEUE_MAX_WAITING` (default `3`; one request runs and at most three wait; additional requests receive HTTP `429`)
- `SEMRUSH_BROWSER_TIMEOUT_MS` (default `90000`)
- `SEMRUSH_BROWSER_HEADLESS` (keep `false` for the managed ECS browser)
- `SEMRUSH_BROWSER_CLEAR_STALE_LOCKS` (default `true`; run only one worker per profile)

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
Six-month responses query each completed month separately. Legacy three-month
range-mode responses intentionally return `monthly: null`: the UI supplies one
range total, so the service does not invent per-month values.
