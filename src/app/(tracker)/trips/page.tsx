"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useFleet } from "@/components/FleetProvider";

type Trip = {
  id: string;
  imei: string;
  plate: string;
  productLine: "LPG" | "PROPANE";
  port: string | null;
  loadedFrom: string;
  factory: string | null;
  status: "IN_TRANSIT" | "AT_FACTORY" | "DELIVERED";
  loadedAt: string;
  arrivedAt: string | null;
  departedAt: string | null;
};

type TripsResponse = {
  ok: boolean;
  count: number;
  counts: { inTransit: number; atFactory: number; delivered: number };
  trips: Trip[];
  error?: string;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function durationLabel(start: string, end: string | null): string {
  const a = Date.parse(start);
  const b = end ? Date.parse(end) : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const mins = Math.round((b - a) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function statusStyle(status: Trip["status"]): string {
  if (status === "DELIVERED") return "bg-[#00B386] text-black";
  if (status === "AT_FACTORY") return "bg-[#2dd4bf] text-black";
  return "bg-[#fde68a] text-black";
}

function statusLabel(status: Trip["status"]): string {
  if (status === "DELIVERED") return "Delivered";
  if (status === "AT_FACTORY") return "At factory";
  return "In transit";
}

export default function TripsPage() {
  const { productFilter, setProductFilter } = useFleet();
  const [data, setData] = useState<TripsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [plate, setPlate] = useState("");
  const [port, setPort] = useState("");
  const [factory, setFactory] = useState("");
  const [status, setStatus] = useState<"ALL" | Trip["status"]>("ALL");

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      q.set("limit", "200");
      if (plate.trim()) q.set("plate", plate.trim());
      if (port.trim()) q.set("port", port.trim());
      if (factory.trim()) q.set("factory", factory.trim());
      if (status !== "ALL") q.set("status", status);
      const res = await fetch(`/api/trips?${q}`, { cache: "no-store" });
      const json = (await res.json()) as TripsResponse;
      setData(json);
    } catch (err) {
      setData({
        ok: false,
        count: 0,
        counts: { inTransit: 0, atFactory: 0, delivered: 0 },
        trips: [],
        error: err instanceof Error ? err.message : "Failed to load trips",
      });
    } finally {
      setLoading(false);
    }
  }, [plate, port, factory, status]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60000);
    return () => clearInterval(id);
  }, [load]);

  const trips = useMemo(() => {
    const all = data?.trips ?? [];
    if (productFilter === "ALL") return all;
    return all.filter((t) => t.productLine === productFilter);
  }, [data?.trips, productFilter]);

  const counts = useMemo(
    () => ({
      inTransit: trips.filter((t) => t.status === "IN_TRANSIT").length,
      atFactory: trips.filter((t) => t.status === "AT_FACTORY").length,
      delivered: trips.filter((t) => t.status === "DELIVERED").length,
    }),
    [trips],
  );

  const emptyHint = useMemo(() => {
    if (loading) return "Loading trips…";
    if (data?.error) return data.error;
    if (trips.length === 0) {
      return "No trips yet. Trips start when a truck becomes FILLED at a loading bay, and close when it leaves a factory.";
    }
    return null;
  }, [loading, data?.error, trips.length]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--gg-bg)]">
      <div className="shrink-0 border-b border-[var(--gg-line)] bg-[var(--gg-surface)] px-3 py-2 lg:px-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:gap-3">
          <div className="grid flex-1 grid-cols-3 gap-1">
            <div className="rounded-lg bg-[#fde68a] px-2 py-1.5 text-center text-black">
              <div className="text-base font-semibold tabular-nums">
                {counts.inTransit}
              </div>
              <div className="text-[10px] font-medium">In transit</div>
              <div className="text-[9px] opacity-70">= Filled road</div>
            </div>
            <div className="rounded-lg bg-[#2dd4bf] px-2 py-1.5 text-center text-black">
              <div className="text-base font-semibold tabular-nums">
                {counts.atFactory}
              </div>
              <div className="text-[10px] font-medium">At factory</div>
              <div className="text-[9px] opacity-70">= Factory tile</div>
            </div>
            <div className="rounded-lg bg-[#00B386] px-2 py-1.5 text-center text-black">
              <div className="text-base font-semibold tabular-nums">
                {counts.delivered}
              </div>
              <div className="text-[10px] font-medium">Delivered</div>
              <div className="text-[9px] opacity-70">left factory</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
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
                  className={`min-h-8 rounded-md px-2 text-xs font-medium ${
                    productFilter === key
                      ? "bg-white text-[var(--gg-forest)] shadow-sm"
                      : "text-[var(--gg-muted)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="Plate"
              className="min-h-9 w-[7.5rem] rounded-lg border border-[var(--gg-line)] bg-white px-2 text-sm"
            />
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="Port / load"
              className="min-h-9 w-[7.5rem] rounded-lg border border-[var(--gg-line)] bg-white px-2 text-sm"
            />
            <input
              value={factory}
              onChange={(e) => setFactory(e.target.value)}
              placeholder="Factory"
              className="min-h-9 w-[7.5rem] rounded-lg border border-[var(--gg-line)] bg-white px-2 text-sm"
            />
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "ALL" | Trip["status"])
              }
              className="min-h-9 rounded-lg border border-[var(--gg-line)] bg-white px-2 text-sm"
            >
              <option value="ALL">All status</option>
              <option value="IN_TRANSIT">In transit</option>
              <option value="AT_FACTORY">At factory</option>
              <option value="DELIVERED">Delivered</option>
            </select>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 lg:p-3">
        {emptyHint ? (
          <p className="p-4 text-sm text-[var(--gg-muted)]">{emptyHint}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--gg-line)] bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#eef3ee] text-[11px] uppercase tracking-wide text-[var(--gg-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Truck</th>
                  <th className="px-3 py-2 font-medium">Filled at</th>
                  <th className="px-3 py-2 font-medium">Factory</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Loaded</th>
                  <th className="px-3 py-2 font-medium">Arrived</th>
                  <th className="px-3 py-2 font-medium">Left</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-[var(--gg-line)] align-top"
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold tracking-wide">
                        {t.plate}
                      </div>
                      <div className="text-[11px] text-[var(--gg-muted)]">
                        {t.productLine}
                        {t.port ? ` · ${t.port}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">{t.loadedFrom}</td>
                    <td className="px-3 py-2">{t.factory || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${statusStyle(t.status)}`}
                      >
                        {statusLabel(t.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px]">
                      {fmtWhen(t.loadedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px]">
                      {fmtWhen(t.arrivedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px]">
                      {fmtWhen(t.departedAt)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[12px]">
                      {durationLabel(
                        t.loadedAt,
                        t.departedAt || t.arrivedAt,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
