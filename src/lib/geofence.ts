import { FACTORY_POINTS, type FactoryPoint } from "./factory-points";
import {
  PORT_LOADING_POINTS,
  PARKING_POINTS,
  type FenceBox,
  type FencePolygon,
  type LoadingPoint,
} from "./loading-points";

/**
 * Trip cycle — location and cargo are separate (industry geofence FSM):
 *
 *   Place from live GPS (loading wins, then factory, then parking).
 *   Cargo latches on events: leave loading → filled; leave factory → empty.
 *   Parking is a place, not a cargo reset. A filled truck waiting next to
 *   the bay stays LOADED.
 *
 * Display:
 *   inside loading → LOADING
 *   inside factory → AT_FACTORY
 *   cargo filled   → LOADED (road, apron, or parking)
 *   inside parking → PARK (empty, waiting to load)
 *   else           → ON_ROAD empty
 *
 * Known pins only. No Unknown factory. No circle fallback.
 */

/** @deprecated Unused — leave-loading no longer requires dwell. */
export const MIN_LOADING_DWELL_MS = Number(
  process.env.MIN_LOADING_DWELL_MS || 2 * 60 * 1000,
);

export type AutoStatus =
  | "PARK"
  | "LOADING"
  | "LOADED"
  | "AT_FACTORY"
  | "EMPTY"
  | "ON_ROAD"
  | "OFFLINE";

export type TruckMemory = {
  status: AutoStatus;
  /** Active geofence id (port loading, parking, or factory). */
  geofenceId: string | null;
  geofenceKind: "loading" | "parking" | "factory" | null;
  enteredAt: number | null;
  outsideStreak: number;
  cargo: "LOADED" | "EMPTY";
  lastLoadedFrom?: string | null;
  lastFactory?: string | null;
  lastPark?: string | null;
  lastNotifiedStatus?: AutoStatus | null;
  lastNotifiedAt?: number | null;
};

const EARTH_RADIUS_M = 6371000;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function toDeg(r: number): number {
  return (r * 180) / Math.PI;
}

export function localMetersInBox(
  lat: number,
  lng: number,
  box: FenceBox,
): { alongM: number; acrossM: number } {
  const dLat = toRad(lat - box.lat);
  const dLng = toRad(lng - box.lng);
  const northM = dLat * EARTH_RADIUS_M;
  const eastM = dLng * EARTH_RADIUS_M * Math.cos(toRad(box.lat));
  const h = toRad(box.headingDeg);
  return {
    alongM: northM * Math.cos(h) + eastM * Math.sin(h),
    acrossM: -northM * Math.sin(h) + eastM * Math.cos(h),
  };
}

export function pointInFenceBox(
  lat: number,
  lng: number,
  box: FenceBox,
): boolean {
  const { alongM, acrossM } = localMetersInBox(lat, lng, box);
  return (
    Math.abs(alongM) <= box.lengthM / 2 && Math.abs(acrossM) <= box.widthM / 2
  );
}

/** Even-odd ray cast. `ring` is [lat, lng] vertices (need not be closed). */
export function pointInFencePolygon(
  lat: number,
  lng: number,
  ring: Array<[number, number]>,
): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0];
    const xi = ring[i][1];
    const yj = ring[j][0];
    const xj = ring[j][1];
    if (yi === yj) continue;
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function hasYardOutline(point: LoadingPoint): boolean {
  return Boolean(
    (point.polygon && point.polygon.length >= 3) || point.box,
  );
}

export function pointInsideLoadingPoint(
  lat: number,
  lng: number,
  point: LoadingPoint,
): boolean {
  if (point.polygon && point.polygon.length >= 3) {
    return pointInFencePolygon(lat, lng, point.polygon);
  }
  if (point.box) return pointInFenceBox(lat, lng, point.box);
  const r = point.radiusM > 0 ? point.radiusM : 50;
  return haversineMeters(lat, lng, point.lat, point.lng) <= r;
}

/** Outline to draw on the map: measured polygon, else fitted box corners. */
export function fenceOutline(
  point: { polygon?: FencePolygon; box?: FenceBox },
): [number, number][] | null {
  if (point.polygon && point.polygon.length >= 3) return point.polygon;
  if (point.box) return fenceBoxCorners(point.box);
  return null;
}

/** Four corners [lat, lng] for map polygons. */
export function fenceBoxCorners(box: FenceBox): [number, number][] {
  const h = toRad(box.headingDeg);
  const cosH = Math.cos(h);
  const sinH = Math.sin(h);
  const halfL = box.lengthM / 2;
  const halfW = box.widthM / 2;
  const signs: Array<[number, number]> = [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ];
  return signs.map(([sL, sW]) => {
    const northM = sL * halfL * cosH - sW * halfW * sinH;
    const eastM = sL * halfL * sinH + sW * halfW * cosH;
    const lat = box.lat + toDeg(northM / EARTH_RADIUS_M);
    const lng =
      box.lng + toDeg(eastM / (EARTH_RADIUS_M * Math.cos(toRad(box.lat))));
    return [lat, lng];
  });
}

export function uniqueBoxedPoints(points: LoadingPoint[]): LoadingPoint[] {
  const seen = new Set<string>();
  const out: LoadingPoint[] = [];
  for (const p of points) {
    if (!fenceOutline(p)) continue;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** Group Mundra / IOCL / Aegis Kandla / Dahej so parking matches the fill yard. */
export function loadingFacilityKey(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const n = name.toUpperCase();
  if (n.includes("IOCL")) return "KANDLA-IOCL";
  if (n.includes("AEGIS") && n.includes("KANDLA")) return "KANDLA-AEGIS";
  if (n.includes("PIPAVAV") || n.includes("SHREJI")) return "PIPAVAV";
  if (n.includes("MUNDRA")) return "MUNDRA";
  if (n.includes("DAHEJ")) return "DAHEJ";
  if (n.includes("PORBANDAR") || n.includes("CONFIDENCE")) return "PORBANDAR";
  return n;
}

export function samePortFacility(
  parking: LoadingPoint,
  lastLoadedFrom: string | null | undefined,
): boolean {
  const a = loadingFacilityKey(parking.name);
  const b = loadingFacilityKey(lastLoadedFrom);
  return Boolean(a && b && a === b);
}

function nearestWithOwnRadius(
  points: LoadingPoint[],
  lat: number,
  lng: number,
): { point: LoadingPoint; distanceM: number } | null {
  let best: { point: LoadingPoint; distanceM: number } | null = null;
  for (const point of points) {
    const distanceM = haversineMeters(lat, lng, point.lat, point.lng);
    const inside = pointInsideLoadingPoint(lat, lng, point);
    if (inside && (!best || distanceM < best.distanceM)) {
      best = { point, distanceM };
    }
  }
  return best;
}

/** Nearest loading bay using that site's own radius. */
export function findNearestLoadingPoint(
  lat: number,
  lng: number,
): { point: LoadingPoint; distanceM: number } | null {
  return nearestWithOwnRadius(PORT_LOADING_POINTS, lat, lng);
}

/** Nearest parking using that site's own radius. */
export function findNearestParkingPoint(
  lat: number,
  lng: number,
): { point: LoadingPoint; distanceM: number } | null {
  return nearestWithOwnRadius(PARKING_POINTS, lat, lng);
}

/** GPS often sits at the yard gate, 100–300 m from the Google pin centroid. */
export const FACTORY_GATE_MATCH_M = 320;
/** Driving past a plant must not count as a delivery. */
export const FACTORY_GATE_MAX_SPEED = 8;
/** Stopped just outside a factory rooftop outline (gate / plot road).
 *  Satellite footprints are the hall, not the full compound, so this is
 *  wider than a surveyed fence. Nearest pin still wins on overlap. */
export const FACTORY_OUTLINE_GATE_M = 80;
/** Stopped just outside an outlined parking yard is still empty (queue / road). */
export const PARK_APRON_EMPTY_M = 120;

function localEastNorthM(
  lat: number,
  lng: number,
  fromLat: number,
  fromLng: number,
): { eastM: number; northM: number } {
  return {
    northM: toRad(lat - fromLat) * EARTH_RADIUS_M,
    eastM:
      toRad(lng - fromLng) * EARTH_RADIUS_M * Math.cos(toRad(fromLat)),
  };
}

function distanceToSegmentM(
  lat: number,
  lng: number,
  a: [number, number],
  b: [number, number],
): number {
  const A = localEastNorthM(a[0], a[1], lat, lng);
  const B = localEastNorthM(b[0], b[1], lat, lng);
  const abe = B.eastM - A.eastM;
  const abn = B.northM - A.northM;
  const len2 = abe * abe + abn * abn;
  const t =
    len2 <= 1e-6
      ? 0
      : Math.max(0, Math.min(1, (-A.eastM * abe - A.northM * abn) / len2));
  const e = A.eastM + t * abe;
  const n = A.northM + t * abn;
  return Math.hypot(e, n);
}

/** 0 if inside the ring; otherwise meters to the nearest edge. */
export function distanceToPolygonRingM(
  lat: number,
  lng: number,
  ring: Array<[number, number]>,
): number | null {
  if (ring.length < 3) return null;
  if (pointInFencePolygon(lat, lng, ring)) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i++) {
    const d = distanceToSegmentM(
      lat,
      lng,
      ring[i],
      ring[(i + 1) % ring.length],
    );
    if (d < min) min = d;
  }
  return min;
}

/** 0 if inside the outline; otherwise meters to the nearest edge. */
export function distanceToYardOutlineM(
  lat: number,
  lng: number,
  point: LoadingPoint,
): number | null {
  const outline = fenceOutline(point);
  if (!outline) return null;
  return distanceToPolygonRingM(lat, lng, outline);
}

export function pointInsideFactoryPoint(
  lat: number,
  lng: number,
  point: FactoryPoint,
  _fallbackRadiusM: number,
  opts?: { gateMatchM?: number },
): boolean {
  const gate = opts?.gateMatchM && opts.gateMatchM > 0 ? opts.gateMatchM : 0;
  if (!point.polygon || point.polygon.length < 3) return false;
  if (pointInFencePolygon(lat, lng, point.polygon)) return true;
  if (gate <= 0) return false;
  const d = distanceToPolygonRingM(lat, lng, point.polygon);
  return d != null && d <= Math.min(gate, FACTORY_OUTLINE_GATE_M);
}

export function findNearestFactoryPoint(
  lat: number,
  lng: number,
  fallbackRadiusM: number,
  opts?: { gateMatchM?: number },
): { point: FactoryPoint; distanceM: number } | null {
  let best: { point: FactoryPoint; distanceM: number } | null = null;
  for (const point of FACTORY_POINTS) {
    if (!pointInsideFactoryPoint(lat, lng, point, fallbackRadiusM, opts)) {
      continue;
    }
    const distanceM = haversineMeters(lat, lng, point.lat, point.lng);
    if (!best || distanceM < best.distanceM) {
      best = { point, distanceM };
    }
  }
  return best;
}

/** Rooftop outline while moving; outline + 80 m gate when stopped. */
export function resolveFactoryGeofence(
  lat: number,
  lng: number,
  fallbackRadiusM: number,
  speed?: number | null,
): { point: FactoryPoint; distanceM: number } | null {
  const moving =
    speed != null && Number.isFinite(speed) && speed > FACTORY_GATE_MAX_SPEED;
  return findNearestFactoryPoint(lat, lng, fallbackRadiusM, {
    gateMatchM: moving ? 0 : FACTORY_OUTLINE_GATE_M,
  });
}

/**
 * Walk a recent GPS trail through the same geofence rules as live polls.
 * Used to recover a missed fill when the live pin sits just outside loading.
 */
export function replayGpsTrail(
  points: Array<{
    lat: number;
    lng: number;
    speed?: number | null;
    atMs: number;
  }>,
  fallbackRadiusM: number,
): TruckMemory {
  let mem: TruckMemory | undefined;
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    mem = nextStatus({
      prev: mem,
      insideLoading: findNearestLoadingPoint(p.lat, p.lng),
      insideParking: findNearestParkingPoint(p.lat, p.lng),
      insideFactory: resolveFactoryGeofence(
        p.lat,
        p.lng,
        fallbackRadiusM,
        p.speed,
      ),
      online: true,
      now: p.atMs,
      lat: p.lat,
      lng: p.lng,
      speed: p.speed ?? null,
    });
  }
  return mem ?? normalizeMemory(undefined);
}

export function distanceToNearestLoadingOutlineM(
  lat: number,
  lng: number,
): number | null {
  let best: number | null = null;
  for (const p of PORT_LOADING_POINTS) {
    if (!hasYardOutline(p)) continue;
    const d = distanceToYardOutlineM(lat, lng, p);
    if (d == null) continue;
    if (best == null || d < best) best = d;
  }
  return best;
}
export function isKnownFactoryId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (id === "fac-unknown") return false; // legacy synthetic — ignore
  return FACTORY_POINTS.some((p) => p.id === id);
}

export function normalizeMemory(
  prev: TruckMemory | (Record<string, unknown> & { status?: string }) | undefined,
): TruckMemory {
  if (!prev) {
    return {
      status: "ON_ROAD",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "EMPTY",
      lastLoadedFrom: null,
      lastFactory: null,
      lastPark: null,
      lastNotifiedStatus: null,
      lastNotifiedAt: null,
    };
  }

  const raw = String(prev.status ?? "ON_ROAD");
  let status: AutoStatus;
  let cargo: "LOADED" | "EMPTY" =
    prev.cargo === "LOADED" || prev.cargo === "EMPTY"
      ? prev.cargo
      : "EMPTY";

  if (raw === "OFFLINE") {
    // Legacy GPS-offline flag — keep last cargo, not a fleet status.
    status = cargo === "LOADED" ? "LOADED" : "ON_ROAD";
  } else if (raw === "PARK" || raw === "PARKING") {
    // Parking is a place. Sticky cargo wins if a fill was already latched.
    if (cargo === "LOADED") status = "LOADED";
    else {
      status = "PARK";
      cargo = "EMPTY";
    }
  } else if (raw === "LOADING") status = "LOADING";
  else if (raw === "AT_FACTORY" || raw === "ARRIVED") {
    status = "AT_FACTORY";
    cargo = "LOADED";
  } else if (raw === "LOADED" || raw === "RELEASED") {
    status = "LOADED";
    cargo = "LOADED";
  } else if (raw === "EMPTY") {
    status = "ON_ROAD";
    cargo = "EMPTY";
  } else if (raw === "ON_ROAD") {
    if (cargo === "LOADED") status = "LOADED";
    else {
      status = "ON_ROAD";
      cargo = "EMPTY";
    }
  } else {
    status = cargo === "LOADED" ? "LOADED" : "ON_ROAD";
    if (status !== "LOADED") cargo = "EMPTY";
  }

  // Drop legacy "Unknown factory" — treat as filled on road until a real pin hits.
  const lastFactoryRaw = (prev.lastFactory as string | null) ?? null;
  const unknownFactory =
    prev.geofenceId === "fac-unknown" ||
    (lastFactoryRaw || "").trim().toLowerCase() === "unknown factory";
  if (unknownFactory && (status === "AT_FACTORY" || cargo === "LOADED")) {
    status = "LOADED";
    cargo = "LOADED";
  }

  const rawNotified = String(prev.lastNotifiedStatus ?? "");
  const notifiedMap: Record<string, AutoStatus> = {
    PARK: "PARK",
    PARKING: "PARK",
    LOADING: "LOADING",
    LOADED: "LOADED",
    RELEASED: "LOADED",
    AT_FACTORY: "AT_FACTORY",
    ARRIVED: "AT_FACTORY",
    EMPTY: "EMPTY",
    ON_ROAD: "ON_ROAD",
    OFFLINE: "OFFLINE",
  };

  const kind = prev.geofenceKind;
  return {
    status,
    geofenceId:
      prev.geofenceId === "fac-unknown"
        ? null
        : ((prev.geofenceId as string | null) ?? null),
    geofenceKind:
      kind === "loading" || kind === "parking" || kind === "factory"
        ? prev.geofenceId === "fac-unknown"
          ? null
          : kind
        : null,
    enteredAt: (prev.enteredAt as number | null) ?? null,
    outsideStreak: Number(prev.outsideStreak ?? 0) || 0,
    cargo,
    lastLoadedFrom: (prev.lastLoadedFrom as string | null) ?? null,
    lastFactory: unknownFactory ? null : lastFactoryRaw,
    lastPark: (prev.lastPark as string | null) ?? null,
    lastNotifiedStatus: notifiedMap[rawNotified] ?? null,
    lastNotifiedAt: (prev.lastNotifiedAt as number | null) ?? null,
  };
}

export function nextStatus(params: {
  prev: TruckMemory | undefined;
  insideLoading: { point: LoadingPoint; distanceM: number } | null;
  insideParking: { point: LoadingPoint; distanceM: number } | null;
  insideFactory: { point: FactoryPoint; distanceM: number } | null;
  online: boolean;
  now?: number;
  lat?: number | null;
  lng?: number | null;
  speed?: number | null;
  accstatus?: number | null;
}): TruckMemory {
  const now = params.now ?? Date.now();
  const prev = normalizeMemory(params.prev);

  const labels = {
    lastNotifiedStatus: prev.lastNotifiedStatus ?? null,
    lastNotifiedAt: prev.lastNotifiedAt ?? null,
    lastLoadedFrom: prev.lastLoadedFrom ?? null,
    lastFactory: prev.lastFactory ?? null,
    lastPark: prev.lastPark ?? null,
  };

  const loadingIds = new Set(PORT_LOADING_POINTS.map((p) => p.id));
  const parkingIds = new Set(PARKING_POINTS.map((p) => p.id));

  const wasLoading =
    prev.status === "LOADING" ||
    (prev.geofenceKind === "loading" &&
      prev.geofenceId != null &&
      loadingIds.has(prev.geofenceId));
  const wasPark =
    prev.status === "PARK" ||
    (prev.geofenceKind === "parking" &&
      prev.geofenceId != null &&
      parkingIds.has(prev.geofenceId));
  const wasAtFactory =
    prev.status === "AT_FACTORY" ||
    (prev.geofenceKind === "factory" &&
      prev.geofenceId != null &&
      isKnownFactoryId(prev.geofenceId));

  let cargo: "LOADED" | "EMPTY" = prev.cargo;
  if (prev.status === "LOADED" || prev.status === "AT_FACTORY") cargo = "LOADED";

  // 1. Live place: loading outline wins.
  if (params.insideLoading) {
    const sameBay =
      prev.lastLoadedFrom != null &&
      prev.lastLoadedFrom === params.insideLoading.point.name;
    // Unoutlined pins: GPS jitter on the same bay stays filled.
    if (cargo === "LOADED" && sameBay && !hasYardOutline(params.insideLoading.point)) {
      return {
        ...labels,
        status: "LOADED",
        geofenceId: null,
        geofenceKind: null,
        enteredAt: null,
        outsideStreak: 0,
        cargo: "LOADED",
      };
    }
    return {
      ...labels,
      status: "LOADING",
      geofenceId: params.insideLoading.point.id,
      geofenceKind: "loading",
      enteredAt:
        prev.geofenceKind === "loading" &&
        prev.geofenceId === params.insideLoading.point.id &&
        prev.enteredAt
          ? prev.enteredAt
          : now,
      outsideStreak: 0,
      cargo: "EMPTY",
      lastLoadedFrom: null,
    };
  }

  // 2. Leave loading → latch filled (two polls, ignore GPS flicker).
  if (wasLoading) {
    const streak = prev.outsideStreak + 1;
    if (streak >= 2) {
      const fromPoint = PORT_LOADING_POINTS.find((p) => p.id === prev.geofenceId);
      return {
        ...labels,
        status: "LOADED",
        geofenceId: null,
        geofenceKind: null,
        enteredAt: null,
        outsideStreak: 0,
        cargo: "LOADED",
        lastLoadedFrom: fromPoint?.name ?? prev.lastLoadedFrom ?? null,
      };
    }
    return {
      ...prev,
      ...labels,
      status: "LOADING",
      cargo: "EMPTY",
      outsideStreak: streak,
    };
  }

  // 3. Factory pin — delivery. Empty cargo only after leave.
  if (params.insideFactory) {
    return {
      ...labels,
      status: "AT_FACTORY",
      geofenceId: params.insideFactory.point.id,
      geofenceKind: "factory",
      enteredAt:
        prev.geofenceKind === "factory" &&
        prev.geofenceId === params.insideFactory.point.id &&
        prev.enteredAt
          ? prev.enteredAt
          : now,
      outsideStreak: 0,
      cargo: "LOADED",
      lastFactory: params.insideFactory.point.name,
    };
  }
  if (wasAtFactory) {
    const streak = prev.outsideStreak + 1;
    if (streak >= 2) {
      return {
        ...labels,
        status: "ON_ROAD",
        geofenceId: null,
        geofenceKind: null,
        enteredAt: null,
        outsideStreak: 0,
        cargo: "EMPTY",
        lastFactory: prev.lastFactory ?? null,
      };
    }
    return {
      ...prev,
      ...labels,
      status: "AT_FACTORY",
      cargo: "LOADED",
      outsideStreak: streak,
    };
  }

  // 4. Sticky cargo: a real fill survives parking / apron / road until factory.
  if (cargo === "LOADED") {
    return {
      ...labels,
      status: "LOADED",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "LOADED",
    };
  }

  // 5. Empty truck: parking is waiting to load.
  if (params.insideParking) {
    return {
      ...labels,
      status: "PARK",
      geofenceId: params.insideParking.point.id,
      geofenceKind: "parking",
      enteredAt:
        prev.geofenceKind === "parking" &&
        prev.geofenceId === params.insideParking.point.id &&
        prev.enteredAt
          ? prev.enteredAt
          : now,
      outsideStreak: 0,
      cargo: "EMPTY",
      lastPark: params.insideParking.point.name,
    };
  }
  if (wasPark) {
    const streak = prev.outsideStreak + 1;
    if (streak >= 2) {
      const fromPark = PARKING_POINTS.find((p) => p.id === prev.geofenceId);
      return {
        ...labels,
        status: "ON_ROAD",
        geofenceId: null,
        geofenceKind: null,
        enteredAt: null,
        outsideStreak: 0,
        cargo: "EMPTY",
        lastLoadedFrom: null,
        lastPark: prev.lastPark ?? fromPark?.name ?? null,
      };
    }
    return {
      ...prev,
      ...labels,
      status: "PARK",
      cargo: "EMPTY",
      outsideStreak: streak,
    };
  }

  return {
    ...labels,
    status: "ON_ROAD",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "EMPTY",
  };
}
