import { loadEnv } from "vite";
import { USGS, OSM } from "../shared/map-tiles.mjs";
import { readdir, readFile, writeFile } from "node:fs/promises";
const assets = (await readdir("dist/client/assets")).map((f) => `/assets/${f}`);
let sw = await readFile("dist/client/sw.js", "utf8");
if (!sw.includes("const PRECACHE ="))
  throw new Error("Missing service worker precache marker");
sw = sw.replace(
  /const PRECACHE = \[[\s\S]*?\];/,
  `const PRECACHE = ${JSON.stringify(["/", "/index.html", "/favicon.svg", "/manifest.webmanifest", ...assets])};`,
);
const env = {
  ...loadEnv("production", process.cwd(), "VITE_"),
  ...process.env,
};
const templates = [USGS.url, OSM.url, env.VITE_MAP_TILE_URL].filter(Boolean);
sw = sw.replace(
  /const TILE_TEMPLATES = \[[\s\S]*?\];/,
  `const TILE_TEMPLATES = ${JSON.stringify(templates)};`,
);
await writeFile("dist/client/sw.js", sw);
