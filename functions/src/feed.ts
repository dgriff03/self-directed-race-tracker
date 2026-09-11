import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Fix } from "../../shared/race.js";
export function validateFeed(raw: string) {
  const url = new URL(raw);
  if (["share.garmin.com", "share.inreach.garmin.com"].includes(url.hostname) && /^\/[^/]+\/?$/.test(url.pathname)) {
    url.pathname = "/Feed/Share/" + url.pathname.split("/")[1];
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    ![
      "share.garmin.com",
      "share.inreach.garmin.com",
      "inreach.garmin.com",
      "us0.inreach.garmin.com",
      "explore.garmin.com",
    ].includes(url.hostname) ||
    !/^\/(Feed\/Share\/|feed\/Share\/|ECC\/Chat\/KmlFeed\/)/i.test(url.pathname)
  )
    throw new Error("Use a Garmin HTTPS MapShare or KML feed URL.");
  return url;
}
export function parseKml(xml: string): Fix[] {
  if (
    xml.length > 5_000_000 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    XMLValidator.validate(xml) !== true
  )
    throw new Error("Invalid KML");
  const data = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
  }).parse(xml);
  if (!data.kml) throw new Error("Not KML");
  const fixes: Fix[] = [];
  const arr = (x: any) => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  function visit(n: any) {
    if (!n || typeof n !== "object") return;
    if (n.Point?.coordinates) {
      const coord = String(n.Point.coordinates).trim().split(",").map(Number);
      const fields = arr(n.ExtendedData?.Data);
      const field = fields.find((d: any) => /^(Time UTC|Timestamp|Time)$/i.test(d["@_name"]));
      let timestamp = String(n.TimeStamp?.when ?? field?.value ?? "");
      if (!n.TimeStamp?.when && /^Time UTC$/i.test(field?.["@_name"] ?? "") && !/(Z|UTC|[+-]\d{2}:?\d{2})$/i.test(timestamp)) {
        timestamp += /^\d{4}-\d{2}-\d{2}T/.test(timestamp) ? "Z" : " UTC";
      }
      const at = Date.parse(timestamp);
      if (
        Number.isFinite(at) &&
        Number.isFinite(coord[0]) &&
        Math.abs(coord[0]) <= 180 &&
        Number.isFinite(coord[1]) &&
        Math.abs(coord[1]) <= 90
      )
        fixes.push({ lng: coord[0], lat: coord[1], at });
    }
    if (n.Track) {
      for (const track of arr(n.Track)) {
        const times = arr(track.when),
          coords = arr(track.coord);
        coords.forEach((c: any, i: number) => {
          const [lng, lat] = String(c).trim().split(/\s+/).map(Number),
            at = Date.parse(times[i]);
          if (
            Number.isFinite(at) &&
            Number.isFinite(lng) &&
            Math.abs(lng) <= 180 &&
            Number.isFinite(lat) &&
            Math.abs(lat) <= 90
          )
            fixes.push({ lng, lat, at });
        });
      }
    }
    for (const [k, v] of Object.entries(n))
      if (k !== "Track")
        if (Array.isArray(v)) v.forEach(visit);
        else if (typeof v === "object") visit(v);
  }
  visit(data.kml);
  return fixes.sort((a, b) => a.at - b.at);
}
export async function fetchFeed(raw: string, since: number) {
  const url = validateFeed(raw);
  url.searchParams.set("d1", new Date(since).toISOString());
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/vnd.google-earth.kml+xml, application/xml",
    },
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 5_000_000
  )
    throw new Error("Feed unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty feed");
  const decoder = new TextDecoder();
  let xml = "",
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 5_000_000) throw new Error("Feed too large");
      xml += decoder.decode(value, { stream: true });
    }
    xml += decoder.decode();
    return parseKml(xml);
  } finally {
    await reader.cancel();
  }
}
