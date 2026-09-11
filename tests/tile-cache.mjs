import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {USGS,OSM,preferredBasemap} from '../shared/map-tiles.mjs';
assert.equal(preferredBasemap([[-105,40]]).url,USGS.url);
for(const point of [[-123,50],[6,46],[139,35],[-70,-33]])assert.equal(preferredBasemap([point]).url,OSM.url);
assert.equal(preferredBasemap([[0,0]],'https://custom.test/{z}/{x}/{y}.png','Example').attribution,'Example');
const template='https://custom.test/maps/{z}/{x}/{y}.png?key=public';
const source=readFileSync('public/sw.js','utf8').replace(/const TILE_TEMPLATES = \[[\s\S]*?\];/,`const TILE_TEMPLATES = ${JSON.stringify([USGS.url,OSM.url,template])};`);
const handlers={},entries=new Map();let calls=0,offline=false,noStore=false;
const cache={match:async r=>entries.get(r.url),put:async(r,v)=>entries.set(r.url,v),keys:async()=>Array.from(entries.keys()),delete:async k=>entries.delete(k)};
const context={self:{location:{origin:'https://milemark.test'},addEventListener:(name,f)=>handlers[name]=f},caches:{open:async()=>cache},fetch:async()=>{calls++;if(offline)throw Error('offline');return new Response('tile',{headers:{'Cache-Control':noStore?'no-store':'max-age=3600'}});},URL,Date,Number,Set,Promise,Response,Headers};
vm.runInNewContext(source,context);
const invoke=(url,headers={})=>{let response;handlers.fetch({request:new Request(url,{headers}),respondWith:p=>response=p});return response;};
for(const url of [USGS.url.replace('{z}','10').replace('{x}','230').replace('{y}','410'),OSM.url.replace('{z}','10').replace('{x}','230').replace('{y}','410'),'https://custom.test/maps/10/230/410.png?key=public']){
 const result=await invoke(url);assert.equal(await result.text(),'tile');const before=calls;
 assert.equal(await (await invoke(url)).text(),'tile');assert.equal(calls,before);
 const cached=entries.get(url);const headers=new Headers(cached.headers);headers.set('cache-control','max-age=0');entries.set(url,new Response('tile',{headers}));
 offline=true;assert.equal(await (await invoke(url)).text(),'tile');offline=false;
}
assert.equal(invoke('https://unconfigured.test/maps/1/2/3.png'),undefined);
assert.equal(invoke('https://custom.test/maps/1/2/3.png?key=wrong'),undefined);
assert.equal(invoke('https://custom.test/maps/1/2/3.png?key=public',{Authorization:'Bearer private'}),undefined);
assert.equal(invoke('https://milemark.test/api/1/2/3'),undefined);
noStore=true;const uncached='https://custom.test/maps/1/2/3.png?key=public';await invoke(uncached);assert.equal(entries.has(uncached),false);
console.log('PASS global basemap selection, configured tile whitelist, fresh cache, stale offline fallback, no-store and private/unconfigured request exclusion');
