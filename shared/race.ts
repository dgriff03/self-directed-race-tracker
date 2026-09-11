export type Coordinate = [number, number];
export type Station = { id: string; name: string; km: number };
export type Fix = { lng: number; lat: number; at: number; km?: number };
export type Split = { stationId: string; at: number; estimated: boolean };
export type Race = {
  id: string;
  name: string;
  startAt: number;
  route: Coordinate[];
  distances: number[];
  elevationsM?: number[] | null;
  stations: Station[];
  status: "scheduled" | "live" | "complete";
  progressKm: number;
  fix: Fix | null;
  previousFix: Fix | null;
  splits: Split[];
  heartbeatAt: number | null;
  feedOk: boolean | null;
  finishedAt: number | null;
  revision: number;
  track: Fix[];
  trackingPaused?: boolean;
};
export function distance(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const dlat = (b[1] - a[1]) * rad,
    dlng = (b[0] - a[0]) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dlng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function cumulative(route: Coordinate[]) {
  let total = 0;
  return route.map((p, i) => (i ? (total += distance(route[i - 1], p)) : 0));
}
export function atDistance(
  route: Coordinate[],
  ds: number[],
  km: number,
): Coordinate {
  let i = ds.findIndex((d) => d >= km);
  if (i < 0) return route[route.length - 1];
  if (i === 0) return route[0];
  const f = (km - ds[i - 1]) / (ds[i] - ds[i - 1] || 1);
  return [
    route[i - 1][0] + f * (route[i][0] - route[i - 1][0]),
    route[i - 1][1] + f * (route[i][1] - route[i - 1][1]),
  ];
}
// Restrict ambiguous loop crossings to the reachable route window, choosing the
// earliest equally close segment. GPS jitter cannot move confirmed progress back.
export function project(
  route: Coordinate[],
  ds: number[],
  point: Coordinate,
  minKm = 0,
  maxKm = Infinity,
) {
  let best = { km: minKm, offKm: Infinity };
  for (let i = 1; i < route.length; i++) {
    if (ds[i] < minKm || ds[i - 1] > maxKm) continue;
    const a = route[i - 1],
      b = route[i],
      scale = Math.cos((point[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * scale,
      dy = b[1] - a[1];
    let f =
      ((point[0] - a[0]) * scale * dx + (point[1] - a[1]) * dy) /
      (dx * dx + dy * dy || 1);
    f = Math.max(0, Math.min(1, f));
    const km = ds[i - 1] + (ds[i] - ds[i - 1]) * f;
    if (km < minKm - 0.001 || km > maxKm) continue;
    const offKm = distance(point, [a[0] + f * (b[0] - a[0]), a[1] + f * dy]);
    if (offKm < best.offKm - 0.015) best = { km, offKm };
  }
  return best;
}
export function speed(r: Race) {
  if (!r.fix) return 0;
  const elapsed = (r.fix.at - r.startAt) / 3600000;
  return elapsed > 0 ? Math.min(25, r.progressKm / elapsed) : 0;
}
export function applyFixes(r: Race, fixes: Fix[]): Race {
  let out = structuredClone(r);
  if (out.status === "complete") return out;
  for (const fix of [...fixes].sort((a, b) => a.at - b.at)) {
    if (
      fix.at < out.startAt ||
      fix.at > Date.now() + 120000 ||
      fix.at <= (out.fix?.at ?? 0)
    )
      continue;
    const hours = (fix.at - (out.fix?.at ?? out.startAt)) / 3600000;
    const match = project(
      out.route,
      out.distances,
      [fix.lng, fix.lat],
      Math.max(0, out.progressKm - 0.1),
      out.progressKm + Math.max(0.3, hours * 25),
    );
    if (match.offKm > 0.25) continue;
    const km = Math.max(out.progressKm, match.km);
    const previous = out.fix;
    for (const station of out.stations) {
      if (
        station.km <= km &&
        !out.splits.some((s) => s.stationId === station.id)
      ) {
        const oldKm = out.progressKm;
        const oldAt = previous?.at ?? out.startAt;
        const fraction = Math.max(
          0,
          Math.min(1, (station.km - oldKm) / (km - oldKm || 1)),
        );
        out.splits.push({
          stationId: station.id,
          at: Math.round(oldAt + (fix.at - oldAt) * fraction),
          estimated: true,
        });
      }
    }
    out.previousFix = previous;
    out.fix = { ...fix, km };
    out.progressKm = km;
    out.track = [...out.track, { ...fix, km }].slice(-2000);
    out.status = "live";
    const total = out.distances.at(-1)!;
    if (
      km >= total - 0.05 &&
      distance([fix.lng, fix.lat], out.route.at(-1)!) < 0.075
    ) {
      out.status = "complete";
      out.finishedAt = fix.at;
      out.progressKm = total;
      if (!out.splits.some((s) => s.stationId === "finish"))
        out.splits.push({ stationId: "finish", at: fix.at, estimated: true });
      break;
    }
  }
  return out;
}
export function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

// Keep persisted route distances in km for compatibility; convert at the UI boundary.
export const kmToMiles = (km: number) => km / 1.609344;
export const milesToKm = (miles: number) => miles * 1.609344;
export const metersToFeet = (meters: number) => meters / 0.3048;
export function pacePerMile(kmh: number) {
  if (!(kmh > 0)) return "—";
  const seconds = Math.round(3600 / kmToMiles(kmh));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}
// Planned ascent traversed at confirmed route progress, not barometric/GPS altitude.
// An incomplete elevation profile is unknown, never a misleading zero.
export function elevationProgress(
  distances: number[],
  elevationsM: number[] | null | undefined,
  progressKm: number,
) {
  if (
    !elevationsM ||
    elevationsM.length !== distances.length ||
    distances.length < 2 ||
    elevationsM.some((e) => !Number.isFinite(e))
  )
    return null;
  let totalM = 0,
    completedM = 0;
  for (let i = 1; i < distances.length; i++) {
    const rise = Math.max(0, elevationsM[i] - elevationsM[i - 1]);
    totalM += rise;
    const span = distances[i] - distances[i - 1];
    const fraction =
      span > 0
        ? Math.max(0, Math.min(1, (progressKm - distances[i - 1]) / span))
        : progressKm >= distances[i]
          ? 1
          : 0;
    completedM += rise * fraction;
  }
  return { totalM, completedM };
}
