import {
  calculateEta,
  completedDistance,
  distance,
  plannedDistance,
  type Race,
} from "./race.js";
export function inferFinish(r: Race, now: number): Race {
  if (
    r.status !== "live" ||
    !r.fix ||
    !r.previousFix ||
    r.feedOk !== true ||
    r.trackingPaused
  )
    return r;
  if (r.outAndBack && r.journey?.phase !== "returning") return r;
  const total = r.distances.at(-1)!,
    remaining = total - r.progressKm;
  if (
    remaining <= 0 ||
    remaining > 1 ||
    completedDistance(r) / plannedDistance(r) < 0.9 ||
    distance([r.fix.lng, r.fix.lat], r.route.at(-1)!) > 1
  )
    return r;
  if (
    (r.previousFix.km ?? 0) >= r.progressKm ||
    (r.lastFeedPointAt ?? r.fix.at) > r.fix.at
  )
    return r;
  const eta = calculateEta(r, total, "finish", r.fix.at);
  const grace = Math.max(20 * 60000, 2 * (r.feedCadenceMs ?? 10 * 60000));
  if (
    !eta ||
    eta <= r.fix.at ||
    now < eta + grace ||
    (r.lastPollAt ?? 0) < eta + grace ||
    now - (r.lastPollAt ?? 0) > 120000
  )
    return r;
  return {
    ...r,
    status: "complete",
    finishedAt: eta,
    finishSource: "estimated",
    finishInferredAt: now,
    progressKm: total,
    ...(r.journey ? {journey: {...r.journey, positionKm: 0}} : {}),
    splits: [
      ...r.splits.filter((s) => s.stationId !== "finish"),
      { stationId: "finish", at: eta, estimated: true },
    ],
  };
}
