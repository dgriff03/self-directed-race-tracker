import { raceReference } from "./race-reference.js";
import {
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
const time = (at: number) =>
  new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
export function smsUpdate(r: Race, now = Date.now()): string {
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
        `Next: ${next.name.slice(0, 60)}. ${eta ? `${eta < now ? "Likely at" : "ETA"} ${time(eta)}${eta < now ? " (awaiting GPS)" : ""}` : "ETA awaiting pace"}.`,
      );
    }
    if (r.feedOk === false)
      lines.push("Garmin feed unavailable; showing saved data.");
  }
  if (r.fix) lines.push(`GPS recorded ${time(r.fix.at)}.`);
  lines.push("Text UPDATE for this race, or send another race link.");
  return lines.join("\n");
}
