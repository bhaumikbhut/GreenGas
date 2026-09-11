import { NextResponse } from "next/server";
import { appendNotification, readNotifications } from "@/lib/notification-log";
import { sendWhatsAppAlert, whatsappConfigured } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const logs = await readNotifications(30);
  return NextResponse.json({
    configured: whatsappConfigured(),
    provider: "meta",
    to: process.env.WHATSAPP_TO || "",
    logs,
  });
}

/** Send a test WhatsApp alert (does not require truck GPS). */
export async function POST() {
  const result = await sendWhatsAppAlert({
    plate: "TEST-TRUCK",
    imei: "000000000000000",
    productLine: "LPG",
    status: "LOADING",
    locationName: "Dahej A",
    port: "DAHEJ",
    when: new Date(),
    lat: 21.712,
    lng: 72.557,
  });

  await appendNotification({
    imei: "000000000000000",
    plate: "TEST-TRUCK",
    status: "LOADING",
    locationName: "Dahej A",
    ok: result.ok,
    provider: result.provider,
    error: result.error,
    message: result.message,
  });

  return NextResponse.json({
    configured: whatsappConfigured(),
    result,
  });
}
