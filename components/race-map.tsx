"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  stationSkipped,
  stationDistance,
  kmToMiles,
  atDistance,
  project,
  type Race,
  type Coordinate,
} from "../shared/race";
import "maplibre-gl/dist/maplibre-gl.css";
import { preferredBasemap, USGS, OSM } from "../shared/map-tiles.mjs";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
export default function RaceMap({
  race,
  estimatedKm,
  onPick,
  previewKm,
  onHover,
}: {
  race: Race;
  estimatedKm?: number;
  previewKm?: number;
  onHover?: (km?: number) => void;
  onPick?: (km: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [protocol] = useState(
    () => "milemarkusgs" + crypto.randomUUID().replaceAll("-", ""),
  );
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const estimateRef = useRef<import("maplibre-gl").Marker | null>(null);
  const routeKey = useMemo(() => JSON.stringify(race.route), [race.route]);
  const markerKey = useMemo(
    () =>
      JSON.stringify([
        race.stations,
        race.splits,
        race.fix,
        race.journey?.phase,
        race.journey?.turnaroundKm,
      ]),
    [
      race.stations,
      race.splits,
      race.fix,
      race.journey?.phase,
      race.journey?.turnaroundKm,
    ],
  );
  const preferred = useMemo(
    () =>
      preferredBasemap(
        race.route,
        import.meta.env.VITE_MAP_TILE_URL,
        import.meta.env.VITE_MAP_ATTRIBUTION,
      ),
    [routeKey],
  );
  const [failedProvider, setFailedProvider] = useState<string | null>(null);
  useEffect(() => {
    if (!failedProvider) return;
    const timer = setTimeout(() => setFailedProvider(null), 60000);
    return () => clearTimeout(timer);
  }, [failedProvider]);
  const basemap =
    failedProvider === preferred.url && preferred.url === USGS.url
      ? OSM
      : preferred;
  const [ready, setReady] = useState(0);
  const [error, setError] = useState(false);
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const raceRef = useRef(race);
  raceRef.current = race;
  useEffect(() => {
    let cancelled = false;
    let removeProtocol: ((name: string) => void) | undefined;
    setReady(0);
    setError(false);
    import("maplibre-gl").then((m) => {
      if (cancelled || !element.current) return;
      m.setWorkerUrl(workerUrl);
      if (basemap.url === USGS.url) {
        removeProtocol = m.removeProtocol;
        m.addProtocol(protocol, async (request, controller) => {
          try {
            const response = await fetch(
              request.url.replace(protocol + "://", "https://"),
              { signal: controller.signal },
            );
            if (!response.ok)
              throw Error(`USGS tile returned ${response.status}`);
            return {
              data: await response.arrayBuffer(),
              cacheControl: response.headers.get("cache-control") ?? undefined,
              expires: response.headers.get("expires") ?? undefined,
            };
          } catch (error) {
            // MapLibre treats tile 404s as empty, so inspect the HTTP response
            // here rather than relying solely on its map error event.
            if (!cancelled && !controller.signal.aborted && navigator.onLine)
              setFailedProvider(USGS.url);
            throw error;
          }
        });
      }
      const map = new m.Map({
        container: element.current,
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster",
              tiles: [
                basemap.url === USGS.url
                  ? basemap.url.replace("https://", protocol + "://")
                  : basemap.url,
              ],
              maxzoom: basemap.maxzoom,
              tileSize: 256,
              attribution: basemap.attribution,
            },
          },
          layers: [{ id: "base", type: "raster", source: "base" }],
        },
        center: raceRef.current.route[0] ?? [-105.29, 40.09],
        zoom: 11,
        cooperativeGestures: window.matchMedia("(pointer: coarse)").matches,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(
        new m.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.on("style.load", () => {
        setReady((v) => v + 1);
      });
      map.on("error", (event) => {
        if (cancelled) return;
        if (
          (event as typeof event & { sourceId?: string }).sourceId === "base" &&
          basemap.url === USGS.url &&
          navigator.onLine
        )
          setFailedProvider(USGS.url);
        else setError(true);
      });
      map.on("mousemove", (e) => {
        if (!hoverRef.current) return;
        const r = raceRef.current;
        hoverRef.current(
          project(r.route, r.distances, [e.lngLat.lng, e.lngLat.lat]).km,
        );
      });
      map
        .getCanvas()
        .addEventListener("mouseleave", () => hoverRef.current?.(undefined));
      map.on("click", (e) => {
        const r = raceRef.current;
        const match = project(r.route, r.distances, [
          e.lngLat.lng,
          e.lngLat.lat,
        ]);
        if (match.offKm < 1) pickRef.current?.(match.km);
      });
    });
    return () => {
      cancelled = true;
      estimateRef.current?.remove();
      estimateRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      removeProtocol?.(protocol);
    };
  }, [basemap.url]);
  useEffect(() => {
    const map = mapRef.current;
    const container = element.current;
    if (!map || !container || !ready) return;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !race.route.length) return;
    map.resize();
    const bounds: [Coordinate, Coordinate] = [
      [
        Math.min(...race.route.map((p) => p[0])),
        Math.min(...race.route.map((p) => p[1])),
      ],
      [
        Math.max(...race.route.map((p) => p[0])),
        Math.max(...race.route.map((p) => p[1])),
      ],
    ];
    map.fitBounds(bounds, {
      padding: element.current!.clientWidth < 500 ? 36 : 55,
      duration: 0,
    });
  }, [ready, routeKey]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let active = true;
    const markers: import("maplibre-gl").Marker[] = [];
    import("maplibre-gl").then((m) => {
      if (!active) return;
      const line = (
        id: string,
        coordinates: Coordinate[],
        color: string,
        width: number,
      ) => {
        const data: any =
          coordinates.length < 2
            ? { type: "FeatureCollection", features: [] }
            : {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates },
              };
        const source = map.getSource(id) as
          import("maplibre-gl").GeoJSONSource | undefined;
        if (source) source.setData(data);
        else {
          map.addSource(id, { type: "geojson", data });
          map.addLayer({
            id,
            type: "line",
            source: id,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-color": color, "line-width": width },
          });
        }
      };
      line("course-outline", race.route, "#fff", 8);
      line("course", race.route, "#e5672c", 4);
      line(
        "track",
        raceRef.current.track.map((p) => [p.lng, p.lat]),
        "#153f4a",
        5,
      );
      const marker = (
        point: Coordinate,
        label: string,
        kind: string,
        text: string,
      ) => {
        const el = document.createElement("button");
        el.className = `map-marker ${kind}`;
        el.textContent = text;
        el.title = label;
        el.setAttribute("aria-label", label);
        markers.push(
          new m.Marker({ element: el })
            .setLngLat(point)
            .setPopup(new m.Popup({ offset: 20 }).setText(label))
            .addTo(map),
        );
      };
      marker(race.route[0], "Start", "start", "S");
      race.stations.forEach((s, i) => {
        if (s.returnOf) return;
        const returning = race.stations.find((t) => t.returnOf === s.id);
        marker(
          atDistance(race.route, race.distances, s.km),
          `${s.name} · ${kmToMiles(stationDistance(race, s.km)).toFixed(1)} mi${returning ? ` · Return visit at ${kmToMiles(stationDistance(race, returning.km)).toFixed(1)} mi` : ""}${stationSkipped(race, s.id) ? " · Skipped on early return" : ""}`,
          race.splits.some((p) => p.stationId === s.id) ? "passed" : "aid",
          s.id === "finish" ? "F" : String(i + 1),
        );
      });
      if (race.fix)
        marker(
          [race.fix.lng, race.fix.lat],
          "Last known Garmin location",
          "runner",
          "",
        );
    });
    return () => {
      active = false;
      markers.forEach((m) => m.remove());
    };
  }, [ready, routeKey, markerKey]);
  useEffect(() => {
    const source = mapRef.current?.getSource("track") as
      import("maplibre-gl").GeoJSONSource | undefined;
    if (!ready || !source) return;
    source.setData(
      race.track.length < 2
        ? { type: "FeatureCollection", features: [] }
        : {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: race.track.map((p) => [p.lng, p.lat]),
            },
          },
    );
  }, [ready, race.track]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (estimatedKm === undefined || !race.fix) {
      estimateRef.current?.remove();
      estimateRef.current = null;
      return;
    }
    const point = atDistance(race.route, race.distances, estimatedKm);
    if (estimateRef.current) {
      estimateRef.current.setLngLat(point);
      return;
    }
    let active = true;
    import("maplibre-gl").then((m) => {
      if (!active) return;
      const el = document.createElement("button");
      el.className = "map-marker estimated";
      const label = "Estimated location — projected from average pace";
      el.title = label;
      el.setAttribute("aria-label", label);
      estimateRef.current = new m.Marker({ element: el })
        .setLngLat(point)
        .setPopup(new m.Popup({ offset: 20 }).setText(label))
        .addTo(map);
    });
    return () => {
      active = false;
    };
  }, [ready, estimatedKm, routeKey, !!race.fix]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || previewKm === undefined) return;
    let active = true;
    let marker: import("maplibre-gl").Marker | undefined;
    import("maplibre-gl").then((m) => {
      if (!active) return;
      const el = document.createElement("div");
      el.className = "map-marker draft-station";
      el.setAttribute(
        "aria-label",
        `Selected aid location: ${kmToMiles(previewKm).toFixed(2)} miles`,
      );
      marker = new m.Marker({ element: el })
        .setLngLat(atDistance(race.route, race.distances, previewKm))
        .addTo(map);
    });
    return () => {
      active = false;
      marker?.remove();
    };
  }, [ready, previewKm, routeKey]);
  return (
    <div className="map-wrap">
      <div className="map" ref={element} aria-label="Race route map" />
      {onPick && previewKm !== undefined && <div className="map-pick-hint">{kmToMiles(previewKm).toFixed(3)} mi · Click or tap to set aid distance</div>}
      {error && (
        <div className="map-notice">
          Some map tiles are unavailable. The route and splits remain available.
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="line-key" /> Race route
        </span>
        <span>
          <i className="completed-key" /> Completed
        </span>
        <span>
          <i className="location-key" /> Last known location
        </span>
        {estimatedKm !== undefined && (
          <span>
            <i className="estimate-key" /> Estimated
          </span>
        )}
      </div>
    </div>
  );
}
