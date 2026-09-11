import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import path from "path";
import QRCode from "qrcode";
import pino from "pino";

type WaStatus = {
  connected: boolean;
  linking: boolean;
  qrDataUrl: string | null;
  lastError: string | null;
  phoneJid: string | null;
};

type GlobalWa = {
  sock: WASocket | null;
  status: WaStatus;
  starting: Promise<void> | null;
};

const g = globalThis as typeof globalThis & { __greenGasWa?: GlobalWa };

function state(): GlobalWa {
  if (!g.__greenGasWa) {
    g.__greenGasWa = {
      sock: null,
      status: {
        connected: false,
        linking: false,
        qrDataUrl: null,
        lastError: null,
        phoneJid: null,
      },
      starting: null,
    };
  }
  return g.__greenGasWa;
}

function authDir(): string {
  return path.join(process.cwd(), ".data", "wa-auth");
}

function toJid(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return `${digits}@s.whatsapp.net`;
}

export function getPersonalWhatsAppStatus(): WaStatus {
  return { ...state().status };
}

export async function ensurePersonalWhatsApp(): Promise<WaStatus> {
  const s = state();
  if (s.sock && s.status.connected) return getPersonalWhatsAppStatus();
  if (s.starting) {
    await s.starting;
    return getPersonalWhatsAppStatus();
  }

  s.starting = (async () => {
    const { state: authState, saveCreds } = await useMultiFileAuthState(authDir());
    s.status.linking = true;
    s.status.lastError = null;

    const sock = makeWASocket({
      auth: authState,
      logger: pino({ level: "silent" }),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    s.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          s.status.qrDataUrl = await QRCode.toDataURL(qr, {
            margin: 1,
            width: 280,
          });
          s.status.linking = true;
          s.status.connected = false;
        } catch (err) {
          s.status.lastError =
            err instanceof Error ? err.message : "QR generate failed";
        }
      }

      if (connection === "open") {
        s.status.connected = true;
        s.status.linking = false;
        s.status.qrDataUrl = null;
        s.status.phoneJid = sock.user?.id || null;
        s.status.lastError = null;
      }

      if (connection === "close") {
        s.status.connected = false;
        const code = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        s.sock = null;
        s.starting = null;

        if (loggedOut) {
          s.status.linking = false;
          s.status.qrDataUrl = null;
          s.status.lastError = "Logged out — scan QR again";
          return;
        }

        // Auto-reconnect for transient closes
        s.status.lastError = `Disconnected (${code ?? "unknown"}) — reconnecting…`;
        setTimeout(() => {
          void ensurePersonalWhatsApp();
        }, 2000);
      }
    });
  })();

  try {
    await s.starting;
  } finally {
    // keep starting promise until close so concurrent callers wait once
  }

  // Give a moment for QR event
  await new Promise((r) => setTimeout(r, 800));
  return getPersonalWhatsAppStatus();
}

export async function sendPersonalWhatsApp(
  toDigits: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const status = await ensurePersonalWhatsApp();
  const s = state();

  if (!s.sock || !status.connected) {
    return {
      ok: false,
      error: status.qrDataUrl
        ? "WhatsApp not linked yet — open /whatsapp-link and scan the QR with your personal WhatsApp"
        : status.lastError ||
          "WhatsApp not connected — open /whatsapp-link to scan QR",
    };
  }

  try {
    await s.sock.sendMessage(toJid(toDigits), { text });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function logoutPersonalWhatsApp(): Promise<void> {
  const s = state();
  try {
    await s.sock?.logout();
  } catch {
    // ignore
  }
  s.sock = null;
  s.starting = null;
  s.status = {
    connected: false,
    linking: false,
    qrDataUrl: null,
    lastError: null,
    phoneJid: null,
  };
}
