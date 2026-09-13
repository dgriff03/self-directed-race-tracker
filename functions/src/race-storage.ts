import { isDeepStrictEqual } from "node:util";
import { getDatabase } from "firebase-admin/database";
import {
  hydrateRace,
  storedLive,
  storedFix,
  trackKey,
  TRACK_LIMIT,
  type Course,
} from "../../shared/storage.js";
import type { Race, Fix } from "../../shared/race.js";
const cache = new Map<string, Course>();
export async function loadRace(raw: any): Promise<Race> {
  if (!raw.courseVersion) return hydrateRace(raw);
  const key = `${raw.id}/${raw.courseVersion}`;
  let course = cache.get(key);
  if (!course) {
    const value = (await getDatabase().ref(`courses/${key}`).get()).val();
    if (!value) throw Error("Course data missing");
    course = value as Course;
    cache.set(key, course);
    if (cache.size > 24) cache.delete(cache.keys().next().value!);
  }
  const track =
    (
      await getDatabase()
        .ref(`tracks/${raw.id}`)
        .orderByKey()
        .limitToLast(TRACK_LIMIT)
        .get()
    ).val() ?? {};
  return hydrateRace(raw, course, Object.values(track) as Fix[]);
}
export function withStatic(raw: any, loaded: Race) {
  return raw.courseVersion
    ? hydrateRace(
        raw,
        { route: loaded.route, elevationsM: loaded.elevationsM ?? null },
        loaded.track,
      )
    : hydrateRace(raw);
}
export function persistRace(r: Race) {
  return r.courseVersion ? storedLive(r) : r;
}
// The poll commits a small durable outbox with state. Flush is idempotent and
// never rewrites/reindexes existing breadcrumbs. A later poll retries after a crash.
export async function flushTrack(id: string) {
  const db = getDatabase(),
    ref = db.ref(`races/${id}/trackOutbox`),
    pending = (await ref.get()).val();
  if (!pending) return;
  const updates: any = {};
  for (const [key, value] of Object.entries(pending))
    updates[`tracks/${id}/${key}`] = value;
  await db.ref().update(updates);
  await ref.transaction((current) =>
    !current ? current : isDeepStrictEqual(current, pending) ? null : undefined,
  );
  const all = (await db.ref(`tracks/${id}`).orderByKey().get()).val() ?? {};
  const trim: any = {};
  for (const key of Object.keys(all)
    .sort()
    .slice(0, Math.max(0, Object.keys(all).length - TRACK_LIMIT)))
    trim[key] = null;
  if (Object.keys(trim).length) await db.ref(`tracks/${id}`).update(trim);
}
export function withTrackOutbox(updated: Race, previous: Race) {
  const live = persistRace(updated);
  if (!updated.courseVersion) return live;
  const before = new Set(previous.track.map(trackKey));
  const additions = updated.track.filter((f) => !before.has(trackKey(f)));
  if (additions.length)
    live.trackOutbox = {
      ...(live.trackOutbox ?? {}),
      ...Object.fromEntries(additions.map((f) => [trackKey(f), storedFix(f)])),
    };
  return live;
}
