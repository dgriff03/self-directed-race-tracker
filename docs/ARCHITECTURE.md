# Milemark architecture

Milemark is a React/Vite single-page app backed by Firebase Hosting, Realtime Database, and two Node 22 Cloud Functions in us-central1. MapLibre draws the GPX route, aid stations, confirmed track and location, and an optional estimated marker. The app uses independent UUID viewer and edit links; there are no accounts.

## Routes and frontend

`client.tsx` selects `/`, `/setup`, `/edit/:token`, `/r/:id`, or `/demo`. UUIDs are normalized to lowercase. Production runs the Vite SPA; alternate Next/Vinext/Cloudflare starter routes have been removed. MapLibre geometry and marker update keys are memoized, bounds fit only when the actual route changes, and the estimated marker moves without rebuilding other markers.

GPX parsing accepts files up to 10 MB. Routes exceeding 6,000 points are simplified with iterative Douglas–Peucker using both horizontal and elevation error. Missing elevation is interpolated by course distance; edge gaps use the nearest known elevation. Profiles with fewer than two valid elevations remain unavailable. Storage uses kilometers and meters; UI uses miles, feet, and minutes per mile. Completed ascent is estimated from the GPX profile at confirmed route progress.

## Backend and storage

- `api` handles creation and bearer-authorized edit, completion, resume, and test-feed actions. It validates route/station constraints, normalizes Garmin MapShare links, and never returns the feed URL. Post-start route/station checks compare values rather than object serialization order, allowing name and feed edits. Saving a new feed also resumes a paused job.
- `pollGarmin` runs **every five minutes**, independent of viewers. It queries active jobs, claims transaction leases, and fetches KML since the previous fix. Every attempted poll writes a heartbeat and success/failure state even if no point arrives. It removes expired rate-limit entries in bounded batches.
- `/races/{viewerUUID}` contains the public race. Exact UUIDv4 keys are readable; listing and client writes are denied. Individual top-level field subscriptions allow static geometry and dynamic state to update independently without schema migration. Static fields remain subscribed so legitimate organizer changes are visible.
- `/jobs/{viewerUUID}` contains the private feed URL, active flag, start time, lease, resume time and diagnostic-test throttle. All client reads/writes are denied.
- `/editKeys/{SHA256(editToken)}` privately maps independent edit UUIDs to races. Tokens are sent in Authorization headers, not API query strings.
- `/limits/{ipHash}` limits creation to ten attempts per hour. Creation uses the direct function origin to avoid the Hosting CDN hop; the backend uses the rightmost Cloud Run-observed forwarded IP, not a client-prepended value. Shared proxies still share buckets. Old entries expire after one day; this is abuse friction, not authentication.

## Tracking lifecycle

Before start, the viewer shows the scheduled start. Polling skips future jobs. Points are sorted, deduplicated, and rejected if pre-start, in the future, too far off-route, or unreachable. Confirmed progress is monotonic. Ambiguous jumps between nearby trail sections, and unusually fast large advances, require a second distinct consistent fix before progress and splits change. This reduces isolated GPS-error jumps but cannot eliminate all ambiguity.

Aid crossings interpolate between confirmed positions. Moving pace uses a rolling window of recent fixes (40 minutes), falling back to overall average pace when fixes are sparse. While a runner is stopped at an aid station, status reports "At aid station", pace reflects resting state, and estimated map location is pinned at the station. ETAs to downstream stops assume a 10-minute stop at each intermediate aid station, and when using recent pace at an aid station, ETAs retain downstream allowances and add the remaining dwell time at the current station. Overdue ETAs keep the projected date/time and show minutes overdue. Dates accompany times for multi-day races. Estimated position is clearly marked and projects rolling pace for at most ten minutes.

Finishing automatically or manually deactivates polling and leaves the viewer URL as an archive. No new fix for 24 hours since start, last fix, or resume pauses polling without claiming a finish. The organizer can resume or replace the feed. Feed diagnostics show the last heartbeat and health, plus a rate-limited server-side test button. With five-minute polls and a ten-minute inReach interval, position latency can approach fifteen minutes.

## Offline and updates

The service worker precaches the app shell and hashed bundles; public Firebase config is optional during installation and subsequently cached network-first. Private API requests are never cached. IndexedDB stores race snapshots, migrating old localStorage snapshots on access; storage failures are reported.

Cold offline navigation renders the cached shell and race, reports offline state and last-update time, and reconnects when connectivity returns. Configured basemap tiles are cached only on demand (300-tile cap), respect cache lifetime, and may be served stale offline. Unvisited areas can be blank offline while the vector route and splits remain available.

New workers wait for old tabs to close before activation and cache cleanup. This preserves precached old lazy chunks for already-open pages. Core asset installation failures prevent activation; optional config failure does not discard the offline shell.

## Privacy and boundaries

Garmin HTTPS hosts and paths are allowlisted; credentials, redirects, XML entities, and excessive responses are rejected. Time UTC fields are explicitly interpreted in UTC. Feed URLs stay server-side, but Garmin MapShare itself may be publicly discoverable from a known share name. Magic links are bearer credentials, not recoverable accounts. Referrers expose only origin; Hosting includes HSTS and CSP. USGS attribution is visible, or OpenStreetMap attribution when using global fallback. A custom tile provider can be configured with `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION`; no paid provider has been provisioned.

## Verification and deployment

Run `npm ci`, `npm --prefix functions ci`, `npm run typecheck`, `npm test`, and `npm run build`. Deploy `database,functions,hosting` to the selected Firebase project. Build outputs are intentionally ignored by Git and reproducible from source plus the private local public-SDK config file. Firebase predeploy rejects missing or emulator production configuration.

Tests cover course ingestion, timestamps, capability rules, post-start edits, pause/resume, scheduler behavior, offline/reconnect, payload size, large GPX and mobile layout. Database emulator suites require Java 21+. The production smoke test cleans only its own created records in a finally block, reporting recovery instructions if cleanup fails.

**Garmin connectivity verified September 11, 2026:** the organizer-supplied feed returned HTTP 200 KML with no redirect. The production fetcher accepted millisecond ISO d1 and returned zero positions for the previous day; a deployed Cloud Function test also returned healthy with zero positions. Its temporary race and private job were removed. Actual moving-device ingestion, timestamp variants, and race splits still require live-device verification.

A second supplied feed was verified the same day: an unfiltered request returned one latest point, while the deployed Cloud Function returned **145 timestamped points** with `d1=2026-09-06T00:00:00.000Z`. The latest point was September 7, 2026 at 18:25:30 UTC; the last-24-hour query was empty. This confirms real historical Garmin data ingestion through the deployed fetcher. Live movement and course-specific split matching still require a corresponding GPX and active device. Temporary test records were removed.


### ETA refinement

ETA uses a 40-minute recent pace window when enough samples exist, with slow positive pace floored at half the overall average. Sparse/zero-movement samples use overall pace, which already includes stops and therefore receive no extra dwell allowance. Recent-pace estimates add an explicit fixed ten-minute allowance for each intermediate station, retaining those allowances during station dwell. The remaining portion of the current stop is added separately. This assumption is not yet configurable. Station dwell requires a recorded split and proximity by both route distance and coordinates; mere approach is not arrival. The viewer reuses one memoized dwell/pace calculation across station ETAs.

Consistent movement following corroborated switchbacks can use the last accepted segment as evidence, avoiding an every-other-fix delay. Corroborated pending positions retain their original timestamps for split interpolation. Isolated ambiguous jumps still wait for confirmation.

Feed diagnostics include at least the previous 24 hours even before the race starts. CSP permits Firebase RTDB long-poll transport hosts so viewers can connect without WebSockets. The production smoke test explicitly disables WebSockets for its viewer. Unused D1 examples and the unreferenced original PNG were removed; the visible WebP topo background and provenance remain.

### Explicit out-and-back tracking

`outAndBack` is a pre-start configuration flag for full retraced GPX routes. `journey` stores outbound chainage, furthest confirmed position/time, reversal evidence, direction, and recent return samples. Both are public realtime fields and are included in offline snapshots. Existing races without the flag keep the original matching behavior.

In this mode `progressKm` is chainage on the original planned GPX (outbound position or total minus outbound position on return). Display helpers calculate the shortened total and distance completed without counting the skipped middle of the course. Elevation helpers likewise exclude the bypassed segment. Station positions remain stored in original route chainage; skipped status and revised displayed mileage are derived. The planned GPX and earlier crossings remain available after completion.

Direction overrides run inside the private edit API's RTDB transaction, sharing the scheduler's atomic race state. They increment configuration revision. Returning mode can be undone only while the trip is active; it removes inferred return crossings and rearms early detection after renewed outbound progress. The scheduler stops on completion through the existing lifecycle. Replay uses the same engine with a simulated clock, so backward seeking reconstructs the earlier direction and split state.
