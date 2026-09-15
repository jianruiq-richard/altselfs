import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { CONSENT_BOOTSTRAP, consentParameters, parseConsentChoice } from './consent.js';

test('unknown, invalid or absent choices never grant analytics or ads consent', () => {
  for (const value of [undefined, null, '', 'granted', true, { analytics: true }]) {
    assert.equal(parseConsentChoice(value), null);
  }
  assert.equal(consentParameters('unknown').analytics_storage, 'denied');
});

test('analytics-only and advertising measurement choices remain distinct', () => {
  assert.deepEqual(consentParameters('analytics'), {
    analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
  });
  assert.deepEqual(consentParameters('all'), {
    analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied',
  });
});

test('inline initialization restores the same choice before tags run, including blocked storage', () => {
  for (const value of ['all', 'analytics', 'denied', 'bad-value', null]) {
    const context = { window: {}, localStorage: { getItem: () => value }, minacoAnalyticsConsent: '', minacoAdConsent: '' };
    runInNewContext(CONSENT_BOOTSTRAP, context);
    const expected = consentParameters(parseConsentChoice(value) || 'unknown');
    assert.equal(context.minacoAnalyticsConsent, expected.analytics_storage);
    assert.equal(context.minacoAdConsent, expected.ad_storage);
  }
  const blocked = { window: {}, localStorage: { getItem: () => { throw new Error('blocked'); } }, minacoAnalyticsConsent: '' };
  runInNewContext(CONSENT_BOOTSTRAP, blocked);
  assert.equal(blocked.minacoAnalyticsConsent, 'denied');
});
