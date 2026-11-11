import assert from 'node:assert/strict';
import test from 'node:test';
import {paymentContext} from '../src/payment-analytics.js';
const saved = {analytics_context:{clientId:'123.456',sessionId:'100',analyticsConsent:'granted',adUserDataConsent:'granted'},context_updated_at:new Date().toISOString()};
test('account fallback recovers the GA client but never the stale browser session',()=>{
 const result=paymentContext({analyticsConsent:'granted',adUserDataConsent:'granted'},saved);
 assert.equal(result.clientId,'123.456');assert.equal(result.sessionId,null);
 assert.equal(paymentContext({clientId:'new.browser',sessionId:'200',analyticsConsent:'granted'},saved).clientId,'new.browser');
});
test('denial, expiry and malformed saved identities cannot be bypassed by fallback',()=>{
 assert.equal(paymentContext({analyticsConsent:'denied'},saved).clientId,null);
 assert.equal(paymentContext({analyticsConsent:'granted'},{...saved,context_updated_at:new Date(Date.now()-61*86400000).toISOString()}).clientId,null);
 assert.equal(paymentContext({analyticsConsent:'granted'},{...saved,analytics_context:{...saved.analytics_context,clientId:'<script>'}}).clientId,null);
});

test('later browser uses the consented campaign client without resurrecting its session',()=>{
 const account={...saved,last_touch:{at:Date.now()-86400000,gclid:'click',clientId:'campaign.browser'}};
 assert.equal(paymentContext({clientId:'new.browser',sessionId:'200',analyticsConsent:'granted',adUserDataConsent:'granted'},account).clientId,'campaign.browser');
 assert.equal(paymentContext({clientId:'new.browser',sessionId:'200',analyticsConsent:'granted',adUserDataConsent:'granted'},account).sessionId,null);
 assert.equal(paymentContext({clientId:'new.browser',analyticsConsent:'granted',adUserDataConsent:'denied'},account).clientId,'new.browser');
});
