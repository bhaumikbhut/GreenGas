"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import { statusLabel } from "@/lib/status-label";

const TruckMap = dynamic(() => import("@/components/TruckMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#e8efe8] text-sm text-[#3d4a3d]">
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
    <div className="flex h-dvh flex-col bg-[#f4f7f4] text-[#1a241a]">
      <header className="border-b border-[#d5e0d5] bg-[#0f2a1f] px-4 py-3 text-white">
        <p className="text-xs uppercase tracking-[0.18em] text-[#9fc3b1]">
          Green Gas · Live track
        </p>
        <h1 className="mt-1 font-semibold tracking-wide">
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
          <TruckMap
            trucks={[truck]}
            loadingPoints={[]}
            factoryPoints={[]}
            radiusM={500}
            selectedImei={truck.imei}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#3d4a3d]">
            {loading
              ? "Loading live location…"
              : error || "No GPS fix for this truck right now."}
          </div>
        )}
      </div>

      {truck?.lat != null && truck?.lng != null ? (
        <footer className="border-t border-[#d5e0d5] bg-white px-4 py-3 text-sm">
          <a
            className="text-[#1f7a4d] underline"
            href={`https://maps.google.com/?q=${truck.lat},${truck.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Open current pin in Google Maps
          </a>
        </footer>
      ) : null}
    </div>
  );
}
