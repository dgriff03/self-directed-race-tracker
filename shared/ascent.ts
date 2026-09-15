// Distance-based smoothing keeps the result independent of GPX sample density.
// Average the piecewise-linear elevation over 100m, sample every 25m, then
// ignore reversals smaller than 3m. This estimates course ascent, not device vert.
const STEP_KM = 0.025;
const HALF_WINDOW_KM = 0.05;
const REVERSAL_M = 3;
type Profile = { distances: number[]; gain: number[] };
const cache = new WeakMap<
  number[],
  { distances: number[]; profile: Profile }
>();
export function ascentProfile(
  ds: number[],
  elevations: number[],
): Profile | null {
  const cached = cache.get(elevations);
  if (cached?.distances === ds) return cached.profile;
  if (
    ds.length < 2 ||
    elevations.length !== ds.length ||
    ds[0] !== 0 ||
    ds.some((d, i) => !Number.isFinite(d) || (i > 0 && d < ds[i - 1])) ||
    elevations.some((e) => !Number.isFinite(e))
  )
    return null;
  // Collapse zero-distance samples: they cannot contribute vertical climbing.
  const x: number[] = [],
    z: number[] = [];
  for (let i = 0; i < ds.length; i++) {
    if (x.length && ds[i] === x.at(-1)) continue;
    x.push(ds[i]);
    z.push(elevations[i]);
  }
  const total = x.at(-1)!;
  if (total === 0) return { distances: [0], gain: [0] };
  const area = [0];
  for (let i = 1; i < x.length; i++)
    area.push(area[i - 1] + ((z[i] + z[i - 1]) / 2) * (x[i] - x[i - 1]));
  const segment = (km: number) => {
    let lo = 1,
      hi = x.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (x[mid] < km) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const integral = (km: number) => {
    const i = segment(km),
      span = km - x[i - 1],
      slope = (z[i] - z[i - 1]) / (x[i] - x[i - 1]);
    return area[i - 1] + z[i - 1] * span + (slope * span * span) / 2;
  };
  // Bound work even for malformed or globe-spanning local GPX uploads.
  const step = Math.max(STEP_KM, total / 80000);
  const distances = Array.from(
    { length: Math.ceil(total / step) + 1 },
    (_, i) => Math.min(total, i * step),
  );
  const smooth = distances.map((km) => {
    const radius = Math.min(HALF_WINDOW_KM, km, total - km);
    if (radius < 1e-9) return km === 0 ? z[0] : z.at(-1)!;
    return (integral(km + radius) - integral(km - radius)) / (2 * radius);
  });
  const turns = [0];
  let direction = 0,
    extreme = 0;
  for (let i = 1; i < smooth.length; i++) {
    if (!direction) {
      const delta = smooth[i] - smooth[0];
      if (Math.abs(delta) >= REVERSAL_M) {
        direction = Math.sign(delta);
        extreme = i;
      }
    } else if (direction * (smooth[i] - smooth[extreme]) >= 0) {
      extreme = i;
    } else if (direction * (smooth[extreme] - smooth[i]) >= REVERSAL_M) {
      turns.push(extreme);
      direction = -direction;
      extreme = i;
    }
  }
  if (direction && extreme !== turns.at(-1)) turns.push(extreme);
  const gain = distances.map(() => 0);
  let sum = 0;
  for (let k = 1; k < turns.length; k++) {
    const a = turns[k - 1],
      b = turns[k],
      rise = Math.max(0, smooth[b] - smooth[a]);
    let peak = smooth[a];
    for (let i = a; i <= b; i++) {
      peak = Math.max(peak, smooth[i]);
      gain[i] = sum + Math.min(rise, Math.max(0, peak - smooth[a]));
    }
    sum += rise;
  }
  for (let i = turns.at(-1)!; i < gain.length; i++) gain[i] = sum;
  const profile = { distances, gain };
  cache.set(elevations, { distances: ds, profile });
  return profile;
}
export function smoothedAscent(
  ds: number[],
  elevations: number[] | null | undefined,
  km: number,
) {
  if (!elevations) return null;
  const p = ascentProfile(ds, elevations);
  if (!p) return null;
  let lo = 0,
    hi = p.distances.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (p.distances[mid] < km) lo = mid + 1;
    else hi = mid;
  }
  const fraction = lo
    ? Math.max(
        0,
        Math.min(
          1,
          (km - p.distances[lo - 1]) / (p.distances[lo] - p.distances[lo - 1]),
        ),
      )
    : 0;
  return {
    totalM: p.gain.at(-1)!,
    completedM: lo
      ? p.gain[lo - 1] + fraction * (p.gain[lo] - p.gain[lo - 1])
      : 0,
  };
}
