import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const handlers={}, urls=[];
let skipped=false;
vm.runInNewContext(readFileSync('dist/client/sw.js','utf8'),{
 self:{addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting:()=>{skipped=true;}},
 caches:{open:async()=>({addAll:async list=>{urls.push(...list);assert.ok(!list.includes('/firebase-config.json'));},add:async()=>{throw Error('404 config');}})},
 Set,Promise,URL,Date,Number,Response
});
let completion;handlers.install({waitUntil:p=>completion=p});await completion;
assert.ok(urls.includes('/index.html'));
assert.ok(urls.some(u=>u.includes('maplibre-gl-')));
assert.equal(skipped,false);
console.log('PASS: missing optional config preserves shell installation; updates do not force activation over open tabs.');
