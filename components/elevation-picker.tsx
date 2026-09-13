import { useMemo } from "react";
import { kmToMiles, metersToFeet } from "../shared/race";

export default function ElevationPicker({
  distances,
  elevations,
  selectedKm,
  onHover,
  onPick,
}: {
  distances: number[];
  elevations: number[] | null;
  selectedKm?: number;
  onHover: (km?: number) => void;
  onPick?: (km: number) => void;
}) {
  const total = distances.at(-1) ?? 0;
  const profile = useMemo(() => {
    if (!elevations || elevations.length !== distances.length || total <= 0)
      return null;
    const low = Math.min(...elevations),
      high = Math.max(...elevations);
    const y = (m: number) => 170 - ((m - low) / (high - low || 1)) * 140;
    return {
      low,
      high,
      y,
      path: distances
        .map(
          (km, i) =>
            `${i ? "L" : "M"}${50 + (km / total) * 520},${y(elevations[i])}`,
        )
        .join(" "),
    };
  }, [distances, elevations, total]);
  if (!profile)
    return (
      <p className="panel-note">
        Elevation profile unavailable. Upload a GPX with elevations to use the
        chart.
      </p>
    );
  const km = Math.max(0, Math.min(total, selectedKm ?? 0));
  let i = distances.findIndex((d) => d >= km);
  if (i < 0) i = distances.length - 1;
  const a = Math.max(0, i - 1);
  const elevation =
    elevations![a] +
    ((elevations![i] - elevations![a]) * (km - distances[a])) /
      (distances[i] - distances[a] || 1);
  const x = 50 + (km / total) * 520;
  const pickX = (
    e: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>,
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        total,
        ((((e.clientX - rect.left) / rect.width) * 600 - 50) / 520) * total,
      ),
    );
  };
  return (
    <div className="elevation-picker">
      <h3>Elevation profile</h3>
      <p>
        {kmToMiles(km).toFixed(2)} mi ·{" "}
        {Math.round(metersToFeet(elevation)).toLocaleString()} ft
      </p>
      <svg
        viewBox="0 0 600 210"
        role="img"
        aria-label="Course elevation in feet by distance in miles"
        onPointerMove={(e) => onPick && onHover(pickX(e))}
        onPointerLeave={() => onHover(undefined)}
        onClick={(e) => {
          if (onPick) {
            onPick(pickX(e));
            onHover(undefined);
          }
        }}
      >
        <path d={`${profile.path} L570,170 L50,170 Z`} fill="#e5672c18" />
        <path d={profile.path} fill="none" stroke="#cb5524" strokeWidth="2" />
        <path d="M50,25 V170 H570" fill="none" stroke="#92a3aa" />
        <text x="46" y="30" textAnchor="end">
          {Math.round(metersToFeet(profile.high))}
        </text>
        <text x="46" y="170" textAnchor="end">
          {Math.round(metersToFeet(profile.low))}
        </text>
        <text x="50" y="190">
          0 mi
        </text>
        <text x="570" y="190" textAnchor="end">
          {kmToMiles(total).toFixed(1)} mi
        </text>
        <text x="50" y="15">
          Elevation (ft)
        </text>
        <text x="300" y="205" textAnchor="middle">
          Distance (mi)
        </text>
        <line
          x1={x}
          x2={x}
          y1="25"
          y2="170"
          stroke="#153f4a"
          strokeDasharray="4 3"
        />
        <circle
          cx={x}
          cy={profile.y(elevation)}
          r="5"
          fill="#153f4a"
          stroke="white"
          strokeWidth="2"
        />
      </svg>
      {onPick && (
        <>
          <input
            aria-label="Aid station distance on elevation profile"
            type="range"
            min="0"
            max={total}
            step="0.001"
            value={km}
            onChange={(e) => {
              onHover(undefined);
              onPick(Number(e.target.value));
            }}
          />
          <small>
            Move to preview; click or tap to select. Use the slider for precise
            or keyboard selection. On retraced routes, the chart distinguishes
            outbound and return visits.
          </small>
        </>
      )}
    </div>
  );
}
