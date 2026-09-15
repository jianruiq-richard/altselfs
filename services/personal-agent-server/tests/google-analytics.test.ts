import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ga4ContextFromMetadata,
  ga4ContextMetadata,
  normalizeGa4ClientContext,
} from '../src/google-analytics.js';

test('normalizes opted-in GA4 client context and rejects unsafe identifiers', () => {
  assert.deepEqual(normalizeGa4ClientContext({
    clientId: '123456.789012',
    sessionId: '1712345678',
    analyticsConsent: 'granted',
    adUserDataConsent: 'denied',
  }), {
    clientId: '123456.789012',
    sessionId: '1712345678',
    analyticsConsent: 'granted',
    adUserDataConsent: 'denied',
  });

  assert.deepEqual(normalizeGa4ClientContext({
    clientId: 'not valid!',
    sessionId: '<script>',
    analyticsConsent: 'yes',
  }), {
    clientId: null,
    sessionId: null,
    analyticsConsent: 'denied',
    adUserDataConsent: 'denied',
  });
});

test('round-trips GA4 context through Stripe metadata', () => {
  const context = normalizeGa4ClientContext({
    clientId: '123456.789012',
    sessionId: '1712345678',
    analyticsConsent: 'granted',
    adUserDataConsent: 'denied',
  });

  assert.deepEqual(ga4ContextFromMetadata(ga4ContextMetadata(context)), context);
});
