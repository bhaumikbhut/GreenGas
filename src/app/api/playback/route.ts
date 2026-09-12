import { NextRequest, NextResponse } from "next/server";
import { fetchPortalPlayback } from "@/lib/protrack-portal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Portal playback history bridge.
 *
 * Query:
 *   imei=…            (required)
 *   hours=12          (default 12, max 72) — ignored if begin+end set
 *   begin=unixSec     optional
 *   end=unixSec       optional
 *   account=LPG|PROPANE  optional
 */
export async function GET(req: NextRequest) {
  const imei = req.nextUrl.searchParams.get("imei")?.trim() || "";
  if (!imei) {
    return NextResponse.json(
      { ok: false, error: "imei query param required" },
      { status: 400 },
    );
  }

  const accountRaw = (req.nextUrl.searchParams.get("account") || "")
    .trim()
    .toUpperCase();
  const accountLabel =
    accountRaw === "LPG" || accountRaw === "PROPANE"
      ? (accountRaw as "LPG" | "PROPANE")
      : undefined;

  const nowSec = Math.floor(Date.now() / 1000);
  const beginParam = Number(req.nextUrl.searchParams.get("begin") || "");
  const endParam = Number(req.nextUrl.searchParams.get("end") || "");
  let begin = beginParam;
  let end = endParam;

  if (!Number.isFinite(begin) || begin <= 0 || !Number.isFinite(end) || end <= 0) {
    const hours = Math.min(
      72,
      Math.max(1, Number(req.nextUrl.searchParams.get("hours") || 12) || 12),
    );
    end = nowSec;
    begin = end - hours * 3600;
  }

  try {
    const result = await fetchPortalPlayback({
      imei,
      begin,
      end,
      accountLabel,
    });
    return NextResponse.json({
      ok: true,
      imei: result.imei,
      deviceId: result.deviceId,
      plate: result.plate,
      account: result.account,
      accountLabel: result.accountLabel,
      begin,
      end,
      pages: result.pages,
      pointCount: result.points.length,
      points: result.points,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
}
