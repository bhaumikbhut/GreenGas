"use client";

import { MapContainer, TileLayer, Marker, Polygon, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import type { FactoryPoint } from "@/lib/factory-points";
import type { LoadingPoint } from "@/lib/loading-points";
import { fenceOutline, uniqueBoxedPoints } from "@/lib/geofence";

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
  /** Change this to refit the camera (parking / loading yard filter). */
  fitKey?: string;
};

function statusColor(status: string): string {
  if (status === "PARK") return "#f97316"; // orange
  if (status === "LOADING") return "#EB5B3C"; // Groww-style market red
  if (status === "LOADED") return "#00B386"; // Groww-style market green
  if (status === "AT_FACTORY") return "#2dd4bf"; // teal
  if (status === "EMPTY") return "#eab308"; // yellow
  if (status === "ON_ROAD") return "#fde68a"; // light amber
  return "#1d4f91";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plateTextColor(): string {
  return "#000000";
}

function plateLabelHtml(plate: string, status: string): string {
  const text = escapeHtml(plate || "—");
  const bg = statusColor(status);
  const fg = plateTextColor();
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

/** Status-colored dot + number plate (+ heading tip when moving). */
function truckMarkerIcon(
  status: string,
  plate: string,
  selected = false,
  course = 0,
  speed = 0,
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
  const heading =
    speed > 5
      ? `<polygon points="16,2 11,10 21,10" fill="#fff" stroke="${color}" stroke-width="1" transform="rotate(${course} 16 16)"/>`
      : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" overflow="visible">` +
    ring +
    heading +
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

/**
 * Smooth pin motion: ease to each GPS fix, crawl along course/speed between
 * polls so moving trucks don’t look frozen on the map.
 */
function MovingTruckMarker({
  truck,
  selected,
  mode,
  onSelect,
  children,
}: {
  truck: TruckSnapshot;
  selected: boolean;
  mode: "fleet" | "live";
  onSelect?: (imei: string) => void;
  children?: ReactNode;
}) {
  const markerRef = useRef<L.Marker | null>(null);
  const displayRef = useRef<{ lat: number; lng: number } | null>(
    truck.lat != null && truck.lng != null
      ? { lat: truck.lat, lng: truck.lng }
      : null,
  );
  const targetRef = useRef(displayRef.current);
  const metaRef = useRef({
    speed: truck.speed,
    course: truck.course,
    gpstime: truck.gpstime,
  });
  const [iconTick, setIconTick] = useState(0);

  useEffect(() => {
    if (truck.lat == null || truck.lng == null) return;
    targetRef.current = { lat: truck.lat, lng: truck.lng };
    metaRef.current = {
      speed: truck.speed,
      course: truck.course,
      gpstime: truck.gpstime,
    };
    if (!displayRef.current) {
      displayRef.current = { lat: truck.lat, lng: truck.lng };
      markerRef.current?.setLatLng([truck.lat, truck.lng]);
    }
    setIconTick((n) => n + 1);
  }, [truck.lat, truck.lng, truck.speed, truck.course, truck.gpstime]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const cur = displayRef.current;
      const target = targetRef.current;
      if (cur && target) {
        const dlat = target.lat - cur.lat;
        const dlng = target.lng - cur.lng;
        const distM = Math.sqrt(
          (dlat * 111_000) ** 2 +
            (dlng * 111_000 * Math.cos((cur.lat * Math.PI) / 180)) ** 2,
        );
        const alpha = 1 - Math.exp(-((distM > 200 ? 3 : 2) * dt));
        let lat = cur.lat + dlat * alpha;
        let lng = cur.lng + dlng * alpha;

        const { speed, course, gpstime } = metaRef.current;
        const gpsAgeMs = gpstime ? Date.now() - gpstime : Number.POSITIVE_INFINITY;
        // Crawl only between fresh polls. Never move the GPS target —
        // that left stopped trucks sitting off the real pin.
        if (speed > 5 && distM < 45 && gpsAgeMs < 45_000) {
          const meters = ((speed * 1000) / 3600) * dt;
          const rad = (course * Math.PI) / 180;
          lat += (meters / 111_000) * Math.cos(rad);
          lng +=
            (meters / (111_000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))) *
            Math.sin(rad);
        }

        displayRef.current = { lat, lng };
        markerRef.current?.setLatLng([lat, lng]);
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const icon = useMemo(
    () =>
      truckIcon(
        mode,
        truck.status,
        truck.plate,
        selected,
        truck.course,
        truck.speed,
      ),
    // iconTick refreshes when GPS meta changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      mode,
      truck.status,
      truck.plate,
      selected,
      truck.course,
      truck.speed,
      iconTick,
    ],
  );

  if (truck.lat == null || truck.lng == null) return null;

  return (
    <Marker
      ref={markerRef}
      position={[truck.lat, truck.lng]}
      icon={icon}
      zIndexOffset={selected ? 1000 : truck.speed > 5 ? 200 : 0}
      eventHandlers={{
        click: () => onSelect?.(truck.imei),
      }}
    >
      {children}
    </Marker>
  );
}

function yardCameraPoints(points: LoadingPoint[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const p of points) {
    const outline = fenceOutline(p);
    if (outline && outline.length >= 3) {
      for (const pt of outline) pts.push(pt);
    } else if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      pts.push([p.lat, p.lng]);
    }
  }
  return pts;
}

function FitBounds({
  trucks,
  loadingPoints,
  factoryPoints,
  selectedImei,
  fitKey = "",
}: {
  trucks: TruckSnapshot[];
  loadingPoints: LoadingPoint[];
  factoryPoints: FactoryPoint[];
  selectedImei: string | null;
  fitKey?: string;
}) {
  const map = useMap();
  const didFit = useRef(false);
  const lastFitKey = useRef<string | null>(null);

  useEffect(() => {
    const yardFocus = Boolean(fitKey);
    // Pin search / card pick: FocusTruck owns the camera. Don't refit the fleet.
    if (selectedImei && !yardFocus) return;
    // Don't steal the camera while a truck is selected, unless the yard filter just changed.
    if (selectedImei && lastFitKey.current === fitKey) return;

    const apply = () => {
      if (lastFitKey.current === fitKey && didFit.current) return true;
      map.invalidateSize({ animate: false });
      const size = map.getSize();
      if (!size.x || !size.y) return false;

      try {
        if (yardFocus) {
          const yardPts = yardCameraPoints(loadingPoints);
          if (yardPts.length === 0) return false;
          if (yardPts.length === 1) {
            map.flyTo(yardPts[0], 16, { duration: 0.75 });
          } else {
            map.flyToBounds(yardPts, {
              padding: [56, 56],
              maxZoom: 17,
              duration: 0.75,
            });
          }
          didFit.current = true;
          lastFitKey.current = fitKey;
          return true;
        }

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
          didFit.current = true;
          lastFitKey.current = fitKey;
          return true;
        }
        map.fitBounds(pts, {
          padding: [48, 48],
          maxZoom: 11,
        });
        didFit.current = true;
        lastFitKey.current = fitKey;
        return true;
      } catch {
        return false;
      }
    };

    if (apply()) return;
    const t1 = window.setTimeout(() => apply(), 50);
    const t2 = window.setTimeout(() => apply(), 200);
    const t3 = window.setTimeout(() => apply(), 500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [map, trucks, loadingPoints, factoryPoints, selectedImei, fitKey]);

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
  /** null = not focused yet this map mount (card → /map must fly+zoom). */
  const lastFocusToken = useRef<number | null>(null);

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

    const zoom = 15;
    const hardFocus =
      lastFocusToken.current === null || lastFocusToken.current !== focusToken;
    lastFocusToken.current = focusToken;

    const go = () => {
      map.invalidateSize({ animate: false });
      const size = map.getSize();
      if (!size.x || !size.y) return false;
      if (hardFocus || mode === "live") {
        map.flyTo([selected.lat!, selected.lng!], zoom, { duration: 0.75 });
      } else {
        map.panTo([selected.lat!, selected.lng!], {
          animate: true,
          duration: 0.8,
        });
      }
      return true;
    };

    if (go()) return;

    const t1 = window.setTimeout(() => go(), 50);
    const t2 = window.setTimeout(() => go(), 200);
    const t3 = window.setTimeout(() => go(), 500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [map, selectedImei, focusToken, mode, trucks]);

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
  radiusM: _radiusM,
  selectedImei,
  focusToken = 0,
  mode = "fleet",
  defaultBasemap = "satellite",
  onSelectImei,
  fitKey = "",
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
          fitKey={fitKey}
        />
        <FocusTruck
          trucks={trucks}
          selectedImei={selectedImei}
          focusToken={focusToken}
          mode={mode}
        />
        {uniqueBoxedPoints(loadingPoints).map((p) => {
          const isParking = p.kind === "parking";
          const color = isParking ? statusColor("PARK") : statusColor("LOADING");
          const outline = fenceOutline(p);
          if (!outline) return null;
          const label = p.polygon
            ? `${p.polygon.length} corner outline`
            : p.box
              ? `${Math.round(p.box.lengthM)} × ${Math.round(p.box.widthM)} m box`
              : "";
          return (
            <Polygon
              key={`box-${p.id}`}
              positions={outline}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.16,
                weight: 2,
              }}
            >
              <Popup>
                <strong>{p.name}</strong>
                <br />
                {isParking ? "Parking" : "Loading"} · {p.port}
                <br />
                {label}
              </Popup>
            </Polygon>
          );
        })}
        {factoryPoints.map((p) => {
          const color = statusColor("AT_FACTORY");
          const outline = fenceOutline(p);
          if (!outline) return null;
          return (
            <Polygon
              key={`fac-${p.id}`}
              positions={outline}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.16,
                weight: 2,
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
                {outline.length} corner outline
              </Popup>
            </Polygon>
          );
        })}
      {trucks.map((t) =>
        t.lat != null && t.lng != null ? (
          <MovingTruckMarker
            key={t.imei}
            truck={t}
            selected={t.imei === selectedImei}
            mode={mode}
            onSelect={onSelectImei}
          >
            <Popup>
              <strong>{t.plate}</strong>
              <br />
              {t.productLine} · {t.status === "ON_ROAD" ? "EMPTY ROAD" : t.status === "LOADED" ? "FILLED ROAD" : t.status}
              {t.status === "LOADED" || t.status === "AT_FACTORY"
                ? " · FILLED"
                : t.status === "ON_ROAD" || t.status === "EMPTY"
                  ? " · EMPTY"
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
          </MovingTruckMarker>
        ) : null,
      )}
    </MapContainer>
    </div>
  );
}
