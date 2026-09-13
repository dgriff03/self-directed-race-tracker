import type { Fix, Race } from "./race.js";
const MINUTE = 60000;
export function feedUpdate(r: Race, fixes: Fix[], now: number, ok: boolean) {
  const times = [
    ...new Set([
      ...(r.feedPointTimes ?? []),
      ...fixes
        .filter((f) => f.at <= now + 120000 && f.at >= r.startAt - 3600000)
        .map((f) => f.at),
    ]),
  ]
    .sort((a, b) => a - b)
    .slice(-12);
  const gaps = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((g) => g >= MINUTE && g <= 3600000)
    .sort((a, b) => a - b);
  const pointCadence = gaps.length
    ? gaps[Math.floor(gaps.length / 2)]
    : (r.feedCadenceMs ?? 10 * MINUTE);
  const latest = times.at(-1) ?? r.lastFeedPointAt ?? null;
  const fresh =
    ok && latest !== null && latest > (r.lastFeedPointAt ?? r.fix?.at ?? 0);
  const received = fresh ? now : (r.lastLocationReceivedAt ?? null);
  const deliveryGaps = [
    ...(r.feedDeliveryGaps ?? []),
    ...(fresh &&
    r.lastLocationReceivedAt &&
    now - r.lastLocationReceivedAt >= MINUTE &&
    now - r.lastLocationReceivedAt <= 3600000
      ? [now - r.lastLocationReceivedAt]
      : []),
  ].slice(-8);
  const sortedDelivery = [...deliveryGaps].sort((a, b) => a - b);
  const cadence = Math.max(
    pointCadence,
    sortedDelivery.length >= 2
      ? sortedDelivery[Math.floor(sortedDelivery.length / 2)]
      : 0,
  );
  // Predict delivery, allowing for the observed age of a newly received point.
  const expected = fresh
    ? Math.max(now, latest!) + cadence
    : (r.nextUpdateExpectedAt ?? (latest ?? now) + cadence);
  const lateFor = now - expected;
  const delay = !ok
    ? MINUTE
    : !received
      ? 5 * MINUTE
      : expected > now
        ? Math.max(MINUTE, expected - now - MINUTE)
        : lateFor > 15 * MINUTE
          ? 5 * MINUTE
          : MINUTE;
  return {
    feedDeliveryGaps: deliveryGaps,
    feedPointTimes: times,
    feedCadenceMs: cadence,
    lastFeedPointAt: latest,
    lastLocationReceivedAt: received,
    nextUpdateExpectedAt: expected,
    nextPollAt: now + delay,
    lastPollAt: now,
    feedOk: ok,
  };
}
