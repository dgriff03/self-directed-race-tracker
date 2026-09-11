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
  pendingFix?: Fix | null;
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
  const candidates: { km: number; offKm: number }[] = [];
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
    candidates.push({ km, offKm });
    if (offKm < best.offKm - 0.015) best = { km, offKm };
  }
  return {
    ...best,
    ambiguous: candidates.some(
      (c) =>
        c.km < best.km - 0.5 && c.offKm <= Math.min(0.1, best.offKm + 0.075),
    ),
  };
}
export function speed(r: Race) {
  if (!r.fix) return 0;
  const elapsed = (r.fix.at - r.startAt) / 3600000;
  return elapsed > 0 ? Math.min(25, r.progressKm / elapsed) : 0;
}
export function paceEstimate(
  r: Race,
  windowMs = 40 * 60 * 1000,
): { kmh: number; source: "rolling" | "overall" } {
  const overall = speed(r);
  const stabilize = (
    raw: number,
  ): { kmh: number; source: "rolling" | "overall" } =>
    raw > 0
      ? { kmh: Math.min(25, Math.max(raw, overall * 0.5)), source: "rolling" }
      : { kmh: overall, source: "overall" };
  if (!r.fix) return { kmh: 0, source: "overall" };
  const nowFix = r.fix;
  const track = r.track ?? [];
  if (track.length >= 2) {
    const cutoff = nowFix.at - windowMs;
    const recent = track.filter(
      (f) => f.at >= cutoff && f.at <= nowFix.at && f.km !== undefined,
    );
    if (recent.length >= 2) {
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      const deltaHours = (newest.at - oldest.at) / 3600000;
      const deltaKm = (newest.km ?? r.progressKm) - (oldest.km ?? 0);
      if (deltaHours >= 3 / 60 && deltaKm >= 0) {
        return stabilize(deltaKm / deltaHours);
      }
    }
  }
  if (r.previousFix && r.previousFix.km !== undefined) {
    const deltaHours = (nowFix.at - r.previousFix.at) / 3600000;
    const deltaKm = (nowFix.km ?? r.progressKm) - r.previousFix.km;
    if (deltaHours > 0 && deltaHours <= 45 / 60 && deltaKm >= 0) {
      return stabilize(deltaKm / deltaHours);
    }
  }
  return { kmh: overall, source: "overall" };
}
export function rollingSpeed(r: Race, windowMs = 40 * 60 * 1000) {
  return paceEstimate(r, windowMs).kmh;
}
export function stationDwellStatus(
  r: Race,
  now = Date.now(),
): {
  atStation: boolean;
  station?: Station;
  dwellMs: number;
  arrivalAt?: number;
} {
  if (!r.fix || r.status !== "live") {
    return { atStation: false, dwellMs: 0 };
  }
  for (const s of r.stations) {
    if (s.id === "finish") continue;
    const alongRouteDist = Math.abs(r.progressKm - s.km);
    const sCoord = atDistance(r.route, r.distances, s.km);
    const distToCoord = distance([r.fix.lng, r.fix.lat], sCoord);

    if (alongRouteDist <= 0.1 && distToCoord <= 0.1) {
      const split = r.splits.find((sp) => sp.stationId === s.id);
      if (!split) continue;
      const arrivalAt = split.at;
      const dwellMs = Math.max(0, now - arrivalAt);
      const movedPast = r.progressKm - s.km;

      if (movedPast <= 0.1) {
        const prevMove = r.previousFix
          ? distance(
              [r.fix.lng, r.fix.lat],
              [r.previousFix.lng, r.previousFix.lat],
            )
          : 0;
        if (
          prevMove <= 0.05 ||
          (r.fix.at - arrivalAt < 20 * 60000 && movedPast <= 0.05)
        ) {
          return { atStation: true, station: s, dwellMs, arrivalAt };
        }
      }
    }
  }
  return { atStation: false, dwellMs: 0 };
}
export function calculateEta(
  r: Race,
  targetStationKm: number,
  targetStationId: string,
  now = Date.now(),
  context?: {
    dwell: ReturnType<typeof stationDwellStatus>;
    pace: ReturnType<typeof paceEstimate>;
  },
): number | null {
  if (r.status === "complete" || !r.fix) return null;
  if (targetStationKm <= r.progressKm) return null;

  const dwell = context?.dwell ?? stationDwellStatus(r, now);
  const pace = context?.pace ?? paceEstimate(r);
  const useOverall = dwell.atStation || pace.source === "overall";
  const effectivePace = useOverall ? speed(r) : pace.kmh;
  if (!(effectivePace > 0)) return null;

  const distKm = targetStationKm - r.progressKm;
  const travelTimeMs = (distKm / effectivePace) * 3600000;

  const intermediateStations = r.stations.filter((s) => {
    if (s.id === "finish" || s.id === targetStationId) return false;
    if (dwell.atStation && dwell.station && s.id === dwell.station.id)
      return false;
    return (
      s.km > r.progressKm &&
      s.km < targetStationKm &&
      !r.splits.some((sp) => sp.stationId === s.id)
    );
  });

  const intermediateDwellMs = useOverall
    ? 0
    : intermediateStations.length * 10 * 60 * 1000;

  if (dwell.atStation) {
    const remainingDwellHere = useOverall
      ? 0
      : Math.max(0, 10 * 60 * 1000 - dwell.dwellMs);
    return Math.round(
      now + remainingDwellHere + travelTimeMs + intermediateDwellMs,
    );
  } else {
    return Math.round(r.fix.at + travelTimeMs + intermediateDwellMs);
  }
}

export function applyFixes(r: Race, fixes: Fix[]): Race {
  let out = structuredClone(r);
  if (out.status === "complete") return out;
  for (const fix of [...fixes].sort((a, b) => a.at - b.at)) {
    if (
      fix.at < out.startAt ||
      fix.at > Date.now() + 120000 ||
      fix.at <= Math.max(out.fix?.at ?? 0, out.pendingFix?.at ?? 0)
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
    const pending = out.pendingFix;
    const recentHours =
      out.fix && out.previousFix
        ? (out.fix.at - out.previousFix.at) / 3600000
        : 0;
    const recentSpeed =
      recentHours > 0
        ? ((out.fix?.km ?? out.progressKm) - (out.previousFix?.km ?? 0)) /
          recentHours
        : 0;
    const consistentWithAccepted =
      recentSpeed > 0 &&
      hours > 0 &&
      hours <= 0.5 &&
      recentHours <= 0.5 &&
      km - out.progressKm <= Math.max(0.15, recentSpeed * hours * 1.5);
    const suspicious =
      (match.ambiguous && !consistentWithAccepted) ||
      (out.fix &&
        km - out.progressKm > 1 &&
        (km - out.progressKm) / Math.max(hours, 1 / 3600) >
          Math.max(12, speed(out) * 2.5));
    const corroborated =
      pending &&
      fix.at > pending.at &&
      km >= (pending.km ?? 0) - 0.1 &&
      km <=
        (pending.km ?? 0) +
          Math.max(0.3, ((fix.at - pending.at) / 3600000) * 25);
    if (suspicious && !corroborated) {
      out.pendingFix = { ...fix, km };
      continue;
    }
    out.pendingFix = null;
    const previous = out.fix;
    const confirmedPending =
      corroborated &&
      pending &&
      (pending.km ?? 0) >= out.progressKm &&
      (pending.km ?? 0) <= km
        ? pending
        : null;
    for (const station of out.stations) {
      if (
        station.km <= km &&
        !out.splits.some((s) => s.stationId === station.id)
      ) {
        const afterPending =
          confirmedPending && station.km > (confirmedPending.km ?? 0);
        const oldKm = afterPending ? confirmedPending.km! : out.progressKm;
        const oldAt = afterPending
          ? confirmedPending.at
          : (previous?.at ?? out.startAt);
        const endKm =
          confirmedPending && !afterPending ? confirmedPending.km! : km;
        const endAt =
          confirmedPending && !afterPending ? confirmedPending.at : fix.at;
        const fraction = Math.max(
          0,
          Math.min(1, (station.km - oldKm) / (endKm - oldKm || 1)),
        );
        out.splits.push({
          stationId: station.id,
          at: Math.round(oldAt + (endAt - oldAt) * fraction),
          estimated: true,
        });
      }
    }
    out.previousFix = confirmedPending ?? previous;
    out.fix = { ...fix, km };
    out.progressKm = km;
    out.track = [
      ...out.track,
      ...(confirmedPending ? [confirmedPending] : []),
      { ...fix, km },
    ].slice(-2000);
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
