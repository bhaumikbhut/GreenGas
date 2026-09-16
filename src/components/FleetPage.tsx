"use client";

import { useRouter } from "next/navigation";
import {
  STATUS_META,
  secondaryLine,
  useFleet,
} from "@/components/FleetProvider";
import { statusBadge } from "@/lib/status-label";

export default function FleetPage() {
  const router = useRouter();
  const {
    loading,
    filtered,
    counts,
    selectedImei,
    query,
    statusFilter,
    productFilter,
    parkingFilter,
    parkingOptions,
    parkingCounts,
    loadingFilter,
    loadingOptions,
    loadingCounts,
    productCounts,
    setQuery,
    setStatusFilter,
    setProductFilter,
    setParkingFilter,
    setLoadingFilter,
    selectTruck,
  } = useFleet();

  const openOnMap = (imei: string) => {
    selectTruck(imei);
    router.push("/map");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gg-bg)]">
      {/* Compact toolbar — keeps TV / large screens list-first */}
      <div className="shrink-0 border-b border-[var(--gg-line)] bg-[var(--gg-surface)] px-3 py-2 lg:px-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <div className="grid min-w-0 flex-1 grid-cols-3 gap-1 sm:grid-cols-5">
            {(
              [
                ["PARK", counts.PARK],
                ["LOADING", counts.LOADING],
                ["LOADED", counts.LOADED],
                ["AT_FACTORY", counts.AT_FACTORY],
                ["ON_ROAD", counts.ON_ROAD],
              ] as const
            ).map(([key, value]) => {
              const meta = STATUS_META[key];
              const on = statusFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setStatusFilter((s) => {
                      const next = s === key ? "ALL" : key;
                      if (next !== "PARK") setParkingFilter("ALL");
                      if (next !== "LOADING") setLoadingFilter("ALL");
                      return next;
                    })
                  }
                  className={`rounded-lg px-0.5 py-1.5 text-center transition lg:py-1 ${meta.tile} ${
                    on
                      ? "ring-2 ring-[var(--gg-forest)] ring-offset-1"
                      : "opacity-90"
                  }`}
                >
                  <div className="text-sm font-semibold tabular-nums leading-none lg:text-base">
                    {value}
                  </div>
                  <div className="mt-0.5 text-[9px] font-medium leading-tight lg:text-[10px]">
                    {meta.label}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <div className="flex gap-0.5 rounded-lg bg-[#eef3ee] p-0.5">
              {(
                [
                  ["ALL", "All"],
                  ["LPG", "LPG"],
                  ["PROPANE", "Propane"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setProductFilter(key)}
                  className={`min-h-8 rounded-md px-2.5 text-xs font-medium transition ${
                    productFilter === key
                      ? "bg-[var(--gg-forest)] text-white shadow-sm"
                      : "text-[var(--gg-muted)]"
                  }`}
                >
                  {label}
                  {key !== "ALL" ? (
                    <span className="ml-1 opacity-70">
                      {key === "LPG"
                        ? productCounts.LPG
                        : productCounts.PROPANE}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            {statusFilter === "PARK" ? (
              <select
                value={parkingFilter}
                onChange={(e) => setParkingFilter(e.target.value)}
                aria-label="Parking location"
                className="max-w-[min(100%,280px)] appearance-none rounded-lg border border-[var(--gg-line)] bg-[var(--gg-bg)] py-1.5 pl-2 pr-7 text-xs outline-none focus:border-[var(--gg-green)]"
              >
                <option value="ALL">All parking</option>
                {parkingOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {parkingCounts[name] ? ` (${parkingCounts[name]})` : ""}
                  </option>
                ))}
              </select>
            ) : null}

            {statusFilter === "LOADING" ? (
              <select
                value={loadingFilter}
                onChange={(e) => setLoadingFilter(e.target.value)}
                aria-label="Loading location"
                className="max-w-[min(100%,280px)] appearance-none rounded-lg border border-[var(--gg-line)] bg-[var(--gg-bg)] py-1.5 pl-2 pr-7 text-xs outline-none focus:border-[var(--gg-green)]"
              >
                <option value="ALL">All loading</option>
                {loadingOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                    {loadingCounts[name] ? ` (${loadingCounts[name]})` : ""}
                  </option>
                ))}
              </select>
            ) : null}

            <label className="relative min-w-[9rem] flex-1 lg:max-w-[14rem] lg:flex-none">
              <span className="sr-only">Search plate</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Plate"
                enterKeyHint="search"
                autoCapitalize="characters"
                className="w-full rounded-lg border border-[var(--gg-line)] bg-[var(--gg-bg)] py-1.5 pl-2 pr-8 text-sm outline-none placeholder:text-[#8a988c] focus:border-[var(--gg-green)]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-[10px] text-[var(--gg-muted)]"
                >
                  ✕
                </button>
              ) : null}
            </label>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 lg:p-3">
        {loading && filtered.length === 0 ? (
          <p className="p-4 text-sm text-[var(--gg-muted)]">Fetching fleet…</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-[var(--gg-muted)]">No trucks match.</p>
        ) : (
          <ul className="grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {filtered.map((t) => {
              const meta = STATUS_META[t.status] ?? STATUS_META.ON_ROAD;
              const on = t.imei === selectedImei;
              const detail = secondaryLine(t);
              return (
                <li key={t.imei}>
                  <button
                    type="button"
                    onClick={() => openOnMap(t.imei)}
                    className={`flex h-full w-full items-stretch gap-2 rounded-xl border px-2.5 py-2 text-left transition active:scale-[0.99] ${
                      meta.card
                    } ${
                      on
                        ? "ring-2 ring-[var(--gg-forest)] ring-offset-1"
                        : ""
                    }`}
                  >
                    <span
                      className={`mt-0.5 h-8 w-1 shrink-0 rounded-full ${meta.bar}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-1.5">
                        <span
                          className={`truncate text-sm font-bold tracking-wide ${meta.title}`}
                        >
                          {t.plate}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${meta.chip}`}
                        >
                          {statusBadge(t.status)}
                        </span>
                      </span>
                      <span
                        className={`mt-0.5 block truncate text-[11px] font-medium ${meta.muted}`}
                      >
                        {t.productLine} · {t.speed} km/h
                      </span>
                      {detail ? (
                        <span
                          className={`mt-0.5 block truncate text-[11px] font-medium ${meta.muted}`}
                        >
                          {detail}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
