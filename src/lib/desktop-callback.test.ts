import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopCallback } from './desktop-callback';

test('desktop callbacks allow only the API loopback code/state or cancellation', () => {
  const base = 'http://127.0.0.1:51999/callback';
  assert.equal(desktopCallback(`${base}?state=fixture&code=once`), `${base}?state=fixture&code=once`);
  assert.equal(desktopCallback(`${base}?state=fixture&error=access_denied`, true), `${base}?state=fixture&error=access_denied`);
  for (const bad of [null, 'https://evil.test/callback?code=x&state=y', 'http://localhost:1234/callback?code=x&state=y', 'http://127.0.0.1/callback?code=x&state=y', `${base}?code=x`, `${base}?state=y`, `${base}?code=x&state=y#fragment`, 'http://user:password@127.0.0.1:1234/callback?code=x&state=y']) assert.throws(() => desktopCallback(bad));
  assert.throws(() => desktopCallback(`${base}?state=x&error=other`, true));
  assert.throws(() => desktopCallback(`${base}?state=x&error=access_denied`));
});
