import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLanding } from './render';
import type { MinacoProductCatalog } from '../minaco-product-catalog';
const catalog: MinacoProductCatalog = {generatedAt:'2026-11-10T00:00:00Z',plans:[],agents:[],models:[{provider:'test',model:'test',label:'</script><script>alert(1)</script>',engines:[],version:'test',input:1000,cachedInput:500,output:2000,unit:'microUSD'}],release:null,sources:{plans:'minaco-billing',agentsAndModels:'unavailable',release:'unavailable'}};
test('server renders rates safely and normalizes microUSD to credits',()=>{
 const page=renderLanding(catalog);
 assert.ok(page.includes('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!page.includes('</script><script>alert(1)</script>'));
 assert.ok(page.includes('"input":1,"cachedInput":0.5,"output":2'));
 assert.ok(!page.includes('__CATALOG_JSON__'));
});
test('production actions use real routes and omit simulated account views',()=>{
 const page=renderLanding(catalog);
 for(const path of ['/api/download','/sign-up?redirect_url=/get-started','/terms'])assert.ok(page.includes('href="'+path+'"'));
 assert.ok(!page.includes('id="account-page"'));
 assert.ok(!page.includes('id="dialog"'));
});
