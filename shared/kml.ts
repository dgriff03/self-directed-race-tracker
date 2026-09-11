import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Fix } from "./race.js";
export function parseKml(xml: string, maxLength = 5_000_000): Fix[] {
  if (
    xml.length > maxLength ||
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
      const field = fields.find((d: any) =>
        /^(Time UTC|Timestamp|Time)$/i.test(d["@_name"]),
      );
      let timestamp = String(n.TimeStamp?.when ?? field?.value ?? "");
      if (
        !n.TimeStamp?.when &&
        /^Time UTC$/i.test(field?.["@_name"] ?? "") &&
        !/(Z|UTC|[+-]\d{2}:?\d{2})$/i.test(timestamp)
      ) {
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
