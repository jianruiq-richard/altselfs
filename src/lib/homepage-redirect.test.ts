import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSignedInHomepageRedirect } from './homepage-redirect.js';

test('redirects a signed-in homepage request to the workspace', () => {
  const redirectUrl = buildSignedInHomepageRedirect(
    new URL('https://minaco.ai/'),
    'user_123',
  );

  assert.equal(redirectUrl?.href, 'https://minaco.ai/investor/chat/100');
});

test('preserves recognized campaign parameters on the workspace redirect', () => {
  const redirectUrl = buildSignedInHomepageRedirect(
    new URL(
      'https://minaco.ai/?utm_source=google&utm_campaign=seo&utm_content=one&utm_content=two&prompt=ignore',
    ),
    'user_123',
  );

  assert.equal(
    redirectUrl?.href,
    'https://minaco.ai/investor/chat/100?utm_source=google&utm_campaign=seo&utm_content=one&utm_content=two',
  );
});

test('does not redirect signed-out or non-homepage requests', () => {
  assert.equal(
    buildSignedInHomepageRedirect(new URL('https://minaco.ai/'), null),
    null,
  );
  assert.equal(
    buildSignedInHomepageRedirect(
      new URL('https://minaco.ai/blog'),
      'user_123',
    ),
    null,
  );
});
