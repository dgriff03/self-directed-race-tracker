import { test } from "node:test";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { ref, get, set } from "firebase/database";
import { readFileSync } from "node:fs";
test("viewer capability cannot enumerate races, write records, or read edit credentials or feed URLs", async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-paceline",
    database: {
      rules: readFileSync("database.rules.json", "utf8"),
      host: "127.0.0.1",
      port: 9000,
    },
  });
  try {
    const id = "12345678-1234-4234-8234-123456789abc";
    await env.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database(), `races/${id}`), { name: "Test race" });
      await set(ref(ctx.database(), "jobs/test"), {
        feedUrl: "https://share.garmin.com/Feed/Share/private",
      });
      await set(ref(ctx.database(), "editKeys/test"), "private");
    });
    const db = env.unauthenticatedContext().database();
    await assertSucceeds(get(ref(db, `races/${id}`)));
    await assertFails(get(ref(db, "races")));
    await assertSucceeds(get(ref(db, "slugs/highline-run")));
    await assertFails(get(ref(db, "slugs")));
    await assertFails(set(ref(db, "slugs/highline-run"),id));
    for(const kind of ["courses","tracks"]) {
      await assertSucceeds(get(ref(db,`${kind}/${id}`)));
      await assertFails(get(ref(db,kind)));
      await assertFails(set(ref(db,`${kind}/${id}/tampered`),true));
    }
    await assertFails(get(ref(db, "jobs/test")));
    await assertFails(get(ref(db, "editKeys/test")));
    await assertFails(set(ref(db, `races/${id}/name`), "tampered"));
  } finally {
    await env.cleanup();
  }
});
