"use client";

import { MapContainer, TileLayer, Circle, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import type { FactoryPoint } from "@/lib/factory-points";
import type { LoadingPoint } from "@/lib/loading-points";

type Basemap = "street" | "satellite";

type Props = {
  trucks: TruckSnapshot[];
  loadingPoints: LoadingPoint[];
  factoryPoints: FactoryPoint[];
  radiusM: number;
  selectedImei: string | null;
  /** Bumps on each list-row click so the map re-focuses even for the same truck. */
  focusToken?: number;
  /** fleet = pin icons; live = rotating top-down vehicle (Uber-style tracking). */
  mode?: "fleet" | "live";
  /** Initial basemap; user can still toggle on the map. */
  defaultBasemap?: Basemap;
  onSelectImei?: (imei: string) => void;
};

function statusColor(status: string): string {
  if (status === "PARK") return "#2563eb"; // blue
  if (status === "LOADING") return "#ea580c"; // orange
  if (status === "LOADED") return "#16a34a"; // green
  if (status === "AT_FACTORY") return "#0d9488"; // teal
  if (status === "EMPTY") return "#eab308"; // yellow
  if (status === "OFFLINE") return "#6b7280";
  return "#1d4f91";
}

/** Fleet overview: status pin + clear truck glyph (OSM/Temaki style). */
function fleetPinIcon(status: string, selected = false, course = 0) {
  const color = statusColor(status);
  const w = selected ? 40 : 34;
  const h = selected ? 52 : 44;
  const heading = Number.isFinite(course) ? course : 0;

  const truckPath =
    "M2.75 9.75C2 9.75 1.5 10.25 1.5 11C1.5 11.75 2 12.25 2.75 12.25C3.5 12.25 4 11.75 4 11C4 10.25 3.5 9.75 2.75 9.75zM11.75 9.75C11 9.75 10.5 10.25 10.5 11C10.5 11.75 11 12.25 11.75 12.25C12.5 12.25 13 11.75 13 11C13 10.25 12.5 9.75 11.75 9.75zM14.5 3C14.5 3 5.5 3 5.5 3C4.91 3 5 3.5 5 3.5C5 3.5 5 7 5 7L4.25 7L4.25 4.5C4.25 4 3.75 4 3.75 4C3.75 4 2 4 2 4C0.5 4 0.5 6 0.5 7C0.5 7 0 7 0 7.5C0 7.5 0 11 0 11L1 11C1 9.75 1.75 9.25 2.75 9.25C3.75 9.25 4.5 9.75 4.5 11C4.5 11 10 11 10 11C10 9.75 10.75 9.25 11.75 9.25C12.75 9.25 13.5 9.75 13.5 11C13.5 11 15 11 15 11C15 11 15 3.5 15 3.5C15 3.5 15 3 14.5 3zM3 5L3 7C3 7 1.5 7 1.5 7C1.5 6 1.5 5 2 5C2 5 3 5 3 5z";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 40 52" overflow="visible">` +
    `<path d="M20 2C11.2 2 4 9 4 17.6C4 28.5 20 48 20 48S36 28.5 36 17.6C36 9 28.8 2 20 2Z" fill="${color}" stroke="#fff" stroke-width="2"/>` +
    `<circle cx="20" cy="17" r="10.5" fill="rgba(0,0,0,.16)"/>` +
    `<g transform="translate(8.2 10.2) scale(1.55)" fill="#fff"><path d="${truckPath}"/></g>` +
    `<g transform="rotate(${heading} 20 48)">` +
    `<path d="M20 42 L24.5 49.5 L20 47.2 L15.5 49.5 Z" fill="${color}" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>` +
    `</g>` +
    (selected
      ? `<circle cx="20" cy="17" r="18" fill="none" stroke="${color}" stroke-width="2" opacity=".35"/>`
      : "") +
    `</svg>`;

  return L.divIcon({
    className: "gg-truck-marker",
    html: `<div class="gg-truck-pin" style="width:${w}px;height:${h}px;line-height:0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))">${svg}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h - 2],
    popupAnchor: [0, -(h - 8)],
  });
}

/**
 * Live tracking: Uber-style top-down tanker that rotates with GPS course.
 * Larger + motion pulse when moving — reads clearly as a live vehicle.
 */
function liveVehicleIcon(status: string, course = 0, speed = 0) {
  const color = statusColor(status);
  const moving = speed > 3;
  const size = 56;
  const heading = Number.isFinite(course) ? course : 0;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" overflow="visible">` +
    `<g transform="rotate(${heading} 32 32)">` +
    (moving
      ? `<circle cx="32" cy="32" r="28" fill="${color}" opacity=".12"/><circle cx="32" cy="32" r="22" fill="none" stroke="${color}" stroke-width="2" opacity=".35"/>`
      : `<circle cx="32" cy="32" r="24" fill="${color}" opacity=".1"/>`) +
    // body (top-down cab + tank)
    `<ellipse cx="32" cy="36" rx="9" ry="22" fill="rgba(0,0,0,.18)"/>` +
    `<path d="M23 18 C23 10 27 5 32 5 C37 5 41 10 41 18 L41 48 C41 54 37 58 32 58 C27 58 23 54 23 48 Z" fill="#fff"/>` +
    `<path d="M24.5 18.5 C24.5 11.5 28 7.5 32 7.5 C36 7.5 39.5 11.5 39.5 18.5 L39.5 47.5 C39.5 52.5 36 55.5 32 55.5 C28 55.5 24.5 52.5 24.5 47.5 Z" fill="${color}"/>` +
    // windshield (direction)
    `<path d="M26.5 15 C28.5 10.5 35.5 10.5 37.5 15 L36 21 C34 18.8 30 18.8 28 21 Z" fill="rgba(255,255,255,.85)"/>` +
    // cab/tank split
    `<rect x="26" y="24" width="12" height="2" rx="1" fill="rgba(255,255,255,.35)"/>` +
    // center highlight
    `<rect x="29.5" y="28" width="5" height="20" rx="2.5" fill="rgba(255,255,255,.15)"/>` +
    `</g></svg>`;

  return L.divIcon({
    className: "gg-truck-marker",
    html: `<div class="gg-truck-pin" style="width:${size}px;height:${size}px;line-height:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

function truckIcon(
  mode: "fleet" | "live",
  status: string,
  selected: boolean,
  course: number,
  speed: number,
) {
  if (mode === "live" || selected) {
    return liveVehicleIcon(status, course, speed);
  }
  return fleetPinIcon(status, false, course);
}

function FitBounds({
  trucks,
  loadingPoints,
  factoryPoints,
  selectedImei,
}: {
  trucks: TruckSnapshot[];
  loadingPoints: LoadingPoint[];
  factoryPoints: FactoryPoint[];
  selectedImei: string | null;
}) {
  const map = useMap();
  const didFit = useRef(false);

  useEffect(() => {
    // Don't steal the camera while a truck is selected
    if (selectedImei) return;

    const size = map.getSize();
    if (!size.x || !size.y) return;

    try {
      const pts: [number, number][] = [];
      for (const t of trucks) {
        if (
          t.lat != null &&
          t.lng != null &&
          Number.isFinite(t.lat) &&
          Number.isFinite(t.lng)
        ) {
          pts.push([t.lat, t.lng]);
        }
      }
      for (const p of loadingPoints) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          pts.push([p.lat, p.lng]);
        }
      }
      for (const p of factoryPoints) {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
          pts.push([p.lat, p.lng]);
        }
      }
      if (pts.length === 0) {
        map.setView([22.0, 71.0], 7);
        return;
      }
      // Fit fleet once on first load; later polls keep current view
      if (!didFit.current) {
        map.fitBounds(pts, { padding: [40, 40], maxZoom: 11 });
        didFit.current = true;
      }
    } catch {
      // ignore
    }
  }, [map, trucks, loadingPoints, factoryPoints, selectedImei]);

  return null;
}

function FocusTruck({
  trucks,
  selectedImei,
  focusToken = 0,
  mode = "fleet",
}: {
  trucks: TruckSnapshot[];
  selectedImei: string | null;
  focusToken?: number;
  mode?: "fleet" | "live";
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedImei) return;
    const selected = trucks.find((t) => t.imei === selectedImei);
    if (
      selected?.lat == null ||
      selected?.lng == null ||
      !Number.isFinite(selected.lat) ||
      !Number.isFinite(selected.lng)
    ) {
      return;
    }

    const zoom = mode === "live" ? 15 : 15;
    const go = () => {
      map.invalidateSize({ animate: false });
      const size = map.getSize();
      if (!size.x || !size.y) return false;
      if (mode === "live") {
        map.setView([selected.lat!, selected.lng!], zoom, { animate: true });
      } else {
        map.flyTo([selected.lat!, selected.lng!], zoom, { duration: 0.7 });
      }
      return true;
    };

    if (go()) return;

    const t1 = window.setTimeout(() => go(), 50);
    const t2 = window.setTimeout(() => go(), 200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [
    map,
    trucks,
    selectedImei,
    focusToken,
    mode,
    // re-follow on live GPS updates
    trucks.find((t) => t.imei === selectedImei)?.lat,
    trucks.find((t) => t.imei === selectedImei)?.lng,
  ]);

  return null;
}

function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
    });
    ro.observe(container);
    map.invalidateSize({ animate: false });
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export default function TruckMap({
  trucks,
  loadingPoints,
  factoryPoints,
  radiusM,
  selectedImei,
  focusToken = 0,
  mode = "fleet",
  defaultBasemap = "satellite",
  onSelectImei,
}: Props) {
  const [basemap, setBasemap] = useState<Basemap>(defaultBasemap);

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-auto absolute right-3 top-3 z-[1000] flex overflow-hidden rounded-lg bg-white/95 shadow-md ring-1 ring-black/10 backdrop-blur">
        <button
          type="button"
          onClick={() => setBasemap("street")}
          className={
            "px-3 py-1.5 text-xs font-medium transition " +
            (basemap === "street"
              ? "bg-[var(--gg-green)] text-white"
              : "text-[var(--gg-ink)] hover:bg-[#eef3ee]")
          }
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => setBasemap("satellite")}
          className={
            "px-3 py-1.5 text-xs font-medium transition " +
            (basemap === "satellite"
              ? "bg-[var(--gg-green)] text-white"
              : "text-[var(--gg-ink)] hover:bg-[#eef3ee]")
          }
        >
          Satellite
        </button>
      </div>
      <MapContainer
        center={[22.0, 71.0]}
        zoom={7}
        className="h-full w-full"
        scrollWheelZoom
      >
        {basemap === "satellite" ? (
          <>
            <TileLayer
              attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics'
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
            <TileLayer
              attribution=""
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
              opacity={0.85}
            />
          </>
        ) : (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        )}
        <InvalidateOnResize />
        <FitBounds
          trucks={trucks}
          loadingPoints={loadingPoints}
          factoryPoints={factoryPoints}
          selectedImei={selectedImei}
        />
        <FocusTruck
          trucks={trucks}
          selectedImei={selectedImei}
          focusToken={focusToken}
          mode={mode}
        />
        {loadingPoints.map((p) => {
        const isParking = p.kind === "parking";
        const color = isParking ? "#a16207" : "#1f7a4d";
        const r = p.radiusM > 0 ? p.radiusM : radiusM;
        return (
          <Circle
            key={p.id}
            center={[p.lat, p.lng]}
            radius={r}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.12,
              weight: 1,
            }}
          >
            <Popup>
              <strong>{p.name}</strong>
              <br />
              {isParking ? "Parking" : "Loading"} · {p.port}
              <br />
              Radius: {r} m
            </Popup>
          </Circle>
        );
      })}
      {factoryPoints.map((p) => (
        <Circle
          key={p.id}
          center={[p.lat, p.lng]}
          radius={p.radiusM ?? radiusM}
          pathOptions={{
            color: "#0f766e",
            fillColor: "#0f766e",
            fillOpacity: 0.12,
            weight: 1,
          }}
        >
          <Popup>
            <strong>{p.name}</strong>
            <br />
            Factory
            {p.company ? (
              <>
                <br />
                {p.company}
              </>
            ) : null}
            <br />
            Radius: {p.radiusM ?? radiusM} m
          </Popup>
        </Circle>
      ))}
      {trucks.map((t) =>
        t.lat != null && t.lng != null ? (
          <Marker
            key={t.imei}
            position={[t.lat, t.lng]}
            icon={truckIcon(
              mode,
              t.status,
              t.imei === selectedImei,
              t.course,
              t.speed,
            )}
            zIndexOffset={t.imei === selectedImei ? 1000 : t.speed > 5 ? 200 : 0}
            eventHandlers={{
              click: () => onSelectImei?.(t.imei),
            }}
          >
            <Popup>
              <strong>{t.plate}</strong>
              <br />
              {t.productLine} · {t.status}
              {t.status === "LOADED" || t.status === "AT_FACTORY"
                ? " · FILLED"
                : ""}
              <br />
              Speed: {t.speed} km/h
              {t.lastLoadedFrom ? (
                <>
                  <br />
                  Loaded at: {t.lastLoadedFrom}
                </>
              ) : null}
              {t.lastPark ? (
                <>
                  <br />
                  Parked at: {t.lastPark}
                </>
              ) : null}
              {t.lastFactory ? (
                <>
                  <br />
                  Factory: {t.lastFactory}
                </>
              ) : null}
              {t.loadingPoint ? (
                <>
                  <br />
                  Near loading: {t.loadingPoint} ({t.distanceM} m)
                </>
              ) : null}
              {t.parkingPoint ? (
                <>
                  <br />
                  Near parking: {t.parkingPoint} ({t.distanceM} m)
                </>
              ) : null}
              {t.factoryPoint ? (
                <>
                  <br />
                  Near factory: {t.factoryPoint} ({t.distanceM} m)
                </>
              ) : null}
            </Popup>
          </Marker>
        ) : null,
      )}
    </MapContainer>
    </div>
  );
}
