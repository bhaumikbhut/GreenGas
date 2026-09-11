import { NextResponse } from "next/server";
import { FACTORY_POINTS } from "@/lib/factory-points";
import {
  findNearestFactoryPoint,
  findNearestLoadingPoint,
  nextStatus,
  type AutoStatus,
  type TruckMemory,
} from "@/lib/geofence";
import { LOADING_POINTS } from "@/lib/loading-points";
import { appendNotification } from "@/lib/notification-log";
import {
  getConfiguredAccounts,
  isOnline,
  listDevices,
  trackDevices,
  type ProtrackDevice,
  type ProtrackTrackPoint,
} from "@/lib/protrack";
import {
  fetchAllPortalFleets,
  gpsSource,
} from "@/lib/protrack-portal";
import { readTruckStore, writeTruckStore } from "@/lib/status-store";
import { sendWhatsAppAlert, whatsappConfigured } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  factoryPoint: string | null;
  port: string | null;
  distanceM: number | null;
  cargo: "LOADED" | "EMPTY";
  lastLoadedFrom: string | null;
  lastFactory: string | null;
};

function radiusM(): number {
  const n = Number(process.env.GEOFENCE_RADIUS_M || 500);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

/** Alert once per transition into these statuses. EMPTY = left factory. */
const ALERT_STATUSES = new Set<AutoStatus>([
  "LOADING",
  "LOADED",
  "AT_FACTORY",
  "EMPTY",
]);

async function loadFromOpenApi(): Promise<{
  devices: ProtrackDevice[];
  tracksByImei: Map<string, ProtrackTrackPoint>;
  errors: string[];
  source: string;
}> {
  const accounts = getConfiguredAccounts();
  const errors: string[] = [];
  const devices: ProtrackDevice[] = [];
  const tracksByImei = new Map<string, ProtrackTrackPoint>();

  for (const acc of accounts) {
    try {
      const list = await listDevices(acc);
      devices.push(...list);
      const points = await trackDevices(
        acc.account,
        acc.password,
        list.map((d) => d.imei),
      );
      for (const p of points) tracksByImei.set(p.imei, p);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { devices, tracksByImei, errors, source: "openapi" };
}

async function loadFromPortal(): Promise<{
  devices: ProtrackDevice[];
  tracksByImei: Map<string, ProtrackTrackPoint>;
  errors: string[];
  source: string;
  accountsUsed: string[];
}> {
  const { rows, errors, accountsUsed } = await fetchAllPortalFleets();
  const devices: ProtrackDevice[] = [];
  const tracksByImei = new Map<string, ProtrackTrackPoint>();

  for (const row of rows) {
    devices.push(row.device);
    tracksByImei.set(row.device.imei, row.track);
  }

  return {
    devices,
    tracksByImei,
    errors,
    source: "portal",
    accountsUsed,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imeiFilter = searchParams.get("imei")?.trim() || null;

  const accounts = getConfiguredAccounts();
  if (accounts.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing ProTrack credentials. Set PROTRACK_ACCOUNT_LPG / PROTRACK_ACCOUNT_PROPANE in .env.local",
        trucks: [],
        loadingPoints: LOADING_POINTS,
        factoryPoints: FACTORY_POINTS,
      },
      { status: 500 },
    );
  }

  const sourceMode = gpsSource();
  let devices: ProtrackDevice[] = [];
  let tracksByImei = new Map<string, ProtrackTrackPoint>();
  let errors: string[] = [];
  let sourceUsed = sourceMode;
  let accountsUsed: string[] = [];

  if (sourceMode === "portal" || sourceMode === "auto") {
    const portal = await loadFromPortal();
    devices = portal.devices;
    tracksByImei = portal.tracksByImei;
    errors = portal.errors;
    accountsUsed = portal.accountsUsed;
    sourceUsed = "portal";

    if (sourceMode === "auto" && devices.length === 0) {
      const api = await loadFromOpenApi();
      devices = api.devices;
      tracksByImei = api.tracksByImei;
      errors = [...errors, ...api.errors];
      sourceUsed = "openapi";
    }
  } else {
    const api = await loadFromOpenApi();
    devices = api.devices;
    tracksByImei = api.tracksByImei;
    errors = api.errors;
    sourceUsed = "openapi";
  }

  const alerts: Array<{
    plate: string;
    status: string;
    ok: boolean;
    provider: string;
    error?: string;
  }> = [];

  const r = radiusM();
  const store = await readTruckStore();
  const nextStore: Record<string, TruckMemory> = { ...store };
  const trucks: TruckSnapshot[] = [];

  for (const device of devices) {
    const track = tracksByImei.get(device.imei);
    const online = track ? isOnline(track.datastatus) : false;
    const hasFix =
      track != null &&
      Number.isFinite(track.latitude) &&
      Number.isFinite(track.longitude) &&
      !(track.latitude === 0 && track.longitude === 0);

    const insideLoading =
      track && online && hasFix
        ? findNearestLoadingPoint(track.latitude, track.longitude, r)
        : null;
    const insideFactory =
      track && online && hasFix
        ? findNearestFactoryPoint(track.latitude, track.longitude, r)
        : null;

    const prev = store[device.imei];
    const memory = nextStatus({
      prev,
      insideLoading,
      insideFactory,
      online: Boolean(track) && online,
    });

    const prevNotified = String(prev?.lastNotifiedStatus ?? "");
    const shouldAlert =
      ALERT_STATUSES.has(memory.status) &&
      memory.status !== memory.lastNotifiedStatus &&
      memory.status !== prev?.lastNotifiedStatus &&
      !(memory.status === "LOADED" && prevNotified === "RELEASED") &&
      // Don't spam EMPTY for trucks that never visited a factory this session
      !(
        memory.status === "EMPTY" &&
        prevNotified !== "AT_FACTORY" &&
        String(prev?.status ?? "") !== "AT_FACTORY"
      );

    if (shouldAlert) {
      const locationName =
        insideLoading?.point.name ||
        insideFactory?.point.name ||
        (memory.status === "LOADED"
          ? memory.lastLoadedFrom || "Port (departed)"
          : memory.status === "EMPTY"
            ? memory.lastFactory || "Factory (departed)"
            : "Unknown");

      const result = await sendWhatsAppAlert({
        plate: device.plate,
        imei: device.imei,
        productLine: device.accountLabel,
        status: memory.status as
          | "LOADING"
          | "LOADED"
          | "AT_FACTORY"
          | "EMPTY",
        locationName,
        port: insideLoading?.point.port ?? null,
        when: new Date(),
        lat: hasFix ? track!.latitude : null,
        lng: hasFix ? track!.longitude : null,
      });

      await appendNotification({
        imei: device.imei,
        plate: device.plate,
        status: memory.status,
        locationName,
        ok: result.ok,
        provider: result.provider,
        error: result.error,
        message: result.message,
      });

      alerts.push({
        plate: device.plate,
        status: memory.status,
        ok: result.ok,
        provider: result.provider,
        error: result.error,
      });

      if (result.ok) {
        memory.lastNotifiedStatus = memory.status;
        memory.lastNotifiedAt = Date.now();
      }
    }

    nextStore[device.imei] = memory;

    const near =
      memory.cargo === "LOADED"
        ? insideFactory
        : insideLoading;

    trucks.push({
      imei: device.imei,
      plate: device.plate,
      name: device.name,
      productLine: device.accountLabel,
      account: device.account,
      lat: hasFix ? track!.latitude : null,
      lng: hasFix ? track!.longitude : null,
      speed: track?.speed ?? 0,
      course: track?.course ?? 0,
      gpstime: track?.gpstime ? track.gpstime * 1000 : null,
      online: Boolean(track) && online,
      status: memory.status,
      loadingPoint: insideLoading?.point.name ?? null,
      factoryPoint: insideFactory?.point.name ?? null,
      port: insideLoading?.point.port ?? null,
      distanceM: near ? Math.round(near.distanceM) : null,
      cargo: memory.cargo,
      lastLoadedFrom: memory.lastLoadedFrom ?? null,
      lastFactory: memory.lastFactory ?? null,
    });
  }

  await writeTruckStore(nextStore);
  trucks.sort((a, b) => a.plate.localeCompare(b.plate));

  const filtered = imeiFilter
    ? trucks.filter((t) => t.imei === imeiFilter)
    : trucks;

  const lpgCount = trucks.filter((t) => t.productLine === "LPG").length;
  const propaneCount = trucks.filter((t) => t.productLine === "PROPANE").length;

  return NextResponse.json({
    ok: errors.length === 0 && trucks.length > 0,
    fetchedAt: new Date().toISOString(),
    radiusM: r,
    gpsSource: sourceUsed,
    accountsUsed,
    productCounts: { LPG: lpgCount, PROPANE: propaneCount },
    whatsappConfigured: whatsappConfigured(),
    factoryCount: FACTORY_POINTS.length,
    errors,
    alerts,
    truckCount: filtered.length,
    trucks: filtered,
    loadingPoints: imeiFilter ? [] : LOADING_POINTS,
    factoryPoints: imeiFilter ? [] : FACTORY_POINTS,
  });
}
