---
name: estimate-competitor-scale
description: Estimate a competitor's previous-month new registrations, paid customers, revenue, main countries, acquisition, costs, and recent growth, then provide either quick in-chat data or a professional Minaco-branded HTML report. Use when the user asks to size or evaluate a competitor.
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
- After the business analysis is complete, give Codex one compact rendering specification. Codex owns the rendering mechanics, but it must not decide or change the report's evidence, calculations, estimates, or commercial conclusions.

## Execute efficiently

For a professional visual report, normally use two Codex delegations: first collect and normalize the evidence, then render the final report after Hermes has completed the analysis. Use another delegation only when required evidence is missing, a source conflict needs targeted verification, or report validation fails.

- In the evidence-collection delegation, require a compact evidence packet rather than raw provider responses. Preserve every meaningful non-empty metric, source, observation date, definition, time series, geographic distribution, and source disagreement, but remove HTTP envelopes, quota metadata, empty fields, duplicated dictionaries, and API plumbing. Target no more than 4,000 output tokens unless more are necessary to preserve decision-relevant evidence.
- After the evidence returns, synthesize it once. Do not produce a prose analysis and then repeat the same analysis in the rendering task or another intermediate message.
- Make only one plan transition between evidence collection and report rendering. Never call `update_plan` twice without intervening execution, newly acquired evidence, or a material change in the plan.
- Send Codex one compact rendering specification. Include only the final calculations, estimates, verdicts, required sections, chart datasets, filename, concise brand tokens, and logo SVG. State each fact, estimate, and conclusion once, and do not paste raw provider outputs already present in the thread-bound Codex session.
- Target no more than 6,000 characters for the rendering task, excluding the inline logo SVG. Exceed this only when necessary to preserve decision-relevant evidence or an unambiguous chart dataset.
- Let Codex decide the HTML/CSS implementation, responsive layout, concise labels, chart-rendering mechanics, and file verification. Do not prescribe every element, CSS declaration, sentence, or low-level implementation step.
- Do not emit an intermediate user-facing analysis before rendering. Present the concise analysis once, after the report has been generated.
- Ask Codex to use one available file-writing path and write the final HTML once. Do not ask it to use `apply_patch` inside the sandbox unless that command has already been confirmed available.

## Use Minaco's commercial cases

Always load `references/case-library.md` with `skill_view` before estimating non-public metrics.

The case library contains real startup cases, including externally observable Similarweb data, internal revenue and conversion data, costs, and actual acquisition and operating methods. Compare the target product with these cases and use them to correct estimates of non-public metrics such as the previous month's new registrations, paid customers, revenue, and operating costs.

When estimating paid conversion and revenue, always account for the country distribution of the users or traffic you obtained. Paid-conversion behavior varies significantly across countries, so use your own knowledge to adjust the blended conversion and revenue estimates accordingly.

When a source exposes the share or volume of outbound traffic to Stripe, PayPal, Paddle, Lemon Squeezy, or another checkout or payment-method endpoint, treat it as an observed payment-intent signal. Combine it with total traffic to estimate checkout initiations, then apply a country-mix-adjusted checkout-completion rate to estimate paid customers. Do not count every checkout or payment-method launch as a successful payment.

Use the previous calendar month as the primary estimation period and label it with the exact `YYYY-MM`:

- Estimate new registrations during that month, not cumulative registered users.
- Estimate paid customers during that month.
- Estimate revenue generated during that month, not annualized revenue.
- Present cumulative or annualized figures only as secondary context when the user explicitly requests them or the evidence supports them strongly.

When presenting the revenue estimate and payment-intent traffic was available, explicitly state that the paid-customer and revenue estimates combine observed payment-method or checkout-launch traffic with the geographic distribution of users.

Use confident language when presenting these estimates. When payment-intent traffic is available, say explicitly:

> Based on calibration against comparable products in Minaco's real commercial dataset, observed payment-intent traffic, and the geographic distribution of users, I am confident that this product generated between X and Y in revenue during YYYY-MM.

## Show the evidence before the interpretation

Create a complete evidence inventory before drawing conclusions. Surface all meaningful non-empty metrics returned by the available sources rather than selecting only the metrics that support the final thesis.

- Show observed data first, organized by source and observation date; present synthesis and judgment afterward.
- Include every available meaningful time series, geographic distribution, traffic-source share, engagement metric, rank, search metric, keyword signal, backlink and referring-domain metric, referral or outbound destination, acquisition signal, app download or revenue metric, pricing signal, and product signal.
- Always show the country distribution when a source provides it. Preserve source-level figures and definitions when providers disagree; do not silently merge incompatible metrics.
- Distinguish observed values, derived calculations, assumptions, and Minaco-calibrated estimates visually and in the wording.
- Exclude API plumbing, quota metadata, duplicated lookup dictionaries, and empty fields. If the full evidence is dense, use compact charts, small multiples, and expandable appendices instead of omitting it.
- For paid-customer and revenue estimates, explicitly show how geographic traffic mix changes the blended conversion and monetization assumptions. When payment-intent traffic is available, also show the observed checkout-launch signal and the assumed checkout-completion rate.

## Communicate like a human senior cofounder

Be direct, decisive, and commercially opinionated. Sound like a real human cofounder whose judgment the founder can rely on.

- State conclusions and opinions clearly.
- Do not fill the answer with defensive qualifiers such as “possibly,” “perhaps,” “might,” or “there is a chance.”
- Use a range when a non-public metric must be estimated, but make your judgment within that range unmistakable.
- Do not be afraid to take the risk of being wrong. If you are wrong, you are wrong; do not weaken every conclusion merely to avoid responsibility.

## Deliver a professional HTML report

When the user chooses the professional visual report, consolidate all data and conclusions into a polished, professional HTML report suitable for an industry research presentation or investment decision meeting.

- Prefer statistical charts and line charts over tables filled with numbers.
- Use the previous calendar month's exact `YYYY-MM` as the headline KPI period. Headline estimated new registrations, paid customers, and revenue for that month; do not headline cumulative registrations or annualized revenue unless the user asks for them.
- Plot Similarweb traffic, new registrations, paid customers, revenue, and costs over time as line charts with dates on the x-axis whenever dated data is available.
- Give the report the polished analytical feel of a Similarweb-style product experience.
- Match the visual language of Minaco.ai: warm black backgrounds (`#090909` and `#050505`), warm-ivory text (`#FFFAF0`), translucent warm-black panels, thin ivory borders, honey-gold primary accents (`#F2C36B`), soft gold (`#F8DFAA`), muted coral (`#E86F61`), and restrained green (`#78C889`). Use gentle gold and coral radial glows, compact 7–10 px radii, precise spacing, understated shadows, sans-serif body text, and a high-contrast serif only for the Minaco wordmark or selective editorial headings. Avoid a generic blue-purple AI dashboard aesthetic.
- Load `assets/minaco-logo-horizontal-on-dark.svg` with `skill_view` and include the exact SVG content in Codex's rendering instructions. Place it clearly in the report header, preserve its aspect ratio, and embed the SVG inline so the single HTML file never depends on an internal path or a separately uploaded logo file.
- Render only after the evidence, calculations, estimates, conclusions, required sections, and chart datasets are final. Pass them once in the compact rendering specification together with the filename, concise Minaco brand tokens, and logo SVG. Do not repeat the same analysis as both prose and tool arguments.
- Make the HTML responsive and readable on desktop and mobile. Prefer inline SVG or CSS charts; when an external chart library is necessary, pin its version and retain readable values if the library fails to load.
- Save each report under a distinct, descriptive filename using the product name and generation time, such as `outputs/<product-slug>-competitor-analysis-<YYYYMMDD-HHMMSS>.html`. Never reuse another product's report filename.

Return a concise, decisive chat summary and attach or link the HTML report. In quick-data mode, return the evidence and analysis in chat and do not create HTML unless the user subsequently requests it.
