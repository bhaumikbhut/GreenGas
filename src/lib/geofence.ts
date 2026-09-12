import { FACTORY_POINTS, type FactoryPoint } from "./factory-points";
import {
  PORT_LOADING_POINTS,
  PARKING_POINTS,
  type LoadingPoint,
} from "./loading-points";

/**
 * Trip cycle (GPS only, per-site radius):
 *   ON_ROAD → enter parking      → PARK
 *   PARK → leave parking         → ON_ROAD
 *   PARK/ON_ROAD → enter loading → LOADING
 *   LOADING → leave loading      → LOADED (filled) — never empty after a load bay
 *   LOADED → enter known factory     → AT_FACTORY (named)
 *   LOADED → stop outside known pins → AT_FACTORY ("Unknown factory")
 *   AT_FACTORY → leave factory       → ON_ROAD (empty) + lastFactory location
 *   LOADED → re-enter loading    → LOADING (next trip; treated as empty return)
 *
 * All empty travel is ON_ROAD (merged former EMPTY + empty-on-road).
 * lastFactory is set when leaving a factory so the UI shows “Empty · left …”.
 *
 * Rule of thumb:
 *   out of loading point → filled (LOADED)
 *   out of factory       → empty (ON_ROAD)
 *   stop long (≥45m ACC off / ≥2h ACC on), ≥20km from port, off known pins
 *        → AT_FACTORY / Unknown factory (not short dinner / roadside wait)
 */

/** @deprecated Leave-loading no longer requires dwell; kept for env compatibility. */
export const MIN_LOADING_DWELL_MS = Number(
  process.env.MIN_LOADING_DWELL_MS || 2 * 60 * 1000,
);

/** Synthetic factory when a filled truck stops off our known pin list.
 *  Tuned to avoid dinner / short personal stops / brief breakdowns. */
export const UNKNOWN_FACTORY_ID = "fac-unknown";
export const UNKNOWN_FACTORY_NAME = "Unknown factory";
/** Dwell with engine OFF (typical unload) before Unknown factory. */
export const UNKNOWN_FACTORY_DWELL_MS = Number(
  process.env.UNKNOWN_FACTORY_DWELL_MS || 45 * 60 * 1000,
);
/** Longer dwell if engine stays ON (idling / dinner / roadside wait). */
export const UNKNOWN_FACTORY_DWELL_ACC_ON_MS = Number(
  process.env.UNKNOWN_FACTORY_DWELL_ACC_ON_MS || 2 * 60 * 60 * 1000,
);
/** Max speed (km/h) treated as stopped at an unknown site. */
export const UNKNOWN_FACTORY_MAX_SPEED = Number(
  process.env.UNKNOWN_FACTORY_MAX_SPEED || 3,
);
/** Leave Unknown factory after moving this far from the stop pin. */
export const UNKNOWN_FACTORY_LEAVE_M = Number(
  process.env.UNKNOWN_FACTORY_LEAVE_M || 500,
);
/** Must be this far from any loading/parking pin (not a port-side break). */
export const UNKNOWN_FACTORY_MIN_PORT_M = Number(
  process.env.UNKNOWN_FACTORY_MIN_PORT_M || 20_000,
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
  /** Anchor for Unknown-factory stop (leave by distance). */
  stopLat?: number | null;
  stopLng?: number | null;
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
  _fallbackRadiusM?: number,
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
  if (id === UNKNOWN_FACTORY_ID) return true;
  return FACTORY_POINTS.some((p) => p.id === id);
}

export function isUnknownFactoryName(name: string | null | undefined): boolean {
  const v = (name || "").trim().toLowerCase();
  return v === "unknown factory" || v === "unknown";
}

function minDistanceToPortSitesM(lat: number, lng: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of PORT_LOADING_POINTS) {
    best = Math.min(best, haversineMeters(lat, lng, p.lat, p.lng));
  }
  for (const p of PARKING_POINTS) {
    best = Math.min(best, haversineMeters(lat, lng, p.lat, p.lng));
  }
  return best;
}

function unknownFactoryDwellNeededMs(accstatus: number | null | undefined): number {
  // ACC 0 = off (unload-like). ACC 1 = on (idling / dinner / breakdown wait).
  if (accstatus === 0) return UNKNOWN_FACTORY_DWELL_MS;
  if (accstatus === 1) return UNKNOWN_FACTORY_DWELL_ACC_ON_MS;
  // Unknown ACC — between the two (default ~67 min).
  return Math.round((UNKNOWN_FACTORY_DWELL_MS + UNKNOWN_FACTORY_DWELL_ACC_ON_MS) / 2);
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
      stopLat: null,
      stopLng: null,
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
    // Legacy EMPTY merged into ON_ROAD (keep lastFactory for UI).
    status = "ON_ROAD";
    cargo = "EMPTY";
  } else if (raw === "ON_ROAD") {
    status = "ON_ROAD";
    cargo = "EMPTY";
  } else {
    status = "ON_ROAD";
    cargo = "EMPTY";
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
    geofenceId: (prev.geofenceId as string | null) ?? null,
    geofenceKind:
      kind === "loading" || kind === "parking" || kind === "factory"
        ? kind
        : null,
    enteredAt: (prev.enteredAt as number | null) ?? null,
    outsideStreak: Number(prev.outsideStreak ?? 0) || 0,
    cargo,
    lastLoadedFrom: (prev.lastLoadedFrom as string | null) ?? null,
    lastFactory: (prev.lastFactory as string | null) ?? null,
    lastPark: (prev.lastPark as string | null) ?? null,
    stopLat:
      typeof prev.stopLat === "number" && Number.isFinite(prev.stopLat)
        ? prev.stopLat
        : null,
    stopLng:
      typeof prev.stopLng === "number" && Number.isFinite(prev.stopLng)
        ? prev.stopLng
        : null,
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
  /** Current GPS (for Unknown-factory stop / leave). */
  lat?: number | null;
  lng?: number | null;
  /** Speed km/h */
  speed?: number | null;
  /** ProTrack ACC: 0 off, 1 on, -1 unknown */
  accstatus?: number | null;
}): TruckMemory {
  const now = params.now ?? Date.now();
  const prev = normalizeMemory(params.prev);
  const speed = Number(params.speed);
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const hasPos =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);
  const nearlyStopped =
    Number.isFinite(speed) && speed <= UNKNOWN_FACTORY_MAX_SPEED;
  const farFromPort =
    hasPos && minDistanceToPortSitesM(lat, lng) >= UNKNOWN_FACTORY_MIN_PORT_M;
  const dwellNeededMs = unknownFactoryDwellNeededMs(params.accstatus);

  const base = {
    lastNotifiedStatus: prev.lastNotifiedStatus ?? null,
    lastNotifiedAt: prev.lastNotifiedAt ?? null,
    lastLoadedFrom: prev.lastLoadedFrom ?? null,
    lastFactory: prev.lastFactory ?? null,
    lastPark: prev.lastPark ?? null,
    stopLat: prev.stopLat ?? null,
    stopLng: prev.stopLng ?? null,
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
        stopLat: null,
        stopLng: null,
      };
    }

    const wasUnknownFactory =
      prev.geofenceId === UNKNOWN_FACTORY_ID ||
      isUnknownFactoryName(prev.lastFactory);
    const wasAtFactory =
      prev.status === "AT_FACTORY" ||
      wasUnknownFactory ||
      (prev.geofenceKind === "factory" &&
        prev.geofenceId != null &&
        isKnownFactoryId(prev.geofenceId));

    // Filled + long stop far from port, off known pins → Unknown factory.
    // Short dinner / tea / brief roadside waits stay LOADED (filled on road).
    const offKnownSites =
      !params.insideLoading &&
      !params.insideParking &&
      !params.insideFactory;
    if (
      offKnownSites &&
      hasPos &&
      nearlyStopped &&
      farFromPort &&
      (prev.status === "LOADED" ||
        (prev.status === "AT_FACTORY" && wasUnknownFactory))
    ) {
      const stopLat = prev.stopLat ?? lat;
      const stopLng = prev.stopLng ?? lng;
      const awayM =
        prev.stopLat != null && prev.stopLng != null
          ? haversineMeters(lat, lng, prev.stopLat, prev.stopLng)
          : 0;

      // Still near the stop pin (or first sample) — count dwell / stay at factory.
      if (awayM < UNKNOWN_FACTORY_LEAVE_M) {
        const enteredAt =
          prev.geofenceId === UNKNOWN_FACTORY_ID && prev.enteredAt
            ? prev.enteredAt
            : now;
        const dwellOk = now - enteredAt >= dwellNeededMs;
        if (dwellOk || (prev.status === "AT_FACTORY" && wasUnknownFactory)) {
          return {
            ...base,
            status: "AT_FACTORY",
            geofenceId: UNKNOWN_FACTORY_ID,
            geofenceKind: "factory",
            enteredAt,
            outsideStreak: 0,
            cargo: "LOADED",
            lastFactory: UNKNOWN_FACTORY_NAME,
            stopLat,
            stopLng,
          };
        }
        // Timing a long stop — keep showing filled on road until dwell passes.
        return {
          ...base,
          status: "LOADED",
          geofenceId: UNKNOWN_FACTORY_ID,
          geofenceKind: "factory",
          enteredAt,
          outsideStreak: 0,
          cargo: "LOADED",
          stopLat,
          stopLng,
        };
      }
    }

    // Moving again before dwell finished → cancel unknown-factory timer.
    if (
      prev.geofenceId === UNKNOWN_FACTORY_ID &&
      prev.status === "LOADED" &&
      (!nearlyStopped || !farFromPort)
    ) {
      return {
        ...base,
        status: "LOADED",
        geofenceId: null,
        geofenceKind: null,
        enteredAt: null,
        outsideStreak: 0,
        cargo: "LOADED",
        stopLat: null,
        stopLng: null,
      };
    }

    // Leave Unknown factory by distance or movement.
    if (wasAtFactory && wasUnknownFactory && hasPos) {
      const awayM =
        prev.stopLat != null && prev.stopLng != null
          ? haversineMeters(lat, lng, prev.stopLat, prev.stopLng)
          : Number.POSITIVE_INFINITY;
      const leftByDistance = awayM >= UNKNOWN_FACTORY_LEAVE_M;
      const leftBySpeed = Number.isFinite(speed) && speed > UNKNOWN_FACTORY_MAX_SPEED * 2;
      const streak = leftByDistance || leftBySpeed ? prev.outsideStreak + 1 : 0;
      if (streak >= 2) {
        return {
          ...base,
          status: "ON_ROAD",
          geofenceId: null,
          geofenceKind: null,
          enteredAt: null,
          outsideStreak: 0,
          cargo: "EMPTY",
          lastFactory: prev.lastFactory ?? UNKNOWN_FACTORY_NAME,
          stopLat: null,
          stopLng: null,
        };
      }
      return {
        ...prev,
        ...base,
        status: "AT_FACTORY",
        cargo: "LOADED",
        lastFactory: prev.lastFactory ?? UNKNOWN_FACTORY_NAME,
        outsideStreak: streak,
      };
    }

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
        stopLat: null,
        stopLng: null,
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

    // Filled (on road or in port parking after a real load).
    // Clear unknown-stop timer if moving again.
    return {
      ...base,
      status: "LOADED",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "LOADED",
      stopLat: null,
      stopLng: null,
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
    return {
      ...base,
      status: "ON_ROAD",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "EMPTY",
      lastPark: prev.lastPark ?? null,
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
