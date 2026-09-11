import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1050}});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await page.goto('http://127.0.0.1:4173/demo');await page.getByText('VERT COMPLETED',{exact:true}).waitFor();
assert.equal(/\bkm\b/.test(await page.locator('body').innerText()),false);
await page.getByText('min/mi',{exact:true}).waitFor();
await page.locator('.map-marker.runner').waitFor();await page.screenshot({path:'/tmp/paceline-units-desktop.png',fullPage:true});
await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'/tmp/paceline-units-mobile.png',fullPage:true});
await page.goto('http://127.0.0.1:4173/setup');
await page.getByLabel('Race name',{exact:true}).fill('Elevation check');await page.getByLabel('Start date & time').fill('2026-12-01T06:00');await page.getByLabel('Garmin KML feed URL',{exact:false}).fill('https://share.garmin.com/Feed/Share/test');
const gpx='<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="40" lon="-105"><ele>1000</ele></trkpt><trkpt lat="40.01" lon="-105.01"><ele>1100</ele></trkpt><trkpt lat="40.02" lon="-105.02"><ele>1050</ele></trkpt></trkseg></trk></gpx>';
await page.locator('input[type=file]').setInputFiles({name:'vert.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(gpx)});
await page.getByText('328 ft total elevation gain · from GPX',{exact:true}).waitFor();
await page.getByLabel('Name',{exact:true}).fill('One mile aid');await page.getByLabel('Distance (mi)').fill('1');await page.getByRole('button',{name:'Add aid station'}).click();await page.getByText('1.00 mi from start').waitFor();
let payload;await page.route('**/api/races',async route=>{payload=route.request().postDataJSON();await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Test request captured'})});});
await page.getByRole('button',{name:'Create race & private links'}).click();await page.getByText('Test request captured').waitFor();assert.deepEqual(payload.elevationsM,[1000,1100,1050]);assert.equal(payload.stations[0].km,1.609344);
await page.locator('input[type=file]').setInputFiles({name:'partial.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(gpx.replace('<ele>1100</ele>',''))});await page.getByText('164 ft total elevation gain · from GPX',{exact:true}).waitFor();await page.getByText('1.00 mi from start').waitFor();
assert.deepEqual(errors,[]);console.log('PASS: miles and pace, elevation preview, mobile layout, GPX elevation payload, station distance conversion, missing-profile state, and identical-route station preservation.');
}finally{await browser.close();}
