import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyFixes,
  cumulative,
  project,
  atDistance,
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
  assert.equal(validateFeed("https://share.garmin.com/Runner").pathname, "/Feed/Share/Runner");
  assert.throws(() => validateFeed("https://share.garmin.com.evil.example/Runner"));
});
test("Garmin Time UTC is independent of the process timezone", () => {
  const old = process.env.TZ;
  process.env.TZ = "America/Denver";
  try {
    const fixes = parseKml('<kml><Placemark><ExtendedData><Data name="Time UTC"><value>9/11/2026 4:00:00 PM</value></Data></ExtendedData><Point><coordinates>-105,40</coordinates></Point></Placemark></kml>');
    assert.equal(fixes[0].at, Date.parse("2026-09-11T16:00:00Z"));
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});
