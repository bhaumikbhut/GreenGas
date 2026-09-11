import { NextResponse } from "next/server";
import { statusStoreMode } from "@/lib/status-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "green-gas-fleet",
    gpsSource: process.env.GPS_SOURCE || "portal",
    whatsappProvider: "meta",
    statusStore: statusStoreMode(),
    time: new Date().toISOString(),
  });
}
