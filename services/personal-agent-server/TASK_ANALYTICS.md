# First-task conversion events

- `first_task_submitted`: the user's first personal-agent task accepted after
  credit authorization and input persistence. Button clicks and rejected requests
  do not count.
- `first_task_completed`: the user's first run persisted as `SUCCESS`. An earlier
  failed, cancelled or timed-out run does not prevent this event.

Both events use the backend user ID and a PostgreSQL unique key on
`(investor_id, event_name)` in `agent_task_milestones`. This works across devices,
threads and request retries. Existing run history is checked to avoid counting
established users as newly activated when this code is deployed. Completion is
reported by the worker even if the browser is closed.

The browser supplies GA4 client/session context with its task request. Only the
normalized context and `task_type=personal_agent` are sent to GA4, never task text,
attachments or email. Existing `message_sent`, `agent_response_complete` and
`activation_complete` events remain unchanged.

## Deployment and validation

Deploy both the Next.js app and personal-agent server. The server's existing
schema initialization creates the milestone table automatically. Sending requires
the existing GA4 configuration (`NEXT_PUBLIC_GA4_MEASUREMENT_ID`, matching server
`GA4_MEASUREMENT_ID`, and server `GA4_API_SECRET`), client ID and granted analytics
consent. The Cookie preferences UI collects the visitor choice and updates both GA4 and Clarity.

With a new test user and consent, accept a task, then complete it successfully.
Verify one of each event in GA4, then repeat from another thread/device and verify
no additional first-task events. Also verify that a rejected request produces no
submission event, and that failure followed by success produces one completion.
Backend unit tests do not substitute for this live GA4/PostgreSQL check.

## Delivery and consent

Milestones are written to a PostgreSQL outbox. The active task worker checks it
on a separate 15-second timer, so network requests do not delay task acceptance.
Successful deliveries are marked SENT. Transient failures use exponential
backoff, capped at one hour; retries stop when the original event is 70 hours old.
A lease and `FOR UPDATE SKIP LOCKED` prevent two workers from sending the same
pending row concurrently. Original timestamps are preserved. As with any HTTP
retry, an ambiguous timeout after Google accepted a request can still duplicate
an event; the stable event ID is for diagnosis, not a guarantee of GA4 deduplication.

Events without analytics consent/client ID are SKIPPED and not replayed later.
Existing records from the previous one-shot implementation remain LEGACY and
are not resent. Missing server configuration leaves pending events queued.
The browser's Cookie preferences supplies analytics and advertising-measurement
choices; legacy deployment-wide consent variables are no longer used.
Ad personalization remains disabled. Do not select both the legacy activation
and new completion events as primary conversions for the same goal.

An opt-in PostgreSQL test uses connection-local temporary tables and a rolled
back transaction: `TASK_ANALYTICS_POSTGRES_TEST=1 node --import tsx --test
tests/task-analytics.postgres.test.mjs` (requires AGENT_CONTEXT_DATABASE_URL).
