---
name: estimate-competitor-monthly-revenue
description: Must use this instead of estimate-competitor-scale skill when user asks "I have a competitor. Help me estimate their revenue for last month.”.
---

# Estimate Competitor Monthly Revenue

Before starting any research, identify the target product.

## Collect evidence once, in parallel

For every revenue estimate where the product has a meaningful web domain, begin data collection with one parallel Codex batch that calls all four tools for the target: `altselfs_semrush_payment_destinations`, `altselfs_similarweb_api1`, `altselfs_semrush13`, and `altselfs_ahrefs_url_research`. Make these independent requests concurrently when the execution environment supports parallel tool calls. Request the complete traffic, geography, engagement, acquisition, search, backlink, and payment-destination evidence needed for the analysis in this initial batch, and do not call these tools again later in the same analysis. Wait for all four results before estimating revenue.

When all results are available, treat `altselfs_semrush_payment_destinations` as the primary revenue signal. It returns absolute outbound visits to recognized payment-platform domains for each of the last six completed calendar months, together with rolling six-, three-, and one-month totals; it also supports an exact `month` in YYYY-MM format instead of `months`. Use only the requested month's payment traffic, defaulting to the latest completed calendar month when none is specified. Earlier months may provide trend context, but never add their payment traffic or subscribers to the requested month or use a rolling total as one month's traffic. Use the other three results to establish total traffic, country distribution, acquisition and engagement context, product traction, and corroborating evidence.

Treat payment-platform outbound visits as observed purchase intent, not as successful transactions or unique buyers. Review the returned payment destinations and include all credible processors rather than using Stripe alone.

If `altselfs_semrush_payment_destinations` fails, is unavailable, or returns no usable payment traffic, state that outcome and fall back to the previous multi-tool estimation method using the `altselfs_similarweb_api1`, `altselfs_semrush13`, and `altselfs_ahrefs_url_research` results already collected in the initial parallel batch; do not repeat those calls. Use those results to look for observed outbound traffic to Stripe or other payment processors, a verified product-owned checkout hostname, total site traffic, country distribution, and relevant traffic trends. Use traffic to a dedicated checkout hostname as a checkout-visit proxy only after verifying that the hostname belongs exclusively to the target product. If neither payment destinations nor a dedicated checkout domain can be observed, estimate payment-bound traffic from total traffic using a product-specific purchase-intent ratio, adjusted for country mix, acquisition intent, pricing, and conversion flow. Clearly label the estimated payment traffic as inferred rather than observed and show the ratio used.

## Convert payment traffic into paying users

Use product knowledge and observable product attributes to choose assumptions instead of applying one universal conversion rate. Build the estimate in this order:

1. Convert payment-platform visits into unique checkout users by accounting for retries, multiple page loads, payment-method changes, account-management visits, and other duplicate behavior appropriate to the checkout flow.
2. Estimate successful paying users attributable to that month's checkout traffic. Adjust checkout completion by product category, purchase urgency, price point, free-trial design, required account creation, trust, and whether payment is consumer self-serve, prosumer, SMB, or enterprise-led. These are checkout-derived payers for the month, not the total active subscriber base.
3. Obtain the product's country distribution from available traffic evidence. Apply country-level or regional conversion assumptions rather than one global rate. When the exact payment-user country mix is unavailable, use the site's traffic mix as a proxy and label it as an assumption.
4. Research the observed commercial offering: current prices, monthly and annual billing, free trials, one-time purchases, usage charges, seat pricing, enterprise plans, discounts, and likely plan mix. Infer different plan mixes by country or customer segment when affordability and product use justify it.
5. Use only the requested month's checkout-derived payers. Do not carry prior cohorts forward, apply retention/churn or subscriber-stock multipliers, add automatic-renewal revenue, or impute an older subscriber base. Apply this same-month-only scope to fallback estimates based on inferred payment traffic as well.
6. Calculate the month's payment-based revenue estimate by country/segment and plan, then sum it:

   `monthly payment-based revenue estimate = Σ(this month's checkout-derived subscription payers × plan share × effective monthly price) + this month's checkout-derived one-time/usage/transaction revenue`

Use annual price divided by 12 to normalize subscriptions purchased in the requested month; do not carry annual purchases from earlier months into the estimate. If annual prepayments are material, separately show estimated cash collected. Do not count the same checkout revenue in both subscription and one-time/usage/transaction components. Label the result as a simplified estimate based only on that month's payment traffic, excluding accumulated subscriptions and automatic renewals; it is not total company revenue, total subscription MRR, or ARR. Show any directly sourced revenue figures separately with their own scope.

Present a base estimate and a defensible low-to-high range. Show the reported month, observable or inferred payment-traffic value, unique-checkout assumption, checkout success rate, country mix, checkout-derived paying users, plan mix, effective monthly revenue per payer, and the arithmetic connecting them. Do not include retained subscribers or renewal revenue in the calculation. Clearly distinguish observed facts, derived calculations, and judgment-based assumptions.

If the product is a mobile app, still use `altselfs_semrush_payment_destinations` first when it has a meaningful web purchase flow, then supplement it with `altselfs_appark_app_intelligence`. For a pure mobile product without a meaningful web domain, say why the payment-destination tool is inapplicable and use app-store intelligence. If no third-party source provides payment-platform traffic or a direct revenue estimate, produce a fallback estimate using the best available traffic, geographic distribution, product attributes, pricing, and relevant benchmarks, and label the result as inference.
