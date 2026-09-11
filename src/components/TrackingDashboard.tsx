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
    <div className="flex h-full items-center justify-center bg-[#e8efe8] text-sm text-[#3d4a3d]">
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

const STATUS_STYLE: Record<string, string> = {
  LOADING: "bg-[#f3e0d2] text-[#8a3b12]",
  LOADED: "bg-[#d9efe3] text-[#145c38]",
  AT_FACTORY: "bg-[#ede9fe] text-[#5b21b6]",
  EMPTY: "bg-[#d9e4f5] text-[#1d4f91]",
  OFFLINE: "bg-[#eceff3] text-[#4b5563]",
};

export default function TrackingDashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImei, setSelectedImei] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [productFilter, setProductFilter] = useState<"ALL" | "LPG" | "PROPANE">(
    "ALL",
  );
  const [waBusy, setWaBusy] = useState(false);
  const [waMsg, setWaMsg] = useState<string | null>(null);

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

  const sendTestWhatsApp = useCallback(async () => {
    setWaBusy(true);
    setWaMsg(null);
    try {
      const res = await fetch("/api/whatsapp", { method: "POST" });
      const json = (await res.json()) as {
        configured: boolean;
        result: { ok: boolean; provider: string; error?: string; message: string };
      };
      if (json.result.ok) {
        setWaMsg(`Test sent via ${json.result.provider}`);
      } else {
        setWaMsg(json.result.error || "WhatsApp send failed");
      }
    } catch (err) {
      setWaMsg(err instanceof Error ? err.message : "WhatsApp test failed");
    } finally {
      setWaBusy(false);
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
      if (productFilter !== "ALL" && t.productLine !== productFilter) return false;
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
    const c: Record<string, number> = {
      LOADING: 0,
      LOADED: 0,
      AT_FACTORY: 0,
      EMPTY: 0,
      OFFLINE: 0,
    };
    for (const t of trucks) {
      // Exactly one status bucket per truck
      if (c[t.status] != null) c[t.status] += 1;
      else c.EMPTY += 1;
    }
    return c;
  }, [trucks]);
  const countTotal = useMemo(
    () =>
      counts.LOADING +
      counts.LOADED +
      counts.AT_FACTORY +
      counts.EMPTY +
      counts.OFFLINE,
    [counts],
  );

  return (
    <div className="flex h-dvh flex-col bg-[#f4f7f4] text-[#1a241a]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d5e0d5] bg-[#0f2a1f] px-4 py-3 text-white">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-[#9fc3b1]">
            Green Gas
          </p>
          <h1 className="font-serif text-2xl tracking-tight">Fleet Tracker</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[#d7e8de]">
          <span>
            {trucks.length} trucks
            {countTotal !== trucks.length ? ` (status sum ${countTotal})` : ""}
          </span>
          <span>
            LPG {data?.productCounts?.LPG ?? 0} · Propane{" "}
            {data?.productCounts?.PROPANE ?? 0}
          </span>
          <span>GPS: {data?.gpsSource || "…"}</span>
          <span>Radius {data?.radiusM ?? 500} m</span>
          <span>
            {data?.fetchedAt
              ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}`
              : loading
                ? "Loading…"
                : "—"}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded bg-[#1f7a4d] px-3 py-1.5 text-white hover:bg-[#196640]"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={waBusy}
            onClick={() => void sendTestWhatsApp()}
            className="rounded bg-[#128c7e] px-3 py-1.5 text-white hover:bg-[#0e7368] disabled:opacity-60"
          >
            {waBusy ? "Sending…" : "Test WhatsApp"}
          </button>
        </div>
      </header>

      {waMsg && (
        <div className="border-b border-[#b7e0d8] bg-[#e8f7f4] px-4 py-2 text-sm text-[#0f5c52]">
          WhatsApp: {waMsg}
        </div>
      )}

      <div className="border-b border-[#d5e0d5] bg-white px-4 py-2 text-xs text-[#3d4a3d]">
        WhatsApp (Meta):{" "}
        {data?.whatsappConfigured
          ? "configured — alerts on LOADING / LOADED / factory"
          : "not configured — set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TO"}
        {data?.factoryCount === 0
          ? " · add factory map pins to flip LOADED → EMPTY"
          : ""}
        {data?.alerts?.length
          ? ` · last poll sent ${data.alerts.length} alert(s)`
          : ""}
      </div>

      {(data?.errors?.length || data?.error) && (
        <div className="border-b border-[#f0c9a0] bg-[#fff4e8] px-4 py-2 text-sm text-[#7a3f10]">
          <strong>ProTrack:</strong>{" "}
          {data.error || data.errors?.join(" · ")}
          {(data.errors?.some((e) => e.includes("10007")) ||
            data.error?.includes("10007")) && (
            <span>
              {" "}
              — Ask your GPS vendor to enable <em>Open API</em> on accounts
              GGLPG / GG11 (error 10007 = permission denied).
            </span>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[380px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-[#d5e0d5] bg-white">
          <div className="space-y-3 border-b border-[#e6eee6] p-3">
            <div className="grid grid-cols-5 gap-1.5 text-center text-[10px]">
              {(
                [
                  ["LOADING", counts.LOADING],
                  ["LOADED", counts.LOADED],
                  ["AT_FACTORY", counts.AT_FACTORY],
                  ["EMPTY", counts.EMPTY],
                  ["OFFLINE", counts.OFFLINE],
                ] as const
              ).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setStatusFilter((s) => (s === key ? "ALL" : key))
                  }
                  className={`rounded-md px-0.5 py-2 ${STATUS_STYLE[key]} ${
                    statusFilter === key ? "ring-2 ring-[#0f2a1f]/40" : ""
                  }`}
                >
                  <div className="text-sm font-semibold">{value}</div>
                  <div className="leading-tight">
                    {key === "AT_FACTORY" ? "FACTORY" : key}
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-2 text-xs">
              {(
                [
                  ["ALL", "All"],
                  ["LPG", `LPG (${data?.productCounts?.LPG ?? 0})`],
                  ["PROPANE", `Propane (${data?.productCounts?.PROPANE ?? 0})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setProductFilter(key)}
                  className={`rounded-md px-2 py-1 ${
                    productFilter === key
                      ? "bg-[#0f2a1f] text-white"
                      : "bg-[#eef3ee] text-[#3d4a3d]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plate / IMEI"
              className="w-full rounded-md border border-[#cfdccf] bg-[#f8fbf8] px-3 py-2 text-sm outline-none focus:border-[#1f7a4d]"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && trucks.length === 0 ? (
              <p className="p-4 text-sm text-[#5b6b5b]">Fetching fleet…</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-[#5b6b5b]">No trucks match.</p>
            ) : (
              <ul>
                {filtered.map((t) => (
                  <li key={t.imei}>
                    <button
                      type="button"
                      onClick={() => setSelectedImei(t.imei)}
                      className={`flex w-full flex-col gap-1 border-b border-[#eef3ee] px-3 py-3 text-left hover:bg-[#f3f8f3] ${
                        selectedImei === t.imei ? "bg-[#eaf3ea]" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold tracking-wide">
                          {t.plate}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[t.status] || STATUS_STYLE.EMPTY}`}
                        >
                          {statusBadge(t.status)}
                        </span>
                      </div>
                      <div className="text-xs text-[#5b6b5b]">
                        {t.productLine} · {t.speed} km/h
                        {t.online ? "" : " · GPS offline"}
                      </div>
                      {t.status === "LOADED" && t.lastLoadedFrom ? (
                        <div className="text-xs text-[#145c38]">
                          Filled at {t.lastLoadedFrom} → factory
                        </div>
                      ) : null}
                      {t.status === "AT_FACTORY" && t.factoryPoint ? (
                        <div className="text-xs text-[#5b21b6]">
                          At {t.factoryPoint}
                        </div>
                      ) : null}
                      {t.status === "EMPTY" && t.lastFactory ? (
                        <div className="text-xs text-[#1d4f91]">
                          Emptied at {t.lastFactory}
                        </div>
                      ) : null}
                      {t.loadingPoint && t.status === "LOADING" ? (
                        <div className="text-xs text-[#8a3b12]">
                          {t.loadingPoint} · {t.distanceM} m
                        </div>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="relative min-h-[50vh] lg:min-h-0">
          <TruckMap
            trucks={filtered}
            loadingPoints={data?.loadingPoints ?? []}
            factoryPoints={data?.factoryPoints ?? []}
            radiusM={data?.radiusM ?? 500}
            selectedImei={selectedImei}
          />
        </section>
      </div>
    </div>
  );
}
