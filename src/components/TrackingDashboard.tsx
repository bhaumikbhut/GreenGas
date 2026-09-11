"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import type { FactoryPoint } from "@/lib/factory-points";
import type { LoadingPoint } from "@/lib/loading-points";
import { statusBadge } from "@/lib/status-label";

const TruckMap = dynamic(() => import("@/components/TruckMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-[#e4ebe4] text-sm text-[var(--gg-muted)]">
      Loading map…
    </div>
  ),
});

type ApiResponse = {
  ok: boolean;
  fetchedAt?: string;
  radiusM?: number;
  errors?: string[];
  truckCount?: number;
  trucks: TruckSnapshot[];
  loadingPoints: LoadingPoint[];
  factoryPoints?: FactoryPoint[];
  factoryCount?: number;
  statusStore?: string;
  statusCounts?: Record<string, number>;
  statusCountTotal?: number;
  error?: string;
  whatsappConfigured?: boolean;
  gpsSource?: string;
  accountsUsed?: string[];
  productCounts?: { LPG: number; PROPANE: number };
  alerts?: Array<{
    plate: string;
    status: string;
    ok: boolean;
    provider: string;
    error?: string;
  }>;
};

const STATUS_META: Record<
  string,
  { label: string; chip: string; bar: string }
> = {
  PARK: {
    label: "Park",
    chip: "bg-[#fef3c7] text-[#92400e]",
    bar: "bg-[#a16207]",
  },
  LOADING: {
    label: "Loading",
    chip: "bg-[#f6e8df] text-[#8a3b12]",
    bar: "bg-[#c45c26]",
  },
  LOADED: {
    label: "Loaded",
    chip: "bg-[#dff3e8] text-[#145c38]",
    bar: "bg-[#1f7a4d]",
  },
  AT_FACTORY: {
    label: "Factory",
    chip: "bg-[#d8f3f0] text-[#0f766e]",
    bar: "bg-[#0f766e]",
  },
  EMPTY: {
    label: "Empty",
    chip: "bg-[#e4eef8] text-[#1d4f91]",
    bar: "bg-[#1d4f91]",
  },
  OFFLINE: {
    label: "Offline",
    chip: "bg-[#eef0f2] text-[#4b5563]",
    bar: "bg-[#6b7280]",
  },
};

type MobileTab = "map" | "list";

function secondaryLine(t: TruckSnapshot): string | null {
  if (t.status === "PARK" && (t.parkingPoint || t.lastPark)) {
    return `At ${t.parkingPoint || t.lastPark}${t.distanceM != null ? ` · ${t.distanceM} m` : ""}`;
  }
  if (t.status === "LOADING" && t.loadingPoint) {
    return `${t.loadingPoint}${t.distanceM != null ? ` · ${t.distanceM} m` : ""}`;
  }
  if (t.status === "LOADED" && t.lastLoadedFrom) {
    return `Filled at ${t.lastLoadedFrom}`;
  }
  if (t.status === "AT_FACTORY" && t.factoryPoint) {
    return `At ${t.factoryPoint}`;
  }
  if (t.status === "EMPTY" && t.lastFactory) {
    return `Left ${t.lastFactory}`;
  }
  if (!t.online) return "GPS offline";
  return null;
}

export default function TrackingDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImei, setSelectedImei] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [productFilter, setProductFilter] = useState<"ALL" | "LPG" | "PROPANE">(
    "ALL",
  );
  const [mobileTab, setMobileTab] = useState<MobileTab>("map");
  const [focusToken, setFocusToken] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/trucks", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (err) {
      setData({
        ok: false,
        trucks: [],
        loadingPoints: [],
        factoryPoints: [],
        error: err instanceof Error ? err.message : "Failed to load trucks",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const trucks = useMemo(() => data?.trucks ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trucks.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (productFilter !== "ALL" && t.productLine !== productFilter)
        return false;
      if (!q) return true;
      return (
        t.plate.toLowerCase().includes(q) ||
        t.imei.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.productLine.toLowerCase().includes(q)
      );
    });
  }, [trucks, query, statusFilter, productFilter]);

  const counts = useMemo(() => {
    if (data?.statusCounts) {
      return {
        PARK: data.statusCounts.PARK ?? 0,
        LOADING: data.statusCounts.LOADING ?? 0,
        LOADED: data.statusCounts.LOADED ?? 0,
        AT_FACTORY: data.statusCounts.AT_FACTORY ?? 0,
        EMPTY: data.statusCounts.EMPTY ?? 0,
        OFFLINE: data.statusCounts.OFFLINE ?? 0,
      };
    }
    const c: Record<string, number> = {
      PARK: 0,
      LOADING: 0,
      LOADED: 0,
      AT_FACTORY: 0,
      EMPTY: 0,
      OFFLINE: 0,
    };
    for (const t of trucks) {
      if (c[t.status] != null) c[t.status] += 1;
      else c.EMPTY += 1;
    }
    return c;
  }, [trucks, data?.statusCounts]);

  const selected = useMemo(
    () => filtered.find((t) => t.imei === selectedImei) ?? null,
    [filtered, selectedImei],
  );

  const selectTruck = (imei: string) => {
    setSelectedImei(imei);
    setFocusToken((n) => n + 1);
    setMobileTab("map");
  };

  const updatedLabel = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : loading
      ? "…"
      : "—";

  const filters = (
    <div className="space-y-3 border-b border-[var(--gg-line)] p-3">
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {(
          [
            ["PARK", counts.PARK],
            ["LOADING", counts.LOADING],
            ["LOADED", counts.LOADED],
            ["AT_FACTORY", counts.AT_FACTORY],
            ["EMPTY", counts.EMPTY],
            ["OFFLINE", counts.OFFLINE],
          ] as const
        ).map(([key, value]) => {
          const meta = STATUS_META[key];
          const on = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter((s) => (s === key ? "ALL" : key))}
              className={`min-h-[3.25rem] rounded-xl px-1 py-2 text-center transition ${meta.chip} ${
                on ? "ring-2 ring-[var(--gg-forest)] ring-offset-1" : "opacity-90"
              }`}
            >
              <div className="text-base font-semibold tabular-nums leading-none">
                {value}
              </div>
              <div className="mt-1 text-[10px] font-medium leading-tight">
                {meta.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex gap-1.5 rounded-xl bg-[#eef3ee] p-1">
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
            className={`min-h-9 flex-1 rounded-lg text-xs font-medium transition ${
              productFilter === key
                ? "bg-[var(--gg-forest)] text-white shadow-sm"
                : "text-[var(--gg-muted)]"
            }`}
          >
            {label}
            {key !== "ALL" ? (
              <span className="ml-1 opacity-70">
                {key === "LPG"
                  ? data?.productCounts?.LPG ?? 0
                  : data?.productCounts?.PROPANE ?? 0}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <label className="relative block">
        <span className="sr-only">Search trucks</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plate or IMEI"
          enterKeyHint="search"
          autoCapitalize="characters"
          className="w-full rounded-xl border border-[var(--gg-line)] bg-[var(--gg-bg)] py-3 pl-3 pr-10 text-base outline-none transition placeholder:text-[#8a988c] focus:border-[var(--gg-green)] sm:py-2.5 sm:text-sm"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-[var(--gg-muted)]"
          >
            Clear
          </button>
        ) : null}
      </label>
    </div>
  );

  const truckList = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {loading && trucks.length === 0 ? (
        <p className="p-5 text-sm text-[var(--gg-muted)]">Fetching fleet…</p>
      ) : filtered.length === 0 ? (
        <p className="p-5 text-sm text-[var(--gg-muted)]">No trucks match.</p>
      ) : (
        <ul>
          {filtered.map((t) => {
            const meta = STATUS_META[t.status] || STATUS_META.EMPTY;
            const detail = secondaryLine(t);
            const active = selectedImei === t.imei;
            return (
              <li key={t.imei}>
                <button
                  type="button"
                  onClick={() => selectTruck(t.imei)}
                  className={`flex w-full gap-3 border-b border-[var(--gg-line)] px-3 py-3.5 text-left transition hover:bg-[#f6faf6] active:bg-[#eaf3ea] ${
                    active ? "bg-[#eaf3ea]" : "bg-white"
                  }`}
                >
                  <span
                    className={`mt-1 h-10 w-1 shrink-0 rounded-full ${meta.bar}`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold tracking-wide">
                        {t.plate}
                      </span>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}
                      >
                        {statusBadge(t.status)}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-[var(--gg-muted)]">
                      {t.productLine} · {t.speed} km/h
                    </span>
                    {detail ? (
                      <span className="mt-0.5 block truncate text-xs text-[var(--gg-ink)]/70">
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
  );

  return (
    <div className="flex h-dvh flex-col bg-[var(--gg-bg)] text-[var(--gg-ink)]">
      <header className="safe-pad-x safe-pad-top border-b border-white/10 bg-[var(--gg-forest)] pb-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-xl tracking-tight sm:text-2xl">
                Green Gas
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[#b7d4c4]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#6ee7a8] opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#6ee7a8]" />
                </span>
                Live
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-[#c5ddd0]">
              {trucks.length} trucks
              <span className="mx-1.5 text-white/30">·</span>
              Updated {updatedLabel}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              className="min-h-10 rounded-xl bg-[var(--gg-green)] px-3.5 py-2 text-sm font-medium text-white transition active:scale-[0.98]"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      {(data?.errors?.length || data?.error) && (
        <div className="safe-pad-x border-b border-[#f0c9a0] bg-[#fff7ed] py-2.5 text-sm text-[#7a3f10]">
          {data.error || data.errors?.join(" · ")}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[360px_1fr]">
        <aside
          className={`min-h-0 flex-col border-r border-[var(--gg-line)] bg-[var(--gg-surface)] ${
            mobileTab === "list" ? "relative z-20 flex flex-1" : "hidden"
          } lg:relative lg:z-auto lg:flex lg:flex-none`}
        >
          {filters}
          {truckList}
        </aside>

        <section
          className={
            mobileTab === "map"
              ? "relative min-h-0 flex-1"
              : "pointer-events-none absolute inset-0 z-0 opacity-0 lg:pointer-events-auto lg:relative lg:z-auto lg:min-h-0 lg:flex-1 lg:opacity-100"
          }
        >
          <div className="absolute inset-0">
            <TruckMap
              trucks={filtered}
              loadingPoints={data?.loadingPoints ?? []}
              factoryPoints={data?.factoryPoints ?? []}
              radiusM={data?.radiusM ?? 500}
              selectedImei={selectedImei}
              focusToken={focusToken}
            />
          </div>

          {/* Selected truck card */}
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
        </section>

        <nav className="safe-pad-x safe-pad-bottom grid grid-cols-2 gap-1 border-t border-[var(--gg-line)] bg-white px-2 pt-1.5 lg:hidden">
          {(
            [
              ["map", "Map", "Live GPS"],
              ["list", "Fleet", `${filtered.length} trucks`],
            ] as const
          ).map(([key, label, hint]) => {
            const on = mobileTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setMobileTab(key)}
                className={`min-h-12 rounded-xl text-sm font-medium transition ${
                  on
                    ? "bg-[#e8f3ec] text-[var(--gg-forest)]"
                    : "text-[var(--gg-muted)]"
                }`}
              >
                <span className="block">{label}</span>
                <span className="block text-[10px] font-normal opacity-70">
                  {hint}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
