import { atDistance, distance, type Race } from "./race.js";

/** Only subtract intervals corroborated by two stationary fixes at the same aid.
 * Unknown arrival/departure portions of a sparse GPS interval stay in travel time. */
export function aidDwellMs(r: Race, from: number, to: number): number {
  if (to <= from) return 0;
  const samples = [
    ...r.track,
    ...(r.previousFix ? [r.previousFix] : []),
    ...(r.fix ? [r.fix] : []),
  ]
    .filter((f) => f.at >= from && f.at <= to && f.km !== undefined)
    .sort((a, b) => a.at - b.at);
  const aids = r.stations
    .filter((s) => s.id !== "finish")
    .map((s) => ({ ...s, point: atDistance(r.route, r.distances, s.km) }));
  let stopped = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1],
      b = samples[i];
    if (
      b.at <= a.at ||
      b.at - a.at > 20 * 60000 ||
      distance([a.lng, a.lat], [b.lng, b.lat]) > 0.05
    )
      continue;
    if (
      aids.some(
        (s) =>
          Math.abs(a.km! - s.km) <= 0.1 &&
          Math.abs(b.km! - s.km) <= 0.1 &&
          distance([a.lng, a.lat], s.point) <= 0.1 &&
          distance([b.lng, b.lat], s.point) <= 0.1,
      )
    ) {
      stopped += b.at - a.at;
    }
  }
  return Math.min(to - from, stopped);
}
