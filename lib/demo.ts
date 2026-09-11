import { cumulative, atDistance, type Race } from "../shared/race";
export function demoRace(): Race {
  const route: [number, number][] = [
    [-105.282, 40.055],
    [-105.291, 40.065],
    [-105.295, 40.078],
    [-105.287, 40.09],
    [-105.293, 40.106],
    [-105.303, 40.117],
    [-105.307, 40.135],
    [-105.318, 40.144],
    [-105.325, 40.153],
    [-105.31, 40.161],
    [-105.296, 40.148],
    [-105.289, 40.129],
    [-105.281, 40.119],
    [-105.275, 40.097],
    [-105.271, 40.078],
    [-105.282, 40.055],
  ];
  const distances = cumulative(route),
    total = distances.at(-1)!;
  const now = Date.now(),
    startAt = now - 2.4 * 3600000;
  const km = total * 0.47;
  const pt = atDistance(route, distances, km);
  return {
    id: "demo",
    name: "Boulder Foothills Loop",
    startAt,
    route,
    distances,
    elevationsM: [
      1660, 1710, 1785, 1730, 1810, 1860, 1920, 1990, 2040, 1940, 1870, 1810,
      1830, 1750, 1700, 1660,
    ],
    stations: [
      { id: "1", name: "Foothills Trailhead", km: total * 0.19 },
      { id: "2", name: "Joder Aid", km: total * 0.51 },
      { id: "3", name: "North Valley", km: total * 0.76 },
      { id: "finish", name: "Finish line", km: total },
    ],
    status: "live",
    progressKm: km,
    fix: { lng: pt[0], lat: pt[1], at: now - 90000, km },
    previousFix: null,
    splits: [{ stationId: "1", at: startAt + 3600000, estimated: true }],
    heartbeatAt: now - 15000,
    feedOk: true,
    finishedAt: null,
    revision: 1,
    track: route
      .filter((_, i) => distances[i] < km)
      .map((p, i) => ({
        lng: p[0],
        lat: p[1],
        at: startAt + i * 60000,
        km: distances[i],
      })),
  };
}
