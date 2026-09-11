import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "./data-dir";

const LOG_FILE = () => path.join(dataDir(), "notifications.json");

export type NotificationLog = {
  id: string;
  at: string;
  imei: string;
  plate: string;
  status: string;
  locationName: string;
  ok: boolean;
  provider: string;
  error?: string;
  message: string;
};

export async function appendNotification(
  entry: Omit<NotificationLog, "id" | "at"> & { at?: string },
): Promise<NotificationLog> {
  const full: NotificationLog = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: entry.at || new Date().toISOString(),
    imei: entry.imei,
    plate: entry.plate,
    status: entry.status,
    locationName: entry.locationName,
    ok: entry.ok,
    provider: entry.provider,
    error: entry.error,
    message: entry.message,
  };

  let list: NotificationLog[] = [];
  try {
    list = JSON.parse(await fs.readFile(LOG_FILE(), "utf8")) as NotificationLog[];
  } catch {
    list = [];
  }
  list.unshift(full);
  list = list.slice(0, 200);
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(LOG_FILE(), JSON.stringify(list, null, 2), "utf8");
  return full;
}

export async function readNotifications(limit = 50): Promise<NotificationLog[]> {
  try {
    const list = JSON.parse(
      await fs.readFile(LOG_FILE(), "utf8"),
    ) as NotificationLog[];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}
