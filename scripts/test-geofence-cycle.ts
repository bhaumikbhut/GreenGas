import {
  MIN_LOADING_DWELL_MS,
  nextStatus,
  type TruckMemory,
} from "../src/lib/geofence";
import type { LoadingPoint } from "../src/lib/loading-points";
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

// Leave too soon (no dwell) → not LOADED, not EMPTY
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
  early.status === "ON_ROAD" && early.cargo === "EMPTY",
  "short visit → ON_ROAD not EMPTY/LOADED",
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
assert(bad.status === "PARK" && bad.cargo === "EMPTY", "false LOADED at parking → PARK");

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
assert(parkLeave.status === "ON_ROAD", "leave park → ON_ROAD not EMPTY");

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

if (fails) {
  console.error(`${fails} failed`);
  process.exit(1);
}
console.log("All passed");
