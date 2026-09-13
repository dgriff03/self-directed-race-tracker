import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT='demo-paceline';process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com'});
await import('../functions/lib/functions/src/index.js');
const {getDatabase}=await import('../functions/node_modules/firebase-admin/lib/database/index.js');
const {loadRace,flushTrack}=await import('../functions/lib/functions/src/race-storage.js');
const {storedLive,storedCourse,trackKey}=await import('../functions/lib/shared/storage.js');
const db=getDatabase(),id=crypto.randomUUID(),version=crypto.randomUUID(),at=Date.now()-1000000;
const race={id,courseVersion:version,name:'Storage test',route:[[0,0],[.01,0]],elevationsM:[100,101],distances:[0,1],stations:[],startAt:at,status:'live',fix:null,previousFix:null,progressKm:0,track:[],splits:[],heartbeatAt:null,feedOk:null,finishedAt:null,revision:1};
const entries=Object.fromEntries(Array.from({length:500},(_,i)=>{const f={at:at+i*1000,lng:0,lat:0,km:0};return [trackKey(f),f]}));
try{
 await db.ref().update({[`races/${id}`]:storedLive(race),[`courses/${id}/${version}`]:storedCourse(race),[`tracks/${id}`]:entries});
 const next={lng:.001,lat:0,at:at+500000,km:.111};
 await db.ref(`races/${id}/trackOutbox`).set({[trackKey(next)]:next});
 await flushTrack(id);await flushTrack(id);
 const track=(await db.ref(`tracks/${id}`).get()).val();assert.equal(Object.keys(track).length,500);assert.equal(track[String(at)],undefined);assert.deepEqual(track[String(at+1000)],entries[String(at+1000)]);assert.deepEqual(track[trackKey(next)],next);
 const raw=(await db.ref(`races/${id}`).get()).val();assert.equal(raw.trackOutbox,undefined);for(const key of ['route','elevationsM','distances','track'])assert.equal(raw[key],undefined);
 const loaded=await loadRace(raw);assert.equal(loaded.route.length,2);assert.equal(loaded.track.length,500);assert.ok(loaded.distances.at(-1)>1);
 console.log('PASS split course, computed distance, stable 500-point trim, idempotent outbox recovery and hydrated read');
}finally{await db.ref().update({[`races/${id}`]:null,[`courses/${id}`]:null,[`tracks/${id}`]:null});db.goOffline();}
