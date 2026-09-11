import { NextResponse } from "next/server";
import {
  ensurePersonalWhatsApp,
  logoutPersonalWhatsApp,
} from "@/lib/whatsapp-personal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await ensurePersonalWhatsApp();
  return NextResponse.json({
    provider: "personal",
    to: process.env.WHATSAPP_TO || "",
    ...status,
  });
}

export async function DELETE() {
  await logoutPersonalWhatsApp();
  return NextResponse.json({ ok: true });
}
