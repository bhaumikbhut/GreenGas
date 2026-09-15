import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "./data-dir";
import { getRedis } from "./kv";
import { SAME_CLOCK_MS } from "./trip-display";

export const TRIPS_KEY = "green-gas:trips:v1";
const TRIPS_FILE = () => path.join(dataDir(), "trips.json");
const MAX_TRIPS = 800;

export type TripStatus = "IN_TRANSIT" | "AT_FACTORY" | "DELIVERED";

export type Trip = {
  id: string;
  imei: string;
  plate: string;
  productLine: "LPG" | "PROPANE";
  /** Port code e.g. DAHEJ */
  port: string | null;
  /** Loading bay / fill point name */
  loadedFrom: string;
  factory: string | null;
  status: TripStatus;
  loadedAt: string;
  arrivedAt: string | null;
  /** Left factory — trip complete */
  departedAt: string | null;
};

async function readAll(): Promise<Trip[]> {
  const redis = getRedis();
  let list: Trip[] = [];
  if (redis) {
    const raw = await redis.get<Trip[] | string>(TRIPS_KEY);
    if (!raw) return [];
    list = typeof raw === "string" ? (JSON.parse(raw) as Trip[]) : raw;
  } else {
    try {
      const text = await fs.readFile(TRIPS_FILE(), "utf8");
      list = JSON.parse(text) as Trip[];
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeTrip).filter((t) => t.status !== "DELIVERED" || !isJunkTrip(t));
}

async function writeAll(trips: Trip[]): Promise<void> {
  const trimmed = dedupeTrips(trips.map(sanitizeTrip)).slice(0, MAX_TRIPS);
  const redis = getRedis();
  if (redis) {
    await redis.set(TRIPS_KEY, trimmed);
    return;
  }
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(TRIPS_FILE(), JSON.stringify(trimmed, null, 2), "utf8");
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isUnknownLoadedFrom(value: string | null | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return !v || v === "unknown loading point" || v === "unknown";
}

function isUnknownFactory(value: string | null | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return v === "unknown factory";
}

export async function persistSanitizedTrips(): Promise<number> {
  const trips = await readAll();
  await writeAll(trips);
  return trips.length;
}

export async function replaceAllTrips(trips: Trip[]): Promise<void> {
  await writeAll(dedupeTrips(trips));
}

/** Drop clone rows and keep one open trip per truck. */
export function dedupeTrips(trips: Trip[]): Trip[] {
  const byImei = new Map<string, Trip[]>();
  for (const t of trips) {
    const list = byImei.get(t.imei) || [];
    list.push(t);
    byImei.set(t.imei, list);
  }

  const out: Trip[] = [];
  for (const list of byImei.values()) {
    const open = list
      .filter((t) => t.status !== "DELIVERED")
      .sort((a, b) => Date.parse(b.loadedAt) - Date.parse(a.loadedAt));
    if (open.length) {
      const bestOpen = open.reduce((best, t) => scoreTrip(t) > scoreTrip(best) ? t : best);
      out.push(bestOpen);
    }

    const delivered = list
      .filter((t) => t.status === "DELIVERED")
      .sort((a, b) => Date.parse(b.loadedAt) - Date.parse(a.loadedAt));
    const keptDelivered: Trip[] = [];
    for (const t of delivered) {
      if (isJunkTrip(t)) continue;
      const clone = keptDelivered.find(
        (k) =>
          Math.abs(Date.parse(k.loadedAt) - Date.parse(t.loadedAt)) < 2 * 3600_000 &&
          (k.factory || "") === (t.factory || ""),
      );
      if (clone) {
        if (scoreTrip(t) > scoreTrip(clone)) {
          keptDelivered.splice(keptDelivered.indexOf(clone), 1, mergeTrip(clone, t));
        }
        continue;
      }
      keptDelivered.push(t);
    }
    out.push(...keptDelivered);
  }

  return out.sort((a, b) => Date.parse(b.loadedAt) - Date.parse(a.loadedAt));
}

function isJunkTrip(t: Trip): boolean {
  const loaded = Date.parse(t.loadedAt);
  const end = Date.parse(t.departedAt || t.arrivedAt || t.loadedAt);
  const mins =
    Number.isFinite(loaded) && Number.isFinite(end)
      ? (end - loaded) / 60000
      : 0;
  if (t.status === "DELIVERED" && mins < 15) return true;
  const unknown = isUnknownLoadedFrom(t.loadedFrom);
  const noFac = !t.factory || isUnknownFactory(t.factory);
  return unknown && noFac && mins < 20;
}

/** Drop illegal stamps and force Loaded ≤ Arrived ≤ Left. */
export function sanitizeTrip(t: Trip): Trip {
  const next: Trip = { ...t };
  if (next.status === "IN_TRANSIT") {
    next.arrivedAt = null;
    next.departedAt = null;
    next.factory = null;
    return next;
  }
  if (next.status === "AT_FACTORY") {
    next.departedAt = null;
  }
  const loaded = Date.parse(next.loadedAt);
  const arrived = next.arrivedAt ? Date.parse(next.arrivedAt) : NaN;
  const left = next.departedAt ? Date.parse(next.departedAt) : NaN;
  const hasL = Number.isFinite(loaded);
  const hasA = Number.isFinite(arrived);
  const hasD = Number.isFinite(left);

  if (next.status === "DELIVERED" && hasL && hasA && hasD) {
    const stamps = [loaded, arrived, left].sort((a, b) => a - b);
    next.loadedAt = new Date(stamps[0]).toISOString();
    next.arrivedAt = new Date(stamps[1]).toISOString();
    next.departedAt = new Date(stamps[2]).toISOString();
  } else {
    // Do not copy Arrived onto Loaded — that makes both clocks identical.
    if (hasA && hasD && arrived > left) {
      next.arrivedAt = next.departedAt;
    }
  }
  return next;
}

function scoreTrip(t: Trip): number {
  let n = 0;
  if (!isUnknownLoadedFrom(t.loadedFrom)) n += 4;
  if (t.factory && !isUnknownFactory(t.factory)) n += 4;
  if (t.port) n += 1;
  if (t.arrivedAt) n += 1;
  if (t.departedAt) n += 1;
  return n;
}

function mergeTrip(a: Trip, b: Trip): Trip {
  return {
    ...a,
    loadedFrom: isUnknownLoadedFrom(a.loadedFrom) ? b.loadedFrom : a.loadedFrom,
    factory: a.factory && !isUnknownFactory(a.factory) ? a.factory : b.factory,
    port: a.port || b.port,
    arrivedAt: a.arrivedAt || b.arrivedAt,
    departedAt: a.departedAt || b.departedAt,
    loadedAt:
      Date.parse(a.loadedAt) <= Date.parse(b.loadedAt) ? a.loadedAt : b.loadedAt,
  };
}

export async function scrubUnknownFactoryFromTrips(): Promise<number> {
  const trips = await readAll();
  let scrubbed = 0;
  for (const t of trips) {
    if (isUnknownFactory(t.factory)) {
      t.factory = null;
      scrubbed += 1;
    }
  }
  if (scrubbed) await writeAll(trips);
  return scrubbed;
}

/** Open a trip when truck becomes LOADED (filled at port). */
export async function openTrip(input: {
  imei: string;
  plate: string;
  productLine: "LPG" | "PROPANE";
  port: string | null;
  loadedFrom: string;
  at?: string;
}): Promise<Trip> {
  const trips = await readAll();
  const existing = trips.find(
    (t) => t.imei === input.imei && t.status !== "DELIVERED",
  );
  if (existing) {
    const nextFrom = input.loadedFrom?.trim();
    const better =
      nextFrom &&
      !isUnknownLoadedFrom(nextFrom) &&
      isUnknownLoadedFrom(existing.loadedFrom);
    const empty = !existing.loadedFrom && nextFrom;
    if (better || empty) {
      existing.loadedFrom = nextFrom;
      existing.port = input.port ?? existing.port;
      await writeAll(trips);
    } else if (
      nextFrom &&
      !isUnknownLoadedFrom(nextFrom) &&
      existing.loadedFrom !== nextFrom &&
      input.port &&
      !existing.port
    ) {
      existing.port = input.port;
      await writeAll(trips);
    }
    return existing;
  }

  const trip: Trip = {
    id: newId(),
    imei: input.imei,
    plate: input.plate,
    productLine: input.productLine,
    port: input.port,
    loadedFrom: isUnknownLoadedFrom(input.loadedFrom)
      ? "Unknown loading point"
      : input.loadedFrom,
    factory: null,
    status: "IN_TRANSIT",
    loadedAt: input.at || new Date().toISOString(),
    arrivedAt: null,
    departedAt: null,
  };
  trips.unshift(trip);
  await writeAll(trips);
  return trip;
}

/**
 * Replace "Unknown loading point" on open + recent trips for this IMEI
 * when GPS/history discovers the real bay.
 */
export async function fillUnknownLoadedFrom(input: {
  imei: string;
  loadedFrom: string;
  port?: string | null;
}): Promise<number> {
  const nextFrom = input.loadedFrom?.trim();
  if (!nextFrom || isUnknownLoadedFrom(nextFrom)) return 0;

  const trips = await readAll();
  let changed = 0;
  for (const t of trips) {
    if (t.imei !== input.imei) continue;
    if (!isUnknownLoadedFrom(t.loadedFrom)) continue;
    t.loadedFrom = nextFrom;
    if (input.port) t.port = input.port;
    changed += 1;
  }
  if (changed) await writeAll(trips);
  return changed;
}

/** Mark arrival when status becomes AT_FACTORY. */
export async function markTripArrived(input: {
  imei: string;
  factory: string;
  at?: string;
}): Promise<Trip | null> {
  const trips = await readAll();
  const trip = trips.find(
    (t) => t.imei === input.imei && t.status !== "DELIVERED",
  );
  if (!trip) return null;
  if (trip.status === "AT_FACTORY" && trip.factory === input.factory) {
    return trip;
  }
  trip.status = "AT_FACTORY";
  trip.factory = input.factory;
  const at = input.at || new Date().toISOString();
  if (!trip.arrivedAt && stampsAreDistinct(trip.loadedAt, at)) {
    trip.arrivedAt = at;
  }
  await writeAll(trips);
  return trip;
}

/** Close trip when truck leaves factory (empty again). */
export async function completeTrip(input: {
  imei: string;
  factory?: string | null;
  at?: string;
}): Promise<Trip | null> {
  const trips = await readAll();
  const trip = trips.find(
    (t) => t.imei === input.imei && t.status !== "DELIVERED",
  );
  if (!trip) return null;
  if (trip.status !== "AT_FACTORY" && !trip.arrivedAt) return null;
  trip.status = "DELIVERED";
  trip.factory = input.factory || trip.factory;
  trip.departedAt = input.at || new Date().toISOString();
  if (trip.arrivedAt && Date.parse(trip.departedAt) < Date.parse(trip.arrivedAt)) {
    trip.arrivedAt = trip.departedAt;
  }
  await writeAll(trips);
  return trip;
}

function stampsAreDistinct(
  earlier: string | null | undefined,
  later: string | null | undefined,
): boolean {
  if (!later) return false;
  if (!earlier) return true;
  const a = Date.parse(earlier);
  const b = Date.parse(later);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return b - a >= SAME_CLOCK_MS;
}

export type TripQuery = {
  limit?: number;
  plate?: string;
  port?: string;
  factory?: string;
  status?: TripStatus | "ALL";
  imei?: string;
  productLine?: "LPG" | "PROPANE" | "ALL";
};

export async function listTrips(query: TripQuery = {}): Promise<Trip[]> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), MAX_TRIPS);
  let trips = await readAll();
  const plateQ = query.plate?.trim().toLowerCase();
  const portQ = query.port?.trim().toLowerCase();
  const factoryQ = query.factory?.trim().toLowerCase();
  const statusQ = query.status && query.status !== "ALL" ? query.status : null;
  const imeiQ = query.imei?.trim();
  const productQ = query.productLine;

  trips = trips.filter((t) => {
    if (imeiQ && t.imei !== imeiQ) return false;
    if (productQ && productQ !== "ALL" && t.productLine !== productQ)
      return false;
    if (statusQ && t.status !== statusQ) return false;
    if (plateQ && !t.plate.toLowerCase().includes(plateQ)) return false;
    if (portQ) {
      const hay = `${t.port ?? ""} ${t.loadedFrom}`.toLowerCase();
      if (!hay.includes(portQ)) return false;
    }
    if (factoryQ && !(t.factory ?? "").toLowerCase().includes(factoryQ)) {
      return false;
    }
    return true;
  });

  return trips.slice(0, limit);
}

type FleetTruckLike = {
  imei: string;
  plate: string;
  productLine: "LPG" | "PROPANE";
  status: string;
  port: string | null;
  lastLoadedFrom: string | null;
  lastFactory: string | null;
};

/**
 * One read + one write reconcile of trips vs live fleet.
 * Use this instead of per-truck open/complete on page load (those hammer Turso).
 */
export async function reconcileTripsFromFleet(
  trucks: FleetTruckLike[],
  at?: string,
  opts?: { createMissing?: boolean },
): Promise<{ opened: number; arrived: number; completed: number; filledUnknown: number }> {
  const when = at || new Date().toISOString();
  const createMissing = opts?.createMissing === true;
  const trips = await readAll();
  const openByImei = new Map<string, Trip>();
  for (const t of trips) {
    if (t.status !== "DELIVERED" && !openByImei.has(t.imei)) {
      openByImei.set(t.imei, t);
    }
  }

  let opened = 0;
  let arrived = 0;
  let completed = 0;
  let filledUnknown = 0;
  let dirty = false;

  for (const truck of trucks) {
    if (truck.lastLoadedFrom && !isUnknownLoadedFrom(truck.lastLoadedFrom)) {
      for (const t of trips) {
        if (t.imei !== truck.imei) continue;
        if (!isUnknownLoadedFrom(t.loadedFrom)) continue;
        t.loadedFrom = truck.lastLoadedFrom;
        if (truck.port) t.port = truck.port;
        filledUnknown += 1;
        dirty = true;
      }
    }

    const open = openByImei.get(truck.imei);

    if (truck.status === "LOADED" && truck.lastLoadedFrom) {
      if (!open && createMissing) {
        const trip: Trip = {
          id: newId(),
          imei: truck.imei,
          plate: truck.plate,
          productLine: truck.productLine,
          port: truck.port,
          loadedFrom: isUnknownLoadedFrom(truck.lastLoadedFrom)
            ? "Unknown loading point"
            : truck.lastLoadedFrom,
          factory: null,
          status: "IN_TRANSIT",
          loadedAt: when,
          arrivedAt: null,
          departedAt: null,
        };
        trips.unshift(trip);
        openByImei.set(truck.imei, trip);
        opened += 1;
        dirty = true;
      } else if (
        open &&
        isUnknownLoadedFrom(open.loadedFrom) &&
        !isUnknownLoadedFrom(truck.lastLoadedFrom)
      ) {
        open.loadedFrom = truck.lastLoadedFrom;
        open.port = truck.port ?? open.port;
        dirty = true;
      }
      continue;
    }

    if (
      truck.status === "AT_FACTORY" &&
      truck.lastFactory &&
      !isUnknownFactory(truck.lastFactory)
    ) {
      if (!open && createMissing) {
        const trip: Trip = {
          id: newId(),
          imei: truck.imei,
          plate: truck.plate,
          productLine: truck.productLine,
          port: truck.port,
          loadedFrom: truck.lastLoadedFrom || "Unknown loading point",
          factory: truck.lastFactory,
          status: "AT_FACTORY",
          loadedAt: when,
          arrivedAt: when,
          departedAt: null,
        };
        trips.unshift(trip);
        openByImei.set(truck.imei, trip);
        opened += 1;
        arrived += 1;
        dirty = true;
      } else if (open) {
        if (
          isUnknownLoadedFrom(open.loadedFrom) &&
          truck.lastLoadedFrom &&
          !isUnknownLoadedFrom(truck.lastLoadedFrom)
        ) {
          open.loadedFrom = truck.lastLoadedFrom;
          open.port = truck.port ?? open.port;
          dirty = true;
        }
        if (open.status !== "AT_FACTORY" || open.factory !== truck.lastFactory) {
          open.status = "AT_FACTORY";
          open.factory = truck.lastFactory;
          if (!open.arrivedAt && stampsAreDistinct(open.loadedAt, when)) {
            open.arrivedAt = when;
          }
          arrived += 1;
          dirty = true;
        }
      }
      continue;
    }

    if (
      open &&
      (truck.status === "ON_ROAD" ||
        truck.status === "PARK" ||
        truck.status === "LOADING" ||
        truck.status === "EMPTY")
    ) {
      const canClose = open.status === "AT_FACTORY" || Boolean(open.arrivedAt);
      if (
        canClose &&
        (open.factory ||
          (truck.lastFactory && !isUnknownFactory(truck.lastFactory)))
      ) {
        open.status = "DELIVERED";
        open.factory =
          truck.lastFactory && !isUnknownFactory(truck.lastFactory)
            ? truck.lastFactory
            : open.factory;
        if (!open.departedAt) open.departedAt = when;
        if (
          open.arrivedAt &&
          Date.parse(open.departedAt) < Date.parse(open.arrivedAt)
        ) {
          open.arrivedAt = open.departedAt;
        }
        // Do not invent Arrived = Left when they never had an arrival stamp.
        openByImei.delete(truck.imei);
        completed += 1;
        dirty = true;
      }
    }
  }

  const next = dedupeTrips(trips);
  if (dirty || next.length !== trips.length) await writeAll(next);
  return { opened, arrived, completed, filledUnknown };
}
