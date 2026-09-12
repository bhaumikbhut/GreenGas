import {
  findNearestFactoryPoint,
  findNearestLoadingPoint,
  findNearestParkingPoint,
  nextStatus,
  normalizeMemory,
  type AutoStatus,
  type TruckMemory,
} from "@/lib/geofence";
import { PORT_LOADING_POINTS } from "@/lib/loading-points";
import { readFleetSnapshot, writeFleetSnapshot } from "@/lib/fleet-cache";
import type { FleetSnapshot, TruckSnapshot } from "@/lib/fleet-types";
import {
  fetchAllPortalFleets,
  fetchPortalPlayback,
  type PortalPlaybackPoint,
} from "@/lib/protrack-portal";
import { getConfiguredAccounts, type ProtrackAccount } from "@/lib/protrack";
import { readTruckStore, writeTruckStore } from "@/lib/status-store";
import {
  completeTrip,
  markTripArrived,
  openTrip,
  listTrips,
  fillUnknownLoadedFrom,
  TRIPS_KEY,
} from "@/lib/trips";
import { getRedis } from "@/lib/kv";

export type ReplayTransition = {
  at: string;
  from: AutoStatus;
  to: AutoStatus;
  loadedFrom?: string | null;
  factory?: string | null;
};

export type ReplayResult = {
  memory: TruckMemory;
  transitions: ReplayTransition[];
  pointsUsed: number;
};

/** Replay GPS trail through the live geofence state machine. */
export function replayPlaybackPoints(
  points: PortalPlaybackPoint[],
  start?: TruckMemory,
  radiusM = 500,
): ReplayResult {
  let memory = normalizeMemory(start ?? undefined);
  const transitions: ReplayTransition[] = [];

  for (const p of points) {
    const now = p.gpstime > 1e12 ? p.gpstime : p.gpstime * 1000;
    const insideLoading = findNearestLoadingPoint(p.latitude, p.longitude);
    const insideParking = findNearestParkingPoint(p.latitude, p.longitude);
    const insideFactory = findNearestFactoryPoint(
      p.latitude,
      p.longitude,
      radiusM,
    );
    const prev = memory;
    memory = nextStatus({
      prev,
      insideLoading,
      insideParking,
      insideFactory,
      online: true,
      now,
    });
    if (memory.status !== prev.status) {
      transitions.push({
        at: new Date(now).toISOString(),
        from: prev.status,
        to: memory.status,
        loadedFrom: memory.lastLoadedFrom,
        factory: memory.lastFactory,
      });
    }
  }

  return { memory, transitions, pointsUsed: points.length };
}

function portForLoadedFrom(name: string | null | undefined): string | null {
  if (!name) return null;
  return PORT_LOADING_POINTS.find((p) => p.name === name)?.port ?? null;
}

function recount(snap: FleetSnapshot): void {
  const statusCounts: Record<string, number> = {
    PARK: 0,
    LOADING: 0,
    LOADED: 0,
    AT_FACTORY: 0,
    EMPTY: 0,
    ON_ROAD: 0,
    OFFLINE: 0,
  };
  for (const t of snap.trucks) {
    if (t.status in statusCounts) statusCounts[t.status] += 1;
  }
  snap.statusCounts = statusCounts;
  snap.statusCountTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0);
}

function applyMemoryToTruck(
  truck: TruckSnapshot,
  memory: TruckMemory,
  radiusM: number,
): void {
  truck.status = memory.status === "EMPTY" ? "ON_ROAD" : memory.status;
  truck.cargo = memory.cargo;
  truck.lastLoadedFrom = memory.lastLoadedFrom ?? null;
  truck.lastFactory = memory.lastFactory ?? null;
  truck.lastPark = memory.lastPark ?? null;
  truck.port =
    portForLoadedFrom(memory.lastLoadedFrom) ||
    truck.port ||
    null;

  if (truck.lat != null && truck.lng != null) {
    const L = findNearestLoadingPoint(truck.lat, truck.lng);
    const P = findNearestParkingPoint(truck.lat, truck.lng);
    const F = findNearestFactoryPoint(truck.lat, truck.lng, radiusM);
    truck.loadingPoint = L?.point.name ?? null;
    truck.parkingPoint = P?.point.name ?? null;
    truck.factoryPoint = F?.point.name ?? null;
    truck.distanceM = Math.round(
      L?.distanceM ?? P?.distanceM ?? F?.distanceM ?? 0,
    ) || null;
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export type HealFromPlaybackOptions = {
  hours?: number;
  /** Only heal these statuses (default: all online trucks). */
  onlyStatuses?: AutoStatus[];
  concurrency?: number;
  maxTrucks?: number;
  dryRun?: boolean;
  /** Delay between truck jobs (ms) to avoid portal TPS 10009. */
  pauseMs?: number;
};

export type HealFromPlaybackResult = {
  scanned: number;
  healed: number;
  failed: number;
  statusCounts: Record<string, number>;
  tripSync: { opened: number; arrived: number; completed: number };
  samples: string[];
  errors: string[];
};

/**
 * Pull portal playback for fleet trucks, replay geofence rules,
 * update Turso truck-state + fleet snapshot + trips.
 */
export async function healFleetFromPlayback(
  options: HealFromPlaybackOptions = {},
): Promise<HealFromPlaybackResult> {
  const hours = Math.min(72, Math.max(6, options.hours ?? 36));
  const concurrency = Math.min(8, Math.max(1, options.concurrency ?? 2));
  const dryRun = Boolean(options.dryRun);
  const pauseMs = Math.max(0, options.pauseMs ?? 400);
  const end = Math.floor(Date.now() / 1000);
  const begin = end - hours * 3600;

  let snap = await readFleetSnapshot();
  if (!snap?.trucks?.length) {
    const { refreshFleetLiveGps } = await import("@/lib/refresh-fleet");
    const refreshed = await refreshFleetLiveGps();
    snap = refreshed.snapshot ?? (await readFleetSnapshot());
  }
  if (!snap?.trucks?.length) {
    throw new Error("No fleet snapshot — refresh live GPS first");
  }
  const radiusM = snap.radiusM || 500;
  const store = await readTruckStore();

  // One portal fleet pull → deviceId map (avoid per-IMEI lookup).
  const portal = await fetchAllPortalFleets();
  const accounts = getConfiguredAccounts();
  const accountByLabel = new Map(accounts.map((a) => [a.label, a]));
  const deviceByImei = new Map<
    string,
    { deviceId: string; account: ProtrackAccount; plate: string }
  >();
  for (const row of portal.rows) {
    if (!row.device.deviceId) continue;
    const acc = accountByLabel.get(row.device.accountLabel);
    if (!acc) continue;
    deviceByImei.set(row.device.imei, {
      deviceId: row.device.deviceId,
      account: acc,
      plate: row.device.plate,
    });
  }

  let trucks = snap.trucks.filter((t) => t.online !== false);
  if (options.onlyStatuses?.length) {
    const set = new Set(options.onlyStatuses);
    trucks = trucks.filter((t) => set.has(t.status));
  }
  if (options.maxTrucks && options.maxTrucks > 0) {
    trucks = trucks.slice(0, options.maxTrucks);
  }

  const samples: string[] = [];
  const errors: string[] = [];
  let healed = 0;
  let failed = 0;
  let opened = 0;
  let arrived = 0;
  let completed = 0;

  type JobResult = {
    imei: string;
    plate: string;
    prev: AutoStatus;
    next: AutoStatus;
    memory: TruckMemory;
    transitions: ReplayTransition[];
    points: number;
    productLine: "LPG" | "PROPANE";
    error?: string;
  };

  const jobs = await mapPool(trucks, concurrency, async (truck, index) => {
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    if (index > 0 && index % 10 === 0) {
      console.error(`heal progress ${index}/${trucks.length}`);
    }
    const meta = deviceByImei.get(truck.imei);
    if (!meta) {
      return {
        imei: truck.imei,
        plate: truck.plate,
        prev: truck.status,
        next: truck.status,
        memory: normalizeMemory(store[truck.imei]),
        transitions: [],
        points: 0,
        productLine: truck.productLine,
        error: "no portal deviceId",
      } satisfies JobResult;
    }
    try {
      const pb = await fetchPortalPlayback({
        imei: truck.imei,
        begin,
        end,
        deviceId: meta.deviceId,
        account: meta.account,
        maxPages: 50,
      });
      // Fresh empty start — reconstruct from trail, don't inherit bad state.
      const replay = replayPlaybackPoints(pb.points, undefined, radiusM);
      return {
        imei: truck.imei,
        plate: truck.plate,
        prev: truck.status,
        next: replay.memory.status,
        memory: replay.memory,
        transitions: replay.transitions,
        points: replay.pointsUsed,
        productLine: truck.productLine,
      } satisfies JobResult;
    } catch (err) {
      return {
        imei: truck.imei,
        plate: truck.plate,
        prev: truck.status,
        next: truck.status,
        memory: normalizeMemory(store[truck.imei]),
        transitions: [],
        points: 0,
        productLine: truck.productLine,
        error: err instanceof Error ? err.message : String(err),
      } satisfies JobResult;
    }
  });

  for (const job of jobs) {
    if (job.error) {
      failed += 1;
      if (errors.length < 30) errors.push(`${job.plate}: ${job.error}`);
      continue;
    }
    if (job.points === 0) continue;

    store[job.imei] = job.memory;
    const truck = snap.trucks.find((t) => t.imei === job.imei);
    if (truck) applyMemoryToTruck(truck, job.memory, radiusM);

    if (job.prev !== job.next) {
      healed += 1;
      if (samples.length < 50) {
        samples.push(
          `${job.plate}: ${job.prev} → ${job.next} (${job.points} pts)`,
        );
      }
    }
  }

  if (!dryRun) {
    // Serial trip reconcile from final reconstructed status (avoids KV races).
    for (const job of jobs) {
      if (job.error || job.points === 0) continue;
      const final = job.memory.status;
      const loadedFrom = job.memory.lastLoadedFrom;
      const port = portForLoadedFrom(loadedFrom);

      // Fill Unknown on any trip for this truck when history found a bay.
      if (loadedFrom) {
        await fillUnknownLoadedFrom({
          imei: job.imei,
          loadedFrom,
          port,
        });
      }

      if (final === "LOADED" && loadedFrom) {
        await openTrip({
          imei: job.imei,
          plate: job.plate,
          productLine: job.productLine,
          port,
          loadedFrom,
        });
        opened += 1;
      } else if (final === "AT_FACTORY" && job.memory.lastFactory) {
        await openTrip({
          imei: job.imei,
          plate: job.plate,
          productLine: job.productLine,
          port,
          loadedFrom: loadedFrom || "Unknown loading point",
        });
        await markTripArrived({
          imei: job.imei,
          factory: job.memory.lastFactory,
        });
        arrived += 1;
      } else if (
        final === "ON_ROAD" ||
        final === "PARK" ||
        final === "LOADING" ||
        final === "EMPTY"
      ) {
        const closed = await completeTrip({
          imei: job.imei,
          factory: job.memory.lastFactory,
        });
        if (closed) completed += 1;
      }
    }

    recount(snap);
    snap.fetchedAt = new Date().toISOString();
    await writeTruckStore(store);
    await writeFleetSnapshot(snap);
    await pruneOrphanOpenTrips(snap);
  } else {
    recount(snap);
  }

  return {
    scanned: trucks.length,
    healed,
    failed,
    statusCounts: snap.statusCounts,
    tripSync: { opened, arrived, completed },
    samples,
    errors,
  };
}

/** Drop open trips that no longer match LOADED/AT_FACTORY trucks. */
export async function pruneOrphanOpenTrips(
  snap: FleetSnapshot,
): Promise<number> {
  const filled = new Set(
    snap.trucks
      .filter((t) => t.status === "LOADED" || t.status === "AT_FACTORY")
      .map((t) => t.imei),
  );
  const trips = await listTrips({ limit: 800, status: "ALL" });
  let removed = 0;
  const kept = [];
  for (const t of trips) {
    if (t.status === "DELIVERED") {
      kept.push(t);
      continue;
    }
    if (!filled.has(t.imei)) {
      // Mark delivered rather than delete (keep history)
      kept.push({
        ...t,
        status: "DELIVERED" as const,
        departedAt: t.departedAt || new Date().toISOString(),
        arrivedAt: t.arrivedAt || new Date().toISOString(),
      });
      removed += 1;
      continue;
    }
    kept.push(t);
  }
  const redis = getRedis();
  if (redis) {
    await redis.set(TRIPS_KEY, kept.slice(0, 800));
  }
  return removed;
}
