import { NextRequest, NextResponse } from "next/server";
import { healFleetFromPlayback } from "@/lib/heal-from-playback";
import type { AutoStatus } from "@/lib/geofence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const auth = req.headers.get("authorization") || "";
  const q = req.nextUrl.searchParams.get("secret") || "";
  return auth === `Bearer ${secret}` || q === secret;
}

/**
 * Rebuild fleet statuses + trips from portal playback history.
 *
 * POST /api/heal-playback?hours=36
 * Header: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const hours = Number(req.nextUrl.searchParams.get("hours") || 36);
  const concurrency = Number(req.nextUrl.searchParams.get("concurrency") || 4);
  const maxTrucks = Number(req.nextUrl.searchParams.get("max") || 0);
  const dryRun = req.nextUrl.searchParams.get("dry") === "1";
  const only = req.nextUrl.searchParams.get("only");
  const onlyStatuses = only
    ? (only.split(",").map((s) => s.trim().toUpperCase()) as AutoStatus[])
    : undefined;

  try {
    const result = await healFleetFromPlayback({
      hours: Number.isFinite(hours) ? hours : 36,
      concurrency: Number.isFinite(concurrency) ? concurrency : 4,
      maxTrucks: maxTrucks > 0 ? maxTrucks : undefined,
      onlyStatuses,
      dryRun,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
