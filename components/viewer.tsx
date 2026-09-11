"use client";
import { useEffect, useState } from "react";
import {
  Route,
  ArrowUpRight,
  Share2,
  Flag,
  Radio,
  Clock,
  Mountain,
  Check,
  WifiOff,
} from "lucide-react";
import RaceMap from "./race-map";
import { Checkbox } from "./ui/checkbox";
import { loadRace, saveRace } from "../lib/offline";
import { subscribe } from "../lib/firebase";
import { demoRace } from "../lib/demo";
import {
  atDistance,
  elapsed,
  speed,
  kmToMiles,
  metersToFeet,
  pacePerMile,
  elevationProgress,
  type Race,
} from "../shared/race";
const time = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export default function Viewer({ id }: { id: string }) {
  const demo = id === "demo";
  const [race, setRace] = useState<Race | null>(null),
    [now, setNow] = useState(Date.now()),
    [connected, setConnected] = useState(false),
    [online, setOnline] = useState(true),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false),
    [estimate, setEstimate] = useState(true);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    if (
      "serviceWorker" in navigator &&
      document.querySelector('script[src*="/assets/"]')
    )
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          const channel = new MessageChannel();
          channel.port1.onmessage = (e) => {
            if (e.data) setOnline(false);
            channel.port1.close();
          };
          reg.active?.postMessage({ type: "OFFLINE_STATE" }, [channel.port2]);
          const urls = performance
            .getEntriesByType("resource")
            .map((r) => r.name);
          reg.active?.postMessage({ type: "CACHE_ASSETS", urls });
        })
        .catch(() => {});
    return () => {
      clearInterval(tick);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (demo) {
      setRace(demoRace());
      setConnected(true);
      return;
    }
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    let receivedLive = false;
    loadRace(id).then(cached => {
      if (!stopped && !receivedLive && cached) setRace(cached);
    }).catch(() => {});
    subscribe(
      id,
      (r) => {
        if (stopped) return;
        receivedLive = true;
        if (!r) {
          setRace(null);
          setError(
            "This race could not be found. Check the complete viewer link.",
          );
          return;
        }
        setRace(r);
        setError("");
        saveRace(r).catch(() => setError("Offline saving is unavailable on this device. Keep this page open to retain the current race."));
      },
      setConnected,
      (e) => setError(e.message),
    )
      .then((stop) => {
        if (stopped) stop();
        else unsubscribe = stop;
      })
      .catch((e) => setError(e.message));
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [id, demo]);
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const control = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "read_race_progress",
          description:
            "Read the currently displayed race, aid station splits and health. Demo data is explicitly marked.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: () => ({ demo, race, connected, online }),
        },
        { signal: control.signal },
      ),
    ).catch(() => {});
    return () => control.abort();
  }, [race, connected, online, demo]);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy the viewer URL from your browser to share this race.");
    }
  };
  if (!race)
    return (
      <main>
        <Header />
        <section className="intro">
          <p className="eyebrow">RACE TRACKER</p>
          <h1>{error ? "Race unavailable" : "Finding your race…"}</h1>
          <p role="status">{error || "Loading the latest trail updates."}</p>
          <a className="textlink" href="/">
            Back to Milemark
          </a>
        </section>
      </main>
    );
  const total = race.distances.at(-1) ?? 0,
    percent = total ? (race.progressKm / total) * 100 : 0,
    pace = speed(race),
    next = race.stations.find(
      (s) => !race.splits.some((p) => p.stationId === s.id),
    );
  const vert = elevationProgress(
    race.distances,
    race.elevationsM,
    race.progressKm,
  );
  const complete = race.status === "complete",
    scheduled = !complete && now < race.startAt;
  const stale = !demo && (!race.heartbeatAt || now - race.heartbeatAt > 750000);
  const healthy = connected && online && !stale && race.feedOk === true;
  const eta = (km: number) =>
    pace > 0 && race.fix
      ? race.fix.at + ((km - race.progressKm) / pace) * 3600000
      : null;
  const estimatedKm =
    estimate && race.fix && !complete && !scheduled && pace > 0
      ? Math.min(
          total - 0.051,
          race.progressKm +
            (pace * Math.min(Math.max(0, now - race.fix.at), 10 * 60000)) /
              3600000,
        )
      : undefined;
  return (
    <main>
      <Header />
      <section className="race-heading">
        <div>
          <div className="heading-meta">
            <span
              className={`badge ${complete ? "finished" : scheduled ? "waiting" : "live"}`}
            >
              {demo
                ? "DEMO RACE"
                : complete
                  ? "FINISHED"
                  : scheduled
                    ? "UPCOMING"
                    : "LIVE RACE"}
            </span>
            <span>
              {new Date(race.startAt).toLocaleDateString([], {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          <h1>{race.name}</h1>
          <p>
            <Mountain size={15} /> {kmToMiles(total).toFixed(1)} mi course{" "}
            <span>·</span> {race.stations.length - 1} aid stations{" "}
            <span>·</span> Self-directed adventure
          </p>
        </div>
        <button className="button" onClick={share}>
          {copied ? <Check size={16} /> : <Share2 size={16} />}{" "}
          {copied ? "Link copied" : "Share race"}
        </button>
      </section>
      {demo && (
        <div className="notice">
          This is a sample course with simulated tracking data.{" "}
          <a href="/setup">Create your own race →</a>
        </div>
      )}
      {race.trackingPaused && !complete && <div className="notice">Tracking paused after 24 hours without a new GPS fix. The organizer can resume tracking from the edit link.</div>}
      {scheduled && (
        <div className="notice">
          Event starting at {new Date(race.startAt).toLocaleString()}. Tracking
          will begin automatically.
        </div>
      )}
      {!online && (
        <div className="notice warning">
          <WifiOff size={17} /> You’re offline. Showing the last saved race
          update.
        </div>
      )}
      {error && (
        <div role="alert" className="notice warning">
          {error}
        </div>
      )}
      <section className="stats">
        <div>
          <span>DISTANCE COVERED</span>
          <strong>
            {kmToMiles(race.progressKm).toFixed(1)}{" "}
            <small>/ {kmToMiles(total).toFixed(1)} mi</small>
          </strong>
          <div className="mini-progress">
            <i style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
        </div>
        <div className="vert-card">
          <span>VERT COMPLETED</span>
          <strong className="vert-stat">
            {vert
              ? Math.round(metersToFeet(vert.completedM)).toLocaleString()
              : "—"}{" "}
            <small>
              {vert
                ? `/ ${Math.round(metersToFeet(vert.totalM)).toLocaleString()} ft`
                : "ft"}
            </small>
          </strong>
          {vert && (
            <div className="mini-progress">
              <i
                style={{
                  width: `${vert.totalM > 0 ? Math.min(100, (vert.completedM / vert.totalM) * 100) : 0}%`,
                }}
              />
            </div>
          )}
          <p>
            {vert
              ? "GPX ascent at confirmed position"
              : "GPX elevation data unavailable"}
          </p>
        </div>
        <div>
          <span>{complete ? "TOTAL TIME" : "ELAPSED TIME"}</span>
          <strong>
            {elapsed(
              (complete ? (race.finishedAt ?? now) : now) - race.startAt,
            )}
          </strong>
          <p>
            {scheduled
              ? "Waiting for the start"
              : complete
                ? "Race archived"
                : "Since the scheduled start"}
          </p>
        </div>
        <div>
          <span>AVERAGE PACE</span>
          <strong>
            {pacePerMile(pace)} <small>min/mi</small>
          </strong>
          <p>Based on confirmed progress</p>
        </div>
        <div>
          <span>{complete ? "FINISHED AT" : "NEXT AID STATION"}</span>
          <strong className="station-stat">
            {complete
              ? race.finishedAt
                ? time(race.finishedAt)
                : "—"
              : (next?.name ?? "Finish line")}
          </strong>
          <p>
            {complete
              ? "Thanks for following along"
              : next
                ? `${kmToMiles(Math.max(0, next.km - race.progressKm)).toFixed(1)} mi to go`
                : "All stations reached"}
          </p>
        </div>
      </section>
      <section className="race-grid">
        <div className="map-panel">
          <div className="panel-heading">
            <h2>
              <Route size={18} /> On the course
            </h2>
            <span className="muted">{Math.round(percent)}% complete</span>
          </div>
          <RaceMap race={race} estimatedKm={estimatedKm} />
          <div className="map-bottom">
            <div>
              <span
                className={`health-dot ${healthy || complete ? "ok" : ""}`}
              />
              <strong>
                {demo
                  ? "Demo feed"
                  : complete
                    ? "Race complete"
                    : scheduled
                      ? "Waiting for start"
                      : !online
                        ? "Offline"
                        : !connected
                          ? "Reconnecting"
                          : stale
                            ? "Waiting for health ping"
                            : race.feedOk
                              ? "Feed healthy"
                              : "Garmin feed unavailable"}
              </strong>
              <span className="muted">
                {race.heartbeatAt
                  ? `Health checked ${time(race.heartbeatAt)}`
                  : "No health ping yet"}
              </span>
            </div>
            <p>
              Last updated at{" "}
              {race.fix
                ? new Date(race.fix.at).toLocaleString()
                : "— awaiting first GPS position"}
            </p>
          </div>
        </div>
        <aside className="station-panel">
          <div className="panel-heading">
            <h2>
              <Flag size={18} /> Aid stations & splits
            </h2>
          </div>
          <div className="station-list">
            <div className="station-row">
              <span className="station-number done">
                <Check size={14} />
              </span>
              <div>
                <h3>Start line</h3>
                <p>0.0 mi</p>
              </div>
              <div className="station-time">
                <strong>{time(race.startAt)}</strong>
                <span>{scheduled ? "Scheduled" : "Start"}</span>
              </div>
            </div>
            {race.stations.map((s, i) => {
              const split = race.splits.find((p) => p.stationId === s.id);
              const arrival = eta(s.km);
              const isNext = next?.id === s.id;
              return (
                <div
                  key={s.id}
                  className={`station-row ${isNext && !complete ? "next" : ""}`}
                >
                  <span className={`station-number ${split ? "done" : ""}`}>
                    {split ? (
                      <Check size={14} />
                    ) : s.id === "finish" ? (
                      <Flag size={14} />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div>
                    <h3>{s.name}</h3>
                    <p>
                      {kmToMiles(s.km).toFixed(1)} mi{" "}
                      {isNext && !complete && <b>NEXT UP</b>}
                    </p>
                    {split && (
                      <p>
                        Split{" "}
                        {elapsed(
                          split.at -
                            (i
                              ? (race.splits.find(
                                  (p) =>
                                    p.stationId === race.stations[i - 1].id,
                                )?.at ?? race.startAt)
                              : race.startAt),
                        )}
                      </p>
                    )}
                  </div>
                  <div className="station-time">
                    <strong>
                      {split
                        ? time(split.at)
                        : !complete && arrival
                          ? time(arrival)
                          : "—"}
                    </strong>
                    <span>
                      {split
                        ? "Est. crossing"
                        : complete
                          ? "Not recorded"
                          : arrival && arrival < now
                            ? `Overdue by ${Math.max(1, Math.floor((now - arrival) / 60000))} min`
                            : "ETA"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="panel-note">
            Crossing times are interpolated between GPS updates. Arrival
            estimates change with pace.
          </p>
        </aside>
      </section>
      <section className="bottom-info">
        <div>
          <Radio size={19} />
          <div>
            <h3>A clear picture between updates</h3>
            <p>
              Garmin sends positions at its configured interval. A separate
              feed health check runs every five minutes.
            </p>
          </div>
        </div>
        <div>
          <label className="estimate-toggle">
            <Checkbox
              checked={estimate}
              onCheckedChange={(v) => setEstimate(v === true)}
            />{" "}
            Show estimated location
          </label>
          <p>Projects average pace for up to 10 minutes. Not a GPS fix.</p>
        </div>
      </section>
      <footer>
        MILEMARK <span>Every mile, together.</span>
      </footer>
    </main>
  );
}
export function Header() {
  return (
    <header className="topbar">
      <a className="brand" href="/">
        <Route size={25} /> MILEMARK <span>RACE TRACKER</span>
      </a>
      <a href="/setup" className="button dark">
        Set up a race <ArrowUpRight size={16} />
      </a>
    </header>
  );
}
