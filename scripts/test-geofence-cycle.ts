import {
  MIN_LOADING_DWELL_MS,
  nextStatus,
  resolveFactoryGeofence,
  findNearestParkingPoint,
  findNearestLoadingPoint,
  pointInFencePolygon,
  samePortFacility,
  type TruckMemory,
} from "../src/lib/geofence";
import {
  IOCL_LOAD_POLYGON,
  IOCL_PARK_POLYGON,
  DAHEJ_PARK_POLYGON,
  DAHEJ_LOAD1_POLYGON,
  DAHEJ_LOAD2_POLYGON,
  MUNDRA_LOAD_POLYGON,
  MUNDRA_CT4_PARK_E_POLYGON,
  MUNDRA_CT4_PARK_W_POLYGON,
  MUNDRA_MOKHA_PARK_POLYGON,
  AEGIS_KANDLA_PARK_POLYGON,
  AEGIS_KANDLA_LOAD_POLYGON,
  AEGIS_PIPAVAV_PARK_POLYGON,
  AEGIS_PIPAVAV_LOAD1_POLYGON,
  AEGIS_PIPAVAV_LOAD2_POLYGON,
  SHREJI_PIPAVAV_PARK_POLYGON,
  PORBANDAR_LOAD_POLYGON,
  LOADING_POINTS,
  canonicalParkingName,
  canonicalLoadingName,
  type LoadingPoint,
} from "../src/lib/loading-points";
import type { FactoryPoint } from "../src/lib/factory-points";

const loadPt: LoadingPoint = {
  id: "mundra-loading",
  name: "Mundra Adani Loading Point",
  port: "MUNDRA",
  lat: 0,
  lng: 0,
  radiusM: 75,
  kind: "loading",
};
const parkPt: LoadingPoint = {
  id: "mundra-mokha-parking",
  name: "Mundra Adani Mokha Parking",
  port: "MUNDRA",
  lat: 0,
  lng: 0,
  radiusM: 500,
  kind: "parking",
};
const factoryPt: FactoryPoint = {
  id: "fac-test",
  name: "TEST FACTORY",
  lat: 1,
  lng: 1,
  radiusM: 100,
};

const insideL = { point: loadPt, distanceM: 10 };
const insideP = { point: parkPt, distanceM: 20 };
const insideF = { point: factoryPt, distanceM: 15 };
const none = null;

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    fails += 1;
  } else {
    console.log("ok:", msg);
  }
}

const t0 = 1_000_000;

let m = nextStatus({
  prev: undefined,
  insideLoading: none,
  insideParking: insideP,
  insideFactory: none,
  online: true,
  now: t0,
});
assert(m.status === "PARK" && m.cargo === "EMPTY", "ON_ROAD→PARK");

m = nextStatus({
  prev: m,
  insideLoading: insideL,
  insideParking: insideP,
  insideFactory: none,
  online: true,
  now: t0 + 1000,
});
assert(m.status === "LOADING", "PARK→LOADING");

// Leave loading (2 polls) → always LOADED (no dwell required)
let early: TruckMemory = { ...m, enteredAt: t0 + 1000 };
early = nextStatus({
  prev: early,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 1000 + 30_000,
});
early = nextStatus({
  prev: early,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 1000 + 60_000,
});
assert(
  early.status === "LOADED" && early.cargo === "LOADED",
  "leave loading → LOADED (even short visit)",
);

// Full dwell then leave → LOADED
m = nextStatus({
  prev: undefined,
  insideLoading: insideL,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0,
});
const afterDwell = t0 + MIN_LOADING_DWELL_MS + 1000;
m = nextStatus({
  prev: m,
  insideLoading: insideL,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell,
});
m = nextStatus({
  prev: m,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell + 1000,
});
m = nextStatus({
  prev: m,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell + 2000,
});
assert(
  m.status === "LOADED" &&
    m.cargo === "LOADED" &&
    m.lastLoadedFrom === loadPt.name,
  "dwell+leave → LOADED",
);

// LOADED on road must stay LOADED (not EMPTY)
m = nextStatus({
  prev: m,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell + 5000,
});
assert(m.status === "LOADED", "LOADED stays LOADED on road");

// LOADED → AT_FACTORY
m = nextStatus({
  prev: m,
  insideLoading: none,
  insideParking: none,
  insideFactory: insideF,
  online: true,
  now: afterDwell + 6000,
});
assert(
  m.status === "AT_FACTORY" && m.cargo === "LOADED" && m.lastFactory === factoryPt.name,
  "LOADED→AT_FACTORY",
);

// Leave factory (2 polls) → EMPTY only
m = nextStatus({
  prev: m,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell + 7000,
});
assert(m.status === "AT_FACTORY", "factory leave poll 1 still AT_FACTORY");
m = nextStatus({
  prev: m,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell + 8000,
});
assert(
  m.status === "ON_ROAD" && m.cargo === "EMPTY" && m.lastFactory === factoryPt.name,
  "AT_FACTORY leave → ON_ROAD with lastFactory",
);

// Post-factory empty stays ON_ROAD and keeps factory location
m = nextStatus({
  prev: m,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell + 9000,
});
assert(
  m.status === "ON_ROAD" && m.lastFactory === factoryPt.name,
  "ON_ROAD keeps lastFactory after leave",
);

// LOADED without lastLoadedFrom still stays filled at parking (pin-only demotion removed)
const bad = nextStatus({
  prev: {
    status: "LOADED",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "LOADED",
    lastLoadedFrom: null,
  },
  insideLoading: none,
  insideParking: insideP,
  insideFactory: none,
  online: true,
  now: afterDwell + 3000,
});
assert(
  bad.status === "PARK" && bad.cargo === "EMPTY",
  "LOADED at parking with no fill-at → PARK empty",
);

const filled = nextStatus({
  prev: {
    status: "LOADED",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "LOADED",
    lastLoadedFrom: loadPt.name,
  },
  insideLoading: none,
  insideParking: insideP,
  insideFactory: none,
  online: true,
  now: afterDwell + 3000,
});
assert(filled.status === "LOADED", "real LOADED at parking stays LOADED");

// Leave park → ON_ROAD (not EMPTY)
let parkLeave: TruckMemory = {
  status: "PARK",
  geofenceId: parkPt.id,
  geofenceKind: "parking",
  enteredAt: t0,
  outsideStreak: 0,
  cargo: "EMPTY",
  lastPark: parkPt.name,
};
parkLeave = nextStatus({
  prev: parkLeave,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 1000,
});
parkLeave = nextStatus({
  prev: parkLeave,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 2000,
});
assert(
  parkLeave.status === "LOADED" && parkLeave.cargo === "LOADED",
  "leave park → LOADED (heading to load)",
);

let orphan: TruckMemory = {
  status: "LOADING",
  geofenceId: null,
  geofenceKind: null,
  enteredAt: t0,
  outsideStreak: 0,
  cargo: "EMPTY",
  lastLoadedFrom: null,
};
orphan = nextStatus({
  prev: orphan,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell,
});
orphan = nextStatus({
  prev: orphan,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: afterDwell + 1000,
});
assert(orphan.status === "LOADED", "LOADING without geofenceId + dwell → LOADED");

const emptyAtFac = nextStatus({
  prev: {
    status: "ON_ROAD",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "EMPTY",
  },
  insideLoading: none,
  insideParking: none,
  insideFactory: insideF,
  online: true,
  now: t0 + 50_000,
});
assert(
  emptyAtFac.status === "AT_FACTORY" &&
    emptyAtFac.cargo === "LOADED" &&
    emptyAtFac.lastFactory === factoryPt.name,
  "empty on known factory pin → AT_FACTORY",
);

const gate = resolveFactoryGeofence(22.74731, 70.96485, 500, 0);
assert(
  Boolean(gate) && (gate?.distanceM ?? 999) <= 320,
  `stopped GPS at G TONE/SEKOL gate → factory (${gate?.point.name} ${Math.round(gate?.distanceM ?? -1)}m)`,
);
assert(
  resolveFactoryGeofence(22.74731, 70.96485, 500, 40) == null,
  "moving past G TONE/SEKOL gate does not match",
);
assert(
  resolveFactoryGeofence(22.908441, 70.827361, 500, 0) == null,
  "NH27 rest 2.7 km from MONOLITH is not a factory",
);

const ioclParkPt = LOADING_POINTS.find((p) => p.id === "kandla-iocl-parking")!;
assert(
  Boolean(ioclParkPt.polygon) && (ioclParkPt.polygon?.length ?? 0) === 4,
  "IOCL parking is the 4-corner Google Maps outline",
);
assert(
  Boolean(ioclParkPt.polygon) &&
    ioclParkPt.polygon!.every(
      ([lat, lng], i) =>
        lat === IOCL_PARK_POLYGON[i][0] && lng === IOCL_PARK_POLYGON[i][1],
    ),
  "IOCL parking corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(ioclParkPt.lat, ioclParkPt.lng, IOCL_PARK_POLYGON),
  "IOCL parking pin sits inside the parking outline",
);
assert(
  Boolean(findNearestParkingPoint(ioclParkPt.lat, ioclParkPt.lng)),
  "GPS in the IOCL parking outline matches parking",
);
const dahejParkPt = LOADING_POINTS.find((p) => p.id === "dahej-gtpcl-parking")!;
assert(
  Boolean(dahejParkPt.polygon) && (dahejParkPt.polygon?.length ?? 0) === 4,
  "Dahej parking is the 4-corner Google Maps outline",
);
assert(
  Boolean(dahejParkPt.polygon) &&
    dahejParkPt.polygon!.every(
      ([lat, lng], i) =>
        lat === DAHEJ_PARK_POLYGON[i][0] && lng === DAHEJ_PARK_POLYGON[i][1],
    ),
  "Dahej parking corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(dahejParkPt.lat, dahejParkPt.lng, DAHEJ_PARK_POLYGON),
  "Dahej parking pin sits inside the parking outline",
);
assert(
  Boolean(findNearestParkingPoint(dahejParkPt.lat, dahejParkPt.lng)),
  "GPS in the Dahej parking outline matches parking",
);
assert(
  !pointInFencePolygon(21.692484, 72.53928, DAHEJ_PARK_POLYGON),
  "Dahej loading pin 1 is outside the parking outline",
);
const dahejLoad1 = LOADING_POINTS.find((p) => p.id === "dahej-gtpcl-load1")!;
assert(
  Boolean(dahejLoad1.polygon) && (dahejLoad1.polygon?.length ?? 0) === 4,
  "Dahej loading 1 is the 4-corner Google Maps outline",
);
assert(
  Boolean(dahejLoad1.polygon) &&
    dahejLoad1.polygon!.every(
      ([lat, lng], i) =>
        lat === DAHEJ_LOAD1_POLYGON[i][0] && lng === DAHEJ_LOAD1_POLYGON[i][1],
    ),
  "Dahej loading 1 corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(dahejLoad1.lat, dahejLoad1.lng, DAHEJ_LOAD1_POLYGON),
  "Dahej loading 1 pin sits inside the loading outline",
);
assert(
  findNearestLoadingPoint(dahejLoad1.lat, dahejLoad1.lng)?.point.id ===
    "dahej-gtpcl-load1",
  "GPS in the Dahej loading 1 outline matches loading",
);
assert(
  !pointInFencePolygon(dahejLoad1.lat, dahejLoad1.lng, DAHEJ_PARK_POLYGON),
  "Dahej loading 1 is outside the parking outline",
);
assert(
  !pointInFencePolygon(dahejLoad1.lat, dahejLoad1.lng, DAHEJ_LOAD2_POLYGON),
  "Dahej loading 1 does not overlap loading 2",
);
const dahejLoad2 = LOADING_POINTS.find((p) => p.id === "dahej-gtpcl-load2")!;
assert(
  Boolean(dahejLoad2.polygon) && (dahejLoad2.polygon?.length ?? 0) === 4,
  "Dahej loading 2 is the 4-corner Google Maps outline",
);
assert(
  Boolean(dahejLoad2.polygon) &&
    dahejLoad2.polygon!.every(
      ([lat, lng], i) =>
        lat === DAHEJ_LOAD2_POLYGON[i][0] && lng === DAHEJ_LOAD2_POLYGON[i][1],
    ),
  "Dahej loading 2 corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(dahejLoad2.lat, dahejLoad2.lng, DAHEJ_LOAD2_POLYGON),
  "Dahej loading 2 pin sits inside the loading outline",
);
assert(
  findNearestLoadingPoint(dahejLoad2.lat, dahejLoad2.lng)?.point.id ===
    "dahej-gtpcl-load2",
  "GPS in the Dahej loading 2 outline matches loading",
);
assert(
  !pointInFencePolygon(dahejLoad2.lat, dahejLoad2.lng, DAHEJ_PARK_POLYGON),
  "Dahej loading 2 is outside the parking outline",
);
const ioclLoad = LOADING_POINTS.find((p) => p.id === "kandla-iocl-loading")!;
assert(
  Boolean(ioclLoad.polygon) && (ioclLoad.polygon?.length ?? 0) === 4,
  "IOCL loading is the 4-corner Google Maps outline",
);
assert(
  Boolean(ioclLoad.polygon) &&
    ioclLoad.polygon!.every(
      ([lat, lng], i) =>
        lat === IOCL_LOAD_POLYGON[i][0] && lng === IOCL_LOAD_POLYGON[i][1],
    ),
  "IOCL loading corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(ioclLoad.lat, ioclLoad.lng, IOCL_LOAD_POLYGON),
  "IOCL loading pin sits inside the loading outline",
);
assert(
  !pointInFencePolygon(ioclLoad.lat, ioclLoad.lng, IOCL_PARK_POLYGON),
  "IOCL loading pin is outside the parking outline",
);
assert(
  !pointInFencePolygon(ioclParkPt.lat, ioclParkPt.lng, IOCL_LOAD_POLYGON),
  "IOCL parking yard is outside the loading outline",
);
assert(
  Boolean(findNearestLoadingPoint(ioclLoad.lat, ioclLoad.lng)),
  "GPS in the IOCL loading outline matches loading",
);
const mundraLoad = LOADING_POINTS.find((p) => p.id === "mundra-loading")!;
assert(
  Boolean(mundraLoad.polygon) && (mundraLoad.polygon?.length ?? 0) === 4,
  "Mundra loading is the 4-corner Google Maps outline",
);
assert(
  Boolean(mundraLoad.polygon) &&
    mundraLoad.polygon!.every(
      ([lat, lng], i) =>
        lat === MUNDRA_LOAD_POLYGON[i][0] && lng === MUNDRA_LOAD_POLYGON[i][1],
    ),
  "Mundra loading corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(mundraLoad.lat, mundraLoad.lng, MUNDRA_LOAD_POLYGON),
  "Mundra loading pin sits inside the loading outline",
);
assert(
  findNearestLoadingPoint(mundraLoad.lat, mundraLoad.lng)?.point.id ===
    "mundra-loading",
  "GPS in the Mundra loading outline matches loading",
);
const mundraCt4E = LOADING_POINTS.find((p) => p.id === "mundra-ct4-parking")!;
const mundraCt4W = LOADING_POINTS.find((p) => p.id === "mundra-ct4-parking-w")!;
assert(
  mundraCt4E.name === "Mundra Adani CT 4 Parking" &&
    mundraCt4W.name === "Mundra Adani CT 4 Parking",
  "both Mundra CT 4 yards use the same parking name",
);
assert(
  Boolean(mundraCt4E.polygon) &&
    mundraCt4E.polygon!.every(
      ([lat, lng], i) =>
        lat === MUNDRA_CT4_PARK_E_POLYGON[i][0] &&
        lng === MUNDRA_CT4_PARK_E_POLYGON[i][1],
    ),
  "Mundra CT 4 east corners match the measured Google Maps vertices",
);
assert(
  Boolean(mundraCt4W.polygon) &&
    mundraCt4W.polygon!.every(
      ([lat, lng], i) =>
        lat === MUNDRA_CT4_PARK_W_POLYGON[i][0] &&
        lng === MUNDRA_CT4_PARK_W_POLYGON[i][1],
    ),
  "Mundra CT 4 west corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(mundraCt4E.lat, mundraCt4E.lng, MUNDRA_CT4_PARK_E_POLYGON),
  "Mundra CT 4 east pin sits inside its parking outline",
);
assert(
  pointInFencePolygon(mundraCt4W.lat, mundraCt4W.lng, MUNDRA_CT4_PARK_W_POLYGON),
  "Mundra CT 4 west pin sits inside its parking outline",
);
assert(
  !pointInFencePolygon(mundraCt4E.lat, mundraCt4E.lng, MUNDRA_CT4_PARK_W_POLYGON),
  "Mundra CT 4 east yard does not overlap the west outline",
);
assert(
  !pointInFencePolygon(mundraCt4W.lat, mundraCt4W.lng, MUNDRA_CT4_PARK_E_POLYGON),
  "Mundra CT 4 west yard does not overlap the east outline",
);
assert(
  findNearestParkingPoint(mundraCt4E.lat, mundraCt4E.lng)?.point.id ===
    "mundra-ct4-parking",
  "GPS in the Mundra CT 4 east outline matches parking",
);
assert(
  findNearestParkingPoint(mundraCt4W.lat, mundraCt4W.lng)?.point.id ===
    "mundra-ct4-parking-w",
  "GPS in the Mundra CT 4 west outline matches parking",
);
assert(
  canonicalParkingName("Mundra Adani CT4 Parking 2") ===
    "Mundra Adani CT 4 Parking",
  "CT 4 parking labels map to one parking name",
);
const mundraMokha = LOADING_POINTS.find((p) => p.id === "mundra-mokha-parking")!;
assert(
  Boolean(mundraMokha.polygon) && (mundraMokha.polygon?.length ?? 0) === 4,
  "Mokha parking is the 4-corner Google Maps outline",
);
assert(
  Boolean(mundraMokha.polygon) &&
    mundraMokha.polygon!.every(
      ([lat, lng], i) =>
        lat === MUNDRA_MOKHA_PARK_POLYGON[i][0] &&
        lng === MUNDRA_MOKHA_PARK_POLYGON[i][1],
    ),
  "Mokha parking corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(
    mundraMokha.lat,
    mundraMokha.lng,
    MUNDRA_MOKHA_PARK_POLYGON,
  ),
  "Mokha parking pin sits inside the parking outline",
);
assert(
  findNearestParkingPoint(mundraMokha.lat, mundraMokha.lng)?.point.id ===
    "mundra-mokha-parking",
  "GPS in the Mokha parking outline matches parking",
);
const aegisKandlaPark = LOADING_POINTS.find(
  (p) => p.id === "kandla-aegis-parking",
)!;
assert(
  Boolean(aegisKandlaPark.polygon) &&
    (aegisKandlaPark.polygon?.length ?? 0) === 4,
  "Aegis Kandla parking is the 4-corner Google Maps outline",
);
assert(
  Boolean(aegisKandlaPark.polygon) &&
    aegisKandlaPark.polygon!.every(
      ([lat, lng], i) =>
        lat === AEGIS_KANDLA_PARK_POLYGON[i][0] &&
        lng === AEGIS_KANDLA_PARK_POLYGON[i][1],
    ),
  "Aegis Kandla parking corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(
    aegisKandlaPark.lat,
    aegisKandlaPark.lng,
    AEGIS_KANDLA_PARK_POLYGON,
  ),
  "Aegis Kandla parking pin sits inside the parking outline",
);
assert(
  findNearestParkingPoint(aegisKandlaPark.lat, aegisKandlaPark.lng)?.point
    .id === "kandla-aegis-parking",
  "GPS in the Aegis Kandla parking outline matches parking",
);
assert(
  !pointInFencePolygon(
    aegisKandlaPark.lat,
    aegisKandlaPark.lng,
    IOCL_PARK_POLYGON,
  ),
  "Aegis Kandla parking does not overlap IOCL parking",
);
const aegisKandlaLoad = LOADING_POINTS.find(
  (p) => p.id === "kandla-aegis-loading",
)!;
assert(
  LOADING_POINTS.filter(
    (p) => p.port === "KANDLA" && p.kind === "loading" && /aegis/i.test(p.name),
  ).length === 1,
  "Aegis Kandla loading 1 and 2 are merged into one yard",
);
assert(
  Boolean(aegisKandlaLoad.polygon) &&
    (aegisKandlaLoad.polygon?.length ?? 0) === 4,
  "Aegis Kandla loading is the 4-corner Google Maps outline",
);
assert(
  Boolean(aegisKandlaLoad.polygon) &&
    aegisKandlaLoad.polygon!.every(
      ([lat, lng], i) =>
        lat === AEGIS_KANDLA_LOAD_POLYGON[i][0] &&
        lng === AEGIS_KANDLA_LOAD_POLYGON[i][1],
    ),
  "Aegis Kandla loading corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(
    aegisKandlaLoad.lat,
    aegisKandlaLoad.lng,
    AEGIS_KANDLA_LOAD_POLYGON,
  ),
  "Aegis Kandla loading pin sits inside the loading outline",
);
assert(
  findNearestLoadingPoint(aegisKandlaLoad.lat, aegisKandlaLoad.lng)?.point
    .id === "kandla-aegis-loading",
  "GPS in the Aegis Kandla loading outline matches loading",
);
assert(
  !pointInFencePolygon(
    aegisKandlaLoad.lat,
    aegisKandlaLoad.lng,
    AEGIS_KANDLA_PARK_POLYGON,
  ),
  "Aegis Kandla loading does not overlap parking",
);
assert(
  !pointInFencePolygon(
    aegisKandlaPark.lat,
    aegisKandlaPark.lng,
    AEGIS_KANDLA_LOAD_POLYGON,
  ),
  "Aegis Kandla parking is outside the loading outline",
);
assert(
  canonicalLoadingName("Aegis Kandla Loading Point 1") ===
    "Aegis Kandla Loading Point" &&
    canonicalLoadingName("Aegis Kandla Loading Point 2") ===
      "Aegis Kandla Loading Point",
  "retired Aegis Kandla loading 1/2 labels map to the merged yard",
);
const aegisPipavavPark = LOADING_POINTS.find(
  (p) => p.id === "pipavav-aegis-parking",
)!;
assert(
  Boolean(aegisPipavavPark.polygon) &&
    (aegisPipavavPark.polygon?.length ?? 0) === 4,
  "Aegis Pipavav parking is the 4-corner Google Maps outline",
);
assert(
  Boolean(aegisPipavavPark.polygon) &&
    aegisPipavavPark.polygon!.every(
      ([lat, lng], i) =>
        lat === AEGIS_PIPAVAV_PARK_POLYGON[i][0] &&
        lng === AEGIS_PIPAVAV_PARK_POLYGON[i][1],
    ),
  "Aegis Pipavav parking corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(
    aegisPipavavPark.lat,
    aegisPipavavPark.lng,
    AEGIS_PIPAVAV_PARK_POLYGON,
  ),
  "Aegis Pipavav parking pin sits inside the parking outline",
);
assert(
  findNearestParkingPoint(aegisPipavavPark.lat, aegisPipavavPark.lng)?.point
    .id === "pipavav-aegis-parking",
  "GPS in the Aegis Pipavav parking outline matches parking",
);
const aegisPipavavLoad1 = LOADING_POINTS.find(
  (p) => p.id === "pipavav-aegis-load1",
)!;
assert(
  Boolean(aegisPipavavLoad1.polygon) &&
    (aegisPipavavLoad1.polygon?.length ?? 0) === 4,
  "Aegis Pipavav loading 1 is the 4-corner Google Maps outline",
);
assert(
  Boolean(aegisPipavavLoad1.polygon) &&
    aegisPipavavLoad1.polygon!.every(
      ([lat, lng], i) =>
        lat === AEGIS_PIPAVAV_LOAD1_POLYGON[i][0] &&
        lng === AEGIS_PIPAVAV_LOAD1_POLYGON[i][1],
    ),
  "Aegis Pipavav loading 1 corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(
    aegisPipavavLoad1.lat,
    aegisPipavavLoad1.lng,
    AEGIS_PIPAVAV_LOAD1_POLYGON,
  ),
  "Aegis Pipavav loading 1 pin sits inside the loading outline",
);
assert(
  findNearestLoadingPoint(aegisPipavavLoad1.lat, aegisPipavavLoad1.lng)?.point
    .id === "pipavav-aegis-load1",
  "GPS in the Aegis Pipavav loading 1 outline matches loading",
);
assert(
  !pointInFencePolygon(
    aegisPipavavLoad1.lat,
    aegisPipavavLoad1.lng,
    AEGIS_PIPAVAV_PARK_POLYGON,
  ),
  "Aegis Pipavav loading 1 does not overlap parking",
);
assert(
  !pointInFencePolygon(
    aegisPipavavPark.lat,
    aegisPipavavPark.lng,
    AEGIS_PIPAVAV_LOAD1_POLYGON,
  ),
  "Aegis Pipavav parking is outside loading 1",
);
const aegisPipavavLoad2 = LOADING_POINTS.find(
  (p) => p.id === "pipavav-aegis-load2",
)!;
assert(
  Boolean(aegisPipavavLoad2.polygon) &&
    (aegisPipavavLoad2.polygon?.length ?? 0) === 4,
  "Aegis Pipavav loading 2 is the 4-corner Google Maps outline",
);
assert(
  Boolean(aegisPipavavLoad2.polygon) &&
    aegisPipavavLoad2.polygon!.every(
      ([lat, lng], i) =>
        lat === AEGIS_PIPAVAV_LOAD2_POLYGON[i][0] &&
        lng === AEGIS_PIPAVAV_LOAD2_POLYGON[i][1],
    ),
  "Aegis Pipavav loading 2 corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(
    aegisPipavavLoad2.lat,
    aegisPipavavLoad2.lng,
    AEGIS_PIPAVAV_LOAD2_POLYGON,
  ),
  "Aegis Pipavav loading 2 pin sits inside the loading outline",
);
assert(
  findNearestLoadingPoint(aegisPipavavLoad2.lat, aegisPipavavLoad2.lng)?.point
    .id === "pipavav-aegis-load2",
  "GPS in the Aegis Pipavav loading 2 outline matches loading",
);
assert(
  !pointInFencePolygon(
    aegisPipavavLoad2.lat,
    aegisPipavavLoad2.lng,
    AEGIS_PIPAVAV_LOAD1_POLYGON,
  ),
  "Aegis Pipavav loading 2 does not overlap loading 1",
);
assert(
  !pointInFencePolygon(
    aegisPipavavLoad1.lat,
    aegisPipavavLoad1.lng,
    AEGIS_PIPAVAV_LOAD2_POLYGON,
  ),
  "Aegis Pipavav loading 1 does not overlap loading 2",
);
const shrejiPark = LOADING_POINTS.find((p) => p.id === "pipavav-shreji-parking")!;
assert(
  Boolean(shrejiPark.polygon) && (shrejiPark.polygon?.length ?? 0) === 6,
  "Shreji Pipavav parking is the 6-corner Google Maps outline",
);
assert(
  Boolean(shrejiPark.polygon) &&
    shrejiPark.polygon!.every(
      ([lat, lng], i) =>
        lat === SHREJI_PIPAVAV_PARK_POLYGON[i][0] &&
        lng === SHREJI_PIPAVAV_PARK_POLYGON[i][1],
    ),
  "Shreji Pipavav parking corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(shrejiPark.lat, shrejiPark.lng, SHREJI_PIPAVAV_PARK_POLYGON),
  "Shreji Pipavav parking pin sits inside the parking outline",
);
assert(
  findNearestParkingPoint(shrejiPark.lat, shrejiPark.lng)?.point.id ===
    "pipavav-shreji-parking",
  "GPS in the Shreji Pipavav parking outline matches parking",
);
const porbandar = LOADING_POINTS.find((p) => p.id === "porbandar-confidence")!;
assert(
  porbandar.kind === "loading",
  "Porbandar combined yard is a loading location",
);
assert(
  Boolean(porbandar.polygon) && (porbandar.polygon?.length ?? 0) === 4,
  "Porbandar is the 4-corner Google Maps outline",
);
assert(
  Boolean(porbandar.polygon) &&
    porbandar.polygon!.every(
      ([lat, lng], i) =>
        lat === PORBANDAR_LOAD_POLYGON[i][0] &&
        lng === PORBANDAR_LOAD_POLYGON[i][1],
    ),
  "Porbandar corners match the measured Google Maps vertices",
);
assert(
  pointInFencePolygon(porbandar.lat, porbandar.lng, PORBANDAR_LOAD_POLYGON),
  "Porbandar pin sits inside the loading outline",
);
assert(
  findNearestLoadingPoint(porbandar.lat, porbandar.lng)?.point.id ===
    "porbandar-confidence",
  "GPS in the Porbandar outline matches loading",
);
assert(
  !findNearestParkingPoint(porbandar.lat, porbandar.lng),
  "Porbandar outline is not parking",
);
const porbandarIn = nextStatus({
  prev: undefined,
  insideLoading: { point: porbandar, distanceM: 10 },
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0,
});
assert(porbandarIn.status === "LOADING", "GPS inside Porbandar outline → LOADING");
let porbandarLeave = porbandarIn;
porbandarLeave = nextStatus({
  prev: porbandarLeave,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 30_000,
});
porbandarLeave = nextStatus({
  prev: porbandarLeave,
  insideLoading: none,
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 60_000,
});
assert(
  porbandarLeave.status === "LOADED" && porbandarLeave.cargo === "LOADED",
  "leave Porbandar loading outline → filled",
);
const inLoadBox = nextStatus({
  prev: {
    status: "PARK",
    geofenceId: ioclParkPt.id,
    geofenceKind: "parking",
    enteredAt: t0,
    outsideStreak: 0,
    cargo: "EMPTY",
    lastPark: ioclParkPt.name,
  },
  insideLoading: { point: ioclLoad, distanceM: 20 },
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 65_000,
});
assert(inLoadBox.status === "LOADING", "inside IOCL loading outline → LOADING");

const ioclPark = { point: ioclParkPt, distanceM: 40 };
const atIoclLoad = nextStatus({
  prev: {
    status: "LOADED",
    geofenceId: null,
    geofenceKind: null,
    enteredAt: null,
    outsideStreak: 0,
    cargo: "LOADED",
    lastLoadedFrom: "Kandla IOCL Loading Point",
  },
  insideLoading: { point: ioclLoad, distanceM: 50 },
  insideParking: none,
  insideFactory: none,
  online: true,
  now: t0 + 70_000,
});
assert(
  atIoclLoad.status === "LOADING" && atIoclLoad.cargo === "EMPTY",
  "GPS inside IOCL loading outline → LOADING even after filling here",
);
const filledOther: TruckMemory = {
  status: "LOADED",
  geofenceId: null,
  geofenceKind: null,
  enteredAt: null,
  outsideStreak: 0,
  cargo: "LOADED",
  lastLoadedFrom: "Mundra Adani Loading Point",
};
const backEmpty = nextStatus({
  prev: filledOther,
  insideLoading: none,
  insideParking: ioclPark,
  insideFactory: none,
  online: true,
  now: t0 + 80_000,
});
assert(
  backEmpty.status === "PARK" && backEmpty.cargo === "EMPTY",
  "filled at Mundra then IOCL parking → PARK empty",
);
assert(
  samePortFacility(ioclParkPt, "Kandla IOCL Loading Point"),
  "IOCL parking matches IOCL loading yard",
);
const inBoxPark = nextStatus({
  prev: {
    ...filledOther,
    lastLoadedFrom: "Kandla IOCL Loading Point",
  },
  insideLoading: none,
  insideParking: ioclPark,
  insideFactory: none,
  online: true,
  now: t0 + 80_000,
});
assert(
  inBoxPark.status === "PARK" && inBoxPark.cargo === "EMPTY",
  "inside IOCL parking box → PARK even after filling here",
);

const staleGps = nextStatus({
  prev: undefined,
  insideLoading: { point: ioclLoad, distanceM: 20 },
  insideParking: none,
  insideFactory: none,
  online: false,
  now: t0 + 90_000,
});
assert(
  staleGps.status === "LOADING",
  "stale GPS on a loading pin still LOADING (no OFFLINE status)",
);

const square: Array<[number, number]> = [
  [23.0355, 70.1940],
  [23.0355, 70.1950],
  [23.0365, 70.1950],
  [23.0365, 70.1940],
];
assert(
  pointInFencePolygon(23.0360, 70.1945, square),
  "GPS inside a measured 4-corner outline is inside",
);
assert(
  !pointInFencePolygon(23.0370, 70.1945, square),
  "GPS outside a measured 4-corner outline is outside",
);
assert(
  canonicalParkingName("Kandla IOCL Parking Gate 1") === "Kandla IOCL Parking" &&
    canonicalParkingName("Kandla IOCL Parking 2") === "Kandla IOCL Parking",
  "retired IOCL Gate 1/2 labels map to the whole-yard parking name",
);

if (fails) {
  console.error(`${fails} failed`);
  process.exit(1);
}
console.log("All passed");
