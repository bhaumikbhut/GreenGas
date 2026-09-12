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

function filterSnapshot(
  snapshot: FleetSnapshot,
  imeiFilter: string | null,
): FleetSnapshot {
  if (!imeiFilter) return snapshot;
  const trucks = snapshot.trucks.filter((t) => t.imei === imeiFilter);
  return {
    ...snapshot,
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
