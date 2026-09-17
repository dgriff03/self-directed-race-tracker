import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const gpx = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
<wpt lat="40" lon="-105"><name>Start waypoint</name></wpt>
<wpt lat="40.0001" lon="-104.99"><name>Creek aid</name></wpt>
<wpt lon="-104.98" lat="40"><name>Summit aid</name></wpt>
<wpt lat="40" lon="-104.98"><name>Summit aid</name></wpt>
<wpt lat="40" lon="-104.97"><name>Finish waypoint</name></wpt>
<wpt lat="bad" lon="-104.99"><name>Invalid waypoint</name></wpt>
<trk><trkseg><trkpt lat="40" lon="-105"/><trkpt lat="40" lon="-104.99"/><trkpt lat="40" lon="-104.98"/><trkpt lat="40" lon="-104.97"/></trkseg></trk></gpx>`;
try {
  const p = await browser.newPage();
  for (const path of ["/setup", "/replay"]) {
    await p.goto("http://127.0.0.1:4173" + path);
    const upload = p.locator('input[type=file][accept*="gpx"]');
    await upload.setInputFiles({
      name: "waypoints.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from(gpx),
    });
    if (path === "/replay") {
      await p
        .locator('input[type=file][accept*="kml"]')
        .setInputFiles({
          name: "recording.kml",
          mimeType: "application/xml",
          buffer: Buffer.from(
            "<kml><Placemark><TimeStamp><when>2026-09-17T14:00:00Z</when></TimeStamp><Point><coordinates>-105,40</coordinates></Point></Placemark><Placemark><TimeStamp><when>2026-09-17T14:10:00Z</when></TimeStamp><Point><coordinates>-104.99,40</coordinates></Point></Placemark></kml>",
          ),
        });
    }
    await expect(
      p.getByRole("button", { name: "Remove Creek aid", exact: true }),
    ).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Remove Summit aid", exact: true }),
    ).toHaveCount(1);
    await expect(
      p.getByRole("button", {
        name: /Remove (Start waypoint|Finish waypoint|Invalid waypoint)/,
      }),
    ).toHaveCount(0);
    if (path === "/setup") {
      await upload.setInputFiles({
        name: "waypoints.gpx",
        mimeType: "application/gpx+xml",
        buffer: Buffer.from(gpx),
      });
      await expect(
        p.getByRole("button", { name: "Remove Creek aid", exact: true }),
      ).toHaveCount(1);
    }
  }
  console.log(
    "PASS GPX waypoint import: setup/replay, namespaces, off-track snapping, duplicates, endpoint exclusion, invalid coordinates, repeat upload",
  );
} finally {
  await browser.close();
}
