import test from 'node:test';
import assert from 'node:assert/strict';
import { authDestination, authHref } from './auth-destination';
test('preserves explicit web and desktop continuation across method and mode changes', () => {
  for (const target of ['/account', '/get-started', '/desktop/finish?request=auth_example', '/agent?task=research#results']) {
    for (const path of ['/sign-up', '/sign-in', '/sso-callback', '/auth/complete']) {
      const url = new URL(authHref(path, target, 'phone'), 'https://minaco.ai');
      assert.equal(authDestination(url.searchParams.get('redirect_url')), target);
    }
  }
});
test('rejects external, malformed and recursive authentication destinations', () => {
  for (const input of ['https://other.test', '//other.test', '/\\other.test', '/%5cother.test', '/%2fother.test', '/%0a/other.test', '/sign-in?redirect_url=/sign-in', '/sign-up', '/auth/complete', '/a/../sign-in', '/%', ' /account']) {
    assert.equal(authDestination(input), '/get-started', input);
  }
  assert.equal(authDestination(undefined, '/account'), '/account');
});
