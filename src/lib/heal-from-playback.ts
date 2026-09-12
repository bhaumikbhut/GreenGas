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
  listTrips,
  fillUnknownLoadedFrom,
  reconcileTripsFromFleet,
  scrubUnknownFactoryFromTrips,
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
      lat: p.latitude,
      lng: p.longitude,
      speed: p.speed,
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

function toSec(gpstime: number): number {
  return gpstime > 1e12 ? Math.floor(gpstime / 1000) : Math.floor(gpstime);
}

type PinHit = { id: string; name: string; port?: string | null; atSec: number };

/** Last enter/leave of known loading / parking / factory pins in a trail. */
export function extractPinEvents(
  points: PortalPlaybackPoint[],
  radiusM = 500,
): {
  lastLeaveLoad: PinHit | null;
  lastEnterLoad: PinHit | null;
  lastLeaveFactory: PinHit | null;
  lastEnterFactory: PinHit | null;
  lastLeavePark: PinHit | null;
  lastEnterPark: PinHit | null;
  /** Factory leave only if the truck dwelled (not a drive-by). */
  lastRealFactoryLeave: PinHit | null;
  stillInLoad: PinHit | null;
  stillInFactory: PinHit | null;
  stillInPark: PinHit | null;
} {
  const MIN_FACTORY_DWELL_SEC = 15 * 60;
  let inLoad: PinHit | null = null;
  let inFac: PinHit | null = null;
  let inPark: PinHit | null = null;
  let lastLeaveLoad: PinHit | null = null;
  let lastEnterLoad: PinHit | null = null;
  let lastLeaveFactory: PinHit | null = null;
  let lastEnterFactory: PinHit | null = null;
  let lastLeavePark: PinHit | null = null;
  let lastEnterPark: PinHit | null = null;
  let lastRealFactoryLeave: PinHit | null = null;
  let factoryEnterAt = 0;

  for (const p of points) {
    const atSec = toSec(p.gpstime);
    const L = findNearestLoadingPoint(p.latitude, p.longitude);
    const P = findNearestParkingPoint(p.latitude, p.longitude);
    const F = findNearestFactoryPoint(p.latitude, p.longitude, radiusM);

    if (L) {
      if (!inLoad || inLoad.id !== L.point.id) {
        inLoad = {
          id: L.point.id,
          name: L.point.name,
          port: L.point.port,
          atSec,
        };
        lastEnterLoad = inLoad;
      }
    } else if (inLoad) {
      lastLeaveLoad = { ...inLoad, atSec };
      inLoad = null;
    }

    if (F) {
      if (!inFac || inFac.id !== F.point.id) {
        inFac = {
          id: F.point.id,
          name: F.point.name,
          atSec,
        };
        lastEnterFactory = inFac;
        factoryEnterAt = atSec;
      }
    } else if (inFac) {
      lastLeaveFactory = { ...inFac, atSec };
      if (atSec - factoryEnterAt >= MIN_FACTORY_DWELL_SEC) {
        lastRealFactoryLeave = { ...inFac, atSec };
      }
      inFac = null;
      factoryEnterAt = 0;
    }

    if (P) {
      if (!inPark || inPark.id !== P.point.id) {
        inPark = {
          id: P.point.id,
          name: P.point.name,
          port: P.point.port,
          atSec,
        };
        lastEnterPark = inPark;
      }
    } else if (inPark) {
      lastLeavePark = { ...inPark, atSec };
      inPark = null;
    }
  }

  return {
    lastLeaveLoad,
    lastEnterLoad,
    lastLeaveFactory,
    lastEnterFactory,
    lastLeavePark,
    lastEnterPark,
    lastRealFactoryLeave,
    stillInLoad: inLoad,
    stillInFactory: inFac,
    stillInPark: inPark,
  };
}

/**
 * Cargo from history (last leave-loading vs last leave-factory),
 * then current status from the live GPS pin.
 */
export function memoryFromLiveAndHistory(params: {
  online: boolean;
  lat: number | null;
  lng: number | null;
  points: PortalPlaybackPoint[];
  radiusM?: number;
  now?: number;
}): TruckMemory {
  const radiusM = params.radiusM ?? 500;
  const now = params.now ?? Date.now();
  const ev = extractPinEvents(params.points, radiusM);

  const lastLoad = ev.lastLeaveLoad || ev.lastEnterLoad;
  const lastFac = ev.lastLeaveFactory || ev.lastEnterFactory;
  const lastPark = ev.lastEnterPark || ev.lastLeavePark;

  // Filled if they left a loading bay OR left port parking (they always
  // go park → load → filled) and have not left a factory since.
  const lastPortLeaveAt = Math.max(
    ev.lastLeaveLoad?.atSec ?? 0,
    ev.lastLeavePark?.atSec ?? 0,
  );
  const filled =
    lastPortLeaveAt > 0 &&
    (!ev.lastRealFactoryLeave ||
      lastPortLeaveAt >= ev.lastRealFactoryLeave.atSec);

  const insideLoading =
    params.lat != null && params.lng != null
      ? findNearestLoadingPoint(params.lat, params.lng)
      : null;
  const insideParking =
    params.lat != null && params.lng != null
      ? findNearestParkingPoint(params.lat, params.lng)
      : null;
  const insideFactory =
    params.lat != null && params.lng != null
      ? findNearestFactoryPoint(params.lat, params.lng, radiusM)
      : null;

  const lastLoadedFrom =
    lastLoad?.name ??
    (lastPark?.port
      ? PORT_LOADING_POINTS.find((p) => p.port === lastPark.port)?.name ?? null
      : null);
  const lastFactory = insideFactory?.point.name ?? lastFac?.name ?? null;
  const lastParkName = insideParking?.point.name ?? lastPark?.name ?? null;

  const base = {
    lastNotifiedStatus: null as AutoStatus | null,
    lastNotifiedAt: null as number | null,
    lastLoadedFrom,
    lastFactory,
    lastPark: lastParkName,
  };

  if (!params.online) {
    return {
      ...base,
      status: "OFFLINE",
      geofenceId: null,
      geofenceKind: null,
      enteredAt: null,
      outsideStreak: 0,
      cargo: filled ? "LOADED" : "EMPTY",
    };
  }

  // Live pin wins for where the truck is right now.
  if (insideFactory) {
    return {
      ...base,
      status: "AT_FACTORY",
      geofenceId: insideFactory.point.id,
      geofenceKind: "factory",
      enteredAt: now,
      outsideStreak: 0,
      cargo: "LOADED",
      lastFactory: insideFactory.point.name,
    };
  }

  if (insideLoading) {
    const sameBay =
      filled &&
      lastLoadedFrom != null &&
      lastLoadedFrom === insideLoading.point.name;
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
      geofenceId: insideLoading.point.id,
      geofenceKind: "loading",
      enteredAt: now,
      outsideStreak: 0,
      cargo: "EMPTY",
      lastLoadedFrom: null,
    };
  }

  if (insideParking && !filled) {
    return {
      ...base,
      status: "PARK",
      geofenceId: insideParking.point.id,
      geofenceKind: "parking",
      enteredAt: now,
      outsideStreak: 0,
      cargo: "EMPTY",
      lastPark: insideParking.point.name,
    };
  }

  if (filled) {
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
    status: "ON_ROAD",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "EMPTY",
  };
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
    truck.factoryPoint =
      F?.point.name ??
      (memory.status === "AT_FACTORY" ? memory.lastFactory || null : null);
    truck.distanceM =
      Math.round(L?.distanceM ?? P?.distanceM ?? F?.distanceM ?? 0) || null;
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

  const { refreshFleetLiveGps } = await import("@/lib/refresh-fleet");
  const refreshed = await refreshFleetLiveGps();
  let snap = refreshed.snapshot ?? (await readFleetSnapshot());
  if (!snap?.trucks?.length) {
    snap = await readFleetSnapshot();
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

  let trucks = snap.trucks.slice();
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
      const memory = memoryFromLiveAndHistory({
        online: Boolean(truck.online),
        lat: truck.lat,
        lng: truck.lng,
        points: [],
        radiusM,
      });
      return {
        imei: truck.imei,
        plate: truck.plate,
        prev: truck.status,
        next: memory.status,
        memory,
        transitions: [],
        points: 0,
        productLine: truck.productLine,
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
      const memory = memoryFromLiveAndHistory({
        online: Boolean(truck.online),
        lat: truck.lat,
        lng: truck.lng,
        points: pb.points,
        radiusM,
      });
      const replay = replayPlaybackPoints(pb.points, undefined, radiusM);
      return {
        imei: truck.imei,
        plate: truck.plate,
        prev: truck.status,
        next: memory.status,
        memory,
        transitions: replay.transitions,
        points: pb.points.length,
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
    recount(snap);
    snap.fetchedAt = new Date().toISOString();
    await writeTruckStore(store);
    await writeFleetSnapshot(snap);
    const tripSync = await reconcileTripsFromFleet(snap.trucks);
    opened = tripSync.opened;
    arrived = tripSync.arrived;
    completed = tripSync.completed;
    for (const job of jobs) {
      if (job.error || !job.memory.lastLoadedFrom) continue;
      await fillUnknownLoadedFrom({
        imei: job.imei,
        loadedFrom: job.memory.lastLoadedFrom,
        port: portForLoadedFrom(job.memory.lastLoadedFrom),
      });
    }
    await scrubUnknownFactoryFromTrips();
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
