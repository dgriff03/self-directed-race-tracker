import tzLookup from "tz-lookup";
import type { Coordinate } from "./race.js";

const zones = new Map<string, string>();
/** Use the course start, including for existing races with no stored timezone. */
export function raceTimeZone(race: { route: Coordinate[] }): string {
  const point = race.route[0];
  if (!point) return Intl.DateTimeFormat().resolvedOptions().timeZone;
  const key = point.join(",");
  let zone = zones.get(key);
  if (!zone) {
    zone = tzLookup(point[1], point[0]);
    if (zones.size > 100) zones.clear();
    zones.set(key, zone);
  }
  return zone;
}
export function raceTime(race: { route: Coordinate[] }, at: number): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: raceTimeZone(race),
    timeZoneName: "short",
  });
}
