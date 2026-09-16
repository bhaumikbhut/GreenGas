import { NextResponse } from "next/server";
import { readFleetSnapshot } from "@/lib/fleet-cache";
import {
  listTrips,
  persistSanitizedTrips,
  reconcileTripsFromFleet,
  type Trip,
  type TripStatus,
} from "@/lib/trips";
import { istRangeMs, tripOverlapsRange } from "@/lib/trip-range";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function filterTrips(
  all: Trip[],
  opts: {
    plate?: string;
    port?: string;
    factory?: string;
    imei?: string;
    status?: TripStatus | "ALL";
    from?: string;
    to?: string;
  },
): Trip[] {
  const plateQ = opts.plate?.trim().toLowerCase();
  const portQ = opts.port?.trim().toLowerCase();
  const factoryQ = opts.factory?.trim().toLowerCase();
  const statusQ =
    opts.status && opts.status !== "ALL" ? opts.status : null;
  const imeiQ = opts.imei?.trim();
  const range = istRangeMs(opts.from || "", opts.to || "");

  return all
    .filter((t) => {
      if (imeiQ && t.imei !== imeiQ) return false;
      if (statusQ && t.status !== statusQ) return false;
      if (plateQ && !t.plate.toLowerCase().includes(plateQ)) return false;
      if (portQ) {
        const hay = `${t.port ?? ""} ${t.loadedFrom}`.toLowerCase();
        if (!hay.includes(portQ)) return false;
      }
      if (factoryQ && !(t.factory ?? "").toLowerCase().includes(factoryQ)) {
        return false;
      }
      if (range && !tripOverlapsRange(t, range.fromMs, range.toMs)) return false;
      return true;
    });
}

/**
 * Fast trips list (one Turso read).
 * Optional ?seed=1 runs a batched fleet reconcile (still one extra write).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") || 150);
  const plate = searchParams.get("plate") || undefined;
  const port = searchParams.get("port") || undefined;
  const factory = searchParams.get("factory") || undefined;
  const imei = searchParams.get("imei") || undefined;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const statusRaw = searchParams.get("status") || "ALL";
  const status =
    statusRaw === "IN_TRANSIT" ||
    statusRaw === "AT_FACTORY" ||
    statusRaw === "DELIVERED" ||
    statusRaw === "ALL"
      ? (statusRaw as TripStatus | "ALL")
      : "ALL";

  let seed: {
    opened: number;
    arrived: number;
    completed: number;
    filledUnknown: number;
  } | null = null;

  if (searchParams.get("seed") === "1") {
    try {
      const snap = await readFleetSnapshot();
      if (snap?.trucks?.length) {
        seed = await reconcileTripsFromFleet(snap.trucks, snap.fetchedAt, {
          createMissing: false,
        });
        await persistSanitizedTrips();
      }
    } catch {
      // still return trips
    }
  }

  // Single KV read for list + counts
  const all = await listTrips({ limit: 800, status: "ALL" });
  const matched = filterTrips(all, {
    plate,
    port,
    factory,
    imei,
    status,
    from,
    to,
  });
  const cap = Number.isFinite(limit) ? limit : 150;
  const trips = matched.slice(0, cap);

  const inTransit = matched.filter((t) => t.status === "IN_TRANSIT").length;
  const atFactory = matched.filter((t) => t.status === "AT_FACTORY").length;
  const delivered = matched.filter((t) => t.status === "DELIVERED").length;

  return NextResponse.json({
    ok: true,
    count: trips.length,
    stored: all.length,
    from: from || null,
    to: to || null,
    counts: { inTransit, atFactory, delivered },
    trips,
    ...(seed ? { seed } : {}),
  });
}
