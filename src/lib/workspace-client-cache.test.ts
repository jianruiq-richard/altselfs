import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyWorkspacePersonalAgentPayload,
  clearWorkspacePersonalAgentCache,
  getWorkspaceCachedStale,
  setWorkspaceCached,
  setWorkspacePersonalAgentThreadPage,
  WORKSPACE_CACHE_KEYS,
} from './workspace-client-cache';

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {},
});

test.beforeEach(() => {
  clearWorkspacePersonalAgentCache();
});

test('thread page cache never stores a discussion-list snapshot', () => {
  setWorkspacePersonalAgentThreadPage({
    threadId: 'thread-a',
    sessions: [{ id: 'thread-a' }, { id: 'deleted-thread' }],
    messages: [{ role: 'user', content: 'hello' }],
    hasMore: true,
  });

  const cached = getWorkspaceCachedStale<Record<string, unknown>>(
    WORKSPACE_CACHE_KEYS.personalAgentThread('thread-a'),
  );

  assert.deepEqual(cached, {
    threadId: 'thread-a',
    messages: [{ role: 'user', content: 'hello' }],
    hasMore: true,
  });
  assert.equal('sessions' in (cached || {}), false);
});

test('personal-agent payload keeps the canonical list separate from thread messages', () => {
  const sessions = [{ id: 'thread-a' }, { id: 'thread-b' }];
  applyWorkspacePersonalAgentPayload({
    threadId: 'thread-a',
    sessions,
    messages: [{ role: 'assistant', content: 'answer' }],
    hasMore: false,
  });

  assert.deepEqual(
    getWorkspaceCachedStale(WORKSPACE_CACHE_KEYS.personalAgentSessions),
    { threadId: 'thread-a', sessions },
  );
  assert.deepEqual(
    getWorkspaceCachedStale(WORKSPACE_CACHE_KEYS.personalAgentThread('thread-a')),
    {
      threadId: 'thread-a',
      messages: [{ role: 'assistant', content: 'answer' }],
      hasMore: false,
    },
  );
});

test('clearing personal-agent cache invalidates all historical thread pages', () => {
  setWorkspacePersonalAgentThreadPage({ threadId: 'thread-a', messages: [] });
  setWorkspacePersonalAgentThreadPage({ threadId: 'deleted-thread', messages: [] });
  setWorkspaceCached(WORKSPACE_CACHE_KEYS.connectors, { connectors: ['kept'] });

  clearWorkspacePersonalAgentCache();

  assert.equal(
    getWorkspaceCachedStale(WORKSPACE_CACHE_KEYS.personalAgentThread('thread-a')),
    null,
  );
  assert.equal(
    getWorkspaceCachedStale(WORKSPACE_CACHE_KEYS.personalAgentThread('deleted-thread')),
    null,
  );
  assert.deepEqual(
    getWorkspaceCachedStale(WORKSPACE_CACHE_KEYS.connectors),
    { connectors: ['kept'] },
  );
});
