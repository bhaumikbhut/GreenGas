import { FACTORY_POINTS, type FactoryPoint } from "./factory-points";
import { LOADING_POINTS, type LoadingPoint } from "./loading-points";

/**
 * Trip cycle (GPS only):
 *   EMPTY  → enter port 500m     → LOADING
 *   LOADING → leave port         → LOADED  (filled, heading to factory)
 *   LOADED → enter factory 500m  → AT_FACTORY
 *   AT_FACTORY → leave factory   → EMPTY   (empty on road)
 *
 * LOADING only while inside a port pin. On-road = LOADED (filled) or EMPTY.
 */
export type AutoStatus =
  | "LOADING"
  | "LOADED"
  | "AT_FACTORY"
  | "EMPTY"
  | "OFFLINE";

export type TruckMemory = {
  status: AutoStatus;
  /** Active geofence id (port or factory) while inside / leaving. */
  geofenceId: string | null;
  geofenceKind: "loading" | "factory" | null;
  enteredAt: number | null;
  outsideStreak: number;
  cargo: "LOADED" | "EMPTY";
  lastLoadedFrom?: string | null;
  lastFactory?: string | null;
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

function nearestIn<T extends { id: string; lat: number; lng: number }>(
  points: T[],
  lat: number,
  lng: number,
  radiusM: number,
): { point: T; distanceM: number } | null {
  let best: { point: T; distanceM: number } | null = null;
  for (const point of points) {
    const distanceM = haversineMeters(lat, lng, point.lat, point.lng);
    if (distanceM <= radiusM && (!best || distanceM < best.distanceM)) {
      best = { point, distanceM };
    }
  }
  return best;
}

export function findNearestLoadingPoint(
  lat: number,
  lng: number,
  radiusM: number,
): { point: LoadingPoint; distanceM: number } | null {
  return nearestIn(LOADING_POINTS, lat, lng, radiusM);
}

export function findNearestFactoryPoint(
  lat: number,
  lng: number,
  radiusM: number,
): { point: FactoryPoint; distanceM: number } | null {
  let best: { point: FactoryPoint; distanceM: number } | null = null;
  for (const point of FACTORY_POINTS) {
    const r = point.radiusM && point.radiusM > 0 ? point.radiusM : radiusM;
    const distanceM = haversineMeters(lat, lng, point.lat, point.lng);
    if (distanceM <= r && (!best || distanceM < best.distanceM)) {
      best = { point, distanceM };
    }
  }
  return best;
}

export function normalizeMemory(
  prev: TruckMemory | (Record<string, unknown> & { status?: string }) | undefined,
): TruckMemory {
  if (!prev) {
    return {
      status: "EMPTY",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "EMPTY",
      lastLoadedFrom: null,
      lastFactory: null,
      lastNotifiedStatus: null,
      lastNotifiedAt: null,
    };
  }

  const raw = String(prev.status ?? "EMPTY");
  let status: AutoStatus;
  let cargo: "LOADED" | "EMPTY" =
    prev.cargo === "LOADED" || prev.cargo === "EMPTY"
      ? prev.cargo
      : "EMPTY";

  if (raw === "OFFLINE") status = "OFFLINE";
  else if (raw === "LOADING") status = "LOADING";
  else if (raw === "AT_FACTORY" || raw === "ARRIVED") {
    status = "AT_FACTORY";
    cargo = "LOADED";
  } else if (raw === "LOADED" || raw === "RELEASED") {
    status = "LOADED";
    cargo = "LOADED";
  } else if (raw === "EMPTY" || raw === "ON_ROAD") {
    status = "EMPTY";
    cargo = "EMPTY";
  } else {
    status = "EMPTY";
  }

  const rawNotified = String(prev.lastNotifiedStatus ?? "");
  const notifiedMap: Record<string, AutoStatus> = {
    LOADING: "LOADING",
    LOADED: "LOADED",
    RELEASED: "LOADED",
    AT_FACTORY: "AT_FACTORY",
    ARRIVED: "AT_FACTORY",
    EMPTY: "EMPTY",
    ON_ROAD: "EMPTY",
    OFFLINE: "OFFLINE",
  };

  return {
    status,
    geofenceId: (prev.geofenceId as string | null) ?? null,
    geofenceKind:
      prev.geofenceKind === "loading" || prev.geofenceKind === "factory"
        ? prev.geofenceKind
        : null,
    enteredAt: (prev.enteredAt as number | null) ?? null,
    outsideStreak: Number(prev.outsideStreak ?? 0) || 0,
    cargo,
    lastLoadedFrom: (prev.lastLoadedFrom as string | null) ?? null,
    lastFactory: (prev.lastFactory as string | null) ?? null,
    lastNotifiedStatus: notifiedMap[rawNotified] ?? null,
    lastNotifiedAt: (prev.lastNotifiedAt as number | null) ?? null,
  };
}

export function nextStatus(params: {
  prev: TruckMemory | undefined;
  insideLoading: { point: LoadingPoint; distanceM: number } | null;
  insideFactory: { point: FactoryPoint; distanceM: number } | null;
  online: boolean;
  now?: number;
}): TruckMemory {
  const now = params.now ?? Date.now();
  const prev = normalizeMemory(params.prev);

  const base = {
    lastNotifiedStatus: prev.lastNotifiedStatus ?? null,
    lastNotifiedAt: prev.lastNotifiedAt ?? null,
    lastLoadedFrom: prev.lastLoadedFrom ?? null,
    lastFactory: prev.lastFactory ?? null,
  };

  if (!params.online) {
    return {
      ...prev,
      ...base,
      status: "OFFLINE",
      outsideStreak: 0,
    };
  }

  // --- Filled truck: factory has priority; ignore port until emptied ---
  if (prev.cargo === "LOADED" || prev.status === "LOADED" || prev.status === "AT_FACTORY") {
    if (params.insideFactory) {
      return {
        ...base,
        status: "AT_FACTORY",
        geofenceId: params.insideFactory.point.id,
        geofenceKind: "factory",
        enteredAt: prev.geofenceKind === "factory" && prev.enteredAt ? prev.enteredAt : now,
        outsideStreak: 0,
        cargo: "LOADED",
        lastFactory: params.insideFactory.point.name,
      };
    }

    const wasAtFactory =
      prev.status === "AT_FACTORY" ||
      (prev.geofenceKind === "factory" && prev.geofenceId != null);
    const outsideStreak = wasAtFactory ? prev.outsideStreak + 1 : 0;

    if (wasAtFactory && outsideStreak >= 2) {
      return {
        ...base,
        status: "EMPTY",
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
        outsideStreak,
      };
    }

    // Still filled, on road to / from factory area
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

  // --- Empty truck: only LOADING at port ---
  if (params.insideLoading) {
    return {
      ...base,
      status: "LOADING",
      geofenceId: params.insideLoading.point.id,
      geofenceKind: "loading",
      enteredAt: prev.geofenceKind === "loading" && prev.enteredAt ? prev.enteredAt : now,
      outsideStreak: 0,
      cargo: "EMPTY",
    };
  }

  const wasLoading =
    prev.status === "LOADING" ||
    (prev.geofenceKind === "loading" && prev.geofenceId != null);
  const outsideStreak = wasLoading ? prev.outsideStreak + 1 : 0;

  if (wasLoading && outsideStreak >= 2) {
    const fromId = prev.geofenceId;
    const fromPoint = fromId
      ? LOADING_POINTS.find((p) => p.id === fromId)
      : null;
    return {
      ...base,
      status: "LOADED",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: "LOADED",
      lastLoadedFrom: fromPoint?.name ?? prev.lastLoadedFrom ?? null,
    };
  }

  if (wasLoading) {
    return {
      ...prev,
      ...base,
      status: "LOADING",
      cargo: "EMPTY",
      outsideStreak,
    };
  }

  return {
    ...base,
    status: "EMPTY",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "EMPTY",
  };
}
