---
name: track-competitor-movements
description: Must use when the user asks to track a competitor's acquisition moves.
---

## Establish scope and output

Before starting research, establish both the target product and the output mode. If either is missing, ask for the missing choices together in one short message:

1. The competitor: product name, company name, domain, URL, or exact app link.
2. The output mode:
   - **Quick data:** evidence and decisive analysis in chat; no HTML.
   - **Professional visual report:** a complete, presentation-ready HTML report. Warn that this can take around 10 minutes.

Ask for all missing choices in one short message. Never ask again for information already established in the conversation. Treat a bare target supplied after your question as the answer and continue. Do not start the professional-report workflow until the user chooses it.

Once both user intents above have been established, directly delegate the following command EXACTLY to Codex when you investigate acquisition moves, as these commands are carefully polished for best practices:

```text
Help me investigate the following activity related to <product name, company name, domain, URL, or app link> from last week: KOC promotional videos or posts and organic discussion posts on YouTube, X, TikTok, Instagram, Reddit, Facebook, and LinkedIn, posts from official social media accounts, and any online or offline event interactions. List every result with the creator or poster name, title, link, publication date, and view or watch count. Complete the task in parallel wherever possible rather than sequentially.

For YouTube, use this ordered workflow:
1. Primary method: identify candidate keywords from the current investigation, beginning with the verified product name, domain, and official channel name, then adding model names, campaign names, product features, creator terminology, and aliases supported by current evidence; do not use only a bare brand keyword. For each keyword, use Python, not Node.js, to invoke the system `curl` binary through `subprocess` and capture the YouTube search HTML returned by `curl -L -A 'Mozilla/5.0' 'https://www.youtube.com/results?search_query=<keyword>&sp=<upload-date-filter>'`.
2. Search-window rule: choose an upload-date filter broad enough to contain the entire requested interval, then enforce the exact interval locally. For the preceding local calendar week, use the YouTube `this_month` filter (`sp=EgIIBA%253D%253D`) when that week is not fully contained in the rolling `this_week` filter; if the requested interval crosses a month boundary or is not fully covered by a known filter, omit the upload-date filter. Never rely on the fixed `this_week` value `EgIIAw%253D%253D` when it would truncate the requested calendar window.
3. Extraction and verification: parse each search page's `ytInitialData` and extract `videoRenderer` entries, including `videoId`, title, channel, relative publication date, and view count. Deduplicate candidates by `videoId`. For every candidate that may overlap the requested interval, use the same Python `subprocess` and system `curl` approach to request `https://www.youtube.com/watch?v=<videoId>`, then parse `ytInitialPlayerResponse` to obtain and verify the exact publication date, full description, channel id, channel name, and view count. Apply the exact inclusive `since` and `until` timestamps, distinguish the verified official channel from creator/KOC channels, and classify promotion evidence from brand links, `source`/UTM parameters, affiliate links, offer language, and conversion calls to action. A keyword match alone is not proof of payment.
4. Fallback method: call `altselfs_youtube_competitor_activity` only when the primary HTML method is blocked, unavailable, rate-limited, returns unparsable or materially incomplete `ytInitialData`/`ytInitialPlayerResponse`, cannot verify the official channel when official activity is required, or fails for a material subset of search or video pages. Pass the target, exact `since` and `until`, a known `channelId` or expected `channelName` when available, `includeOfficial: true`, `includeKoc: true`, `includeShorts: true`, and evidence-based corrected aliases or campaign keywords through `keywords`. If the primary method succeeds partially, use the tool only for the missing coverage and merge results by `videoId`, preserving the primary results.
5. Completion rule: a successful primary-method scan with zero verified in-range videos is a valid result and does not by itself trigger fallback. Clearly disclose search filters, keywords, pages checked, verification failures, fallback usage, and remaining coverage limitations.

Resolve the user's requested period into exact inclusive ISO-8601 `since` and `until` timestamps using the current date and the user's timezone. For example, interpret “last week” as the preceding local calendar week, not as a hard-coded rolling number of days. Pass those exact timestamps to every social activity tool; never let a data tool invent or replace the requested time range.

For Instagram, call `altselfs_instagram_competitor_activity` with the target product/domain, exact `since` and `until`, `includeOfficial: true`, and `includeKoc: true`. Treat results under `official.posts` as official activity. Treat results under `koc.posts` as KOC or creator promotion candidates, use `promotionSignals` and `promotionConfidence` to distinguish likely collaborations or affiliate promotion from organic tagged mentions, and retain the tool's coverage limitations. Use direct web search only to supplement public Instagram posts that this tool may miss; do not replace the tool call with Google Search when the Instagram data source is enabled.

For TikTok, use the general-purpose `altselfs_tiktok_api23` tool as a separate platform workflow:
1. Account discovery: if reliable evidence already provides an exact handle, call `user_info` with `uniqueId`. Otherwise call `account_search` with a query chosen from the current target and evidence. Verify any claimed official account from returned profile evidence such as its bio link, signature, name, or links found on the official website; do not assume that a domain or product name is the handle.
2. Official posts: after obtaining the selected profile's `secUid`, call `user_posts` with that `secUid`, caller-chosen pagination parameters, and the exact `since` and `until`. Treat posts as official only after the account assessment above.
3. Creator and KOC discovery: call `video_search` and/or `post_discover` with keywords and pagination chosen for the current investigation, plus the same exact `since` and `until`. Do not embed a fixed keyword list. Exclude the assessed official account during analysis, not inside the tool.
4. Classification: interpret raw captions, author identity, `isAd`, mentions, links, offer codes, engagement, and other returned evidence at the investigation layer.
5. Coverage: follow returned cursors or pages when the task calls for broader coverage and budget permits. Preserve the provider limitations, and use direct web search only to supplement public TikTok content the provider may miss when the TikTok data source is enabled.

For X, use this ordered workflow:
1. Primary method: always call `altselfs_x_competitor_activity` first with the target product/domain and the exact `since` and `until` timestamps. Set `includeOfficial: true`, `includeKoc: true`, `includeOrganic: true`, and `includeReplies: true`. Pass an exact `username` only when established by reliable evidence. Pass corrected product names, domains, campaign terms, handles, or aliases established during the investigation through `keywords`; never embed target-specific names in the workflow.
2. Evidence use: treat `official.posts` as activity from the resolved official account. Treat `koc.posts` as creator/KOC promotion candidates and `organic.posts` as relevant discussion candidates. Preserve each permalink, publication timestamp, views, engagement, `relevanceSignals`, `promotionSignals`, and `promotionConfidence`. Never present a search match or heuristic classification as proof of payment, sponsorship, gifting, affiliation, or another commercial relationship.
3. Completion rule: accept a successful response containing zero in-range posts as a valid result. Trigger fallback only when the tool is unavailable or disabled, lacks its RapidAPI key, returns a request/provider/rate-limit error, cannot resolve the official account when official activity is required, or reports collection errors that leave the requested coverage materially incomplete. If only one section fails, use fallback only for that missing section and retain successful tool results.
4. Supplementation rule: use direct web search to supplement provider omissions and to inspect ambiguous evidence, but never skip the primary tool while the X data source is enabled and healthy. Deduplicate supplemental results against primary results by status ID or canonical permalink.

For Reddit, Facebook, and LinkedIn, you can directly use Python and Google Search. Parallelize tasks where possible, keep the process concise, minimize verification, and prioritize speed over strict accuracy.

## Short-range tool restriction

If the user requests an investigation covering one month or less, never use `altselfs_similarweb_api1`, `altselfs_semrush13`, or `altselfs_ahrefs_url_research`. These tools provide macro-level information at monthly granularity and are not suitable for shorter time ranges. `altselfs_instagram_competitor_activity`, `altselfs_x_competitor_activity`, `altselfs_tiktok_api23`, and `altselfs_youtube_competitor_activity` are explicitly allowed and preferred for Instagram, X, TikTok, and YouTube in short-range investigations. Strictly follow the method above and delegate the prescribed command to Codex to collect acquisition activity across different platforms.
```


## Professional visual report requirements

If the user requests a **Professional visual report**:

- Include every lead found on every platform in the HTML report. If the content is long, organize it with tabs that let the reader switch between platforms.
- Match the visual language of Minaco.ai: warm black backgrounds (`#090909` and `#050505`), warm-ivory text (`#FFFAF0`), translucent warm-black panels, thin ivory borders, honey-gold primary accents (`#F2C36B`), soft gold (`#F8DFAA`), muted coral (`#E86F61`), and restrained green (`#78C889`). Use gentle gold and coral radial glows, compact 7–10 px radii, precise spacing, understated shadows, sans-serif body text, and a high-contrast serif only for the Minaco wordmark or selective editorial headings. Avoid a generic blue-purple AI dashboard aesthetic.
- Load `assets/minaco-logo-horizontal-on-dark.svg` with `skill_view` and include the exact SVG content in Codex's rendering instructions. Place it clearly in the report header, preserve its aspect ratio, and embed the SVG inline so the single HTML file never depends on an internal path or a separately uploaded logo file.
- Ask Codex to render the finished report only after determining the final evidence inventory, data, calculations, analysis, conclusions, ordered structure, chart datasets, design tokens, and logo SVG. Codex must implement that specification without deciding the report's substance.
- Make the HTML responsive and readable on desktop and mobile. Prefer inline SVG or CSS charts; when an external chart library is necessary, pin its version and retain readable values if the library fails to load.
- Save each report under a distinct, descriptive filename using the product name and generation time, such as `outputs/<product-slug>-competitor-analysis-<YYYYMMDD-HHMMSS>.html`. Never reuse another product's report filename.
