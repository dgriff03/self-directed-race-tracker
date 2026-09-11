import { initializeApp, getApps } from "firebase/app";
import {
  getDatabase,
  connectDatabaseEmulator,
  onValue,
  ref,
} from "firebase/database";
import type { Race } from "../shared/race";
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
  const base =
    path === "/races" && !c.emulator
      ? `https://us-central1-${c.projectId}.cloudfunctions.net/api`
      : (c.apiBase ?? "/api");
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
  return {
    ...v,
    route: v.route ?? [],
    distances: v.distances ?? [],
    stations: v.stations ?? [],
    splits: v.splits ?? [],
    track: v.track ?? [],
    fix: v.fix ?? null,
    previousFix: v.previousFix ?? null,
    heartbeatAt: v.heartbeatAt ?? null,
    finishedAt: v.finishedAt ?? null,
    feedOk: v.feedOk ?? null,
  };
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
    "name",
    "startAt",
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
    "finishedAt",
    "revision",
    "track",
    "trackingPaused",
  ];
  const value: any = {};
  const loaded = new Set<string>();
  let queued = false;
  const stops = fields.map((key) =>
    onValue(
      ref(db, `races/${id}/${key}`),
      (snapshot) => {
        value[key] = snapshot.val();
        loaded.add(key);
        if (loaded.size === fields.length && !queued) {
          queued = true;
          queueMicrotask(() => {
            queued = false;
            onRace(value.id ? normalize({ ...value }) : null);
          });
        }
      },
      onError,
    ),
  );
  return () => {
    stopConnection();
    stops.forEach((stop) => stop());
  };
}
