import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_CODEX_ROOT = "/Users/richardjian/work/agent-sources/codex";
const DEFAULT_HERMES_ROOT = "/Users/richardjian/work/agent-sources/hermes-agent";

const codexRoot = process.env.ALTSELFS_CODEX_SOURCE_ROOT || DEFAULT_CODEX_ROOT;
const hermesRoot = process.env.ALTSELFS_HERMES_SOURCE_ROOT || DEFAULT_HERMES_ROOT;

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function toolVersion(command, args) {
  const result = run(command, args, process.cwd());
  return result.ok ? result.stdout || "(ok)" : "missing";
}

function gitCommit(root) {
  if (!existsSync(join(root, ".git"))) return "not a git checkout";
  const result = run("git", ["rev-parse", "HEAD"], root);
  return result.ok ? result.stdout : `unknown (${result.stderr || result.status})`;
}

const checks = [
  {
    name: "Codex source root",
    path: codexRoot,
    required: [
      "codex-rs/Cargo.toml",
      "codex-rs/app-server/README.md",
      "codex-rs/app-server-test-client/README.md",
    ],
  },
  {
    name: "Hermes source root",
    path: hermesRoot,
    required: [
      "pyproject.toml",
      "uv.lock",
      "acp_adapter/entry.py",
      "agent/transports/codex_app_server.py",
      "agent/transports/codex_app_server_session.py",
      "website/docs/user-guide/features/codex-app-server-runtime.md",
    ],
  },
];

let failed = false;

for (const check of checks) {
  console.log(`\n${check.name}`);
  console.log(`  path: ${check.path}`);
  console.log(`  exists: ${existsSync(check.path) ? "yes" : "no"}`);
  console.log(`  commit: ${gitCommit(check.path)}`);
  for (const relative of check.required) {
    const ok = existsSync(join(check.path, relative));
    console.log(`  ${ok ? "ok" : "missing"} ${relative}`);
    failed ||= !ok;
  }
}

console.log("\nLocal tools");
console.log(`  node: ${toolVersion("node", ["--version"])}`);
console.log(`  uv: ${toolVersion("uv", ["--version"])}`);
console.log(`  python3: ${toolVersion("python3", ["--version"])}`);
console.log(`  cargo: ${toolVersion("cargo", ["--version"])}`);

if (failed) {
  process.exitCode = 1;
}
