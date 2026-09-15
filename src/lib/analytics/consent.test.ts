import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { CONSENT_BOOTSTRAP, DEFAULT_CONSENT_CHOICE, getConsentChoice, consentParameters, parseConsentChoice } from './consent.js';

test('invalid values are not treated as saved preferences', () => {
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
    const expected = consentParameters(parseConsentChoice(value) || DEFAULT_CONSENT_CHOICE);
    assert.equal(context.minacoAnalyticsConsent, expected.analytics_storage);
    assert.equal(context.minacoAdConsent, expected.ad_storage);
  }
  const blocked = { window: {}, localStorage: { getItem: () => { throw new Error('blocked'); } }, minacoAnalyticsConsent: '', minacoAdConsent: '' };
  runInNewContext(CONSENT_BOOTSTRAP, blocked);
  assert.equal(blocked.minacoAnalyticsConsent, 'granted');
  assert.equal(blocked.minacoAdConsent, 'granted');
});

test('runtime defaults and tag initialization agree without overwriting saved choices', () => {
  for (const value of [null, 'bad-value', 'all', 'analytics', 'denied']) {
    const browser = { localStorage: { getItem: () => value } };
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
      Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
      const context = { window: browser, localStorage: browser.localStorage, minacoAnalyticsConsent: '', minacoAdConsent: '' };
      runInNewContext(CONSENT_BOOTSTRAP, context);
      const expected = consentParameters(getConsentChoice());
      assert.equal(getConsentChoice(), parseConsentChoice(value) || 'all');
      assert.equal(context.minacoAnalyticsConsent, expected.analytics_storage);
      assert.equal(context.minacoAdConsent, expected.ad_storage);
      assert.equal('__minacoConsent' in browser, false);
    } finally {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
      else Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
