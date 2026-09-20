import { raceTime } from "./time.js";
import { raceReference } from "./race-reference.js";
import {
  activeCrewDeparture,
  calculateEta,
  completedDistance,
  elapsed,
  kmToMiles,
  plannedDistance,
  raceStart,
  stationSkipped,
  type Race,
} from "./race.js";

export function smsCommand(
  body: string,
): { kind: "race"; id: string } | { kind: "update" | "help" | "stop" } {
  const text = body.trim();
  if (/^(stop|stopall|unsubscribe|cancel|end|quit|revoke|optout)$/i.test(text))
    return { kind: "stop" };
  if (/^(update|status|again|latest|\?)?$/i.test(text))
    return { kind: "update" };
  const ids = text.match(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  );
  if (ids?.length === 1) return { kind: "race", id: ids[0].toLowerCase() };
  try {
    return { kind: "race", id: raceReference(text) };
  } catch {
    return { kind: "help" };
  }
}
export function smsUpdate(r: Race, now = Date.now()): string {
  const time = (at: number) => raceTime(r, at);
  const lines = [r.name.slice(0, 80)];
  if (r.status === "complete") {
    lines.push(
      `Finished${r.finishSource === "estimated" ? " (estimated, not GPS-confirmed)" : r.finishSource === "reported" ? " (organizer reported)" : ""}. ${elapsed((r.finishedAt ?? r.fix?.at ?? raceStart(r)) - raceStart(r))} elapsed.`,
    );
  } else if (!r.fix) {
    lines.push(`Waiting for tracker start. Scheduled ${time(r.startAt)}.`);
  } else {
    lines.push(
      `${kmToMiles(completedDistance(r)).toFixed(1)} / ${kmToMiles(plannedDistance(r)).toFixed(1)} mi.`,
    );
    const next = r.stations.find(
      (s) =>
        s.km > r.progressKm &&
        !stationSkipped(r, s.id) &&
        !r.splits.some((p) => p.stationId === s.id),
    );
    if (next) {
      const eta = calculateEta(r, next.km, next.id, now);
      lines.push(
        `Next: ${next.name.slice(0, 60)}. ${eta ? `${eta < now ? "Likely at" : "ETA"} ${time(eta)}${eta < now ? " (awaiting GPS)" : ""}` : r.offRoute ? "ETA paused — off route" : "ETA awaiting pace"}.`,
      );
    }
    if (r.feedOk === false)
      lines.push("Garmin feed unavailable; showing saved data.");
  }
  if (activeCrewDeparture(r))
    lines.push("Crew-reported departure; awaiting GPS confirmation.");
  if (r.offRoute)
    lines.push("Off route. Progress held at last confirmed course position.");
  const location = r.latestLocation ?? r.fix;
  if (location) lines.push(`GPS recorded ${time(location.at)}.`);
  lines.push("Text UPDATE for this race, or send another race link.");
  return lines.join("\n");
}
