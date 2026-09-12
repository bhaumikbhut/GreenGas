import { promises as fs } from "fs";
import path from "path";
import type { TruckMemory } from "./geofence";
import { dataDir } from "./data-dir";
import { getRedis, TRUCK_STATE_KEY, statusStoreMode } from "./kv";

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

function parseStore(raw: unknown): StoreShape {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StoreShape;
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as StoreShape;
  return {};
}

export async function readTruckStore(): Promise<StoreShape> {
  const kv = getRedis();
  if (kv) {
    const raw = await kv.get<StoreShape | string>(TRUCK_STATE_KEY);
    return parseStore(raw);
  }
  return readFileStore();
}

/** Persist full fleet memory as one KV value in Turso. */
export async function writeTruckStore(store: StoreShape): Promise<void> {
  const kv = getRedis();
  if (kv) {
    await kv.set(TRUCK_STATE_KEY, store);
    return;
  }
  await writeFileStore(store);
}

export { statusStoreMode };
