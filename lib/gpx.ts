import {
  cumulative,
  project,
  type Station,
  type Coordinate,
} from "../shared/race";
export function parseGpxWithElevation(text: string): {
  route: Coordinate[];
  elevationsM: number[] | null;
  stations?: Station[];
} {
  if (text.length > 10_000_000 || /<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error("Use a GPX file smaller than 10 MB.");
  const xml = new DOMParser().parseFromString(text, "application/xml");
  if (
    xml.querySelector("parsererror") ||
    xml.documentElement.localName !== "gpx"
  )
    throw Error("This file is not valid GPX.");
  let points = Array.from(xml.getElementsByTagNameNS("*", "trkpt"));
  if (!points.length)
    points = Array.from(xml.getElementsByTagNameNS("*", "rtept"));
  if (points.some((p) => !p.hasAttribute("lon") || !p.hasAttribute("lat")))
    throw Error("Route points must have a latitude and longitude.");
  const route = points.map(
    (p) =>
      [
        Number(p.getAttribute("lon")),
        Number(p.getAttribute("lat")),
      ] as Coordinate,
  );
  if (
    route.length < 2 ||
    route.some(
      (p) =>
        !Number.isFinite(p[0]) ||
        !Number.isFinite(p[1]) ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90,
    )
  )
    throw Error("The GPX needs at least two valid route points.");
  const elevations = points.map((p) => {
    const text = p.getElementsByTagNameNS("*", "ele")[0]?.textContent?.trim();
    const value = text ? Number(text) : NaN;
    return Number.isFinite(value) && value >= -12000 && value <= 10000
      ? value
      : NaN;
  });
  const ds = cumulative(route);
  const valid = elevations
    .map((e, i) => (Number.isFinite(e) ? i : -1))
    .filter((i) => i >= 0);
  if (valid.length >= 2) {
    for (let i = 0; i < valid[0]; i++) elevations[i] = elevations[valid[0]];
    for (let k = 1; k < valid.length; k++) {
      const a = valid[k - 1],
        b = valid[k];
      for (let i = a + 1; i < b; i++) {
        const f =
          ds[b] > ds[a] ? (ds[i] - ds[a]) / (ds[b] - ds[a]) : (i - a) / (b - a);
        elevations[i] = elevations[a] + f * (elevations[b] - elevations[a]);
      }
    }
    for (let i = valid.at(-1)! + 1; i < elevations.length; i++)
      elevations[i] = elevations[valid.at(-1)!];
  }
  const profile = valid.length >= 2 ? elevations : null;
  const indices = simplifyRoute(route, profile);
  const simplified = indices.map((i) => route[i]);
  const distances = cumulative(simplified);
  const stations: Station[] = [];
  for (const waypoint of Array.from(xml.getElementsByTagNameNS("*", "wpt"))) {
    const lat = Number(waypoint.getAttribute("lat")),
      lng = Number(waypoint.getAttribute("lon"));
    if (
      !waypoint.hasAttribute("lat") ||
      !waypoint.hasAttribute("lon") ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    )
      continue;
    const { km } = project(simplified, distances, [lng, lat]);
    // The start and finish already have their own rows. Ties use the first visit;
    // out-and-back mode derives the return visit separately.
    if (km <= 0.01 || km >= distances.at(-1)! - 0.01) continue;
    const name =
      waypoint
        .getElementsByTagNameNS("*", "name")[0]
        ?.textContent?.trim()
        .slice(0, 80) || `Aid station ${stations.length + 1}`;
    if (stations.some((s) => s.name === name && Math.abs(s.km - km) < 0.01))
      continue;
    stations.push({ id: crypto.randomUUID(), name, km });
  }
  if (stations.length > 50)
    throw Error(
      "This GPX has more than 50 aid waypoints. Remove extra waypoints before uploading.",
    );
  stations.sort((a, b) => a.km - b.km);
  return {
    route: simplified,
    elevationsM: profile ? indices.map((i) => profile[i]) : null,
    stations,
  };
}

export function parseGpx(text: string): Coordinate[] {
  return parseGpxWithElevation(text).route;
}

// Iterative Douglas–Peucker in meters, including elevation error so climbs survive.
function simplifyRoute(
  route: Coordinate[],
  elevations: number[] | null,
): number[] {
  if (route.length <= 6000) return route.map((_, i) => i);
  const scale = Math.cos((route[0][1] * Math.PI) / 180);
  const points = route.map((p, i) => [
    p[0] * 111320 * scale,
    p[1] * 111320,
    elevations?.[i] ?? 0,
  ]);
  const simplify = (tolerance: number) => {
    const keep = new Set([0, points.length - 1]);
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      const delta = points[b].map((v, j) => v - points[a][j]);
      const length = delta.reduce((s, v) => s + v * v, 0);
      let best = tolerance * tolerance,
        index = -1;
      for (let i = a + 1; i < b; i++) {
        const f = Math.max(
          0,
          Math.min(
            1,
            points[i].reduce(
              (s, v, j) => s + (v - points[a][j]) * delta[j],
              0,
            ) / (length || 1),
          ),
        );
        const error = points[i].reduce(
          (s, v, j) => s + (v - points[a][j] - f * delta[j]) ** 2,
          0,
        );
        if (error > best) {
          best = error;
          index = i;
        }
      }
      if (index >= 0) {
        keep.add(index);
        stack.push([a, index], [index, b]);
      }
    }
    return [...keep].sort((a, b) => a - b);
  };
  let tolerance = 0.5,
    indices = simplify(tolerance);
  while (indices.length > 6000) {
    tolerance *= 2;
    indices = simplify(tolerance);
  }
  return indices;
}
