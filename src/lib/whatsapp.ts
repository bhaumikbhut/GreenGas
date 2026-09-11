export type WhatsAppAlert = {
  plate: string;
  imei: string;
  productLine: string;
  status: "LOADING" | "RELEASED" | "ARRIVED";
  locationName: string;
  port?: string | null;
  when: Date;
};

export type WhatsAppSendResult = {
  ok: boolean;
  provider: "meta" | "callmebot" | "personal" | "dry-run";
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
      ? "reached loading point"
      : alert.status === "RELEASED"
        ? "released / left loading point"
        : "arrived at destination";

  return [
    `Green Gas alert`,
    `Truck: ${alert.plate}`,
    `Product: ${alert.productLine}`,
    `Status: ${alert.status}`,
    `Event: ${verb}`,
    `Location: ${place}`,
    `Time: ${time}`,
  ].join("\n");
}

async function sendMeta(
  to: string[],
  alert: WhatsAppAlert,
  text: string,
): Promise<WhatsAppSendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || "en";

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

async function sendCallMeBot(
  to: string[],
  text: string,
): Promise<WhatsAppSendResult> {
  const apikey = process.env.WHATSAPP_CALLMEBOT_APIKEY;
  if (!apikey) {
    return {
      ok: false,
      provider: "callmebot",
      to,
      message: text,
      error: "Missing WHATSAPP_CALLMEBOT_APIKEY",
    };
  }

  const errors: string[] = [];
  for (const phone of to) {
    const url =
      `https://api.callmebot.com/whatsapp.php` +
      `?phone=${encodeURIComponent(phone)}` +
      `&text=${encodeURIComponent(text)}` +
      `&apikey=${encodeURIComponent(apikey)}`;
    const res = await fetch(url);
    const body = await res.text();
    if (!res.ok || /error|invalid/i.test(body)) {
      errors.push(`${phone}: ${body.slice(0, 200)}`);
    }
  }

  return {
    ok: errors.length === 0,
    provider: "callmebot",
    to,
    message: text,
    error: errors.length ? errors.join(" | ") : undefined,
  };
}

async function sendPersonal(
  to: string[],
  text: string,
): Promise<WhatsAppSendResult> {
  const { sendPersonalWhatsApp } = await import("./whatsapp-personal");
  const errors: string[] = [];
  for (const phone of to) {
    const result = await sendPersonalWhatsApp(phone, text);
    if (!result.ok) errors.push(`${phone}: ${result.error || "send failed"}`);
  }
  return {
    ok: errors.length === 0,
    provider: "personal",
    to,
    message: text,
    error: errors.length ? errors.join(" | ") : undefined,
  };
}

export function whatsappConfigured(): boolean {
  const to = recipients();
  if (to.length === 0) return false;
  const provider = (process.env.WHATSAPP_PROVIDER || "personal").toLowerCase();
  if (provider === "callmebot")
    return Boolean(process.env.WHATSAPP_CALLMEBOT_APIKEY);
  if (provider === "dry-run") return true;
  if (provider === "personal" || provider === "web") return true;
  return Boolean(
    process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID,
  );
}

export async function sendWhatsAppAlert(
  alert: WhatsAppAlert,
): Promise<WhatsAppSendResult> {
  const to = recipients();
  const text = buildAlertText(alert);
  const provider = (process.env.WHATSAPP_PROVIDER || "personal").toLowerCase();

  if (to.length === 0) {
    return {
      ok: false,
      provider: "dry-run",
      to: [],
      message: text,
      error: "WHATSAPP_TO is empty — set recipient numbers in .env.local",
    };
  }

  if (provider === "dry-run") {
    console.log("[whatsapp:dry-run]", { to, text });
    return { ok: true, provider: "dry-run", to, message: text };
  }

  if (provider === "callmebot") {
    return sendCallMeBot(to, text);
  }

  if (provider === "personal" || provider === "web") {
    return sendPersonal(to, text);
  }

  return sendMeta(to, alert, text);
}
