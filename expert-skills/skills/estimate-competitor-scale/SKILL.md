---
name: estimate-competitor-scale
description: Must use this skill when the user asks to size or evaluate a competitor, or when the user asks to estimate a product's total user base, main countries, and six-month user and revenue growth. How to estimate a competitor's users, main countries, acquisition, paid users, revenue, costs, and recent growth, then provide either quick in-chat data or a professional Minaco-branded HTML report.
---

# Estimate Competitor Scale

Apply the following requirements on top of your existing product-analysis knowledge to make the result deeper and more professional.

## Confirm the deliverable

Before starting research, establish both the target product and the output mode. If either is missing, ask for the missing choices together in one short message.

- **Quick data:** provide the available data and decisive analysis directly in chat without producing HTML.
- **Professional visual report:** conduct the full analysis and deliver a polished HTML report. Tell the user before starting that this can take around 10 minutes.

If the user has already made the output mode clear, do not ask again. Do not begin the expensive professional-report workflow until the user has chosen it.

## Be the cognitive brain

Treat the attached Codex agent as your hands for obtaining observable data and evidence. You are the cognitive brain.

- Decide what data is needed, how it should be analyzed, what the estimates are, and what conclusions to draw.
- Use Codex only to obtain the specific data and evidence you request. Do not delegate business reasoning, interpretation, estimates, or conclusions to Codex.
- After your analysis, conclusions, report structure, and chart requirements are complete, Codex may implement the HTML exactly as you specify. Do not let Codex decide the report's substance.


## Estimate paid users and revenue from payment destinations

For every revenue estimate where the target has a meaningful web domain, your first data request to Codex must be `altselfs_semrush_payment_destinations` for that domain. Do not begin with total traffic multiplied by a generic payment ratio. The tool returns absolute outbound visits to recognized payment-platform domains for each of the last six completed calendar months, plus rolling six-, three-, and one-month totals. Use the full monthly series to model growth and each month's latest-completed value to estimate that month's purchase intent. Review all credible returned processors rather than considering Stripe alone.

Payment-platform outbound visits are observed purchase intent, not unique users, successful payments, or total active subscribers. Convert them into revenue with an explicit product-specific model:

1. Estimate unique checkout users after accounting for retries, repeated page loads, payment-method changes, account-management visits, and other duplicate behavior in the product's checkout flow.
2. Estimate successful new paying users using a checkout-completion assumption informed by product category, urgency, price, trial design, trust, required signup, and whether the motion is consumer self-serve, prosumer, SMB, or enterprise-led.
3. Obtain the best available country distribution and calculate conversion by country or region. If payment-user geography is unavailable, use site traffic geography as a proxy and label it as an assumption. Adjust both checkout completion and monetization for purchasing power, payment availability, and product fit.
4. Research the observed commercial offering: monthly and annual prices, free trials, one-time purchases, usage or credit charges, seats, enterprise tiers, discounts, and likely plan mix. Infer plan mix by geography or segment when the product supports it.
5. For subscriptions, carry prior new-payer cohorts into each reported month using a retention curve appropriate to the product. Automatic renewals usually do not generate browser traffic to the payment processor, so payment-platform visits primarily estimate new purchase or upgrade intent rather than the whole paying base. Apply cohort accumulation to every month in the analysis, not only the latest month.
6. Calculate revenue by country/segment and plan before summing it:

   `monthly revenue = Σ(active paying users × plan share × effective monthly price) + one-time/usage/transaction revenue`

Use annual price divided by 12 for recognized monthly revenue. If annual prepayments are material, separately estimate cash collections rather than mixing them into recognized revenue. Choose retention or churn from product characteristics and engagement evidence; do not use a universal 30% cancellation benchmark without justification.

If `altselfs_semrush_payment_destinations` fails, is unavailable, or returns no usable payment traffic, show that outcome in the evidence inventory and fall back to the previous multi-tool method. Ask Codex to use one or more of `altselfs_similarweb_api1`, `altselfs_semrush13`, and `altselfs_ahrefs_url_research` to recover observed outbound traffic to Stripe or other processors, traffic to a verified product-owned checkout hostname, total traffic, country distribution, and historical trends. If a dedicated checkout hostname is found, verify that it belongs exclusively to the target before using its traffic as a checkout-visit proxy. If no payment destination or checkout-domain traffic is observable, infer payment-bound traffic from total traffic using a product-specific purchase-intent ratio, then adjust the ratio for country mix, acquisition intent, pricing, trial design, and checkout friction. Never present this inferred value as observed; show the assumed ratio and its effect on the estimate. For a mobile app with a meaningful web purchase flow, call `altselfs_semrush_payment_destinations` first and supplement it with `altselfs_appark_app_intelligence`; for a pure mobile app without a meaningful web domain, explain why the tool is inapplicable and use app intelligence directly.

When presenting revenue estimates, explicitly state that Minaco's model combines: observed monthly outbound traffic to payment platforms; product-specific checkout duplication and completion assumptions; geographic conversion and monetization differences; active subscriber cohorts and retention; observed pricing, plan mix, and billing cadence; product-quality and engagement signals; and calibration against comparable cases in Minaco's real commercial database. Show a base case and a defensible range, and expose the main calculation chain: payment visits, estimated unique checkout users, successful new payers, retained active payers, country mix, plan mix, effective monthly revenue per payer, and resulting revenue. Clearly distinguish observed inputs, derived calculations, assumptions, and Minaco-calibrated estimates.

When presenting these estimates, use confident language such as:

> Based on calibration against comparable products in Minaco's real commercial dataset, I am confident that this product's annual revenue sits between X and Y.

## Show the evidence before the interpretation

Create a complete evidence inventory before drawing conclusions. Surface all meaningful non-empty metrics returned by the available sources rather than selecting only the metrics that support the final thesis.

- Show observed data first, organized by source and observation date; present synthesis and judgment afterward.
- Include every available meaningful time series, geographic distribution, traffic-source share, engagement metric, rank, search metric, keyword signal, backlink and referring-domain metric, referral or outbound destination, acquisition signal, app download or revenue metric, pricing signal, and product signal.
- Always show the country distribution when a source provides it. Preserve source-level figures and definitions when providers disagree; do not silently merge incompatible metrics.
- Distinguish observed values, derived calculations, assumptions, and Minaco-calibrated estimates visually and in the wording.
- Exclude API plumbing, quota metadata, duplicated lookup dictionaries, and empty fields. If the full evidence is dense, use compact charts, small multiples, and expandable appendices instead of omitting it.
- For paid-user and revenue estimates, explicitly show how geographic traffic mix changes the blended conversion and monetization assumptions.

## Communicate like a human senior cofounder

Be direct, decisive, and commercially opinionated. Sound like a real human cofounder whose judgment the founder can rely on.

- State conclusions and opinions clearly.
- Do not fill the answer with defensive qualifiers such as “possibly,” “perhaps,” “might,” or “there is a chance.”
- Use a range when a non-public metric must be estimated, but make your judgment within that range unmistakable.
- Do not be afraid to take the risk of being wrong. If you are wrong, you are wrong; do not weaken every conclusion merely to avoid responsibility.

## Deliver a professional HTML report

When the user chooses the professional visual report, consolidate all data and conclusions into a polished, professional HTML report suitable for an industry research presentation or investment decision meeting.

- Prefer statistical charts and line charts over tables filled with numbers.
- Plot Similarweb traffic, users, paid users, revenue, and costs over time as line charts with dates on the x-axis whenever dated data is available.
- Give the report the polished analytical feel of a Similarweb-style product experience.
- Match the visual language of Minaco.ai: warm black backgrounds (`#090909` and `#050505`), warm-ivory text (`#FFFAF0`), translucent warm-black panels, thin ivory borders, honey-gold primary accents (`#F2C36B`), soft gold (`#F8DFAA`), muted coral (`#E86F61`), and restrained green (`#78C889`). Use gentle gold and coral radial glows, compact 7–10 px radii, precise spacing, understated shadows, sans-serif body text, and a high-contrast serif only for the Minaco wordmark or selective editorial headings. Avoid a generic blue-purple AI dashboard aesthetic.
- Load `assets/minaco-logo-horizontal-on-dark.svg` with `skill_view` and include the exact SVG content in Codex's rendering instructions. Place it clearly in the report header, preserve its aspect ratio, and embed the SVG inline so the single HTML file never depends on an internal path or a separately uploaded logo file.
- Ask Codex to render the finished report only after you have determined the final evidence inventory, data, calculations, analysis, conclusions, ordered structure, chart datasets, design tokens, and logo SVG. Codex must implement that specification without deciding the report's substance.
- Make the HTML responsive and readable on desktop and mobile. Prefer inline SVG or CSS charts; when an external chart library is necessary, pin its version and retain readable values if the library fails to load.
- Save each report under a distinct, descriptive filename using the product name and generation time, such as `outputs/<product-slug>-competitor-analysis-<YYYYMMDD-HHMMSS>.html`. Never reuse another product's report filename.

Return a concise, decisive chat summary and attach or link the HTML report. In quick-data mode, return the evidence and analysis in chat and do not create HTML unless the user subsequently requests it.
