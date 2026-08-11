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
  }), {
    clientId: '123456.789012',
    sessionId: '1712345678',
    analyticsConsent: 'granted',
  });

  assert.deepEqual(normalizeGa4ClientContext({
    clientId: 'not valid!',
    sessionId: '<script>',
    analyticsConsent: 'yes',
  }), {
    clientId: null,
    sessionId: null,
    analyticsConsent: 'denied',
  });
});

test('round-trips GA4 context through Stripe metadata', () => {
  const context = normalizeGa4ClientContext({
    clientId: '123456.789012',
    sessionId: '1712345678',
    analyticsConsent: 'granted',
  });

  assert.deepEqual(ga4ContextFromMetadata(ga4ContextMetadata(context)), context);
});
