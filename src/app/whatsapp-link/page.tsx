"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type LinkStatus = {
  connected: boolean;
  linking: boolean;
  qrDataUrl: string | null;
  lastError: string | null;
  phoneJid: string | null;
  to?: string;
};

export default function WhatsAppLinkPage() {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/whatsapp/link", { cache: "no-store" });
    const json = (await res.json()) as LinkStatus;
    setStatus(json);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, [refresh]);

  const sendTest = async () => {
    setBusy(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/whatsapp", { method: "POST" });
      const json = (await res.json()) as {
        result: { ok: boolean; error?: string; provider: string };
      };
      setTestMsg(
        json.result.ok
          ? `Sent via ${json.result.provider} — check WhatsApp`
          : json.result.error || "Send failed",
      );
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh bg-[#f4f7f4] px-4 py-8 text-[#1a241a]">
      <div className="mx-auto max-w-lg rounded-xl border border-[#d5e0d5] bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.16em] text-[#5b6b5b]">
          Green Gas · Testing
        </p>
        <h1 className="mt-1 font-serif text-2xl">Link personal WhatsApp</h1>
        <p className="mt-2 text-sm text-[#5b6b5b]">
          Scan this QR with your phone WhatsApp (Linked devices). Alerts will be
          sent to <strong>+{status?.to || "919925718444"}</strong>.
        </p>

        <div className="mt-5 flex min-h-[300px] items-center justify-center rounded-lg bg-[#eef3ee] p-4">
          {status?.connected ? (
            <div className="text-center">
              <p className="text-lg font-semibold text-[#145c38]">Connected</p>
              <p className="mt-1 text-xs text-[#5b6b5b]">
                {status.phoneJid || "Session active"}
              </p>
            </div>
          ) : status?.qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={status.qrDataUrl}
              alt="WhatsApp QR"
              className="h-[280px] w-[280px] rounded bg-white p-2"
            />
          ) : (
            <p className="text-sm text-[#5b6b5b]">
              {status?.lastError || "Preparing QR…"}
            </p>
          )}
        </div>

        {status?.lastError && !status.connected && (
          <p className="mt-3 text-sm text-[#8a3b12]">{status.lastError}</p>
        )}

        <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-[#3d4a3d]">
          <li>Open WhatsApp on your phone</li>
          <li>Settings → Linked devices → Link a device</li>
          <li>Scan the QR above</li>
          <li>Click Test message below</li>
        </ol>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !status?.connected}
            onClick={() => void sendTest()}
            className="rounded bg-[#128c7e] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Test message"}
          </button>
          <Link
            href="/"
            className="rounded border border-[#cfdccf] px-4 py-2 text-sm"
          >
            Back to map
          </Link>
        </div>

        {testMsg && (
          <p className="mt-3 text-sm text-[#0f5c52]">{testMsg}</p>
        )}
      </div>
    </main>
  );
}
