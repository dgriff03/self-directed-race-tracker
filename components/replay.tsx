import { useEffect, useMemo, useRef, useState } from "react";
import { Header } from "./viewer";
import RaceMap from "./race-map";
import { parseGpxWithElevation } from "../lib/gpx";
import { parseReplayKml } from "../lib/parse-replay-kml";
import { ReplayEngine } from "../lib/replay";
import {
  validOutAndBack,
  completedDistance,
  plannedDistance,
  journeyElevation,
  journeyMessage,
  stationSkipped,
  stationDistance,
  stationVisits,
  cumulative,
  kmToMiles,
  milesToKm,
  metersToFeet,
  elevationProgress,
  elapsed,
  calculateEta,
  paceEstimate,
  stationDwellStatus,
  type Fix,
  type Station,
  type Race,
} from "../shared/race";
const stamp = (n: number) => new Date(n).toLocaleString();
const localDate = (n: number) =>
  new Date(n - new Date(n).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
export default function Replay() {
  const [outAndBack, setOutAndBack] = useState(false);
  const [course, setCourse] = useState<ReturnType<
    typeof parseGpxWithElevation
  > | null>(null);
  const [points, setPoints] = useState<Fix[]>([]),
    [stations, setStations] = useState<Station[]>([]);
  const [gpxName, setGpxName] = useState(""),
    [kmlName, setKmlName] = useState("");
  const [error, setError] = useState(""),
    [playing, setPlaying] = useState(false),
    [rate, setRate] = useState(60),
    [cursor, setActualCursor] = useState(0),
    [start, setStart] = useState(0);
  const [stationName, setStationName] = useState(""),
    [stationMiles, setStationMiles] = useState("");
  const uploads = useRef({ gpx: 0, kml: 0 });
  const [scrubCursor, setScrubCursor] = useState<number | null>(null);
  const setCursor = (value: number | ((t: number) => number)) => {
    setScrubCursor(null);
    setActualCursor(value);
  };
  useEffect(() => {
    if (scrubCursor === null) return;
    const timer = setTimeout(() => {
      setActualCursor(scrubCursor);
      setScrubCursor(null);
    }, 150);
    return () => clearTimeout(timer);
  }, [scrubCursor]);
  const [readingKml, setReadingKml] = useState(false);
  const uploadController = useRef<AbortController | null>(null);
  useEffect(() => () => uploadController.current?.abort(), []);

  const ds = useMemo(() => (course ? cumulative(course.route) : []), [course]);
  const total = ds.at(-1) ?? 0;
  const initial = useMemo<Race | null>(
    () =>
      course && points.length
        ? {
            outAndBack,
            id: "replay",
            name: gpxName.replace(/\.gpx$/i, ""),
            startAt: start,
            route: course.route,
            elevationsM: course.elevationsM,
            distances: ds,
            stations: stationVisits(
              [...stations, { id: "finish", name: "Finish line", km: total }],
              ds,
              outAndBack,
            ),
            status: "live",
            progressKm: 0,
            fix: null,
            previousFix: null,
            splits: [],
            track: [],
            heartbeatAt: null,
            feedOk: null,
            finishedAt: null,
            revision: 1,
          }
        : null,
    [course, points, start, ds, stations, total, gpxName, outAndBack],
  );
  const engine = useMemo(
    () => (initial ? new ReplayEngine(initial, points) : null),
    [initial, points],
  );
  const first = points[0]?.at ?? 0,
    last = points.at(-1)?.at ?? 0;
  const lower = first ? Math.min(first, start) - 1000 : 0;
  const race = useMemo(() => engine?.seek(cursor) ?? null, [engine, cursor]);
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        delta = (now - previous) * rate;
      previous = now;
      setCursor((t) => Math.min(last, t + delta));
    }, 100);
    return () => clearInterval(timer);
  }, [playing, rate, last]);
  useEffect(() => {
    if (cursor >= last) setPlaying(false);
  }, [cursor, last]);
  async function upload(kind: "gpx" | "kml", file?: File) {
    if (!file) return;
    const version = ++uploads.current[kind];
    let controller: AbortController | undefined;
    if (kind === "kml") {
      uploadController.current?.abort();
      controller = new AbortController();
      uploadController.current = controller;
      setReadingKml(true);
    }
    setPlaying(false);
    setError("");
    try {
      if (file.size > (kind === "gpx" ? 10_000_000 : 25_000_000))
        throw Error(
          `${kind.toUpperCase()} file is too large (limit ${kind === "gpx" ? 10 : 25} MB).`,
        );
      const text = await file.text();
      if (version !== uploads.current[kind]) return;
      if (kind === "gpx") {
        const parsed = parseGpxWithElevation(text);
        setCourse(parsed);
        setOutAndBack(false);
        setGpxName(file.name);
        setStations([]);
        setCursor(lower);
      } else {
        const parsed = await parseReplayKml(text, controller!.signal);
        if (version !== uploads.current[kind]) return;
        setPoints(parsed);
        setKmlName(file.name);
        setStart(parsed[0].at);
        setCursor(parsed[0].at - 1000);
      }
    } catch (e) {
      if (version === uploads.current[kind])
        setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      if (kind === "kml" && version === uploads.current[kind])
        setReadingKml(false);
    }
  }
  const dwell = race ? stationDwellStatus(race, cursor) : null,
    pace = race ? paceEstimate(race) : null;
  const vert = race ? journeyElevation(race) : null;
  return (
    <main>
      <Header />
      <section className="intro">
        <p className="eyebrow">LOCAL PLAYBACK</p>
        <h1>Replay a race</h1>
        <p>
          Load a GPX route and Garmin KML recording, then scrub through time.
          Files stay in this browser session; no race is created and Garmin is
          not polled. Basemap tiles still load over the network.
        </p>
      </section>
      <section className="replay-controls form-card">
        {readingKml && (
          <p role="status">
            Reading KML recording… You can replace the file to cancel.
          </p>
        )}
        {course && (
          <label className="direction-choice">
            <input
              type="checkbox"
              checked={outAndBack}
              onChange={(e) => {
                if (e.target.checked && !validOutAndBack(course.route)) {
                  setError(
                    "Out-and-back mode needs a full GPX returning on the same trail, with the turnaround at half the mileage.",
                  );
                  return;
                }
                setOutAndBack(e.target.checked);
                setPlaying(false);
                setCursor(lower);
                setError("");
              }}
            />{" "}
            Out-and-back · detect early turnaround
          </label>
        )}

        <div className="replay-uploads">
          <label>
            GPX route
            <input
              type="file"
              accept=".gpx,application/gpx+xml"
              onChange={(e) => void upload("gpx", e.target.files?.[0])}
            />
            <small>{gpxName || "Up to 10 MB"}</small>
          </label>
          <label>
            KML GPS recording
            <input
              type="file"
              accept=".kml,.klm,application/vnd.google-earth.kml+xml"
              onChange={(e) => void upload("kml", e.target.files?.[0])}
            />
            <small>
              {kmlName ||
                "Up to 25 MB · 100,000 positions · timestamps required"}
            </small>
          </label>
        </div>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {points.length > 0 && (
          <p>
            {points.length.toLocaleString()} recorded positions · {stamp(first)}{" "}
            — {stamp(last)}
          </p>
        )}
        {race && (
          <>
            <label>
              Race start time
              <input
                type="datetime-local"
                step="1"
                value={localDate(start)}
                onChange={(e) => {
                  const n = new Date(e.target.value).getTime();
                  if (Number.isFinite(n) && n <= last) {
                    setStart(n);
                    setCursor(Math.min(n, first) - 1000);
                    setPlaying(false);
                  }
                }}
              />
              <small>
                Defaults to the first GPS timestamp. Set an earlier start if the
                recording begins partway into the race.
              </small>
            </label>
            <div className="replay-actions">
              <button
                className="button dark"
                onClick={() => {
                  if (!playing && scrubCursor !== null) setCursor(scrubCursor);
                  else if (!playing && cursor >= last) setCursor(lower);
                  setPlaying(!playing);
                }}
              >
                {playing ? "Pause" : "Play"}
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  setPlaying(false);
                  setCursor(lower);
                }}
              >
                Restart
              </button>
              <label>
                Playback speed
                <select
                  value={rate}
                  onChange={(e) => setRate(Number(e.target.value))}
                >
                  {[1, 10, 60, 300, 600].map((n) => (
                    <option key={n} value={n}>
                      {n}×
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="replay-timeline">
              Replay time T
              <output>
                {stamp(scrubCursor ?? cursor)} · elapsed{" "}
                {elapsed((scrubCursor ?? cursor) - start)}
                {scrubCursor !== null ? " · Seeking…" : ""}
              </output>
              <input
                aria-label="Replay time T"
                type="range"
                min={lower}
                max={last}
                step="1"
                value={scrubCursor ?? cursor}
                onPointerUp={() => {
                  if (scrubCursor !== null) setCursor(scrubCursor);
                }}
                onKeyUp={() => {
                  if (scrubCursor !== null) setCursor(scrubCursor);
                }}
                onChange={(e) => {
                  setPlaying(false);
                  setScrubCursor(Number(e.target.value));
                }}
              />
            </label>
            <div className="replay-ends">
              <span>{stamp(lower)}</span>
              <span>{stamp(last)}</span>
            </div>
            <section className="replay-stations">
              <h2>Add aid stations</h2>
              <p>
                Enter a station name and its distance in miles, then click Add
                station. You can also click the route on the map below to fill
                in the distance. The finish line is included automatically.
              </p>
              <div className="replay-uploads">
                <label>
                  Station name
                  <input
                    value={stationName}
                    onChange={(e) => setStationName(e.target.value)}
                  />
                </label>
                <label>
                  Station distance (mi)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={stationMiles}
                    onChange={(e) => setStationMiles(e.target.value)}
                  />
                </label>
              </div>
              <button
                className="button secondary"
                onClick={() => {
                  const km = milesToKm(Number(stationMiles));
                  if (!stationName.trim() || !(km > 0 && km < total)) {
                    setError(
                      "Enter a station name and a distance within the course.",
                    );
                    return;
                  }
                  setStations(
                    [
                      ...stations,
                      { id: crypto.randomUUID(), name: stationName.trim(), km },
                    ].sort((a, b) => a.km - b.km),
                  );
                  setStationName("");
                  setStationMiles("");
                  setError("");
                  setPlaying(false);
                }}
              >
                Add station
              </button>
              {stations.map((s) => (
                <p key={s.id}>
                  {s.name} ·{" "}
                  {kmToMiles(race ? stationDistance(race, s.km) : s.km).toFixed(
                    2,
                  )}{" "}
                  mi{" "}
                  <button
                    className="textlink"
                    onClick={() => {
                      setStations(stations.filter((t) => t.id !== s.id));
                      setPlaying(false);
                    }}
                    aria-label={`Remove ${s.name}`}
                  >
                    Remove
                  </button>
                </p>
              ))}
            </section>
          </>
        )}
      </section>
      {race && (
        <section className="replay-results">
          {outAndBack && <p role="status">{journeyMessage(race)}</p>}
          <div className="replay-stats">
            <div>
              <small>CONFIRMED DISTANCE</small>
              <strong>
                {kmToMiles(completedDistance(race)).toFixed(2)} /{" "}
                {kmToMiles(plannedDistance(race)).toFixed(2)} mi
              </strong>
            </div>
            <div>
              <small>VERT COMPLETED</small>
              <strong>
                {vert
                  ? `${Math.round(metersToFeet(vert.completedM))} / ${Math.round(metersToFeet(vert.totalM))} ft`
                  : "No elevation profile"}
              </strong>
            </div>
            <div>
              <small>REPLAY STATUS</small>
              <strong>
                {cursor < start
                  ? "Before start"
                  : race.status === "complete"
                    ? "Finished"
                    : race.fix
                      ? "Tracking"
                      : "Awaiting accepted GPS"}
              </strong>
            </div>
          </div>
          <p role="status">
            Last accepted GPS: {race.fix ? stamp(race.fix.at) : "None yet"}.{" "}
            {race.pendingFix
              ? "A possible jump is awaiting confirmation. "
              : ""}
            Seeking backward rebuilds progress and splits. Off-route, duplicate,
            pre-start, and implausible points follow the live race filters.
          </p>
          <RaceMap
            race={race}
            onPick={(km) => setStationMiles(kmToMiles(km).toFixed(2))}
          />
          <div className="form-card replay-splits">
            <h2>Aid stations &amp; splits</h2>
            {race.stations.map((s) => {
              const split = race.splits.find((p) => p.stationId === s.id),
                eta = calculateEta(race, s.km, s.id, cursor, {
                  dwell: dwell!,
                  pace: pace!,
                });
              return (
                <div className="replay-split" key={s.id}>
                  <span>
                    <b>{s.name}</b>
                    <small>
                      {kmToMiles(
                        race ? stationDistance(race, s.km) : s.km,
                      ).toFixed(2)}{" "}
                      mi
                    </small>
                  </span>
                  <span>
                    {split ? (
                      <>
                        <b>{stamp(split.at)}</b>
                        <small>
                          Estimated crossing · {elapsed(split.at - start)} from
                          start
                        </small>
                      </>
                    ) : (
                      <>
                        <b>{eta ? stamp(eta) : "—"}</b>
                        <small>
                          {stationSkipped(race, s.id)
                            ? "Skipped · early return"
                            : race.status === "complete"
                              ? "Not recorded"
                              : eta
                                ? "ETA"
                                : "Awaiting GPS"}
                        </small>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {!race && (
        <section className="replay-empty">
          <h2>Bring your route and recording</h2>
          <p>
            Upload both files above to see the course and start playback.
            Reloading clears the files.
          </p>
        </section>
      )}
    </main>
  );
}
