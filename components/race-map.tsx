"use client";
import { useEffect, useRef, useState } from "react";
import {
  kmToMiles,
  atDistance,
  project,
  type Race,
  type Coordinate,
} from "../shared/race";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
export default function RaceMap({
  race,
  estimatedKm,
  onPick,
}: {
  race: Race;
  estimatedKm?: number;
  onPick?: (km: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  const estimateRef = useRef<import("maplibre-gl").Marker | null>(null);
  const routeKey = JSON.stringify(race.route);
  const markerKey = JSON.stringify([race.stations, race.splits, race.fix, race.track]);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState(false);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const raceRef = useRef(race);
  raceRef.current = race;
  useEffect(() => {
    let cancelled = false;
    import("maplibre-gl").then((m) => {
      if (cancelled || !element.current) return;
      m.setWorkerUrl(workerUrl);
      const map = new m.Map({
        container: element.current,
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster",
              tiles: [import.meta.env.VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: import.meta.env.VITE_MAP_ATTRIBUTION ||
                '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
            },
          },
          layers: [{ id: "base", type: "raster", source: "base" }],
        },
        center: raceRef.current.route[0] ?? [-105.29, 40.09],
        zoom: 11,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(
        new m.NavigationControl({ showCompass: false }),
        "top-right",
      );
      map.on("load", () => {
        setReady((v) => v + 1);
      });
      map.on("error", () => setError(true));
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
    };
  }, []);
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
    map.fitBounds(bounds, { padding: 55, duration: 0 });
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
        const data: any = {
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
      if (race.track.length > 1)
        line(
          "track",
          race.track.map((p) => [p.lng, p.lat]),
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
      race.stations.forEach((s, i) =>
        marker(
          atDistance(race.route, race.distances, s.km),
          `${s.name} · ${kmToMiles(s.km).toFixed(1)} mi`,
          race.splits.some((p) => p.stationId === s.id) ? "passed" : "aid",
          s.id === "finish" ? "F" : String(i + 1),
        ),
      );
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
    const map = mapRef.current;
    if (!map || !ready) return;
    if (estimatedKm === undefined || !race.fix) {
      estimateRef.current?.remove();
      estimateRef.current = null;
      return;
    }
    const point = atDistance(race.route, race.distances, estimatedKm);
    if (estimateRef.current) { estimateRef.current.setLngLat(point); return; }
    let active = true;
    import("maplibre-gl").then(m => {
      if (!active) return;
      const el = document.createElement("button");
      el.className = "map-marker estimated";
      const label = "Estimated location — projected from average pace";
      el.title = label;
      el.setAttribute("aria-label", label);
      estimateRef.current = new m.Marker({element: el}).setLngLat(point).setPopup(new m.Popup({offset:20}).setText(label)).addTo(map);
    });
    return () => { active = false; };
  }, [ready, estimatedKm, routeKey, !!race.fix]);
  return (
    <div className="map-wrap">
      <div className="map" ref={element} aria-label="Race route map" />
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
          <i className="dot-key" /> Last known
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
