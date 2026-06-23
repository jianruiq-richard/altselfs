import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(serviceRoot, '..', '..');
const outputRoot = path.resolve(
  process.env.SOURCE_RUNTIME_BUILD_CONTEXT || '/tmp/altselfs-personal-agent-source-runtime-context'
);
const codexRoot = path.resolve(
  process.env.ALTSELFS_CODEX_SOURCE_ROOT || '/Users/richardjian/work/agent-sources/codex'
);
const hermesRoot = path.resolve(
  process.env.ALTSELFS_HERMES_SOURCE_ROOT || '/Users/richardjian/work/agent-sources/hermes-agent'
);
const cargoVendorRoot = path.resolve(
  process.env.ALTSELFS_CARGO_VENDOR_ROOT || '/tmp/altselfs-cargo-vendor'
);
const cargoVendorConfig = path.resolve(
  process.env.ALTSELFS_CARGO_VENDOR_CONFIG || '/tmp/altselfs-cargo-vendor-config.toml'
);
const rustyV8Archive = path.resolve(
  process.env.ALTSELFS_RUSTY_V8_ARCHIVE ||
    '/tmp/altselfs-rusty-v8/librusty_v8_release_x86_64-unknown-linux-gnu.a'
);

function ensurePath(value, label) {
  if (!existsSync(value)) {
    throw new Error(`${label} does not exist: ${value}`);
  }
}

function gitRevision(root) {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function gitStatus(root) {
  try {
    return execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function ignored(name, sourcePath, mode = 'source') {
  if (name === '.DS_Store' || name.startsWith('._')) return true;
  if (mode === 'vendor') return false;
  const parts = sourcePath.split(path.sep);
  return parts.some((part) =>
    [
      '.git',
      '.venv',
      '__pycache__',
      '.mypy_cache',
      '.pytest_cache',
      'node_modules',
      'target',
      'dist',
      'build',
      '.turbo',
      '.next',
    ].includes(part)
  );
}

function copyTree(source, destination, options = {}) {
  cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (sourcePath) => !ignored(path.basename(sourcePath), sourcePath, options.mode),
  });
}

ensurePath(path.join(codexRoot, 'codex-rs', 'Cargo.toml'), 'Codex source');
ensurePath(path.join(hermesRoot, 'pyproject.toml'), 'Hermes source');
ensurePath(cargoVendorRoot, 'Cargo vendor directory');
ensurePath(cargoVendorConfig, 'Cargo vendor config');
ensurePath(rustyV8Archive, 'rusty_v8 archive');

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
mkdirSync(path.join(outputRoot, 'personal-agent-server'), { recursive: true });
mkdirSync(path.join(outputRoot, 'agent-sources'), { recursive: true });

for (const entry of [
  'package.json',
  'tsconfig.json',
  'Dockerfile.source-runtime',
  'src',
]) {
  copyTree(path.join(serviceRoot, entry), path.join(outputRoot, 'personal-agent-server', entry));
}
copyTree(
  path.join(serviceRoot, 'Dockerfile.source-runtime'),
  path.join(outputRoot, 'Dockerfile.source-runtime')
);
copyTree(codexRoot, path.join(outputRoot, 'agent-sources', 'codex'));
copyTree(hermesRoot, path.join(outputRoot, 'agent-sources', 'hermes-agent'));
copyTree(cargoVendorRoot, path.join(outputRoot, 'cargo-vendor'), { mode: 'vendor' });
copyTree(cargoVendorConfig, path.join(outputRoot, 'cargo-vendor-config.toml'));
mkdirSync(path.join(outputRoot, 'rusty-v8'), { recursive: true });
copyTree(
  rustyV8Archive,
  path.join(outputRoot, 'rusty-v8', path.basename(rustyV8Archive))
);

writeFileSync(
  path.join(outputRoot, 'SOURCE_REVISIONS.txt'),
  [
    `altselfs_repo=${repoRoot}`,
    `codex_root=${codexRoot}`,
    `codex_revision=${gitRevision(codexRoot)}`,
    `codex_status=${JSON.stringify(gitStatus(codexRoot))}`,
    `hermes_root=${hermesRoot}`,
    `hermes_revision=${gitRevision(hermesRoot)}`,
    `hermes_status=${JSON.stringify(gitStatus(hermesRoot))}`,
    `cargo_vendor_root=${cargoVendorRoot}`,
    `cargo_vendor_config=${cargoVendorConfig}`,
    `rusty_v8_archive=${rustyV8Archive}`,
    '',
  ].join('\n'),
  'utf8'
);

console.log(`Source runtime Docker build context prepared: ${outputRoot}`);
console.log(`Codex source: ${codexRoot} @ ${gitRevision(codexRoot)}`);
console.log(`Hermes source: ${hermesRoot} @ ${gitRevision(hermesRoot)}`);
console.log(`Cargo vendor: ${cargoVendorRoot}`);
console.log(`rusty_v8 archive: ${rustyV8Archive}`);
