import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import { normalizeTouch, normalizeAccountAnalytics } from './attribution';
import { googleTagInitialization, landingGoogleTag } from './google-tag';
import { safeAnalyticsLocation } from './client';

const source = readFileSync(new URL('../../../public/minaco-analytics.js', import.meta.url), 'utf8');
function browser(url: string, storage = new Map<string,string>()) {
  const callbacks: Record<string, () => void> = {};
  const events: unknown[][] = [];
  const win: any = {gtag: (...args: unknown[]) => events.push(args), addEventListener:(name:string, cb:()=>void) => {callbacks[name]=cb;}};
  const context = {window:win, document:{currentScript:{dataset:{landing:'true'}}, title:'Minaco', addEventListener:()=>{}}, location:new URL(url), URL, URLSearchParams,
    localStorage:{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,v:string)=>storage.set(key,v),removeItem:(key:string)=>storage.delete(key)}, Date};
  runInNewContext(source, context);
  return {win, events, callbacks, storage, context};
}

test('first-party sources survive navigation but cannot be rebound to another account', () => {
  const first = browser('https://minaco.ai/?gclid=click-one&utm_campaign=launch&code=secret');
  assert.equal(first.win.minacoAttribution.read('u1').first.gclid,'click-one');
  assert.equal(first.win.minacoAttribution.read('u1').first.code,undefined);
  first.win.minacoAttribution.bind('u1');
  assert.equal(first.win.minacoAttribution.read('u2'),null);
  const direct = browser('https://minaco.ai/account', first.storage);
  assert.equal(direct.win.minacoAttribution.read('u1').last.gclid,'click-one');
  const second = browser('https://minaco.ai/?gclid=click-two', first.storage);
  assert.equal(second.win.minacoAttribution.read('u1').first.gclid,'click-two');
  second.win.minacoAttribution.bind('u2');
  assert.equal(second.win.minacoAttribution.read('u1'),null);
  assert.equal(second.win.minacoAttribution.read('u2').first.gclid,'click-two');
  assert.equal(second.win.minacoAttribution.read('u2').last.gclid,'click-two');
});

test('consent withdrawal erases browser attribution and blocks further capture', () => {
  const ctx=browser('https://minaco.ai/?gclid=test');
  ctx.storage.set('minaco.consent.v1','denied'); ctx.callbacks['minaco:consent-changed']();
  assert.equal(ctx.storage.has('minaco.attribution.v1'),false);
  assert.equal(ctx.win.minacoAttribution.read('u1'),null);
  assert.equal(browser('https://minaco.ai/?gclid=test',new Map([['minaco.consent.v1','analytics']])).storage.has('minaco.attribution.v1'),false);
});

test('homepage emits one page view and strips arbitrary query secrets', () => {
  const ctx=browser('https://minaco.ai/?gclid=test&state=secret&email=private');
  runInNewContext(source,ctx.context);
  assert.equal(ctx.events.length,1);
  const params=ctx.events[0][2] as any;
  assert.equal(params.page_location,'https://minaco.ai/?gclid=test');
  assert.equal(params.route_name,'landing');
  assert.equal(safeAnalyticsLocation('https://minaco.ai/connect?request=auth-secret&utm_source=google#token'), 'https://minaco.ai/connect?utm_source=google');
});

test('only eligible bounded attribution and analytics identifiers are persisted', () => {
  assert.equal(normalizeTouch({at:Date.now()-91*86400000,gclid:'old'}),null);
  assert.equal(normalizeTouch({at:Date.now()+120000,gclid:'future'}),null);
  assert.equal(normalizeTouch({at:Date.now(),gclid:'<bad>'}),null);
  const input={analytics:{clientId:'123.456',sessionId:'123',analyticsConsent:'denied',adUserDataConsent:'granted'},attribution:{first:{at:Date.now(),gclid:'test'}}};
  const result=normalizeAccountAnalytics(input);
  assert.equal(result.first,null);assert.equal(result.context.clientId,null);assert.equal(result.ads,false);
});

test('standalone tag validates configuration and preserves the existing consent bootstrap', () => {
  assert.equal(googleTagInitialization("G-X';alert(1)//"),'');
  const html=landingGoogleTag('G-TEST');
  assert.equal((html.match(/id="minaco-ga4-init"/g)||[]).length,1);
  assert.ok(html.includes('minaco.consent.v1'));assert.ok(html.includes('send_page_view:false'));
  assert.ok(landingGoogleTag('').includes('/minaco-analytics.js'));
});
