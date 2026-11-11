import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {enqueuePaymentAnalytics,deliverPaymentAnalytics,paymentContext} from '../src/payment-analytics.js';
import {createRequire} from 'node:module';
const {saveAccountAnalytics} = createRequire(import.meta.url)('../../../src/lib/analytics/attribution.ts');

// Local embedded PostgreSQL only. No application/production DATABASE_URL is read.
test('PostgreSQL: attribution persistence, transactional outbox, retries, dedupe, lease recovery and consent', {skip:!process.env.ANALYTICS_PGLITE_MODULE}, async()=>{
 const {PGlite}=await import(process.env.ANALYTICS_PGLITE_MODULE!);
 const db=new PGlite();
 await db.exec('create table users(id text primary key); insert into users values (\'u1\'),(\'u2\');');
 await db.exec(await readFile(new URL('../../../prisma/migrations/20261111120000_analytics_attribution_outbox/migration.sql',import.meta.url),'utf8'));
 const prisma={$executeRawUnsafe:async(sql:string,...values:unknown[])=>db.query(sql,values)};
 const context={clientId:'123.456',sessionId:String(Math.floor(Date.now()/1000)),analyticsConsent:'granted' as const,adUserDataConsent:'granted' as const};
 const now=Date.now();
 await saveAccountAnalytics(prisma,'u1',{analytics:context,attribution:{first:{at:now-1000,gclid:'first'},last:{at:now-1000,gclid:'first'}}});
 await saveAccountAnalytics(prisma,'u1',{analytics:context,attribution:{first:{at:now,gclid:'second'},last:{at:now,gclid:'second'}}});
 // A later direct visit with blocked GA does not wipe the campaign/client or renew its age.
 await saveAccountAnalytics(prisma,'u1',{analytics:{analyticsConsent:'granted',adUserDataConsent:'granted'}});
 let account=(await db.query('select * from account_attribution')).rows[0];
 assert.equal(account.first_touch.gclid,'first');assert.equal(account.last_touch.gclid,'second');
 assert.equal(account.analytics_context.clientId,'123.456');assert.equal(account.analytics_context.sessionId,null);
 await saveAccountAnalytics(prisma,'u1',{analytics:{...context,clientId:'new.browser'}});
 account=(await db.query('select * from account_attribution')).rows[0];
 assert.equal(account.last_touch.clientId,'123.456');
 assert.equal(paymentContext({...context,clientId:'new.browser'},account).clientId,'123.456');
 const config:any={ga4MeasurementId:'G-TEST',ga4ApiSecret:'test'};
 const event={name:'purchase',userId:'u1',context,includeSession:true,timestampMicros:now*1000,params:{transaction_id:'invoice1',value:20,currency:'USD'}};
 // Rollback proves a failed financial transaction cannot leave a conversion.
 await db.exec('begin');await enqueuePaymentAnalytics(db,'purchase:rollback',event);await db.exec('rollback');
 assert.equal((await db.query('select * from conversion_analytics_outbox')).rows.length,0);
 await db.exec('begin');await enqueuePaymentAnalytics(db,'purchase:invoice1',event);await db.exec('commit');
 await enqueuePaymentAnalytics(db,'purchase:invoice1',event);
 assert.equal((await db.query('select * from conversion_analytics_outbox')).rows.length,1);
 let calls=0;
 await deliverPaymentAnalytics(config,db,async()=>{calls++;return {sent:false,reason:'request_failed'};});
 let row=(await db.query('select * from conversion_analytics_outbox')).rows[0];
 assert.equal(row.delivery_status,'PENDING');assert.equal(row.attempts,1);assert.equal(row.last_error,'request_failed');
 await deliverPaymentAnalytics(config,db,async()=>{throw Error('backoff not respected');});assert.equal(calls,1);
 await db.exec("update conversion_analytics_outbox set available_at=now(),lease_token='crashed',lease_until=now()-interval '1 second'");
 await deliverPaymentAnalytics(config,db,async(_config,input)=>{
  calls++;assert.equal(input.params.transaction_id,'invoice1');assert.equal(input.timestampMicros,now*1000);return {sent:true};
 });
 row=(await db.query('select * from conversion_analytics_outbox')).rows[0];assert.equal(row.delivery_status,'SENT');assert.equal(row.attempts,2);
 await deliverPaymentAnalytics(config,db,async()=>{throw Error('duplicate delivery');});assert.equal(calls,2);
 await enqueuePaymentAnalytics(db,'purchase:leased',event);
 await db.exec("update conversion_analytics_outbox set lease_until=now()+interval '1 minute' where event_id='purchase:leased'");
 await deliverPaymentAnalytics(config,db,async()=>{throw Error('active worker lease stolen');});
 await db.exec("update conversion_analytics_outbox set lease_until=null where event_id='purchase:leased'");
 await saveAccountAnalytics(prisma,'u1',{analytics:{analyticsConsent:'denied',adUserDataConsent:'denied'}});
 await deliverPaymentAnalytics(config,db,async()=>{throw Error('consent withdrawal ignored');});
 row=(await db.query("select * from conversion_analytics_outbox where event_id='purchase:leased'")).rows[0];assert.equal(row.delivery_status,'SKIPPED');assert.equal(row.attribution,null);
 account=(await db.query('select * from account_attribution')).rows[0];assert.equal(account.first_touch,null);assert.equal(account.last_touch,null);
 await enqueuePaymentAnalytics(db,'purchase:expired',{...event,timestampMicros:(now-71*3600000)*1000});
 await deliverPaymentAnalytics(config,db,async()=>{throw Error('expired event sent');});
 assert.equal((await db.query("select delivery_status from conversion_analytics_outbox where event_id='purchase:expired'")).rows[0].delivery_status,'EXPIRED');
 await enqueuePaymentAnalytics(db,'purchase:denied',{...event,context:{...context,analyticsConsent:'denied'}});
 assert.equal((await db.query("select delivery_status from conversion_analytics_outbox where event_id='purchase:denied'")).rows[0].delivery_status,'SKIPPED');
 await enqueuePaymentAnalytics(db,'purchase:no-config',{...event,userId:'u2'});
 await deliverPaymentAnalytics({} as any,db,async()=>{throw Error('missing config sent');});
 assert.equal((await db.query("select attempts from conversion_analytics_outbox where event_id='purchase:no-config'")).rows[0].attempts,0);

 // Desktop can arrive before browser identity binding; recover the same event later.
 await db.query("insert into users values ('late')");
 await db.query(`insert into conversion_analytics_outbox(event_id,user_id,event_name,context,params,occurred_at,delivery_status)
   values ('desktop:late:desktop_activated','late','desktop_activated','{}','{}',now(),'WAITING_CONTEXT')`);
 await deliverPaymentAnalytics(config,db,async()=>({sent:true}));
 assert.equal((await db.query("select delivery_status from conversion_analytics_outbox where user_id='late'")).rows[0].delivery_status,'WAITING_CONTEXT');
 await saveAccountAnalytics(prisma,'late',{analytics:context,attribution:{last:{at:now,gclid:'late-click'}}});
 let desktopSent=false;
 await deliverPaymentAnalytics(config,db,async(_config,input)=>{
   if(input.userId==='late') {desktopSent=true;assert.equal(input.name,'desktop_activated');assert.equal(input.context.clientId,'123.456');assert.equal(input.includeSession,false);}
   return {sent:true};
 });
 assert.equal(desktopSent,true);
 await db.close();
});
