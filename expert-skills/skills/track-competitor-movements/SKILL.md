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
Help me investigate the following activity related to <product name, company name, domain, URL, or app link> from last week: KOC promotional videos or posts and organic discussion posts on YouTube, posts from official social media accounts, and any online or offline event interactions. List every result with the creator or poster name, title, link, publication date, and view or watch count.

For YouTube, identify candidate keywords and then run:
curl -L -A 'Mozilla/5.0' 'https://www.youtube.com/results?search_query=<product-name-keyword>&sp=EgIIAw%253D%253D'

Parse the page's ytInitialData in code and extract videoRenderer entries, videoId, title, channel, relative publication date, and view count. Then request:
https://www.youtube.com/watch?v=<videoId>

Parse ytInitialPlayerResponse to obtain and verify the exact publication date, full description, and view count.
```

## Short-range tool restriction

If the user requests an investigation covering one month or less, never use `altselfs_similarweb_api1`, `altselfs_semrush13`, or `altselfs_ahrefs_url_research`. These tools provide macro-level information at monthly granularity and are not suitable for shorter time ranges. Strictly follow the method above and delegate the prescribed command to Codex to collect acquisition activity across different platforms.
