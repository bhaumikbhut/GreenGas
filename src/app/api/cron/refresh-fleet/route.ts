import { NextResponse } from "next/server";
import { refreshFleetCache } from "@/lib/refresh-fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return request.headers.get("authorization") === `Bearer ${secret}`;
  }
  // Local/dev without secret
  if (process.env.NODE_ENV !== "production") return true;
  // Production fallback: Vercel Cron header (prefer setting CRON_SECRET)
  return request.headers.get("x-vercel-cron") === "1";
}

/** Cron / manual: pull ProTrack and write fleet snapshot to Redis. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const result = await refreshFleetCache();

  if (result.skipped) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      message: "Refresh already in progress",
      ms: Date.now() - started,
    });
  }

  const snap = result.snapshot!;
  return NextResponse.json({
    ok: snap.ok,
    skipped: false,
    truckCount: snap.truckCount,
    fetchedAt: snap.fetchedAt,
    errors: snap.errors,
    ms: Date.now() - started,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
