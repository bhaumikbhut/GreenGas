/**
 * Recompute every truck status from live GPS vs known pins only.
 * Drops legacy "Unknown factory" / fac-unknown; AT_FACTORY only on real factory pins.
 *
 *   npx tsx scripts/sync-pin-status.ts
 *   npx tsx scripts/sync-pin-status.ts --skip-refresh
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

const args = process.argv.slice(2);
const skipRefresh = args.includes("--skip-refresh");

async function main() {
  const {
    findNearestLoadingPoint,
    findNearestParkingPoint,
    resolveFactoryGeofence,
    nextStatus,
    normalizeMemory,
  } = await import("../src/lib/geofence");
  const { readFleetSnapshot, writeFleetSnapshot, releaseRefreshLock } =
    await import("../src/lib/fleet-cache");
  const { readTruckStore, writeTruckStore } = await import(
    "../src/lib/status-store"
  );
  const { reconcileTripsFromFleet, scrubUnknownFactoryFromTrips } =
    await import("../src/lib/trips");
  const { buildFleetSnapshot } = await import("../src/lib/build-fleet");

  if (!skipRefresh) {
    console.error("Refreshing live GPS…");
    await releaseRefreshLock();
    const snapshot = await buildFleetSnapshot({ skipAlerts: true });
    if (snapshot.trucks.length > 0) {
      await writeFleetSnapshot(snapshot);
    }
    console.error("refresh", {
      trucks: snapshot.trucks.length,
      counts: snapshot.statusCounts,
      fetchedAt: snapshot.fetchedAt,
    });
  }

  const snap = await readFleetSnapshot();
  if (!snap?.trucks?.length) throw new Error("No fleet snapshot");
  const store = await readTruckStore();
  const radiusM = snap.radiusM || 500;

  const flips: string[] = [];
  let unknownCleared = 0;

  for (const t of snap.trucks) {
    let mem = normalizeMemory(store[t.imei]);
    if (
      store[t.imei]?.geofenceId === "fac-unknown" ||
      String(store[t.imei]?.lastFactory ?? "")
        .trim()
        .toLowerCase() === "unknown factory" ||
      String(t.lastFactory ?? "").trim().toLowerCase() === "unknown factory" ||
      String(t.factoryPoint ?? "").trim().toLowerCase() === "unknown factory"
    ) {
      unknownCleared += 1;
    }

    if (t.lat == null || t.lng == null) {
      // Still scrub unknown labels on offline trucks.
      if (mem.lastFactory?.toLowerCase() === "unknown factory") {
        mem = { ...mem, lastFactory: null };
        if (mem.status === "AT_FACTORY") {
          mem = {
            ...mem,
            status: "LOADED",
            cargo: "LOADED",
            geofenceId: null,
            geofenceKind: null,
          };
        }
      }
      store[t.imei] = mem;
      t.status = mem.status === "EMPTY" ? "ON_ROAD" : mem.status;
      t.cargo = mem.cargo;
      t.lastFactory = mem.lastFactory ?? null;
      t.lastLoadedFrom = mem.lastLoadedFrom ?? null;
      t.lastPark = mem.lastPark ?? null;
      if (t.factoryPoint?.toLowerCase() === "unknown factory") {
        t.factoryPoint = null;
      }
      continue;
    }

    const insideLoading = findNearestLoadingPoint(t.lat, t.lng);
    const insideParking = findNearestParkingPoint(t.lat, t.lng);
    const insideFactory = resolveFactoryGeofence(
      t.lat,
      t.lng,
      radiusM,
      t.speed,
    );

    // Pin override: empty truck sitting on a known factory → at factory (filled).
    if (
      insideFactory &&
      (mem.cargo === "EMPTY" ||
        mem.status === "ON_ROAD" ||
        mem.status === "EMPTY" ||
        mem.status === "PARK")
    ) {
      mem = {
        ...mem,
        status: "AT_FACTORY",
        cargo: "LOADED",
        geofenceId: insideFactory.point.id,
        geofenceKind: "factory",
        enteredAt: Date.now(),
        outsideStreak: 0,
        lastFactory: insideFactory.point.name,
      };
    } else {
      // Run status machine twice so leave streaks can settle.
      mem = nextStatus({
        prev: mem,
        insideLoading,
        insideParking,
        insideFactory,
        online: true,
        lat: t.lat,
        lng: t.lng,
        speed: t.speed,
      });
      mem = nextStatus({
        prev: mem,
        insideLoading,
        insideParking,
        insideFactory,
        online: true,
        lat: t.lat,
        lng: t.lng,
        speed: t.speed,
      });
    }

    // Never keep AT_FACTORY without a known pin under the truck.
    if (mem.status === "AT_FACTORY" && !insideFactory) {
      mem = {
        ...mem,
        status: "LOADED",
        cargo: "LOADED",
        geofenceId: null,
        geofenceKind: null,
        enteredAt: null,
        outsideStreak: 0,
        lastFactory:
          mem.lastFactory?.toLowerCase() === "unknown factory"
            ? null
            : mem.lastFactory,
      };
    }

    const before = `${t.status}/${t.cargo}`;
    store[t.imei] = mem;
    t.status = mem.status === "EMPTY" ? "ON_ROAD" : mem.status;
    t.cargo = mem.cargo;
    t.lastFactory = mem.lastFactory ?? null;
    t.lastLoadedFrom = mem.lastLoadedFrom ?? null;
    t.lastPark = mem.lastPark ?? null;
    t.loadingPoint = insideLoading?.point.name ?? null;
    t.parkingPoint = insideParking?.point.name ?? null;
    t.factoryPoint = insideFactory?.point.name ?? null;
    t.port =
      insideLoading?.point.port ??
      insideParking?.point.port ??
      t.port ??
      null;
    const near = insideFactory || insideLoading || insideParking;
    t.distanceM = near ? Math.round(near.distanceM) : null;

    const after = `${t.status}/${t.cargo}`;
    if (before !== after && flips.length < 60) {
      flips.push(
        `${t.plate}: ${before} → ${after}` +
          (insideFactory
            ? ` @ fac ${insideFactory.point.name}`
            : insideLoading
              ? ` @ load ${insideLoading.point.name}`
              : insideParking
                ? ` @ park ${insideParking.point.name}`
                : ""),
      );
    }
  }

  const statusCounts: Record<string, number> = {
    PARK: 0,
    LOADING: 0,
    LOADED: 0,
    AT_FACTORY: 0,
    EMPTY: 0,
    ON_ROAD: 0,
    OFFLINE: 0,
  };
  const byProduct: Record<string, Record<string, number>> = {
    LPG: { ...statusCounts },
    PROPANE: { ...statusCounts },
  };
  for (const t of snap.trucks) {
    if (t.status in statusCounts) statusCounts[t.status] += 1;
    const pl = t.productLine === "LPG" ? "LPG" : "PROPANE";
    if (t.status in byProduct[pl]) byProduct[pl][t.status] += 1;
  }
  snap.statusCounts = statusCounts as typeof snap.statusCounts;
  snap.statusCountTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  snap.fetchedAt = new Date().toISOString();

  await writeTruckStore(store);
  await writeFleetSnapshot(snap);
  await reconcileTripsFromFleet(snap.trucks, undefined, { createMissing: false });
  const scrubbed = await scrubUnknownFactoryFromTrips();
  console.error(`trip factory scrubbed: ${scrubbed}`);

  console.log(
    JSON.stringify(
      {
        unknownCleared,
        flips: flips.length,
        samples: flips.slice(0, 25),
        statusCounts,
        propane: byProduct.PROPANE,
        lpg: byProduct.LPG,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
