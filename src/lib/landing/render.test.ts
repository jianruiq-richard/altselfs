import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLanding } from './render';
import type { MinacoProductCatalog } from '../minaco-product-catalog';
const catalog: MinacoProductCatalog = {generatedAt:'2026-11-10T00:00:00Z',plans:[],agents:[],models:[{provider:'test',model:'test',label:'</script><script>alert(1)</script>',engines:[],version:'test',input:1000,cachedInput:500,cacheWrite:1250,cacheWrite1h:2000,output:2000,unit:'microUSD'}],release:null,sources:{plans:'minaco-billing',agentsAndModels:'unavailable',release:'unavailable'}};
test('server renders rates safely and normalizes microUSD to credits',()=>{
 const page=renderLanding(catalog);
 assert.ok(page.includes('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!page.includes('</script><script>alert(1)</script>'));
 for (const field of ['"input":1', '"cachedInput":0.5', '"cacheWrite":1.25', '"cacheWrite1h":2', '"output":2']) assert.ok(page.includes(field), field);
 assert.match(page, /<th scope="col">Cached input<\/th><th scope="col">Cache write<small>5 min \/ 1 hour<\/small><\/th><th scope="col">Output<\/th>/);
 assert.match(page, /<td>0.5<\/td><td>1.25 \/ 2<\/td><td>2<\/td>/);
 assert.ok(!page.includes('__CATALOG_JSON__'));
});
test('production actions use real routes and omit simulated account views',()=>{
 const page=renderLanding(catalog);
 for(const path of ['/api/download','/sign-up?redirect_url=/get-started','/terms'])assert.ok(page.includes('href="'+path+'"'));
 assert.ok(!page.includes('id="account-page"'));
 assert.ok(!page.includes('id="dialog"'));
});

test('standalone homepage includes exactly one configured Clarity script in head',()=>{
 const page=renderLanding(catalog, 'abc123');
 assert.equal(page.split('id="minaco-microsoft-clarity"').length-1, 1);
 assert.ok(page.indexOf('id="minaco-microsoft-clarity"') < page.indexOf('</head>'));
 assert.ok(page.includes("minaco.consent.v1"));
 assert.ok(!renderLanding(catalog, '').includes('id="minaco-microsoft-clarity"'));
});

test('homepage reflects each session without changing download or homepage access', () => {
 const signedOut = renderLanding(catalog, '');
 const signedIn = renderLanding(catalog, '', { name: 'Richard', imageUrl: 'https://img.clerk.com/avatar.png' });
 const header = (page: string) => page.match(/<header class="sitehead">[\s\S]*?<\/header>/)![0];
 assert.match(header(signedOut), />Log in<\/a>/);
 assert.doesNotMatch(header(signedOut), /My account|account-avatar/);
 assert.match(header(signedIn), /My account/);
 assert.match(header(signedIn), /href="\/account"/);
 assert.match(header(signedIn), /https:\/\/img.clerk.com\/avatar.png/);
 assert.doesNotMatch(header(signedIn), /Log in|\/sign-in/);
 for (const page of [signedOut, signedIn]) {
  assert.match(header(page), /href="\/api\/download"/);
  assert.doesNotMatch(page, /__SERVER_(?:MOBILE_ACCOUNT|ACCOUNT_ACTION)__/);
 }
 // Rendering a signed-in page must not mutate the shared template for the next visitor.
 assert.equal(renderLanding(catalog, ''), signedOut);
});

test('account profile markup is escaped and unavailable images have an initial fallback', () => {
 const page = renderLanding(catalog, '', { name: '<script>', imageUrl: 'https://img.example/avatar?x=" onerror="alert(1)' });
 assert.match(page, /&lt;<\/span>/);
 assert.match(page, /x=&quot; onerror=&quot;alert\(1\)/);
 assert.doesNotMatch(page, /src="[^"]*" onerror=/);
 const fallback = renderLanding(catalog, '', { name: '', imageUrl: 'javascript:alert(1)' });
 assert.match(fallback, /<span>M<\/span>/);
 assert.doesNotMatch(fallback, /javascript:alert/);
 assert.match(fallback, /My account/);
});
