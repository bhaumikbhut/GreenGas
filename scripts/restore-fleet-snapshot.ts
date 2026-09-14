/**
 * Clear a stuck empty fleet snapshot + lock, then pull live GPS.
 *   npx tsx scripts/restore-fleet-snapshot.ts
 */
import { readFileSync } from "fs";
import path from "path";

for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  process.env[m[1].trim()] = v;
}

async function main() {
  const cache = await import("../src/lib/fleet-cache");
  const kv = await import("../src/lib/kv");
  const { refreshFleetLiveGps } = await import("../src/lib/refresh-fleet");

  const redis = kv.getRedis();
  const before = await cache.readFleetSnapshot();
  console.log("before", {
    n: before?.trucks?.length ?? 0,
    at: before?.fetchedAt,
    ok: before?.ok,
    errors: before?.errors,
  });

  if (redis) {
    await redis.del(cache.FLEET_REFRESH_LOCK_KEY);
    console.log("cleared refresh lock");
  }

  if (before && before.trucks.length === 0) {
    await redis?.del(cache.FLEET_SNAPSHOT_KEY);
    console.log("deleted empty snapshot");
  }

  console.log("refreshing live GPS…");
  const r = await refreshFleetLiveGps();
  console.log("refresh", {
    skipped: r.skipped,
    n: r.snapshot?.trucks?.length ?? 0,
    at: r.snapshot?.fetchedAt,
    counts: r.snapshot?.statusCounts,
    errors: r.snapshot?.errors,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
