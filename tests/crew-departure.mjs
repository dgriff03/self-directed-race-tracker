import {chromium,expect} from '@playwright/test';import assert from 'node:assert/strict';import fs from 'node:fs';
const path='dist/client/firebase-config.json',original=fs.readFileSync(path),id=crypto.randomUUID(),now=Date.now();
const db=p=>`http://127.0.0.1:9000/${p}.json?ns=demo-paceline`,headers={Authorization:'Bearer owner','Content-Type':'application/json'},api='http://127.0.0.1:5001/demo-paceline/us-central1/api';
const fix={lng:.01,lat:0,at:now-60000,km:1.111949266};
const race={id,name:'Crew departure fixture',startAt:now-3600000,route:[[0,0],[.01,0],[.02,0]],stations:[{id:'aid',name:'Aid',km:1.111949266},{id:'finish',name:'Finish',km:2.223898532}],status:'live',progressKm:1.111949266,fix,previousFix:{...fix,at:fix.at-1000},splits:[{stationId:'aid',at:now-120000,estimated:true}],track:[fix],heartbeatAt:now,feedOk:true,finishedAt:null,revision:1};
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 await fetch(db(`races/${id}`),{method:'PUT',headers,body:JSON.stringify(race)});
 fs.writeFileSync(path,JSON.stringify({apiKey:'demo-key',appId:'demo',projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com',apiBase:api,emulator:true}));
 const a=await b.newPage(),c=await b.newPage();
 await Promise.all([a.goto(`http://127.0.0.1:4173/r/${id}`),c.goto(`http://127.0.0.1:4173/r/${id}`)]);
 await expect(a.getByRole('button',{name:'Runner has left this aid',exact:true})).toBeEnabled();
 await a.getByRole('button',{name:'Runner has left this aid',exact:true}).click();
 for(const p of [a,c])await p.getByText(/Crew reported departure from Aid/).waitFor();
 const duplicate=await fetch(`${api}/races/${id}/depart`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({stationId:'aid',fixAt:fix.at})});assert.equal(duplicate.status,409);
 await fetch(db(`races/${id}`),{method:'PATCH',headers,body:JSON.stringify({fix:{...fix,at:now},previousFix:fix})});
 for(const p of [a,c]){await expect(p.getByText(/Crew reported departure from Aid/)).toHaveCount(0);await expect(p.getByRole('button',{name:'Runner has left this aid',exact:true})).toBeEnabled();}
 await a.context().setOffline(true);await expect(a.getByRole('button',{name:'Runner has left this aid',exact:true})).toBeDisabled();
 console.log('PASS shared two-viewer departure, duplicate rejection, next stationary GPS reversal, offline button disabled');
}finally{fs.writeFileSync(path,original);await b.close();await fetch(db(`races/${id}`),{method:'DELETE',headers});}
