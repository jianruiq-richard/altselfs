---
name: track-competitor-movements
description: Must use when the user asks to track a competitor's recent product, acquisition, creator or KOC/KOL, advertising, SEO or GEO, PR, event, pricing, user, or revenue movements, including yesterday or last week. Also use when a bare product name, company name, domain, URL, or app link follows established monitoring intent. Produce quick in-chat intelligence or a professional Minaco-branded HTML report.
---

# Track Competitor Movements

Apply these requirements on top of your existing competitive-intelligence knowledge.

## Establish scope and output

Before research, establish:

1. The competitor: product name, company name, domain, URL, or exact app link.
2. The reporting period and, when boundary dates matter, the timezone.
3. The output mode:
   - **Quick data:** evidence and decisive analysis in chat; no HTML.
   - **Professional visual report:** a complete, presentation-ready HTML report. Warn that this can take around 10 minutes.

Ask for all missing choices in one short message. Never ask again for information already established in the conversation. Treat a bare target supplied after your question as the answer and continue. Do not start the professional-report workflow until the user chooses it.

## Execution contract

You are the cognitive brain. Treat Codex only as your hands for obtaining observable evidence and implementing a fully specified report.

- Decide the evidence needed, analysis, estimates, conclusions, report structure, and charts yourself. Do not delegate business reasoning or conclusions to Codex.
- Before the first delegation, define the complete investigation, expected evidence fields, dependencies, and independent tracks. Run shared prerequisite research once, then dispatch independent acquisition work together so it can run in parallel. If parallel calls are unavailable, give Codex one bounded task that performs the independent searches concurrently and returns results by track.
- Maintain one current-run evidence ledger. Before each later delegation, reuse successful results from it. Never repeat the same connector call with the same normalized arguments, re-fetch the same page, or rerun the same search merely to reconfirm it. Repeat only after a failed, empty, or unusable attempt, or an explicit user refresh; state the reason.
- For daily or weekly action tracking, do not use Similarweb, Semrush, or Ahrefs by default. Use public search, official and social pages, advertising libraries, press and event sources, app stores, and directly observable evidence. Use those aggregate tools only when the user explicitly requests their metrics or a material finding cannot otherwise be verified; identify the missing evidence first.
- Perform one synthesis after acquisition. Delegate HTML rendering last, after evidence and analysis are complete, and explicitly forbid the rendering task from calling research connectors.

## Enforce the window and cover the full surface

Investigate only actions that occurred inside the requested period. Resolve relative periods such as “yesterday” and “last week” into explicit dates. Record both event date and source-publication date when they differ, classify by the event date, and verify boundary timestamps against the stated timezone. Keep materially relevant undated items only as unresolved leads; exclude them from period totals.

Complete these six tracks. A track with no verified activity must still have a negative finding and the checked sources, accounts, queries, and access limitations.

1. **Product and monetization:** shipped, announced, tested, or removed features; onboarding and referral changes; releases; pricing, plans, billing, checkout, paywalls, credits, trials, bundles, discounts, and promotions. Separate shipped, announced, tested, promoted, rumored, and inferred actions.
2. **Official distribution:** establish official accounts through website links, cross-links, handle history, and branding; then inspect YouTube, Instagram, TikTok, Facebook, X, LinkedIn, Reddit, Discord or communities, app stores, newsletters, press releases, blogs, news, launch platforms, and relevant forums.
3. **Non-official publishing:** separately search KOCs, KOLs, creators, bloggers, affiliates, reviewers, and community members on each of YouTube, Instagram, TikTok, Facebook, X, LinkedIn, Reddit, and Discord. None of these eight platforms is optional, and official-account research does not satisfy this track.
4. **Paid acquisition:** Google, Meta, and TikTok ads; creator whitelisting, boosted posts, sponsorships, and other paid distribution when evidence exists.
5. **Search, authority, and GEO:** on-site landing, comparison, programmatic, localized, metadata, linking, content-cluster, and search-product changes; off-site PR, guest posts, directories, backlinks, affiliate pages, reviews, and partnerships; assess whether GEO activity produces observable AI citations, recommendations, visibility, or qualified referrals rather than merely existing.
6. **Offline distribution:** conferences, meetups, workshops, sponsorships, pop-ups, campuses, partner events, and other physical promotion evidenced through announcements, registration pages, photographs, recaps, or partner posts.

Deduplicate multiple sources describing the same action.

## Discover and verify non-official posts

Treat non-official publishing as a first-class acquisition surface. For every one of the eight required platforms, use native discovery and Google site-restricted search where useful. Google often finds more YouTube videos, Shorts, descriptions, creator pages, and indexed mentions than YouTube search alone.

Every discovery query must include a competitor-specific anchor: exact product name, common misspelling, domain, official handle, product-specific hashtag, discount or referral code, tracking parameter, or landing-page URL. Never use a generic model name, feature name, or industry term alone as evidence about the competitor.

### Never filter by title alone

A missing product name in a post title is not an exclusion condition. Product-name searches commonly return posts whose titles omit the product name because the indexed body, caption, or description contains it. This is also a normal soft-promotion pattern: creators title content around a pain point, desired outcome, tutorial, question, comparison, or use case so it feels less like an advertisement, then introduce the product inside the content.

Treat every surfaced result as a candidate. Before including or excluding it:

1. Open the original link; never decide from a search-result title or snippet.
2. Verify the platform's actual publication timestamp against the reporting window.
3. Inspect the complete body, caption or description, hashtags, pinned comments when visible, transcript or on-screen text when available, account bio, link-in-bio destination, discount or referral codes, and outbound links. Expand truncated text and resolve shortened or redirected links when practical.
4. Accept a competitor-specific anchor in any inspected field as a relevance signal; never require it in the title.
5. If the original content, date, or description cannot be inspected, retain the item as an unresolved lead with the access limitation instead of silently rejecting it.

For an inclusive date window `S` through `E`, discover with `after:<day-before-S> before:<day-after-E>`, using valid `YYYY-MM-DD` dates with no localized punctuation, then verify the original platform timestamp. For example, August 9–15, 2026 becomes `after:2026-08-08 before:2026-08-16`. Use the same bracketing for one exact day. A generic query pattern is:

`site:<platform-domain> "<competitor-specific-anchor>" after:<S-1> before:<E+1>`

For YouTube, also search `site:youtube.com/watch`, `site:youtube.com/shorts`, and `site:youtu.be`. Google date operators are discovery filters, not proof. Do not count tag pages, duplicate snippets, mirrors, or inaccessible snippets as separate posts.

Classify each qualifying item as verified collaboration, likely collaboration, organic or editorial mention, or unresolved lead. Do not require proof of payment to retain a relevant non-official mention, but do not label it paid without evidence. Record an explicit zero-result finding and the searches performed for every platform with no qualifying item.

## Validate exposure and estimate impact

Do not treat displayed followers, views, likes, or comments as automatically valid. For every material creator promotion, assess:

- Audience, topic, geography, and language fit with the product.
- Followers versus normal recent views; promoted-post views versus the account baseline; views versus likes, comments, saves, and shares.
- Engagement quality, including specific product discussion versus generic, repetitive, irrelevant, or suspiciously clustered comments.
- Organic, paid-boosted, cross-posted, or unrelated viral distribution.
- View trajectory when available. A large immediate spike followed by a flat line, especially with low-quality engagement, indicates likely fake or inorganic volume.

Always show raw exposure, a justified validity factor, and effective exposure. Use low, base, and high ranges when attribution is not exact:

> Raw exposure × validity factor = effective exposure
>
> Effective exposure × platform- and format-specific response rate = qualified visits
>
> Qualified visits × registration conversion = new registered users
>
> New registered users × paid conversion = new paying users
>
> New paying users × first-payment value = directly added revenue

Use different assumptions for each platform and format. Adjust for call-to-action strength, audience fit, country mix, language, device, landing page, offer, price, and tracking evidence. Use referral parameters, codes, affiliate links, outbound destinations, checkout or Stripe-bound traffic, branded-search movement, source changes, and app-ranking movement as signals when available.

Estimate creator cost from effective reach, niche, geography, deliverable, usage rights, and likely terms; paid media from observed placement and relevant CPM, CPC, or CPA; SEO, PR, events, development, and discounts from their actual scope. Separate revenue attributable inside the period from delayed, recurring, or lifetime value. Do not present correlation as proven causality.

## Use one canonical evidence ledger

Create the ledger before drawing conclusions and keep one row per distinct action or post. Never replace source-level rows with “8+ posts,” selected examples, or an aggregate count. Each row must preserve, where applicable:

- Event and publication dates; online or offline; internal or external; channel and platform.
- Publisher or creator, account URL and official or non-official status, title, full content description, format, and clickable source URL.
- Competitor anchor and where it appeared; tracking or promotion evidence; collaboration classification; shipped, announced, tested, promoted, rumored, or inferred status.
- Observed engagement and raw exposure; validity factor and rationale; effective exposure.
- Estimated cost, qualified visits, registrations and conversion rate, paying users and conversion rate, and directly added revenue.
- Observed versus estimated status, low/base/high ranges, confidence, assumptions, alternative explanations, unavailable fields, and access limitations.

Reconcile each platform's discovered, qualifying in-window, reported, and excluded counts. Every qualifying row must reach the final answer or renderer; every exclusion needs a reason. Preserve missing metrics as unavailable unless there is a defensible estimate. When correcting one platform, update its ledger after exhausting target-anchored searches before revisiting unrelated tracks.

Show observed evidence before interpretation. Then state the competitor's actual priorities, what worked, what appears wasteful or fake, total estimated spend and return, and what the user should monitor or do next.

## Deliver the selected output

### Quick data

Return the complete relevant ledger and decisive analysis in chat. Do not create HTML unless the user subsequently requests it.

### Professional visual report

Build the report from the same canonical ledger. Do not perform a second research pass during rendering.

- Show all six investigation tracks, including explicit negative or access-limited findings. The acquisition checklist must cover official publishing; creator, KOC/KOL, affiliate, reviewer, and community distribution; Google, Meta, and TikTok ads; whitelisting, boosting, and other sponsorships; on-site and off-site SEO; GEO; PR, guest posts, directories, backlinks, reviews, partnerships, newsletters, app stores, launch platforms, forums, referral and discount programs; offline promotion; and in-product acquisition or commercial changes.
- Put a dedicated non-official publishing section before official publishing. Provide a separate labeled table for YouTube, Instagram, TikTok, Facebook, X, LinkedIn, Reddit, and Discord, with non-official rows before official rows. Preserve every qualifying post and retain zero-result subsections. Use the canonical ledger fields instead of a second, inconsistent schema.
- Visualize the dated action timeline, exposure-to-revenue funnels, channel mix, reach, cost, return, and daily or weekly movement. Use tables for exact source-level evidence and charts for patterns.
- Never shorten the report by dropping channels, rows, calculations, or negative findings. If it is long, use self-contained interactive tabs, accordions, filters, sticky navigation, and summary-to-detail views while keeping every section discoverable.
- Clearly distinguish observed, adjusted, and estimated values and confidence ranges.
- Match Minaco.ai: warm black `#090909` and `#050505`; warm ivory `#FFFAF0`; translucent dark panels and thin ivory borders; honey gold `#F2C36B`; soft gold `#F8DFAA`; muted coral `#E86F61`; restrained green `#78C889`; subtle gold/coral glows; compact 7–10 px radii; precise spacing; understated shadows; sans-serif body text and selective high-contrast serif headings. Avoid generic blue-purple AI styling.
- Load `assets/minaco-logo-horizontal-on-dark.svg` with `skill_view`, pass its exact SVG to Codex, and embed it inline in the header so the report has no dependency on an internal path or separate upload.
- Before rendering, pass Codex the explicit window, every ledger row and URL, reconciliation counts, calculations, conclusions, ordered sections, chart datasets, design tokens, and logo SVG. Codex must implement this specification without changing the substance or calling research tools.
- Make the HTML responsive and self-contained. Prefer inline SVG or CSS charts; if an external chart library is necessary, pin its version and preserve readable fallback values.
- Save each report to a distinct file such as `outputs/<product-slug>-competitor-movements-<YYYYMMDD-HHMMSS>.html`.

Return a concise, decisive chat summary and attach or link the HTML report.
