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
    // Already in transit / at factory — keep; refresh fill source if empty.
    if (!existing.loadedFrom && input.loadedFrom) {
      existing.loadedFrom = input.loadedFrom;
      existing.port = input.port ?? existing.port;
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
    loadedFrom: input.loadedFrom || "Unknown loading point",
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
