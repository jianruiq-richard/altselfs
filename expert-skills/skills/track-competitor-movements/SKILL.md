---
name: track-competitor-movements
description: Must use when the user asks to track a competitor's recent product, acquisition, creator or KOC/KOL, advertising, SEO or GEO, PR, event, pricing, user, or revenue movements, including yesterday or last week. Also use when a bare product name, company name, domain, URL, or app link follows established monitoring intent. Produce quick in-chat intelligence or a professional Minaco-branded HTML report.
---

# Track Competitor Movements

Apply these requirements on top of your existing competitive-intelligence knowledge.

## Establish scope and output

Before research, establish:

1. The competitor: product name, company name, domain, URL, or exact app link.
2. The output mode:
   - **Quick data:** evidence and decisive analysis in chat; no HTML.
   - **Professional visual report:** a complete, presentation-ready HTML report. Warn that this can take around 10 minutes.

Ask for all missing choices in one short message. Never ask again for information already established in the conversation. Treat a bare target supplied after your question as the answer and continue. Do not start the professional-report workflow until the user chooses it.

## Delegate evidence collection natively

Act as the cognitive brain. Before delegating, decide the exact evidence needed, analysis method, estimates, conclusions, report structure, and chart requirements.

Use the native Codex agent only as hands for obtaining the specific observable data and evidence requested. When calling Codex, copy this complete Skill content, including its frontmatter and tool prohibitions, verbatim into the existing native `task` or `hermesContext`, then state the bounded evidence-collection objective. Do not summarize, weaken, balance against a broader request, or invent exceptions to these requirements. Do not ask Codex to research product updates or any other competitor-movement category.

Do not delegate business reasoning, interpretation, estimates, conclusions, report structure, or chart decisions to Codex. After Hermes has completed those decisions, Codex may implement the HTML exactly as specified without deciding or changing the report's substance.

## Track YouTube publishing only

Perform exactly one research task: find all qualifying YouTube videos and Shorts published within the user's tracking window. Do not research any other platform or competitor-movement category.

Include:

1. Every video or Short published by the competitor's official YouTube account or accounts during the window.
2. Every promotional video or Short published during the window by a non-official KOC, KOL, creator, reviewer, affiliate, or other account. Treat sponsorships, endorsements, recommendations, product-led tutorials or reviews, affiliate links, referral or discount codes, and other clearly promotional treatments as qualifying.

## Do not use monthly aggregate tools

When the tracking window is one month or shorter, never use Similarweb, Semrush, or Ahrefs. Do not call these tools for discovery, evidence, or validation because their monthly-granularity data cannot establish which competitor actions occurred inside the requested date window. Use Google search and original YouTube pages instead.

## Extract YouTube metadata with Python

Use Python on a host that can reach YouTube to fetch each public watch page and extract the title, channel, publication date, view count, and comment count from its embedded `ytInitialPlayerResponse` and `ytInitialData` JSON. If the comment count is not embedded, follow the page's public comment continuation through `youtubei/v1/next`; use only verified public values, record the retrieval time, and return `Unavailable` when a field cannot be confirmed.

## Search YouTube through Google

Use Google site-restricted search as the primary discovery method. Resolve the requested tracking window to explicit dates, then search:

`site:youtube.com "<competitor-name>" after:<start-date> before:<end-date>`

For example:

`site:youtube.com "competitor name" after:2026-08-09 before:2026-08-16`

Repeat the query with the competitor's company name, domain, official handles, and common name variants when applicable, and exhaust the relevant Google results. Treat Google dates and snippets only as discovery signals. Open every candidate YouTube link that may fall inside the requested window and verify the publication time on the original YouTube page. From that page, collect:

- Title
- Publication time
- Channel or creator name
- Clickable YouTube link
- View count
- Comment count

Do not report a candidate from the Google result alone. Include it only after opening the original YouTube link and confirming that its publication time is inside the requested window.

Identify official accounts from the competitor's website, app, or verified cross-links. Search both the official channel archives and YouTube or web search using the product name, company name, domain, official handles, common name variants, hashtags, referral codes, and links. Check both standard videos and Shorts. Do not exclude a candidate merely because the competitor is absent from its title; inspect the description and other visible video details. Open the original YouTube page, verify that its publication time falls inside the requested window, and deduplicate repeated links or reposted search results.

Return every qualifying item, not examples or an aggregate, separated into **Official** and **Non-official KOC/KOL promotions**. For each item list:

- Title
- Publication time
- Channel or creator name
- Clickable YouTube link
- View count
- Comment count

Use the exact displayed metrics observed during research. If YouTube hides or does not expose a field, write `Unavailable`; do not estimate it. If no qualifying items are found for a section, report zero and briefly state the accounts and searches checked plus any access limitations. In either output mode, preserve the complete source-level list; when the user selects a professional visual report, render that same list in HTML.
