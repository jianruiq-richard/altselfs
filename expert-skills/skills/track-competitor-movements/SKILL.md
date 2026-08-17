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

## Track YouTube publishing only

Perform exactly one research task: find all qualifying YouTube videos and Shorts published within the user's tracking window. Do not research any other platform or competitor-movement category.

Include:

1. Every video or Short published by the competitor's official YouTube account or accounts during the window.
2. Every promotional video or Short published during the window by a non-official KOC, KOL, creator, reviewer, affiliate, or other account. Treat sponsorships, endorsements, recommendations, product-led tutorials or reviews, affiliate links, referral or discount codes, and other clearly promotional treatments as qualifying.

## Do not use monthly aggregate tools

When the tracking window is one month or shorter, never use Similarweb, Semrush, or Ahrefs. Do not call these tools for discovery, evidence, or validation because their monthly-granularity data cannot establish which competitor actions occurred inside the requested date window. Use Google search and original YouTube pages instead.

## Extract YouTube metadata with Python

When normal page inspection does not expose the required fields, use Python on an execution host that can reach YouTube. Request the public watch URL with a normal desktop browser `User-Agent` and `Accept-Language`; do not require login cookies or bypass access controls.

Parse the JSON objects embedded after `var ytInitialPlayerResponse =` and `var ytInitialData =`. Start at the opening `{` and use `json.JSONDecoder().raw_decode` instead of a fragile regular expression. Extract:

- Title, channel, and view count from `videoDetails`; fall back to `videoPrimaryInfoRenderer`, `videoOwnerRenderer`, and `videoViewCountRenderer` in `ytInitialData`.
- Publication date from `microformat.playerMicroformatRenderer.publishDate` or `uploadDate`; fall back to a rendered `publishDate` or `dateText` in `ytInitialData`.
- Comment count from a digit-bearing `commentsEntryPointHeaderRenderer.commentCount` or `commentsHeaderRenderer.countText`.

If the page exposes only the generic word `Comments`, find the continuation token inside the comment `itemSectionRenderer`. Read `INNERTUBE_API_KEY`, `INNERTUBE_CLIENT_VERSION`, and, when present, `VISITOR_DATA` from the page. POST the client context and continuation token to `https://www.youtube.com/youtubei/v1/next?key=<INNERTUBE_API_KEY>`, then read the digit-bearing `commentsHeaderRenderer.countText` from the public response.

A `LOGIN_REQUIRED` player status does not by itself make the metadata unavailable: `ytInitialData` may still contain the public title, channel, view count, publication date, and comment continuation. Use only values actually present in YouTube's public responses. Record the retrieval time because view and comment counts change, and return `Unavailable` when a field cannot be verified.

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
