import { isIP } from "node:net";
// Cloud Run appends the peer it observed. Never trust client-prepended entries.
// Creation calls use the function origin directly, avoiding the Hosting CDN hop.
export function requestIp(
  forwarded: string | string[] | undefined,
  peer?: string,
) {
  const value = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded)
    ?.split(",")
    .at(-1)
    ?.trim();
  const candidate = value && isIP(value) ? value : peer;
  if (!candidate || !isIP(candidate)) return "unknown";
  return candidate.startsWith("::ffff:")
    ? candidate.slice(7)
    : candidate.toLowerCase();
}
