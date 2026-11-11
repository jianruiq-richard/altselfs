# Minaco web / desktop conversion measurement

Status: prepared for coordinated production deployment with Minaco Desktop 0.13.15. No Google Ads account settings changed.

## Ownership and deployment order

1. Apply the altselfs migration `20261111120000_analytics_attribution_outbox` to the existing shared account/billing database **before** deploying either API. This creates `account_attribution` and `conversion_analytics_outbox`; it does not replay historical payments.
2. Deploy altselfs web + personal-agent API/worker, then minaco-desktop API. The worker polls the shared **billing** database every 15 seconds alongside the existing task analytics worker. At least one active worker with `AGENT_CONTEXT_DATABASE_URL`, `BILLING_DATABASE_URL`, `GA4_MEASUREMENT_ID`, and `GA4_API_SECRET` is required. Website needs `NEXT_PUBLIC_GA4_MEASUREMENT_ID` for the SAME web stream.
3. Release the desktop only after the new API is available. All pending local events retry against older/unavailable APIs; no login/send waits for analytics.
4. Verify GA4 receipt and then link/import desired events in Google Ads. This code sends GA4 Measurement Protocol events, not direct Ads/Data Manager conversions. No enhanced-conversion email upload is implemented. Ads auto-tagging, account linking, conversion goals/windows and consent configuration still require dashboard verification.

## Events

- Homepage: one `page_view`, `download_click`, `sign_up_click`, `plan_click`. Download click is not installation.
- Existing website `sign_up` remains account creation; desktop login is NOT another registration.
- `desktop_activated`: first successful authenticated entry into a ready desktop shell per account, from versions including this code. This is not historical proof of a first-ever installation.
- `desktop_first_message_sent`: first composer submission accepted by the local Agent per account. Failed submissions do not count. It is not task/reply completion.
- `purchase` and `refund`: existing Stripe-confirmed financial events, now queued atomically with the credit/payment transaction. Subscription purchase types remain new/renewal/upgrade, and credit packs remain separate. `subscription_new` does not by itself mean first-ever paying customer.

For acquisition campaigns, configure appropriate paid conversion as primary, desktop milestones as secondary. Do not import the same purchase through two primary actions. GA4/Ads matching and bidding are not validated by local tests or a collector's HTTP 200.

## Shared schema contract

The desktop API authenticates its own bearer token and uses the mapped Minaco `users.id`. It writes only fixed milestone names into `conversion_analytics_outbox` using the existing shared account DB connection. It neither accepts a user ID/campaign/amount from the renderer nor sends Google secrets to desktop. `event_id = desktop:<account-id>:<event-name>` is unique across devices/reinstalls. The altselfs worker owns delivery. Desktop tests carry a contract SQL fixture; update it with this migration when changing the schema.

The browser stores only allowlisted campaign fields and timestamps (90 days) and binds them through an authenticated, same-origin POST. First touch is preserved, a later explicit campaign updates last touch, direct visits don't overwrite it. Stored browser attribution is restricted to its first bound account to avoid shared-browser cross-account contamination. A different explicit campaign starts a fresh browser binding; old-account touches are not copied to the next account. Sources without an account binding cannot be recovered after storage is cleared. Website consent defaults are unchanged by this work.

GA4 context is an opaque client/session ID, not an email/name. When a campaign is bound, its GA4 client ID is saved with the touch. With continuing advertising consent and a recent (60 day) campaign touch, conversions can use that campaign client even when the user returns in another browser; its old session is never reused. Otherwise the current browser wins, with a recent account client fallback if the SDK fails and analytics consent is granted. Campaign snapshots are kept server-side for audit/future Ads integrations; merely saving gclid in our DB does not upload it to Ads or guarantee cross-browser attribution. Arbitrary auth query strings are stripped from GA URLs.

## Delivery and privacy

- Payment transaction and outbox enqueue commit or roll back together. Google network failures never run inside the financial transaction.
- `PENDING`: eligible for delivery; exponential retry 15 seconds to 1 hour, original timestamp retained.
- `WAITING_CONTEXT`: event has no usable client identity yet (for example desktop activation before website binding). Recovered when a consented GA client context becomes available.
- `SENT`: Google collector accepted the HTTP request; not proof that Ads attributed it.
- `SKIPPED`: required analytics consent denied, or subsequent account consent withdrawal. Reason is retained.
- `EXPIRED`: older than 70 hours, before GA4's 72-hour backdating limit. Kept for audit; never falsify event time.
- Atomic worker leases prevent simultaneous claims and recover after worker crashes. Stable purchase transaction IDs support Google deduplication. Delivery is at-least-once: a network response lost after Google accepted it cannot provide an exactly-once guarantee for arbitrary milestone/refund events.
- Desktop stores only fixed names, account IDs, timestamps and acknowledgement flags. Client preferences gate new events and clear unsent pending events on opt-out. Web consent is rechecked at server delivery. No conversation, file, email, browser cookie, or raw browser profile is sent from desktop.
- Existing/older client versions cannot report these new milestones; rollout is not a historical backfill.

## Local verification

- `node --import tsx --test src/lib/analytics/*.test.ts src/lib/landing/render.test.ts`
- `node --import tsx scripts/verify-analytics-homepage.mjs` uses isolated Chrome and intercepts external vendor requests.
- `node --import tsx --test services/personal-agent-server/tests/payment-analytics.test.ts services/personal-agent-server/tests/google-analytics.test.ts services/personal-agent-server/tests/stripe-billing.test.ts`
- Embedded PostgreSQL integration: install `@electric-sql/pglite` in a temporary directory; set `ANALYTICS_PGLITE_MODULE` to its absolute `dist/index.js`, then run `node --import tsx --test services/personal-agent-server/tests/payment-analytics.postgres.test.ts`. No production DB URLs are read.
- The desktop repository tests its authenticated API, queue, consent and account-switch behavior separately.

Production dashboard receipt, real Stripe checkout, and Ads attribution remain release-time checks; no such live events were generated for these local tests.
