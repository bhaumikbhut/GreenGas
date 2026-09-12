"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import type { FactoryPoint } from "@/lib/factory-points";
import { PARKING_POINTS, type LoadingPoint } from "@/lib/loading-points";

export type FleetApiResponse = {
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
  cache?: {
    hit: boolean;
    ageSec: number | null;
    refreshedAt: string | null;
  };
};

export const STATUS_META: Record<
  string,
  {
    label: string;
    /** Badge on fleet card */
    chip: string;
    /** Status filter tile in toolbar */
    tile: string;
    bar: string;
    card: string;
    /** Plate / primary text on the card */
    title: string;
    /** Secondary line color on the card */
    muted: string;
  }
> = {
  PARK: {
    label: "Park",
    chip: "bg-[#9a3412] text-white",
    tile: "bg-[#f97316] text-[#1c1917]",
    bar: "bg-[#9a3412]",
    card: "border-[#ea580c] bg-[#f97316]",
    title: "text-[#1c1917]",
    muted: "text-[#1c1917]/85",
  },
  LOADING: {
    label: "Loading",
    chip: "bg-black/30 text-white",
    tile: "bg-[#dc2626] text-white",
    bar: "bg-white/80",
    card: "border-[#b91c1c] bg-[#dc2626]",
    title: "text-white",
    muted: "text-white/90",
  },
  LOADED: {
    label: "Loaded",
    chip: "bg-black/30 text-white",
    tile: "bg-[#166534] text-white",
    bar: "bg-white/80",
    card: "border-[#14532d] bg-[#166534]",
    title: "text-white",
    muted: "text-white/90",
  },
  AT_FACTORY: {
    label: "Factory",
    chip: "bg-[#0f766e] text-white",
    tile: "bg-[#0d9488] text-white",
    bar: "bg-[#0f766e]",
    card: "border-[#0f766e] bg-[#0d9488]",
    title: "text-white",
    muted: "text-white/90",
  },
  EMPTY: {
    label: "Empty",
    chip: "bg-[#854d0e] text-white",
    tile: "bg-[#eab308] text-[#1c1917]",
    bar: "bg-[#854d0e]",
    card: "border-[#ca8a04] bg-[#eab308]",
    title: "text-[#1c1917]",
    muted: "text-[#1c1917]/85",
  },
  OFFLINE: {
    label: "Offline",
    chip: "bg-black/30 text-white",
    tile: "bg-[#4b5563] text-white",
    bar: "bg-white/80",
    card: "border-[#374151] bg-[#4b5563]",
    title: "text-white",
    muted: "text-white/90",
  },
};

export function secondaryLine(t: TruckSnapshot): string | null {
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

type FleetContextValue = {
  data: FleetApiResponse | null;
  loading: boolean;
  trucks: TruckSnapshot[];
  filtered: TruckSnapshot[];
  counts: Record<string, number>;
  selectedImei: string | null;
  selected: TruckSnapshot | null;
  focusToken: number;
  query: string;
  statusFilter: string;
  productFilter: "ALL" | "LPG" | "PROPANE";
  parkingFilter: string;
  parkingOptions: string[];
  parkingCounts: Record<string, number>;
  updatedLabel: string;
  setQuery: (q: string) => void;
  setStatusFilter: (s: string | ((prev: string) => string)) => void;
  setProductFilter: (p: "ALL" | "LPG" | "PROPANE") => void;
  setParkingFilter: (p: string) => void;
  setSelectedImei: (imei: string | null) => void;
  selectTruck: (imei: string) => void;
};

const FleetContext = createContext<FleetContextValue | null>(null);

export function useFleet() {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useFleet must be used within FleetProvider");
  return ctx;
}

export function FleetProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FleetApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedImei, setSelectedImei] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [productFilter, setProductFilter] = useState<"ALL" | "LPG" | "PROPANE">(
    "ALL",
  );
  const [parkingFilter, setParkingFilter] = useState<string>("ALL");
  const [focusToken, setFocusToken] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/trucks", { cache: "no-store" });
      const json = (await res.json()) as FleetApiResponse;
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

  const refreshLive = useCallback(async () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "hidden"
    ) {
      return;
    }
    try {
      const res = await fetch("/api/trucks?live=1", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as FleetApiResponse;
      if (json.trucks?.length) setData(json);
    } catch {
      // keep last good cache
    }
  }, []);

  useEffect(() => {
    void refresh();
    const fast = setInterval(() => void refresh(), 30000);
    const live = setInterval(() => void refreshLive(), 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    const boot = setTimeout(() => void refreshLive(), 2000);
    return () => {
      clearInterval(fast);
      clearInterval(live);
      clearTimeout(boot);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, refreshLive]);

  const trucks = useMemo(() => data?.trucks ?? [], [data]);

  const parkingOptions = useMemo(() => {
    const fromConfig = PARKING_POINTS.map((p) => p.name);
    const live = new Set<string>();
    for (const t of trucks) {
      if (t.parkingPoint) live.add(t.parkingPoint);
      if (t.lastPark) live.add(t.lastPark);
    }
    const extras = [...live].filter((n) => !fromConfig.includes(n)).sort();
    return [...fromConfig, ...extras];
  }, [trucks]);

  const parkingCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const name of parkingOptions) c[name] = 0;
    for (const t of trucks) {
      if (t.status !== "PARK") continue;
      const key = t.parkingPoint || t.lastPark;
      if (!key) continue;
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [trucks, parkingOptions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trucks.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (productFilter !== "ALL" && t.productLine !== productFilter)
        return false;
      if (parkingFilter !== "ALL" && statusFilter === "PARK") {
        const at =
          t.parkingPoint === parkingFilter || t.lastPark === parkingFilter;
        if (!at) return false;
      }
      if (!q) return true;
      return (
        t.plate.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.productLine.toLowerCase().includes(q)
      );
    });
  }, [trucks, query, statusFilter, productFilter, parkingFilter]);

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

  const selected = useMemo(() => {
    if (!selectedImei) return null;
    return (
      trucks.find((t) => t.imei === selectedImei) ??
      filtered.find((t) => t.imei === selectedImei) ??
      null
    );
  }, [trucks, filtered, selectedImei]);

  const selectTruck = useCallback((imei: string) => {
    setSelectedImei(imei);
    setFocusToken((n) => n + 1);
  }, []);

  const updatedLabel = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : loading
      ? "…"
      : "—";

  const value: FleetContextValue = {
    data,
    loading,
    trucks,
    filtered,
    counts,
    selectedImei,
    selected,
    focusToken,
    query,
    statusFilter,
    productFilter,
    parkingFilter,
    parkingOptions,
    parkingCounts,
    updatedLabel,
    setQuery,
    setStatusFilter,
    setProductFilter,
    setParkingFilter,
    setSelectedImei,
    selectTruck,
  };

  return (
    <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
  );
}
