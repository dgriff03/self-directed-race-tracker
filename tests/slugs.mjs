import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT='demo-paceline';process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com'});
await import('../functions/lib/functions/src/index.js');
const {claimSlug}=await import('../functions/lib/functions/src/slugs.js');
const {getDatabase}=await import('../functions/node_modules/firebase-admin/lib/database/index.js');
const db=getDatabase(),a=crypto.randomUUID(),b=crypto.randomUUID(),legacy=crypto.randomUUID(),slug='race-'+a.slice(0,8);
const extras=Array.from({length:8},(_,i)=>`${slug}-${i}`),old=Array.from({length:5},(_,i)=>`${slug}-old-${i}`);
try {
 const claims=await Promise.allSettled([claimSlug(slug,a),claimSlug(slug,b)]);
 assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);
 const owner=(await db.ref(`slugs/${slug}`).get()).val();
 await claimSlug(slug,owner);
 const more=await Promise.allSettled(extras.map(s=>claimSlug(s,owner)));
 assert.equal(more.filter(x=>x.status==='fulfilled').length,4);
 assert.equal(Object.keys((await db.ref(`slugClaims/${owner}`).get()).val()).length,5);
 await claimSlug(slug,owner); // reuse even when full
 const loser=owner===a?b:a;
 assert.equal((await db.ref(`slugClaims/${loser}`).get()).exists(),false);
 for(const s of old)await db.ref(`slugs/${s}`).set(legacy);
 await assert.rejects(claimSlug(`${slug}-sixth`,legacy),/five/);
 await claimSlug(old[0],legacy);
 for(const word of ['stop','yes','unstop','info'])await assert.rejects(claimSlug(word,a));
 console.log('PASS atomic five-slug cap under parallel requests, legacy seeding, same-owner retries, duplicate slot cleanup and reserved commands');
}finally {
 const updates=Object.fromEntries([slug,...extras,...old,`${slug}-sixth`].map(s=>[`slugs/${s}`,null]));
 for(const id of [a,b,legacy])updates[`slugClaims/${id}`]=null;
 await db.ref().update(updates);db.goOffline();
}
