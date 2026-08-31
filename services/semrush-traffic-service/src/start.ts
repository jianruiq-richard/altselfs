import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

let chromeProcess: ChildProcess | undefined;
let shuttingDown = false;

if (readBool('SEMRUSH_BROWSER_MANAGED', false)) {
  chromeProcess = await startManagedChrome();
}

await import('./index.js');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (!chromeProcess || chromeProcess.exitCode !== null) {
      process.exit(0);
      return;
    }
    const forceExit = setTimeout(() => {
      chromeProcess?.kill('SIGKILL');
      process.exit(0);
    }, 5_000);
    forceExit.unref();
    chromeProcess.once('exit', () => {
      clearTimeout(forceExit);
      process.exit(0);
    });
    chromeProcess.kill('SIGTERM');
  });
}

async function startManagedChrome() {
  const endpoint = new URL(process.env.SEMRUSH_BROWSER_CDP_ENDPOINT || 'http://127.0.0.1:9222');
  if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) {
    throw new Error('Managed Chrome CDP must bind to loopback only');
  }
  const port = Number(endpoint.port || '9222');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SEMRUSH_BROWSER_CDP_ENDPOINT must contain a valid port');
  }
  const profileDir = path.resolve(
    process.env.SEMRUSH_BROWSER_PROFILE_DIR?.trim() || '/data/semrush-browser-profile',
  );
  await fs.mkdir(profileDir, { recursive: true });
  if (readBool('SEMRUSH_BROWSER_CLEAR_STALE_LOCKS', true)) {
    await clearStaleChromeLocks(profileDir);
  }
  const executable = process.env.SEMRUSH_BROWSER_EXECUTABLE?.trim() || chromium.executablePath();
  const args = [
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-popup-blocking',
    '--disable-features=Translate,TranslateUI',
    '--disable-translate',
    '--hide-crash-restore-bubble',
    '--window-size=1440,1000',
  ];
  if (readBool('SEMRUSH_BROWSER_HEADLESS', false)) args.push('--headless=new');
  if (readBool('SEMRUSH_BROWSER_NO_SANDBOX', false)) args.push('--no-sandbox');
  args.push(process.env.SEMRUSH_BROWSER_DASHBOARD_URL?.trim()
    || 'https://dash.3ue.com/zh-Hans/#/page/m/home');

  const child = spawn(executable, args, { stdio: 'inherit' });
  child.once('exit', (code, signal) => {
    console.error(`[semrush-traffic] managed Chrome exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (!shuttingDown) process.exit(code || 1);
  });
  child.once('error', (error) => {
    console.error(`[semrush-traffic] could not start managed Chrome: ${error.message}`);
    if (!shuttingDown) process.exit(1);
  });
  await waitForCdp(endpoint.origin);
  console.log(`[semrush-traffic] managed Chrome ready on ${endpoint.origin}`);
  return child;
}

async function clearStaleChromeLocks(profileDir: string) {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const target = path.join(profileDir, name);
    const info = await fs.lstat(target).catch(() => undefined);
    if (!info?.isSymbolicLink()) continue;
    await fs.unlink(target);
    console.log(`[semrush-traffic] removed stale Chrome profile lock ${name}`);
  }
}

async function waitForCdp(endpoint: string) {
  const deadline = Date.now() + 30_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Managed Chrome did not expose CDP within 30 seconds: ${lastError}`);
}

function readBool(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}
