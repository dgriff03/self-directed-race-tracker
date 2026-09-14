import {
  storedCourse,
  storedLive,
  hydrateRace,
  storedFix,
  trackKey,
} from "../../shared/storage.js";
import {
  loadRace,
  withStatic,
  persistRace,
  withTrackOutbox,
  flushTrack,
} from "./race-storage.js";
import { initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  stationVisits,
  EARLY_START_MS,
  applyFixes,
  cumulative,
  validOutAndBack,
  setJourneyDirection,
  type Race,
} from "../../shared/race.js";
import { requestIp } from "./request-ip.js";
import { inferFinish } from "../../shared/finish.js";
import { feedUpdate } from "../../shared/polling.js";
import { fetchFeed, validateFeed } from "./feed.js";
initializeApp();
const db = getDatabase();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const uuid = z.string().uuid();
const configSchema = z.object({
  outAndBack: z.boolean().optional().default(false),
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
export function sameStations(a: Race["stations"], b: Race["stations"]) {
  return (
    a.length === b.length &&
    a.every((s) =>
      b.some((t) => t.id === s.id && t.name === s.name && t.km === s.km),
    )
  );
}
export function normalizeRace(v: any): Race { return hydrateRace(v); }
export const api = onRequest(
  { region: "us-central1", cors: true, maxInstances: 10, timeoutSeconds: 30 },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Referrer-Policy", "strict-origin");
    try {
      const path = req.path.replace(/^\/api/, "");
      if (req.method === "POST" && path === "/races") {
        const ip = hash(
          requestIp(req.headers["x-forwarded-for"], req.socket.remoteAddress),
        );
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
        input.route = storedCourse(input).route;
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
          (input.outAndBack && !validOutAndBack(input.route, ds)) ||
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
          courseVersion: randomUUID(),
          outAndBack: input.outAndBack,
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
          [`courses/${id}/${race.courseVersion}`]: storedCourse(race),
          [`races/${id}`]: storedLive(race),
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
        const race = await loadRace(snapshot.val());
        if (req.method === "GET") {
          res.json({ race, feedConfigured: true });
          return;
        }
        if (req.method === "POST") {
          if (
            req.body.action === "turnaround" ||
            req.body.action === "resumeOutbound"
          ) {
            const result = await ref.transaction((raw) => {
              if (!raw) return raw;
              const current = withStatic(raw, race);
              if (
                !current.outAndBack ||
                !current.fix ||
                !current.journey ||
                current.status === "complete"
              )
                return raw;
              return persistRace({
                ...setJourneyDirection(
                  current,
                  req.body.action === "turnaround" ? "returning" : "outbound",
                ),
                stations: current.stations.filter((s) => !s.returnOf),
                revision: current.revision + 1,
              });
            });
            if (!result.committed || !result.snapshot.exists()) {
              res.status(409).json({
                error: "An active out-and-back race with GPS is required.",
              });
              return;
            }
            const finalRace = await loadRace(result.snapshot.val());
            if (
              !finalRace.outAndBack ||
              !finalRace.fix ||
              !finalRace.journey ||
              finalRace.status === "complete"
            ) {
              res.status(409).json({
                error: "An active out-and-back race with GPS is required.",
              });
              return;
            }
            res.json({ race: finalRace });
            return;
          }

          if (req.body.action === "testFeed" && race.status !== "complete") {
            const jobRef = db.ref(`jobs/${id}`);
            const claim = await jobRef.transaction((v) =>
              !v
                ? v
                : (v.testAfter ?? 0) > Date.now()
                  ? undefined
                  : { ...v, testAfter: Date.now() + 60000 },
            );
            if (!claim.committed) {
              res
                .status(429)
                .json({ error: "Wait a minute before testing again." });
              return;
            }
            try {
              const points = await fetchFeed(
                claim.snapshot.val().feedUrl,
                Math.min(race.startAt, Date.now() - 86400000),
              );
              res.json({
                ok: true,
                checkedAt: Date.now(),
                pointCount: points.length,
                latestAt: points.at(-1)?.at ?? null,
              });
            } catch {
              res.json({
                ok: false,
                checkedAt: Date.now(),
                message:
                  "Garmin could not be read. Check the share name and that sharing is enabled without a password.",
              });
            }
            return;
          }
          if (req.body.action === "resume" && race.status !== "complete") {
            await ref.update({ trackingPaused: false });
            await db
              .ref(`jobs/${id}`)
              .update({ active: true, resumedAt: Date.now() });
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
        input.route = storedCourse(input).route;
        if (
          input.elevationsM &&
          input.elevationsM.length !== input.route.length
        )
          throw Error("Elevation profile must match the route points.");
        if (input.feedUrl)
          input.feedUrl = validateFeed(input.feedUrl).toString();
        const ds = cumulative(input.route),
          total = ds.at(-1)!;
        if (
          (input.outAndBack && !validOutAndBack(input.route, ds)) ||
          total < 0.1 ||
          total > 2000 ||
          input.stations.some((s) => s.km >= total) ||
          new Set(input.stations.map((s) => s.id)).size !==
            input.stations.length
        )
          throw Error("Check route and aid station distances.");
        const course = storedCourse({
          route: input.route,
          elevationsM:
            input.elevationsM !== undefined
              ? input.elevationsM
              : JSON.stringify(input.route) === JSON.stringify(storedCourse(race).route) ? race.elevationsM : null,
        });
        const courseChanged =
          !race.courseVersion ||
          JSON.stringify(course) !== JSON.stringify(storedCourse(race));
        const courseVersion = courseChanged
          ? randomUUID()
          : race.courseVersion!;
        if (courseChanged)
          await db.ref(`courses/${id}/${courseVersion}`).set(course);
        if (!race.courseVersion && race.track.length)
          await db
            .ref(`tracks/${id}`)
            .update(
              Object.fromEntries(
                race.track.slice(-500).map((f) => [trackKey(f), storedFix(f)]),
              ),
            );
        let conflict = false;
        const updated = await ref.transaction((raw) => {
          if (!raw) return raw;
          const current = withStatic(raw, race);
          if (current.revision !== input.revision) {
            conflict = true;
            return;
          }
          if (current.fix || current.status === "complete") {
            if (
              JSON.stringify(storedCourse(current).route) !==
                JSON.stringify(input.route) ||
              !!current.outAndBack !== input.outAndBack ||
              current.startAt !== input.startAt ||
              !sameStations(
                current.stations.filter(
                  (s) => s.id !== "finish" && !s.returnOf,
                ),
                input.stations,
              )
            )
              return;
          }
          return storedLive({
            ...current,
            courseVersion,
            outAndBack: input.outAndBack,
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
          });
        });
        if (!updated.committed) {
          if (courseChanged)
            await db.ref(`courses/${id}/${courseVersion}`).remove();
          res.status(409).json({
            error: conflict
              ? "Race changed. Reload before saving."
              : "Route, start time and stations are locked after tracking begins.",
          });
          return;
        }
        await db.ref(`jobs/${id}`).update({
          startAt: input.startAt,
          ...(input.feedUrl
            ? {
                feedUrl: input.feedUrl,
                ...(race.status !== "complete"
                  ? { active: true, resumedAt: Date.now() }
                  : {}),
              }
            : {}),
        });
        if (input.feedUrl && race.status !== "complete")
          await ref.update({ trackingPaused: false });
        res.json({
          race: {
            ...(await loadRace(updated.snapshot.val())),
            ...(input.feedUrl && race.status !== "complete"
              ? { trackingPaused: false }
              : {}),
          },
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
    schedule: "every 1 minutes",
    region: "us-central1",
    timeoutSeconds: 120,
    maxInstances: 1,
  },
  async () => {
    const now = Date.now();
    const expired = await db
      .ref("limits")
      .orderByChild("at")
      .endAt(now - 86400000)
      .limitToFirst(500)
      .get();
    await Promise.all(
      Object.keys(expired.val() ?? {}).map((key) =>
        db
          .ref(`limits/${key}`)
          .transaction((v) =>
            !v ? v : v.at < now - 86400000 ? null : undefined,
          ),
      ),
    );
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
            if (job.startAt - EARLY_START_MS > now) return;
            const jobRef = db.ref(`jobs/${id}`);
            const claim = await jobRef.transaction((v) =>
              !v
                ? v
                : v.active &&
                    v.startAt - EARLY_START_MS <= now &&
                    (v.leaseUntil ?? 0) < now
                  ? { ...v, leaseUntil: now + 180000 }
                  : undefined,
            );
            if (!claim.committed) return;
            try {
              const ref = db.ref(`races/${id}`);
              const [status, nextPoll] = await Promise.all([
                ref.child("status").get(),
                ref.child("nextPollAt").get(),
                ref.child("revision").get(),
              ]);
              if (!status.exists() || status.val() === "complete") {
                if (status.exists()) await flushTrack(id);
                await jobRef.update({ active: false });
                return;
              }
              if ((nextPoll.val() ?? 0) > now) {
                await ref.child("heartbeatAt").set(now);
                return;
              }
              const raw = (await ref.get()).val();
              if (!raw || raw.status === "complete") {
                await jobRef.update({ active: false });
                return;
              }
              await flushTrack(id);
              const race = await loadRace(raw);
              if (
                now -
                  Math.max(
                    race.startAt,
                    race.fix?.at ?? 0,
                    job.resumedAt ?? 0,
                  ) >
                24 * 3600000
              ) {
                await ref.update({ trackingPaused: true });
                await jobRef.update({ active: false });
                return;
              }
              let fixes: any[] = [];
              let ok = true;
              let feedError: string | null = null;
              try {
                fixes = await fetchFeed(
                  claim.snapshot.val().feedUrl,
                  Math.max(
                    race.startAt - EARLY_START_MS,
                    (race.fix?.at ?? race.startAt - EARLY_START_MS) - 1000,
                  ),
                );
              } catch (error) {
                ok = false;
                feedError =
                  error instanceof Error &&
                  (/^Garmin HTTP \d{3}$/.test(error.message) ||
                    [
                      "Garmin feed exceeded 5 MB",
                      "Garmin returned an empty feed",
                      "Garmin returned invalid KML",
                    ].includes(error.message))
                    ? error.message
                    : error instanceof Error && error.name === "TimeoutError"
                      ? "Garmin request timed out"
                      : "Garmin feed could not be read";
                console.warn("Garmin poll failed", {
                  raceId: id,
                  reason: feedError,
                });
              }
              if (!ok)
                await jobRef
                  .child("lastFeedFailure")
                  .set({ at: now, reason: feedError });
              const timing = feedUpdate(race, fixes, now, ok);
              await jobRef.child("lastPollDiagnostic").set({
                at: now,
                ok,
                pointCount: fixes.length,
                newestPointAt: timing.lastFeedPointAt,
                error: feedError,
              });
              await ref.transaction((raw) => {
                if (!raw) return raw;
                if (raw.status === "complete") return;
                const current = withStatic(raw, race);
                if (current.revision !== race.revision) return;
                if (current.startAt - EARLY_START_MS > Date.now()) return;
                const updated = inferFinish(
                  { ...applyFixes(current, fixes), ...timing },
                  Date.now(),
                );
                return {
                  ...withTrackOutbox(updated, current),
                  ...timing,
                  feedError,
                  stations: updated.courseVersion
                    ? storedLive(updated).stations
                    : updated.stations.filter((s) => !s.returnOf),
                  status:
                    updated.status === "scheduled" &&
                    Date.now() >= updated.startAt
                      ? "live"
                      : updated.status,
                  heartbeatAt: Date.now(),
                  feedOk: ok,
                };
              });
              await flushTrack(id);
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

export { sms } from './sms.js';
