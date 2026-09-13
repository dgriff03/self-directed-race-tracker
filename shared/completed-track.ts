import { atDistance, distance, type Coordinate, type Race } from './race.js';

// Route-following interpolation, not evidence of the exact path between messages.
// Keep GPS coordinates whenever a fix is over 100m from its accepted route position
// or has no accepted position. Never project afresh onto an ambiguous loop crossing.
export function completedTrack(r: Race): Coordinate[] {
  const total = r.distances.at(-1) ?? 0;
  const points = r.track.map(f => {
    const km = r.outAndBack ? f.outboundKm ?? (f.km === undefined ? undefined : Math.min(f.km, total - f.km)) : f.km;
    const raw: Coordinate = [f.lng, f.lat];
    const snapped = km === undefined ? raw : atDistance(r.route, r.distances, km);
    const onRoute = km !== undefined && distance(raw, snapped) <= 0.1;
    return { f, km, onRoute, point: onRoute ? snapped : raw };
  });
  const result: Coordinate[] = [];
  function section(from: number, to: number) {
    const interior = r.route.filter((_, i) => r.distances[i] > Math.min(from, to) && r.distances[i] < Math.max(from, to));
    result.push(...(from > to ? interior.reverse() : interior));
    result.push(atDistance(r.route, r.distances, to));
  }
  for (let i = 0; i < points.length; i++) {
    const p = points[i], previous = points[i - 1];
    if (previous?.onRoute && p.onRoute) {
      const turn = r.journey?.turnedAt, peak = r.journey?.turnaroundKm;
      if (r.outAndBack && turn !== undefined && peak !== undefined && previous.f.at < turn && p.f.at >= turn) {
        section(previous.km!, peak);
        section(peak, p.km!);
      } else section(previous.km!, p.km!);
    } else result.push(p.point);
  }
  return result;
}
