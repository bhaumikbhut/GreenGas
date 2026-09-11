"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import { statusBadge, statusLabel } from "@/lib/status-label";

const TruckMap = dynamic(() => import("@/components/TruckMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#e4ebe4] text-sm text-[var(--gg-muted)]">
      Loading map…
    </div>
  ),
});

type Props = { imei: string };

type ApiResponse = {
  ok: boolean;
  fetchedAt?: string;
  radiusM?: number;
  trucks: TruckSnapshot[];
  error?: string;
};

export default function LiveTrackClient({ imei }: Props) {
  const [truck, setTruck] = useState<TruckSnapshot | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/trucks?imei=${encodeURIComponent(imei)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiResponse;
      if (!json.ok && json.error) {
        setError(json.error);
        return;
      }
      const match =
        json.trucks?.find((t) => t.imei === imei) ||
        json.trucks?.[0] ||
        null;
      setTruck(match);
      setFetchedAt(json.fetchedAt || new Date().toISOString());
      setError(match ? null : "Truck not found or offline from GPS feed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [imei]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 15000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex h-dvh flex-col bg-[var(--gg-bg)] text-[var(--gg-ink)]">
      <header className="safe-pad-x safe-pad-top border-b border-white/10 bg-[var(--gg-forest)] pb-3 text-white">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[#9fc3b1]">
          Green Gas · Live track
        </p>
        <h1 className="mt-1 font-serif text-2xl tracking-tight">
          {truck?.plate || (loading ? "Loading…" : "Truck")}
        </h1>
        <p className="mt-1 text-sm text-[#c5ddd0]">
          {truck
            ? `${truck.productLine} · ${statusLabel(truck.status)} · ${truck.speed} km/h`
            : error || "Fetching GPS…"}
        </p>
        <p className="mt-1 text-xs text-[#9fc3b1]">
          {fetchedAt
            ? `Updated ${new Date(fetchedAt).toLocaleTimeString("en-IN")}`
            : ""}
          {" · refreshes every 15s"}
        </p>
      </header>

      <div className="relative min-h-0 flex-1">
        {truck?.lat != null && truck?.lng != null ? (
          <>
            <TruckMap
              trucks={[truck]}
              loadingPoints={[]}
              factoryPoints={[]}
              radiusM={500}
              selectedImei={truck.imei}
              mode="live"
            />
            <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-xl bg-white/95 px-3 py-2 text-xs shadow-md ring-1 ring-black/5">
              <span className="font-medium">{statusBadge(truck.status)}</span>
              <span className="mx-1.5 text-[var(--gg-muted)]">·</span>
              <span className="text-[var(--gg-muted)]">{truck.speed} km/h</span>
              {truck.speed > 3 ? (
                <span className="ml-1.5 font-medium text-[var(--gg-green)]">
                  Moving
                </span>
              ) : (
                <span className="ml-1.5 text-[var(--gg-muted)]">Stopped</span>
              )}
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--gg-muted)]">
            {loading
              ? "Loading live location…"
              : error || "No GPS fix for this truck right now."}
          </div>
        )}
      </div>

      {truck?.lat != null && truck?.lng != null ? (
        <footer className="safe-pad-x safe-pad-bottom border-t border-[var(--gg-line)] bg-white pt-3">
          <a
            className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--gg-green)] px-4 text-base font-medium text-white active:scale-[0.99]"
            href={`https://maps.google.com/?q=${truck.lat},${truck.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Google Maps
          </a>
        </footer>
      ) : null}
    </div>
  );
}
