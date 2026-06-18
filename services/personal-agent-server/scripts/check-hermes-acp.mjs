import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_HERMES_ROOT = "/Users/richardjian/work/agent-sources/hermes-agent";
const DEFAULT_KERNEL_ROOT = "/private/tmp/altselfs-local-agent-kernel";

const hermesRoot = process.env.ALTSELFS_HERMES_SOURCE_ROOT || DEFAULT_HERMES_ROOT;
const userId = process.env.ALTSELFS_LOCAL_AGENT_USER || "local-user";
const hermesHome =
  process.env.HERMES_HOME ||
  join(
    process.env.ALTSELFS_LOCAL_AGENT_KERNEL_ROOT || DEFAULT_KERNEL_ROOT,
    "hermes-home",
    userId,
  );

if (!existsSync(join(hermesRoot, "pyproject.toml"))) {
  console.error(`Hermes source not found: ${hermesRoot}`);
  process.exit(1);
}

if (!existsSync(join(hermesHome, "config.yaml"))) {
  console.error(`Hermes home is not prepared: ${hermesHome}`);
  console.error("Run npm run kernel:prepare first.");
  process.exit(1);
}

const uv = spawnSync("uv", ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (uv.status !== 0) {
  console.error("uv is required to run Hermes from source.");
  process.exit(1);
}

console.log(`Using ${uv.stdout.trim()}`);
console.log(`Hermes source: ${hermesRoot}`);
console.log(`HERMES_HOME: ${hermesHome}`);

const check = spawnSync(
  "uv",
  ["run", "--extra", "acp", "python", "-m", "acp_adapter.entry", "--check"],
  {
    cwd: hermesRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
    },
    stdio: "inherit",
  },
);

process.exit(check.status ?? 1);
