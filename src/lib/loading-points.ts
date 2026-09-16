export type PortSiteKind = "loading" | "parking";

/**
 * How to measure a yard (accurate):
 * 1. Google Maps → right-click each corner of the lot → copy lat, lng.
 * 2. Put those corners on `polygon` in order around the fence (4+ points).
 * Area / perimeter alone cannot rebuild the outline — do not use those.
 */
export type FencePolygon = [lat: number, lng: number][];

/** Oriented rectangle — only when corner coordinates are not available. */
export type FenceBox = {
  lat: number;
  lng: number;
  /** Meters along heading (long side). */
  lengthM: number;
  /** Meters perpendicular to heading (short side). */
  widthM: number;
  /** Bearing of the long axis, degrees clockwise from north. */
  headingDeg: number;
};

export type LoadingPoint = {
  id: string;
  name: string;
  port: string;
  lat: number;
  lng: number;
  /** Geofence radius in meters. Ignored when `polygon` or `box` is set. */
  radiusM: number;
  kind: PortSiteKind;
  /** Google Maps outline. Preferred — GPS and the map use this exact shape. */
  polygon?: FencePolygon;
  /** Fitted rectangle. Used only when `polygon` is missing. */
  box?: FenceBox;
};

/**
 * IOCL parking — Google Maps corners (clockwise from SE), Sep 2026.
 * GPS and map use this outline; do not fit a heading/width rectangle.
 */
export const IOCL_PARK_POLYGON: FencePolygon = [
  [23.034877, 70.196566],
  [23.035726, 70.196791],
  [23.036782, 70.192135],
  [23.035943, 70.191985],
];

const IOCL_PARK_CENTER = {
  lat:
    IOCL_PARK_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    IOCL_PARK_POLYGON.length,
  lng:
    IOCL_PARK_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    IOCL_PARK_POLYGON.length,
};

/**
 * IOCL loading — Google Maps corners (clockwise from NW), Sep 2026.
 * GPS inside this outline is LOADING.
 */
export const IOCL_LOAD_POLYGON: FencePolygon = [
  [23.035388, 70.193159],
  [23.035111, 70.194068],
  [23.033687, 70.193635],
  [23.033892, 70.192767],
];

const IOCL_LOAD_CENTER = {
  lat:
    IOCL_LOAD_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    IOCL_LOAD_POLYGON.length,
  lng:
    IOCL_LOAD_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    IOCL_LOAD_POLYGON.length,
};

/**
 * Dahej GTPCL parking — Google Maps corners (clockwise from NW), Sep 2026.
 */
export const DAHEJ_PARK_POLYGON: FencePolygon = [
  [21.691151, 72.538644],
  [21.690622, 72.540529],
  [21.689476, 72.540302],
  [21.689695, 72.538453],
];

const DAHEJ_PARK_CENTER = {
  lat:
    DAHEJ_PARK_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    DAHEJ_PARK_POLYGON.length,
  lng:
    DAHEJ_PARK_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    DAHEJ_PARK_POLYGON.length,
};

/**
 * Dahej GTPCL loading point 1 — Google Maps corners (clockwise from NW).
 * GPS inside this outline is LOADING.
 */
export const DAHEJ_LOAD1_POLYGON: FencePolygon = [
  [21.692865, 72.538887],
  [21.692683, 72.539819],
  [21.692115, 72.539695],
  [21.692297, 72.538782],
];

const DAHEJ_LOAD1_CENTER = {
  lat:
    DAHEJ_LOAD1_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    DAHEJ_LOAD1_POLYGON.length,
  lng:
    DAHEJ_LOAD1_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    DAHEJ_LOAD1_POLYGON.length,
};

/**
 * Dahej GTPCL loading point 2 — Google Maps corners (clockwise from NW).
 * GPS inside this outline is LOADING.
 */
export const DAHEJ_LOAD2_POLYGON: FencePolygon = [
  [21.692648, 72.540108],
  [21.692553, 72.540924],
  [21.691950, 72.540741],
  [21.692129, 72.539980],
];

const DAHEJ_LOAD2_CENTER = {
  lat:
    DAHEJ_LOAD2_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    DAHEJ_LOAD2_POLYGON.length,
  lng:
    DAHEJ_LOAD2_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    DAHEJ_LOAD2_POLYGON.length,
};

/**
 * Mundra Adani loading — Google Maps corners (clockwise from NW).
 * GPS inside this outline is LOADING.
 */
export const MUNDRA_LOAD_POLYGON: FencePolygon = [
  [22.737252, 69.707197],
  [22.737060, 69.707927],
  [22.735363, 69.707698],
  [22.735448, 69.706932],
];

const MUNDRA_LOAD_CENTER = {
  lat:
    MUNDRA_LOAD_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    MUNDRA_LOAD_POLYGON.length,
  lng:
    MUNDRA_LOAD_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    MUNDRA_LOAD_POLYGON.length,
};

/**
 * Mundra Adani CT 4 parking — east yard (clockwise from NW).
 * GPS inside this outline is PARK. Same lot as the west yard.
 */
export const MUNDRA_CT4_PARK_E_POLYGON: FencePolygon = [
  [22.753601, 69.680338],
  [22.753775, 69.680871],
  [22.752894, 69.680762],
  [22.752863, 69.680408],
];

const MUNDRA_CT4_PARK_E_CENTER = {
  lat:
    MUNDRA_CT4_PARK_E_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    MUNDRA_CT4_PARK_E_POLYGON.length,
  lng:
    MUNDRA_CT4_PARK_E_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    MUNDRA_CT4_PARK_E_POLYGON.length,
};

/**
 * Mundra Adani CT 4 parking — west yard (clockwise from NW).
 * GPS inside this outline is PARK. Same lot as the east yard.
 */
export const MUNDRA_CT4_PARK_W_POLYGON: FencePolygon = [
  [22.754904, 69.678196],
  [22.754898, 69.679816],
  [22.753477, 69.679870],
  [22.753984, 69.677997],
];

const MUNDRA_CT4_PARK_W_CENTER = {
  lat:
    MUNDRA_CT4_PARK_W_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    MUNDRA_CT4_PARK_W_POLYGON.length,
  lng:
    MUNDRA_CT4_PARK_W_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    MUNDRA_CT4_PARK_W_POLYGON.length,
};

const MUNDRA_CT4_PARKING_NAME = "Mundra Adani CT 4 Parking";

/**
 * Mundra Adani Mokha parking — Google Maps corners (clockwise from N).
 * GPS inside this outline is PARK.
 */
export const MUNDRA_MOKHA_PARK_POLYGON: FencePolygon = [
  [22.925847, 69.792144],
  [22.923376, 69.793099],
  [22.923481, 69.789916],
];

const MUNDRA_MOKHA_PARK_CENTER = {
  lat:
    MUNDRA_MOKHA_PARK_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    MUNDRA_MOKHA_PARK_POLYGON.length,
  lng:
    MUNDRA_MOKHA_PARK_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    MUNDRA_MOKHA_PARK_POLYGON.length,
};

export const LOADING_POINTS: LoadingPoint[] = [
  // —— Mundra Adani ——
  {
    id: "mundra-mokha-parking",
    name: "Mundra Adani Mokha Parking",
    port: "MUNDRA",
    lat: MUNDRA_MOKHA_PARK_CENTER.lat,
    lng: MUNDRA_MOKHA_PARK_CENTER.lng,
    radiusM: 150,
    kind: "parking",
    polygon: MUNDRA_MOKHA_PARK_POLYGON,
  },
  {
    id: "mundra-ct4-parking",
    name: MUNDRA_CT4_PARKING_NAME,
    port: "MUNDRA",
    lat: MUNDRA_CT4_PARK_E_CENTER.lat,
    lng: MUNDRA_CT4_PARK_E_CENTER.lng,
    radiusM: 40,
    kind: "parking",
    polygon: MUNDRA_CT4_PARK_E_POLYGON,
  },
  {
    id: "mundra-ct4-parking-w",
    name: MUNDRA_CT4_PARKING_NAME,
    port: "MUNDRA",
    lat: MUNDRA_CT4_PARK_W_CENTER.lat,
    lng: MUNDRA_CT4_PARK_W_CENTER.lng,
    radiusM: 40,
    kind: "parking",
    polygon: MUNDRA_CT4_PARK_W_POLYGON,
  },
  {
    id: "mundra-loading",
    name: "Mundra Adani Loading Point",
    port: "MUNDRA",
    lat: MUNDRA_LOAD_CENTER.lat,
    lng: MUNDRA_LOAD_CENTER.lng,
    radiusM: 38,
    kind: "loading",
    polygon: MUNDRA_LOAD_POLYGON,
  },
  // —— Kandla IOCL ——
  {
    id: "kandla-iocl-loading",
    name: "Kandla IOCL Loading Point",
    port: "KANDLA",
    lat: IOCL_LOAD_CENTER.lat,
    lng: IOCL_LOAD_CENTER.lng,
    radiusM: 70,
    kind: "loading",
    polygon: IOCL_LOAD_POLYGON,
  },
  {
    id: "kandla-iocl-parking",
    name: "Kandla IOCL Parking",
    port: "KANDLA",
    lat: IOCL_PARK_CENTER.lat,
    lng: IOCL_PARK_CENTER.lng,
    radiusM: 75,
    kind: "parking",
    polygon: IOCL_PARK_POLYGON,
  },
  // —— Aegis Pipavav ——
  {
    id: "pipavav-aegis-load1",
    name: "Aegis Pipavav Loading Point 1",
    port: "PIPAVAV",
    lat: 20.93516,
    lng: 71.496846,
    radiusM: 50,
    kind: "loading",
  },
  {
    id: "pipavav-aegis-load2",
    name: "Aegis Pipavav Loading Point 2",
    port: "PIPAVAV",
    lat: 20.935888,
    lng: 71.498414,
    radiusM: 50,
    kind: "loading",
  },
  {
    id: "pipavav-aegis-parking",
    name: "Aegis Pipavav Parking",
    port: "PIPAVAV",
    lat: 20.936296,
    lng: 71.496275,
    radiusM: 40,
    kind: "parking",
  },
  {
    id: "pipavav-shreji-parking",
    name: "Shreji Parking Aegis Pipavav",
    port: "PIPAVAV",
    lat: 20.985982,
    lng: 71.51144,
    radiusM: 75,
    kind: "parking",
  },
  // —— Aegis Kandla ——
  {
    id: "kandla-aegis-parking",
    name: "Aegis Kandla Parking",
    port: "KANDLA",
    lat: 23.026978,
    lng: 70.196829,
    radiusM: 75,
    kind: "parking",
  },
  {
    id: "kandla-aegis-load1",
    name: "Aegis Kandla Loading Point 1",
    port: "KANDLA",
    lat: 23.028229,
    lng: 70.20123,
    radiusM: 18,
    kind: "loading",
  },
  {
    id: "kandla-aegis-load2",
    name: "Aegis Kandla Loading Point 2",
    port: "KANDLA",
    lat: 23.028769,
    lng: 70.199516,
    radiusM: 50,
    kind: "loading",
  },
  // —— Dahej GTPCL ——
  {
    id: "dahej-gtpcl-parking",
    name: "Dahej GTPCL Parking",
    port: "DAHEJ",
    lat: DAHEJ_PARK_CENTER.lat,
    lng: DAHEJ_PARK_CENTER.lng,
    radiusM: 40,
    kind: "parking",
    polygon: DAHEJ_PARK_POLYGON,
  },
  {
    id: "dahej-gtpcl-load1",
    name: "Dahej GTPCL Loading Point 1",
    port: "DAHEJ",
    lat: DAHEJ_LOAD1_CENTER.lat,
    lng: DAHEJ_LOAD1_CENTER.lng,
    radiusM: 60,
    kind: "loading",
    polygon: DAHEJ_LOAD1_POLYGON,
  },
  {
    id: "dahej-gtpcl-load2",
    name: "Dahej GTPCL Loading Point 2",
    port: "DAHEJ",
    lat: DAHEJ_LOAD2_CENTER.lat,
    lng: DAHEJ_LOAD2_CENTER.lng,
    radiusM: 60,
    kind: "loading",
    polygon: DAHEJ_LOAD2_POLYGON,
  },
  // —— Porbandar Confidence ——
  {
    id: "porbandar-confidence",
    name: "Porbandar Confidence Loading & Parking",
    port: "PORBANDAR",
    lat: 21.652721,
    lng: 69.569991,
    radiusM: 58,
    kind: "loading",
  },
];

export const PARKING_POINTS = LOADING_POINTS.filter((p) => p.kind === "parking");
export const PORT_LOADING_POINTS = LOADING_POINTS.filter(
  (p) => p.kind === "loading",
);

const IOCL_PARKING_NAME = "Kandla IOCL Parking";

/** Retired Gate 1/2 labels → the current whole-yard parking name. */
export function canonicalParkingName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const n = name.trim();
  if (/iocl/i.test(n) && /gate\s*[12]/i.test(n)) return IOCL_PARKING_NAME;
  if (/iocl/i.test(n) && /parking\s*[12]\b/i.test(n)) return IOCL_PARKING_NAME;
  if (/mundra/i.test(n) && /ct\s*4/i.test(n) && /park/i.test(n)) {
    return MUNDRA_CT4_PARKING_NAME;
  }
  return n;
}
