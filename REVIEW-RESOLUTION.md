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
