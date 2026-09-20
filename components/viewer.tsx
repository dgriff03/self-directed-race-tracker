import StationDirections from "./station-directions";
import { raceTime, raceTimeZone } from "../shared/time";
("use client");
import { useEffect, useMemo, useState } from "react";
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
import { api, subscribe, normalize } from "../lib/firebase";
import { demoRace } from "../lib/demo";
import {
  activeCrewDeparture,
  completedDistance,
  raceStart,
  plannedDistance,
  journeyElevation,
  journeyMessage,
  stationSkipped,
  stationDistance,
  elapsed,
  speed,
  paceEstimate,
  stationDwellStatus,
  calculateEta,
  kmToMiles,
  metersToFeet,
  pacePerMile,
  elevationProgress,
  type Race,
} from "../shared/race";
export default function Viewer({ id }: { id: string }) {
  const demo = id === "demo";
  const [reportingDeparture, setReportingDeparture] = useState(false);
  const [departureError, setDepartureError] = useState("");
  const [smsCopied, setSmsCopied] = useState(false);
  const smsNumber = import.meta.env.VITE_SMS_NUMBER as string | undefined;
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
    loadRace(id)
      .catch(() => null)
      .then((cached) => {
        if (stopped) return;
        if (cached) setRace(normalize(cached));
        subscribe(
          id,
          (r) => {
            if (stopped) return;
            if (!r) {
              setRace(null);
              setError(
                "This race could not be found. Check the complete viewer link.",
              );
              return;
            }
            setRace(r);
            setError("");
            saveRace(r, id).catch(() =>
              setError(
                "Offline saving is unavailable on this device. Keep this page open to retain the current race.",
              ),
            );
          },
          setConnected,
          (e) => {
            if (!stopped) setError(e.message);
          },
          cached?.id,
        )
          .then((stop) => {
            if (stopped) stop();
            else unsubscribe = stop;
          })
          .catch((e) => {
            if (!stopped) setError(e.message);
          });
      });
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
      await navigator.clipboard.writeText(
        `${window.location.origin}/r/${race?.slug ?? race?.id ?? id}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy the viewer URL from your browser to share this race.");
    }
  };
  const etaBase = useMemo(
    () =>
      race
        ? {
            pace: paceEstimate(race),
            dwell: stationDwellStatus(race, race.fix?.at ?? 0),
          }
        : null,
    [race],
  );
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
  const time = (at: number) => raceTime(race, at);
  const total = race.distances.at(-1) ?? 0,
    percent = plannedDistance(race)
      ? (completedDistance(race) / plannedDistance(race)) * 100
      : 0,
    overallSpeed = speed(race),
    rolling = etaBase!.pace.kmh,
    dwell = {
      ...etaBase!.dwell,
      dwellMs:
        etaBase!.dwell.arrivalAt === undefined
          ? 0
          : Math.max(0, now - etaBase!.dwell.arrivalAt),
    },
    next = race.stations.find(
      (s) =>
        !stationSkipped(race, s.id) &&
        s.km > race.progressKm &&
        !race.splits.some((p) => p.stationId === s.id),
    );
  const departure = activeCrewDeparture(race);
  const nextEta = next
    ? calculateEta(race, next.km, next.id, now, { pace: etaBase!.pace, dwell })
    : null;
  const vert = journeyElevation(race);
  const complete = race.status === "complete",
    scheduled = !complete && !race.fix && now < race.startAt;
  const stale = !demo && (!race.heartbeatAt || now - race.heartbeatAt > 900000);

  const effectiveMoveSpeed = rolling > 0 ? rolling : overallSpeed;
  const latestLocation = race.latestLocation ?? race.fix;
  const estimatedKm = race.offRoute
    ? undefined
    : estimate && race.fix && !complete && !scheduled && overallSpeed > 0
      ? dwell.atStation
        ? race.progressKm
        : Math.min(
            total - 0.051,
            race.progressKm +
              (effectiveMoveSpeed *
                Math.min(Math.max(0, now - race.fix.at), 10 * 60000)) /
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
                  ? race.finishSource === "estimated"
                    ? "ESTIMATED FINISH"
                    : "FINISHED"
                  : scheduled
                    ? "UPCOMING"
                    : "LIVE RACE"}
            </span>
            <span>
              {new Date(race.startAt).toLocaleDateString([], {
                timeZone: raceTimeZone(race),
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
          <h1>{race.name}</h1>
          <p>
            <Mountain size={15} /> {kmToMiles(plannedDistance(race)).toFixed(1)}{" "}
            mi course <span>·</span> {race.stations.length - 1} aid stations{" "}
            <span>·</span> Self-directed adventure
          </p>
        </div>
        <button className="button" onClick={share}>
          {copied ? <Check size={16} /> : <Share2 size={16} />}{" "}
          {copied ? "Link copied" : "Share race"}
        </button>
      </section>
      {complete && race.finishSource && (
        <div
          className={`notice ${race.finishSource === "estimated" ? "estimated-finish-notice" : ""}`}
          role="status"
        >
          {race.finishSource === "estimated" && (
            <strong>Estimated finish — not GPS-confirmed</strong>
          )}
          {race.finishSource === "estimated"
            ? "Estimated finish — inferred from the last nearby position and pace after waiting for another update. No GPS fix confirms the finish."
            : "Finish time reported by the organizer."}
        </div>
      )}
      {demo && (
        <div className="notice">
          This is a sample course with simulated tracking data.{" "}
          <a href="/setup">Create your own race →</a>
        </div>
      )}
      {race.trackingPaused && !complete && (
        <div className="notice">
          Tracking paused after 24 hours without a new GPS fix. The organizer
          can resume tracking from the edit link.
        </div>
      )}
      {race.feedOk === false && !complete && (
        <div className="notice feed-failure" role="alert">
          <strong>Garmin feed unavailable</strong>
          <p>
            {race.feedError ||
              "We could not read the Garmin feed. Retrying automatically; the last recorded position remains visible."}
          </p>
        </div>
      )}
      {scheduled && (
        <div className="notice">
          Event starting at {time(race.startAt)}. Tracking can begin
          automatically up to one hour early.
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
      {race.outAndBack && (
        <div className="notice" role="status">
          {journeyMessage(race)} Original plan: {kmToMiles(total).toFixed(1)}{" "}
          mi.
        </div>
      )}
      {!complete &&
        (departure || (dwell.atStation && dwell.dwellMs < 600000)) && (
          <section className="form-card" style={{ marginBottom: 16 }}>
            {departure ? (
              <p role="status">
                Crew reported departure from{" "}
                {race.stations.find((s) => s.id === departure.stationId)?.name}{" "}
                at {time(departure.at)}. ETAs updated for everyone; awaiting GPS
                confirmation.
              </p>
            ) : (
              <>
                <p>
                  GPS last placed the runner at {dwell.station?.name}. Have you
                  seen them leave?
                </p>
                <button
                  className="button secondary"
                  disabled={
                    reportingDeparture ||
                    !online ||
                    !connected ||
                    demo ||
                    !!race.trackingPaused
                  }
                  onClick={async () => {
                    setReportingDeparture(true);
                    setDepartureError("");
                    try {
                      await api(`/races/${race.id}/depart`, "POST", {
                        stationId: dwell.station!.id,
                        fixAt: race.fix!.at,
                      });
                    } catch (e) {
                      setDepartureError(
                        e instanceof Error
                          ? e.message
                          : "Could not report departure.",
                      );
                    } finally {
                      setReportingDeparture(false);
                    }
                  }}
                >
                  {reportingDeparture
                    ? "Reporting…"
                    : "Runner has left this aid"}
                </button>
                <p className="field-note">
                  Updates everyone's ETAs and removes the remaining stop
                  allowance. The next GPS fix replaces this report.{" "}
                  {!online || !connected
                    ? "Reconnect to report departure."
                    : ""}
                </p>
              </>
            )}
            {departureError && <p role="alert">{departureError}</p>}
          </section>
        )}
      {!complete && race.offRoute && (
        <section className="notice" role="status">
          <strong>Off route</strong>
          <p>
            The map shows the latest GPS location
            {latestLocation ? `, recorded ${time(latestLocation.at)}` : ""}. It
            is away from the remaining planned course. Completed distance and
            splits stay at the last confirmed route position; ETAs are paused
            until the runner rejoins.
          </p>
        </section>
      )}
      {!complete && next && (
        <section className="form-card" style={{ marginBottom: 16 }}>
          <strong>
            Next: {next.name} ·{" "}
            {nextEta
              ? `${nextEta < now ? "Likely at" : "ETA"} ${time(nextEta)}`
              : race.offRoute
                ? "ETA paused · off route"
                : "ETA awaiting GPS pace"}
          </strong>
          <StationDirections
            race={race}
            station={next}
            offline={!online}
            prominent
          />
          <small>
            Directions target the aid location. Check road access and parking
            before driving.
          </small>
        </section>
      )}
      {complete && !demo && (
        <p>
          <a
            className="button secondary"
            href={`/replay?event=${encodeURIComponent(race.slug ?? race.id)}`}
          >
            Replay this race
          </a>
        </p>
      )}
      {!demo && smsNumber && /^\+[1-9]\d{6,14}$/.test(smsNumber) && (
        <section className="form-card" style={{ marginBottom: 16 }}>
          <strong>Race updates by text</strong>
          <p>
            Text this race to {smsNumber}, then send UPDATE in the same
            conversation for another update.
          </p>
          <a
            className="button secondary"
            href={`sms:${smsNumber}${/iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(race.slug ?? race.id)}`}
          >
            Open messaging app
          </a>{" "}
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(race.slug ?? race.id);
                setSmsCopied(true);
              } catch {
                setSmsCopied(false);
              }
            }}
          >
            {smsCopied ? "Message copied" : "Copy SMS message"}
          </button>
          <p className="field-note">
            Replies only when you text us. Message and data rates may apply.
            Text STOP to opt out.
          </p>
        </section>
      )}
      <section className="stats">
        <div>
          <span>DISTANCE COVERED</span>
          <strong>
            {kmToMiles(completedDistance(race)).toFixed(1)}{" "}
            <small>/ {kmToMiles(plannedDistance(race)).toFixed(1)} mi</small>
          </strong>
          <div className="mini-progress">
            <i style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
        </div>
        <div className="vert-card">
          <span>ESTIMATED ASCENT</span>
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
              ? "Smoothed GPX ascent at confirmed route progress"
              : "GPX elevation data unavailable"}
          </p>
        </div>
        <div>
          <span>{complete ? "TOTAL TIME" : "ELAPSED TIME"}</span>
          <strong>
            {elapsed(
              !race.fix && !complete
                ? 0
                : (complete ? (race.finishedAt ?? now) : now) - raceStart(race),
            )}
          </strong>
          <p>
            {!race.fix && !complete
              ? "Waiting for tracker start"
              : complete
                ? "Race archived"
                : "Since the start"}
          </p>
        </div>
        <div>
          <span>
            {complete
              ? "AVERAGE PACE"
              : dwell.atStation && !departure
                ? "CURRENT STATUS"
                : "ROLLING PACE"}
          </span>
          <strong>
            {dwell.atStation && !departure && !complete ? (
              "At aid station"
            ) : (
              <>
                {pacePerMile(!complete && rolling > 0 ? rolling : overallSpeed)}{" "}
                <small>min/mi</small>
              </>
            )}
          </strong>
          <p>
            {complete
              ? "Based on confirmed progress"
              : dwell.atStation && !departure
                ? `${dwell.station?.name ?? "Aid station"} · Overall: ${pacePerMile(overallSpeed)} min/mi`
                : etaBase!.pace.source === "rolling"
                  ? `Recent 40 min · Overall: ${pacePerMile(overallSpeed)} min/mi`
                  : "Based on confirmed progress"}
          </p>
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
              <Route size={18} />{" "}
              {race.offRoute ? "Off route" : "On the course"}
            </h2>
            <span className="muted">{Math.round(percent)}% complete</span>
          </div>
          <RaceMap race={race} clockAt={now} estimatedKm={estimatedKm} />
          <div className="map-bottom">
            {stale && !complete && race.heartbeatAt && (
              <p>Last connected to server at {time(race.heartbeatAt)}</p>
            )}
            <p>
              Last location update received at{" "}
              {race.lastLocationReceivedAt
                ? time(race.lastLocationReceivedAt)
                : latestLocation
                  ? `Unknown receipt time; GPS recorded at ${time(latestLocation!.at)}`
                  : "— awaiting first GPS position"}
            </p>
            {!complete && race.nextUpdateExpectedAt && (
              <p>
                Next update expected at {time(race.nextUpdateExpectedAt)} ·
                estimated
              </p>
            )}
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
                <strong>{time(raceStart(race))}</strong>
                <span>{race.actualStartAt ? "Started" : "Scheduled"}</span>
                {race.actualStartAt !== undefined &&
                  race.actualStartAt !== race.startAt && (
                    <span>
                      Scheduled {time(race.startAt)} · Started{" "}
                      {time(race.actualStartAt)}
                    </span>
                  )}
              </div>
            </div>
            {race.stations.map((s, i) => {
              const split = race.splits.find((p) => p.stationId === s.id);
              const arrival = calculateEta(race, s.km, s.id, now, {
                pace: etaBase!.pace,
                dwell,
              });
              const isNext = next?.id === s.id;
              const isDwell =
                dwell.atStation &&
                !departure &&
                dwell.station?.id === s.id &&
                !complete;
              return (
                <div
                  key={s.id}
                  className={`station-row ${(isNext || isDwell) && !complete ? "next" : ""}`}
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
                    <StationDirections
                      race={race}
                      station={s}
                      offline={!online}
                    />
                    <p>
                      {kmToMiles(stationDistance(race, s.km)).toFixed(1)} mi{" "}
                      {isDwell && (
                        <b>
                          AT STATION (
                          {Math.max(1, Math.floor(dwell.dwellMs / 60000))}m)
                        </b>
                      )}
                      {!isDwell && isNext && !complete && <b>NEXT UP</b>}
                    </p>
                    {split && (
                      <p>
                        Split{" "}
                        {elapsed(
                          split.at -
                            Math.max(
                              raceStart(race),
                              ...race.splits
                                .filter((p) => p.at < split.at)
                                .map((p) => p.at),
                            ),
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
                        ? s.id === "finish" && race.finishSource === "reported"
                          ? "Reported finish"
                          : "Est. crossing"
                        : stationSkipped(race, s.id)
                          ? "Skipped · early return"
                          : complete
                            ? "Not recorded"
                            : arrival && arrival < now
                              ? "Likely at · awaiting GPS"
                              : race.offRoute
                                ? "ETA paused · off route"
                                : "ETA"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="panel-note">
            Crossing times are interpolated between GPS updates; a plausible
            visit near the turnaround may be inferred. Arrival estimates use
            recent grade-adjusted pace and the remaining elevation profile when
            available, with a 10-minute allowance per intermediate aid station.
            Overall-pace estimates already include stops and add no extra
            allowance. Terrain estimates cannot account for footing or weather.
          </p>
        </aside>
      </section>
      <section className="bottom-info">
        <div>
          <Radio size={19} />
          <div>
            <h3>A clear picture between updates</h3>
            <p>
              Garmin sends positions at its configured interval. We learn the
              message spacing and check near the next expected delivery.
              Satellite delays can change when a position arrives.
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
