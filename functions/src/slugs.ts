import { getDatabase } from "firebase-admin/database";
import { validSlug } from "../../shared/race-reference.js";
// Claims are immutable aliases. Keeping old claims prevents shared links from ever
// being reassigned to a different race, including retries after partial failures.
export async function claimSlug(slug: string | undefined, id: string) {
  if (!slug) return;
  if (!validSlug(slug))
    throw Error(
      "Use 3–40 lowercase letters, numbers and hyphens, starting with a letter. SMS commands are reserved.",
    );
  const result = await getDatabase()
    .ref(`slugs/${slug}`)
    .transaction((current) => (!current || current === id ? id : undefined));
  if (!result.committed)
    throw Error("That race slug is already taken. Choose another.");
}
