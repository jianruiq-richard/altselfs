# Minaco expert Skill library

This directory is the authoring source for the centrally managed, read-only Hermes Skill library. It is deliberately separate from the Hermes bundled Skill tree and from per-user `HERMES_HOME` data.

The first release maps directly to the product's three entry scenarios:

| Skill | Product entry scenario | Edit here |
| --- | --- | --- |
| `estimate-competitor-scale` | Estimate competitor users, countries, growth, acquisition, paid users, and revenue | `estimate-competitor-scale/SKILL.md` and `references/case-library.md` |
| `track-competitor-movements` | Track recent product/acquisition moves and estimate impact | `track-competitor-movements/SKILL.md` |
| `find-first-100-seed-users` | Find the first 100 qualified seed users | `find-first-100-seed-users/SKILL.md` |

## Editing contract

- The first version normally keeps each Skill in one `SKILL.md`.
- Put new knowledge directly under `## Expert knowledge` in the matching file.
- Put first-scenario commercial cases in `estimate-competitor-scale/references/case-library.md`.
- Split detailed knowledge into `references/` only when one `SKILL.md` becomes large or contains branches that should not always be loaded.
- For numerical cases, record provenance, date, confidence, and when the case does or does not apply.
- Do not fill unknown values with generic model knowledge. Leave `TODO` until an expert rule is approved.
- Review changes in Git. A content release should have a release ID even if application code does not change.

## Validate locally

Run the repository validator before publishing:

```bash
node expert-skills/scripts/validate-skills.mjs
```

Then forward-test at least one matching request, one ambiguous request, and one request that must not trigger each Skill.

## Publish to ECS

Keep immutable content releases on the host:

```text
/data/altselfs-expert-skills/
  releases/
    <release-id>/
      skills/
  current -> releases/<release-id>
```

After the pushed commit's ACR build succeeds, deploy from the same clean commit:

```bash
ECS_SSH_TARGET=root@YOUR_ECS_HOST \
bash infra/aliyun/ecs/deploy-personal-agent-server-from-workspace.sh
```

The helper packages the complete Skill tree and the ECS script installs it as
`git-<commit>`, switches `current`, pulls the ACR image, and force-recreates the
container. The Compose deployment mounts
`/data/altselfs-expert-skills/current/skills` at
`/opt/altselfs/expert-skills:ro`. Every user session receives that same external
directory through Hermes's native `skills.external_dirs` configuration.

If startup health fails, the deployment script restores the previous Skill
mapping and previous local image. Old immutable Skill releases remain available
for manual rollback.

For local development, set `HERMES_EXPERT_SKILLS_HOST_DIR` to the absolute path of this repository's `expert-skills/skills` directory before starting Compose.
