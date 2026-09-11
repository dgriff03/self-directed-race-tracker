import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const origin=process.env.RACE_TEST_ORIGIN;
if(!origin?.startsWith('https://'))throw Error('Set RACE_TEST_ORIGIN to the deployed HTTPS origin.');
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await b.newContext({viewport:{width:390,height:844}}),p=await c.newPage();
const errors=[];p.on('pageerror',e=>errors.push(e.message));
let cleanupFile;
try{
await p.goto(origin+'/setup');
await p.getByLabel('Race name',{exact:true}).fill('Deployment verification');
const future=new Date(Date.now()+7*86400000);future.setMinutes(0,0,0);const inputDate=new Date(future.getTime()-future.getTimezoneOffset()*60000).toISOString().slice(0,16);
await p.getByLabel('Start date & time').fill(inputDate);
await p.getByLabel('Garmin KML feed URL',{exact:false}).fill('https://share.garmin.com/Feed/Share/paceline-deployment-verification');
await p.locator('input[type=file]').setInputFiles({name:'route.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from('<gpx><trk><trkseg><trkpt lat="40" lon="-105"><ele>1000</ele></trkpt><trkpt lat="40.01" lon="-105.01"><ele>1100</ele></trkpt><trkpt lat="40.02" lon="-105.02"><ele>1050</ele></trkpt></trkseg></trk></gpx>')});
await p.getByRole('button',{name:'Create race & private links'}).click();
await p.waitForURL(/\/edit\//,{timeout:60000});
await p.getByRole('heading',{name:'Race links'}).waitFor();
const viewer=await p.getByRole('link',{name:'Open live viewer'}).getAttribute('href');
const id=viewer.split('/').pop(),token=new URL(p.url()).pathname.split('/').pop();
cleanupFile=`/tmp/milemark-production-${id}.json`;
writeFileSync(cleanupFile,JSON.stringify({[`races/${id}`]:null,[`jobs/${id}`]:null,[`editKeys/${createHash('sha256').update(token).digest('hex')}`]:null}));
const v=await c.newPage();await v.addInitScript(()=>{Object.defineProperty(window,'WebSocket',{value:undefined});});let longPollRequests=0;v.on('request',r=>{if(r.url().includes('/.lp?'))longPollRequests++;});v.on('pageerror',e=>errors.push(e.message));await v.goto(origin+viewer);
await v.getByRole('heading',{name:'Deployment verification'}).waitFor();await v.getByText('VERT COMPLETED',{exact:true}).waitFor();await v.getByText('/ 328 ft',{exact:true}).waitFor();assert.equal(/\bkm\b/.test(await v.locator('body').innerText()),false);await v.getByText('Event starting at',{exact:false}).waitFor();
await p.getByLabel('Race name',{exact:true}).fill('Verified live updates');await p.getByRole('button',{name:'Save changes'}).click();
await v.getByRole('heading',{name:'Verified live updates'}).waitFor();
assert.equal(await v.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
assert.equal((await v.locator('body').innerText()).includes('paceline-deployment-verification'),false);
await p.getByRole('button',{name:'Mark race complete'}).click();await p.getByRole('button',{name:'Finish race',exact:true}).click();
await v.getByText('FINISHED',{exact:true}).waitFor();
await v.evaluate(()=>navigator.serviceWorker.ready);await v.waitForTimeout(1000);await c.setOffline(true);await v.reload();
await v.getByRole('heading',{name:'Verified live updates'}).waitFor();await v.getByText('FINISHED',{exact:true}).waitFor();
assert.equal((await v.locator('body').innerText()).includes('Failed to fetch'),false);
await c.setOffline(false);await v.getByText('FINISHED',{exact:true}).waitFor();
assert.ok(longPollRequests>0,"Viewer should connect with Firebase long polling when WebSockets are unavailable");
assert.deepEqual(errors,[]);
console.log('PASS: production creation, editing, independent realtime viewer, mobile layout, completion, and offline archive reload. Cleanup recorded.');
}finally{
 await b.close();
 if(cleanupFile){
  const result=spawnSync(process.execPath,['node_modules/firebase-tools/lib/bin/firebase.js','database:update','/',cleanupFile,'--project','self-directed-tracker-type-two','--force','--non-interactive'],{stdio:'inherit'});
  if(result.status!==0)throw Error(`Test cleanup failed; recovery file: ${cleanupFile}`);
 }
}
