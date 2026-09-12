import { after, NextResponse } from "next/server";
import { FACTORY_POINTS } from "@/lib/factory-points";
import { LOADING_POINTS } from "@/lib/loading-points";
import { readFleetSnapshot } from "@/lib/fleet-cache";
import type { FleetSnapshot, TruckSnapshot } from "@/lib/fleet-types";
import {
  isSnapshotFresh,
  refreshFleetCache,
  withCacheMeta,
} from "@/lib/refresh-fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export type { TruckSnapshot, FleetSnapshot };

/**
 * EMPTY is only valid after leaving a factory. Remap legacy cached rows so the
 * UI does not show a huge Empty count for ordinary on-road trucks.
 */
function healLegacyEmpty(snapshot: FleetSnapshot): FleetSnapshot {
  let changed = false;
  const trucks = snapshot.trucks.map((t) => {
    if (t.status === "EMPTY" && !t.lastFactory) {
      changed = true;
      return { ...t, status: "ON_ROAD" as const, cargo: "EMPTY" as const };
    }
    return t;
  });
  if (!changed) {
    // Still ensure statusCounts includes ON_ROAD key for older snapshots.
    if (snapshot.statusCounts && snapshot.statusCounts.ON_ROAD == null) {
      return {
        ...snapshot,
        statusCounts: {
          PARK: 0,
          LOADING: 0,
          LOADED: 0,
          AT_FACTORY: 0,
          EMPTY: 0,
          ON_ROAD: 0,
          OFFLINE: 0,
          ...snapshot.statusCounts,
        },
      };
    }
    return snapshot;
  }

  const statusCounts = {
    PARK: 0,
    LOADING: 0,
    LOADED: 0,
    AT_FACTORY: 0,
    EMPTY: 0,
    ON_ROAD: 0,
    OFFLINE: 0,
  };
  for (const t of trucks) {
    if (t.status in statusCounts) {
      statusCounts[t.status as keyof typeof statusCounts] += 1;
    }
  }
  return {
    ...snapshot,
    trucks,
    statusCounts,
    statusCountTotal:
      statusCounts.PARK +
      statusCounts.LOADING +
      statusCounts.LOADED +
      statusCounts.AT_FACTORY +
      statusCounts.EMPTY +
      statusCounts.ON_ROAD +
      statusCounts.OFFLINE,
  };
}

function filterSnapshot(
  snapshot: FleetSnapshot,
  imeiFilter: string | null,
): FleetSnapshot {
  const healed = healLegacyEmpty(snapshot);
  if (!imeiFilter) return healed;
  const trucks = healed.trucks.filter((t) => t.imei === imeiFilter);
  return {
    ...healed,
    trucks,
    truckCount: trucks.length,
    loadingPoints: [],
    factoryPoints: [],
  };
}

async function waitForCachedSnapshot(
  attempts = 60,
  delayMs = 500,
): Promise<FleetSnapshot | null> {
  for (let i = 0; i < attempts; i++) {
    const cached = await readFleetSnapshot();
    if (cached && cached.trucks.length > 0) return cached;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imeiFilter = searchParams.get("imei")?.trim() || null;
  const forceLive = searchParams.get("live") === "1";

  if (forceLive) {
    const result = await refreshFleetCache();
    if (result.snapshot) {
      return NextResponse.json(
        filterSnapshot(withCacheMeta(result.snapshot, false), imeiFilter),
      );
    }
    // Lock held — serve cache (wait briefly if still warming).
    const cachedLive =
      (await readFleetSnapshot()) || (await waitForCachedSnapshot(40, 500));
    if (cachedLive && cachedLive.trucks.length > 0) {
      return NextResponse.json(
        filterSnapshot(withCacheMeta(cachedLive, true), imeiFilter),
      );
    }
  }

  const cached = await readFleetSnapshot();

  if (cached && cached.trucks.length > 0) {
    const fresh = isSnapshotFresh(cached);
    if (!fresh) {
      after(() => {
        void refreshFleetCache();
      });
    }
    return NextResponse.json(
      filterSnapshot(withCacheMeta(cached, true), imeiFilter),
    );
  }

  // Cold start: must wait for ProTrack once.
  const result = await refreshFleetCache();
  if (result.snapshot) {
    return NextResponse.json(
      filterSnapshot(withCacheMeta(result.snapshot, false), imeiFilter),
    );
  }

  // Another refresh holds the lock — wait for its snapshot instead of 503.
  const waited = await waitForCachedSnapshot(60, 500);
  if (waited && waited.trucks.length > 0) {
    return NextResponse.json(
      filterSnapshot(withCacheMeta(waited, true), imeiFilter),
    );
  }

  return NextResponse.json(
    {
      ok: false,
      fetchedAt: new Date().toISOString(),
      trucks: [],
      truckCount: 0,
      loadingPoints: imeiFilter ? [] : LOADING_POINTS,
      factoryPoints: imeiFilter ? [] : FACTORY_POINTS,
      factoryCount: FACTORY_POINTS.length,
      errors: ["Fleet refresh timed out — retry"],
      cache: { hit: false, ageSec: null, refreshedAt: null },
    } satisfies Partial<FleetSnapshot>,
    { status: 503 },
  );
}
