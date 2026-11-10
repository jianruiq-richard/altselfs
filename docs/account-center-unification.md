# Unified account center

All billing/account navigation uses `/account` on minaco.ai. Tabs are `overview`, `plan`, `usage`, `billing`, and `rates`; URL navigation preserves browser history. Authentication preserves the selected tab, filters and plan/cycle. Signup keeps the existing install guide default. The signed-in homepage stays available, and the Web Agent retains its explicit `/app` entry.

Plan selection and credit packs use existing backend billing actions and hosted confirmations. Cancellation intent opens an inline review; visiting the URL never cancels a subscription. Stripe returns to the account center. Legacy `/profile` and `/app/settings?view=plan` are compatible redirects. Client links open account overview, usage and subscription separately, without carrying credentials.

Usage filters are applied server-side before cursor pagination, scoped to the authenticated investor. The monthly summary covers all products in UTC. Payments and balance changes have independent paginated views; balance changes are another representation of ledger activity, not additional charges. Missing history is an error, not an empty list. Refresh reloads both account and usage data. No pricing formulas, settlement or credential protocols changed.

Design follows Impeccable 4.8.2 Operate guidance while retaining Minaco's warm dark palette. Mobile keeps Credits visible and exposes the active email and account switching.

## Validation

- `node --import tsx --test src/lib/account-navigation.test.ts src/lib/auth-destination.test.ts src/lib/homepage-redirect.test.ts src/lib/landing/render.test.ts`
- Personal-agent billing activity and Stripe regression tests; both Next and personal-agent TypeScript/build checks.
- `node scripts/verify-account-center.mjs`: real account components with isolated Clerk/API fixtures, desktop and 390px mobile, refresh/filter/pagination, explicit cancellation, error recovery and login continuation. Does not perform live payments or real account sign-in.
- PostgreSQL-compatible engine validation: account isolation, 45-row pagination, dates, model/Agent filters, malicious filter values, payment pagination and separate grants.

Deployment evidence and release IDs follow after publication.

## Production 2026-11-10

- Source includes remote onboarding commits `79ba0618` and `23ee6f43`; account change `6e5e9f60`, deployment exclusions `0e31925c`.
- Vercel production `dpl_ES2Q7EWwGFiAVNRGkNrwYEvTrFWC`, aliased to minaco.ai.
- ECS account backend `minaco-account:6e5e9f60`, blue active; prior green drained/stopped. Incremental image replaces only credit-admission/http-server/stripe-billing modules over the existing pinned runtime. Existing provider/concurrency settings, Skills, desktop API and inference gateway remain unchanged.
- Production read-only queries verified usage/monthly summary/payment history and empty results for a nonexistent account. Public account/pricing/download/connect routes return 200, legacy billing routes redirect correctly, unauthenticated billing history returns 401.
- No real purchase, renewal cancellation or new-account sign-in was performed.

## Navigation follow-up — 2026-11-10

Account sections now use ordinary links with explicit `view` destinations, so navigation has browser-native behavior instead of depending on a JavaScript-only button/router transition. Billing dates and numeric allowances explicitly use English formatting, including under a Chinese browser locale. User-provided names and conversation titles are not translated.

The reported no-op click was not reproduced in isolated components or a real Next.js router with fixture authentication/API data; the exact live-session cause remains unconfirmed. Regression coverage now clicks every section, and a real-router check verified refresh and browser back. Twelve isolated UI checks, ten routing/auth tests and TypeScript checks passed. No API, billing calculation or desktop changes are needed.
