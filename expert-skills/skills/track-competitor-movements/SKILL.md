---
name: track-competitor-movements
description: Must use when the user asks to track a competitor's recent product updates, acquisition moves, and likely user and revenue impact.
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

For YouTube, identify candidate keywords. Use Python (not Node.js) to invoke the system `curl` binary via `subprocess` with the following command and capture the returned HTML:
curl -L -A 'Mozilla/5.0' 'https://www.youtube.com/results?search_query=<product-name-keyword>&sp=EgIIAw%253D%253D'

Use Python to parse the returned HTML's `ytInitialData` and extract `videoRenderer` entries, `videoId`, title, channel, relative publication date, and view count. Then use the same Python `subprocess` and system `curl` approach to request:
https://www.youtube.com/watch?v=<videoId>

Use Python to parse `ytInitialPlayerResponse` and obtain and verify the exact publication date, full description, and view count.

For X, TikTok, Instagram, Reddit, Facebook, and LinkedIn, you can directly use Python and Google Search. Parallelize tasks where possible, keep the process concise, minimize verification, and prioritize speed over strict accuracy.

## Short-range tool restriction

If the user requests an investigation covering one month or less, never use `altselfs_similarweb_api1`, `altselfs_semrush13`, or `altselfs_ahrefs_url_research`. These tools provide macro-level information at monthly granularity and are not suitable for shorter time ranges. Strictly follow the method above and delegate the prescribed command to Codex to collect acquisition activity across different platforms.
```


## Professional visual report requirements

If the user requests a **Professional visual report**:

- Include every lead found on every platform in the HTML report. If the content is long, organize it with tabs that let the reader switch between platforms.
- Match the visual language of Minaco.ai: warm black backgrounds (`#090909` and `#050505`), warm-ivory text (`#FFFAF0`), translucent warm-black panels, thin ivory borders, honey-gold primary accents (`#F2C36B`), soft gold (`#F8DFAA`), muted coral (`#E86F61`), and restrained green (`#78C889`). Use gentle gold and coral radial glows, compact 7–10 px radii, precise spacing, understated shadows, sans-serif body text, and a high-contrast serif only for the Minaco wordmark or selective editorial headings. Avoid a generic blue-purple AI dashboard aesthetic.
- Load `assets/minaco-logo-horizontal-on-dark.svg` with `skill_view` and include the exact SVG content in Codex's rendering instructions. Place it clearly in the report header, preserve its aspect ratio, and embed the SVG inline so the single HTML file never depends on an internal path or a separately uploaded logo file.
- Ask Codex to render the finished report only after determining the final evidence inventory, data, calculations, analysis, conclusions, ordered structure, chart datasets, design tokens, and logo SVG. Codex must implement that specification without deciding the report's substance.
- Make the HTML responsive and readable on desktop and mobile. Prefer inline SVG or CSS charts; when an external chart library is necessary, pin its version and retain readable values if the library fails to load.
- Save each report under a distinct, descriptive filename using the product name and generation time, such as `outputs/<product-slug>-competitor-analysis-<YYYYMMDD-HHMMSS>.html`. Never reuse another product's report filename.
