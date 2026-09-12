"use client";

import dynamic from "next/dynamic";
import { secondaryLine, useFleet } from "@/components/FleetProvider";
import { statusBadge } from "@/lib/status-label";

const TruckMap = dynamic(() => import("@/components/TruckMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#e4ebe4] text-sm text-[var(--gg-muted)]">
      Loading map…
    </div>
  ),
});

export default function MapPage() {
  const {
    data,
    filtered,
    trucks,
    selected,
    selectedImei,
    focusToken,
    setSelectedImei,
    selectTruck,
  } = useFleet();

  /** Keep the selected truck on the map even if filters would hide it. */
  const mapTrucks = (() => {
    if (!selected) return filtered;
    if (filtered.some((t) => t.imei === selected.imei)) return filtered;
    return [...filtered, selected];
  })();

  // Prefer full fleet lookup if filtered list is empty but we have a selection.
  const focusList =
    mapTrucks.length > 0 ? mapTrucks : selected ? [selected] : trucks;

  return (
    <div className="relative h-full min-h-0 w-full">
      <div className="absolute inset-0">
        <TruckMap
          trucks={focusList}
          loadingPoints={data?.loadingPoints ?? []}
          factoryPoints={data?.factoryPoints ?? []}
          radiusM={data?.radiusM ?? 500}
          selectedImei={selectedImei}
          focusToken={focusToken}
          onSelectImei={(imei) => selectTruck(imei)}
        />
      </div>

      {selected ? (
        <div className="absolute inset-x-3 bottom-3 z-[500] sm:inset-x-auto sm:bottom-4 sm:left-3 sm:w-[320px]">
          <div className="rounded-2xl bg-white/95 p-3 shadow-lg ring-1 ring-black/5 backdrop-blur">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold tracking-wide">
                  {selected.plate}
                </div>
                <div className="mt-0.5 text-xs text-[var(--gg-muted)]">
                  {selected.productLine} · {selected.speed} km/h ·{" "}
                  {statusBadge(selected.status)}
                </div>
                {secondaryLine(selected) ? (
                  <div className="mt-1 truncate text-xs text-[var(--gg-ink)]/75">
                    {secondaryLine(selected)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setSelectedImei(null)}
                className="rounded-lg px-2 py-1 text-xs text-[var(--gg-muted)] hover:bg-[#eef3ee]"
              >
                Close
              </button>
            </div>
            {selected.lat != null && selected.lng != null ? (
              <a
                className="mt-3 flex min-h-10 items-center justify-center rounded-xl bg-[var(--gg-green)] text-sm font-medium text-white"
                href={`https://maps.google.com/?q=${selected.lat},${selected.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Maps
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
