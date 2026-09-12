/**
 * Heal empty/on_road trucks from current GPS vs geofences in the fleet snapshot.
 * Does not need ProTrack history — uses live lat/lng vs factory/loading/parking pins.
 *
 * Run: node scripts/heal-statuses-from-gps.mjs
 */
import { readFileSync } from "fs";
import { createClient } from "@libsql/client";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  process.env[m[1].trim()] = v;
}

const STATE_KEY = "green-gas:truck-state:v2";
const SNAP_KEY = "green-gas:fleet-snapshot";
const TRIPS_KEY = "green-gas:trips:v1";
const PORT_LEAVE_M = 15_000;
const MAX_TRIPS = 800;

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function get(key) {
  const row = await db.execute({
    sql: `SELECT value FROM kv WHERE key = ?`,
    args: [key],
  });
  if (!row.rows[0]) return null;
  return JSON.parse(String(row.rows[0].value));
}

async function set(key, value) {
  await db.execute({
    sql: `INSERT INTO kv (key, value, expires_at) VALUES (?, ?, NULL)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    args: [key, JSON.stringify(value)],
  });
}

function distM(lat, lng, plat, plng) {
  const dlat = (lat - plat) * 111_000;
  const dlng = (lng - plng) * 111_000 * Math.cos((lat * Math.PI) / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function nearest(lat, lng, points, radiusKey = "radiusM", fallbackR = 500) {
  let best = null;
  for (const p of points) {
    const r = Number(p[radiusKey] ?? fallbackR) || fallbackR;
    const m = distM(lat, lng, p.lat, p.lng);
    if (m <= r && (!best || m < best.distanceM)) {
      best = { point: p, distanceM: m };
    }
  }
  return best;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const snap = await get(SNAP_KEY);
if (!snap?.trucks?.length) {
  console.error("No fleet snapshot in Turso");
  process.exit(1);
}

const factoryPoints = snap.factoryPoints || [];
const allPoints = snap.loadingPoints || [];
const loadingPoints = allPoints.filter((p) => p.kind === "loading");
const parkingPoints = allPoints.filter((p) => p.kind === "parking");
const rDefault = snap.radiusM || 500;

const store = (await get(STATE_KEY)) || {};
let trips = (await get(TRIPS_KEY)) || [];
if (!Array.isArray(trips)) trips = [];

function loadingNameForPort(port) {
  if (!port) return null;
  return loadingPoints.find((p) => p.port === port)?.name ?? null;
}

function ensureOpenTrip(t, loadedFrom, port, factory = null, arrived = false) {
  let trip = trips.find((x) => x.imei === t.imei && x.status !== "DELIVERED");
  if (!trip) {
    trip = {
      id: newId(),
      imei: t.imei,
      plate: t.plate,
      productLine: t.productLine,
      port: port ?? null,
      loadedFrom: loadedFrom || "Unknown loading point",
      factory: factory,
      status: arrived ? "AT_FACTORY" : "IN_TRANSIT",
      loadedAt: new Date().toISOString(),
      arrivedAt: arrived ? new Date().toISOString() : null,
      departedAt: null,
    };
    trips.unshift(trip);
  } else if (arrived) {
    trip.status = "AT_FACTORY";
    trip.factory = factory || trip.factory;
    trip.arrivedAt = trip.arrivedAt || new Date().toISOString();
  }
}

let toFactory = 0;
let toLoaded = 0;
let toLoading = 0;
const notes = [];

for (const t of snap.trucks) {
  if (t.lat == null || t.lng == null) continue;
  if (t.status !== "ON_ROAD" && t.status !== "EMPTY") continue;

  const insideF = nearest(t.lat, t.lng, factoryPoints, "radiusM", rDefault);
  const insideL = nearest(t.lat, t.lng, loadingPoints);
  const insideP = nearest(t.lat, t.lng, parkingPoints);
  const mem = store[t.imei] || {};

  if (insideF) {
    const loadFrom =
      t.lastLoadedFrom ||
      mem.lastLoadedFrom ||
      loadingNameForPort(t.port) ||
      "Unknown loading point";
    t.status = "AT_FACTORY";
    t.cargo = "LOADED";
    t.lastFactory = insideF.point.name;
    t.lastLoadedFrom = loadFrom;
    t.factoryPoint = insideF.point.name;
    t.distanceM = Math.round(insideF.distanceM);
    store[t.imei] = {
      ...mem,
      status: "AT_FACTORY",
      cargo: "LOADED",
      geofenceId: insideF.point.id,
      geofenceKind: "factory",
      enteredAt: Date.now(),
      outsideStreak: 0,
      lastFactory: insideF.point.name,
      lastLoadedFrom: loadFrom,
      lastPark: t.lastPark || mem.lastPark || null,
    };
    ensureOpenTrip(t, loadFrom, t.port, insideF.point.name, true);
    toFactory += 1;
    notes.push(`${t.plate} → AT_FACTORY @ ${insideF.point.name}`);
    continue;
  }

  if (insideL && !insideP) {
    t.status = "LOADING";
    t.cargo = "EMPTY";
    t.loadingPoint = insideL.point.name;
    store[t.imei] = {
      ...mem,
      status: "LOADING",
      cargo: "EMPTY",
      geofenceId: insideL.point.id,
      geofenceKind: "loading",
      enteredAt: Date.now(),
      outsideStreak: 0,
      lastPark: t.lastPark || mem.lastPark || null,
    };
    toLoading += 1;
    notes.push(`${t.plate} → LOADING @ ${insideL.point.name}`);
    continue;
  }

  if (t.lastPark) {
    const park = parkingPoints.find((p) => p.name === t.lastPark);
    if (park) {
      const away = distM(t.lat, t.lng, park.lat, park.lng);
      if (away >= PORT_LEAVE_M && !insideP) {
        const loadName =
          t.lastLoadedFrom ||
          loadingNameForPort(park.port) ||
          `${park.port} loading`;
        t.status = "LOADED";
        t.cargo = "LOADED";
        t.lastLoadedFrom = loadName;
        t.port = park.port;
        store[t.imei] = {
          ...mem,
          status: "LOADED",
          cargo: "LOADED",
          geofenceId: null,
          geofenceKind: null,
          enteredAt: null,
          outsideStreak: 0,
          lastLoadedFrom: loadName,
          lastPark: park.name,
        };
        ensureOpenTrip(t, loadName, park.port, null, false);
        toLoaded += 1;
        notes.push(
          `${t.plate} → LOADED (left ${park.name}, ${Math.round(away / 1000)}km)`,
        );
      }
    }
  }
}

const statusCounts = {
  PARK: 0,
  LOADING: 0,
  LOADED: 0,
  AT_FACTORY: 0,
  EMPTY: 0,
  ON_ROAD: 0,
  OFFLINE: 0,
};
for (const t of snap.trucks) {
  if (t.status in statusCounts) statusCounts[t.status] += 1;
}
snap.statusCounts = statusCounts;
snap.statusCountTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0);
snap.fetchedAt = new Date().toISOString();

await set(STATE_KEY, store);
await set(SNAP_KEY, snap);
await set(TRIPS_KEY, trips.slice(0, MAX_TRIPS));

console.log(
  JSON.stringify(
    {
      healed: { toFactory, toLoaded, toLoading },
      statusCounts,
      sample: notes.slice(0, 40),
      more: Math.max(0, notes.length - 40),
    },
    null,
    2,
  ),
);
