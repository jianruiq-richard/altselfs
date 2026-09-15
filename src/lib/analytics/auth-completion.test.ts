import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAuthCompletion } from './auth-completion.js';

test('a newly created product account is a signup regardless of its login entry point', async () => {
  const event = await resolveAuthCompletion({ id: 'new', registrationSessionId: 'first' }, 'first', true, async () => true);
  assert.equal(event, 'sign_up');
});

test('new-account completion does not depend on retaining browser auth-flow storage', async () => {
  assert.equal(await resolveAuthCompletion({ id: 'new', registrationSessionId: 'first' }, 'first', false, async () => true), 'sign_up');
});

test('an existing account signing in through a signup entry remains a login', async () => {
  for (const registrationSessionId of [null, 'original']) {
    assert.equal(await resolveAuthCompletion({ id: 'old', registrationSessionId }, 'later', true, async () => {
      assert.fail('must not claim a registration for an existing account');
    }), 'login');
  }
});

test('refreshing an existing signed-in account does not produce a login event', async () => {
  assert.equal(await resolveAuthCompletion({ id: 'old', registrationSessionId: null }, 'later', false, async () => false), null);
});

test('only the winner of the database registration claim emits signup; repeats do not become login', async () => {
  let available = true;
  const claim = async () => {
    const claimed = available;
    available = false;
    return claimed;
  };
  const results = await Promise.all(Array.from({ length: 5 }, () => resolveAuthCompletion(
    { id: 'new', registrationSessionId: 'first' }, 'first', true, claim,
  )));
  assert.deepEqual(results, ['sign_up', null, null, null, null]);
});
