import { apiBase } from "./api-url";
import { initializeApp, getApps } from "firebase/app";
import {
  getDatabase,
  connectDatabaseEmulator,
  onValue,
  get,
  query,
  limitToLast,
  orderByKey,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  ref,
} from "firebase/database";
import { hydrateRace, type Course } from "../shared/storage";
import { stationVisits, type Race } from "../shared/race";
type Config = {
  apiKey: string;
  databaseURL: string;
  projectId: string;
  appId: string;
  apiBase?: string;
  emulator?: boolean;
};
let configPromise: Promise<Config> | undefined;
export function config() {
  return (configPromise ??= fetch("/firebase-config.json", {
    cache: "no-store",
  })
    .then(async (r) => {
      if (!r.ok)
        throw Error(
          "Firebase is not connected yet. Add your project configuration to enable live races.",
        );
      const c = (await r.json()) as Config;
      if (!c.projectId || !c.databaseURL)
        throw Error("Firebase project configuration is incomplete.");
      return c;
    })
    .catch((error) => {
      configPromise = undefined;
      throw error;
    }));
}
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const c = await config();
  const base = apiBase(path, c);
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
  });
  const data = (await r.json()) as any;
  if (!r.ok) throw Error(data.error ?? "Could not save the race.");
  return data;
}
export function normalize(v: Race): Race {
  return hydrateRace(v);
}
export async function subscribe(
  id: string,
  onRace: (r: Race | null) => void,
  onConnection: (connected: boolean) => void,
  onError: (e: Error) => void,
) {
  const c = await config();
  const existing = getApps()[0];
  const app = existing ?? initializeApp(c);
  const db = getDatabase(app);
  if (c.emulator && !existing) connectDatabaseEmulator(db, "127.0.0.1", 9000);
  const stopConnection = onValue(ref(db, ".info/connected"), (s) =>
    onConnection(s.val() === true),
  );
  // Subscribe at field boundaries: route geometry is never resent with a heartbeat.
  const fields: (keyof Race)[] = [
    "id",
    "courseVersion",
    "name",
    "startAt",
    "actualStartAt",
    "startProgressKm",
    "startLineFix",
    "route",
    "distances",
    "elevationsM",
    "stations",
    "status",
    "progressKm",
    "fix",
    "previousFix",
    "splits",
    "heartbeatAt",
    "feedOk",
    "lastLocationReceivedAt",
    "nextUpdateExpectedAt",
    "feedError",
    "finishedAt",
    "finishSource",
    "finishInferredAt",
    "revision",
    "track",
    "trackingPaused",
    "outAndBack",
    "journey",
  ];
  const value: any = {};
  const loaded = new Set<string>();
  const breadcrumbs = new Map<string, any>();
  const courses = new Map<string, Course>();
  let trackLoaded = false,
    queued = false,
    stopped = false;
  const emit = () => {
    if (stopped || queued || loaded.size !== fields.length || !trackLoaded)
      return;
    const version = value.courseVersion;
    if (version && !courses.has(version)) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (stopped) return;
      const version = value.courseVersion;
      if (version && !courses.has(version)) return;
      const track = version
        ? [...breadcrumbs.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, v]) => v)
        : undefined;
      onRace(
        value.id
          ? hydrateRace(
              { ...value },
              version ? courses.get(version) : undefined,
              track,
            )
          : null,
      );
    });
  };
  const stops = fields.map((key) =>
    onValue(
      ref(db, `races/${id}/${key}`),
      (snapshot) => {
        value[key] = snapshot.val();
        loaded.add(key);
        if (key === "courseVersion" && value[key] && !courses.has(value[key])) {
          const version = value[key];
          get(ref(db, `courses/${id}/${version}`))
            .then((s) => {
              if (stopped) return;
              if (!s.exists()) throw Error("Course data could not be loaded");
              courses.set(version, s.val());
              emit();
            })
            .catch(onError);
        }
        emit();
      },
      onError,
    ),
  );
  const trackRef = query(
    ref(db, `tracks/${id}`),
    orderByKey(),
    limitToLast(500),
  );
  const add = (s: any) => {
    breadcrumbs.set(s.key, s.val());
    emit();
  };
  stops.push(
    onChildAdded(trackRef, add, onError),
    onChildChanged(trackRef, add, onError),
    onChildRemoved(
      trackRef,
      (s) => {
        breadcrumbs.delete(s.key!);
        emit();
      },
      onError,
    ),
  );
  stops.push(
    onValue(
      trackRef,
      () => {
        trackLoaded = true;
        emit();
      },
      onError,
      { onlyOnce: true },
    ),
  );
  return () => {
    stopped = true;
    stopConnection();
    stops.forEach((stop) => stop());
  };
}

// Read only public course and retained GPS data; never request the private feed URL.
export function eventIdFromInput(input: string): string {
  const value = input.trim();
  const id = value.match(
    /^(?:https?:\/\/[^/]+\/r\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/?(?:[?#].*)?)?$/i,
  )?.[1];
  if (!id) throw Error("Enter an event UUID or viewer URL.");
  return id.toLowerCase();
}
export async function readPublicRace(input: string): Promise<Race> {
  const id = eventIdFromInput(input);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw Error("Enter a valid event UUID.");
  const c = await config();
  const existing = getApps()[0];
  const db = getDatabase(existing ?? initializeApp(c));
  if (c.emulator && !existing) connectDatabaseEmulator(db, "127.0.0.1", 9000);
  const raw = (await get(ref(db, `races/${id}`))).val();
  if (!raw) throw Error("Event not found.");
  if (!raw.courseVersion) return hydrateRace(raw);
  const [course, track] = await Promise.all([
    get(ref(db, `courses/${id}/${raw.courseVersion}`)),
    get(query(ref(db, `tracks/${id}`), orderByKey(), limitToLast(500))),
  ]);
  if (!course.exists()) throw Error("Event course is unavailable.");
  return hydrateRace(raw, course.val(), Object.values(track.val() ?? {}));
}
