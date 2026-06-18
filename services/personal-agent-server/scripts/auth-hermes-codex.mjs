import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const kernelRoot =
  process.env.ALTSELFS_LOCAL_AGENT_KERNEL_ROOT ||
  process.env.ALTSELFS_LOCAL_KERNEL_ROOT ||
  "/private/tmp/altselfs-local-agent-kernel";
const hermesSourceRoot =
  process.env.ALTSELFS_HERMES_SOURCE_ROOT ||
  "/Users/richardjian/work/agent-sources/hermes-agent";
const hermesHome = process.env.HERMES_HOME || path.join(kernelRoot, "hermes-home", "local-user");

if (!existsSync(path.join(hermesHome, "config.yaml"))) {
  console.error(`Hermes home is not prepared: ${hermesHome}`);
  console.error("Run `npm run kernel:prepare` first.");
  process.exit(1);
}

const extraArgs = process.argv.slice(2);
const args = [
  "run",
  "--extra",
  "acp",
  "python",
  "-m",
  "hermes_cli.main",
  "auth",
  "add",
  "openai-codex",
  ...extraArgs,
];

console.log(`Hermes source: ${hermesSourceRoot}`);
console.log(`HERMES_HOME: ${hermesHome}`);
console.log("Starting Hermes openai-codex auth. This writes credentials only to the HERMES_HOME above.");

const result = spawnSync("uv", args, {
  cwd: hermesSourceRoot,
  env: {
    ...process.env,
    HERMES_HOME: hermesHome,
  },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
