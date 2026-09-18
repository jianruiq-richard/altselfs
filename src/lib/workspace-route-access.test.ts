import assert from 'node:assert/strict';
import test from 'node:test';
import { isPublicWorkspacePathname } from './workspace-route-access.js';

test('homepage and Business Database are public workspace routes', () => {
  for (const pathname of ['/', '/app/product-intelligence', '/app/product-intelligence/company/example']) {
    assert.equal(isPublicWorkspacePathname(pathname), true);
  }
});

test('the rest of the workspace still requires sign in', () => {
  for (const pathname of ['/app', '/app/connectors', '/app/settings', '/app/product-intelligence-private', '/investor/chat/100']) {
    assert.equal(isPublicWorkspacePathname(pathname), false);
  }
});
