import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBlueGreenGateway } from '../src/blue-green-gateway.js';
import { createHttpServer, type DeploymentControl } from '../src/http-server.js';

test('blue-green gateway changes upstream when the active color file changes', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'altselfs-blue-green-'));
  const activeColorFile = path.join(tempDir, 'active-color');
  const blue = createBackend('blue');
  const green = createBackend('green');
  const bluePort = await listen(blue);
  const greenPort = await listen(green);
  await fs.writeFile(activeColorFile, 'blue\n');

  const gateway = createBlueGreenGateway({
    activeColorFile,
    blueUpstream: `http://127.0.0.1:${bluePort}`,
    greenUpstream: `http://127.0.0.1:${greenPort}`,
  });
  const gatewayPort = await listen(gateway);

  t.after(async () => {
    await Promise.all([close(gateway), close(blue), close(green)]);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const blueResponse = await fetch(`http://127.0.0.1:${gatewayPort}/report?id=1`, {
    method: 'POST',
    body: 'payload',
  });
  assert.equal(blueResponse.status, 200);
  assert.equal(blueResponse.headers.get('x-altselfs-deployment-color'), 'blue');
  assert.deepEqual(await blueResponse.json(), {
    backend: 'blue',
    method: 'POST',
    path: '/report?id=1',
    body: 'payload',
  });

  await fs.writeFile(activeColorFile, 'green\n');
  const greenResponse = await fetch(`http://127.0.0.1:${gatewayPort}/report?id=2`);
  assert.equal(greenResponse.headers.get('x-altselfs-deployment-color'), 'green');
  assert.equal((await greenResponse.json()).backend, 'green');

  const healthResponse = await fetch(`http://127.0.0.1:${gatewayPort}/healthz`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).activeColor, 'green');
});

test('deployment control endpoints drain and reactivate a local backend', async (t) => {
  let state: 'accepting' | 'draining' = 'accepting';
  let activeDirectTurns = 0;
  const control: DeploymentControl = {
    beginDrain() {
      state = 'draining';
    },
    activate() {
      state = 'accepting';
    },
    beginDirectTurn() {
      if (state !== 'accepting') return false;
      activeDirectTurns += 1;
      return true;
    },
    endDirectTurn() {
      activeDirectTurns -= 1;
    },
    status() {
      return { state, activeDirectTurns, drained: state === 'draining' && activeDirectTurns === 0 };
    },
  };
  const backend = createHttpServer(null as never, undefined, undefined, control);
  const port = await listen(backend);
  t.after(() => close(backend));

  const drain = await fetch(`http://127.0.0.1:${port}/internal/deployment/drain`, { method: 'POST' });
  assert.equal(drain.status, 200);
  assert.equal((await drain.json()).drained, true);

  const activate = await fetch(`http://127.0.0.1:${port}/internal/deployment/activate`, { method: 'POST' });
  assert.equal(activate.status, 200);
  assert.equal((await activate.json()).state, 'accepting');
});

function createBackend(name: string) {
  return http.createServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      backend: name,
      method: req.method,
      path: req.url,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
}

async function listen(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind a TCP port');
  return address.port;
}

async function close(server: http.Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
