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

Once both user intents above have been established, directly delegate the following command to Codex:

```text
Help me investigate the following activity related to <product name, company name, domain, URL, or app link> from last week: KOC promotional videos or posts and organic discussion posts on YouTube, posts from official social media accounts, and any online or offline event interactions. List every result with the creator or poster name, title, link, publication date, and view or watch count.

For YouTube, identify candidate keywords and then run:
curl -L -A 'Mozilla/5.0' 'https://www.youtube.com/results?search_query=<product-name-keyword>&sp=EgIIAw%253D%253D'

Parse the page's ytInitialData in code and extract videoRenderer entries, videoId, title, channel, relative publication date, and view count. Then request:
https://www.youtube.com/watch?v=<videoId>

Parse ytInitialPlayerResponse to obtain and verify the exact publication date, full description, and view count.
```
