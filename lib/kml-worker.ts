import { parseKml } from "../shared/kml";
self.onmessage = (event: MessageEvent<string>) => {
  try {
    const points = parseKml(event.data, 25_000_000);
    if (!points.length)
      throw Error(
        "This KML has no timestamped GPS positions. Use Garmin KML with timestamps or a gx:Track.",
      );
    if (points.length > 100000)
      throw Error("Use a KML file with at most 100,000 positions.");
    self.postMessage({ points });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Could not parse KML.",
    });
  }
};
