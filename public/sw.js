const VERSION = "milemark-v10";
const PRECACHE = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];
const offlineClients = new Set();
const SHELL = VERSION + "-shell";
const TILES = VERSION + "-tiles";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(async () => {
        const cache = await caches.open(SHELL);
        await Promise.allSettled([cache.add("/firebase-config.json")]);
      }),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                (k.startsWith("paceline-") || k.startsWith("milemark-")) &&
                !k.startsWith(VERSION),
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.pathname.startsWith("/api") ||
    req.headers.has("Authorization")
  )
    return;
  // Public SDK identifiers are safe to cache; private API responses remain excluded.
  if (
    url.origin === self.location.origin &&
    url.pathname === "/firebase-config.json"
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        try {
          const response = await fetch(req);
          if (response.ok) await cache.put(req, response.clone());
          return response;
        } catch {
          return (await cache.match(req)) || Response.error();
        }
      })(),
    );
    return;
  }
  if (req.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((r) => {
          offlineClients.delete(event.resultingClientId || event.clientId);
          return r;
        })
        .catch(async () => {
          offlineClients.add(event.resultingClientId || event.clientId);
          return (
            (await caches.match("/index.html")) ||
            (await caches.match("/")) ||
            Response.error()
          );
        }),
    );
    return;
  }
  const asset =
    url.origin === self.location.origin &&
    (/^\/assets\//.test(url.pathname) ||
      ["/favicon.svg", "/manifest.webmanifest"].includes(url.pathname));
  const tile = url.hostname === "basemap.nationalmap.gov" && url.pathname.startsWith("/arcgis/rest/services/USGSTopo/MapServer/tile/");
  if (!asset && !tile) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(tile ? TILES : SHELL);
      const cached = await cache.match(req, { ignoreVary: !tile });
      if (cached && !tile) return cached;
      if (cached && tile) {
        const age = Date.now() - Date.parse(cached.headers.get("date") || "");
        const ttl =
          Number(
            cached.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ||
              604800,
          ) * 1000;
        if (Number.isFinite(age) && age < ttl) return cached;
      }
      let response;
      try {
        response = await fetch(req);
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
      if (response.ok) {
        await cache.put(req, response.clone());
        if (tile) {
          const keys = await cache.keys();
          for (const key of keys.slice(0, Math.max(0, keys.length - 300)))
            await cache.delete(key);
        }
      }
      return response;
    })(),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "OFFLINE_STATE") {
    event.ports[0]?.postMessage(offlineClients.has(event.source?.id));
    return;
  }
  if (event.data?.type !== "CACHE_ASSETS") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const urls = event.data.urls.filter((u) => {
        try {
          const p = new URL(u, self.location.origin);
          return (
            p.origin === self.location.origin &&
            p.pathname.startsWith("/assets/")
          );
        } catch {
          return false;
        }
      });
      await Promise.allSettled(urls.map((u) => cache.add(u)));
    })(),
  );
});
