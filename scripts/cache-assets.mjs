import { readdir, readFile, writeFile } from 'node:fs/promises';
const assets = (await readdir('dist/client/assets')).map(f => `/assets/${f}`);
let sw = await readFile('dist/client/sw.js', 'utf8');
if (!sw.includes('const PRECACHE =')) throw new Error('Missing service worker precache marker');
sw = sw.replace(/const PRECACHE = \[[\s\S]*?\];/, `const PRECACHE = ${JSON.stringify(['/','/index.html','/favicon.svg','/manifest.webmanifest',...assets])};`);
await writeFile('dist/client/sw.js', sw);
