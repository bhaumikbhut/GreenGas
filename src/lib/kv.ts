import { Redis } from "@upstash/redis";

let redis: Redis | null | undefined;

/** Shared Redis (Vercel KV / Upstash). Null = use local file / ephemeral. */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    redis = new Redis({ url, token });
    return redis;
  }

  redis = null;
  return null;
}

export function statusStoreMode(): "redis" | "file" | "ephemeral" {
  if (getRedis()) return "redis";
  if (process.env.VERCEL || process.env.DATA_DIR === "tmp") return "ephemeral";
  return "file";
}

export const TRUCK_HASH_KEY = "green-gas:truck-state";
export const NOTIF_LIST_KEY = "green-gas:notifications";
