import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { applyFixes, cumulative, type Race } from "../../shared/race.js";
import { fetchFeed, validateFeed } from "./feed.js";
initializeApp();
const db = getDatabase();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid = z.string().uuid();
const configSchema = z.object({
  name: z.string().trim().min(1).max(100),
  startAt: z.number().int().min(0).max(4102444800000),
  route: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .min(2)
    .max(6000),
  elevationsM: z
    .array(z.number().min(-12000).max(10000))
    .min(2)
    .max(6000)
    .nullable()
    .optional(),
  stations: z
    .array(
      z.object({
        id: uuid,
        name: z.string().trim().min(1).max(80),
        km: z.number().positive(),
      }),
    )
    .max(50),
  feedUrl: z.string().max(2048).optional(),
  revision: z.number().int().optional(),
});
export function normalizeRace(v: any): Race {
  return {
    ...v,
    route: v.route ?? [],
    distances: v.distances ?? [],
    stations: v.stations ?? [],
    splits: v.splits ?? [],
    track: v.track ?? [],
    fix: v.fix ?? null,
    previousFix: v.previousFix ?? null,
    finishedAt: v.finishedAt ?? null,
    heartbeatAt: v.heartbeatAt ?? null,
    feedOk: v.feedOk ?? null,
  };
}
export const api = onRequest(
  { region: "us-central1", cors: true, maxInstances: 10, timeoutSeconds: 30 },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "strict-origin");
    try {
      const path = req.path.replace(/^\/api/, "");
      if (req.method === "POST" && path === "/races") {
        const ip = hash(req.ip ?? "unknown");
        const quota = db.ref(`limits/${ip}`);
        const limited = await quota.transaction((v) => {
          const now = Date.now();
          if (!v || now - v.at > 3600000) return { at: now, count: 1 };
          if (v.count >= 10) return;
          return { ...v, count: v.count + 1 };
        });
        if (!limited.committed) {
          res
            .status(429)
            .json({ error: "Please wait before creating more races." });
          return;
        }
        const input = configSchema.parse(req.body);
        if (
          input.elevationsM &&
          input.elevationsM.length !== input.route.length
        )
          throw Error("Elevation profile must match the route points.");
        if (!input.feedUrl) throw Error("A Garmin KML feed is required.");
        input.feedUrl = validateFeed(input.feedUrl).toString();
        const ds = cumulative(input.route);
        const total = ds.at(-1)!;
        if (
          total < 0.1 ||
          total > 2000 ||
          input.stations.some((s) => s.km >= total) ||
          new Set(input.stations.map((s) => s.id)).size !==
            input.stations.length
        )
          throw Error("Check route length and aid station distances.");
        const id = randomUUID(),
          editToken = randomUUID();
        const race: Race = {
          id,
          name: input.name,
          startAt: input.startAt,
          route: input.route,
          elevationsM: input.elevationsM ?? null,
          distances: ds,
          stations: [
            ...input.stations.sort((a, b) => a.km - b.km),
            { id: "finish", name: "Finish line", km: total },
          ],
          status: Date.now() < input.startAt ? "scheduled" : "live",
          progressKm: 0,
          fix: null,
          previousFix: null,
          splits: [],
          heartbeatAt: null,
          feedOk: null,
          finishedAt: null,
          revision: 1,
          track: [],
        };
        await db.ref().update({
          [`races/${id}`]: race,
          [`editKeys/${hash(editToken)}`]: id,
          [`jobs/${id}`]: {
            feedUrl: input.feedUrl,
            startAt: input.startAt,
            active: true,
            leaseUntil: 0,
          },
        });
        res.status(201).json({ id, editToken });
        return;
      }
      if (path === "/edit" && ["GET", "PUT", "POST"].includes(req.method)) {
        const token = uuid.parse(
          (req.headers.authorization ?? "").replace(/^Bearer /, ""),
        );
        const id = (await db.ref(`editKeys/${hash(token)}`).get()).val();
        if (!id) {
          res.status(404).json({ error: "Race not found." });
          return;
        }
        const ref = db.ref(`races/${id}`);
        const snapshot = await ref.get();
        if (!snapshot.exists()) {
          res.status(404).json({ error: "Race not found." });
          return;
        }
        const race = normalizeRace(snapshot.val());
        if (req.method === "GET") {
          res.json({ race, feedConfigured: true });
          return;
        }
        if (req.method === "POST") {
          if (req.body.action === "resume" && race.status !== "complete") {
            await ref.update({ trackingPaused: false });
            await db.ref(`jobs/${id}`).update({ active: true, resumedAt: Date.now() });
            res.json({ ok: true });
            return;
          }
          if (req.body.action !== "complete") throw Error("Unknown action.");
          await ref.transaction((raw) => {
            if (!raw) return raw;
            return {
              ...raw,
              status: "complete",
              finishedAt: raw.finishedAt ?? Date.now(),
              revision: (raw.revision ?? 0) + 1,
            };
          });
          await db.ref(`jobs/${id}`).update({ active: false });
          res.json({ ok: true });
          return;
        }
        const input = configSchema.parse(req.body);
        if (
          input.elevationsM &&
          input.elevationsM.length !== input.route.length
        )
          throw Error("Elevation profile must match the route points.");
        if (input.feedUrl) input.feedUrl = validateFeed(input.feedUrl).toString();
        const ds = cumulative(input.route),
          total = ds.at(-1)!;
        if (
          total < 0.1 ||
          total > 2000 ||
          input.stations.some((s) => s.km >= total) ||
          new Set(input.stations.map((s) => s.id)).size !==
            input.stations.length
        )
          throw Error("Check route and aid station distances.");
        let conflict = false;
        const updated = await ref.transaction((raw) => {
          if (!raw) return raw;
          const current = normalizeRace(raw);
          if (current.revision !== input.revision) {
            conflict = true;
            return;
          }
          if (current.fix || current.status === "complete") {
            if (
              JSON.stringify(current.route) !== JSON.stringify(input.route) ||
              current.startAt !== input.startAt ||
              JSON.stringify(
                current.stations.filter((s) => s.id !== "finish"),
              ) !== JSON.stringify(input.stations.sort((a, b) => a.km - b.km))
            )
              return;
          }
          return {
            ...current,
            name: input.name,
            startAt: input.startAt,
            route: input.route,
            elevationsM:
              input.elevationsM !== undefined
                ? input.elevationsM
                : JSON.stringify(current.route) === JSON.stringify(input.route)
                  ? (current.elevationsM ?? null)
                  : null,
            distances: ds,
            stations: [
              ...input.stations.sort((a, b) => a.km - b.km),
              { id: "finish", name: "Finish line", km: total },
            ],
            revision: current.revision + 1,
          };
        });
        if (!updated.committed) {
          res.status(409).json({
            error: conflict
              ? "Race changed. Reload before saving."
              : "Route, start time and stations are locked after tracking begins.",
          });
          return;
        }
        await db.ref(`jobs/${id}`).update({
          startAt: input.startAt,
          ...(input.feedUrl ? { feedUrl: input.feedUrl } : {}),
        });
        res.json({
          race: normalizeRace(updated.snapshot.val()),
          feedConfigured: true,
        });
        return;
      }
      res.status(404).json({ error: "Not found." });
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof z.ZodError
            ? "Please check the race fields."
            : error instanceof Error &&
                /Garmin|route|station|feed is required|Unknown action/i.test(
                  error.message,
                )
              ? error.message
              : "Unable to process this request. Please check your input.",
      });
    }
  },
);
export const pollGarmin = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "us-central1",
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    const now = Date.now();
    const jobs = await db
      .ref("jobs")
      .orderByChild("active")
      .equalTo(true)
      .get();
    const entries = Object.entries(jobs.val() ?? {});
    for (let offset = 0; offset < entries.length; offset += 8) {
      await Promise.all(
        entries
          .slice(offset, offset + 8)
          .map(async ([id, job]: [string, any]) => {
            if (job.startAt > now) return;
            const jobRef = db.ref(`jobs/${id}`);
            const claim = await jobRef.transaction((v) =>
              !v
                ? v
                : v.active && v.startAt <= now && (v.leaseUntil ?? 0) < now
                  ? { ...v, leaseUntil: now + 180000 }
                  : undefined,
            );
            if (!claim.committed) return;
            try {
              const ref = db.ref(`races/${id}`);
              const raw = (await ref.get()).val();
              if (!raw || raw.status === "complete") {
                await jobRef.update({ active: false });
                return;
              }
              const race = normalizeRace(raw);
              if (now - Math.max(race.startAt, race.fix?.at ?? 0, job.resumedAt ?? 0) > 24 * 3600000) {
                await ref.update({ trackingPaused: true });
                await jobRef.update({ active: false });
                return;
              }
              let fixes: any[] = [];
              let ok = true;
              try {
                fixes = await fetchFeed(
                  claim.snapshot.val().feedUrl,
                  Math.max(race.startAt, (race.fix?.at ?? race.startAt) - 1000),
                );
              } catch {
                ok = false;
              }
              await ref.transaction((raw) => {
                if (!raw) return raw;
                if (raw.status === "complete") return;
                const current = normalizeRace(raw);
                if (current.startAt > Date.now()) return;
                const updated = applyFixes(current, fixes);
                return {
                  ...updated,
                  status:
                    updated.status === "scheduled" ? "live" : updated.status,
                  heartbeatAt: Date.now(),
                  feedOk: ok,
                };
              });
              if ((await ref.child("status").get()).val() === "complete")
                await jobRef.update({ active: false });
            } finally {
              await jobRef.update({ leaseUntil: 0 });
            }
          }),
      );
    }
  },
);
