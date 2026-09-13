import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT='demo-paceline';process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com'});
const {pollGarmin}=await import('../functions/lib/functions/src/index.js');const {getDatabase}=await import('../functions/node_modules/firebase-admin/lib/database/index.js');const db=getDatabase();
const id=crypto.randomUUID(),startAt=Date.now()-3600000;const r={id,name:'Scheduler test',startAt,route:[[0,0],[.01,0],[.02,0]],distances:[0,1.1119,2.2238],stations:[{id:'aid',name:'Aid',km:1},{id:'finish',name:'Finish',km:2.2238}],status:'live',progressKm:0,revision:1};await db.ref().update({[`races/${id}`]:r,[`jobs/${id}`]:{feedUrl:'https://share.garmin.com/Feed/Share/scheduler-test',startAt,active:true,leaseUntil:0}});
const original=globalThis.fetch;let calls=0,fail=false,xml='<kml><Document/></kml>';globalThis.fetch=async(url,opts)=>{if(String(url).startsWith('https://share.garmin.com/Feed/Share/scheduler-test')){calls++;if(fail)throw Error('test failure');return new Response(xml,{headers:{'content-type':'application/xml'}});}if(String(url).includes("garmin.com"))return new Response("<kml/>");return original(url,opts);};
// Existing scenarios explicitly make the next poll due; adaptive skip is checked below.
async function pollNow() { await db.ref(`races/${id}/nextPollAt`).set(0); await pollGarmin.run({}); }
try{await db.ref(`limits/expiry-${id}`).set({at:Date.now()-2*86400000,count:1});await pollNow();assert.equal((await db.ref(`limits/expiry-${id}`).get()).exists(),false);let data=(await db.ref(`races/${id}`).get()).val();assert.equal(calls,1);assert.equal(data.feedOk,true);assert.ok(data.heartbeatAt>startAt);assert.equal(data.fix,undefined);
fail=true;await pollNow();data=(await db.ref(`races/${id}`).get()).val();assert.equal(data.feedOk,false);assert.equal(calls,2);
fail=false;xml=`<kml><Placemark><TimeStamp><when>${new Date(Date.now()-600000).toISOString()}</when></TimeStamp><Point><coordinates>0.01,0</coordinates></Point></Placemark><Placemark><TimeStamp><when>${new Date().toISOString()}</when></TimeStamp><Point><coordinates>0.02,0</coordinates></Point></Placemark></kml>`;await pollNow();data=(await db.ref(`races/${id}`).get()).val();assert.equal(data.status,'complete');assert.equal(data.splits.length,2);assert.equal((await db.ref(`jobs/${id}/active`).get()).val(),false);await pollNow();assert.equal(calls,3);
await db.ref(`races/${id}`).set({...r,startAt:Date.now()-25*3600000});await db.ref(`jobs/${id}`).update({active:true,startAt:Date.now()-25*3600000});await pollNow();assert.equal(calls,3);assert.equal((await db.ref(`jobs/${id}/active`).get()).val(),false);assert.equal((await db.ref(`races/${id}/trackingPaused`).get()).val(),true);
const futureStart = Date.now() + 7200000;
await db.ref(`races/${id}`).set({...r, status:'scheduled', startAt:futureStart});
await db.ref(`jobs/${id}`).update({active:true,startAt:futureStart});
await pollNow(); assert.equal(calls,3);
const windowStart = Date.now() + 1800000;
await db.ref(`races/${id}`).update({startAt:windowStart});
await db.ref(`jobs/${id}`).update({startAt:windowStart});
xml='<kml><Document/></kml>';
await pollNow(); assert.equal(calls,4);
assert.equal((await db.ref(`races/${id}/status`).get()).val(),'scheduled');
const earlyAt=Date.now()-60000;
xml=`<kml><Placemark><TimeStamp><when>${new Date(earlyAt).toISOString()}</when></TimeStamp><Point><coordinates>0,0</coordinates></Point></Placemark></kml>`;
await pollNow(); assert.equal(calls,5);
data=(await db.ref(`races/${id}`).get()).val();
assert.equal(data.status,'scheduled'); assert.equal(data.actualStartAt,undefined); assert.equal(data.startLineFix.at,earlyAt); assert.equal(data.startAt,windowStart);
xml=`<kml><Placemark><TimeStamp><when>${new Date(earlyAt+30000).toISOString()}</when></TimeStamp><Point><coordinates>0.0006,0</coordinates></Point></Placemark></kml>`;
await pollNow(); data=(await db.ref(`races/${id}`).get()).val();
assert.equal(data.status,'live'); assert.equal(data.actualStartAt,earlyAt);
const beforeSkip=calls; await pollGarmin.run({}); assert.equal(calls,beforeSkip);
const inferenceNow=Date.now();
await db.ref(`races/${id}`).set({...r,status:'live',startAt:inferenceNow-7200000,progressKm:2.1,fix:{lng:.0189,lat:0,at:inferenceNow-2400000,km:2.1},previousFix:{lng:.0171,lat:0,at:inferenceNow-3000000,km:1.9},lastFeedPointAt:inferenceNow-2400000,lastLocationReceivedAt:inferenceNow-2400000,feedOk:true});
await db.ref(`jobs/${id}`).update({active:true,startAt:inferenceNow-7200000});xml='<kml><Document/></kml>';
await pollNow();data=(await db.ref(`races/${id}`).get()).val();assert.equal(data.status,'complete');assert.equal(data.finishSource,'estimated');assert.equal((await db.ref(`jobs/${id}/active`).get()).val(),false);
console.log('PASS: scheduled polling claims lease, healthy heartbeat without points, failure heartbeat, splits and automatic finish; completed race is not fetched again.');}finally{globalThis.fetch=original;await db.ref().update({[`races/${id}`]:null,[`jobs/${id}`]:null,[`limits/expiry-${id}`]:null});db.goOffline();}
