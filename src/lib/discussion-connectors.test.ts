import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDiscussionConnectorKeys } from './discussion-connectors';

test('a new direct discussion starts with the four market research connectors', () => {
  assert.deepEqual(resolveDiscussionConnectorKeys(undefined, null), [
    'similarweb_api1', 'semrush13', 'ahrefs_url_research', 'appark',
  ]);
});

test('a template discussion keeps its previous social source scope', () => {
  const social = ['instagram_looter2', 'twitter241', 'tiktok_api23', 'youtube_v2'];
  assert.deepEqual(resolveDiscussionConnectorKeys(undefined, social), social);
});

test('manual selection overrides the last turn, including disabling all sources', () => {
  assert.deepEqual(resolveDiscussionConnectorKeys([], ['similarweb_api1']), []);
  assert.deepEqual(resolveDiscussionConnectorKeys(['appark'], ['semrush13']), ['appark']);
  assert.deepEqual(resolveDiscussionConnectorKeys(undefined, []), []);
});
