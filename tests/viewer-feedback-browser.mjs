import {chromium, expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const configPath='dist/client/firebase-config.json',original=readFileSync(configPath);
const id=crypto.randomUUID(),now=Date.now(),url=`http://127.0.0.1:9000/races/${id}.json?ns=demo-paceline`;
const headers={Authorization:'Bearer owner','Content-Type':'application/json'};
const r={id,name:'Viewer feedback test',startAt:now-3600000,route:[[0,0],[.01,0],[.02,0],[.03,0]],distances:[0,1,2,3],stations:[{id:'a',name:'First aid',km:1.1},{id:'b',name:'Second aid',km:2},{id:'finish',name:'Finish line',km:3}],status:'live',progressKm:1,fix:{lng:.01,lat:0,km:1,at:now-1200000},track:[],splits:[],revision:1,heartbeatAt:now,feedOk:true,lastLocationReceivedAt:now-1100000,nextUpdateExpectedAt:now-500000};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 writeFileSync(configPath,JSON.stringify({apiKey:'demo-key',appId:'demo-app',projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com',emulator:true}));
 await fetch(url,{method:'PUT',headers,body:JSON.stringify(r)});
 const p=await browser.newPage({viewport:{width:390,height:844}});
 await p.goto(`http://127.0.0.1:4173/r/${id}`);await p.getByText('Last location update received at',{exact:false}).waitFor();
 await expect(p.getByText('Next update expected at',{exact:false})).toBeVisible();
 await expect(p.getByText('Last connected to server at',{exact:false})).toHaveCount(0);
 await expect(p.getByText('Likely at · awaiting GPS',{exact:true})).toHaveCount(1);
 await expect(p.getByText(/Overdue|Feed healthy|Health checked/)).toHaveCount(0);
 for(const label of ['First aid','Second aid','Finish line']) {
   const row=p.locator('.station-row').filter({has:p.getByRole('heading',{name:label,exact:true})});
   assert.notEqual(await row.locator('.station-time strong').innerText(),'—');
 }
 await fetch(url,{method:'PATCH',headers,body:JSON.stringify({heartbeatAt:now-16*60000,feedOk:false,feedError:'Garmin HTTP 503'})});
 await expect(p.getByRole('alert')).toContainText('Garmin feed unavailable');
 await expect(p.getByText('Last connected to server at',{exact:false})).toBeVisible();
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('PASS mobile viewer: all remaining ETAs, likely-at wording, received/expected times, stale-only connection notice, prominent feed error');
} finally { writeFileSync(configPath,original);await fetch(url,{method:'DELETE',headers});await browser.close(); }
