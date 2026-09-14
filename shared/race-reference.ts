export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reserved = new Set([
  "yes",
  "unstop",
  "info",
  "update",
  "status",
  "again",
  "latest",
  "help",
  "stop",
  "stopall",
  "start",
  "unsubscribe",
  "cancel",
  "end",
  "quit",
  "revoke",
  "optout",
  "demo",
  "setup",
  "replay",
  "admin",
  "api",
  "edit",
]);
export function validSlug(value: string): boolean {
  return (
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) &&
    value.length >= 3 &&
    value.length <= 40 &&
    !UUID_PATTERN.test(value) &&
    !reserved.has(value)
  );
}
export function raceReference(input: string): string {
  let value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/r\/([^/]+)\/?$/);
    if (!match) throw Error("Use a race viewer URL.");
    value = match[1];
  }
  value = value.toLowerCase();
  if (!UUID_PATTERN.test(value) && !validSlug(value))
    throw Error("Enter a race slug, UUID, or viewer URL.");
  return value;
}
