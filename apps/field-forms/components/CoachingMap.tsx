"use client";

import "leaflet/dist/leaflet.css";
import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Circle, Polyline, Popup } from "react-leaflet";
import L from "leaflet";

// Consumers must dynamic-import this with `ssr: false` — Leaflet touches
// `window` at module load time and will crash during Next.js server render.
// Example: const CoachingMap = dynamic(() => import("@/components/CoachingMap").then(m => m.CoachingMap), { ssr: false });

export type MapPinStatus = "planned" | "visited" | "missed" | "out_of_geofence" | "current";

export interface MapPin {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  status: MapPinStatus;
  geofenceRadiusM?: number;
  popupContent?: string;
}

const STATUS_COLORS: Record<MapPinStatus, string> = {
  planned: "#153D9A",
  visited: "#0E7C3A",
  missed: "#C00000",
  out_of_geofence: "#F7931E",
  current: "#25D8FF",
};

function pinIcon(status: MapPinStatus) {
  const color = STATUS_COLORS[status];
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,0.5);"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function CoachingMap({
  pins,
  trail,
  height = 360,
  defaultCenter,
  defaultZoom = 12,
}: {
  pins: MapPin[];
  trail?: Array<[number, number]>;
  height?: number;
  defaultCenter?: [number, number];
  defaultZoom?: number;
}) {
  // A rep's outlet list (or a day's journey plan) can legitimately reference
  // the same outlet more than once — dedupe by id so React keys stay unique.
  const dedupedPins = useMemo(() => {
    const seen = new Set<string>();
    return pins.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }, [pins]);

  const center = useMemo<[number, number]>(() => {
    if (defaultCenter) return defaultCenter;
    if (dedupedPins.length > 0) return [dedupedPins[0].latitude, dedupedPins[0].longitude];
    return [-1.2921, 36.8219]; // Nairobi fallback
  }, [defaultCenter, dedupedPins]);

  return (
    <div style={{ height }} className="rounded-md overflow-hidden border border-[var(--line)]">
      <MapContainer center={center} zoom={defaultZoom} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {dedupedPins.map((pin) => (
          <Marker key={pin.id} position={[pin.latitude, pin.longitude]} icon={pinIcon(pin.status)}>
            {pin.popupContent && <Popup>{pin.popupContent}</Popup>}
          </Marker>
        ))}
        {dedupedPins
          .filter((pin) => pin.geofenceRadiusM)
          .map((pin) => (
            <Circle
              key={`${pin.id}-fence`}
              center={[pin.latitude, pin.longitude]}
              radius={pin.geofenceRadiusM!}
              pathOptions={{ color: STATUS_COLORS[pin.status], fillOpacity: 0.08, weight: 1 }}
            />
          ))}
        {trail && trail.length > 1 && (
          <Polyline positions={trail} pathOptions={{ color: "#153D9A", weight: 3, dashArray: "6 6" }} />
        )}
      </MapContainer>
    </div>
  );
}
