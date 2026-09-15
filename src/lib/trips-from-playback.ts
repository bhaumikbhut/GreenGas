import {
  resolveFactoryGeofence,
  findNearestLoadingPoint,
  findNearestParkingPoint,
} from "@/lib/geofence";
import { PORT_LOADING_POINTS } from "@/lib/loading-points";
import type { PortalPlaybackPoint } from "@/lib/protrack-portal";
import { SAME_CLOCK_MS } from "@/lib/trip-display";
import type { Trip, TripStatus } from "@/lib/trips";

const MIN_FACTORY_DWELL_SEC = 15 * 60;

function toSec(gpstime: number): number {
  return gpstime > 1e12 ? Math.floor(gpstime / 1000) : Math.floor(gpstime);
}

function iso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

function loadingNameForPort(port: string | null | undefined): string | null {
  if (!port) return null;
  return PORT_LOADING_POINTS.find((p) => p.port === port)?.name ?? null;
}

export type TripDraft = {
  loadedFrom: string;
  port: string | null;
  factory: string | null;
  status: TripStatus;
  loadedAt: string;
  arrivedAt: string | null;
  departedAt: string | null;
};

/**
 * Walk a GPS trail and emit trips with real pin timestamps.
 * Leave parking / leave loading opens a trip; a 15+ min factory stay
 * arrives; leaving that factory closes it.
 */
export function walkTripsFromPlayback(
  points: PortalPlaybackPoint[],
  radiusM = 500,
): TripDraft[] {
  const out: TripDraft[] = [];
  let open: TripDraft | null = null;
  let inLoad: { name: string; port: string; atSec: number } | null = null;
  let inPark: { name: string; port: string; atSec: number } | null = null;
  let inFac: { name: string; atSec: number } | null = null;
  let lastSeenLoad: { name: string; port: string } | null = null;

  const startOrUpdate = (
    atSec: number,
    loadedFrom: string | null,
    portArg: string | null,
  ) => {
    const from =
      loadedFrom || lastSeenLoad?.name || "Unknown loading point";
    const port = portArg || lastSeenLoad?.port || null;
    if (open && open.status !== "DELIVERED") {
      if (loadedFrom && open.loadedFrom.startsWith("Unknown")) {
        open.loadedFrom = from;
        open.port = port ?? open.port;
      } else if (loadedFrom && loadedFrom !== open.loadedFrom) {
        open.loadedFrom = from;
        open.port = port ?? open.port;
        open.loadedAt = iso(atSec);
      }
      return;
    }
    open = {
      loadedFrom: from,
      port,
      factory: null,
      status: "IN_TRANSIT",
      loadedAt: iso(atSec),
      arrivedAt: null,
      departedAt: null,
    };
  };

  const arrive = (atSec: number, factory: string) => {
    // Never open a trip at factory-enter — that stamps Loaded = Arrived.
    if (!open) return;
    open.factory = factory;
    open.arrivedAt = open.arrivedAt || iso(atSec);
    open.status = "AT_FACTORY";
  };

  const depart = (atSec: number, factory: string) => {
    if (!open) return;
    open.factory = factory || open.factory;
    open.arrivedAt = open.arrivedAt || iso(atSec);
    open.departedAt = iso(atSec);
    open.status = "DELIVERED";
    out.push(open);
    open = null;
  };

  for (const p of points) {
    const atSec = toSec(p.gpstime);
    const L = findNearestLoadingPoint(p.latitude, p.longitude);
    const P = findNearestParkingPoint(p.latitude, p.longitude);
    const F = resolveFactoryGeofence(
      p.latitude,
      p.longitude,
      radiusM,
      p.speed,
    );

    if (L) {
      if (!inLoad || inLoad.name !== L.point.name) {
        inLoad = { name: L.point.name, port: L.point.port, atSec };
        lastSeenLoad = { name: L.point.name, port: L.point.port };
      }
    } else if (inLoad) {
      lastSeenLoad = { name: inLoad.name, port: inLoad.port };
      startOrUpdate(atSec, inLoad.name, inLoad.port);
      inLoad = null;
    }

    if (P) {
      if (!inPark || inPark.name !== P.point.name) {
        inPark = { name: P.point.name, port: P.point.port, atSec };
      }
    } else if (inPark) {
      startOrUpdate(atSec, loadingNameForPort(inPark.port), inPark.port);
      inPark = null;
    }

    if (F) {
      if (!inFac || inFac.name !== F.point.name) {
        inFac = { name: F.point.name, atSec };
      }
    } else if (inFac) {
      if (atSec - inFac.atSec >= MIN_FACTORY_DWELL_SEC) {
        arrive(inFac.atSec, inFac.name);
        depart(atSec, inFac.name);
      }
      inFac = null;
    }
  }

  if (inFac && open) {
    const last = points[points.length - 1];
    const end = last ? toSec(last.gpstime) : inFac.atSec;
    if (end - inFac.atSec >= MIN_FACTORY_DWELL_SEC) {
      arrive(inFac.atSec, inFac.name);
    }
  }

  if (open) out.push(open);
  return out;
}

export function draftsToTrips(
  drafts: TripDraft[],
  truck: {
    imei: string;
    plate: string;
    productLine: "LPG" | "PROPANE";
  },
): Trip[] {
  return drafts.map((d, i) => ({
    id: `${truck.imei}-${Date.parse(d.loadedAt) || i}-${d.status}`,
    imei: truck.imei,
    plate: truck.plate,
    productLine: truck.productLine,
    port: d.port,
    loadedFrom: d.loadedFrom,
    factory: d.factory,
    status: d.status,
    loadedAt: d.loadedAt,
    arrivedAt: d.arrivedAt,
    departedAt: d.departedAt,
  }));
}

function sameName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const aa = (a || "").trim().toUpperCase();
  const bb = (b || "").trim().toUpperCase();
  return Boolean(aa && bb && aa === bb);
}

function distinctFromArrived(loadedAt: string, arrivedAt: string | null): boolean {
  if (!arrivedAt) return true;
  const a = Date.parse(loadedAt);
  const b = Date.parse(arrivedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return b - a >= SAME_CLOCK_MS;
}

/** Closest GPS walk draft for an existing trip row. */
export function pickDraftForTrip(
  trip: Pick<Trip, "status" | "factory" | "loadedAt" | "arrivedAt" | "departedAt">,
  drafts: TripDraft[],
): TripDraft | null {
  if (!drafts.length) return null;
  const fac = drafts.filter((d) => sameName(d.factory, trip.factory));
  const pool = fac.length ? fac : drafts.filter((d) => d.arrivedAt || d.status !== "IN_TRANSIT");
  if (trip.status === "AT_FACTORY") {
    const open =
      pool.filter((d) => d.status === "AT_FACTORY").at(-1) ||
      pool.filter((d) => d.arrivedAt && !d.departedAt).at(-1);
    if (open) return open;
  }
  const target = Date.parse(
    trip.departedAt || trip.arrivedAt || trip.loadedAt,
  );
  if (!Number.isFinite(target) || !pool.length) return pool.at(-1) ?? drafts.at(-1) ?? null;
  return pool.reduce((best, d) => {
    const t = Date.parse(d.departedAt || d.arrivedAt || d.loadedAt);
    const bestT = Date.parse(best.departedAt || best.arrivedAt || best.loadedAt);
    return Math.abs(t - target) < Math.abs(bestT - target) ? d : best;
  });
}

export function applyDraftTimes(
  trip: Trip,
  draft: TripDraft,
): { trip: Trip; changed: boolean } {
  const next = { ...trip };
  let changed = false;
  if (draft.arrivedAt && next.arrivedAt !== draft.arrivedAt) {
    next.arrivedAt = draft.arrivedAt;
    changed = true;
  }
  if (
    draft.loadedAt &&
    distinctFromArrived(draft.loadedAt, draft.arrivedAt || next.arrivedAt) &&
    next.loadedAt !== draft.loadedAt
  ) {
    next.loadedAt = draft.loadedAt;
    changed = true;
  }
  if (
    next.status === "DELIVERED" &&
    draft.departedAt &&
    next.departedAt !== draft.departedAt
  ) {
    next.departedAt = draft.departedAt;
    changed = true;
  }
  if (
    draft.loadedFrom &&
    !/^unknown/i.test(draft.loadedFrom) &&
    /^unknown/i.test(next.loadedFrom || "")
  ) {
    next.loadedFrom = draft.loadedFrom;
    next.port = draft.port ?? next.port;
    changed = true;
  }
  if (draft.factory && !next.factory) {
    next.factory = draft.factory;
    changed = true;
  }
  return { trip: next, changed };
}
