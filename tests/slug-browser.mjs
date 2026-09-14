import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const configPath='dist/client/firebase-config.json',original=fs.readFileSync(configPath);
const api='http://127.0.0.1:5001/demo-paceline/us-central1/api',db=p=>`http://127.0.0.1:9000/${p}.json?ns=demo-paceline`,admin={Authorization:'Bearer owner','Content-Type':'application/json'};
const slug='trail-'+crypto.randomUUID().slice(0,8),body={slug,name:'Slug browser fixture',startAt:Date.now()+3600000,route:[[0,0],[0.01,0],[0.02,0]],stations:[],feedUrl:'https://share.garmin.com/Feed/Share/test'};
const call=async(path,method,data,token)=>{const r=await fetch(api+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
let created;const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
created=await call('/races','POST',body);assert.equal(created.status,201,JSON.stringify(created));const {id,editToken}=created.data;
const duplicate=await call('/races','POST',body);assert.equal(duplicate.status,400);assert.match(duplicate.data.error,/taken/);
const edit=await call('/edit','GET',undefined,editToken);assert.equal(edit.data.race.slug,slug);
const next=slug+'-new';const update=await call('/edit','PUT',{...body,slug:next,revision:1},editToken);assert.equal(update.status,200,JSON.stringify(update));assert.equal(update.data.race.slug,next);
for(const alias of [slug,next])assert.equal(await(await fetch(db(`slugs/${alias}`))).json(),id);
fs.writeFileSync(configPath,JSON.stringify({apiKey:'demo-key',appId:'demo',projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com',apiBase:api,emulator:true}));
const p=await b.newPage({viewport:{width:390,height:844}});
await p.goto(`http://127.0.0.1:4173/r/${slug}`);await p.getByRole('heading',{name:body.name,exact:true}).waitFor();
assert((await p.getByRole('link',{name:'Open messaging app'}).getAttribute('href')).includes(next));
await p.waitForTimeout(800);await p.context().setOffline(true);await p.reload();await p.getByRole('heading',{name:body.name,exact:true}).waitFor();await p.waitForTimeout(1000);await expect(p.getByRole('alert')).toHaveCount(0);await p.context().setOffline(false);
await p.goto('http://127.0.0.1:4173/setup');await p.getByPlaceholder('highline-2026').fill(slug);await p.getByText('Taken — choose another slug.',{exact:true}).waitFor();await p.getByPlaceholder('highline-2026').fill(slug+'-free');await p.getByText('Available — reserved when you save.',{exact:true}).waitFor();await p.goto('http://127.0.0.1:4173/replay');await p.getByPlaceholder('Race slug, UUID or viewer URL').fill(slug);await p.getByRole('button',{name:'Load event',exact:true}).click();await p.getByText('This event has no recorded locations yet.',{exact:true}).waitFor();
console.log('PASS create/edit slug, duplicate rejection, retained aliases, mobile viewer, SMS reference, offline reload, replay resolution');
}finally{fs.writeFileSync(configPath,original);await b.close();if(created?.data?.id){const id=created.data.id;await fetch(db(''),{method:'PATCH',headers:admin,body:JSON.stringify({[`races/${id}`]:null,[`courses/${id}`]:null,[`jobs/${id}`]:null,[`slugs/${slug}`]:null,[`slugs/${slug}-new`]:null,[`slugClaims/${id}`]:null})});}}
