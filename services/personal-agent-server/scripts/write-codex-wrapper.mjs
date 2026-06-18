import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const codexRoot =
  process.env.ALTSELFS_CODEX_SOURCE_ROOT ||
  "/Users/richardjian/work/agent-sources/codex";
const targetDebugDir = join(codexRoot, "codex-rs", "target", "debug");
const codexWrapperBin = join(targetDebugDir, "codex");
const appServerBin = join(targetDebugDir, "codex-app-server");

if (!existsSync(appServerBin)) {
  console.error(`Codex app-server binary not found: ${appServerBin}`);
  console.error("Run `npm run kernel:build-codex` first.");
  process.exit(1);
}

writeFileSync(
  codexWrapperBin,
  [
    "#!/bin/sh",
    "set -eu",
    'if [ "${1:-}" = "app-server" ]; then',
    "  shift",
    `  exec "${appServerBin}" "$@"`,
    "fi",
    'echo "This lightweight Altselfs Codex wrapper only supports: codex app-server" >&2',
    "exit 64",
    "",
  ].join("\n"),
  "utf8",
);
chmodSync(codexWrapperBin, 0o755);

console.log("Codex lightweight wrapper written.");
console.log(`CODEX_BIN=${codexWrapperBin}`);
