# Review resolution

1. **Cold offline load:** public Firebase config is precached and network-first with cache fallback. Failed config initialization can retry. Verified a real `/r/:id` in a newly opened offline tab and automatic reconnection.
2. **Abandoned races:** Garmin polling runs every five minutes and pauses after 24 hours without a fix, measured from start, last fix, or organizer resume. Paused races retain splits and are not marked finished. The editor offers Resume Garmin tracking.
3. **Bandwidth:** retained the existing database schema and links, but moved the client to individual field subscriptions. Large route fields remain subscribed for legitimate organizer edits; heartbeats only deliver small changed-field messages. A 6,000-point race regression checks heartbeat websocket frames remain below 10 KB. An onValue callback containing a full snapshot is not itself evidence of a full network transfer.
4. **MapShare links:** supported Garmin share-page URLs normalize to Feed/Share URLs on the server; credentials and unapproved hosts remain rejected.
5. **Large GPX:** automatically simplifies routes over 6,000 points using iterative Douglas–Peucker with elevation included in the error metric. Endpoints and route order are retained. Simplification can reduce measured distance/ascent, as with any downsampling. The 10 MB upload limit remains.
6. **Proxy IP extraction (corrected after follow-up):** the framework does enable proxy handling, but trusting the leftmost forwarded IP still permits spoofed bucket selection. Creation now calls the direct function origin; the backend uses the rightmost Cloud Run-observed hop, ignores client-prepended entries, and expires old quota records. Proxies still share buckets. Regression tests cover injected prefixes.
7. **Marker churn:** projected-location marker persists and moves via setLngLat. Static markers do not rebuild on clock ticks or heartbeat updates; their relevant data signature controls updates.
8. **Viewport reset:** bounds fitting depends on route coordinate content, not array identity. Fresh snapshots of the same route preserve pan/zoom.
9. **UTC parsing:** timezone-less Time UTC fields receive an explicit UTC suffix, with ISO timestamps using Z. Tested with America/Denver process timezone.
10. **Elevation gaps:** interior gaps interpolate by along-route distance; edge gaps use the nearest known value. At least two valid elevations are required. A completely missing profile remains unavailable.
11. **Offline storage:** race snapshots use IndexedDB; old localStorage entries migrate on access. Failed saves show a warning rather than failing silently.
12. **Delayed ETA:** retains the ETA and shows minutes overdue.
13. **Basemap:** an API key is not universally required by the OSM tile policy. Attribution, HTTPS, origin referrer, and on-demand-only caching remain. Cached tiles now honor max-age, with a seven-day fallback and stale offline fallback. VITE_MAP_TILE_URL / VITE_MAP_ATTRIBUTION allow a dedicated provider at build time. No paid provider was selected or provisioned. Policy: https://operations.osmfoundation.org/policies/tiles/ .

Validation: course/feed unit tests; TypeScript and frontend/functions builds; scheduler emulator tests covering heartbeat without fixes, errors, finish, expiry; desktop/mobile units test; real-race offline/reconnect and websocket payload regression; 16,000-point GPX upload with missing elevation; stable marker identity across timer ticks.


## Follow-up review

- Created an initial local Git commit before the follow-up fixes to establish a reviewable baseline.
- Replaced station JSON-string comparisons with field equality; emulator regression saves a name and replacement feed after a fix exists, and rejects an actual station change.
- Added confirmation of suspicious jumps before split creation, including a parallel-trail outlier/recovery regression. This reduces isolated errors but does not guarantee perfect matching on repeated ambiguous fixes.
- Added live editor health, heartbeat dates, and a rate-limited test of the saved feed; feed replacement also resumes paused jobs.
- Removed unused Next/Vinext/Cloudflare/Drizzle starter code and unused UI primitives, pruning 437 packages. Vite/Firebase is the single supported runtime.
- Service-worker config precaching is optional; updates wait for old tabs to close before activating and clearing old caches, protecting old lazy bundles.
- Normalized uppercase UUIDs, memoized map geometry signatures, included dates with times, added latency copy, quota cleanup, HSTS and CSP, and automatic production-test cleanup.
- Rewrote architecture documentation to match current behavior.
- Garmin connectivity and empty-feed handling were verified on September 11, 2026 with the organizer-supplied feed, both locally through the production fetcher and from the deployed Cloud Function. HTTP 200, no redirect, millisecond ISO d1 accepted, zero recent positions. Temporary verification data was removed. Moving-device ingestion and live splits remain unverified.

Additional real-data verification: the deployed Cloud Function parsed 145 historical timestamped points from the second supplied Garmin feed using a September 6, 2026 d1 filter. Latest fix: September 7 at 18:25:30 UTC. No positions in the last 24 hours; temporary records removed. Course-specific split matching remains outside this feed-only check.

## September 11 review: rate limits, maps, out-and-back, and replay

1. **Creation IP bucket: finding does not follow the current browser path.** `lib/firebase.ts` already selects the direct Cloud Function origin for `/races`, even with `apiBase: "/api"`; only edit requests use Hosting. Extracted this routing decision into `lib/api-url.ts` and added regression coverage for production and emulator configuration. Kept the trusted-proxy IP parsing instead of trusting client-controlled leftmost forwarded headers. This does not claim to have tested two independent real-world network origins.
2. **Global map coverage: fixed.** Default selection uses USGS in coarse U.S. regions and OpenStreetMap elsewhere. USGS request failures trigger OSM fallback with correct attribution. Tile HTTP responses are checked by a MapLibre protocol handler because 404 tiles can be treated as empty without a map error event. Route overlays initialize on style readiness, independent of tile loading. Mocked 404/browser tests cover fallback and international routes.
3. **Out-and-back switchbacks: fixed.** Ambiguous positions now use directional recent-motion consistency and pending-fix corroboration. Confirmed pending points retain their timestamps for splits and reversal evidence. A lone jump followed by a return to the earlier trail cannot corroborate the jump. Tests cover this rejection and sustained switchback progress.
4. **Custom tile caching: fixed.** The build injects the configured tile template into a narrow service-worker allowlist. USGS, OSM, and exact custom templates are cached on demand, with a 300-tile bound, freshness metadata, `Cache-Control`/`Expires` handling, and stale fallback on network failure. `no-store`, authorization-bearing, private API, and unconfigured tile requests are excluded. No bulk tile downloads are provided; see [OSM's usage policy](https://operations.osmfoundation.org/policies/tiles/).
5. **Station ETA discontinuity: fixed.** Entering a station no longer switches recent pace to overall pace just because of dwell. Recent-pace downstream allowances stay in place, with the current stop's remaining allowance counted separately. Sparse overall-pace estimates retain the prior no-double-counting rule. Arrival and dwell tests verify continuity.
6. **Replay serialization: reported 10 Hz behavior was not reproduced.** `ReplayEngine.seek()` returns the identical race object between recorded fixes. Added an identity regression test. Also removed full track/journey serialization from the marker signature; the completed track now updates independently of markers, including asynchronous realtime track-field updates. Full marker values still participate, so same-count station renames/moves remain visible.
7. **Out-and-back route tolerance: relaxed.** Mirrored route samples and endpoints now allow 200 meters of deviation. Different return trails still fail validation. The planned midpoint assumption remains; this is not general loop matching.
8. **Dense replay capacity: increased.** Replay accepts up to 100,000 timestamped points within the existing 25 MB file limit. Positions are retained instead of downsampled, preserving stop/turn evidence. Browser and engine tests cover 17,280 five-second samples spanning a day.

## Follow-up review: conservative returns and replay responsiveness

- Switchback corroboration and global basemap fallback were already deployed in `640605e`; retained their regression tests.
- Increased automatic early-return retreat to 500 m, required no new peak in the evidence window, and reset reversal evidence on every new peak. Added tests for a 200 m retreat/linger and peak reset. Manual direction controls remain available.
- Kept current-position return progress for correct ETA arithmetic and added an explicit viewer/replay explanation that backtracking can decrease it.
- Moved replay KML validation/parsing into a cancellable worker with loading feedback. Worker assets are included by the existing offline precache build. Debounced slider updates by 150 ms and flush on pointer/key release.
- Manual direction changes retain and remap the previous GPS sample, preserving dwell movement evidence.
- The legend now uses a dark line for Completed and an orange dot for Last known location.
- Added named npm scripts for replay, out-and-back and map browser tests, plus `test:browser` to run them together. Prerequisites are documented in README.
