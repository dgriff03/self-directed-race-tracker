import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64');
try {
 const p=await b.newPage(),errors=[],requests=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push(r.url()));
 await p.route('https://basemap.nationalmap.gov/**',r=>r.fulfill({status:404,body:'No coverage'}));
 await p.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/png',body:png}));
 await p.goto(`${process.env.RACE_TEST_ORIGIN||'http://127.0.0.1:4173'}/demo`);
 await p.getByText('OpenStreetMap contributors',{exact:true}).waitFor();await p.locator('.map-marker.runner').waitFor();
 assert.ok(requests.some(u=>u.includes('basemap.nationalmap.gov')));await expect.poll(()=>requests.some(u=>u.includes('tile.openstreetmap.org'))).toBe(true);
 await p.goto(`${process.env.RACE_TEST_ORIGIN||'http://127.0.0.1:4173'}/replay`);
 const gpx='<gpx><trk><trkseg><trkpt lon="6" lat="46"/><trkpt lon="6.01" lat="46.01"/></trkseg></trk></gpx>';
 // A dense day-long recording verifies the former 10,000-position rejection is gone.
 const start=Date.UTC(2040,0,1),kml='<kml><Document>'+Array.from({length:17280},(_,i)=>`<Placemark><TimeStamp><when>${new Date(start+i*5000).toISOString()}</when></TimeStamp><Point><coordinates>6,46</coordinates></Point></Placemark>`).join('')+'</Document></kml>';
 await p.locator('input[type=file]').nth(0).setInputFiles({name:'alps.gpx',mimeType:'application/gpx+xml',buffer:Buffer.from(gpx)});
 requests.length=0;
 await p.locator('input[type=file]').nth(1).setInputFiles({name:'day.kml',mimeType:'application/vnd.google-earth.kml+xml',buffer:Buffer.from(kml)});
 await p.getByText(/17,280 recorded positions/).waitFor();await p.getByText('OpenStreetMap contributors',{exact:true}).waitFor();
 await p.getByRole('slider').fill(String(start+17279*5000));await p.locator('.map-marker.runner').waitFor();
 assert.equal(requests.some(u=>u.includes('basemap.nationalmap.gov')),false);
 await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 assert.deepEqual(errors,[]);console.log('PASS USGS error fallback, direct global selection, visible route/runner, dense KML upload and mobile layout');
}finally{await b.close();}
