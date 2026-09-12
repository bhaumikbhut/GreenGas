import { FACTORY_POINTS, type FactoryPoint } from "./factory-points";
import {
  PORT_LOADING_POINTS,
  PARKING_POINTS,
  type LoadingPoint,
} from "./loading-points";

/**
 * Trip cycle (GPS only — known pins only):
 *   ON_ROAD → enter parking      → PARK
 *   PARK → leave parking         → LOADED (port yard → loading → filled)
 *   PARK/ON_ROAD → enter loading → LOADING
 *   LOADING → leave loading      → LOADED (filled)
 *   LOADED → enter factory pin   → AT_FACTORY
 *   AT_FACTORY → leave factory   → ON_ROAD (empty) + lastFactory
 *   LOADED → re-enter other bay  → LOADING (next trip)
 *
 * No "Unknown factory" — status only from loading / parking / factory pins.
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

function nearestWithOwnRadius(
  points: LoadingPoint[],
  lat: number,
  lng: number,
): { point: LoadingPoint; distanceM: number } | null {
  let best: { point: LoadingPoint; distanceM: number } | null = null;
  for (const point of points) {
    const r = point.radiusM > 0 ? point.radiusM : 50;
    const distanceM = haversineMeters(lat, lng, point.lat, point.lng);
    if (distanceM <= r && (!best || distanceM < best.distanceM)) {
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

export function findNearestFactoryPoint(
  lat: number,
  lng: number,
  fallbackRadiusM: number,
): { point: FactoryPoint; distanceM: number } | null {
  let best: { point: FactoryPoint; distanceM: number } | null = null;
  for (const point of FACTORY_POINTS) {
    const r =
      point.radiusM && point.radiusM > 0 ? point.radiusM : fallbackRadiusM;
    const distanceM = haversineMeters(lat, lng, point.lat, point.lng);
    // Nearest pin inside its own radius wins (handles close factories).
    if (distanceM <= r && (!best || distanceM < best.distanceM)) {
      best = { point, distanceM };
    }
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

  if (raw === "OFFLINE") status = "OFFLINE";
  else if (raw === "PARK" || raw === "PARKING") {
    status = "PARK";
    cargo = "EMPTY";
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
    status = "ON_ROAD";
    cargo = "EMPTY";
  } else {
    status = "ON_ROAD";
    cargo = "EMPTY";
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

  const base = {
    lastNotifiedStatus: prev.lastNotifiedStatus ?? null,
    lastNotifiedAt: prev.lastNotifiedAt ?? null,
    lastLoadedFrom: prev.lastLoadedFrom ?? null,
    lastFactory: prev.lastFactory ?? null,
    lastPark: prev.lastPark ?? null,
  };

  if (!params.online) {
    return {
      ...prev,
      ...base,
      status: "OFFLINE",
      // Keep outsideStreak so leave-loading progress survives brief GPS drops.
    };
  }

  const loadingIds = new Set(PORT_LOADING_POINTS.map((p) => p.id));
  const parkingIds = new Set(PARKING_POINTS.map((p) => p.id));

  // Trust status even if geofence id was lost / renamed in Redis.
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

  const isFilled =
    prev.cargo === "LOADED" ||
    prev.status === "LOADED" ||
    prev.status === "AT_FACTORY";

  // --- Filled truck ---
  if (isFilled) {
    // Next trip at a *different* loading bay → start LOADING again.
    // Same bay while still LOADED = still at origin port (jitter / waiting) — keep LOADED.
    if (params.insideLoading) {
      const sameBay =
        prev.lastLoadedFrom != null &&
        prev.lastLoadedFrom === params.insideLoading.point.name;
      if (sameBay) {
        return {
          ...base,
          status: "LOADED",
          geofenceId: null,
          geofenceKind: null,
          enteredAt: null,
          outsideStreak: 0,
          cargo: "LOADED",
        };
      }
      return {
        ...base,
        status: "LOADING",
        geofenceId: params.insideLoading.point.id,
        geofenceKind: "loading",
        enteredAt: now,
        outsideStreak: 0,
        cargo: "EMPTY",
        lastLoadedFrom: null,
      };
    }

    if (params.insideFactory) {
      return {
        ...base,
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

    const wasAtFactory =
      prev.status === "AT_FACTORY" ||
      (prev.geofenceKind === "factory" &&
        prev.geofenceId != null &&
        isKnownFactoryId(prev.geofenceId));

    const outsideFactoryStreak = wasAtFactory ? prev.outsideStreak + 1 : 0;

    if (wasAtFactory && outsideFactoryStreak >= 2) {
      return {
        ...base,
        status: "ON_ROAD",
        geofenceId: null,
        geofenceKind: null,
        enteredAt: null,
        outsideStreak: 0,
        cargo: "EMPTY",
        lastFactory: prev.lastFactory ?? null,
      };
    }

    if (wasAtFactory) {
      return {
        ...prev,
        ...base,
        status: "AT_FACTORY",
        cargo: "LOADED",
        outsideStreak: outsideFactoryStreak,
      };
    }

    // Filled on road (only known pins can change this).
    return {
      ...base,
      status: "LOADED",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "LOADED",
    };
  }

  // --- Empty truck: loading bay wins over parking ---
  if (params.insideLoading) {
    return {
      ...base,
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
    };
  }

  const leaveLoadingStreak = wasLoading ? prev.outsideStreak + 1 : 0;

  if (wasLoading && leaveLoadingStreak >= 2) {
    const fromPoint = PORT_LOADING_POINTS.find((p) => p.id === prev.geofenceId);
    const loadedFrom =
      fromPoint?.name ?? prev.lastLoadedFrom ?? null;

    // Anything leaving a loading point is filled — never mark empty here.
    return {
      ...base,
      status: "LOADED",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "LOADED",
      lastLoadedFrom: loadedFrom,
    };
  }

  if (wasLoading) {
    return {
      ...prev,
      ...base,
      status: "LOADING",
      cargo: "EMPTY",
      outsideStreak: leaveLoadingStreak,
    };
  }

  // Parking (waiting to load) — only empty trucks
  if (params.insideParking) {
    return {
      ...base,
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

  const leaveParkStreak = wasPark ? prev.outsideStreak + 1 : 0;

  if (wasPark && leaveParkStreak >= 2) {
    const fromPark = PARKING_POINTS.find((p) => p.id === prev.geofenceId);
    const loadedFrom =
      prev.lastLoadedFrom ??
      PORT_LOADING_POINTS.find((p) => p.port === fromPark?.port)?.name ??
      null;
    // Left port parking → heading to / through loading → filled, not empty.
    return {
      ...base,
      status: "LOADED",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "LOADED",
      lastLoadedFrom: loadedFrom,
      lastPark: prev.lastPark ?? fromPark?.name ?? null,
    };
  }

  if (wasPark) {
    return {
      ...prev,
      ...base,
      status: "PARK",
      cargo: "EMPTY",
      outsideStreak: leaveParkStreak,
    };
  }

  // Empty on road (includes post-factory; lastFactory kept via base).
  return {
    ...base,
    status: "ON_ROAD",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "EMPTY",
  };
}
