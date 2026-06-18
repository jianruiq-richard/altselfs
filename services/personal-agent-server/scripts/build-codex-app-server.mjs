import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_CODEX_ROOT = "/Users/richardjian/work/agent-sources/codex";
const DEFAULT_CARGO_HOME = "/private/tmp/altselfs-cargo-home";
const DEFAULT_PYTHON = "/opt/anaconda3/bin/python3";
const codexRoot = process.env.ALTSELFS_CODEX_SOURCE_ROOT || DEFAULT_CODEX_ROOT;
const codexRsRoot = join(codexRoot, "codex-rs");
const buildMode = process.env.ALTSELFS_CODEX_BUILD_MODE || "app-server";
const targetDebugDir = join(codexRsRoot, "target", "debug");
const codexWrapperBin = join(targetDebugDir, "codex");
const appServerBin = join(targetDebugDir, "codex-app-server");
const cliBin = join(targetDebugDir, "codex");
const cargoRegistryMirror = process.env.ALTSELFS_CARGO_REGISTRY_MIRROR || "";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!existsSync(join(codexRsRoot, "Cargo.toml"))) {
  fail(`Codex Rust workspace not found: ${codexRsRoot}`);
}

const cargo = spawnSync("cargo", ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (cargo.status !== 0) {
  fail(
    [
      "Cargo is not installed, so Codex cannot be built from source yet.",
      "Install Rust first, then rerun:",
      "  npm run kernel:build-codex",
    ].join("\n"),
  );
}

console.log(`Using ${cargo.stdout.trim()}`);
console.log(`Building Codex from ${codexRsRoot}`);
console.log(`Build mode: ${buildMode}`);

const cargoEnv = { ...process.env };

if (cargoRegistryMirror) {
  const mirrorUrl =
    cargoRegistryMirror === "tuna"
      ? "sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/"
      : cargoRegistryMirror;
  const cargoHome = process.env.CARGO_HOME || DEFAULT_CARGO_HOME;
  mkdirSync(cargoHome, { recursive: true });
  writeFileSync(
    join(cargoHome, "config.toml"),
    [
      "[source.crates-io]",
      'replace-with = "altselfs-mirror"',
      "",
      "[source.altselfs-mirror]",
      `registry = "${mirrorUrl}"`,
      "",
    ].join("\n"),
    "utf8",
  );
  cargoEnv.CARGO_HOME = cargoHome;
  console.log(`Using Cargo registry mirror: ${mirrorUrl}`);
  console.log(`CARGO_HOME=${cargoHome}`);
}

cargoEnv.CARGO_PROFILE_DEV_DEBUG ??= "0";
cargoEnv.CARGO_BUILD_JOBS ??= "2";
if (!cargoEnv.PYTHON && existsSync(DEFAULT_PYTHON)) {
  cargoEnv.PYTHON = DEFAULT_PYTHON;
}

const buildArgs =
  buildMode === "cli"
    ? ["build", "-p", "codex-cli", "--bin", "codex"]
    : ["build", "-p", "codex-app-server", "--bin", "codex-app-server"];

const build = spawnSync("cargo", buildArgs, {
  cwd: codexRsRoot,
  env: cargoEnv,
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

if (buildMode === "cli") {
  if (!existsSync(cliBin)) {
    fail(`Build finished but expected binary was not found: ${cliBin}`);
  }
  console.log("\nCodex CLI source build ready.");
  console.log(`CODEX_BIN=${cliBin}`);
  process.exit(0);
}

if (!existsSync(appServerBin)) {
  fail(`Build finished but expected binary was not found: ${appServerBin}`);
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

console.log("\nCodex app-server source build ready.");
console.log(`APP_SERVER_BIN=${appServerBin}`);
console.log(`CODEX_BIN=${codexWrapperBin}`);
console.log("Hermes can call this wrapper as: codex app-server");
