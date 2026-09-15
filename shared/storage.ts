import {
  cumulative,
  stationVisits,
  type Race,
  type Fix,
  type Coordinate,
} from "./race.js";
export type Course = { route: Coordinate[]; elevationsM: number[] | null };
export const TRACK_LIMIT = 500;
const round = (n: number, places: number) => Number(n.toFixed(places));
export function storedCourse(r: Pick<Race, "route" | "elevationsM">): Course {
  return {
    route: r.route.map(([x, y]) => [round(x, 6), round(y, 6)]),
    elevationsM: r.elevationsM?.map((e) => round(e, 1)) ?? null,
  };
}
export function storedFix(f: Fix): Fix {
  return {
    ...f,
    lng: round(f.lng, 6),
    lat: round(f.lat, 6),
    ...(f.km === undefined ? {} : { km: round(f.km, 3) }),
    ...(f.outboundKm === undefined
      ? {}
      : { outboundKm: round(f.outboundKm, 3) }),
  };
}
export function trackKey(f: Fix) {
  return String(f.at).padStart(13, "0");
}
const distancesCache = new WeakMap<Coordinate[], number[]>();
export function hydrateRace(v: any, course?: Course, track?: Fix[]): Race {
  const route = course?.route ?? v.route ?? [];
  let distances = distancesCache.get(route);
  if (!distances) {
    distances = cumulative(route);
    distancesCache.set(route, distances);
  }
  return {
    ...v,
    route,
    elevationsM: course?.elevationsM ?? v.elevationsM ?? null,
    distances,
    stations: stationVisits(v.stations ?? [], distances, v.outAndBack),
    track:
      track ??
      (Array.isArray(v.track) ? v.track : Object.values(v.track ?? {})),
    splits: v.splits ?? [],
    fix: v.fix ?? null,
    previousFix: v.previousFix ?? null,
    finishedAt: v.finishedAt ?? null,
    heartbeatAt: v.heartbeatAt ?? null,
    feedOk: v.feedOk ?? null,
  };
}
export function storedLive(r: Race): any {
  const { route, elevationsM, distances, track, ...live } = r;
  const out: any = {
    ...live,
    stations: r.stations
      .filter((s) => !s.returnOf)
      .map((s) => ({ ...s, km: round(s.km, 3) })),
    progressKm: round(r.progressKm, 3),
    ...(r.startProgressKm !== undefined
      ? { startProgressKm: round(r.startProgressKm, 3) }
      : {}),
  };
  for (const key of [
    "fix",
    "previousFix",
    "pendingFix",
    "startLineFix",
  ] as const)
    if (r[key]) out[key] = storedFix(r[key]!);
  if (r.journey) {
    out.journey = { ...r.journey };
    for (const key of ["peakKm", "positionKm", "turnaroundKm", "rearmKm"])
      if (typeof out.journey[key] === "number")
        out.journey[key] = round(out.journey[key], 3);
    if (r.journey.returnSamples)
      out.journey.returnSamples = r.journey.returnSamples.map((s) => ({
        ...s,
        km: round(s.km, 3),
      }));
  }
  return out;
}
