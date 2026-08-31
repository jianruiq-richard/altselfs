import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { defaultAgentProfiles } from '../src/agent-registry.js';
import type { ServerConfig } from '../src/config.js';
import {
  SEMRUSH_PAYMENT_DESTINATIONS_TOOL_NAME,
  createSemrushTrafficDynamictool,
  runSemrushTraffictool,
} from '../src/tools/semrush-traffic.js';

test('exposes the Semrush payment destinations dynamic tool', () => {
  const tool = createSemrushTrafficDynamictool();
  assert.equal(tool.name, SEMRUSH_PAYMENT_DESTINATIONS_TOOL_NAME);
  assert.deepEqual(tool.inputSchema.required, ['domain']);
  assert.deepEqual(tool.inputSchema.properties.months.enum, [6]);
});

test('advertises the Semrush tool on both non-local Codex profiles', () => {
  const profiles = defaultAgentProfiles();
  for (const profileId of ['codex-general', 'codex-competitive-intelligence']) {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    assert.ok(profile, `${profileId} profile should exist`);
    assert.ok(profile.tools.includes(SEMRUSH_PAYMENT_DESTINATIONS_TOOL_NAME));
  }
});

test('proxies a fixed six-month request to the browser worker', async (t) => {
  let receivedBody: unknown;
  let receivedAuthorization = '';
  const server = http.createServer(async (req, res) => {
    receivedAuthorization = req.headers.authorization || '';
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ source: 'semrush-browser-ui', data: { paymentOutboundVisits: 28_000 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP');

  process.env.TEST_SEMRUSH_SERVICE_TOKEN = 'test-token';
  t.after(() => delete process.env.TEST_SEMRUSH_SERVICE_TOKEN);
  const config = {
    semrushTrafficToolEnabled: true,
    semrushTrafficServiceUrl: `http://127.0.0.1:${address.port}`,
    semrushTrafficServiceTokenEnv: 'TEST_SEMRUSH_SERVICE_TOKEN',
    semrushTrafficRequestTimeoutMs: 5_000,
  } as unknown as ServerConfig;

  const result = JSON.parse(await runSemrushTraffictool({ domain: 'tapnow.ai', months: 1 }, config));
  assert.equal(result.data.paymentOutboundVisits, 28_000);
  assert.equal(receivedAuthorization, 'Bearer test-token');
  assert.deepEqual(receivedBody, { domain: 'tapnow.ai', months: 6 });
});
