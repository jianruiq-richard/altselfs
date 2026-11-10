import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopRegistrationRequest, desktopRegistrationReturn } from './desktop-registration';

test('desktop registration retains only a valid request and a fixed return origin', () => {
  const id = 'auth_12345678-1234-1234-1234-123456789abc';
  assert.equal(desktopRegistrationRequest(id), id);
  const url = new URL(desktopRegistrationReturn(id));
  assert.equal(url.origin, 'https://minaco.ai');
  assert.equal(url.pathname, '/connect');
  assert.equal(url.searchParams.get('request'), id);
  assert.equal(url.searchParams.get('registered'), '1');
  for (const bad of [null, '', '//evil.test', 'https://evil.test', `${id}&redirect=https://evil.test`]) {
    assert.equal(desktopRegistrationRequest(bad), null);
  }
  assert.throws(() => desktopRegistrationReturn('https://evil.test'));
});
