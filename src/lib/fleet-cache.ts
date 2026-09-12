import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "@/lib/data-dir";
import type { FleetSnapshot } from "@/lib/fleet-types";
import { getRedis } from "@/lib/kv";

export const FLEET_SNAPSHOT_KEY = "green-gas:fleet-snapshot";
export const FLEET_REFRESH_LOCK_KEY = "green-gas:fleet-refresh-lock";

/** Serve cache as fresh under this age; older → return stale + background refresh. */
export const FLEET_FRESH_SEC = Number(process.env.FLEET_CACHE_FRESH_SEC || 120);

const FILE = () => path.join(dataDir(), "fleet-snapshot.json");

export async function readFleetSnapshot(): Promise<FleetSnapshot | null> {
  const redis = getRedis();
  if (redis) {
    const raw = await redis.get<FleetSnapshot | string>(FLEET_SNAPSHOT_KEY);
    if (!raw) return null;
    return typeof raw === "string"
      ? (JSON.parse(raw) as FleetSnapshot)
      : raw;
  }

  try {
    const text = await fs.readFile(FILE(), "utf8");
    return JSON.parse(text) as FleetSnapshot;
  } catch {
    return null;
  }
}

export async function writeFleetSnapshot(
  snapshot: FleetSnapshot,
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    // Keep longer than cron gap so cold starts still have data.
    await redis.set(FLEET_SNAPSHOT_KEY, snapshot, { ex: 60 * 30 });
    return;
  }

  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(FILE(), JSON.stringify(snapshot), "utf8");
}

export function snapshotAgeSec(snapshot: FleetSnapshot): number {
  const t = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - t) / 1000);
}

/** Acquire a short lock so only one ProTrack pull runs at a time. */
export async function tryAcquireRefreshLock(
  ttlSec = 90,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const ok = await redis.set(FLEET_REFRESH_LOCK_KEY, String(Date.now()), {
    nx: true,
    ex: ttlSec,
  });
  return ok === "OK";
}

export async function releaseRefreshLock(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(FLEET_REFRESH_LOCK_KEY);
}
