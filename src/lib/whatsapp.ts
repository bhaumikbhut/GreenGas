import { mapsPinLink, liveTrackLink } from "./public-url";

export type WhatsAppAlert = {
  plate: string;
  imei: string;
  productLine: string;
  status: "LOADING" | "LOADED" | "AT_FACTORY" | "EMPTY" | "ARRIVED";
  locationName: string;
  port?: string | null;
  when: Date;
  lat?: number | null;
  lng?: number | null;
};

/** @deprecated use mapsPinLink — kept name for clarity in older call sites */
export function mapsLiveLink(lat: number, lng: number): string {
  return mapsPinLink(lat, lng);
}

export type WhatsAppSendResult = {
  ok: boolean;
  provider: "meta";
  to: string[];
  message: string;
  error?: string;
  raw?: unknown;
};

function recipients(): string[] {
  return (process.env.WHATSAPP_TO || "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => n.replace(/[^\d]/g, ""));
}

export function buildAlertText(alert: WhatsAppAlert): string {
  const time = alert.when.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true,
  });
  const place = alert.port
    ? `${alert.locationName} (${alert.port})`
    : alert.locationName;

  const verb =
    alert.status === "LOADING"
      ? "reached port loading point"
      : alert.status === "LOADED"
        ? "left port — LOADED (filled), heading to factory"
        : alert.status === "AT_FACTORY" || alert.status === "ARRIVED"
          ? "reached factory"
          : alert.status === "EMPTY"
            ? "left factory — EMPTY"
            : "status update";

  const cargoLabel =
    alert.status === "LOADED" || alert.status === "AT_FACTORY"
      ? "FILLED"
      : alert.status === "EMPTY"
        ? "EMPTY"
        : alert.status === "LOADING"
          ? "at port"
          : "—";

  const lines = [
    `Green Gas alert`,
    `Truck: ${alert.plate}`,
    `Product: ${alert.productLine}`,
    `Status: ${alert.status}`,
    `Cargo: ${cargoLabel}`,
    `Event: ${verb}`,
    `Location: ${place}`,
    `Time: ${time}`,
    `Live track: ${liveTrackLink(alert.imei)}`,
  ];
  if (
    alert.lat != null &&
    alert.lng != null &&
    Number.isFinite(alert.lat) &&
    Number.isFinite(alert.lng)
  ) {
    lines.push(`Map pin: ${mapsPinLink(alert.lat, alert.lng)}`);
  }
  return lines.join("\n");
}

export function whatsappConfigured(): boolean {
  return Boolean(
    recipients().length &&
      process.env.WHATSAPP_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID,
  );
}

export async function sendWhatsAppAlert(
  alert: WhatsAppAlert,
): Promise<WhatsAppSendResult> {
  const to = recipients();
  const text = buildAlertText(alert);
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || "en";

  if (to.length === 0) {
    return {
      ok: false,
      provider: "meta",
      to: [],
      message: text,
      error: "WHATSAPP_TO is empty — set recipient numbers in .env.local",
    };
  }

  if (!token || !phoneNumberId) {
    return {
      ok: false,
      provider: "meta",
      to,
      message: text,
      error: "Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID",
    };
  }

  const errors: string[] = [];
  for (const phone of to) {
    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    const body = template
      ? {
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: template,
            language: { code: lang },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: alert.plate },
                  { type: "text", text: alert.status },
                  { type: "text", text: alert.locationName },
                  {
                    type: "text",
                    text: alert.when.toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    }),
                  },
                ],
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: text },
        };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) {
      errors.push(
        `${phone}: ${typeof raw === "object" ? JSON.stringify(raw) : String(raw)}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    provider: "meta",
    to,
    message: text,
    error: errors.length ? errors.join(" | ") : undefined,
  };
}
