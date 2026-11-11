import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import puppeteer from 'puppeteer-core';
process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID='G-LOCALTEST';
const {renderLanding}=createRequire(import.meta.url)('../src/lib/landing/render.ts');
const html=renderLanding({generatedAt:new Date().toISOString(),plans:[],agents:[],models:[],release:null,sources:{}},'');
const script=await readFile(new URL('../public/minaco-analytics.js',import.meta.url),'utf8');
const server=createServer((req,res)=>{
 if(req.url?.split('?')[0]==='/minaco-analytics.js'){res.setHeader('Content-Type','text/javascript');res.end(script);return;}
 res.setHeader('Content-Type','text/html');res.end(html);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();await page.setRequestInterception(true);
 // No real GA, Clarity, Clerk or user data is used in this test.
 page.on('request',r=>{if(r.url().startsWith(origin))r.continue();else r.respond({status:200,contentType:'text/javascript',body:''});});
 await page.goto(origin+'/?gclid=local-click&utm_campaign=test&state=DO_NOT_SEND',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.minacoAttribution));
 const events=await page.evaluate(()=>Array.from(window.dataLayer||[],x=>Array.from(x)));
 const views=events.filter(x=>x[0]==='event'&&x[1]==='page_view');
 assert.equal(views.length,1);assert.equal(views[0][2].route_name,'landing');assert.ok(!JSON.stringify(views).includes('DO_NOT_SEND'));
 await page.evaluate(()=>{
  document.addEventListener('click',e=>e.preventDefault());
  document.querySelector('a[href="/api/download"]').click();
  window.minacoAttribution.bind('user-one');
 });
 const checked=await page.evaluate(()=>({events:Array.from(window.dataLayer||[],x=>Array.from(x)),first:window.minacoAttribution.read('user-one'),other:window.minacoAttribution.read('user-two')}));
 assert.equal(checked.events.filter(x=>x[1]==='download_click').length,1);assert.equal(checked.first.first.gclid,'local-click');assert.equal(checked.other,null);
 await page.goto(origin+'/account',{waitUntil:'domcontentloaded'});
 assert.equal(await page.evaluate(()=>window.minacoAttribution.read('user-one').last.gclid),'local-click');
 await page.evaluate(()=>{localStorage.setItem('minaco.consent.v1','denied');window.dispatchEvent(new Event('minaco:consent-changed'));});
 assert.equal(await page.evaluate(()=>localStorage.getItem('minaco.attribution.v1')),null);
 console.log('PASS: actual homepage + Chrome: one page view, download click, secret stripping, attribution persistence/account isolation and consent withdrawal. No vendor events sent.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
