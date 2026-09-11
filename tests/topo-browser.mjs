import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const c=await b.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();
try{
await p.goto('http://127.0.0.1:4173/setup');
const background=await p.evaluate(()=>getComputedStyle(document.body,'::before').backgroundImage);
assert.ok(background.includes('topo-contours'));
const url=background.match(/url\("?([^"\)]+)/)[1];
await p.evaluate(async url=>{const i=new Image();i.src=url;await i.decode();},url);
await p.screenshot({path:'/tmp/paceline-topo-desktop.png',fullPage:true});
await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await p.screenshot({path:'/tmp/paceline-topo-mobile.png',fullPage:true});
await p.goto('http://127.0.0.1:4173/demo');await p.getByText('VERT COMPLETED',{exact:true}).waitFor();await p.evaluate(()=>navigator.serviceWorker.ready);
await c.setOffline(true);await p.reload();await p.getByText('VERT COMPLETED',{exact:true}).waitFor();
await p.evaluate(async()=>{const url=getComputedStyle(document.body,'::before').backgroundImage.match(/url\("?([^"\)]+)/)[1];const i=new Image();i.src=url;await i.decode();});
console.log('PASS: desktop/mobile topo background loaded, no overflow, background and race still render offline.');
}finally{await b.close();}
