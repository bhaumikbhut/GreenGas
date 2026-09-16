"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { secondaryLine, useFleet } from "@/components/FleetProvider";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import { matchTrucksByPlate, normalizePlate } from "@/lib/plate";
import { statusBadge } from "@/lib/status-label";

const TruckMap = dynamic(() => import("@/components/TruckMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#e4ebe4] text-sm text-[var(--gg-muted)]">
      Loading map…
    </div>
  ),
});

const yardSelectClass =
  "max-w-[min(100%,240px)] appearance-none rounded-lg border border-black/10 bg-white/95 py-1.5 pl-2 pr-7 text-xs shadow-md outline-none backdrop-blur focus:border-[var(--gg-green)]";

export default function MapPage() {
  const {
    data,
    filtered,
    trucks,
    selected,
    selectedImei,
    focusToken,
    parkingFilter,
    parkingOptions,
    parkingCounts,
    loadingFilter,
    loadingOptions,
    loadingCounts,
    productFilter,
    setParkingFilter,
    setLoadingFilter,
    setStatusFilter,
    setProductFilter,
    setSelectedImei,
    selectTruck,
  } = useFleet();

  const [plateQuery, setPlateQuery] = useState("");
  const [plateOpen, setPlateOpen] = useState(false);
  const lastAutoImei = useRef<string | null>(null);

  const plateMatches = useMemo(
    () => matchTrucksByPlate(trucks, plateQuery),
    [trucks, plateQuery],
  );

  const goToTruck = (t: TruckSnapshot) => {
    setParkingFilter("ALL");
    setLoadingFilter("ALL");
    setStatusFilter("ALL");
    if (productFilter !== "ALL" && t.productLine !== productFilter) {
      setProductFilter("ALL");
    }
    selectTruck(t.imei);
    setPlateQuery(t.plate);
    setPlateOpen(false);
  };

  useEffect(() => {
    const compact = normalizePlate(plateQuery);
    if (compact.length < 4) {
      lastAutoImei.current = null;
      return;
    }
    if (plateMatches.length !== 1) {
      lastAutoImei.current = null;
      return;
    }
    const hit = plateMatches[0];
    if (lastAutoImei.current === hit.imei) return;
    lastAutoImei.current = hit.imei;
    goToTruck(hit);
    // goToTruck is stable enough for this search jump; avoid re-flying on GPS ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plateQuery, plateMatches]);

  const allPoints = data?.loadingPoints ?? [];
  const yardFocus = parkingFilter !== "ALL" || loadingFilter !== "ALL";
  const mapPoints = yardFocus
    ? allPoints.filter((p) =>
        parkingFilter !== "ALL"
          ? p.kind === "parking" && p.name === parkingFilter
          : p.kind === "loading" && p.name === loadingFilter,
      )
    : allPoints;
  const mapFactories = yardFocus ? [] : (data?.factoryPoints ?? []);
  const fitKey =
    parkingFilter !== "ALL"
      ? `p:${parkingFilter}`
      : loadingFilter !== "ALL"
        ? `l:${loadingFilter}`
        : "";

  /** Keep the selected truck on the map even if filters would hide it. */
  const mapTrucks = (() => {
    if (!selected) return filtered;
    if (filtered.some((t) => t.imei === selected.imei)) return filtered;
    return [...filtered, selected];
  })();

  // Yard filter: never fall back to the whole fleet (that keeps Gujarat zoom).
  // Otherwise, keep a selected pin visible even if the list is empty.
  const focusList = yardFocus
    ? mapTrucks
    : mapTrucks.length > 0
      ? mapTrucks
      : selected
        ? [selected]
        : trucks;

  return (
    <div className="relative h-full min-h-0 w-full">
      <div className="absolute inset-0">
        <TruckMap
          trucks={focusList}
          loadingPoints={mapPoints}
          factoryPoints={mapFactories}
          radiusM={data?.radiusM ?? 500}
          selectedImei={selectedImei}
          focusToken={focusToken}
          onSelectImei={(imei) => selectTruck(imei)}
          fitKey={fitKey}
        />
      </div>

      <div className="pointer-events-auto absolute left-14 top-3 z-[1000] flex max-w-[calc(100%-11rem)] flex-col gap-1.5 sm:max-w-none sm:flex-row sm:items-start">
        <div className="relative min-w-[9.5rem] sm:w-[13.5rem]">
          <input
            value={plateQuery}
            onChange={(e) => {
              setPlateQuery(e.target.value);
              setPlateOpen(true);
            }}
            onFocus={() => setPlateOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setPlateOpen(false);
                return;
              }
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (plateMatches[0]) goToTruck(plateMatches[0]);
            }}
            placeholder="Truck number"
            aria-label="Search truck number"
            enterKeyHint="search"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className={yardSelectClass + " w-full pr-7"}
          />
          {plateQuery ? (
            <button
              type="button"
              onClick={() => {
                setPlateQuery("");
                setPlateOpen(false);
                lastAutoImei.current = null;
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] text-[var(--gg-muted)]"
              aria-label="Clear truck search"
            >
              ✕
            </button>
          ) : null}
          {plateOpen && plateQuery.trim() ? (
            <ul className="absolute left-0 right-0 top-full z-[1001] mt-1 max-h-56 overflow-auto rounded-lg border border-black/10 bg-white py-1 text-xs shadow-lg">
              {plateMatches.length === 0 ? (
                <li className="px-2.5 py-2 text-[var(--gg-muted)]">
                  No truck matches
                </li>
              ) : (
                plateMatches.slice(0, 8).map((t) => (
                  <li key={t.imei}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => goToTruck(t)}
                      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-[#eef3ee]"
                    >
                      <span className="truncate font-semibold tracking-wide">
                        {t.plate}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--gg-muted)]">
                        {statusBadge(t.status)}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
        <select
          value={parkingFilter}
          onChange={(e) => {
            const name = e.target.value;
            setSelectedImei(null);
            setParkingFilter(name);
            if (name === "ALL") {
              if (loadingFilter === "ALL") setStatusFilter("ALL");
            } else {
              setLoadingFilter("ALL");
              setStatusFilter("PARK");
            }
          }}
          aria-label="Parking location"
          className={yardSelectClass}
        >
          <option value="ALL">All parking</option>
          {parkingOptions.map((name) => (
            <option key={name} value={name}>
              {name}
              {parkingCounts[name] ? ` (${parkingCounts[name]})` : ""}
            </option>
          ))}
        </select>
        <select
          value={loadingFilter}
          onChange={(e) => {
            const name = e.target.value;
            setSelectedImei(null);
            setLoadingFilter(name);
            if (name === "ALL") {
              if (parkingFilter === "ALL") setStatusFilter("ALL");
            } else {
              setParkingFilter("ALL");
              setStatusFilter("LOADING");
            }
          }}
          aria-label="Loading location"
          className={yardSelectClass}
        >
          <option value="ALL">All loading</option>
          {loadingOptions.map((name) => (
            <option key={name} value={name}>
              {name}
              {loadingCounts[name] ? ` (${loadingCounts[name]})` : ""}
            </option>
          ))}
        </select>
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
