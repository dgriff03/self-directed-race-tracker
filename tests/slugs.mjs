import assert from 'node:assert/strict';
process.env.GCLOUD_PROJECT='demo-paceline';process.env.FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000';process.env.FIREBASE_CONFIG=JSON.stringify({projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com'});
await import('../functions/lib/functions/src/index.js');
const {claimSlug}=await import('../functions/lib/functions/src/slugs.js');
const {getDatabase}=await import('../functions/node_modules/firebase-admin/lib/database/index.js');
const db=getDatabase(),a=crypto.randomUUID(),b=crypto.randomUUID(),slug='race-'+a.slice(0,8);
try{const claims=await Promise.allSettled([claimSlug(slug,a),claimSlug(slug,b)]);assert.equal(claims.filter(x=>x.status==='fulfilled').length,1);const owner=(await db.ref(`slugs/${slug}`).get()).val();await claimSlug(slug,owner);assert.equal((await db.ref(`slugs/${slug}`).get()).val(),owner);await assert.rejects(claimSlug('stop',a));console.log('PASS concurrent slug claims have one winner; owner retries are idempotent; reserved commands rejected');}finally{await db.ref(`slugs/${slug}`).remove();db.goOffline()}
