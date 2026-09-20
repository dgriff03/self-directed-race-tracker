import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto('http://127.0.0.1:4173/demo');
  await page.getByRole('heading',{name:'Boulder Foothills Loop',exact:true}).waitFor();
  const id=crypto.randomUUID(),now=Date.now();
  const race={id,name:'Off route regression',startAt:now-3600000,route:[[-105,40],[-104.99,40],[-104.98,40]],distances:[0,.85,1.7],stations:[{id:'aid',name:'Aid',km:1.2},{id:'finish',name:'Finish',km:1.7}],status:'live',progressKm:.85,fix:{lng:-104.99,lat:40,at:now-600000,km:.85},latestLocation:{lng:-105.01,lat:40.01,at:now},offRoute:true,track:[],splits:[],revision:1,feedOk:true,heartbeatAt:now};
  await page.evaluate(async race=>{await new Promise((resolve,reject)=>{const req=indexedDB.open('milemark-offline',1);req.onupgradeneeded=()=>req.result.createObjectStore('races',{keyPath:'id'});req.onerror=reject;req.onsuccess=()=>{const db=req.result,tx=db.transaction('races','readwrite');tx.objectStore('races').put(race);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=reject;};});},race);
  // Block the live backend: render the retained snapshot, including off-route GPS.
  await page.route('**/firebase-config.json',route=>route.abort());
  await page.goto(`http://127.0.0.1:4173/r/${id}`);
  await expect(page.getByRole('heading',{name:'Off route regression',exact:true})).toBeVisible();
  await expect(page.getByText('ETAs are paused until the runner rejoins.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Show latest GPS location'})).toBeVisible();
  await expect(page.locator('[aria-label="Latest Garmin location · Off route"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Show latest GPS location'}).click();
  await expect(page.locator('[aria-label="Latest Garmin location · Off route"]')).toBeInViewport();
  for(const row of await page.locator('.station-row').all()) {
    if(await row.locator('h3').innerText()==='Start line') continue;
    await expect(row.locator('.station-time')).toContainText('ETA paused · off route');
  }
  console.log('PASS retained off-route location, mobile notice, map recenter, paused aid ETAs');
} finally {await browser.close();}
