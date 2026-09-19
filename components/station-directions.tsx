import { useRef, useState } from "react";
import { atDistance, type Race, type Station } from "../shared/race";

export default function StationDirections({
  race,
  station,
  offline,
  prominent = false,
}: {
  race: Race;
  station: Station;
  offline: boolean;
  prominent?: boolean;
}) {
  const [lng, lat] = atDistance(race.route, race.distances, station.km);
  const coordinates = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  const field = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const selectCoordinates = () => {
    field.current?.focus();
    field.current?.select();
    field.current?.setSelectionRange(0, coordinates.length);
  };
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable");
      await navigator.clipboard.writeText(coordinates);
      setMessage("GPS coordinates copied. Paste into your maps app.");
    } catch {
      selectCoordinates();
      setMessage(
        "Touch and hold the coordinates, then choose Copy. Paste into your maps app.",
      );
    }
  };
  return (
    <div className="station-directions">
      <div className="directions-actions">
        <a
          className={prominent ? "button secondary" : undefined}
          href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {prominent ? `Drive to ${station.name}` : "Driving directions"}
        </a>
        <button type="button" className="button secondary" onClick={copy}>
          Copy GPS coordinates
        </button>
      </div>
      <input
        ref={field}
        className="gps-coordinates"
        aria-label={`${station.name} GPS coordinates (latitude, longitude)`}
        value={coordinates}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
      />
      {offline && (
        <small>
          Offline: copy these coordinates and paste into your maps app’s search.
          The directions link may need internet.
        </small>
      )}
      <span className="coordinate-feedback" role="status" aria-live="polite">
        {message}
      </span>
    </div>
  );
}
