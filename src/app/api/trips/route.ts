import { NextResponse } from "next/server";
import { readFleetSnapshot } from "@/lib/fleet-cache";
import {
  completeTrip,
  fillUnknownLoadedFrom,
  listTrips,
  markTripArrived,
  openTrip,
  type TripStatus,
} from "@/lib/trips";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Keep trips history aligned with live fleet snapshot:
 * - open / arrive from LOADED + AT_FACTORY
 * - fill Unknown loading point when fleet knows the bay
 * - close open trips when truck is empty again (left factory / not filled)
 */
async function seedFromLiveFleet(): Promise<void> {
  const snap = await readFleetSnapshot();
  if (!snap?.trucks?.length) return;

  for (const t of snap.trucks) {
    if (t.lastLoadedFrom) {
      await fillUnknownLoadedFrom({
        imei: t.imei,
        loadedFrom: t.lastLoadedFrom,
        port: t.port,
      });
    }

    if (t.status === "LOADED" && t.lastLoadedFrom) {
      await openTrip({
        imei: t.imei,
        plate: t.plate,
        productLine: t.productLine,
        port: t.port,
        loadedFrom: t.lastLoadedFrom,
        at: snap.fetchedAt,
      });
      continue;
    }

    if (t.status === "AT_FACTORY" && t.lastFactory) {
      await openTrip({
        imei: t.imei,
        plate: t.plate,
        productLine: t.productLine,
        port: t.port,
        loadedFrom: t.lastLoadedFrom || "Unknown loading point",
        at: snap.fetchedAt,
      });
      await markTripArrived({
        imei: t.imei,
        factory: t.lastFactory,
        at: snap.fetchedAt,
      });
      continue;
    }

    // Live empty / parking / loading → any open trip should be closed
    if (
      t.status === "ON_ROAD" ||
      t.status === "PARK" ||
      t.status === "LOADING" ||
      t.status === "EMPTY"
    ) {
      await completeTrip({
        imei: t.imei,
        factory: t.lastFactory,
        at: snap.fetchedAt,
      });
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 150);
  const plate = searchParams.get("plate") || undefined;
  const port = searchParams.get("port") || undefined;
  const factory = searchParams.get("factory") || undefined;
  const imei = searchParams.get("imei") || undefined;
  const statusRaw = searchParams.get("status") || "ALL";
  const status =
    statusRaw === "IN_TRANSIT" ||
    statusRaw === "AT_FACTORY" ||
    statusRaw === "DELIVERED" ||
    statusRaw === "ALL"
      ? (statusRaw as TripStatus | "ALL")
      : "ALL";

  if (searchParams.get("seed") !== "0") {
    try {
      await seedFromLiveFleet();
    } catch {
      // ignore seed errors — still return stored trips
    }
  }

  const trips = await listTrips({
    limit: Number.isFinite(limit) ? limit : 150,
    plate,
    port,
    factory,
    imei,
    status,
  });

  const inTransit = trips.filter((t) => t.status === "IN_TRANSIT").length;
  const atFactory = trips.filter((t) => t.status === "AT_FACTORY").length;
  const delivered = trips.filter((t) => t.status === "DELIVERED").length;

  return NextResponse.json({
    ok: true,
    count: trips.length,
    counts: { inTransit, atFactory, delivered },
    trips,
  });
}
