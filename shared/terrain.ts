import { aidDwellMs } from "./aid-dwell.js";
import type { Race } from "./race.js";
// Running cost polynomial from Minetti et al. (2002), doi:10.1152/japplphysiol.01177.2001.
// Conservative downhill floor: elevation cannot describe footing or trail difficulty.
export function gradeCost(grade: number) {
  const g = Math.max(-0.4, Math.min(0.4, grade));
  return Math.max(
    0.75,
    Math.min(
      6,
      (155.4 * g ** 5 -
        30.4 * g ** 4 -
        43.3 * g ** 3 +
        46.3 * g ** 2 +
        19.5 * g +
        3.6) /
        3.6,
    ),
  );
}
const cache = new WeakMap<number[], { ds: number[]; effort: number[] }>();
export function terrainDistance(r: Race, from: number, to: number): number {
  const ds = r.distances,
    elevations = r.elevationsM;
  if (!elevations || elevations.length !== ds.length)
    return Math.max(0, to - from);
  let profile = cache.get(elevations);
  if (!profile || profile.ds !== ds) {
    const effort = [0];
    for (let i = 1; i < ds.length; i++) {
      const span = ds[i] - ds[i - 1];
      // Estimate grade across at least 50m to soften tiny GPX elevation spikes.
      let a = i - 1,
        b = i;
      while (a > 0 && ds[b] - ds[a] < 0.05) a--;
      while (b < ds.length - 1 && ds[b] - ds[a] < 0.05) b++;
      const grade =
        (elevations[b] - elevations[a]) / Math.max(1, (ds[b] - ds[a]) * 1000);
      effort.push(effort[i - 1] + Math.max(0, span) * gradeCost(grade));
    }
    profile = { ds, effort };
    cache.set(elevations, profile);
  }
  const at = (km: number) => {
    let lo = 0,
      hi = ds.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ds[mid] < km) lo = mid + 1;
      else hi = mid;
    }
    if (!lo) return 0;
    const f = Math.max(
      0,
      Math.min(1, (km - ds[lo - 1]) / (ds[lo] - ds[lo - 1] || 1)),
    );
    return (
      profile!.effort[lo - 1] +
      f * (profile!.effort[lo] - profile!.effort[lo - 1])
    );
  };
  return Math.max(0, at(to) - at(from));
}
export function terrainCalibration(
  r: Race,
  targetKm: number,
): { travelMs: number; source: "rolling" | "overall"; kmh: number } | null {
  if (!r.fix || !r.elevationsM) return null;
  const total = r.distances.at(-1)!;
  const recent = r.track.filter(
    (f) =>
      f.at >= r.fix!.at - 40 * 60000 &&
      f.km !== undefined &&
      (r.journey?.phase !== "returning" || f.km >= total / 2),
  );
  const turn = r.journey?.turnaroundKm;
  const courseEffort =
    r.journey?.phase === "returning" && turn !== undefined
      ? terrainDistance(r, 0, turn) +
        terrainDistance(r, total - turn, r.progressKm)
      : terrainDistance(r, 0, r.progressKm);
  const overallEffort = Math.max(
    0,
    courseEffort - terrainDistance(r, 0, r.startProgressKm ?? 0),
  );
  const overallDuration = r.fix.at - (r.actualStartAt ?? r.startAt);
  const overallSpeed =
    overallDuration > 0 ? overallEffort / overallDuration : 0;
  let source: "rolling" | "overall" = "rolling";
  let effort = 0,
    duration = 0;
  if (recent.length >= 2) {
    const first = recent[0],
      last = recent.at(-1)!;
    effort = terrainDistance(r, first.km!, last.km!);
    duration = last.at - first.at - aidDwellMs(r, first.at, last.at);
  }
  if (effort < 0.02 || duration < 180000) {
    effort = overallEffort;
    duration = overallDuration;
    source = "overall";
  }
  if (effort <= 0 || duration <= 0) return null;
  const effectiveSpeed =
    source === "rolling"
      ? Math.max(effort / duration, overallSpeed * 0.5)
      : effort / duration;
  return {
    travelMs: terrainDistance(r, r.progressKm, targetKm) / effectiveSpeed,
    source,
    kmh: effectiveSpeed * 3600000,
  };
}

export function terrainTravelMs(r: Race, targetKm: number): number | null {
  return terrainCalibration(r, targetKm)?.travelMs ?? null;
}
