import type { AutoStatus } from "@/lib/geofence";
import type { FactoryPoint } from "@/lib/factory-points";
import type { LoadingPoint } from "@/lib/loading-points";

export type TruckSnapshot = {
  imei: string;
  plate: string;
  name: string;
  productLine: "LPG" | "PROPANE";
  account: string;
  lat: number | null;
  lng: number | null;
  speed: number;
  course: number;
  gpstime: number | null;
  online: boolean;
  status: AutoStatus;
  loadingPoint: string | null;
  parkingPoint: string | null;
  factoryPoint: string | null;
  port: string | null;
  distanceM: number | null;
  cargo: "LOADED" | "EMPTY";
  lastLoadedFrom: string | null;
  lastFactory: string | null;
  lastPark: string | null;
};

export type FleetSnapshot = {
  ok: boolean;
  fetchedAt: string;
  radiusM: number;
  gpsSource: string;
  statusStore: string;
  accountsUsed: string[];
  productCounts: { LPG: number; PROPANE: number };
  statusCounts: Record<string, number>;
  statusCountTotal: number;
  whatsappConfigured: boolean;
  factoryCount: number;
  errors: string[];
  alerts: Array<{
    plate: string;
    status: string;
    ok: boolean;
    provider: string;
    error?: string;
  }>;
  truckCount: number;
  trucks: TruckSnapshot[];
  loadingPoints: LoadingPoint[];
  factoryPoints: FactoryPoint[];
  cache?: {
    hit: boolean;
    ageSec: number | null;
    refreshedAt: string | null;
  };
};
