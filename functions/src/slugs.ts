import { getDatabase } from "firebase-admin/database";
import { validSlug } from "../../shared/race-reference.js";
export const MAX_RACE_SLUGS = 5;
// Private per-race ledger bounds permanent claims, including pending assignments.
// Existing aliases are seeded lazily so older races cannot bypass the limit.
export async function claimSlug(slug: string | undefined, id: string) {
  if (!slug) return;
  if (!validSlug(slug)) throw Error("Invalid race slug.");
  const db = getDatabase(),
    ledger = db.ref(`slugClaims/${id}`);
  let legacy: Record<string, boolean> = {};
  if (!(await ledger.get()).exists()) {
    const aliases = await db.ref("slugs").orderByValue().equalTo(id).get();
    for (const key of Object.keys(aliases.val() ?? {})) legacy[key] = true;
  }
  const slot = await ledger.transaction((current) => {
    const history = current ?? legacy;
    if (Object.hasOwn(history, slug)) return history;
    if (Object.keys(history).length >= MAX_RACE_SLUGS) return;
    return { ...history, [slug]: true };
  });
  if (!slot.committed)
    throw Error(
      "A race can reserve at most five slugs, including previous names.",
    );
  const result = await db
    .ref(`slugs/${slug}`)
    .transaction((current) => (!current || current === id ? id : undefined));
  if (!result.committed) {
    // Another race owns this immutable name; a failed availability attempt should
    // not consume one of our five slots. An uncertain network failure retains it.
    await ledger.child(slug).remove();
    throw Error("That race slug is already taken. Choose another.");
  }
}
