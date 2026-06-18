import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CODEX_ROOT = "/Users/richardjian/work/agent-sources/codex";
const DEFAULT_HERMES_ROOT = "/Users/richardjian/work/agent-sources/hermes-agent";
const DEFAULT_KERNEL_ROOT = "/private/tmp/altselfs-local-agent-kernel";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..", "..");

const codexRoot = process.env.ALTSELFS_CODEX_SOURCE_ROOT || DEFAULT_CODEX_ROOT;
const hermesRoot = process.env.ALTSELFS_HERMES_SOURCE_ROOT || DEFAULT_HERMES_ROOT;
const kernelRoot =
  process.env.ALTSELFS_LOCAL_AGENT_KERNEL_ROOT ||
  process.env.ALTSELFS_LOCAL_KERNEL_ROOT ||
  DEFAULT_KERNEL_ROOT;
const userId = process.env.ALTSELFS_LOCAL_AGENT_USER || "local-user";
const codexProviderMode = process.env.ALTSELFS_CODEX_PROVIDER_MODE || "openrouter";
const hermesProviderMode = process.env.ALTSELFS_HERMES_PROVIDER_MODE || codexProviderMode;
const codexModel = process.env.ALTSELFS_CODEX_MODEL || "deepseek/deepseek-v3.2";
const hermesModel = process.env.ALTSELFS_HERMES_MODEL || codexModel;
const codexBin =
  process.env.CODEX_BIN ||
  join(codexRoot, "codex-rs", "target", "debug", "codex");

const hermesHome = join(kernelRoot, "hermes-home", userId);
const codexHome = join(kernelRoot, "codex-home", userId);
const workspace = join(kernelRoot, "workspace", userId);

function requirePath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function readEnvValue(name) {
  if (process.env[name]) {
    return process.env[name];
  }
  for (const envFile of [join(repoRoot, ".env.local"), join(repoRoot, ".env")]) {
    if (!existsSync(envFile)) {
      continue;
    }
    const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || match[1] !== name) {
        continue;
      }
      return match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
  return "";
}

requirePath(join(codexRoot, "codex-rs", "Cargo.toml"), "Codex source");
requirePath(join(hermesRoot, "pyproject.toml"), "Hermes source");

mkdirSync(hermesHome, { recursive: true });
mkdirSync(codexHome, { recursive: true });
mkdirSync(workspace, { recursive: true });

const hermesConfig = `model:
  # Hermes owns the outer loop. With the local OpenRouter runtime patch applied,
  # this provider can still enter the Codex app-server runtime.
  provider: ${hermesProviderMode}
  default: "${hermesModel}"
  openai_runtime: codex_app_server

terminal:
  cwd: "${workspace}"

display:
  tool_activity: compact
`;

const codexOpenRouterConfig = `model = "${codexModel}"
model_provider = "openrouter"
web_search = "live"
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = true
writable_roots = ["${workspace}"]

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"
requires_openai_auth = false
`;

const codexOpenAiConfig = `model = "${hermesModel}"
model_provider = "openai"
web_search = "live"
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = true
writable_roots = ["${workspace}"]
`;

const codexConfig =
  codexProviderMode === "openai" ? codexOpenAiConfig : codexOpenRouterConfig;

writeFileSync(join(hermesHome, "config.yaml"), hermesConfig, "utf8");
writeFileSync(join(codexHome, "config.toml"), codexConfig, "utf8");

const envLines = [
  "# Local-only kernel env. Do not commit this file.",
  `HERMES_HOME=${hermesHome}`,
  `CODEX_HOME=${codexHome}`,
  `PATH=${join(codexRoot, "codex-rs", "target", "debug")}:$PATH`,
];

const openRouterApiKey = readEnvValue("OPENROUTER_API_KEY");
if (openRouterApiKey) {
  envLines.push(`OPENROUTER_API_KEY=${openRouterApiKey}`);
} else {
  envLines.push("# OPENROUTER_API_KEY=sk-or-...");
}

writeFileSync(join(hermesHome, ".env"), `${envLines.join("\n")}\n`, "utf8");

console.log("Local controlled kernel files prepared.");
console.log(`HERMES_HOME=${hermesHome}`);
console.log(`CODEX_HOME=${codexHome}`);
console.log(`WORKSPACE=${workspace}`);
console.log(`CODEX_BIN=${codexBin}`);
console.log(`hermesProviderMode=${hermesProviderMode}`);
console.log(`codexProviderMode=${codexProviderMode}`);
console.log("\nNext checks:");
console.log("  npm run sources:inspect");
console.log("  npm run kernel:patch-hermes-openrouter");
console.log("  npm run kernel:build-codex");
console.log("  npm run kernel:hermes-check");
