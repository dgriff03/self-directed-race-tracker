import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFixes,
  cumulative,
  project,
  atDistance,
  speed,
  rollingSpeed,
  stationDwellStatus,
  calculateEta,
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
