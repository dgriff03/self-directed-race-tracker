"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Upload,
  Plus,
  Trash2,
  Flag,
  Copy,
  ExternalLink,
  MapPin,
  Check,
  LockKeyhole,
} from "lucide-react";
import { Header } from "./viewer";
import RaceMap from "./race-map";
import { api, subscribe } from "../lib/firebase";
import { parseGpxWithElevation } from "../lib/gpx";
import {
  validOutAndBack,
  journeyMessage,
  stationVisits,
  cumulative,
  kmToMiles,
  milesToKm,
  metersToFeet,
  elevationProgress,
  type Coordinate,
  type Race,
  type Station,
} from "../shared/race";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";
const localDate = (n: number) => {
  const d = new Date(n);
  return new Date(n - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export default function Editor({ token }: { token?: string }) {
  const [outAndBack, setOutAndBack] = useState(false);
  const [health, setHealth] = useState<Race | null>(null);
  const [diagnostic, setDiagnostic] = useState("");
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState(""),
    [start, setStart] = useState(""),
    [feed, setFeed] = useState(""),
    [route, setRoute] = useState<Coordinate[]>([]),
    [elevationsM, setElevationsM] = useState<number[] | null>(null),
    [stations, setStations] = useState<Station[]>([]),
    [saved, setSaved] = useState<Race | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!!token),
    [fileName, setFileName] = useState(""),
    [stationName, setStationName] = useState(""),
    [stationKm, setStationKm] = useState(""),
    [copied, setCopied] = useState("");
  useEffect(() => {
    if (!token) return;
    api("/edit", "GET", undefined, token)
      .then(({ race }) => {
        setSaved(race);
        setName(race.name);
        setOutAndBack(!!race.outAndBack);
        setStart(localDate(race.startAt));
        setRoute(race.route);
        setElevationsM(race.elevationsM ?? null);
        setStations(
          race.stations.filter(
            (s: Station) => s.id !== "finish" && !s.returnOf,
          ),
        );
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);
  useEffect(() => {
    if (!saved?.id) return;
    let stopped = false;
    let cleanup: (() => void) | undefined;
    subscribe(
      saved.id,
      (r) => {
        if (!stopped) setHealth(r);
      },
      () => {},
      () => {},
    )
      .then((stop) => {
        if (stopped) stop();
        else cleanup = stop;
      })
      .catch(() => {});
    return () => {
      stopped = true;
      cleanup?.();
    };
  }, [saved?.id]);
  const testFeed = async () => {
    if (!token) return;
    setTesting(true);
    try {
      const result = await api("/edit", "POST", { action: "testFeed" }, token);
      setDiagnostic(
        result.ok
          ? `Feed reachable. ${result.pointCount} timestamped points${result.latestAt ? `; latest ${new Date(result.latestAt).toLocaleString()}` : "; no positions in the requested time range"}.`
          : result.message,
      );
    } catch (e) {
      setDiagnostic(e instanceof Error ? e.message : "Feed test failed.");
    } finally {
      setTesting(false);
    }
  };
  const ds = useMemo(() => cumulative(route), [route]),
    total = ds.at(-1) ?? 0,
    locked =
      !!(health?.fix ?? saved?.fix) ||
      (health?.status ?? saved?.status) === "complete";
  const preview: Race = {
    id: "preview",
    name,
    startAt: new Date(start).getTime() || Date.now(),
    route,
    distances: ds,
    elevationsM,
    stations: stationVisits(
      [...stations, { id: "finish", name: "Finish line", km: total }],
      ds,
      outAndBack,
    ),
    outAndBack,
    status: "scheduled",
    progressKm: 0,
    fix: null,
    previousFix: null,
    splits: [],
    track: [],
    heartbeatAt: null,
    feedOk: null,
    finishedAt: null,
    revision: saved?.revision ?? 0,
  };
  const addStation = () => {
    const km = milesToKm(Number(stationKm));
    if (!stationName.trim() || !Number.isFinite(km) || km <= 0 || km >= total) {
      setError(
        "Enter a station name and a distance between the start and finish.",
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
    setStationKm("");
    setError("");
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!route.length) {
      setError("Upload a GPX route first.");
      return;
    }
    setBusy(true);
    try {
      if (outAndBack && !validOutAndBack(route))
        throw Error(
          "Out-and-back mode needs a full route that returns along the same trail, with the turnaround at half the mileage.",
        );
      const body = {
        outAndBack,
        name,
        startAt: locked && saved ? saved.startAt : new Date(start).getTime(),
        route,
        elevationsM,
        stations,
        ...(feed ? { feedUrl: feed } : {}),
        ...(saved ? { revision: saved.revision } : {}),
      };
      if (token) {
        const data = await api("/edit", "PUT", body, token);
        setSaved(data.race);
        setFeed("");
        setMessage(
          "Race saved. Viewers will receive the update automatically.",
        );
      } else {
        const data = await api("/races", "POST", body);
        window.location.assign(`/edit/${data.editToken}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api("/edit", "POST", { action: "resume" }, token);
      const { race } = await api("/edit", "GET", undefined, token);
      setSaved(race);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resume tracking.");
    } finally {
      setBusy(false);
    }
  };
  const complete = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/edit", "POST", { action: "complete" }, token);
      const { race } = await api("/edit", "GET", undefined, token);
      setSaved(race);
      setMessage(
        "Race complete. Feed checks have stopped and the viewer link is archived.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (kind: string) => {
    try {
      await navigator.clipboard.writeText(
        kind === "edit"
          ? window.location.href
          : `${window.location.origin}/r/${saved?.id}`,
      );
      setCopied(kind);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setError("Copy the link from the field below.");
    }
  };
  return (
    <main>
      <Header />
      <section className="intro editor-intro">
        <p className="eyebrow">{token ? "RACE CONTROL" : "MAKE IT YOUR OWN"}</p>
        <h1>
          {token
            ? "Your race, ready to follow."
            : "Plan the route. Bring your crew."}
        </h1>
        <p>
          {token
            ? "Keep this edit link private. Anyone with it can manage your race."
            : "A GPX route and your Garmin feed are all you need to get started."}
        </p>
      </section>
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          <Check size={17} />
          {message}
        </div>
      )}
      {loading ? (
        <div className="notice">Loading race settings…</div>
      ) : token && !saved ? (
        <div className="notice">
          Use the original private edit link to open this race.
        </div>
      ) : (
        <>
          <form className="editor-grid" onSubmit={save}>
            <div className="editor-fields">
              <section className="form-card">
                <div className="form-title">
                  <span>01</span>
                  <h2>The essentials</h2>
                </div>
                <label>
                  Race name
                  <input
                    required
                    maxLength={100}
                    placeholder="e.g. Boulder Foothills Loop"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Start date & time
                  <input
                    required
                    type="datetime-local"
                    value={start}
                    disabled={locked}
                    onChange={(e) => setStart(e.target.value)}
                  />
                  <small>
                    In your local timezone:{" "}
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}. Leaving
                    early? GPS positions are accepted up to one hour before this
                    time. Leaving the start area starts the clock, using the
                    last GPS position within 50 meters of the start.
                  </small>
                </label>
                <label>
                  Garmin KML feed URL{" "}
                  <span className="private-label">
                    <LockKeyhole size={12} /> PRIVATE
                  </span>
                  <input
                    type="url"
                    required={!token}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      token
                        ? "Connected · enter a new URL to replace"
                        : "https://share.garmin.com/Feed/Share/…"
                    }
                    value={feed}
                    onChange={(e) => setFeed(e.target.value)}
                  />
                  <small>
                    Paste your Garmin MapShare link or KML feed. Viewers never
                    receive this link. Use a feed for one runner, without a
                    password. Garmin MapShare is public separately; someone who
                    knows your share name may find it outside Milemark.
                  </small>
                </label>
                <label className="direction-choice">
                  <input
                    type="checkbox"
                    checked={outAndBack}
                    disabled={locked}
                    onChange={(e) => setOutAndBack(e.target.checked)}
                  />{" "}
                  Out-and-back · detect early turnaround
                </label>
                <small>
                  Use a full GPX returning on the same trail, with the planned
                  turnaround at half the mileage. Set this before tracking
                  begins.
                </small>
                {saved?.outAndBack && (
                  <div className="notice">
                    <p>{journeyMessage(health ?? saved)}</p>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={
                        busy ||
                        !(health ?? saved).fix ||
                        (health ?? saved).status === "complete"
                      }
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        try {
                          const result = await api(
                            "/edit",
                            "POST",
                            {
                              action:
                                (health ?? saved).journey?.phase === "returning"
                                  ? "resumeOutbound"
                                  : "turnaround",
                            },
                            token,
                          );
                          setSaved(result.race);
                          setHealth(result.race);
                          setMessage("Direction updated for viewers.");
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Could not update direction.",
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {(health ?? saved).journey?.phase === "returning"
                        ? "Resume original route"
                        : "We’ve turned around"}
                    </button>
                  </div>
                )}
                {saved && (
                  <div className="feed-diagnostics" aria-live="polite">
                    <p>
                      {health?.trackingPaused
                        ? "Tracking paused"
                        : health?.feedOk === true
                          ? "Last poll: feed healthy"
                          : health?.feedOk === false
                            ? "Last poll: Garmin unavailable"
                            : "Waiting for the first scheduled poll"}
                    </p>
                    <small>
                      {health?.heartbeatAt
                        ? `Health checked ${new Date(health.heartbeatAt).toLocaleString()}`
                        : "No health check yet"}
                    </small>
                    <p>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={
                          testing ||
                          busy ||
                          !!feed ||
                          saved.status === "complete"
                        }
                        onClick={testFeed}
                      >
                        {testing ? "Testing…" : "Test saved Garmin feed"}
                      </button>
                    </p>
                    {feed && (
                      <small>
                        Save the replacement URL before testing it. Saving also
                        resumes paused tracking.
                      </small>
                    )}
                    {diagnostic && <p>{diagnostic}</p>}
                  </div>
                )}
              </section>
              <section className="form-card">
                <div className="form-title">
                  <span>02</span>
                  <h2>Your course</h2>
                </div>
                <label className="upload-zone">
                  <Upload size={26} />
                  <strong>
                    {fileName ||
                      (route.length
                        ? locked
                          ? "Upload GPX elevation profile"
                          : "Replace GPX route"
                        : "Upload a GPX file")}
                  </strong>
                  <span>
                    {route.length
                      ? `${kmToMiles(total).toFixed(2)} mi · ${route.length.toLocaleString()} route points`
                      : "Choose a file · up to 10 MB and automatically simplified"}
                  </span>
                  <input
                    disabled={saved?.status === "complete"}
                    type="file"
                    accept=".gpx,application/gpx+xml"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        if (file.size > 10_000_000)
                          throw Error("Choose a GPX smaller than 10 MB.");
                        const parsed = parseGpxWithElevation(await file.text());
                        const sameRoute =
                          JSON.stringify(parsed.route) ===
                          JSON.stringify(route);
                        if (locked && !sameRoute)
                          throw Error(
                            "Use the same route to add elevation data after tracking starts.",
                          );
                        setRoute(parsed.route);
                        setElevationsM(parsed.elevationsM);
                        if (!sameRoute) setStations([]);
                        setFileName(file.name);
                        setError("");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
                {route.length > 0 && (
                  <p className="field-note">
                    {elevationsM
                      ? `${Math.round(metersToFeet(elevationProgress(ds, elevationsM, 0)!.totalM)).toLocaleString()} ft total elevation gain · from GPX`
                      : "Elevation data unavailable. Upload a GPX with elevations to show vertical progress."}
                  </p>
                )}
                {locked && (
                  <p className="field-note">
                    The route, start time, and stations are locked because
                    tracking has started or the race is complete. During
                    tracking, you can upload the same route with elevations to
                    add vertical progress.
                  </p>
                )}
              </section>
              <section className="form-card">
                <div className="form-title">
                  <span>03</span>
                  <h2>Aid stations</h2>
                </div>
                <p className="field-note">
                  Click the route to choose a distance, or enter it below. For
                  loops, use the distance of that particular visit.
                </p>
                {outAndBack && (
                  <p className="field-note">
                    Return visits are automatic, except within 0.09 mi of the
                    midpoint. Edit the outbound station to update both visits.
                  </p>
                )}
                {stations.map((s) => (
                  <div className="edit-station" key={s.id}>
                    <MapPin size={17} />
                    <div>
                      <strong>{s.name}</strong>
                      <span>
                        {kmToMiles(s.km).toFixed(2)} mi from start
                        {preview.stations.find((v) => v.returnOf === s.id)
                          ? ` · return at ${kmToMiles(total - s.km).toFixed(2)} mi`
                          : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Remove ${s.name}`}
                      disabled={locked}
                      onClick={() =>
                        setStations(stations.filter((p) => p.id !== s.id))
                      }
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                ))}
                {!locked && (
                  <>
                    <div className="station-inputs">
                      <label>
                        Name
                        <input
                          maxLength={80}
                          placeholder="Joder Aid"
                          value={stationName}
                          onChange={(e) => setStationName(e.target.value)}
                        />
                      </label>
                      <label>
                        Distance (mi)
                        <input
                          type="number"
                          min="0"
                          max={kmToMiles(total)}
                          step="0.01"
                          placeholder="8.50"
                          value={stationKm}
                          onChange={(e) => setStationKm(e.target.value)}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className="button"
                      disabled={!route.length || stations.length >= 50}
                      onClick={addStation}
                    >
                      <Plus size={16} /> Add aid station
                    </button>
                  </>
                )}
                <div className="finish-note">
                  <Flag size={16} />
                  <span>
                    Finish line is added automatically at{" "}
                    {kmToMiles(total).toFixed(2)} mi.
                  </span>
                </div>
              </section>
              <button
                type="submit"
                disabled={busy || saved?.status === "complete"}
                className="button orange save-button"
              >
                {busy
                  ? "Saving…"
                  : token
                    ? "Save changes"
                    : "Create race & private links"}
              </button>
            </div>
            <aside className="editor-preview">
              <div className="form-card preview-card">
                <div className="panel-heading">
                  <h2>
                    <MapPin size={18} /> Course preview
                  </h2>
                  <span className="muted">
                    {kmToMiles(total).toFixed(1)} mi
                  </span>
                </div>
                {route.length ? (
                  <RaceMap
                    race={preview}
                    onPick={
                      locked
                        ? undefined
                        : (km) => setStationKm(kmToMiles(km).toFixed(2))
                    }
                  />
                ) : (
                  <div className="empty-map">
                    <MapPin size={38} />
                    <h3>Your course starts here</h3>
                    <p>
                      Upload a GPX file to see the route and place aid stations.
                    </p>
                  </div>
                )}
                <p className="panel-note">
                  Your crew sees this route, your latest position, and arrival
                  estimates for each stop.
                </p>
              </div>
              {saved && (
                <div className="form-card links-card">
                  <h2>Race links</h2>
                  <label>
                    Viewer link
                    <div className="link-field">
                      <input
                        readOnly
                        value={`${typeof window !== "undefined" ? window.location.origin : ""}/r/${saved.id}`}
                      />
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => copy("viewer")}
                        aria-label="Copy viewer link"
                      >
                        {copied === "viewer" ? (
                          <Check size={17} />
                        ) : (
                          <Copy size={17} />
                        )}
                      </button>
                    </div>
                  </label>
                  <a
                    className="button"
                    href={`/r/${saved.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open live viewer <ExternalLink size={15} />
                  </a>
                  <label>
                    Private edit link
                    <div className="link-field">
                      <input
                        readOnly
                        value={
                          typeof window !== "undefined"
                            ? window.location.href
                            : ""
                        }
                      />
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => copy("edit")}
                        aria-label="Copy edit link"
                      >
                        {copied === "edit" ? (
                          <Check size={17} />
                        ) : (
                          <Copy size={17} />
                        )}
                      </button>
                    </div>
                    <small>
                      Save this link somewhere safe. There is no login or link
                      recovery.
                    </small>
                  </label>
                  {saved.trackingPaused && saved.status !== "complete" && (
                    <button
                      type="button"
                      className="button primary"
                      disabled={busy}
                      onClick={resume}
                    >
                      Resume Garmin tracking
                    </button>
                  )}
                  {saved.status !== "complete" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          className="button end-button"
                          disabled={busy}
                        >
                          Mark race complete
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="confirm-dialog">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Finish this race?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This stops Garmin feed checks permanently. Recorded
                            splits stay available at the viewer link. Unreached
                            stations will remain unrecorded.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="button">
                            Keep tracking
                          </AlertDialogCancel>
                          <AlertDialogAction
                            className="button orange"
                            onClick={complete}
                          >
                            Finish race
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <p className="field-note">
                      Race complete · the viewer link is now a permanent
                      archive.
                    </p>
                  )}
                </div>
              )}
            </aside>
          </form>
        </>
      )}
      <footer>
        MILEMARK <span>Your adventure. Shared.</span>
      </footer>
    </main>
  );
}
