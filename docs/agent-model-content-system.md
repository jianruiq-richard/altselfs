# Agent and model content system — review build, 2026-11-11

This extends the approved native-agent positioning and existing black/gold website. It is a local review build, not a production website deployment.

## Content and intent

- `/agents`: directory of the 11 published native integrations; every agent now has a reviewed introduction, source, suggested first task, setup path, funding boundary and context-handoff guidance.
- `/models`: 22 reviewed model pages, grouped by family with a working filter. Every page identifies the exact model and native agent, explains a use case and tradeoff, shows current server rates and provides a local token-cost estimator with a no-JavaScript example.
- Existing three guides connect agent switching, Claude Code/Codex workflows and shared Credits. They remain indexed and linked.
- The homepage retains its approved headline, copy, layout and visual system; Models is added to shared navigation and footer.
- 32 new public routes: 9 additional agent pages, 22 model pages and the model directory. The complete review export has 40 pages including the homepage, directories and existing guides.

Editorial content is in `src/lib/marketing/profiles.ts`. Each entry has a primary source and an explicit 2026-11-11 editorial check date. Task examples are original suggestions, not benchmark claims. Current news informed Kimi K3.1 Pro, Muse Ember, Fable 5.2 and the pinned DeepSeek releases. Published upstream capabilities are distinguished from the actual native integration and funded catalog. No search-volume numbers, ranking outcomes or traffic gains are invented; Search Console was not accessed.

## Live availability and prices

Agent availability, exact funded routes and prices are read from the existing product catalog. Pages do not create access or enable arbitrary upstream models. The editorial list is deliberately reviewed, not generated automatically from every provider entry.

- Kimi K3.1 Pro and Muse Ember were enabled separately in the Desktop production configuration and verified through real native calls.
- Gemini CLI, Cursor and CodeBuddy have introductions but no claim of a currently funded route.
- Unavailable catalog data suppresses the calculator and displays unknown availability. Missing exact model routes do not display fabricated prices.
- Rates normalize `microUSD` to Credits when needed. Cache-write rates are displayed where provided. The calculator covers uncached input, cached input and output; it clearly excludes cache writes and is not a total-task cap. Full turns can make multiple calls and round at settlement.
- Existing model URLs are stable editorial identities. Future provider changes should update reviewed content and availability rather than silently renaming an old route.

## Indexing and links

Each page has unique title/description, canonical URL, Open Graph data and breadcrumb JSON-LD. New routes join the sitemap. Unknown or nested model paths return 404/noindex. The old intelligence pages remain noindex and absent from the sitemap. Public old-domain redirects also cover `/models`; authentication/API routes are untouched. Model pages link to agents, sibling models, download and the context guide. Analytics classifies `/models` pages without retaining sensitive query strings.

No Search Console submission/removal was performed. After approval and deployment, submit the existing sitemap and inspect representative agent/model URLs; measure impressions, relevant queries and downloads before expanding the catalog further.

## Validation and design review

- Production Next.js webpack build, TypeScript and scoped ESLint passed.
- 93 Chrome viewport checks passed, spanning all content routes at 1440/320 and representative pages at 1024/768/390.
- Checks cover complete live catalog coverage, unique slugs, 404s, canonical/JSON-LD, images, overflow, price units, catalog failure, calculator invalid input, family filtering, mobile menu and no-script content.
- Existing homepage account-state and analytics regressions passed; no vendor events were sent by tests.
- Full static preview and screenshots are outside Git in `../altselfs-seo-review`; `scripts/export-seo-preview.mjs` regenerates them from `catalog.json`. The export is noindex and contains no production trackers.
- Visual review used desktop, tablet and phone screenshots. The page stays within the approved Minaco type/color/layout system. Body text and cost controls remain readable on mobile; section subhead spacing was increased after the first look.
- The generic design inspector is **not** a zero-warning gate here: it flags inherited header/footer hairlines, price labels as "eyebrows", lack of photography/motion, and the shared-header versus narrower article measure. These were retained to honor the user's explicit visual-consistency requirement and the reference-page reading task. Its name-only heading warning misses the visible model explanation directly below. No broken assets or horizontal overflow remained in the actual browser checks.

Review entry points: `/models`, `/models/kimi-k3-1-pro`, `/models/muse-ember`, `/agents/kimi-code`.
