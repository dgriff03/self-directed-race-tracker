import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {storedCourse,storedLive,storedFix,trackKey,hydrateRace} from '../functions/lib/shared/storage.js';
const require=createRequire(import.meta.url),auth=require('../node_modules/firebase-tools/lib/auth.js');
const account=auth.getGlobalDefaultAccount();const token=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform','https://www.googleapis.com/auth/firebase','https://www.googleapis.com/auth/userinfo.email']);
const headers={Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'};
const base='https://self-directed-tracker-type-two-default-rtdb.firebaseio.com';
async function request(path,options={}) {const r=await fetch(`${base}/${path}.json`,{...options,headers:{...headers,...options.headers}});if(!r.ok)throw Error(`Database request failed ${r.status}`);return r;}
fs.mkdirSync('work',{recursive:true});
const all=await (await request('races')).json();
fs.writeFileSync(`work/races-before-storage-migration-${Date.now()}.json`,JSON.stringify(all),{mode:0o600});
const plan=Object.entries(all??{}).filter(([,r])=>!r.courseVersion).map(([id,r])=>({id,status:r.status,points:r.route?.length??0,beforeBytes:Buffer.byteLength(JSON.stringify(r)),liveBytes:Buffer.byteLength(JSON.stringify(storedLive({...hydrateRace(r),courseVersion:'00000000-0000-4000-8000-000000000000'})))}));
console.log(JSON.stringify(plan));
if(process.env.MILEMARK_MIGRATE!=='1')process.exit(0);
for(const item of plan){
 const response=await request(`races/${item.id}`,{headers:{'X-Firebase-ETag':'true'}});const raw=await response.json();if(raw.courseVersion)continue;
 // Refuse to migrate a moving race; run again once finished to avoid racing breadcrumb writes.
 if(raw.status==='live' && raw.fix)throw Error(`Active race ${item.id} requires a quiet migration window`);
 const version=randomUUID(),race=hydrateRace(raw),course=storedCourse(race),live=storedLive({...race,courseVersion:version,revision:(race.revision??0)+1});
 const tracks=Object.fromEntries(race.track.slice(-500).map(f=>[trackKey(f),storedFix(f)]));
 await request('',{method:'PATCH',body:JSON.stringify({[`courses/${item.id}/${version}`]:course,[`tracks/${item.id}`]:Object.keys(tracks).length?tracks:null})});
 const commit=await fetch(`${base}/races/${item.id}.json`,{method:'PUT',headers:{...headers,'if-match':response.headers.get('etag')},body:JSON.stringify(live)});
 if(!commit.ok)throw Error(`Race ${item.id} changed during migration (${commit.status}); original record preserved`);
 console.log(`Migrated ${item.id}: ${item.beforeBytes} -> ${Buffer.byteLength(JSON.stringify(live))} live bytes`);
}
