import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisibleConnectors } from './investor-connector-visibility';

test('Gmail and Lark stay hidden regardless of connection status or cached defaults', () => {
  for (const connected of [false, true]) {
    const cachedConnectors = ['gmail', 'feishu', 'lark'].map((key) => ({
      key,
      connected,
      enabledByDefault: true,
      conversationAvailable: true,
      connectionIds: [`${key}-account`],
    }));
    assert.deepEqual(getVisibleConnectors(cachedConnectors), []);
  }
});

test('all existing visible intelligence connectors retain their order and settings', () => {
  const connectors = [
    'instagram_looter2', 'twitter241', 'tiktok_api23', 'youtube_v2',
    'similarweb_api1', 'semrush13', 'ahrefs_url_research', 'domain_metrics_check', 'appark',
  ].map((key, index) => ({ key, connected: index % 2 === 0, enabledByDefault: false }));
  const result = getVisibleConnectors(connectors);
  assert.deepEqual(result, connectors);
  result.forEach((connector, index) => assert.equal(connector, connectors[index]));
});

test('already hidden and unknown connectors are not accidentally exposed', () => {
  assert.deepEqual(getVisibleConnectors([
    { key: 'meta' }, { key: 'wechat' }, { key: 'xiaohongshu' },
    { key: 'semrush8' }, { key: 'unknown' },
  ]), []);
  assert.deepEqual(getVisibleConnectors([]), []);
});

test('filtering old cache data preserves stored accounts and removes hidden scopes', () => {
  const storedAccounts = Object.freeze([{ connectionId: 'gmail-account' }]);
  const gmail = Object.freeze({
    key: 'gmail', connected: true, connectionIds: ['gmail-account'], accounts: storedAccounts,
  });
  const lark = Object.freeze({
    key: 'feishu', connected: true, connectionIds: ['lark-account'], accounts: [],
  });
  const visible = Object.freeze({
    key: 'similarweb_api1', connected: true, connectionIds: [], accounts: [],
  });
  const cachedConnectors = Object.freeze([gmail, lark, visible]);
  const rememberedKeys = ['gmail', 'feishu', 'similarweb_api1'];
  const active = getVisibleConnectors(cachedConnectors).filter(
    (connector) => connector.connected && rememberedKeys.includes(connector.key),
  );

  assert.deepEqual(active.map((connector) => connector.key), ['similarweb_api1']);
  assert.deepEqual(active.flatMap((connector) => connector.connectionIds), []);
  assert.equal(cachedConnectors.length, 3);
  assert.equal(gmail.accounts, storedAccounts);
});
