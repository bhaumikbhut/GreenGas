import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "./data-dir";
import { getRedis } from "./kv";

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
  if (redis) {
    const raw = await redis.get<Trip[] | string>(TRIPS_KEY);
    if (!raw) return [];
    const list = typeof raw === "string" ? (JSON.parse(raw) as Trip[]) : raw;
    return Array.isArray(list) ? list : [];
  }
  try {
    const text = await fs.readFile(TRIPS_FILE(), "utf8");
    const list = JSON.parse(text) as Trip[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeAll(trips: Trip[]): Promise<void> {
  const trimmed = trips.slice(0, MAX_TRIPS);
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

/** Clear legacy "Unknown factory" labels from trip history. */
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
  trip.arrivedAt = trip.arrivedAt || input.at || new Date().toISOString();
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
  trip.status = "DELIVERED";
  trip.factory = input.factory || trip.factory;
  trip.arrivedAt = trip.arrivedAt || input.at || new Date().toISOString();
  trip.departedAt = input.at || new Date().toISOString();
  await writeAll(trips);
  return trip;
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
): Promise<{ opened: number; arrived: number; completed: number; filledUnknown: number }> {
  const when = at || new Date().toISOString();
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
      if (!open) {
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
      if (!open) {
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
      } else {
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
          open.arrivedAt = open.arrivedAt || when;
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
      open.status = "DELIVERED";
      open.factory =
        truck.lastFactory && !isUnknownFactory(truck.lastFactory)
          ? truck.lastFactory
          : open.factory;
      open.arrivedAt = open.arrivedAt || when;
      open.departedAt = when;
      openByImei.delete(truck.imei);
      completed += 1;
      dirty = true;
    }
  }

  if (dirty) await writeAll(trips);
  return { opened, arrived, completed, filledUnknown };
}
