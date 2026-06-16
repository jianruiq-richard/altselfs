# Personal Agent Server Notes

This service should stay deployable independently from the Next.js app.

- Do not import code from `src/app` or React components.
- Keep the outer main-agent state store abstract so it can move from local dev
  memory to Aliyun RDS PostgreSQL.
- Keep Codex app-server integration behind `CodexAgentRuntime`.
- Do not modify vendored/open-source Codex or Hermes code here; consume their
  protocols and mirror proven patterns.

