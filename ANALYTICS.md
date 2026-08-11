# GA4 product analytics

Minaco sends browser interaction events with `gtag.js` and confirms revenue/refunds from Stripe webhooks with GA4 Measurement Protocol. Message text, email addresses, phone numbers, Clerk IDs, Stripe customer IDs, and agent/run IDs are not sent to GA4.

## Configuration

Create one GA4 web data stream. Configure the Next.js deployment with:

```dotenv
NEXT_PUBLIC_GA4_MEASUREMENT_ID=G-XXXXXXXXXX
NEXT_PUBLIC_GA4_ANALYTICS_STORAGE=granted
NEXT_PUBLIC_GA4_DEBUG=false
```

Create a Measurement Protocol API secret for that same data stream and configure `personal-agent-server` with:

```dotenv
GA4_MEASUREMENT_ID=G-XXXXXXXXXX
GA4_API_SECRET=your-server-only-secret
```

Do not expose `GA4_API_SECRET` to the browser. With no Measurement ID, analytics is a no-op. `NEXT_PUBLIC_GA4_ANALYTICS_STORAGE` defaults to `denied`; only set it to `granted` when the product's consent/privacy flow permits analytics collection.

## Event catalog

| Journey | Events | Primary parameters |
| --- | --- | --- |
| Acquisition | `page_view`, `cta_click` | `route_name`, `app_area`, `cta_id`, `cta_location`, `destination` |
| Authentication | `sign_up_start`, `sign_up`, `login_start`, `login`, `auth_error` | `method`, `auth_duration_ms`, `flow`, `stage`, `error_code` |
| Onboarding | `workspace_setup_complete`, `workspace_setup_error` | `restored_thread`, `error_code` |
| Activation | `message_send_attempt`, `message_sent`, `agent_response_complete`, `activation_complete`, `agent_run_error` | `is_first_message`, `prompt_source`, `latency_ms`, `model_tier`, `error_stage`, `error_code` |
| Monetization | `view_item_list`, `select_item`, `begin_checkout`, `checkout_error`, `purchase`, `refund` | `plan_key`, `billing_cycle`, `purchase_type`, `currency`, `value`, `transaction_id`, `items` |

`purchase` and `refund` are emitted by the billing service after Stripe/ledger processing. This makes them authoritative and avoids counting users who merely reached a success URL. Transaction IDs are used for GA4 purchase deduplication.

## GA4 setup

1. In **Admin → Data display → Events**, mark `sign_up`, `activation_complete`, and `purchase` as key events.
2. In **Admin → Data display → Custom definitions**, register the event-scoped dimensions you need in reports: `route_name`, `app_area`, `cta_id`, `cta_location`, `destination`, `method`, `flow`, `stage`, `error_stage`, `error_code`, `restored_thread`, `is_first_message`, `prompt_source`, `model_tier`, `plan_key`, `billing_cycle`, `purchase_type`, and `pack_key`. Register `auth_duration_ms`, `latency_ms`, and `first_response_latency_ms` as custom metrics if you want aggregated timings.
3. In **Explore → Funnel exploration**, create funnels such as:
   - Visitor activation: `page_view` → `sign_up_start` → `sign_up` → `workspace_setup_complete` → `activation_complete`
   - Existing-user activation: `login` → `message_sent` → `agent_response_complete`
   - Paid conversion: `view_item_list` → `select_item` → `begin_checkout` → `purchase`
4. Use DebugView with `NEXT_PUBLIC_GA4_DEBUG=true` in a non-production environment, then turn it off after validation.
5. Optionally link BigQuery before launch if raw event analysis and long-term retention are important.

Keep event names and parameter meanings stable. Add a new parameter or increment the `schema_version` before changing an existing definition.
