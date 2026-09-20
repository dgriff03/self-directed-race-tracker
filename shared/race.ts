import { aidDwellMs } from "./aid-dwell.js";
import { smoothedAscent } from "./ascent.js";
import { terrainCalibration } from "./terrain.js";
export type Coordinate = [number, number];
export type Station = {
  id: string;
  name: string;
  km: number;
  returnOf?: string;
};
export type Fix = {
  lng: number;
  lat: number;
  at: number;
  km?: number;
  outboundKm?: number;
};
export type Split = { stationId: string; at: number; estimated: boolean };
export type Race = {
  id: string;
  slug?: string;
  courseVersion?: string;
  name: string;
  startAt: number;
  actualStartAt?: number;
  startProgressKm?: number;
  crewDeparture?: { stationId: string; at: number; fixAt: number } | null;
  startLineFix?: Fix;
  route: Coordinate[];
  distances: number[];
  elevationsM?: number[] | null;
  stations: Station[];
  status: "scheduled" | "live" | "complete";
  progressKm: number;
  fix: Fix | null;
  latestLocation?: Fix | null;
  offRoute?: boolean;
  previousFix: Fix | null;
  pendingFix?: Fix | null;
  splits: Split[];
  heartbeatAt: number | null;
  feedOk: boolean | null;
  lastLocationReceivedAt?: number | null;
  lastFeedPointAt?: number | null;
  nextUpdateExpectedAt?: number | null;
  nextPollAt?: number;
  lastPollAt?: number;
  feedCadenceMs?: number;
  feedPointTimes?: number[];
  feedDeliveryGaps?: number[];
  feedError?: string | null;
  finishedAt: number | null;
  finishSource?: "estimated" | "reported";
  finishInferredAt?: number;
  revision: number;
  track: Fix[];
  trackingPaused?: boolean;
  outAndBack?: boolean;
  journey?: {
    phase: "outbound" | "returning";
    peakKm: number;
    peakAt: number;
    positionKm: number;
    reverseCount: number;
    reverseAt: number;
    turnaroundKm?: number;
    turnedAt?: number;
    inferredTurnaround?: boolean;
    returnSamples?: { km: number; at: number }[];
    rearmKm?: number;
  } | null;
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
  const elapsed = (r.fix.at - raceStart(r)) / 3600000;
  return elapsed > 0
    ? Math.min(
        25,
        Math.max(0, completedDistance(r) - (r.startProgressKm ?? 0)) / elapsed,
      )
    : 0;
}
export function paceEstimate(
  r: Race,
  windowMs = 40 * 60 * 1000,
): { kmh: number; source: "rolling" | "overall" } {
  const overall = speed(r);
  if (r.journey?.phase === "returning") {
    const samples = r.journey.returnSamples ?? [];
    if (samples.length >= 3) {
      const last = samples[samples.length - 1];
      const first =
        samples.find((p) => p.at >= last.at - windowMs) ?? samples[0];
      const hours =
        (last.at - first.at - aidDwellMs(r, first.at, last.at)) / 3600000;
      const km = first.km - last.km;
      if (hours >= 0.05 && km > 0.02)
        return { kmh: Math.min(25, km / hours), source: "rolling" };
    }
    return { kmh: overall, source: "overall" };
  }
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
      const deltaHours =
        (newest.at - oldest.at - aidDwellMs(r, oldest.at, newest.at)) / 3600000;
      const deltaKm = (newest.km ?? r.progressKm) - (oldest.km ?? 0);
      if (deltaHours >= 3 / 60 && deltaKm >= 0) {
        return stabilize(deltaKm / deltaHours);
      }
    }
  }
  if (r.previousFix && r.previousFix.km !== undefined) {
    const deltaHours =
      (nowFix.at -
        r.previousFix.at -
        aidDwellMs(r, r.previousFix.at, nowFix.at)) /
      3600000;
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
  if (r.offRoute || !r.fix || r.status !== "live") {
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
// A shared report is provisional until a newer accepted GPS fix arrives.
export function activeCrewDeparture(r: Race) {
  return !r.offRoute &&
    r.status === "live" &&
    r.fix &&
    r.crewDeparture?.fixAt === r.fix.at
    ? r.crewDeparture
    : null;
}
export function reportCrewDeparture(
  r: Race,
  stationId: string,
  fixAt: number,
  now: number,
): Race | null {
  const dwell = stationDwellStatus(r, now);
  if (
    r.trackingPaused ||
    activeCrewDeparture(r) ||
    r.fix?.at !== fixAt ||
    !dwell.atStation ||
    dwell.station?.id !== stationId ||
    dwell.arrivalAt === undefined ||
    now < dwell.arrivalAt ||
    now - dwell.arrivalAt >= 600000
  )
    return null;
  return {
    ...r,
    crewDeparture: { stationId, at: now, fixAt },
    revision: r.revision + 1,
  };
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
  if (
    r.offRoute ||
    r.status === "complete" ||
    !r.fix ||
    stationSkipped(r, targetStationId)
  )
    return null;
  if (targetStationKm <= r.progressKm) return null;

  const dwell = context?.dwell ?? stationDwellStatus(r, now);
  const pace = context?.pace ?? paceEstimate(r);
  const terrain = terrainCalibration(r, targetStationKm);
  const useOverall = (terrain?.source ?? pace.source) === "overall";
  const effectivePace =
    r.journey?.phase === "returning"
      ? pace.kmh
      : useOverall
        ? speed(r)
        : pace.kmh;
  if (!terrain && !(effectivePace > 0)) return null;

  const distKm = targetStationKm - r.progressKm;
  const travelTimeMs = terrain?.travelMs ?? (distKm / effectivePace) * 3600000;

  const intermediateStations = r.stations.filter((s) => {
    if (
      s.id === "finish" ||
      s.id === targetStationId ||
      stationSkipped(r, s.id)
    )
      return false;
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

  const departure = activeCrewDeparture(r);
  if (departure && dwell.station?.id === departure.stationId) {
    return Math.round(departure.at + travelTimeMs + intermediateDwellMs);
  }
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

export const EARLY_START_MS = 3600000;
export const raceStart = (r: Race) => r.actualStartAt ?? r.startAt;

// Early tracker warm-up is not a departure. Keep the last position at the
// trailhead as the timing anchor, but only start after an accepted departure.
function waitingAtStart(r: Race, fix: Fix): boolean {
  if (r.fix) return false;
  if (r.startLineFix && fix.at <= r.startLineFix.at) return true;
  if (distance(r.route[0], [fix.lng, fix.lat]) <= 0.05) {
    r.startLineFix = fix;
    return true;
  }
  return false;
}
function recordDeparture(r: Race, fix: Fix, km: number) {
  if (!r.fix) {
    r.actualStartAt = r.startLineFix?.at ?? fix.at;
    r.startProgressKm = r.startLineFix ? 0 : km;
  }
}

export function applyFixes(r: Race, fixes: Fix[], now = Date.now()): Race {
  let out = structuredClone(r);
  out.stations = stationVisits(out.stations, out.distances, out.outAndBack);
  if (out.status === "complete") return out;
  for (const fix of [...fixes].sort((a, b) => a.at - b.at)) {
    if (
      Number.isFinite(fix.lng) &&
      Number.isFinite(fix.lat) &&
      Math.abs(fix.lng) <= 180 &&
      Math.abs(fix.lat) <= 90 &&
      fix.at >= out.startAt - EARLY_START_MS &&
      fix.at <= now + 120000 &&
      fix.at > (out.latestLocation?.at ?? out.fix?.at ?? 0)
    ) {
      out.latestLocation = { lng: fix.lng, lat: fix.lat, at: fix.at };
    }
    if (out.outAndBack) {
      applyOutAndBackFix(out, fix, now);
      if ((out as Race).status === "complete") break;
      continue;
    }
    if (
      fix.at < out.startAt - EARLY_START_MS ||
      fix.at > now + 120000 ||
      fix.at <= Math.max(out.fix?.at ?? 0, out.pendingFix?.at ?? 0)
    )
      continue;
    const hours =
      (fix.at -
        (out.fix?.at ??
          out.startLineFix?.at ??
          Math.min(fix.at, raceStart(out)))) /
      3600000;
    const match = project(
      out.route,
      out.distances,
      [fix.lng, fix.lat],
      Math.max(0, out.progressKm - 0.1),
      out.progressKm + Math.max(0.3, hours * 25),
    );
    if (match.offKm > 0.25) continue;
    if (waitingAtStart(out, fix)) continue;
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
    recordDeparture(out, confirmedPending ?? fix, confirmedPending?.km ?? km);
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
          : (previous?.at ?? raceStart(out));
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
    ].slice(-500);
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
  const latest = out.latestLocation;
  if (latest) {
    const match = project(
      out.route,
      out.distances,
      [latest.lng, latest.lat],
      out.outAndBack ? 0 : Math.max(0, out.progressKm - 0.1),
    );
    out.offRoute = latest.at > (out.fix?.at ?? 0) && match.offKm > 0.25;
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
  return smoothedAscent(distances, elevationsM, progressKm);
}

// Explicit mode for a full, retraced out-and-back GPX (turn at half distance).
export function validOutAndBack(route: Coordinate[], ds = cumulative(route)) {
  const total = ds.at(-1) ?? 0;
  if (total < 0.6 || distance(route[0], route.at(-1)!) > 0.2) return false;
  for (let i = 0; i <= 100; i++) {
    const km = (total * i) / 200;
    if (
      distance(atDistance(route, ds, km), atDistance(route, ds, total - km)) >
      0.2
    )
      return false;
  }
  return true;
}
export function stationSkipped(r: Race, id: string) {
  const j = r.journey,
    s = r.stations.find((s) => s.id === id);
  if (
    !s ||
    j?.phase !== "returning" ||
    r.splits.some((p) => p.stationId === id)
  )
    return false;
  const turn = j.turnaroundKm!;
  return s.km > turn + 0.001 && s.km < r.distances.at(-1)! - turn - 0.001;
}
export function completedDistance(r: Race) {
  const j = r.journey;
  return j?.phase === "returning"
    ? Math.max(0, 2 * j.turnaroundKm! - j.positionKm)
    : r.progressKm;
}
export function plannedDistance(r: Race) {
  return r.journey?.phase === "returning"
    ? 2 * r.journey.turnaroundKm!
    : (r.distances.at(-1) ?? 0);
}
export function journeyMessage(r: Race) {
  const j = r.journey;
  if (!r.outAndBack) return "";
  if (j?.phase !== "returning")
    return "Out-and-back · outbound. Early return detection requires three return updates over at least 10 minutes and at least 0.31 mi of retreat, with no new outbound peak in that window.";
  const early = j.turnaroundKm! < r.distances.at(-1)! / 2 - 0.075;
  return `${r.status === "complete" ? "Returned to start" : early ? "Returning early" : "Returning"} · Turnaround at ${kmToMiles(j.turnaroundKm!).toFixed(2)} mi. ${r.status === "complete" ? "" : paceEstimate(r).source === "overall" ? "Finish ETA is provisional until return pace is established." : "Finish ETA uses observed return pace."} Distance shows current route progress and can decrease if you backtrack; the ETA follows your current position.`;
}
export function journeyElevation(r: Race) {
  const original = elevationProgress(r.distances, r.elevationsM, r.progressKm);
  if (!original || r.journey?.phase !== "returning") return original;
  const peak = r.journey.turnaroundKm!,
    total = r.distances.at(-1)!;
  const outbound = elevationProgress(r.distances, r.elevationsM, peak)!;
  const returnStart = elevationProgress(
    r.distances,
    r.elevationsM,
    total - peak,
  )!;
  return {
    completedM:
      outbound.completedM + original.completedM - returnStart.completedM,
    totalM: outbound.completedM + original.totalM - returnStart.completedM,
  };
}
export function setJourneyDirection(
  r: Race,
  direction: "returning" | "outbound",
): Race {
  if (!r.outAndBack || !r.fix || !r.journey || r.status === "complete")
    throw Error("An active out-and-back race with GPS is required.");
  const out = structuredClone(r),
    j = out.journey!;
  if (direction === "returning") {
    if (j.phase === "returning") return out;
    j.phase = "returning";
    j.turnaroundKm = j.peakKm;
    j.turnedAt = out.fix!.at;
    j.returnSamples = [{ km: j.peakKm, at: j.peakAt }];
    out.progressKm = out.distances.at(-1)! - j.positionKm;
  } else {
    if (j.phase === "outbound") return out;
    j.phase = "outbound";
    // Keep real outbound crossings; remove inferred return crossings on correction.
    out.splits = out.splits.filter(
      (s) =>
        s.at <= j.peakAt &&
        out.stations.find((t) => t.id === s.stationId)!.km <= j.peakKm,
    );
    out.progressKm = j.peakKm;
    j.rearmKm = j.positionKm + 0.15;
    delete j.turnaroundKm;
    delete j.turnedAt;
    delete j.returnSamples;
  }
  j.reverseCount = 0;
  j.reverseAt = 0;
  out.fix = { ...out.fix!, km: out.progressKm };
  if (out.previousFix) {
    const total = out.distances.at(-1)!;
    const outboundKm =
      out.previousFix.outboundKm ??
      (r.journey!.phase === "returning"
        ? total - (out.previousFix.km ?? total)
        : (out.previousFix.km ?? 0));
    out.previousFix = {
      ...out.previousFix,
      outboundKm,
      km: direction === "returning" ? total - outboundKm : outboundKm,
    };
  }
  out.pendingFix = null;
  return out;
}
function applyOutAndBackFix(
  r: Race,
  fix: Fix,
  now: number,
  confirmedKm?: number,
) {
  if (
    fix.at < r.startAt - EARLY_START_MS ||
    fix.at > now + 120000 ||
    fix.at <= (r.fix?.at ?? 0)
  )
    return;
  const total = r.distances.at(-1)!,
    half = total / 2;
  const previous = r.fix,
    oldProgress = r.progressKm;
  const j = r.journey ?? {
    phase: "outbound" as const,
    peakKm: 0,
    peakAt: r.startAt,
    positionKm: 0,
    reverseCount: 0,
    reverseAt: 0,
  };
  const hours =
    (fix.at -
      (previous?.at ?? r.startLineFix?.at ?? Math.min(fix.at, raceStart(r)))) /
    3600000;
  const reach = Math.max(0.15, hours * 25);
  const match = project(
    r.route,
    r.distances,
    [fix.lng, fix.lat],
    Math.max(0, j.positionKm - reach),
    Math.min(half, j.positionKm + reach),
  );
  if (match.offKm > 0.25) return;
  if (waitingAtStart(r, fix)) return;
  const pending = r.pendingFix;
  const km = confirmedKm ?? match.km;
  const previousKm = previous?.outboundKm ?? j.positionKm;
  const previousPreviousKm = r.previousFix?.outboundKm;
  const recentHours =
    previous && r.previousFix ? (previous.at - r.previousFix.at) / 3600000 : 0;
  const recentDelta =
    previousPreviousKm === undefined ? 0 : previousKm - previousPreviousKm;
  const delta = km - j.positionKm;
  const consistent =
    recentHours > 0 &&
    recentHours <= 0.5 &&
    hours > 0 &&
    hours <= 0.5 &&
    delta * recentDelta >= 0 &&
    Math.abs(recentDelta) > 0.02 &&
    Math.abs(delta) <=
      Math.max(0.15, (Math.abs(recentDelta) / recentHours) * hours * 1.5);
  const suspicious =
    (match.ambiguous && !consistent) ||
    (previous &&
      Math.abs(delta) > 1 &&
      Math.abs(delta) / Math.max(hours, 1 / 3600) >
        Math.max(12, speed(r) * 2.5));
  const corroborated =
    pending?.outboundKm !== undefined &&
    fix.at > pending.at &&
    Math.abs(km - pending.outboundKm) <=
      Math.max(0.3, ((fix.at - pending.at) / 3600000) * 25) &&
    (pending.outboundKm - j.positionKm) * (km - j.positionKm) >= 0 &&
    (km - pending.outboundKm) * Math.sign(pending.outboundKm - j.positionKm) >=
      -0.1;
  if (confirmedKm === undefined && suspicious && !corroborated) {
    if (!pending || fix.at > pending.at)
      r.pendingFix = { ...fix, outboundKm: km };
    return;
  }
  if (confirmedKm === undefined && corroborated && pending) {
    // Reapply the confirmed earlier sample with its original timestamp. It must
    // contribute to splits and reversal evidence exactly once.
    r.pendingFix = null;
    applyOutAndBackFix(r, pending, now, pending.outboundKm);
    if (r.status !== "complete") applyOutAndBackFix(r, fix, now, km);
    return;
  }
  recordDeparture(r, fix, km);
  const wasReturning = j.phase === "returning";
  if (j.phase === "outbound") {
    if (km > j.peakKm) {
      j.peakKm = km;
      j.peakAt = fix.at;
      j.reverseCount = 0;
      j.reverseAt = 0;
    }
    if (j.rearmKm !== undefined && km >= j.rearmKm) delete j.rearmKm;
    if (km < j.positionKm - 0.02 && j.peakKm - km >= 0.05) {
      j.reverseCount++;
      if (!j.reverseAt) j.reverseAt = fix.at;
    } else if (km > j.positionKm + 0.03 || j.peakKm - km < 0.05) {
      j.reverseCount = 0;
      j.reverseAt = 0;
    }
    const missingToTurn = half - j.peakKm;
    const plausibleViaTurn =
      previous &&
      hours > 0 &&
      half - previousKm + half - km <=
        Math.max(1, paceEstimate(r).kmh) * hours * 1.5;
    const normalReturn =
      km < j.peakKm - 0.05 &&
      (missingToTurn <= 0.075 ||
        (missingToTurn <= Math.min(0.5, half * 0.1) && plausibleViaTurn));
    const earlyReturn =
      j.rearmKm === undefined &&
      j.peakKm >= 0.5 &&
      j.peakKm - km >= 0.5 &&
      j.reverseCount >= 3 &&
      fix.at - j.reverseAt >= 600000 &&
      fix.at - j.peakAt >= 600000;
    if (normalReturn || earlyReturn) {
      j.phase = "returning";
      if (normalReturn) {
        const path = Math.max(0.001, half - previousKm + half - km);
        const turnAt = Math.round(
          (previous?.at ?? j.peakAt) +
            ((fix.at - (previous?.at ?? j.peakAt)) *
              Math.max(0, half - previousKm)) /
              path,
        );
        j.turnaroundKm = half;
        j.inferredTurnaround = true;
        j.peakKm = half;
        j.peakAt = turnAt;
        // A station placed near the tip represents that single turnaround visit.
        for (const station of r.stations) {
          if (
            Math.abs(station.km - half) <= 0.15 &&
            station.id !== "finish" &&
            !r.splits.some((s) => s.stationId === station.id)
          )
            r.splits.push({
              stationId: station.id,
              at: turnAt,
              estimated: true,
            });
        }
      } else j.turnaroundKm = j.peakKm;
      j.turnedAt = fix.at;
      j.returnSamples = [{ km: j.turnaroundKm, at: j.peakAt }];
    }
  }
  // Use current position on the return so a brief uphill backtrack updates the ETA.
  j.positionKm = km;
  r.journey = j;
  const progress = j.phase === "returning" ? total - km : j.peakKm;
  if (j.phase === "returning") {
    j.returnSamples = [...(j.returnSamples ?? []), { km, at: fix.at }].slice(
      -100,
    );
  }
  const fromKm =
    !wasReturning && j.phase === "returning" ? total - j.peakKm : oldProgress;
  const fromAt =
    !wasReturning && j.phase === "returning"
      ? j.peakAt
      : (previous?.at ?? Math.min(fix.at, raceStart(r)));
  for (const station of r.stations) {
    if (
      station.id === "finish" ||
      stationSkipped(r, station.id) ||
      station.km > progress ||
      station.km < fromKm ||
      r.splits.some((s) => s.stationId === station.id)
    )
      continue;
    const fraction = Math.max(
      0,
      Math.min(1, (station.km - fromKm) / (progress - fromKm || 1)),
    );
    r.splits.push({
      stationId: station.id,
      at: Math.round(fromAt + (fix.at - fromAt) * fraction),
      estimated: true,
    });
  }
  r.previousFix = previous;
  r.fix = { ...fix, km: progress, outboundKm: km };
  r.progressKm = progress;
  r.pendingFix = null;
  r.track = [...r.track, { ...fix, km: progress, outboundKm: km }].slice(-500);
  r.status = "live";
  if (
    j.phase === "returning" &&
    km < 0.05 &&
    distance([fix.lng, fix.lat], r.route[0]) < 0.075
  ) {
    r.status = "complete";
    r.finishedAt = fix.at;
    r.progressKm = total;
    j.positionKm = 0;
    if (!r.splits.some((s) => s.stationId === "finish"))
      r.splits.push({ stationId: "finish", at: fix.at, estimated: true });
  }
}

export function stationDistance(r: Race, km: number) {
  const j = r.journey,
    total = r.distances.at(-1)!;
  return j?.phase === "returning" && km >= total - j.turnaroundKm!
    ? km - (total - 2 * j.turnaroundKm!)
    : km;
}

// Derived visits keep existing station IDs/splits stable and work for races
// created before return visits were introduced. Summit vicinity is one visit.
export function stationVisits(
  stations: Station[],
  distances: number[],
  outAndBack?: boolean,
): Station[] {
  const original = stations.filter((s) => !s.returnOf);
  const total = distances.at(-1) ?? 0;
  if (!outAndBack || !total) return original;
  const visits = [...original];
  for (const station of original) {
    if (station.id === "finish" || station.km >= total / 2 - 0.15) continue;
    const returnKm = total - station.km;
    // Respect an organizer's explicitly configured return visit at this point.
    if (
      original.some(
        (s) =>
          s.id !== "finish" &&
          s.km > total / 2 &&
          Math.abs(s.km - returnKm) <= 0.1,
      )
    )
      continue;
    visits.push({
      id: `return-${station.id}`,
      name: `${station.name} · return`,
      km: returnKm,
      returnOf: station.id,
    });
  }
  return visits.sort((a, b) => a.km - b.km || a.id.localeCompare(b.id));
}
