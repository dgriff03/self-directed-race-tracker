import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFixes,
  cumulative,
  project,
  atDistance,
  speed,
  rollingSpeed,
  paceEstimate,
  stationDwellStatus,
  calculateEta,
  setJourneyDirection,
  type Race,
} from "../shared/race";
import { parseKml, validateFeed } from "../functions/src/feed";
function race(): Race {
  const route: [number, number][] = [
    [0, 0],
    [0.01, 0],
    [0.02, 0],
  ];
  const distances = cumulative(route);
  return {
    id: "test",
    name: "test",
    startAt: Date.now() - 3600000,
    route,
    distances,
    stations: [
      { id: "aid", name: "Aid", km: 0.8 },
      { id: "finish", name: "Finish", km: distances.at(-1)! },
    ],
    status: "live",
    progressKm: 0,
    fix: null,
    previousFix: null,
    splits: [],
    heartbeatAt: null,
    feedOk: null,
    finishedAt: null,
    revision: 1,
    track: [],
  };
}
test("sparse fixes interpolate aid splits and ignore duplicates/out-of-order data", () => {
  const r = race();
  const fix = { lng: 0.01, lat: 0, at: r.startAt + 1800000 };
  const result = applyFixes(r, [fix]);
  assert.equal(result.splits.length, 1);
  assert.ok(
    Math.abs(
      result.splits[0].at - (r.startAt + (1800000 * 0.8) / result.progressKm),
    ) < 2,
  );
  const second = applyFixes(result, [fix, { ...fix, at: fix.at - 5000 }]);
  assert.deepEqual(second, result);
});
test("finish archives and all subsequent fixes leave results unchanged", () => {
  const r = race();
  const result = applyFixes(r, [
    { lng: 0.01, lat: 0, at: r.startAt + 1800000 },
    { lng: 0.02, lat: 0, at: r.startAt + 3500000 },
  ]);
  assert.equal(result.status, "complete");
  assert.equal(result.splits.length, 2);
  assert.deepEqual(
    applyFixes(result, [{ lng: 0, lat: 0, at: Date.now() }]),
    result,
  );
});
test("ignores pre-race, future, off-route and impossible jumps", () => {
  const r = race();
  assert.equal(
    applyFixes(r, [
      { lng: 0.01, lat: 0, at: r.startAt - 1 },
      { lng: 0.01, lat: 0, at: Date.now() + 600000 },
      { lng: 1, lat: 1, at: Date.now() },
      { lng: 0.02, lat: 0, at: r.startAt + 1000 },
    ]).fix,
    null,
  );
});
test("closed course start cannot jump to finish", () => {
  const r = race();
  r.route.push([0.02, 0.01], [0, 0.01], [0, 0]);
  r.distances = cumulative(r.route);
  r.stations = [{ id: "finish", name: "Finish", km: r.distances.at(-1)! }];
  const result = applyFixes(r, [{ lng: 0, lat: 0, at: r.startAt + 1000 }]);
  assert.equal(result.progressKm, 0);
  assert.equal(result.status, "live");
});
test("projection and interpolation agree", () => {
  const r = race();
  assert.ok(
    Math.abs(
      project(r.route, r.distances, atDistance(r.route, r.distances, 0.7)).km -
        0.7,
    ) < 0.001,
  );
});
test("KML parses timestamped points and gx tracks, rejects entity documents", () => {
  const xml =
    "<kml><Document><Placemark><TimeStamp><when>2026-09-11T10:00:00Z</when></TimeStamp><Point><coordinates>-105,40,1600</coordinates></Point></Placemark><Placemark><gx:Track><when>2026-09-11T10:01:00Z</when><gx:coord>-105.1 40.1 1601</gx:coord></gx:Track></Placemark></Document></kml>";
  const fixes = parseKml(xml);
  assert.equal(fixes.length, 2);
  assert.equal(fixes[1].lng, -105.1);
  assert.throws(() => parseKml("<!DOCTYPE kml><kml/>"));
  assert.throws(() => parseKml("<html/>"));
});
test("Garmin ExtendedData timestamps are accepted, missing timestamps ignored", () => {
  assert.equal(
    parseKml(
      '<kml><Placemark><ExtendedData><Data name="Time UTC"><value>2026-09-11T10:00:00Z</value></Data></ExtendedData><Point><coordinates>-105,40</coordinates></Point></Placemark></kml>',
    ).length,
    1,
  );
  assert.equal(
    parseKml(
      "<kml><Placemark><Point><coordinates>-105,40</coordinates></Point></Placemark></kml>",
    ).length,
    0,
  );
});
test("feed allowlist prevents SSRF and URL credentials", () => {
  assert.equal(
    validateFeed("https://share.garmin.com/Feed/Share/runner").hostname,
    "share.garmin.com",
  );
  for (const url of [
    "http://share.garmin.com/Feed/Share/test",
    "https://localhost/Feed/Share/test",
    "https://share.garmin.com.evil.com/Feed/Share/test",
    "https://user:pass@share.garmin.com/Feed/Share/test",
    "https://share.garmin.com:444/Feed/Share/test",
  ])
    assert.throws(() => validateFeed(url));
});

import {
  kmToMiles,
  milesToKm,
  metersToFeet,
  pacePerMile,
  elevationProgress,
} from "../shared/race";
test("imperial display conversions preserve stored distances and pace", () => {
  assert.equal(kmToMiles(1.609344), 1);
  assert.equal(milesToKm(1), 1.609344);
  assert.ok(Math.abs(metersToFeet(304.8) - 1000) < 1e-8);
  assert.equal(pacePerMile(9.656064), "10:00");
  assert.equal(pacePerMile(0), "—");
});
test("vertical progress sums ascent, interpolates climbs, and ignores descents", () => {
  const ds = [0, 1, 2, 3],
    e = [100, 200, 150, 250];
  assert.deepEqual(elevationProgress(ds, e, 0), { totalM: 200, completedM: 0 });
  assert.deepEqual(elevationProgress(ds, e, 0.5), {
    totalM: 200,
    completedM: 50,
  });
  assert.deepEqual(elevationProgress(ds, e, 1.5), {
    totalM: 200,
    completedM: 100,
  });
  assert.deepEqual(elevationProgress(ds, e, 2.5), {
    totalM: 200,
    completedM: 150,
  });
  assert.deepEqual(elevationProgress(ds, e, 99), {
    totalM: 200,
    completedM: 200,
  });
  assert.equal(elevationProgress(ds, undefined, 1), null);
  assert.equal(elevationProgress(ds, [100, 200], 1), null);
  assert.equal(elevationProgress(ds, [100, NaN, 150, 250], 1), null);
  assert.deepEqual(elevationProgress(ds, [100, 100, 100, 100], 1), {
    totalM: 0,
    completedM: 0,
  });
});

test("MapShare URLs normalize while Garmin host restrictions remain", () => {
  assert.equal(
    validateFeed("https://share.garmin.com/Runner").pathname,
    "/Feed/Share/Runner",
  );
  assert.throws(() =>
    validateFeed("https://share.garmin.com.evil.example/Runner"),
  );
});
test("Garmin Time UTC is independent of the process timezone", () => {
  const old = process.env.TZ;
  process.env.TZ = "America/Denver";
  try {
    const fixes = parseKml(
      '<kml><Placemark><ExtendedData><Data name="Time UTC"><value>9/11/2026 4:00:00 PM</value></Data></ExtendedData><Point><coordinates>-105,40</coordinates></Point></Placemark></kml>',
    );
    assert.equal(fixes[0].at, Date.parse("2026-09-11T16:00:00Z"));
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});

import { requestIp } from "../functions/src/request-ip";
test("rate limit identity ignores spoofed forwarded prefixes", () => {
  assert.equal(
    requestIp("1.1.1.1, 203.0.113.9"),
    requestIp("8.8.8.8, 203.0.113.9"),
  );
  assert.equal(requestIp(undefined, "::ffff:127.0.0.1"), "127.0.0.1");
});
test("an ambiguous parallel-trail fix cannot fabricate splits", () => {
  const r = race();
  r.route = [
    [0, 0],
    [0.02, 0],
    [0.02, 0.0005],
    [0, 0.0005],
  ];
  r.distances = cumulative(r.route);
  r.stations = [{ id: "aid", name: "Aid", km: 1.5 }];
  r.progressKm = 0.3;
  r.fix = { lng: 0.003, lat: 0, at: r.startAt + 100000, km: 0.3 };
  const pending = applyFixes(r, [
    { lng: 0.004, lat: 0.0005, at: r.startAt + 1800000 },
  ]);
  assert.equal(pending.progressKm, 0.3);
  assert.equal(pending.splits.length, 0);
  assert.ok(pending.pendingFix);
  const recovered = applyFixes(pending, [
    { lng: 0.005, lat: 0, at: r.startAt + 2400000 },
  ]);
  assert.ok(recovered.progressKm < 1);
  assert.equal(recovered.splits.length, 0);
  const confirmed = applyFixes(pending, [
    { lng: 0.003, lat: 0.0005, at: r.startAt + 2400000 },
  ]);
  assert.equal(confirmed.splits.length, 1);
});

test("rollingSpeed uses recent samples in its 40-minute window and falls back to overall speed when sparse", () => {
  const r = race();
  const t0 = r.startAt;
  // Race started 2 hours ago, overall speed = 10 km / 2 h = 5 km/h
  r.progressKm = 10;
  r.fix = { lng: 0.01, lat: 0, at: t0 + 2 * 3600000, km: 10 };
  // Overall speed is 5 km/h
  assert.equal(speed(r), 5);

  // When track has fewer than 2 fixes, falls back to overall speed
  r.track = [r.fix];
  assert.equal(rollingSpeed(r), 5);

  // In the last 15 minutes, runner sped up to 10 km/h:
  // Fix 15 min ago: km 7.5 at t0 + 105 min
  // Fix now: km 10.0 at t0 + 120 min
  // Delta = 2.5 km in 15 min (0.25 h) = 10 km/h
  r.track = [
    { lng: 0.005, lat: 0, at: t0 + 105 * 60000, km: 7.5 },
    { lng: 0.01, lat: 0, at: t0 + 120 * 60000, km: 10.0 },
  ];
  assert.equal(rollingSpeed(r), 10);
});

test("stationDwellStatus detects stationary runner at aid station", () => {
  const r = race();
  // Station 1 at km 0.8
  const stnCoord = atDistance(r.route, r.distances, 0.8);
  const tNow = r.startAt + 3600000;
  // Runner arrived at Station 1 at tNow - 4 minutes
  r.progressKm = 0.8;
  r.fix = { lng: stnCoord[0], lat: stnCoord[1], at: tNow - 4 * 60000, km: 0.8 };
  r.splits = [{ stationId: "aid", at: tNow - 4 * 60000, estimated: true }];

  const dwell = stationDwellStatus(r, tNow);
  assert.equal(dwell.atStation, true);
  assert.equal(dwell.station?.id, "aid");
  assert.equal(dwell.dwellMs, 4 * 60000);

  // Runner moves 500m past the station
  r.progressKm = 1.3;
  r.fix = { lng: 0.015, lat: 0, at: tNow + 60000, km: 1.3 };
  assert.equal(stationDwellStatus(r, tNow + 60000).atStation, false);
});

test("calculateEta accounts for intermediate 10-minute station dwell and current dwell", () => {
  const r = race();
  r.route = [
    [0, 0],
    [0.1, 0],
    [0.2, 0],
    [0.3, 0],
  ];
  r.distances = [0, 10, 20, 30]; // 30 km total
  r.stations = [
    { id: "aid1", name: "Aid 1", km: 10 },
    { id: "aid2", name: "Aid 2", km: 20 },
    { id: "finish", name: "Finish", km: 30 },
  ];

  // Case 1: Runner is moving between Start and Aid 1 at 10 km/h
  // StartAt: 8:00 AM (t0)
  // At km 5 at 8:30 AM (t0 + 30 min)
  const t0 = r.startAt;
  const tFix = t0 + 30 * 60000;
  r.progressKm = 5;
  r.fix = { lng: 0.05, lat: 0, at: tFix, km: 5 };
  r.track = [
    { lng: 0.025, lat: 0, at: tFix - 15 * 60000, km: 2.5 },
    { lng: 0.05, lat: 0, at: tFix, km: 5 },
  ];
  // Rolling speed = 2.5 km in 15 min = 10 km/h
  assert.equal(rollingSpeed(r), 10);

  // Target: Aid 1 (km 10) -> remaining 5 km at 10 km/h = 30 min. No intermediate stations.
  // ETA = tFix + 30 min
  const etaAid1 = calculateEta(r, 10, "aid1", tFix);
  assert.equal(etaAid1, tFix + 30 * 60000);

  // Target: Aid 2 (km 20) -> remaining 15 km at 10 km/h = 90 min + 10 min at Aid 1 = 100 min.
  // ETA = tFix + 100 min
  const etaAid2 = calculateEta(r, 20, "aid2", tFix);
  assert.equal(etaAid2, tFix + 100 * 60000);

  // Target: Finish (km 30) -> remaining 25 km at 10 km/h = 150 min + 20 min (Aid 1 & Aid 2) = 170 min.
  // ETA = tFix + 170 min
  const etaFinish = calculateEta(r, 30, "finish", tFix);
  assert.equal(etaFinish, tFix + 170 * 60000);

  // Case 2: Runner is resting AT Aid 1 (km 10)
  // Overall race average: 10 km in 2 hours = 5 km/h
  // Arrived at Aid 1 at t0 + 116 min (4 minutes ago)
  const tNow = t0 + 120 * 60000;
  r.progressKm = 10;
  r.splits = [{ stationId: "aid1", at: t0 + 116 * 60000, estimated: true }];
  r.fix = { lng: 0.1, lat: 0, at: t0 + 116 * 60000, km: 10 };
  r.track = [{ lng: 0.1, lat: 0, at: t0 + 116 * 60000, km: 10 }];
  assert.equal(speed(r), 10 / (116 / 60)); // ~5.17 km/h

  // Target: Aid 2 (km 20).
  // Remaining distance: 10 km at overall speed (5.1724 km/h) = 116 minutes travel time.
  // Remaining dwell at Aid 1: 10 min - 4 min = 6 minutes.
  // Overall pace already includes stops; no extra dwell is added.
  const etaFromStation = calculateEta(r, 20, "aid2", tNow);
  const expectedTravelMs = (10 / speed(r)) * 3600000;
  assert.equal(etaFromStation, Math.round(tNow + expectedTravelMs));
});

test("overall ETA does not add station dwell with sparse fixes", () => {
  const r = race();
  r.progressKm = 1;
  r.fix = { lng: 0.009, lat: 0, km: 1, at: r.startAt + 3600000 };
  r.stations = [
    { id: "a", name: "A", km: 1.2 },
    { id: "b", name: "B", km: 1.5 },
    { id: "finish", name: "Finish", km: 2 },
  ];
  assert.equal(calculateEta(r, 2, "finish", r.fix.at), r.fix.at + 3600000);
});
test("approaching a station does not count as arrival", () => {
  const r = race(),
    point = atDistance(r.route, r.distances, 0.75);
  r.progressKm = 0.75;
  r.fix = { lng: point[0], lat: point[1], km: 0.75, at: r.startAt + 3600000 };
  r.previousFix = { lng: 0, lat: 0, km: 0, at: r.startAt };
  assert.equal(stationDwellStatus(r, r.fix.at).atStation, false);
  assert.ok(calculateEta(r, 0.8, "aid", r.fix.at) < r.fix.at + 5 * 60000);
});
test("tiny positive rolling pace is bounded by overall pace", () => {
  const r = race();
  r.progressKm = 10;
  r.fix = { lng: 0.01, lat: 0, km: 10, at: r.startAt + 2 * 3600000 };
  r.track = [
    { lng: 0.009, lat: 0, km: 9.95, at: r.fix.at - 20 * 60000 },
    r.fix,
  ];
  assert.equal(rollingSpeed(r), 2.5);
});
test("confirmed switchback motion applies each following fix and preserves pending timing", () => {
  const r = race();
  r.route = [
    [0, 0],
    [0.02, 0],
    [0.02, 0.0005],
    [0, 0.0005],
  ];
  r.distances = cumulative(r.route);
  r.stations = [{ id: "aid", name: "Aid", km: 1.5 }];
  r.progressKm = 0.3;
  r.fix = { lng: 0.003, lat: 0, at: r.startAt + 100000, km: 0.3 };
  const pending = { lng: 0.004, lat: 0.0005, at: r.startAt + 1800000 };
  let current = applyFixes(r, [
    pending,
    { lng: 0.003, lat: 0.0005, at: r.startAt + 2400000 },
  ]);
  assert.ok(current.splits[0].at < pending.at);
  assert.equal(current.previousFix.at, pending.at);
  for (const [lng, at] of [
    [0.002, r.startAt + 3000000],
    [0.001, r.startAt + 3500000],
  ]) {
    current = applyFixes(current, [{ lng, lat: 0.0005, at }]);
    assert.equal(current.fix.at, at);
    assert.equal(current.pendingFix, null);
  }
});

test("replay seeks forward and backward without leaking future splits, including future-dated recordings", async () => {
  const { ReplayEngine } = await import("../lib/replay");
  const r = race();
  r.startAt = Date.UTC(2040, 0, 1);
  const points = [
    { lng: 0, lat: 0, at: r.startAt },
    { lng: 0.01, lat: 0, at: r.startAt + 1800000 },
    { lng: 0.02, lat: 0, at: r.startAt + 3500000 },
  ];
  const engine = new ReplayEngine(r, points);
  assert.equal(engine.seek(r.startAt - 1).fix, null);
  const middle = engine.seek(points[1].at);
  assert.equal(middle.splits.length, 1);
  const finish = engine.seek(points[2].at);
  assert.equal(finish.status, "complete");
  assert.equal(finish.splits.length, 2);
  assert.deepEqual(engine.seek(points[1].at), middle);
  assert.equal(engine.seek(r.startAt - 1).splits.length, 0);
  assert.deepEqual(engine.seek(points[2].at), finish);
  assert.equal(r.splits.length, 0);
});

test("out-and-back detects sustained early return without fabricating summit splits or mileage", async () => {
  const {
    validOutAndBack,
    completedDistance,
    plannedDistance,
    stationSkipped,
    journeyElevation,
    setJourneyDirection,
  } = await import("../shared/race");
  const { ReplayEngine } = await import("../lib/replay");
  const r = race();
  r.startAt = Date.UTC(2040, 0, 1);
  r.route = [
    [0, 0],
    [0.05, 0],
    [0.1, 0],
    [0.05, 0],
    [0, 0],
  ];
  r.distances = cumulative(r.route);
  r.outAndBack = true;
  r.elevationsM = [1000, 1500, 2000, 1500, 1000];
  const total = r.distances.at(-1)!;
  r.stations = [
    { id: "aid", name: "Outward aid", km: 0.8 },
    { id: "summit", name: "Summit", km: total / 2 },
    { id: "return-aid", name: "Return aid", km: total - 0.8 },
    { id: "finish", name: "Finish", km: total },
  ];
  assert.equal(validOutAndBack(r.route), true);
  assert.equal(
    validOutAndBack([
      [0, 0],
      [0.1, 0],
      [0.05, 0.05],
      [0, 0],
    ]),
    false,
  );
  const points = [
    0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.025, 0.02, 0.015, 0.01, 0.005,
    0,
  ].map((lng, i) => ({ lng, lat: 0, at: r.startAt + i * 600000 }));
  const engine = new ReplayEngine(r, points);
  const suspect = engine.seek(points[8].at);
  assert.equal(suspect.journey?.phase, "outbound");
  assert.equal(suspect.splits.length, 1);
  const returning = engine.seek(points[9].at);
  assert.equal(returning.journey?.phase, "returning");
  assert.equal(stationSkipped(returning, "summit"), true);
  assert.equal(
    calculateEta(returning, total / 2, "summit", points[9].at),
    null,
  );
  assert.ok(plannedDistance(returning) < total / 2);
  assert.ok(completedDistance(returning) < plannedDistance(returning));
  assert.ok(journeyElevation(returning)!.totalM < 400);
  const eta = calculateEta(returning, total, "finish", points[9].at);
  assert.ok(eta && eta > points[9].at);
  const withReturnPace = engine.seek(points[10].at);
  assert.equal(paceEstimate(withReturnPace).source, "rolling");
  assert.ok(paceEstimate(withReturnPace).kmh < 5);
  const backtrack = applyFixes(
    withReturnPace,
    [{ lng: 0.015, lat: 0, at: points[11].at }],
    points[11].at,
  );
  assert.ok(backtrack.progressKm < withReturnPace.progressKm);
  assert.equal(backtrack.splits.length, withReturnPace.splits.length);
  const finished = engine.seek(points[12].at);
  assert.equal(finished.status, "complete");
  assert.equal(
    finished.splits.some((s) => s.stationId === "summit"),
    false,
  );
  assert.equal(
    finished.splits.some((s) => s.stationId === "return-aid"),
    true,
  );
  assert.equal(completedDistance(finished), plannedDistance(finished));
  assert.equal(engine.seek(points[6].at).journey?.phase, "outbound");
  assert.deepEqual(engine.seek(points[12].at), finished);
  const corrected = setJourneyDirection(returning, "outbound");
  assert.equal(corrected.journey?.phase, "outbound");
  assert.equal(stationSkipped(corrected, "summit"), false);
  assert.equal(
    applyFixes(corrected, [points[10]], points[10].at).journey?.phase,
    "outbound",
  );
  const manual = setJourneyDirection(suspect, "returning");
  assert.equal(manual.journey?.phase, "returning");
  assert.ok(plannedDistance(manual) < total);
});

test("out-and-back ignores a brief reversal and off-route GPS, and supports the planned turnaround", async () => {
  const r = race();
  r.startAt = Date.UTC(2040, 0, 1);
  r.route = [
    [0, 0],
    [0.02, 0],
    [0, 0],
  ];
  r.distances = cumulative(r.route);
  r.outAndBack = true;
  r.stations = [
    { id: "summit", name: "Summit", km: r.distances.at(-1)! / 2 },
    { id: "finish", name: "Finish", km: r.distances.at(-1)! },
  ];
  const points = [
    0, 0.005, 0.01, 0.009, 0.015, 0.02, 0.015, 0.01, 0.005, 0,
  ].map((lng, i) => ({ lng, lat: 0, at: r.startAt + i * 600000 }));
  const outbound = applyFixes(r, points.slice(0, 5), points[4].at);
  assert.equal(outbound.journey?.phase, "outbound");
  const off = applyFixes(
    outbound,
    [{ lng: 0.015, lat: 0.1, at: points[4].at + 60000 }],
    points[5].at,
  );
  assert.equal(off.fix?.at, outbound.fix?.at);
  const result = applyFixes(outbound, points.slice(5), points.at(-1)!.at);
  assert.equal(result.status, "complete");
  assert.ok(result.splits.some((s) => s.stationId === "summit"));
});

test("race creation bypasses Hosting even when apiBase is /api; edit and emulator routes stay configured", async () => {
  const { apiBase } = await import("../lib/api-url");
  const c = { projectId: "self-directed-tracker-type-two", apiBase: "/api" };
  assert.equal(
    apiBase("/races", c),
    "https://us-central1-self-directed-tracker-type-two.cloudfunctions.net/api",
  );
  assert.equal(apiBase("/edit", c), "/api");
  assert.equal(apiBase("/races", { ...c, emulator: true }), "/api");
  assert.notEqual(requestIp("203.0.113.1"), requestIp("203.0.113.2"));
});
test("replay preserves state identity between fixes and accepts a day of five-second samples", async () => {
  const { ReplayEngine } = await import("../lib/replay");
  const r = race();
  const points = Array.from({ length: 17280 }, (_, i) => ({
    lng: 0,
    lat: 0,
    at: r.startAt + i * 5000,
  }));
  const engine = new ReplayEngine(r, points);
  const first = engine.seek(r.startAt);
  for (let i = 1; i < 50; i++)
    assert.equal(engine.seek(r.startAt + i * 100), first);
  assert.equal(engine.seek(points.at(-1)!.at).fix?.at, points.at(-1)!.at);
});
test("rolling ETA retains downstream and current stop allowances while dwelling", () => {
  const r = race();
  r.stations = [
    { id: "aid", name: "Aid", km: 1 },
    { id: "later", name: "Later", km: 2 },
    { id: "finish", name: "Finish", km: 3 },
  ];
  r.progressKm = 1;
  r.fix = { lng: 0, lat: 0, at: r.startAt + 600000, km: 1 };
  const pace = { kmh: 6, source: "rolling" as const };
  const at = r.fix.at;
  const before = calculateEta({ ...r, progressKm: 0.999 }, 3, "finish", at, {
    pace,
    dwell: { atStation: false, dwellMs: 0 },
  })!;
  r.splits = [{ stationId: "aid", at, estimated: true }];
  const arrived = calculateEta(r, 3, "finish", at, {
    pace,
    dwell: {
      atStation: true,
      dwellMs: 0,
      arrivalAt: at,
      station: r.stations[0],
    },
  })!;
  assert.ok(Math.abs(before - arrived) < 1000);
  const dwelling = calculateEta(r, 3, "finish", at + 240000, {
    pace,
    dwell: {
      atStation: true,
      dwellMs: 240000,
      arrivalAt: at,
      station: r.stations[0],
    },
  })!;
  assert.equal(dwelling, arrived);
});
test("out-and-back tolerates small route deviations but rejects distinct return trails", async () => {
  const { validOutAndBack } = await import("../shared/race");
  assert.equal(
    validOutAndBack([
      [0, 0],
      [0.05, 0],
      [0.1, 0],
      [0.05, 0.001],
      [0, 0],
    ]),
    true,
  );
  assert.equal(
    validOutAndBack([
      [0, 0],
      [0.05, 0],
      [0.1, 0],
      [0.05, 0.01],
      [0, 0],
    ]),
    false,
  );
});
test("out-and-back switchbacks corroborate pending fixes, preserve split times and continue accepting movement", () => {
  const r = race();
  const outward: [number, number][] = [
    [0, 0],
    [0.02, 0],
    [0.02, 0.0005],
    [0, 0.0005],
  ];
  r.route = [...outward, ...outward.slice(0, -1).reverse()];
  r.distances = cumulative(r.route);
  r.outAndBack = true;
  r.stations = [{ id: "aid", name: "Aid", km: 1.5 }];
  r.progressKm = 0.3;
  r.fix = {
    lng: 0.003,
    lat: 0,
    at: r.startAt + 100000,
    km: 0.3,
    outboundKm: 0.3,
  };
  r.journey = {
    phase: "outbound",
    peakKm: 0.3,
    peakAt: r.fix.at,
    positionKm: 0.3,
    reverseCount: 0,
    reverseAt: 0,
  };
  const p = { lng: 0.004, lat: 0.0005, at: r.startAt + 1800000 };
  const pending = applyFixes(r, [p]);
  assert.ok(pending.pendingFix);
  assert.equal(pending.splits.length, 0);
  const recovered = applyFixes(pending, [
    { lng: 0.005, lat: 0, at: r.startAt + 2400000 },
  ]);
  assert.equal(recovered.splits.length, 0);
  let current = applyFixes(pending, [
    { lng: 0.003, lat: 0.0005, at: r.startAt + 2400000 },
  ]);
  assert.equal(current.previousFix?.at, p.at);
  assert.ok(current.splits[0].at < p.at);
  for (const [lng, at] of [
    [0.002, r.startAt + 3000000],
    [0.001, r.startAt + 3500000],
  ]) {
    current = applyFixes(current, [{ lng, lat: 0.0005, at }]);
    assert.equal(current.fix?.at, at);
    assert.equal(current.pendingFix, null);
  }
  current = setJourneyDirection(current, "returning");
  const back = { lng: 0.002, lat: 0.0005, at: r.startAt + 4000000 };
  current = applyFixes(current, [back], r.startAt + 6000000);
  assert.equal(current.fix?.at, back.at);
  current = applyFixes(
    current,
    [{ lng: 0.003, lat: 0.0005, at: r.startAt + 4600000 }],
    r.startAt + 6000000,
  );
  assert.equal(current.previousFix?.at, back.at);
  current = applyFixes(
    current,
    [{ lng: 0.004, lat: 0.0005, at: r.startAt + 5200000 }],
    r.startAt + 6000000,
  );
  assert.equal(current.fix?.at, r.startAt + 5200000);
  assert.equal(current.pendingFix, null);
});

test("a 200m retreat and lingering do not trigger early return; a new peak resets evidence", () => {
  const r = race();
  r.startAt = Date.UTC(2040, 0, 1);
  r.route = [
    [0, 0],
    [0.02, 0],
    [0, 0],
  ];
  r.distances = cumulative(r.route);
  r.outAndBack = true;
  r.stations = [];
  const points = [0, 0.01, 0.0094, 0.0088, 0.0082, 0.0082, 0.0101].map(
    (lng, i) => ({ lng, lat: 0, at: r.startAt + i * 600000 }),
  );
  const retreat = applyFixes(r, points.slice(0, 6), points[5].at);
  assert.equal(retreat.journey?.phase, "outbound");
  const advanced = applyFixes(retreat, [points[6]], points[6].at);
  assert.equal(advanced.journey?.reverseCount, 0);
  assert.equal(advanced.journey?.reverseAt, 0);
});
test("manual turnaround retains movement evidence so it cannot manufacture dwell", () => {
  const r = race();
  r.route = [
    [0, 0],
    [0.02, 0],
    [0, 0],
  ];
  r.distances = cumulative(r.route);
  r.outAndBack = true;
  const total = r.distances.at(-1)!;
  r.progressKm = 0.8;
  const at = r.startAt + 3600000;
  const point = atDistance(r.route, r.distances, 0.8),
    prev = atDistance(r.route, r.distances, 0.6);
  r.fix = { lng: point[0], lat: point[1], at, km: 0.8, outboundKm: 0.8 };
  r.previousFix = {
    lng: prev[0],
    lat: prev[1],
    at: at - 600000,
    km: 0.6,
    outboundKm: 0.6,
  };
  r.journey = {
    phase: "outbound",
    positionKm: 0.8,
    peakKm: 0.8,
    peakAt: at,
    reverseAt: 0,
    reverseCount: 0,
  };
  r.stations = [{ id: "return-aid", name: "Return aid", km: total - 0.8 }];
  r.splits = [{ stationId: "return-aid", at: r.startAt, estimated: true }];
  const turned = setJourneyDirection(r, "returning");
  assert.equal(turned.previousFix?.at, r.previousFix.at);
  assert.equal(stationDwellStatus(turned, at).atStation, false);
});

test("out-and-back visits mirror outbound aids once, keep the summit single and respect manual return entries", async () => {
  const { stationVisits } = await import("../shared/race");
  const stations = [
    { id: "a", name: "Lower aid", km: 3 },
    { id: "b", name: "Upper aid", km: 7 },
    { id: "summit", name: "Summit", km: 9.92 },
    { id: "finish", name: "Finish", km: 20 },
  ];
  const visits = stationVisits(stations, [0, 10, 20], true);
  assert.deepEqual(
    visits.map((s) => s.id),
    ["a", "b", "summit", "return-b", "return-a", "finish"],
  );
  assert.equal(visits.find((s) => s.id === "return-b")?.km, 13);
  assert.deepEqual(stationVisits(visits, [0, 10, 20], true), visits);
  assert.deepEqual(stationVisits(stations, [0, 10, 20], false), stations);
  assert.equal(
    stationVisits(
      [...stations, { id: "custom-return", name: "Lower aid return", km: 17 }],
      [0, 10, 20],
      true,
    ).some((s) => s.id === "return-a"),
    false,
  );
});
test("generated return visits have independent splits and disappear on backward replay", async () => {
  const { ReplayEngine } = await import("../lib/replay");
  const r = race();
  r.startAt = Date.UTC(2040, 0, 1);
  r.outAndBack = true;
  r.route = [
    [0, 0],
    [0.02, 0],
    [0, 0],
  ];
  r.distances = cumulative(r.route);
  const total = r.distances.at(-1)!;
  r.stations = [
    { id: "a", name: "Aid", km: 0.8 },
    { id: "summit", name: "Summit", km: total / 2 },
    { id: "finish", name: "Finish", km: total },
  ];
  const points = [0, 0.005, 0.01, 0.015, 0.02, 0.015, 0.01, 0.005, 0].map(
    (lng, i) => ({ lng, lat: 0, at: r.startAt + i * 600000 }),
  );
  const engine = new ReplayEngine(r, points),
    complete = engine.seek(points.at(-1)!.at);
  assert.equal(complete.status, "complete");
  assert.deepEqual(
    complete.splits.map((s) => s.stationId),
    ["a", "summit", "return-a", "finish"],
  );
  assert.ok(
    complete.splits.find((s) => s.stationId === "return-a")!.at >
      complete.splits.find((s) => s.stationId === "summit")!.at,
  );
  const outbound = engine.seek(points[3].at);
  assert.equal(
    outbound.splits.some((s) => s.stationId === "return-a"),
    false,
  );
  assert.ok(calculateEta(outbound, total - 0.8, "return-a", points[3].at));
});

test("early return skips both visits above the turnaround but records the generated lower return visit", async () => {
  const { stationSkipped } = await import("../shared/race");
  const r = race();
  r.startAt = Date.UTC(2040, 0, 1);
  r.outAndBack = true;
  r.route = [
    [0, 0],
    [0.04, 0],
    [0, 0],
  ];
  r.distances = cumulative(r.route);
  const total = r.distances.at(-1)!;
  r.stations = [
    { id: "low", name: "Lower", km: 0.5 },
    { id: "high", name: "Upper", km: 3 },
    { id: "summit", name: "Summit", km: total / 2 },
    { id: "finish", name: "Finish", km: total },
  ];
  const points = [0, 0.005, 0.01, 0.015, 0.01, 0.005, 0].map((lng, i) => ({
    lng,
    lat: 0,
    at: r.startAt + i * 600000,
  }));
  const result = applyFixes(r, points, points.at(-1)!.at);
  assert.equal(result.status, "complete");
  assert.deepEqual(
    result.splits.map((s) => s.stationId),
    ["low", "return-low", "finish"],
  );
  assert.equal(stationSkipped(result, "high"), true);
  assert.equal(stationSkipped(result, "return-high"), true);
});

test("early start window accepts boundary fixes and uses actual time in both modes", () => {
  for (const outAndBack of [false, true]) {
    const r = race();
    r.status = "scheduled";
    r.outAndBack = outAndBack;
    if (outAndBack) {
      r.route = [
        [0, 0],
        [0.01, 0],
        [0.02, 0],
        [0.01, 0],
        [0, 0],
      ];
      r.distances = cumulative(r.route);
    }
    const early = r.startAt - 3600000;
    const ignored = applyFixes(
      r,
      [{ lng: 0, lat: 0, at: early - 1 }],
      r.startAt,
    );
    assert.equal(ignored.fix, null);
    assert.equal(ignored.actualStartAt, undefined);
    const started = applyFixes(r, [{ lng: 0, lat: 0, at: early }], r.startAt);
    assert.equal(started.actualStartAt, undefined);
    assert.equal(started.startAt, r.startAt);
    assert.equal(started.status, "scheduled");
    const waiting = applyFixes(
      started,
      [{ lng: 0.0001, lat: 0, at: early + 600000 }],
      r.startAt,
    );
    assert.equal(waiting.fix, null);
    assert.equal(waiting.actualStartAt, undefined);
    const moved = applyFixes(
      waiting,
      [{ lng: 0.009, lat: 0, at: early + 1800000 }],
      r.startAt,
    );
    assert.equal(moved.actualStartAt, early + 600000);
    assert.ok(speed(moved) > 1 && speed(moved) < 4);
    assert.ok(
      moved.splits.every((s) => s.at >= early && s.at <= early + 1800000),
    );
    const offRoute = applyFixes(r, [{ lng: 1, lat: 1, at: early }], r.startAt);
    assert.equal(offRoute.actualStartAt, undefined);
    const late = applyFixes(
      r,
      [{ lng: 0, lat: 0, at: r.startAt + 600000 }],
      r.startAt + 600000,
    );
    assert.equal(late.actualStartAt, undefined);
  }
});

test("dense replay backward checkpoint seeks match a fresh reconstruction", async () => {
  const { ReplayEngine } = await import("../lib/replay");
  const r = race();
  r.route = Array.from(
    { length: 6000 },
    (_, i) => [(i / 5999) * 0.1, 0] as [number, number],
  );
  r.distances = cumulative(r.route);
  r.stations = [{ id: "aid", name: "Aid", km: 1 }];
  const points = Array.from({ length: 10000 }, (_, i) => ({
    lng: (i / 10000) * 0.08,
    lat: 0,
    at: r.startAt + i * 1000,
  }));
  const engine = new ReplayEngine(r, points);
  engine.seek(points.at(-1)!.at);
  for (const count of [8701, 2300, 6301, 1, 0, 9999]) {
    const at = count ? points[count - 1].at : r.startAt - 1;
    const start = performance.now();
    const result = engine.seek(at);
    console.log(
      `Dense replay seek ${count}: ${Math.round(performance.now() - start)}ms`,
    );
    const expected = applyFixes(r, points.slice(0, count), at);
    assert.deepEqual(result, expected);
  }
});

test("near-tip reversal infers a plausible turnaround visit but not a distant early retreat", () => {
  const r = race();
  r.outAndBack = true;
  r.route = [
    [0, 0],
    [0.04, 0],
    [0, 0],
  ];
  r.distances = cumulative(r.route);
  const half = r.distances.at(-1)! / 2;
  r.stations = [
    { id: "tip", name: "Turn", km: half + 0.016 },
    { id: "finish", name: "Finish", km: half * 2 },
  ];
  const points = [0, 0.01, 0.02, 0.03, 0.0398, 0.03].map((lng, i) => ({
    lng,
    lat: 0,
    at: r.startAt + i * 600000,
  }));
  const out = applyFixes(r, points, points.at(-1)!.at);
  assert.equal(out.journey?.phase, "returning");
  assert.equal(out.journey?.turnaroundKm, half);
  assert.equal(out.splits.filter((s) => s.stationId === "tip").length, 1);
  const turn = out.splits.find((s) => s.stationId === "tip")!;
  assert.ok(turn.at >= points[4].at && turn.at <= points[5].at);
  assert.ok(calculateEta(out, half * 2, "finish", points.at(-1)!.at));
});

test("terrain ETA calibrates effort and accounts for remaining climbs and descents", async () => {
  const { terrainTravelMs, gradeCost } = await import("../shared/terrain");
  const r = race();
  r.distances = [0, 1, 2];
  r.elevationsM = [0, 0, 100];
  r.progressKm = 1;
  r.fix = { lng: 0.01, lat: 0, at: r.startAt + 600000, km: 1 };
  r.track = [{ lng: 0, lat: 0, at: r.startAt, km: 0 }, r.fix];
  assert.ok(terrainTravelMs(r, 2)! > 600000);
  r.elevationsM = [100, 100, 0];
  assert.ok(terrainTravelMs(r, 2)! < 600000);
  r.elevationsM = [0, 0, 0];
  assert.equal(terrainTravelMs(r, 2), 600000);
  assert.ok(gradeCost(-0.4) >= 0.75);
  assert.ok(gradeCost(0.4) > 1);
  r.elevationsM = null;
  assert.equal(terrainTravelMs(r, 2), null);
});

test("feed timing learns ten-minute transmissions, skips early polling and retries missing deliveries", async () => {
  const { feedUpdate } = await import("../shared/polling");
  let r = race();
  const t = r.startAt + 3600000;
  const fixes = [0, 1, 2].map((i) => ({ lng: 0, lat: 0, at: t + i * 600000 }));
  const timing = feedUpdate(r, fixes, t + 1200000, true);
  assert.equal(timing.feedCadenceMs, 600000);
  assert.equal(timing.nextPollAt, t + 1740000);
  assert.equal(timing.nextUpdateExpectedAt, t + 1800000);
  r = { ...r, ...timing };
  const unchanged = feedUpdate(r, fixes, t + 1800000, true);
  assert.equal(unchanged.lastLocationReceivedAt, t + 1200000);
  assert.equal(unchanged.nextPollAt, t + 1860000);
  assert.equal(feedUpdate(r, [], t + 1800000, false).nextPollAt, t + 1860000);
  assert.equal(feedUpdate(r, fixes, t + 3600000, true).nextPollAt, t + 3900000);
});

test("estimated finish requires proximity, progress, grace and a fresh healthy feed", async () => {
  const { inferFinish } = await import("../shared/finish");
  const r = race();
  r.route = [
    [0, 0],
    [0.09, 0],
  ];
  r.distances = [0, 10];
  r.stations = [{ id: "finish", name: "Finish", km: 10 }];
  r.progressKm = 9.5;
  r.fix = { lng: 0.0855, lat: 0, at: r.startAt + 3600000, km: 9.5 };
  r.previousFix = { lng: 0.08, lat: 0, at: r.fix.at - 600000, km: 8.5 };
  r.feedOk = true;
  const eta = calculateEta(r, 10, "finish", r.fix.at)!;
  const now = eta + 1200000;
  r.lastPollAt = now;
  const result = inferFinish(r, now);
  assert.equal(result.status, "complete");
  assert.equal(result.finishSource, "estimated");
  assert.equal(result.finishedAt, eta);
  assert.equal(result.fix, r.fix);
  assert.equal(inferFinish({ ...r, feedOk: false }, now).status, "live");
  for (const invalid of [
    { ...r, lastPollAt: now - 180000 },
    { ...r, progressKm: 8 },
    { ...r, lastFeedPointAt: r.fix.at + 1 },
    { ...r, previousFix: { ...r.previousFix, km: 9.6 } },
    { ...r, outAndBack: true },
  ])
    assert.equal(inferFinish(invalid, now).status, "live");
  assert.equal(inferFinish(r, eta + 1199999).status, "live");
});
