import { FACTORY_POINTS } from "@/lib/factory-points";
import {
  findNearestLoadingPoint,
  findNearestParkingPoint,
  resolveFactoryGeofence,
  nextStatus,
  normalizeMemory,
  replayGpsTrail,
  distanceToNearestLoadingOutlineM,
  type AutoStatus,
  type TruckMemory,
} from "@/lib/geofence";
import { canonicalParkingName, LOADING_POINTS } from "@/lib/loading-points";
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
import { fetchAllPortalFleets, fetchPortalPlayback, gpsSource } from "@/lib/protrack-portal";
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

const TRAIL_NEAR_LOADING_M = 400;
const TRAIL_CACHE_MS = 10 * 60 * 1000;
const trailCache = new Map<string, { at: number; mem: TruckMemory }>();

/** Replay recent portal GPS when live cargo looks empty next to a loading yard. */
async function recoverFillFromRecentGps(
  device: ProtrackDevice,
  fallbackRadiusM: number,
): Promise<TruckMemory | null> {
  const hit = trailCache.get(device.imei);
  if (hit && Date.now() - hit.at < TRAIL_CACHE_MS) return hit.mem;
  try {
    const end = Date.now();
    const pb = await fetchPortalPlayback({
      imei: device.imei,
      begin: end - 16 * 60 * 60 * 1000,
      end,
      accountLabel: device.accountLabel,
      deviceId: device.deviceId,
      maxPages: 6,
    });
    const mem = replayGpsTrail(
      pb.points.map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        speed: p.speed,
        atMs: p.gpstime * 1000,
      })),
      fallbackRadiusM,
    );
    trailCache.set(device.imei, { at: Date.now(), mem });
    return mem;
  } catch {
    return null;
  }
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

    const insideLoading = hasFix
      ? findNearestLoadingPoint(track!.latitude, track!.longitude)
      : null;
    const insideParking = hasFix
      ? findNearestParkingPoint(track!.latitude, track!.longitude)
      : null;
    const insideFactory = hasFix
      ? resolveFactoryGeofence(
          track!.latitude,
          track!.longitude,
          r,
          track!.speed,
        )
      : null;

    const prev = store[device.imei];
    let memory = nextStatus({
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

    if (
      hasFix &&
      !insideParking &&
      memory.cargo === "EMPTY" &&
      memory.status !== "LOADING" &&
      memory.status !== "PARK"
    ) {
      const dLoad = distanceToNearestLoadingOutlineM(
        track!.latitude,
        track!.longitude,
      );
      if (dLoad != null && dLoad <= TRAIL_NEAR_LOADING_M) {
        const trail = await recoverFillFromRecentGps(device, r);
        if (
          trail &&
          (trail.cargo === "LOADED" ||
            trail.status === "LOADED" ||
            trail.status === "LOADING" ||
            trail.status === "AT_FACTORY")
        ) {
          memory = nextStatus({
            prev: trail,
            insideLoading,
            insideParking,
            insideFactory,
            online: Boolean(track) && online,
            lat: track!.latitude,
            lng: track!.longitude,
            speed: track?.speed ?? null,
            accstatus: track?.accstatus ?? null,
          });
        }
      }
    }

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
      parkingPoint: canonicalParkingName(insideParking?.point.name) ?? null,
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
      lastPark: canonicalParkingName(memory.lastPark) ?? null,
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
