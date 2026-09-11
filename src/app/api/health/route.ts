import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "green-gas-fleet",
    gpsSource: process.env.GPS_SOURCE || "portal",
    whatsappProvider: process.env.WHATSAPP_PROVIDER || "personal",
    time: new Date().toISOString(),
  });
}
