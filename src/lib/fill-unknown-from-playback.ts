import {
  findNearestLoadingPoint,
} from "@/lib/geofence";
import { PORT_LOADING_POINTS } from "@/lib/loading-points";
import {
  fetchAllPortalFleets,
  fetchPortalPlayback,
  type PortalPlaybackPoint,
} from "@/lib/protrack-portal";
import { getConfiguredAccounts, type ProtrackAccount } from "@/lib/protrack";
import {
  fillUnknownLoadedFrom,
  listTrips,
  type Trip,
} from "@/lib/trips";

function isUnknown(value: string | null | undefined): boolean {
  const v = (value || "").trim().toLowerCase();
  return !v || v === "unknown loading point" || v === "unknown";
}

function toSec(gpstime: number): number {
  return gpstime > 1e12 ? Math.floor(gpstime / 1000) : Math.floor(gpstime);
}

/**
 * Walk GPS trail; last time the truck left a loading bay = filled-at.
 * If still inside a bay at cutoff, use that bay.
 */
export function findLastLoadedFromInTrail(
  points: PortalPlaybackPoint[],
  beforeUnixSec?: number,
): { name: string; port: string | null; atSec: number } | null {
  let insideName: string | null = null;
  let insidePort: string | null = null;
  let lastLeave: { name: string; port: string | null; atSec: number } | null =
    null;

  for (const p of points) {
    const t = toSec(p.gpstime);
    if (beforeUnixSec != null && t > beforeUnixSec) break;

    const hit = findNearestLoadingPoint(p.latitude, p.longitude);
    if (hit) {
      insideName = hit.point.name;
      insidePort = hit.point.port;
    } else if (insideName) {
      lastLeave = {
        name: insideName,
        port: insidePort,
        atSec: t,
      };
      insideName = null;
      insidePort = null;
    }
  }

  if (insideName) {
    return {
      name: insideName,
      port: insidePort,
      atSec: beforeUnixSec ?? toSec(points[points.length - 1]?.gpstime || 0),
    };
  }
  return lastLeave;
}

function portForName(name: string): string | null {
  return PORT_LOADING_POINTS.find((p) => p.name === name)?.port ?? null;
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

export type FillUnknownResult = {
  unknownTrips: number;
  imeis: number;
  filled: number;
  failed: number;
  samples: string[];
  errors: string[];
  stillUnknown: number;
};

/**
 * For trips with "Unknown loading point", pull portal playback and
 * set Filled-at from the last loading-bay exit in the trail.
 */
export async function fillUnknownTripsFromPlayback(options?: {
  hoursLookback?: number;
  concurrency?: number;
  pauseMs?: number;
  dryRun?: boolean;
}): Promise<FillUnknownResult> {
  const hoursLookback = Math.min(120, Math.max(24, options?.hoursLookback ?? 72));
  const concurrency = Math.min(4, Math.max(1, options?.concurrency ?? 1));
  const pauseMs = Math.max(0, options?.pauseMs ?? 1200);
  const dryRun = Boolean(options?.dryRun);

  const all = await listTrips({ limit: 800, status: "ALL" });
  const unknownTrips = all.filter((t) => isUnknown(t.loadedFrom));
  const byImei = new Map<string, Trip[]>();
  for (const t of unknownTrips) {
    const list = byImei.get(t.imei) || [];
    list.push(t);
    byImei.set(t.imei, list);
  }

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

  const imeis = [...byImei.keys()];
  const samples: string[] = [];
  const errors: string[] = [];
  let filled = 0;
  let failed = 0;

  await mapPool(imeis, concurrency, async (imei, index) => {
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    if (index > 0 && index % 5 === 0) {
      console.error(`fill-unknown progress ${index}/${imeis.length}`);
    }

    const trips = byImei.get(imei) || [];
    const meta = deviceByImei.get(imei);
    if (!meta) {
      failed += 1;
      if (errors.length < 20) errors.push(`${imei}: no portal deviceId`);
      return;
    }

    // Window: farthest lookback from earliest unknown trip → now
    const times = trips.map((t) => Date.parse(t.loadedAt)).filter(Number.isFinite);
    const earliest = times.length ? Math.min(...times) : Date.now();
    const endSec = Math.floor(Date.now() / 1000);
    const beginSec = Math.floor(earliest / 1000) - hoursLookback * 3600;

    try {
      const pb = await fetchPortalPlayback({
        imei,
        begin: beginSec,
        end: endSec,
        deviceId: meta.deviceId,
        account: meta.account,
        maxPages: 60,
      });

      // Prefer leave before first factory arrival if any
      const beforeArrivals = trips
        .map((t) => (t.arrivedAt ? Date.parse(t.arrivedAt) : NaN))
        .filter(Number.isFinite);
      const beforeSec = beforeArrivals.length
        ? Math.floor(Math.min(...beforeArrivals) / 1000)
        : undefined;

      let found = findLastLoadedFromInTrail(pb.points, beforeSec);
      if (!found) found = findLastLoadedFromInTrail(pb.points);

      if (!found) {
        if (errors.length < 30) {
          errors.push(
            `${meta.plate}: no loading bay in ${pb.points.length} GPS pts`,
          );
        }
        return;
      }

      const port = found.port || portForName(found.name);
      if (dryRun) {
        filled += trips.length;
        if (samples.length < 40) {
          samples.push(`${meta.plate}: → ${found.name} (${trips.length} trips)`);
        }
        return;
      }

      const n = await fillUnknownLoadedFrom({
        imei,
        loadedFrom: found.name,
        port,
      });
      if (n > 0) {
        filled += n;
        if (samples.length < 40) {
          samples.push(`${meta.plate}: → ${found.name} (${n})`);
        }
      }
    } catch (err) {
      failed += 1;
      if (errors.length < 30) {
        errors.push(
          `${meta.plate}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  });

  const after = await listTrips({ limit: 800, status: "ALL" });
  const stillUnknown = after.filter((t) => isUnknown(t.loadedFrom)).length;

  return {
    unknownTrips: unknownTrips.length,
    imeis: imeis.length,
    filled,
    failed,
    samples,
    errors,
    stillUnknown,
  };
}
