# Milemark

Desktop and mobile race tracking with MapLibre GL, Firebase Realtime Database (WebSocket subscriptions), and Firebase scheduled Cloud Functions. No sign-in: independent cryptographically random UUIDs grant viewer and editor access.

For a deep dive into the system design, data flows, and security model, see the [System Architecture Documentation](docs/ARCHITECTURE.md).

## Run

Use Node 22.13+ (Node 24 works for local frontend development) and npm.

```sh
npm ci
npm --prefix functions ci
npm run dev:frontend
```

Open the printed URL. `/demo` is an explicitly labeled sample course; `/setup` is the real editor. Creating real races requires Firebase configuration below. No fake success or local-only race creation is used.

## Deploy to Firebase

Firebase Hosting is the production target so the frontend, private API, and scheduled ingestion share one project. A Firebase project with billing enabled is needed for scheduled functions. Create a Realtime Database and register a Firebase web app in that project.

1. Copy `public/firebase-config.example.json` to `public/firebase-config.json`. Fill in the **web app** configuration (public identifiers, never service account credentials). Use your database's exact URL, including regional hostname when applicable. Leave `apiBase` as `/api` for Firebase Hosting. Creation calls use the direct us-central1 function URL to avoid a shared CDN rate-limit bucket; edit calls use `apiBase`.
2. Sign in with `npx firebase login`, then select the project with `npx firebase use --add`.
3. Build and deploy:

```sh
npm run typecheck
npm test
npm run build:frontend
npm run build:functions
npx firebase deploy --only database,functions,hosting
```

The Hosting predeploy check refuses missing, placeholder, or emulator Firebase configuration, so a demo-only build cannot be accidentally published as the live app.

Deploy the database rules together with the functions; do not use test-mode database rules. The scheduled `pollGarmin` function runs every five minutes even with no viewers. Open `/setup`, upload a GPX, choose a start date/time, paste the Garmin MapShare or KML feed URL, and add stations. Bookmark the private edit URL and share only the viewer URL.

For another static host, publish `dist/client`, configure SPA fallback to `index.html`, and set `apiBase` to the HTTPS `api` function URL. Firebase still owns the backend. The production build is the Vite SPA (`build:frontend`); there is no alternate routing framework.

## Local Firebase emulators

Java 21+ is required by the database emulator. Use the demo project to prevent accidental production writes.

```sh
npm run build:functions
npx firebase emulators:start --only database,functions --project demo-paceline
```

For browser integration, create `public/firebase-config.json` with:

```json
{
  "apiKey": "demo-key",
  "projectId": "demo-paceline",
  "appId": "demo-app",
  "databaseURL": "https://demo-paceline.firebaseio.com",
  "apiBase": "http://127.0.0.1:5001/demo-paceline/us-central1/api",
  "emulator": true
}
```

Use `127.0.0.1` as the browser hostname. Do not deploy emulator configuration. The scheduler itself is not run by this emulator command; tests exercise its ingestion engine separately.

```sh
npm run test:rules
node tests/integration.mjs
node tests/scheduler.mjs
```

`tests/browser.mjs` tests the production preview at `127.0.0.1:4173` with Chrome: responsive layout, GPX upload, aid stations, estimate toggling, missing-config handling, and a cold offline reload. It expects no Firebase configuration. `tests/live-browser.mjs` uses emulator configuration to verify cross-viewer updates, editing, and completion.

## Behavior and limits

- Public records are under `/races/{viewerUUID}`. Feed URLs are exclusively under denied `/jobs`; only hashes of editor UUIDs are stored in denied `/editKeys`. Public records and editor GET responses never include the KML URL. There is no list-races endpoint. API calls use the edit capability as a bearer header. Referrers are reduced to the origin so URL capabilities are not sent to map providers. There are no analytics or third-party scripts.
- URLs are bearer credentials, not recoverable accounts. Anyone receiving the edit URL can edit/finish that race. Treat browser history and shared screenshots accordingly. There is no link recovery or rotation in v1.
- Only HTTPS Garmin feed hosts and feed paths are accepted. Redirects, URL credentials, oversized responses, and XML entities are rejected. Garmin errors are sanitized. Use one runner per feed; password-protected feeds and multiple devices are not supported in v1.
- GPX files may contain up to 10 MB. Larger routes are automatically simplified to at most 6,000 points using geometry and elevation error. Routes must be 0.1–2,000 km. Distances are displayed and entered in miles; pace is minutes per mile. Existing database distances stay in km for compatibility. Start time is entered in the organizer's local timezone and stored as an absolute timestamp.
- A route-relative station distance distinguishes visits to the same location on loops. Map picking chooses the first near-equal route segment; enter the distance manually for later visits. Route/start/stations lock once the first position is accepted. Names and feed configuration remain editable during tracking. Saving a replacement feed resumes paused tracking. The editor shows live poll diagnostics and offers a rate-limited test of the saved feed.
- GPX elevation profiles are retained in meters, and vertical progress is displayed in feet. Cumulative ascent includes positive elevation changes only, interpolated at confirmed route progress. This estimates course ascent completed, not measured barometric gain. Elevation gaps are interpolated by distance (edge gaps use the nearest elevation); profiles with fewer than two valid elevations show unavailable; existing races can upload the same route with elevations without resetting stations or splits.
- Ambiguous jumps onto nearby earlier/later trail sections and unusually fast large jumps wait for a second distinct, consistent fix before changing progress or splits. GPS projections remain estimates, not ground truth.
- Fixes are sorted and deduplicated by timestamp. Progress is monotonic, constrained to a reachable window at up to 25 km/h, and ignored farther than 250 m off-route. This targets running/hiking races; it is not configured for cycling. Highly ambiguous loops, GPS gaps, and shortcuts can still produce uncertain progress.
- Splits are interpolated between positions, **not exact observed crossing times**. ETA uses average confirmed pace. Past ETAs retain their projected date/time and show minutes overdue. The optional estimated marker projects average pace for at most 10 minutes and is labeled separately from the Garmin fix.
- Finish requires progress within 50 m of the end and a fix within 75 m of the finish. It atomically marks the race complete; subsequent polls skip it. Manual completion stops checks without inventing missing splits. Archive URLs remain usable indefinitely while the Firebase data is retained.
- Garmin is polled every five minutes. Every poll writes a health heartbeat, even when Garmin returns no new fix or fails. The UI separately shows network connection, heartbeat freshness (12.5-minute threshold), feed success, and the timestamp of the last GPS fix.
- Service worker precaches the complete app bundle. Public Firebase SDK configuration is cached network-first. Viewer snapshots are saved in IndexedDB with migration from the old localStorage cache; a previously opened race reloads offline. Tiles already viewed are cached on demand, with a 300-tile limit. New areas/zoom levels may be blank offline, but the vector route, position markers, and splits still render. No private API responses or feed links are cached.
- Default basemap: OpenStreetMap raster tiles with visible attribution; no bulk tile prefetch. For larger production audiences use a tile provider appropriate to your volume and offline requirements. Set `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` at build time to use a dedicated provider. Custom-provider tiles use normal HTTP caching; the service worker only caches the default OSM host.
- Polling pauses after 24 hours without a new GPS fix (or since start/resume). The archive is not marked complete. The organizer can resume from the edit page for another 24-hour window.
- Static and dynamic race fields have independent realtime subscriptions, preserving existing URLs and reflecting organizer edits without redownloading route geometry on heartbeat changes.
- Creation is limited to 10 races per observed client/proxy IP per hour, using the rightmost Cloud Run forwarded hop. Client-prepended values cannot change this bucket. Quota entries older than a day are removed in bounded batches. Jobs use transaction leases to avoid duplicate polling. Realtime Database changes are transactional so completion cannot be overwritten by a pending poll. This v1 is designed for a small number of simultaneous personal races, not a public mass-event service.

## Verification

Unit tests cover interpolation, stale/future/off-route fixes, loop ambiguity, automatic completion, KML variants, and feed URL restrictions. Emulator tests enforce capability isolation, mutation denial, sanitized responses, optimistic revision checks, and manual completion. Browser tests check desktop/mobile and offline behavior.

API and implementation references: [Firebase scheduled functions](https://firebase.google.com/docs/functions/schedule-functions), [Realtime Database web reads](https://firebase.google.com/docs/database/web/read-and-write), [MapLibre raster maps](https://maplibre.org/maplibre-gl-js/docs/examples/map-tiles/), [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Verification against a real Garmin feed

Automated tests mock Garmin; they cannot prove Garmin redirects, account sharing, or timestamp variants in a specific live account. Use the editor's **Test saved Garmin feed** with a working feed, then confirm the last-poll diagnostics and viewer movement. The test is server-side and does not expose the private feed URL. On September 11, 2026, the supplied Garmin feed returned HTTP 200 without redirect; the production fetcher accepted a millisecond ISO d1 filter and returned zero recent positions. The deployed Cloud Function also returned ok with zero positions. Moving-point ingestion and race splits against a live device remain unverified.

`tests/production.mjs` performs scoped cleanup in a finally block using the authenticated Firebase CLI. If cleanup fails it reports an exact recovery file. Set `RACE_TEST_ORIGIN` only to this project's deployment. Emulator tests require Java 21+; a missing Java installation is an environment limitation, not a test pass.
