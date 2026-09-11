"use client";

import { MapContainer, TileLayer, Circle, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect } from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import type { LoadingPoint } from "@/lib/loading-points";

type Props = {
  trucks: TruckSnapshot[];
  loadingPoints: LoadingPoint[];
  radiusM: number;
  selectedImei: string | null;
};

function truckIcon(status: string) {
  const color =
    status === "LOADING"
      ? "#c45c26"
      : status === "RELEASED"
        ? "#1f7a4d"
        : status === "OFFLINE"
          ? "#6b7280"
          : "#1d4f91";
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function FitBounds({
  trucks,
  loadingPoints,
  selectedImei,
}: {
  trucks: TruckSnapshot[];
  loadingPoints: LoadingPoint[];
  selectedImei: string | null;
}) {
  const map = useMap();

  useEffect(() => {
    const selected = trucks.find((t) => t.imei === selectedImei);
    if (selected?.lat != null && selected?.lng != null) {
      map.flyTo([selected.lat, selected.lng], 13, { duration: 0.6 });
      return;
    }

    const pts: [number, number][] = [];
    for (const t of trucks) {
      if (t.lat != null && t.lng != null) pts.push([t.lat, t.lng]);
    }
    for (const p of loadingPoints) pts.push([p.lat, p.lng]);
    if (pts.length === 0) {
      map.setView([22.0, 71.0], 7);
      return;
    }
    map.fitBounds(pts, { padding: [40, 40], maxZoom: 11 });
  }, [map, trucks, loadingPoints, selectedImei]);

  return null;
}

export default function TruckMap({
  trucks,
  loadingPoints,
  radiusM,
  selectedImei,
}: Props) {
  return (
    <MapContainer
      center={[22.0, 71.0]}
      zoom={7}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds
        trucks={trucks}
        loadingPoints={loadingPoints}
        selectedImei={selectedImei}
      />
      {loadingPoints.map((p) => (
        <Circle
          key={p.id}
          center={[p.lat, p.lng]}
          radius={radiusM}
          pathOptions={{
            color: "#1f7a4d",
            fillColor: "#1f7a4d",
            fillOpacity: 0.12,
            weight: 1,
          }}
        >
          <Popup>
            <strong>{p.name}</strong>
            <br />
            Port: {p.port}
            <br />
            Radius: {radiusM} m
          </Popup>
        </Circle>
      ))}
      {trucks.map((t) =>
        t.lat != null && t.lng != null ? (
          <Marker
            key={t.imei}
            position={[t.lat, t.lng]}
            icon={truckIcon(t.status)}
          >
            <Popup>
              <strong>{t.plate}</strong>
              <br />
              {t.productLine} · {t.status}
              <br />
              Speed: {t.speed} km/h
              {t.loadingPoint ? (
                <>
                  <br />
                  Near: {t.loadingPoint} ({t.distanceM} m)
                </>
              ) : null}
            </Popup>
          </Marker>
        ) : null,
      )}
    </MapContainer>
  );
}
