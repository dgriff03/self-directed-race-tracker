import { parseKml } from "../../shared/kml.js";
export { parseKml } from "../../shared/kml.js";
export function validateFeed(raw: string) {
  const url = new URL(raw);
  if (["share.garmin.com", "share.inreach.garmin.com"].includes(url.hostname) && /^\/[^/]+\/?$/.test(url.pathname)) {
    url.pathname = "/Feed/Share/" + url.pathname.split("/")[1];
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    ![
      "share.garmin.com",
      "share.inreach.garmin.com",
      "inreach.garmin.com",
      "us0.inreach.garmin.com",
      "explore.garmin.com",
    ].includes(url.hostname) ||
    !/^\/(Feed\/Share\/|feed\/Share\/|ECC\/Chat\/KmlFeed\/)/i.test(url.pathname)
  )
    throw new Error("Use a Garmin HTTPS MapShare or KML feed URL.");
  return url;
}
export async function fetchFeed(raw: string, since: number) {
  const url = validateFeed(raw);
  url.searchParams.set("d1", new Date(since).toISOString());
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: {
      Accept: "application/vnd.google-earth.kml+xml, application/xml",
    },
  });
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) > 5_000_000
  )
    throw new Error("Feed unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty feed");
  const decoder = new TextDecoder();
  let xml = "",
    bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 5_000_000) throw new Error("Feed too large");
      xml += decoder.decode(value, { stream: true });
    }
    xml += decoder.decode();
    return parseKml(xml);
  } finally {
    await reader.cancel();
  }
}
