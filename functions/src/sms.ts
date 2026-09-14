import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import { getDatabase } from "firebase-admin/database";
import { createHmac } from "node:crypto";
import twilio from "twilio";
import { loadRace } from "./race-storage.js";
import { smsCommand, smsUpdate } from "../../shared/sms.js";
const token = defineSecret("TWILIO_AUTH_TOKEN");
const webhookUrl = defineString("TWILIO_WEBHOOK_URL", {
  default:
    "https://us-central1-self-directed-tracker-type-two.cloudfunctions.net/sms",
});
const phone = defineString("TWILIO_PHONE_NUMBER", { default: "" });
const help =
  "Milemark: text a race UUID or viewer link for an update. Then text UPDATE to check that race again. STOP stops replies.";
// No conversation-history fetch: remember only the last requested race per sender
// and receiving number. Phone numbers and message bodies are never stored.
export const sms = onRequest(
  {
    region: "us-central1",
    secrets: [token],
    maxInstances: 3,
    timeoutSeconds: 30,
  },
  async (req, res) => {
    const reply = (text?: string) => {
      const xml = new twilio.twiml.MessagingResponse();
      if (text) xml.message(text);
      res.status(200).type("text/xml").send(xml.toString());
    };
    if (req.method !== "POST") {
      res.status(405).send("POST required");
      return;
    }
    if (!phone.value()) {
      res.status(503).send("SMS not configured");
      return;
    }
    const body = req.body;
    if (
      !body ||
      typeof body !== "object" ||
      !Object.values(body).every((v) => typeof v === "string") ||
      !twilio.validateRequest(
        token.value(),
        req.get("X-Twilio-Signature") ?? "",
        webhookUrl.value(),
        body,
      )
    ) {
      res.status(403).send("Invalid signature");
      return;
    }
    if (
      body.To !== phone.value() ||
      !/^\+[1-9]\d{6,14}$/.test(body.From ?? "") ||
      !/^SM[0-9a-f]{32}$/i.test(body.MessageSid ?? "") ||
      (body.Body ?? "").length > 2000
    ) {
      res.status(400).send("Invalid message");
      return;
    }
    const db = getDatabase();
    const key = createHmac("sha256", token.value())
      .update(`${body.To}|${body.From}`)
      .digest("hex");
    const context = db.ref(`smsConversations/${key}`),
      now = Date.now();
    const command = smsCommand(body.Body ?? "");
    try {
      // Deduplicate delivery retries and cap replies at 12/hour for each sender.
      const claim = await context.transaction((current) => {
        const state = current ?? {};
        if ((state.recentIds ?? []).includes(body.MessageSid)) return;
        const count =
          now - (state.windowAt ?? 0) < 3600000 ? (state.count ?? 0) : 0;
        if (count >= 12 && command.kind !== "stop") return;
        return {
          ...state,
          windowAt: count ? state.windowAt : now,
          count: count + 1,
          recentIds: [...(state.recentIds ?? []), body.MessageSid].slice(-30),
        };
      });
      if (!claim.committed) {
        reply();
        return;
      }
      if (command.kind === "stop" || body.OptOutType === "STOP") {
        await context.child("raceId").remove();
        await context.child("selectedAt").remove();
        reply();
        return;
      }
      if (body.OptOutType) {
        reply();
        return;
      } // Twilio manages its own START/HELP responses.
      if (command.kind === "help") {
        reply(help);
        return;
      }
      const previous = claim.snapshot.val();
      const id =
        command.kind === "race"
          ? command.id
          : now - (previous.selectedAt ?? 0) < 30 * 86400000
            ? previous.raceId
            : null;
      if (!id) {
        reply(help);
        return;
      }
      const raw = (await db.ref(`races/${id}`).get()).val();
      if (!raw) {
        reply("Race not found. Send a valid Milemark viewer link or UUID.");
        return;
      }
      const race = await loadRace(raw);
      // Only a successful explicit request replaces the remembered race.
      if (command.kind === "race")
        await context.update({ raceId: id, selectedAt: now });
      reply(smsUpdate(race, now));
    } catch {
      reply(
        "Milemark could not load this update. Please text UPDATE again shortly.",
      );
    }
  },
);
