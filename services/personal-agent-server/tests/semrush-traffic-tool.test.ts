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
  assert.equal(tool.inputSchema.properties.month.pattern, '^\\d{4}-(?:0[1-9]|1[0-2])$');
  assert.match(tool.description, /specific calendar month/);
});

test('advertises the Semrush tool on both non-local Codex profiles', () => {
  const profiles = defaultAgentProfiles();
  for (const profileId of ['codex-general', 'codex-competitive-intelligence']) {
    const profile = profiles.find((candidate) => candidate.id === profileId);
    assert.ok(profile, `${profileId} profile should exist`);
    assert.ok(profile.tools.includes(SEMRUSH_PAYMENT_DESTINATIONS_TOOL_NAME));
  }
});

test('proxies default six-month and specified-month requests to the browser worker', async (t) => {
  const receivedBodies: unknown[] = [];
  let receivedAuthorization = '';
  const server = http.createServer(async (req, res) => {
    receivedAuthorization = req.headers.authorization || '';
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    receivedBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
  assert.deepEqual(receivedBodies[0], { domain: 'tapnow.ai', months: 6 });

  const exactMonthResult = JSON.parse(await runSemrushTraffictool({
    domain: 'tapnow.ai',
    month: '2026-05',
  }, config));
  assert.equal(exactMonthResult.data.paymentOutboundVisits, 28_000);
  assert.deepEqual(receivedBodies[1], { domain: 'tapnow.ai', month: '2026-05' });

  const invalidCombination = JSON.parse(await runSemrushTraffictool({
    domain: 'tapnow.ai',
    month: '2026-05',
    months: 6,
  }, config));
  assert.equal(invalidCombination.error, 'month cannot be combined with months');
  assert.equal(receivedBodies.length, 2);
});
