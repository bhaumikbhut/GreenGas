import { FACTORY_POINTS } from "@/lib/factory-points";
import { readFleetSnapshot } from "@/lib/fleet-cache";
import {
  findNearestFactoryPoint,
  findNearestLoadingPoint,
  findNearestParkingPoint,
  nextStatus,
  normalizeMemory,
  type AutoStatus,
  type TruckMemory,
} from "@/lib/geofence";
import { LOADING_POINTS } from "@/lib/loading-points";
import { appendNotification } from "@/lib/notification-log";
import type { FleetSnapshot, TruckSnapshot } from "@/lib/fleet-types";
import {
  getConfiguredAccounts,
  isOnline,
  listDevices,
  trackDevices,
  type ProtrackDevice,
  type ProtrackTrackPoint,
} from "@/lib/protrack";
import { fetchAllPortalFleets, gpsSource } from "@/lib/protrack-portal";
import {
  readTruckStore,
  statusStoreMode,
  writeTruckStore,
} from "@/lib/status-store";
import { sendWhatsAppAlert, whatsappConfigured } from "@/lib/whatsapp";
import {
  completeTrip,
  fillUnknownLoadedFrom,
  markTripArrived,
  openTrip,
  reconcileTripsFromFleet,
} from "@/lib/trips";

const ALERT_STATUSES = new Set<AutoStatus>([
  "PARK",
  "LOADING",
  "LOADED",
  "AT_FACTORY",
  "EMPTY",
]);

function radiusM(): number {
  const n = Number(process.env.GEOFENCE_RADIUS_M || 500);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

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

export type BuildFleetOptions = {
  /** Skip WhatsApp + notification I/O (use for frequent live map refreshes). */
  skipAlerts?: boolean;
};

/**
 * Fast path for map pins: pull ProTrack GPS and patch lat/lng/speed onto the
 * last snapshot. Skips WhatsApp and full status recomputation so Vercel stays
 * under the 60s limit (full builds often 504 from iad1 → ProTrack latency).
 */
export async function patchFleetLiveGps(): Promise<FleetSnapshot | null> {
  const prev = await readFleetSnapshot();

  const portal = await loadFromPortal();
  if (portal.devices.length === 0) {
    if (prev?.trucks.length) {
      return {
        ...prev,
        fetchedAt: new Date().toISOString(),
        errors: portal.errors.length ? portal.errors : prev.errors,
        accountsUsed: portal.accountsUsed.length
          ? portal.accountsUsed
          : prev.accountsUsed,
      };
    }
    return null;
  }

  if (!prev?.trucks.length) {
    return buildFleetSnapshot({ skipAlerts: true });
  }

  const byImei = new Map(prev.trucks.map((t) => [t.imei, t]));
  const trucks: TruckSnapshot[] = [];

  for (const device of portal.devices) {
    const track = portal.tracksByImei.get(device.imei);
    const prevTruck = byImei.get(device.imei);
    const online = track ? isOnline(track.datastatus) : false;
    const hasFix =
      track != null &&
      Number.isFinite(track.latitude) &&
      Number.isFinite(track.longitude) &&
      !(track.latitude === 0 && track.longitude === 0);

    if (prevTruck) {
      trucks.push({
        ...prevTruck,
        plate: device.plate || prevTruck.plate,
        name: device.name || prevTruck.name,
        lat: hasFix ? track!.latitude : prevTruck.lat,
        lng: hasFix ? track!.longitude : prevTruck.lng,
        speed: track?.speed ?? 0,
        course: track?.course ?? prevTruck.course,
        gpstime: track?.gpstime ? track.gpstime * 1000 : prevTruck.gpstime,
        online: Boolean(track) && online,
      });
      byImei.delete(device.imei);
    } else if (hasFix && track) {
      // New device not in cache yet — show as on-road until full refresh.
      trucks.push({
        imei: device.imei,
        plate: device.plate,
        name: device.name,
        productLine: device.accountLabel,
        account: device.account,
        lat: track.latitude,
        lng: track.longitude,
        speed: track.speed ?? 0,
        course: track.course ?? 0,
        gpstime: track.gpstime ? track.gpstime * 1000 : null,
        online,
        status: online ? "ON_ROAD" : "OFFLINE",
        loadingPoint: null,
        parkingPoint: null,
        factoryPoint: null,
        port: null,
        distanceM: null,
        cargo: "EMPTY",
        lastLoadedFrom: null,
        lastFactory: null,
        lastPark: null,
      });
    }
  }

  // Keep any cached trucks ProTrack omitted this pull (don't flash-remove).
  for (const leftover of byImei.values()) trucks.push(leftover);
  trucks.sort((a, b) => a.plate.localeCompare(b.plate));

  const statusCounts = {
    PARK: 0,
    LOADING: 0,
    LOADED: 0,
    AT_FACTORY: 0,
    EMPTY: 0,
    ON_ROAD: 0,
    OFFLINE: 0,
  };
  for (const t of trucks) {
    if (t.status in statusCounts) {
      statusCounts[t.status as keyof typeof statusCounts] += 1;
    }
  }

  return {
    ...prev,
    ok: true,
    fetchedAt: new Date().toISOString(),
    gpsSource: portal.source,
    accountsUsed: portal.accountsUsed,
    productCounts: {
      LPG: trucks.filter((t) => t.productLine === "LPG").length,
      PROPANE: trucks.filter((t) => t.productLine === "PROPANE").length,
    },
    statusCounts,
    statusCountTotal:
      statusCounts.PARK +
      statusCounts.LOADING +
      statusCounts.LOADED +
      statusCounts.AT_FACTORY +
      statusCounts.EMPTY +
      statusCounts.ON_ROAD +
      statusCounts.OFFLINE,
    errors: portal.errors,
    alerts: [],
    truckCount: trucks.length,
    trucks,
    loadingPoints: LOADING_POINTS,
    factoryPoints: FACTORY_POINTS,
    factoryCount: FACTORY_POINTS.length,
  };
}

/** Pull ProTrack, update geofence memory / WhatsApp, return API snapshot. */
export async function buildFleetSnapshot(
  options: BuildFleetOptions = {},
): Promise<FleetSnapshot> {
  const skipAlerts = Boolean(options.skipAlerts);
  const accounts = getConfiguredAccounts();
  if (accounts.length === 0) {
    return {
      ok: false,
      fetchedAt: new Date().toISOString(),
      radiusM: radiusM(),
      gpsSource: gpsSource(),
      statusStore: statusStoreMode(),
      accountsUsed: [],
      productCounts: { LPG: 0, PROPANE: 0 },
      statusCounts: {
        PARK: 0,
        LOADING: 0,
        LOADED: 0,
        AT_FACTORY: 0,
        EMPTY: 0,
        ON_ROAD: 0,
        OFFLINE: 0,
      },
      statusCountTotal: 0,
      whatsappConfigured: whatsappConfigured(),
      factoryCount: FACTORY_POINTS.length,
      errors: [
        "Missing ProTrack credentials. Set PROTRACK_ACCOUNT_LPG / PROTRACK_ACCOUNT_PROPANE in .env.local",
      ],
      alerts: [],
      truckCount: 0,
      trucks: [],
      loadingPoints: LOADING_POINTS,
      factoryPoints: FACTORY_POINTS,
    };
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

  const alerts: FleetSnapshot["alerts"] = [];
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
        ? findNearestLoadingPoint(track.latitude, track.longitude)
        : null;
    const insideParking =
      track && online && hasFix
        ? findNearestParkingPoint(track.latitude, track.longitude)
        : null;
    const insideFactory =
      track && online && hasFix
        ? findNearestFactoryPoint(track.latitude, track.longitude, r)
        : null;

    const prev = store[device.imei];
    const memory = nextStatus({
      prev,
      insideLoading,
      insideParking,
      insideFactory,
      online: Boolean(track) && online,
      lat: hasFix ? track!.latitude : null,
      lng: hasFix ? track!.longitude : null,
      speed: track?.speed ?? null,
      accstatus: track?.accstatus ?? null,
    });

    const prevNorm = prev ? normalizeMemory(prev) : null;
    const leftFactory =
      prevNorm?.status === "AT_FACTORY" &&
      memory.status === "ON_ROAD" &&
      Boolean(memory.lastFactory);

    const becameLoaded =
      memory.status === "LOADED" && prevNorm?.status !== "LOADED";
    const becameAtFactory =
      memory.status === "AT_FACTORY" && prevNorm?.status !== "AT_FACTORY";

    // Trip history (always — even on live skipAlerts refreshes).
    if (becameLoaded) {
      const loadedFrom =
        memory.lastLoadedFrom ||
        insideLoading?.point.name ||
        "Unknown loading point";
      await openTrip({
        imei: device.imei,
        plate: device.plate,
        productLine: device.accountLabel,
        port:
          insideLoading?.point.port ??
          insideParking?.point.port ??
          null,
        loadedFrom,
      });
      if (memory.lastLoadedFrom) {
        await fillUnknownLoadedFrom({
          imei: device.imei,
          loadedFrom: memory.lastLoadedFrom,
          port:
            insideLoading?.point.port ??
            insideParking?.point.port ??
            null,
        });
      }
    }
    if (becameAtFactory && memory.lastFactory) {
      if (memory.lastLoadedFrom) {
        await fillUnknownLoadedFrom({
          imei: device.imei,
          loadedFrom: memory.lastLoadedFrom,
        });
      }
      await openTrip({
        imei: device.imei,
        plate: device.plate,
        productLine: device.accountLabel,
        port: insideLoading?.point.port ?? insideParking?.point.port ?? null,
        loadedFrom: memory.lastLoadedFrom || "Unknown loading point",
      });
      await markTripArrived({
        imei: device.imei,
        factory: memory.lastFactory,
      });
    }
    if (leftFactory) {
      await completeTrip({
        imei: device.imei,
        factory: memory.lastFactory,
      });
    }

    const prevNotified = String(prev?.lastNotifiedStatus ?? "");
    const shouldAlert =
      leftFactory ||
      (ALERT_STATUSES.has(memory.status) &&
        memory.status !== memory.lastNotifiedStatus &&
        memory.status !== prev?.lastNotifiedStatus &&
        !(memory.status === "LOADED" && prevNotified === "RELEASED"));

    if (shouldAlert && !skipAlerts) {
      const alertStatus = leftFactory
        ? ("EMPTY" as const)
        : (memory.status as
            | "PARK"
            | "LOADING"
            | "LOADED"
            | "AT_FACTORY"
            | "EMPTY");
      const locationName =
        insideLoading?.point.name ||
        insideParking?.point.name ||
        insideFactory?.point.name ||
        (leftFactory
          ? memory.lastFactory || "Factory (departed)"
          : memory.status === "LOADED"
            ? memory.lastLoadedFrom || "Port (departed)"
            : memory.status === "ON_ROAD"
              ? memory.lastFactory || memory.lastPark || "On road"
              : memory.status === "PARK"
                ? memory.lastPark || "Parking"
                : "Unknown");

      const result = await sendWhatsAppAlert({
        plate: device.plate,
        imei: device.imei,
        productLine: device.accountLabel,
        status: alertStatus,
        locationName,
        port:
          insideLoading?.point.port ??
          insideParking?.point.port ??
          null,
        when: new Date(),
        lat: hasFix ? track!.latitude : null,
        lng: hasFix ? track!.longitude : null,
      });

      await appendNotification({
        imei: device.imei,
        plate: device.plate,
        status: leftFactory ? "EMPTY" : memory.status,
        locationName,
        ok: result.ok,
        provider: result.provider,
        error: result.error,
        message: result.message,
      });

      alerts.push({
        plate: device.plate,
        status: leftFactory ? "EMPTY" : memory.status,
        ok: result.ok,
        provider: result.provider,
        error: result.error,
      });

      if (result.ok) {
        memory.lastNotifiedStatus = leftFactory ? "EMPTY" : memory.status;
        memory.lastNotifiedAt = Date.now();
      }
    }

    nextStore[device.imei] = memory;

    const near =
      memory.cargo === "LOADED"
        ? insideFactory
        : memory.status === "PARK"
          ? insideParking
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
      parkingPoint: insideParking?.point.name ?? null,
      factoryPoint:
        insideFactory?.point.name ??
        (memory.status === "AT_FACTORY" ? memory.lastFactory || null : null),
      port:
        insideLoading?.point.port ??
        insideParking?.point.port ??
        null,
      distanceM: near ? Math.round(near.distanceM) : null,
      cargo: memory.cargo,
      lastLoadedFrom: memory.lastLoadedFrom ?? null,
      lastFactory: memory.lastFactory ?? null,
      lastPark: memory.lastPark ?? null,
    });
  }

  await writeTruckStore(nextStore);
  trucks.sort((a, b) => a.plate.localeCompare(b.plate));

  const statusCounts = {
    PARK: 0,
    LOADING: 0,
    LOADED: 0,
    AT_FACTORY: 0,
    EMPTY: 0,
    ON_ROAD: 0,
    OFFLINE: 0,
  };
  for (const t of trucks) {
    if (t.status in statusCounts) {
      statusCounts[t.status as keyof typeof statusCounts] += 1;
    }
  }

  // Keep trips history aligned with final statuses (one Turso round-trip).
  try {
    await reconcileTripsFromFleet(trucks, undefined, { createMissing: false });
  } catch {
    // Don't fail the fleet snapshot if trips KV blips
  }

  const lpgCount = trucks.filter((t) => t.productLine === "LPG").length;
  const propaneCount = trucks.filter((t) => t.productLine === "PROPANE").length;

  return {
    ok: errors.length === 0 && trucks.length > 0,
    fetchedAt: new Date().toISOString(),
    radiusM: r,
    gpsSource: sourceUsed,
    statusStore: statusStoreMode(),
    accountsUsed,
    productCounts: { LPG: lpgCount, PROPANE: propaneCount },
    statusCounts,
    statusCountTotal:
      statusCounts.PARK +
      statusCounts.LOADING +
      statusCounts.LOADED +
      statusCounts.AT_FACTORY +
      statusCounts.EMPTY +
      statusCounts.ON_ROAD +
      statusCounts.OFFLINE,
    whatsappConfigured: whatsappConfigured(),
    factoryCount: FACTORY_POINTS.length,
    errors,
    alerts,
    truckCount: trucks.length,
    trucks,
    loadingPoints: LOADING_POINTS,
    factoryPoints: FACTORY_POINTS,
  };
}
