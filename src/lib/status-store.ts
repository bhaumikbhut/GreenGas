import { promises as fs } from "fs";
import path from "path";
import type { TruckMemory } from "./geofence";
import { dataDir } from "./data-dir";
import { getRedis, TRUCK_HASH_KEY, statusStoreMode } from "./kv";

const STATE_FILE = () => path.join(dataDir(), "truck-state.json");

export type StoreShape = Record<string, TruckMemory>;

async function readFileStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STATE_FILE(), "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch {
    return {};
  }
}

async function writeFileStore(store: StoreShape): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(STATE_FILE(), JSON.stringify(store, null, 2), "utf8");
}

export async function readTruckStore(): Promise<StoreShape> {
  const redis = getRedis();
  if (redis) {
    const all = await redis.hgetall<Record<string, TruckMemory>>(TRUCK_HASH_KEY);
    if (!all || Object.keys(all).length === 0) return {};
    // Upstash may return already-parsed objects or JSON strings
    const out: StoreShape = {};
    for (const [imei, value] of Object.entries(all)) {
      if (value == null) continue;
      out[imei] =
        typeof value === "string"
          ? (JSON.parse(value) as TruckMemory)
          : (value as TruckMemory);
    }
    return out;
  }
  return readFileStore();
}

/**
 * Persist full fleet memory. Uses per-IMEI Redis hash fields so concurrent
 * serverless writes don't wipe other trucks' status.
 */
export async function writeTruckStore(store: StoreShape): Promise<void> {
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    for (const [imei, memory] of Object.entries(store)) {
      pipeline.hset(TRUCK_HASH_KEY, { [imei]: memory });
    }
    await pipeline.exec();
    return;
  }
  await writeFileStore(store);
}

export { statusStoreMode };
