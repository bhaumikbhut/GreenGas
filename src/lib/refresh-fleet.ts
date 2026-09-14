import {
  FLEET_FRESH_SEC,
  readFleetSnapshot,
  releaseRefreshLock,
  snapshotAgeSec,
  tryAcquireRefreshLock,
  writeFleetSnapshot,
} from "@/lib/fleet-cache";
import { buildFleetSnapshot } from "@/lib/build-fleet";
import type { FleetSnapshot } from "@/lib/fleet-types";

/** Never replace a good cache with an empty/failed GPS pull. */
async function persistSnapshotSafely(
  snapshot: FleetSnapshot,
): Promise<FleetSnapshot> {
  if (snapshot.trucks.length > 0) {
    await writeFleetSnapshot(snapshot);
    return snapshot;
  }
  const prev = await readFleetSnapshot();
  if (prev?.trucks.length) {
    const kept: FleetSnapshot = {
      ...prev,
      fetchedAt: prev.fetchedAt,
      errors: snapshot.errors?.length ? snapshot.errors : prev.errors,
    };
    return kept;
  }
  await writeFleetSnapshot(snapshot);
  return snapshot;
}

/**
 * Pull ProTrack once (locked), write Redis/file snapshot.
 * Returns null if another refresh is already running.
 */
export async function refreshFleetCache(): Promise<{
  snapshot: FleetSnapshot | null;
  skipped: boolean;
  ageSecBefore: number | null;
}> {
  const locked = await tryAcquireRefreshLock();
  if (!locked) {
    return { snapshot: null, skipped: true, ageSecBefore: null };
  }

  try {
    const snapshot = await persistSnapshotSafely(await buildFleetSnapshot());
    return {
      snapshot,
      skipped: false,
      ageSecBefore: null,
    };
  } finally {
    await releaseRefreshLock();
  }
}

/**
 * Live map/status refresh: full geofence + status (Factory/Empty/Park/…) but
 * skip WhatsApp so Vercel stays under 60s. GPS-only patch left statuses frozen.
 */
export async function refreshFleetLiveGps(): Promise<{
  snapshot: FleetSnapshot | null;
  skipped: boolean;
}> {
  const locked = await tryAcquireRefreshLock(50);
  if (!locked) {
    return { snapshot: null, skipped: true };
  }

  try {
    const snapshot = await persistSnapshotSafely(
      await buildFleetSnapshot({ skipAlerts: true }),
    );
    return { snapshot, skipped: false };
  } finally {
    await releaseRefreshLock();
  }
}

export function withCacheMeta(
  snapshot: FleetSnapshot,
  hit: boolean,
): FleetSnapshot {
  const ageSec = snapshotAgeSec(snapshot);
  return {
    ...snapshot,
    cache: {
      hit,
      ageSec: Number.isFinite(ageSec) ? Math.round(ageSec) : null,
      refreshedAt: snapshot.fetchedAt,
    },
  };
}

export function isSnapshotFresh(snapshot: FleetSnapshot): boolean {
  return snapshotAgeSec(snapshot) <= FLEET_FRESH_SEC;
}
