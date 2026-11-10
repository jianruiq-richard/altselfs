import assert from 'node:assert/strict';
import test from 'node:test';
import { accountView, accountHref, accountSignInHref, planHref } from './account-navigation';
import { authDestination, authHref } from './auth-destination';
test('login, signup and method switches keep the requested account page and purchase choice', () => {
  const target = planHref('PRO', 'yearly');
  const signin = new URL(accountSignInHref(target.split('?')[1]), 'https://minaco.ai');
  const destination = authDestination(signin.searchParams.get('redirect_url'));
  assert.equal(destination, target);
  for (const path of ['/sign-up', '/sign-in']) for (const method of ['email', 'phone'] as const) {
    assert.equal(new URL(authHref(path, destination, method), 'https://minaco.ai').searchParams.get('redirect_url'), target);
  }
  assert.equal(new URL(accountSignInHref('view=usage&source=desktop'), 'https://minaco.ai').searchParams.get('redirect_url'), '/account?view=usage&source=desktop');
});
test('unknown views do not become routes and cancellation requires explicit intent', () => {
  assert.equal(accountView('https://evil.example'), 'overview');
  assert.equal(accountHref('plan', { intent: 'cancel' }), '/account?view=plan&intent=cancel');
});
