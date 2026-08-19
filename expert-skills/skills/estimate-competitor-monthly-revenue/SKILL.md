---
name: estimate-competitor-monthly-revenue
description: Must use this instead of estimate-competitor-scale skill when user asks "I have a competitor. Help me estimate their revenue for last month.”.
---

# Estimate Competitor Monthly Revenue

Before starting any research, identify the target product.

Delegate data collection to Codex and instruct it to use one or more of `altselfs_similarweb_api1`, `altselfs_semrush13`, and `altselfs_ahrefs_url_research` to obtain two critical inputs: the product's outbound traffic to Stripe during the previous calendar month, or the most recent months for which data is available; and the product's traffic distribution by country for the previous month.

If Stripe-bound traffic is unavailable, determine whether the product uses a dedicated custom domain for its hosted payment or checkout page. If it does, instruct Codex to query that payment-domain hostname with `altselfs_similarweb_api1` and use the domain's traffic for the target month as a proxy for checkout visits. Verify that the domain is dedicated to the target product, and clearly state that checkout visits are not equivalent to successful payments.

Use the Stripe-bound traffic—or, when applicable, traffic to a verified custom checkout domain—to estimate the number of users demonstrating purchase intent. Then adjust the assumed conversion rate based on the country mix to estimate the number of paying users. Finally, combine the paying-user estimate with the product's pricing, plan mix, and billing cadence to produce a reasoned estimate of its revenue for that month.

If the product is a mobile app, instruct Codex to use `altselfs_appark_app_intelligence` to obtain a revenue estimate. If no third-party data source provides either Stripe-bound traffic or a direct revenue estimate, produce a fallback estimate using the best available traffic and geographic-distribution data, calibrated with relevant industry benchmarks and domain knowledge. Clearly identify the result as an inference and state the key assumptions behind it.
