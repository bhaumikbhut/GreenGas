"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TruckSnapshot } from "@/app/api/trucks/route";
import type { FactoryPoint } from "@/lib/factory-points";
import {
  PARKING_POINTS,
  PORT_LOADING_POINTS,
  canonicalParkingName,
  type LoadingPoint,
} from "@/lib/loading-points";

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
    chip: "bg-black/15 text-black",
    tile: "bg-[#f97316] text-black",
    bar: "bg-black/40",
    card: "border-[#ea580c] bg-[#f97316]",
    title: "text-black",
    muted: "text-black/80",
  },
  LOADING: {
    label: "Loading",
    chip: "bg-black/15 text-black",
    tile: "bg-[#EB5B3C] text-black",
    bar: "bg-black/40",
    card: "border-[#d94a2f] bg-[#EB5B3C]",
    title: "text-black",
    muted: "text-black/80",
  },
  LOADED: {
    label: "Filled road",
    chip: "bg-black/15 text-black",
    tile: "bg-[#00B386] text-black",
    bar: "bg-black/40",
    card: "border-[#009970] bg-[#00B386]",
    title: "text-black",
    muted: "text-black/80",
  },
  AT_FACTORY: {
    label: "Factory",
    chip: "bg-black/15 text-black",
    tile: "bg-[#2dd4bf] text-black",
    bar: "bg-black/40",
    card: "border-[#14b8a6] bg-[#2dd4bf]",
    title: "text-black",
    muted: "text-black/80",
  },
  EMPTY: {
    label: "Empty",
    chip: "bg-black/15 text-black",
    tile: "bg-[#fde68a] text-black",
    bar: "bg-black/40",
    card: "border-[#eab308] bg-[#fde68a]",
    title: "text-black",
    muted: "text-black/80",
  },
  ON_ROAD: {
    label: "Empty",
    chip: "bg-black/15 text-black",
    tile: "bg-[#fde68a] text-black",
    bar: "bg-black/40",
    card: "border-[#eab308] bg-[#fde68a]",
    title: "text-black",
    muted: "text-black/80",
  },
};

export function secondaryLine(t: TruckSnapshot): string | null {
  if (t.status === "PARK" && (t.parkingPoint || t.lastPark)) {
    return `At ${t.parkingPoint || t.lastPark}`;
  }
  if (t.status === "LOADING" && t.loadingPoint) {
    return `${t.loadingPoint}${t.distanceM != null ? ` · ${t.distanceM} m` : ""}`;
  }
  if (t.status === "LOADED" && t.lastLoadedFrom) {
    return `Filled · from ${t.lastLoadedFrom}`;
  }
  if (t.status === "LOADED") {
    return "Filled · on road to customer";
  }
  if (t.status === "AT_FACTORY" && t.factoryPoint) {
    return `At ${t.factoryPoint}`;
  }
  if (t.status === "AT_FACTORY" && t.lastFactory) {
    return `At ${t.lastFactory}`;
  }
  if (t.status === "AT_FACTORY") {
    return "At factory";
  }
  if (t.status === "ON_ROAD" && t.lastFactory) {
    return `Empty · left ${t.lastFactory}`;
  }
  if (t.status === "ON_ROAD" && t.lastPark) {
    return `Empty · left ${t.lastPark}`;
  }
  if (t.status === "ON_ROAD") {
    return "Empty · traveling";
  }
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
  loadingFilter: string;
  loadingOptions: string[];
  loadingCounts: Record<string, number>;
  productCounts: { LPG: number; PROPANE: number };
  updatedLabel: string;
  setQuery: (q: string) => void;
  setStatusFilter: (s: string | ((prev: string) => string)) => void;
  setProductFilter: (p: "ALL" | "LPG" | "PROPANE") => void;
  setParkingFilter: (p: string) => void;
  setLoadingFilter: (p: string) => void;
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
  /** Wall-clock when the UI last received fleet data (browser refresh resets this). */
  const [dataReceivedAt, setDataReceivedAt] = useState<number | null>(null);
  const [selectedImei, setSelectedImei] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [productFilter, setProductFilter] = useState<"ALL" | "LPG" | "PROPANE">(
    "PROPANE",
  );
  const [parkingFilter, setParkingFilter] = useState<string>("ALL");
  const [loadingFilter, setLoadingFilter] = useState<string>("ALL");
  const [focusToken, setFocusToken] = useState(0);
  const fetchedAtRef = useRef<string | null>(null);

  const applyFleet = useCallback((json: FleetApiResponse) => {
    const nextTs = Date.parse(json.fetchedAt ?? "");
    const prevTs = Date.parse(fetchedAtRef.current ?? "");
    if (
      Number.isFinite(prevTs) &&
      Number.isFinite(nextTs) &&
      nextTs <= prevTs
    ) {
      return;
    }
    if (!json.trucks?.length && fetchedAtRef.current) return;
    if (json.fetchedAt) fetchedAtRef.current = json.fetchedAt;
    setData(json);
    setDataReceivedAt(Date.now());
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
      if (json.trucks?.length) applyFleet(json);
    } catch {
      // keep last good snapshot
    } finally {
      setLoading(false);
    }
  }, [applyFleet]);

  const refreshCachedFallback = useCallback(async () => {
    try {
      const res = await fetch("/api/trucks", { cache: "no-store" });
      const json = (await res.json()) as FleetApiResponse;
      if (!fetchedAtRef.current && json.trucks?.length) applyFleet(json);
    } catch {
      // live path already ran
    } finally {
      setLoading(false);
    }
  }, [applyFleet]);

  useEffect(() => {
    void (async () => {
      await refreshLive();
      if (!fetchedAtRef.current) await refreshCachedFallback();
    })();
    const live = setInterval(() => void refreshLive(), 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(live);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshLive, refreshCachedFallback]);

  /** Recompute “Updated Xm ago” so the label tracks wall-clock time. */
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const trucks = useMemo(() => data?.trucks ?? [], [data]);

  /** All empty travel is ON_ROAD (legacy EMPTY merged). */
  const displayTrucks = useMemo(
    () =>
      trucks.map((t) => {
        if (t.status === "EMPTY") {
          return {
            ...t,
            status: "ON_ROAD" as const,
            cargo: "EMPTY" as const,
            parkingPoint: canonicalParkingName(t.parkingPoint),
            lastPark: canonicalParkingName(t.lastPark),
          };
        }
        if (t.status === "OFFLINE") {
          return {
            ...t,
            status: t.cargo === "LOADED" ? ("LOADED" as const) : ("ON_ROAD" as const),
            parkingPoint: canonicalParkingName(t.parkingPoint),
            lastPark: canonicalParkingName(t.lastPark),
          };
        }
        return {
          ...t,
          parkingPoint: canonicalParkingName(t.parkingPoint),
          lastPark: canonicalParkingName(t.lastPark),
        };
      }),
    [trucks],
  );

  const parkingOptions = useMemo(
    () => [...new Set(PARKING_POINTS.map((p) => p.name))],
    [],
  );

  const loadingOptions = useMemo(
    () => [...new Set(PORT_LOADING_POINTS.map((p) => p.name))],
    [],
  );

  useEffect(() => {
    if (parkingFilter !== "ALL" && !parkingOptions.includes(parkingFilter)) {
      setParkingFilter("ALL");
    }
  }, [parkingFilter, parkingOptions]);

  useEffect(() => {
    if (loadingFilter !== "ALL" && !loadingOptions.includes(loadingFilter)) {
      setLoadingFilter("ALL");
    }
  }, [loadingFilter, loadingOptions]);

  /** Product + search scope (status tiles / parking counts follow this). */
  const scopedTrucks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return displayTrucks.filter((t) => {
      if (productFilter !== "ALL" && t.productLine !== productFilter)
        return false;
      if (!q) return true;
      return (
        t.plate.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.productLine.toLowerCase().includes(q)
      );
    });
  }, [displayTrucks, productFilter, query]);

  const parkingCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const name of parkingOptions) c[name] = 0;
    for (const t of scopedTrucks) {
      if (t.status !== "PARK") continue;
      const key = t.parkingPoint || t.lastPark;
      if (!key) continue;
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [scopedTrucks, parkingOptions]);

  const loadingCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const name of loadingOptions) c[name] = 0;
    for (const t of scopedTrucks) {
      if (t.status !== "LOADING") continue;
      const key = t.loadingPoint;
      if (!key) continue;
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  }, [scopedTrucks, loadingOptions]);

  const filtered = useMemo(() => {
    return scopedTrucks.filter((t) => {
      if (statusFilter === "OFFLINE") return true;
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (parkingFilter !== "ALL" && statusFilter === "PARK") {
        const at =
          t.parkingPoint === parkingFilter || t.lastPark === parkingFilter;
        if (!at) return false;
      }
      if (loadingFilter !== "ALL" && statusFilter === "LOADING") {
        if (t.loadingPoint !== loadingFilter) return false;
      }
      return true;
    });
  }, [scopedTrucks, statusFilter, parkingFilter, loadingFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      PARK: 0,
      LOADING: 0,
      LOADED: 0,
      AT_FACTORY: 0,
      EMPTY: 0,
      ON_ROAD: 0,
    };
    for (const t of scopedTrucks) {
      if (c[t.status] != null) c[t.status] += 1;
      else c.ON_ROAD += 1;
    }
    return c;
  }, [scopedTrucks]);

  /** Product totals within current status (+ parking) filter for the All/LPG/Propane chips. */
  const productCounts = useMemo(() => {
    const base = displayTrucks.filter((t) => {
      if (statusFilter !== "ALL" && t.status !== statusFilter) return false;
      if (parkingFilter !== "ALL" && statusFilter === "PARK") {
        const at =
          t.parkingPoint === parkingFilter || t.lastPark === parkingFilter;
        if (!at) return false;
      }
      if (loadingFilter !== "ALL" && statusFilter === "LOADING") {
        if (t.loadingPoint !== loadingFilter) return false;
      }
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        t.plate.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.productLine.toLowerCase().includes(q)
      );
    });
    return {
      LPG: base.filter((t) => t.productLine === "LPG").length,
      PROPANE: base.filter((t) => t.productLine === "PROPANE").length,
    };
  }, [displayTrucks, statusFilter, parkingFilter, loadingFilter, query]);
  const selected = useMemo(() => {
    if (!selectedImei) return null;
    return (
      displayTrucks.find((t) => t.imei === selectedImei) ??
      filtered.find((t) => t.imei === selectedImei) ??
      null
    );
  }, [displayTrucks, filtered, selectedImei]);

  const selectTruck = useCallback((imei: string) => {
    setSelectedImei(imei);
    setFocusToken((n) => n + 1);
  }, []);

  const updatedLabel = useMemo(() => {
    void nowTick;
    if (dataReceivedAt == null) return loading ? "…" : "—";
    const ageSec = Math.max(0, Math.round((Date.now() - dataReceivedAt) / 1000));
    if (ageSec < 45) return "just now";
    if (ageSec < 90) return "1m ago";
    if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
    const clock = new Date(dataReceivedAt).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${clock} (${Math.floor(ageSec / 60)}m ago)`;
  }, [dataReceivedAt, loading, nowTick]);

  const value: FleetContextValue = {
    data,
    loading,
    trucks: displayTrucks,
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
    loadingFilter,
    loadingOptions,
    loadingCounts,
    productCounts,
    updatedLabel,
    setQuery,
    setStatusFilter,
    setProductFilter,
    setParkingFilter,
    setLoadingFilter,
    setSelectedImei,
    selectTruck,
  };

  return (
    <FleetContext.Provider value={value}>{children}</FleetContext.Provider>
  );
}
