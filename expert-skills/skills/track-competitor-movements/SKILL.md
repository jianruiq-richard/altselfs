---
name: track-competitor-movements
description: Track a competitor's recent product, pricing, acquisition, creator or KOC, partnership, and distribution moves, then estimate likely user and revenue impact. Use for weekly or recent competitor monitoring. Also use when the current message is only a product name, company name, domain, URL, or app link and earlier messages in the same conversation established this monitoring intent.
---

# Track Competitor Movements

## Action

1. If the target competitor is not known from the current message or conversation history, ask for it.
2. Treat a bare product name, domain, URL, or app link following that question as the target and continue without asking the user to repeat the task.
3. Gather current evidence through Codex and record event date, source, captured metric, and verification status.
4. Separate shipped, announced, tested, promoted, rumored, and inferred events; deduplicate reports of the same move.
5. Validate raw exposure before estimating impact, then provide low/base/high impact only where supported.

## Expert knowledge

- Events and sources that must be monitored: TODO
- Exposure validity and attribution rules: TODO
- User, paid-user, and revenue impact models: TODO
- Comparable cases and applicable conditions: TODO

Until a rule is filled, state the assumption and keep the conclusion provisional. Do not imply causality from timing alone.

## Output

Return a dated event list, what changed, verification status, raw versus effective exposure, estimated impact ranges, assumptions, confidence, alternative explanations, and next monitoring actions.
