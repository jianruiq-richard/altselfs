---
name: estimate-competitor-monthly-revenue
description: Must use this instead of estimate-competitor-scale skill when user asks "I have a competitor. Help me estimate their revenue for last month.”.
---

# Estimate Competitor Monthly Revenue

Before starting any research, identify the target product.

## Start with observed payment-platform traffic

For every revenue estimate where the product has a meaningful web domain, first instruct Codex to call `altselfs_semrush_payment_destinations` for that domain. Do this before estimating from total traffic or using another traffic provider. The tool returns absolute outbound visits to recognized payment-platform domains for each of the last six completed calendar months, together with rolling six-, three-, and one-month totals. Use the latest completed month's value for the requested monthly estimate and the earlier months to check trend and volatility.

Treat payment-platform outbound visits as observed purchase intent, not as successful transactions or unique buyers. Review the returned payment destinations and include all credible processors rather than using Stripe alone. If the result is empty or the call fails, state that explicitly before using a fallback. Then check for a dedicated product-owned checkout hostname and other traffic sources such as `altselfs_similarweb_api1`, `altselfs_semrush13`, or `altselfs_ahrefs_url_research`. Never silently replace missing payment-platform traffic with an invented observed value.

## Convert payment traffic into paying users

Use product knowledge and observable product attributes to choose assumptions instead of applying one universal conversion rate. Build the estimate in this order:

1. Convert payment-platform visits into unique checkout users by accounting for retries, multiple page loads, payment-method changes, account-management visits, and other duplicate behavior appropriate to the checkout flow.
2. Estimate successful new paying users from those checkout users. Adjust checkout completion by product category, purchase urgency, price point, free-trial design, required account creation, trust, and whether payment is consumer self-serve, prosumer, SMB, or enterprise-led.
3. Obtain the product's country distribution from available traffic evidence. Apply country-level or regional conversion assumptions rather than one global rate. When the exact payment-user country mix is unavailable, use the site's traffic mix as a proxy and label it as an assumption.
4. Research the observed commercial offering: current prices, monthly and annual billing, free trials, one-time purchases, usage charges, seat pricing, enterprise plans, discounts, and likely plan mix. Infer different plan mixes by country or customer segment when affordability and product use justify it.
5. Estimate active paying users, not only new purchasers. For subscriptions, carry prior monthly cohorts forward using a retention or churn assumption appropriate to the product. Browser visits to a payment processor usually do not capture automatic renewals, so do not equate the latest month's payment-platform traffic with the whole subscriber base.
6. Calculate monthly revenue by country/segment and plan, then sum it:

   `monthly revenue = Σ(active paying users × plan share × effective monthly price) + one-time/usage/transaction revenue`

Use annual price divided by 12 for recognized monthly revenue. If annual prepayments are material, separately show estimated cash collected so it is not confused with recognized revenue.

Present a base estimate and a defensible low-to-high range. Show the observable payment-traffic value, unique-checkout assumption, checkout success rate, country mix, new and active paid users, plan mix, effective monthly revenue per payer, churn or retention, and the arithmetic connecting them. Clearly distinguish observed facts, derived calculations, and judgment-based assumptions.

If the product is a mobile app, still use `altselfs_semrush_payment_destinations` first when it has a meaningful web purchase flow, then supplement it with `altselfs_appark_app_intelligence`. For a pure mobile product without a meaningful web domain, say why the payment-destination tool is inapplicable and use app-store intelligence. If no third-party source provides payment-platform traffic or a direct revenue estimate, produce a fallback estimate using the best available traffic, geographic distribution, product attributes, pricing, and relevant benchmarks, and label the result as inference.
