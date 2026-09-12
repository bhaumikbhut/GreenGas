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
  if (status === "PARK") return "#f97316"; // orange
  if (status === "LOADING") return "#EB5B3C"; // Groww-style market red
  if (status === "LOADED") return "#00B386"; // Groww-style market green
  if (status === "AT_FACTORY") return "#2dd4bf"; // teal
  if (status === "EMPTY") return "#eab308"; // yellow
  if (status === "ON_ROAD") return "#fde68a"; // light amber
  if (status === "OFFLINE") return "#9ca3af"; // gray
  return "#1d4f91";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plateTextColor(_status: string): string {
  return "#000000";
}

function plateLabelHtml(plate: string, status: string): string {
  const text = escapeHtml(plate || "—");
  const bg = statusColor(status);
  const fg = plateTextColor(status);
  return (
    `<div class="gg-plate-label" style="` +
    `margin-top:3px;max-width:120px;padding:3px 6px;border-radius:4px;` +
    `background:${bg};color:${fg};border:1px solid #fff;` +
    `font:700 11px/1.2 ui-sans-serif,system-ui,sans-serif;` +
    `letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;` +
    `text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)` +
    `">${text}</div>`
  );
}

/** Status-colored dot + number plate. */
function truckMarkerIcon(
  status: string,
  plate: string,
  selected = false,
  _course = 0,
  _speed = 0,
) {
  const color = statusColor(status);
  const size = selected ? 34 : 28;
  const r = selected ? 11 : 9;
  const boxW = 108;
  const boxH = size + 24;
  const cx = 16;
  const cy = 16;
  const ring = selected
    ? `<circle cx="${cx}" cy="${cy}" r="14" fill="none" stroke="${color}" stroke-width="2.5" opacity=".45"/>`
    : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" overflow="visible">` +
    ring +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#fff" stroke-width="3"/>` +
    `</svg>`;

  return L.divIcon({
    className: "gg-truck-marker",
    html:
      `<div class="gg-truck-pin" style="width:${boxW}px;display:flex;flex-direction:column;align-items:center;line-height:0;filter:drop-shadow(0 2px 4px rgba(0,0,0,.45))">` +
      svg +
      plateLabelHtml(plate, status) +
      `</div>`,
    iconSize: [boxW, boxH],
    iconAnchor: [boxW / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
}

function truckIcon(
  _mode: "fleet" | "live",
  status: string,
  plate: string,
  selected: boolean,
  course: number,
  speed: number,
) {
  return truckMarkerIcon(status, plate, selected, course, speed);
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
              t.plate,
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
