import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {applyFixes,cumulative} from '../functions/lib/shared/race.js';
const configPath='dist/client/firebase-config.json',original=readFileSync(configPath);
const api='http://127.0.0.1:5001/demo-paceline/us-central1/api';
const admin={Authorization:'Bearer owner','Content-Type':'application/json'};
const db=path=>`http://127.0.0.1:9000/${path}.json?ns=demo-paceline`;
const coords=[[-105,40],[-104.95,40],[-104.9,40],[-104.95,40],[-105,40]],ds=cumulative(coords),start=Date.now()-3*3600000;
const points=[0,.005,.01,.015,.02,.025,.03,.025,.02,.015,.01,.005,0].map((lng,i)=>({lng:-105+lng,lat:40,at:start+i*600000}));
const gpx='<gpx><trk><trkseg>'+coords.map(([lng,lat])=>`<trkpt lon="${lng}" lat="${lat}"/>`).join('')+'</trkseg></trk></gpx>';
const kml='<kml><Document>'+points.map(p=>`<Placemark><TimeStamp><when>${new Date(p.at).toISOString()}</when></TimeStamp><Point><coordinates>${p.lng},${p.lat}</coordinates></Point></Placemark>`).join('')+'</Document></kml>';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let id,token;const errors=[];
try {
 const p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:4173/replay');
 await p.locator('input[type=file]').nth(0).setInputFiles({name:'outback.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(gpx)});
 await p.locator('input[type=file]').nth(1).setInputFiles({name:'return.kml',mimeType:'application/vnd.google-earth.kml+xml',buffer:Buffer.from(kml)});
 await p.getByRole('checkbox',{name:/Out-and-back/}).check();
 await p.getByLabel('Station name',{exact:true}).fill('Summit');await p.getByLabel('Station distance (mi)').fill(String(ds.at(-1)/2/1.609344));await p.getByRole('button',{name:'Add station',exact:true}).click();
 await p.getByRole('slider').fill(String(points[9].at));await p.getByText(/Returning early/).waitFor();await p.getByText('Skipped · early return',{exact:true}).waitFor();await p.locator('.map-marker.runner').waitFor();await p.screenshot({path:'/tmp/milemark-early-return.png',fullPage:true});
 await p.getByRole('slider').fill(String(points[6].at));await expect(p.getByText(/Returning early/)).toHaveCount(0);
 await p.getByRole('slider').fill(String(points[12].at));await p.getByText('Finished',{exact:true}).waitFor();
 await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 writeFileSync(configPath,JSON.stringify({apiKey:'demo-key',appId:'demo-app',projectId:'demo-paceline',databaseURL:'https://demo-paceline.firebaseio.com',emulator:true,apiBase:api}));
 const body={name:'Outback integration',startAt:start,route:coords,stations:[{id:crypto.randomUUID(),name:'Summit',km:ds.at(-1)/2}],outAndBack:true,feedUrl:'https://share.garmin.com/Feed/Share/test'};
 const created=await fetch(api+'/races',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(created.status,201,await created.clone().text());({id,editToken:token}=await created.json());
 const get=()=>fetch(api+'/edit',{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());
 const initial=(await get()).race;assert.equal(initial.outAndBack,true);
 await fetch(db(`races/${id}`),{method:'PUT',headers:admin,body:JSON.stringify(applyFixes(initial,points.slice(0,7),Date.now()))});
 const viewer=await browser.newPage();viewer.on('pageerror',e=>errors.push(e.message));await viewer.goto('http://127.0.0.1:4173/r/'+id);await viewer.getByText(/Out-and-back · outbound/).waitFor();
 const editor=await browser.newPage();editor.on('pageerror',e=>errors.push(e.message));await editor.goto('http://127.0.0.1:4173/edit/'+token);
 const reply=editor.waitForResponse(r=>r.url().endsWith('/edit') && r.request().method()==='POST');await editor.getByRole('button',{name:'We’ve turned around',exact:true}).click();const response=await reply;assert.equal(response.status(),200,await response.text());await viewer.getByText(/Returning early/).waitFor();await viewer.getByText('Skipped · early return',{exact:true}).waitFor();
 await editor.getByRole('button',{name:'Resume original route',exact:true}).click();await viewer.getByText(/Out-and-back · outbound/).waitFor();assert.equal((await get()).race.journey.phase,'outbound');
 const unauthorized=await fetch(api+'/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'turnaround'})});assert.notEqual(unauthorized.status,200);
 const updated=(await get()).race;
 const locked=await fetch(api+'/edit',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({...body,outAndBack:false,revision:updated.revision})});assert.equal(locked.status,409);
 assert.deepEqual(errors,[]);console.log('PASS early-return replay, skipped summit, rewind, mobile, API mode persistence and lock, editor overrides, viewer realtime, unauthorized override rejected');
} finally {
 writeFileSync(configPath,original);await browser.close();
 if(id){await fetch(db(`races/${id}`),{method:'DELETE',headers:admin});await fetch(db(`jobs/${id}`),{method:'DELETE',headers:admin});}
 if(token)await fetch(db(`editKeys/${createHash('sha256').update(token).digest('hex')}`),{method:'DELETE',headers:admin});
}
