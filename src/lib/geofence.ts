import { LOADING_POINTS, type LoadingPoint } from "./loading-points";

export type AutoStatus = "LOADING" | "RELEASED" | "ON_ROAD" | "OFFLINE";

export type TruckMemory = {
  status: AutoStatus;
  geofenceId: string | null;
  enteredAt: number | null;
  outsideStreak: number;
  /** Last status we already sent WhatsApp for (avoids spam). */
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

export function findNearestLoadingPoint(
  lat: number,
  lng: number,
  radiusM: number,
): { point: LoadingPoint; distanceM: number } | null {
  let best: { point: LoadingPoint; distanceM: number } | null = null;
  for (const point of LOADING_POINTS) {
    const distanceM = haversineMeters(lat, lng, point.lat, point.lng);
    if (distanceM <= radiusM && (!best || distanceM < best.distanceM)) {
      best = { point, distanceM };
    }
  }
  return best;
}

/**
 * Enter zone → LOADING. Leave zone (after having entered) → RELEASED.
 * Needs a short outside streak so GPS jitter does not flip status.
 */
export function nextStatus(params: {
  prev: TruckMemory | undefined;
  inside: { point: LoadingPoint; distanceM: number } | null;
  online: boolean;
  now?: number;
}): TruckMemory {
  const now = params.now ?? Date.now();
  const prev: TruckMemory = params.prev ?? {
    status: "ON_ROAD",
    geofenceId: null,
    enteredAt: null,
    outsideStreak: 0,
    lastNotifiedStatus: null,
    lastNotifiedAt: null,
  };

  if (!params.online) {
    return { ...prev, status: "OFFLINE", outsideStreak: 0 };
  }

  if (params.inside) {
    return {
      status: "LOADING",
      geofenceId: params.inside.point.id,
      enteredAt: prev.enteredAt ?? now,
      outsideStreak: 0,
      lastNotifiedStatus: prev.lastNotifiedStatus ?? null,
      lastNotifiedAt: prev.lastNotifiedAt ?? null,
    };
  }

  const wasLoading =
    prev.status === "LOADING" ||
    (prev.geofenceId != null && prev.enteredAt != null);
  const outsideStreak = wasLoading ? prev.outsideStreak + 1 : 0;

  // Require 2 consecutive outside polls (~1 min at 30s poll) before RELEASED
  if (wasLoading && outsideStreak >= 2) {
    return {
      status: "RELEASED",
      geofenceId: null,
      enteredAt: null,
      outsideStreak: 0,
      lastNotifiedStatus: prev.lastNotifiedStatus ?? null,
      lastNotifiedAt: prev.lastNotifiedAt ?? null,
    };
  }

  if (wasLoading) {
    return {
      ...prev,
      status: "LOADING",
      outsideStreak,
    };
  }

  return {
    status: prev.status === "RELEASED" ? "RELEASED" : "ON_ROAD",
    geofenceId: null,
    enteredAt: null,
    outsideStreak: 0,
    lastNotifiedStatus: prev.lastNotifiedStatus ?? null,
    lastNotifiedAt: prev.lastNotifiedAt ?? null,
  };
}
