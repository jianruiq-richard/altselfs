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
3. Search for non-official KOC, KOL, affiliate, reviewer, and community posts. Use the product name, common misspellings, campaign phrases, hashtags, discount codes, referral codes, tracking parameters, and landing-page URLs to discover them.
4. Investigate paid acquisition, especially Google advertising, and include Meta, TikTok, creator whitelisting, boosted posts, sponsorships, and other paid distribution when evidence exists.
5. Investigate SEO activity:
   - On-site signals: new landing pages, templates, comparison pages, programmatic pages, localized pages, metadata changes, internal linking, content clusters, and search-focused product pages.
   - Off-site signals: PR placements, guest posts, directory listings, backlinks, affiliate pages, reviews, partnerships, and other link-building activity.
   - GEO effectiveness: assess whether generative engine optimization produces measurable visibility, citations, recommendations, and qualified referral traffic from AI answer engines. Distinguish visible GEO activity from demonstrated impact.
6. Look for offline promotion, conferences, meetups, workshops, sponsorships, pop-ups, campus activity, partner events, and other physical distribution. Use online announcements, registration pages, photographs, recaps, and partner posts as evidence.

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

- Use a dated timeline for competitor actions and visual funnels for exposure, effective exposure, registrations, paid users, and revenue.
- Prefer charts for channel mix, campaign reach, cost, estimated return, and daily or weekly movement. Use tables only when exact source-level detail is clearer in tabular form.
- Clearly distinguish observed values, adjusted values, inferred estimates, and confidence ranges.
- Match Minaco.ai's visual language: warm black backgrounds (`#090909` and `#050505`), warm-ivory text (`#FFFAF0`), translucent dark panels, thin ivory borders, honey-gold accents (`#F2C36B`), soft gold (`#F8DFAA`), muted coral (`#E86F61`), and restrained green (`#78C889`). Use gentle gold and coral glows, compact 7–10 px radii, precise spacing, understated shadows, sans-serif body text, and a high-contrast serif only for the Minaco wordmark or selective editorial headings. Avoid a generic blue-purple AI dashboard aesthetic.
- Load `assets/minaco-logo-horizontal-on-dark.svg` with `skill_view` and include the exact SVG content in Codex's rendering instructions. Embed the SVG inline in the report header so the final HTML never depends on an internal path or a separately uploaded file.
- Ask Codex to render the report only after you have finalized the reporting window, evidence ledger, calculations, conclusions, ordered structure, chart datasets, design tokens, and logo SVG. Codex must implement that specification without deciding the report's substance.
- Make the HTML responsive and self-contained. Prefer inline SVG or CSS charts; when an external chart library is necessary, pin its version and keep readable values if it fails to load.
- Save every report under a distinct filename such as `outputs/<product-slug>-competitor-movements-<YYYYMMDD-HHMMSS>.html`.

Return a concise, decisive chat summary and attach or link the HTML report. In quick-data mode, return the full evidence ledger and analysis in chat and do not create HTML unless the user subsequently requests it.
