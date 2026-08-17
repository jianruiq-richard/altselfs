---
name: track-competitor-movements
description: Must use this skill when the user asks to track a competitor's recent actions, including last week's or yesterday's product updates, acquisition moves, creator or KOC/KOL promotions, advertising, SEO, PR, events, pricing, or likely user and revenue impact. Also use when the current message is only a product name, company name, domain, URL, or app link and earlier messages established this monitoring intent. Produce either quick in-chat intelligence or a professional Minaco-branded HTML report.
---

# Track Competitor Movements

Apply these requirements on top of your existing competitive-intelligence knowledge.

## Confirm the target, period, and deliverable

Before starting research, establish the target competitor, the reporting period, and the output mode. If any are missing, ask for the missing choices together in one short message.

- Accept the competitor's product name, company name, domain, URL, or exact app link as the target.
- **Quick data:** provide the available evidence and decisive analysis directly in chat without producing HTML.
- **Professional visual report:** conduct the full analysis and deliver a polished HTML report suitable for a presentation or investment decision. Tell the user before starting that this can take around 10 minutes.

If the conversation already establishes any of these choices, do not ask for them again. Treat a bare product name, domain, URL, or app link following your question as the target and continue. Do not begin the expensive professional-report workflow until the user has chosen it.

## Be the cognitive brain

Treat the attached Codex agent as your hands for obtaining observable data and evidence. You are the cognitive brain.

- Decide what data is needed, how it should be analyzed, what the estimates are, and what conclusions to draw.
- Use Codex only to obtain the specific data and evidence you request. Do not delegate business reasoning, interpretation, estimates, or conclusions to Codex.
- After your analysis, conclusions, report structure, and chart requirements are complete, Codex may implement the HTML exactly as you specify. Do not let Codex decide the report's substance.

## Design the investigation once, then execute in parallel

Before the first Codex delegation, design the complete investigation as a dependency graph. Identify shared prerequisite work first, then the independent investigation tracks. Do not discover and delegate one module at a time when the remaining modules are already known.

1. Define the reporting window, target identity, official properties, search aliases, required investigation tracks, and expected evidence fields once.
2. Extract work shared by multiple tracks into one prerequisite task. Run it once, retain its successful results in the current-turn evidence ledger, and provide those results to every dependent task. Never ask parallel tasks to independently repeat the same prerequisite research.
3. Dispatch all independent Codex investigation tasks together in the same Hermes step so they can run in parallel. If the runtime cannot execute multiple Codex calls concurrently, use one bounded Codex acquisition task that performs the independent searches concurrently and returns results separated by track.
4. Before every later Codex delegation, compare the requested work against the current-turn evidence ledger. Reuse every successful prior result. Never repeat the same connector call with the same normalized arguments, re-fetch the same page, or re-run the same search merely to refresh, reconfirm, or avoid relying on a result obtained earlier in the same run.
5. Permit a repeated acquisition only when the prior attempt failed, returned unusable or empty data, or the user explicitly requested a refresh. State that reason in the Codex task.
6. After the parallel acquisition tasks return, perform one Hermes synthesis. Delegate HTML implementation only after the evidence and analysis are complete, and explicitly forbid the rendering task from calling research or competitive-intelligence connectors.

### Tool selection for short reporting windows

For daily or weekly promotion and competitor-action tracking, do not call Similarweb, Semrush, or Ahrefs by default. Their aggregate traffic, SEO, and backlink datasets are not needed to establish date-bounded product launches, social posts, creator promotions, advertisements, PR, events, or pricing actions, and they should never be called merely because they are enabled.

Use public web search, official product and social surfaces, platform post pages, advertising libraries, press and event sources, app stores, and directly observable evidence for these short-window investigations. Keep Similarweb, Semrush, and Ahrefs available for longer-horizon traffic, SEO, backlink, market-share, or growth analysis. In a daily or weekly tracking task, use one of them only when the user explicitly requests its metric or a specific material finding cannot be verified without it; explain the exact missing evidence before making that exceptional call.

## Obey the reporting window

Strictly follow the time range requested by the user. If the request says "last week," "yesterday," or supplies explicit dates, investigate and report only competitor actions that occurred inside that period.

- Do not expand the search into earlier or later activity merely to make the report look fuller.
- Record both the event date and the source publication date when they differ. Classify the action by when it happened, not simply when a page was indexed or discovered.
- Resolve relative periods into explicit start and end dates and show them in the result. State the timezone used when it can change inclusion at the boundary.
- Exclude undated claims and actions that cannot be placed inside the requested period from the action totals. List them only as unverified leads when they are materially relevant.

## Search the full competitive surface

Run a broad, cross-platform investigation across both product-internal and product-external activity. Do not stop after checking one search engine, one social network, or the competitor's own website.

### External activity

1. Establish the competitor's verified or strongly evidenced official accounts before interpreting promotional activity. Check the product website, account links, handle history, branding consistency, and cross-links between official properties.
2. Review official publishing and distribution activity across all materially relevant public surfaces available through current tools, including YouTube, Instagram, TikTok, Facebook, X, LinkedIn, Reddit, Discord or community announcements, app stores, newsletters, press releases, news sites, blogs, launch platforms, and relevant forums.
3. Treat non-official publishing as a first-class investigation track, separate from official-account research. Search for and count posts by KOCs, KOLs, creators, bloggers, affiliates, reviewers, and community members separately across YouTube, Instagram, TikTok, Facebook, X, LinkedIn, Reddit, and Discord. Complete eight explicit non-official search tracks: one for YouTube, one for Instagram, one for TikTok, one for Facebook, one for X, one for LinkedIn, one for Reddit, and one for Discord. None is optional, and checking an official account does not satisfy the corresponding non-official track. Use the exact product name, common misspellings, domain, official handles, product-specific hashtags, discount or referral codes, tracking parameters, and landing-page URLs to discover posts. Every discovery query must contain at least one competitor-specific anchor. Never search a generic model name, feature name, or industry term by itself and treat the results as evidence about the competitor. Inventory every qualifying in-window non-official post found on each platform and record an explicit zero-result finding, together with the searches performed, for any platform where none is found. Do not complete the investigation until all eight non-official tracks have a result ledger or an explicit access limitation.
4. Investigate paid acquisition, especially Google advertising, and include Meta, TikTok, creator whitelisting, boosted posts, sponsorships, and other paid distribution when evidence exists.
5. Investigate SEO activity:
   - On-site signals: new landing pages, templates, comparison pages, programmatic pages, localized pages, metadata changes, internal linking, content clusters, and search-focused product pages.
   - Off-site signals: PR placements, guest posts, directory listings, backlinks, affiliate pages, reviews, partnerships, and other link-building activity.
   - GEO effectiveness: assess whether generative engine optimization produces measurable visibility, citations, recommendations, and qualified referral traffic from AI answer engines. Distinguish visible GEO activity from demonstrated impact.
6. Look for offline promotion, conferences, meetups, workshops, sponsorships, pop-ups, campus activity, partner events, and other physical distribution. Use online announcements, registration pages, photographs, recaps, and partner posts as evidence.

### Discover date-bounded social posts through Google

Use Google site-restricted searches in addition to each platform's native search. For YouTube in particular, Google often surfaces a broader set of videos, Shorts, descriptions, creator pages, and indexed mentions than YouTube's own search. Search the exact product name, domain, official handle, product-specific hashtags, referral codes, and landing-page URLs. Keep at least one of those competitor-specific anchors in every query; add other terms only to narrow an anchored search.

Never decide whether a non-official post is relevant from its title alone. Omitting the product name from the title is a common KOC/KOL soft-promotion technique: it reduces the chance that audiences or platforms perceive the post as an overt advertisement, lowers resistance to the promotion, and makes the content feel useful before it feels commercial. A typical post frames its title around a pain point, desired outcome, question, tutorial, comparison, or use case, then introduces or demonstrates the product in the content, caption, description, or call to action. A creator may therefore name or link the product only in the caption, description, hashtags, pinned comment, transcript, visible on-screen text, account bio, link-in-bio destination, discount or referral code, or outbound URL. For every candidate surfaced on any of the eight required platforms:

- Open the original post and expand truncated captions or descriptions before accepting or rejecting it.
- Inspect the full caption or description, hashtags, pinned comments when visible, transcript or visible text when available, account bio, and every outbound or tracking link. Resolve shortened and redirected links when practical.
- Treat a competitor-specific anchor found in any of those fields as a relevance signal; never require the anchor to appear in the title.
- If the original content or description cannot be inspected, retain the candidate as an unresolved lead with an access limitation instead of silently filtering it out.

Use `after:` and `before:` to constrain discovery to the reporting window:

- Write every date as valid `YYYY-MM-DD`; never introduce commas, spaces, or localized date punctuation inside an operator.
- For an inclusive reporting window from start date `S` through end date `E`, use `after:<day-before-S> before:<day-after-E>` for discovery, then verify the platform timestamp. For August 9-15, 2026, use `after:2026-08-08 before:2026-08-16`.
- For one exact calendar day, bracket it with the preceding and following dates. To find a competitor's posts published on May 20, 2026, use `site:instagram.com "<competitor-domain>" after:2026-05-19 before:2026-05-21`.
- Apply the same pattern to YouTube using target-anchored searches such as `site:youtube.com/watch "<competitor-domain>"`, `site:youtube.com/shorts "<competitor-domain>"`, and `site:youtu.be "<competitor-domain>"`.
- For TikTok, use target-anchored searches such as `site:tiktok.com "<competitor-domain>" after:2026-08-08 before:2026-08-16` and `site:tiktok.com intext:"#<competitor-specific-hashtag>" after:2026-08-08 before:2026-08-16`.

Treat Google date operators as discovery filters, not final proof of publication time. Open each result and verify the platform's actual post or video timestamp before including it in the requested period. Do not count tag pages, duplicate snippets, mirrors, or inaccessible search-result snippets as separate posts.

### Product-internal activity

Monitor changes to the product itself and its monetization system, including:

- Newly shipped, announced, tested, or removed features.
- Onboarding, activation, sharing, referral, or collaboration changes.
- Pricing, plan structure, billing cadence, paywall, checkout, credit, trial, bundle, discount, and limited-time promotion changes.
- App releases, release notes, website changes, changelogs, in-product announcements, and commercial landing pages.

Separate shipped, announced, tested, promoted, rumored, and inferred actions. Deduplicate multiple reports of the same underlying action.

## Validate creator and campaign exposure

Do not treat every displayed follower, view, like, or comment as valid exposure. Some sponsored KOC/KOL accounts have purchased audiences; others accumulated followers in an unrelated content category whose audience has little interest in the promoted product.

For every material creator promotion, assess:

- Fit between the account's established audience, content category, geography, language, and the promoted product.
- Followers versus typical recent views, the sponsored post's views versus the account's own baseline, and views versus likes, comments, saves, and shares.
- Engagement rate and engagement quality, including specific product discussion versus repetitive, generic, irrelevant, or suspiciously clustered comments.
- Whether reach appears organic, paid-boosted, cross-posted, or driven by an unrelated viral audience.
- The view trajectory over time when a tool such as vidIQ makes it available. A large immediate spike followed by a flat line, especially alongside low-quality engagement, is a strong fake-volume or inorganic-distribution signal.

Discount suspicious traffic rather than counting all displayed views. Show both raw exposure and estimated effective exposure, together with the validity factor and the reasons for the adjustment.

## Preserve every non-official publishing result

Build a dedicated non-official publishing ledger before synthesis. Keep one row per discovered post; never replace source-level rows with phrases such as "8+ creator posts," a list of examples, or an aggregate count.

- Record platform, creator or publisher, account URL, post date, title and full caption or description, post URL, format, observed engagement, competitor-specific anchor, the field where that anchor appeared, promotion or tracking evidence, relationship classification, and confidence.
- Classify each result as verified collaboration, likely collaboration, organic or editorial mention, or unresolved lead. Do not label a post as paid collaboration without evidence, but do not discard a relevant non-official discussion merely because payment cannot be proven.
- Keep posts with unavailable views, likes, comments, sponsorship cost, or conversion metrics. Mark the field unavailable and estimate only when there is a defensible basis.
- Reconcile counts before synthesis for every platform: discovered rows, qualifying in-window rows, and rows carried into the final report. Every qualifying row must survive the handoff. If a result is excluded, record the specific exclusion reason.
- When the user asks to correct or deepen one platform, exhaust target-anchored searches for that platform and update this ledger before revisiting unrelated research tracks.

## Estimate cost, registrations, paid users, and revenue

Build a separate impact model for every meaningful action. Use low, base, and high ranges when exact internal attribution is unavailable.

Use this calculation chain where applicable:

> Raw exposure × validity factor = effective exposure
>
> Effective exposure × platform- and format-specific response rate = qualified visits or clicks
>
> Qualified visits × registration conversion = new registered users
>
> New registered users × paid conversion = new paying users
>
> New paying users × observed or estimated first-payment value = directly added revenue

- Apply different conversion assumptions by platform. A tutorial or review on YouTube, a short-form TikTok or Instagram post, a Reddit discussion, a search ad, a branded search visit, a PR placement, and an offline event do not convert at the same rate.
- Adjust conversion for content format, call-to-action strength, audience-product fit, country mix, language, device, landing page, offer, pricing, and tracking-link evidence.
- Use referral parameters, discount codes, affiliate links, outbound destinations, checkout or Stripe-bound traffic, branded-search movement, traffic-source changes, and app-ranking movement as attribution signals when available.
- Estimate creator costs from account size, effective views, niche, geography, deliverable type, usage rights, and likely sponsorship terms. Estimate paid-media costs from observed placement plus relevant CPM, CPC, or CPA knowledge. Estimate SEO, PR, offline-event, product-development, and promotional-discount costs using the actual scope of the action.
- Distinguish directly attributable revenue inside the reporting window from delayed, recurring, or lifetime value. Do not present correlation as proven causality.
- When evidence is weak, preserve the action in the inventory but lower its confidence and explain which missing observation would materially change the estimate.

## Build the action ledger before drawing conclusions

Create a complete ledger of actions inside the requested period, then synthesize the competitor's strategy and impact. For each action, provide:

- Event date and evidence URL or source.
- Online or offline; product-internal or product-external.
- Channel, account, campaign, feature, pricing change, or event involved.
- Verification status and whether it was shipped, announced, tested, promoted, rumored, or inferred.
- Raw exposure, validity assessment, and effective exposure.
- Estimated cost.
- Estimated qualified visits, new registrations, new paying users, and directly added revenue.
- Low, base, and high ranges, confidence, assumptions, and alternative explanations.

Show observed evidence before interpretation. Conclude with the competitor's actual strategic priorities during the period, which actions worked, which appear wasteful or fake, the estimated total spend and return, and what the user should monitor or do next.

## Deliver a professional HTML report

When the user chooses the professional visual report, consolidate the evidence ledger, calculations, and conclusions into a polished, professional HTML report.

- Build and render an acquisition-coverage matrix before finalizing the report. Include every promotion, distribution, and acquisition method named anywhere in this skill; the list is a mandatory coverage checklist, not a menu from which to select only channels with positive findings. Cover at least official social publishing, KOC/KOL and creator sponsorships, affiliates and reviewers, community distribution, Google, Meta, and TikTok advertising, creator whitelisting and boosted posts, other paid sponsorships, on-site SEO, off-site SEO, GEO, PR, guest posts, directories, backlinks and link building, reviews and partnerships, newsletters, app stores, launch platforms, forums, referral and discount programs, offline events and sponsorships, and in-product acquisition or commercial promotions.
- Give every acquisition method its own visible result in the report. When a diligent investigation finds no relevant clue, state plainly that the competitor had no observed action for that method within the reporting window, and list the sources, accounts, queries, and date filters checked. Never omit a method, collapse it into an unreported residual category, or mistake missing public metrics for permission to suppress the investigation result. If a surface could not actually be investigated because access was unavailable, disclose that limitation rather than claiming that no action occurred.
- Include all six external-activity modules defined above: the verified official-account map, official publishing and distribution, non-official KOC/KOL and affiliate promotion, paid acquisition, SEO activity covering on-site SEO, off-site SEO or PR, link building, and GEO, and offline promotion or events. Each module may begin with a concise synthesis, but none may be omitted. When no qualifying action is found, retain the module and state the surfaces and queries checked, the evidence limitations, and that no verified in-window activity was found.
- Treat non-official creator publishing as the most important acquisition surface and place a dedicated **Non-official KOC/KOL, creator, blogger, affiliate, reviewer, and community publishing** section before the official-account publishing section. Itemize every discovered in-window non-official post; never substitute an aggregate count or a few examples. Then itemize every discovered in-window post from verified official accounts.
- Create a separate, clearly labeled publishing table for each of these eight platforms: YouTube, Instagram, TikTok, Facebook, X, LinkedIn, Reddit, and Discord. Do not merge them into one cross-platform summary or omit a platform. Within every platform, visibly separate non-official publishing rows from official-account rows and show the non-official rows first. If no qualifying non-official or official post is found, retain the corresponding subsection and state that no verified in-window post was found, together with the accounts, queries, and date filters checked.
- Include these columns in every platform table: post title or content description, publisher or creator name, account relationship or status, publication date, clickable source URL, observed or estimated publishing or sponsorship cost, raw views or exposure, exposure-validity factor and rationale, estimated effective views or exposure, estimated registration-conversion rate and registered users, estimated paid-conversion rate and paying users, and estimated directly added revenue. Mark observed values and estimates distinctly; never hide a required field merely because public data is unavailable.
- For each official or non-official post, show at least the platform, account, account status, publication date, post title or concise description, content format, source URL, promotion or tracking signal, raw views or exposure, validity assessment, estimated effective views or exposure, estimated qualified visits, estimated registrations, estimated paying users, estimated directly added revenue, confidence, and key assumptions. If a metric is unavailable, mark it unavailable and show the basis of any estimate instead of silently dropping the field.
- Use a dated timeline for competitor actions and visual funnels for exposure, effective exposure, registrations, paid users, and revenue.
- Prefer charts for channel mix, campaign reach, cost, estimated return, and daily or weekly movement. Use tables only when exact source-level detail is clearer in tabular form.
- Never shorten the HTML by removing required channels, evidence, posts, calculations, tables, or negative findings. When the report becomes long or dense, preserve the complete content and organize it as an interactive page with clearly labeled switchable tabs by channel or investigation module, supported where useful by accordions, filters, a sticky section navigator, and summary-to-detail drill-downs. Keep every required section discoverable in the page and make tab state and controls work without external services.
- Clearly distinguish observed values, adjusted values, inferred estimates, and confidence ranges.
- Match Minaco.ai's visual language: warm black backgrounds (`#090909` and `#050505`), warm-ivory text (`#FFFAF0`), translucent dark panels, thin ivory borders, honey-gold accents (`#F2C36B`), soft gold (`#F8DFAA`), muted coral (`#E86F61`), and restrained green (`#78C889`). Use gentle gold and coral glows, compact 7–10 px radii, precise spacing, understated shadows, sans-serif body text, and a high-contrast serif only for the Minaco wordmark or selective editorial headings. Avoid a generic blue-purple AI dashboard aesthetic.
- Load `assets/minaco-logo-horizontal-on-dark.svg` with `skill_view` and include the exact SVG content in Codex's rendering instructions. Embed the SVG inline in the report header so the final HTML never depends on an internal path or a separately uploaded file.
- Ask Codex to render the report only after you have finalized the reporting window, complete source-level non-official and official publishing ledgers, per-platform reconciliation counts, calculations, conclusions, ordered structure, chart datasets, design tokens, and logo SVG. Pass every ledger row and source URL to the rendering task; an aggregate such as "8+ posts were found" is not a valid handoff. Codex must implement that specification without deciding the report's substance.
- Make the HTML responsive and self-contained. Prefer inline SVG or CSS charts; when an external chart library is necessary, pin its version and keep readable values if it fails to load.
- Save every report under a distinct filename such as `outputs/<product-slug>-competitor-movements-<YYYYMMDD-HHMMSS>.html`.

Return a concise, decisive chat summary and attach or link the HTML report. In quick-data mode, return the full evidence ledger and analysis in chat and do not create HTML unless the user subsequently requests it.
