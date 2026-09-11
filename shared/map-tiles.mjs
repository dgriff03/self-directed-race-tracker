export const USGS = {
  url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",
  maxzoom: 16,
  attribution:
    '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noreferrer">USGS The National Map</a>',
};
export const OSM = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  maxzoom: 19,
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
};
// Coarse coverage selection, followed by a runtime fallback for USGS tile errors
// (including border areas). Never claim this box precisely follows US borders.
export function preferredBasemap(route, customUrl, customAttribution) {
  if (customUrl)
    return {
      url: customUrl,
      maxzoom: 22,
      attribution: customAttribution || "Custom basemap",
    };
  const boxes = [
    [-125, 24, -66, 49.5],
    [-180, 51, -129, 72],
    [-161, 18, -154, 23],
    [-68, 17, -64, 19],
  ];
  return route.length &&
    route.every(([lng, lat]) =>
      boxes.some(
        ([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n,
      ),
    )
    ? USGS
    : OSM;
}
