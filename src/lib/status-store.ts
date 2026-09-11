import { promises as fs } from "fs";
import path from "path";
import type { TruckMemory } from "./geofence";
import { dataDir } from "./data-dir";

const STATE_FILE = () => path.join(dataDir(), "truck-state.json");

type StoreShape = Record<string, TruckMemory>;

export async function readTruckStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STATE_FILE(), "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch {
    return {};
  }
}

export async function writeTruckStore(store: StoreShape): Promise<void> {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(STATE_FILE(), JSON.stringify(store, null, 2), "utf8");
}
