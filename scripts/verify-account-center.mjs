// Isolated UI fixtures only. Never uses a live account or payment.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
const root=process.cwd();
await mkdir('/tmp/minaco-account-preview',{recursive:true});
const shim=`import React, {useSyncExternalStore} from '${root}/node_modules/react/index.js';
const subscribe=fn=>{window.addEventListener('popstate',fn);return()=>window.removeEventListener('popstate',fn)};
export function useSearchParams(){useSyncExternalStore(subscribe,()=>location.search,()=> '');return new URLSearchParams(location.search)}
export function useRouter(){return {push(url){history.pushState(null,'',url);window.dispatchEvent(new Event('popstate'))}}}
export function useUser(){return {isLoaded:true,isSignedIn:!location.search.includes('signedout=1'),user:{fullName:'Alex Chen',primaryEmailAddress:{emailAddress:'alex@example.com'}}}}
export function useClerk(){return {signOut({redirectUrl}){window.__signout=redirectUrl}}}
export default function Link({href,children,...rest}){return React.createElement('a',{...rest,href,onClick:e=>{if(href.startsWith('/account')){e.preventDefault();history.pushState(null,'',href);window.dispatchEvent(new Event('popstate'))}}},children)}
export async function getAnalyticsSessionContext(){return {}}
`;
await writeFile('/tmp/minaco-account-preview/shim.jsx',shim);
await build({stdin:{contents:`import React from '${root}/node_modules/react/index.js';import {createRoot} from '${root}/node_modules/react-dom/client.js';import {MinacoAccountPage} from '${root}/src/components/minaco-account-page.tsx';createRoot(document.getElementById('root')).render(<MinacoAccountPage/>);`,resolveDir:root,loader:'jsx'},bundle:true,format:'esm',outfile:'/tmp/minaco-account-preview/app.js',alias:{'@':root+'/src','@clerk/nextjs':'/tmp/minaco-account-preview/shim.jsx','next/navigation':'/tmp/minaco-account-preview/shim.jsx','next/link':'/tmp/minaco-account-preview/shim.jsx','@/lib/analytics/client':'/tmp/minaco-account-preview/shim.jsx'},jsx:'automatic',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},loader:{'.woff2':'file'},logLevel:'error'});
await writeFile('/tmp/minaco-account-preview/index.html','<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}button,input,select{font:inherit}button{cursor:pointer}</style><div id="root"></div><script type="module" src="/app.js"></script>');

import http from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const puppeteer=createRequire(import.meta.url)('puppeteer-core');

const calls=[];let failUsage=false, failBilling=false;
const overview={account:{availableCredits:42860,reservedCredits:100,lifetimeGrantedCredits:100000,lifetimeSpentCredits:57140},subscription:{planKey:'PRO',planName:'Pro',status:'active',monthlyCredits:40000,concurrentTaskLimit:10,currentPeriodStart:'2026-11-01',currentPeriodEnd:'2026-12-01',cancelAtPeriodEnd:false,provider:'stripe',billingCycle:'monthly'},capacity:{activeTaskCount:1,availableTaskSlots:9}};
const item={id:'row-1',source:'desktop',component:'agent_turn',status:'CAPTURED',runId:'desktop:example-run',threadId:'thread',threadTitle:'Redesign the Minaco website',billedCredits:264,computedCredits:264,pricingVersion:'2026-11',totals:{inputTokens:736920,cachedInputTokens:364928,cacheWriteTokens:0,outputTokens:2675,reasoningTokens:0},components:[{agent:'codex',provider:'minaco',model:'gpt-6-astra',inputTokens:736920,cachedInputTokens:364928,cacheWriteTokens:0,outputTokens:2675,reasoningTokens:0,credits:264}],createdAt:'2026-11-10T08:00:00Z',settledAt:'2026-11-10T08:10:00Z'};
const server=http.createServer(async(req,res)=>{try{
const u=new URL(req.url,'http://localhost');
if(u.pathname.startsWith('/api/')){
 calls.push({path:u.pathname,query:u.search,method:req.method});let body={};
 if(u.pathname==='/api/billing/summary')body=overview;
 if(u.pathname==='/api/user/profile')body={user:{name:'Alex Chen',email:'alex@example.com'}};
 if(u.pathname==='/api/public/product-catalog')body={plans:[],agents:[{id:'codex',name:'Codex'}],models:[{provider:'minaco',model:'gpt-6-astra',label:'GPT-6 Astra',engines:['codex'],input:800,cachedInput:80,output:2400}],sources:{}};
 if(u.pathname==='/api/billing/catalog')body={configured:true,plans:{STARTER:{monthlyPriceId:'test',yearlyPriceId:'test'},PRO:{monthlyPriceId:'test',yearlyPriceId:'test'},SCALE:{monthlyPriceId:'test',yearlyPriceId:'test'}},packs:{PACK:{priceId:'test',credits:20000,amountCents:2000}}};
 if(u.pathname==='/api/billing/activity'){if(failUsage){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'Usage history is temporarily unavailable.'}));return;}body={items:[{...item,id:u.searchParams.has('cursor')?'row-2':'row-1'}],monthly:{credits:3280,turns:42},nextCursor:u.searchParams.has('cursor')?null:'next'};}
 if(u.pathname==='/api/billing/history'){if(failBilling){res.writeHead(503);res.end('{}');return;}body={items:[{id:u.searchParams.has('cursor')?'p2':'p1',title:u.searchParams.get('kind')==='adjustments'?'Welcome credits':'SUBSCRIPTION',status:'PAID',planKey:'PRO',credits:40000,amountCents:4000,currency:'USD',createdAt:'2026-11-01T08:00:00Z'}],nextCursor:u.searchParams.has('cursor')?null:'next'};}
 if(req.method==='POST'){let data='';for await(const c of req)data+=c;calls.at(-1).body=data;body={message:'Test confirmation prepared'};}
 res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(body));return;
}
let file=u.pathname==='/app.js'||u.pathname==='/app.css'?'/tmp/minaco-account-preview'+u.pathname:u.pathname.startsWith('/brand/')?root+'/public'+u.pathname:'/tmp/minaco-account-preview/index.html';
res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html');res.end(await readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-first-run']});
const page=await browser.newPage();const cdp=await page.createCDPSession();await cdp.send('Emulation.setLocaleOverride',{locale:'zh-CN'});const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.setViewport({width:1440,height:1050});
async function clickText(label){await page.evaluate(label=>{const el=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===label);if(!el)throw Error('Missing '+label);el.click()},label)}
async function waitText(text){await page.waitForFunction(t=>document.body.innerText.includes(t),{},text)}
try {
 await page.goto(url+'/account');await waitText('42,860 Credits');await page.screenshot({path:root+'/artifacts/account-overview-desktop.png',fullPage:true});
 for (const [view, label, content] of [['billing','Billing','Payments & balance changes'],['usage','Usage','Redesign the Minaco website'],['rates','Model rates','Current model rates'],['overview','Overview','42,860 Credits']]) {
  await page.evaluate(label=>[...document.querySelectorAll('a')].find(b=>b.querySelector('strong')?.textContent===label).click(),label);
  await page.waitForFunction(view=>new URLSearchParams(location.search).get('view')===view,{},view);
  await waitText(content);
  if (view === 'rates') {
   assert(!await page.evaluate(()=>[...document.querySelectorAll('span')].some(e=>e.textContent==='Provider')));
   await page.screenshot({path:root+'/artifacts/account-rates-desktop.png',fullPage:true});
   await page.setViewport({width:390,height:844});
   await page.screenshot({path:root+'/artifacts/account-rates-mobile.png',fullPage:true});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   for (const text of ['Input','Cached','Output']) assert(await page.evaluate(text=>[...document.querySelectorAll('span')].some(e=>e.textContent===text&&getComputedStyle(e).display!=='none'),text));
   await page.setViewport({width:1440,height:1050});
  }
 }
 await page.goto(url+'/account?view=usage');await waitText('Redesign the Minaco website');const n=calls.filter(c=>c.path.endsWith('/activity')).length;await clickText('Refresh');await page.waitForFunction(()=>!document.querySelector('button[disabled]'));assert(calls.filter(c=>c.path.endsWith('/activity')).length>n);
 await page.click('input[name=model]');await page.type('input[name=model]','gpt-6');await clickText('Apply filters');await page.waitForFunction(()=>location.search.includes('model=gpt-6'));await waitText('Redesign the Minaco website');
 await clickText('Load 20 more');await page.waitForFunction(()=>document.querySelectorAll('[aria-expanded]').length===2);assert(calls.some(c=>c.query.includes('cursor=next')&&c.query.includes('model=gpt-6')));
 await page.click('[aria-expanded]');await page.screenshot({path:root+'/artifacts/account-usage-desktop.png',fullPage:true});
 await page.setViewport({width:390,height:844});await page.screenshot({path:root+'/artifacts/account-usage-mobile.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.evaluate(()=>[...document.querySelectorAll('[aria-expanded] span')].some(e=>e.textContent==='264'&&getComputedStyle(e).display!=='none')));
 await page.setViewport({width:1440,height:1050});await page.goto(url+'/account?view=plan&plan=SCALE&cycle=yearly&intent=cancel');await waitText('Cancel renewal?');assert.equal(calls.filter(c=>c.method==='POST').length,0);await page.screenshot({path:root+'/artifacts/account-plan-desktop.png',fullPage:true});
 await clickText('Keep subscription');await clickText('Cancel renewal');await clickText('Review cancellation');await waitText('Test confirmation prepared');assert(calls.some(c=>c.method==='POST'&&JSON.parse(c.body).planKey==='FREE'));
 await page.goto(url+'/account?view=billing');await waitText('Pro subscription');await waitText('Nov 1, 2026');await clickText('Balance changes');await waitText('Welcome credits');await clickText('Load 20 more');await page.waitForFunction(()=>[...document.querySelectorAll('strong')].filter(e=>e.textContent==='Welcome credits').length===2);
 failBilling=true;await clickText('Refresh');await waitText('Billing history is unavailable.');assert(!await page.evaluate(()=>document.body.innerText.includes('No balance changes yet')));failBilling=false;
 failUsage=true;await page.goto(url+'/account?view=usage');await waitText('Usage history is temporarily unavailable.');assert(!await page.evaluate(()=>document.body.innerText.includes('No usage matches')));failUsage=false;await clickText('Retry usage');await waitText('Redesign the Minaco website');
 await page.goto(url+'/account?view=usage&source=desktop&signedout=1');const href=await page.$eval('a',e=>e.getAttribute('href'));assert(new URL(href,url).searchParams.get('redirect_url').includes('view=usage&source=desktop'));
 assert.deepEqual(errors,[]);await writeFile(root+'/artifacts/account-ui-verification.json',JSON.stringify({passed:true,scope:'Actual React components with isolated authentication and billing fixtures; no live payment',checks:['rates without provider and mobile token columns','English billing dates under Chinese browser locale','account sidebar navigation','overview','usage refresh','server filter query','cursor with filters','mobile credits and no overflow','cancel intent no automatic POST','explicit cancellation confirmation','independent billing histories','error vs empty','login continuation'],calls},null,2));console.log('Account UI: 13 behavior checks passed; desktop/mobile screenshots saved.');
} catch(e) { console.log(JSON.stringify({errors,body:await page.evaluate(()=>document.body.innerText),calls},null,2));throw e; } finally {await browser.close();server.close();}
