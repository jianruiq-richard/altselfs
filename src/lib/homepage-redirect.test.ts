import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLegacyWorkspaceRedirect, buildSignedInHomepageRedirect } from './homepage-redirect.js';

test('retired workspace address redirects to the app', () => {
  for (const path of ['/investor/chat/100', '/investor/chat/100/']) {
    assert.equal(buildLegacyWorkspaceRedirect(new URL(`https://minaco.ai${path}`))?.href, 'https://minaco.ai/app');
  }
});

test('legacy redirect preserves prompts, repeated campaign parameters, and fragments', () => {
  const query = '?prompt=Research+competitors&newDiscussion=1&utm_source=google&utm_content=one&utm_content=two#context';
  assert.equal(buildLegacyWorkspaceRedirect(new URL(`https://minaco.ai/investor/chat/100${query}`))?.href, `https://minaco.ai/app${query}`);
});

test('homepage, public pages, and other assistants never redirect', () => {
  for (const path of ['/', '/introduction', '/blog', '/investor/chat/xiaohongshu', '/investor/chat/1000']) {
    assert.equal(buildLegacyWorkspaceRedirect(new URL(`https://minaco.ai${path}`)), null);
  }
});


test('authenticated homepage requests keep campaign and prompt parameters', () => {
  const url = new URL('https://minaco.ai/?prompt=hello&utm_source=google');
  assert.equal(buildSignedInHomepageRedirect(url, 'user_123')?.href, 'https://minaco.ai/app?prompt=hello&utm_source=google');
  assert.equal(buildSignedInHomepageRedirect(url, null), null);
  assert.equal(buildSignedInHomepageRedirect(new URL('https://minaco.ai/app'), 'user_123'), null);
});

test('legacy tool routes preserve connector callbacks and settings query parameters', () => {
  for (const [oldPath, newPath] of [['/connectors', '/app/connectors'], ['/product-intelligence', '/app/product-intelligence'], ['/profile', '/app/settings']]) {
    assert.equal(buildLegacyWorkspaceRedirect(new URL(`https://minaco.ai${oldPath}?status=connected`))?.href, `https://minaco.ai${newPath}?status=connected`);
  }
});
