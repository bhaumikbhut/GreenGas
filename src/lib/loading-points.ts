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
  [22.925993, 69.792409],
  [22.923878, 69.794233],
  [22.922663, 69.792066],
  [22.923414, 69.789695],
];

const MUNDRA_MOKHA_PARK_CENTER = {
  lat:
    MUNDRA_MOKHA_PARK_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    MUNDRA_MOKHA_PARK_POLYGON.length,
  lng:
    MUNDRA_MOKHA_PARK_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    MUNDRA_MOKHA_PARK_POLYGON.length,
};

/**
 * Aegis Kandla parking — Google Maps corners (clockwise from NW).
 * GPS inside this outline is PARK.
 */
export const AEGIS_KANDLA_PARK_POLYGON: FencePolygon = [
  [23.027790, 70.195616],
  [23.027151, 70.198367],
  [23.025856, 70.197420],
  [23.027109, 70.195381],
];

const AEGIS_KANDLA_PARK_CENTER = {
  lat:
    AEGIS_KANDLA_PARK_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    AEGIS_KANDLA_PARK_POLYGON.length,
  lng:
    AEGIS_KANDLA_PARK_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    AEGIS_KANDLA_PARK_POLYGON.length,
};

/**
 * Aegis Kandla loading — Google Maps corners (clockwise from NW).
 * One yard covering former loading points 1 and 2. GPS inside is LOADING.
 */
export const AEGIS_KANDLA_LOAD_POLYGON: FencePolygon = [
  [23.029028, 70.199460],
  [23.028643, 70.201471],
  [23.027873, 70.201262],
  [23.028401, 70.199277],
];

const AEGIS_KANDLA_LOAD_CENTER = {
  lat:
    AEGIS_KANDLA_LOAD_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    AEGIS_KANDLA_LOAD_POLYGON.length,
  lng:
    AEGIS_KANDLA_LOAD_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    AEGIS_KANDLA_LOAD_POLYGON.length,
};

const AEGIS_KANDLA_LOADING_NAME = "Aegis Kandla Loading Point";

/**
 * Aegis Pipavav parking — Google Maps corners (clockwise from N).
 * GPS inside this outline is PARK.
 */
export const AEGIS_PIPAVAV_PARK_POLYGON: FencePolygon = [
  [20.936947, 71.495772],
  [20.936429, 71.496519],
  [20.936014, 71.496071],
  [20.936596, 71.495292],
];

const AEGIS_PIPAVAV_PARK_CENTER = {
  lat:
    AEGIS_PIPAVAV_PARK_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    AEGIS_PIPAVAV_PARK_POLYGON.length,
  lng:
    AEGIS_PIPAVAV_PARK_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    AEGIS_PIPAVAV_PARK_POLYGON.length,
};

/**
 * Aegis Pipavav loading point 1 — Google Maps corners (clockwise from N).
 * GPS inside this outline is LOADING.
 */
export const AEGIS_PIPAVAV_LOAD1_POLYGON: FencePolygon = [
  [20.935431, 71.496895],
  [20.935242, 71.497118],
  [20.934919, 71.496772],
  [20.935138, 71.496519],
];

const AEGIS_PIPAVAV_LOAD1_CENTER = {
  lat:
    AEGIS_PIPAVAV_LOAD1_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    AEGIS_PIPAVAV_LOAD1_POLYGON.length,
  lng:
    AEGIS_PIPAVAV_LOAD1_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    AEGIS_PIPAVAV_LOAD1_POLYGON.length,
};

/**
 * Aegis Pipavav loading point 2 — Google Maps corners (clockwise from N).
 * GPS inside this outline is LOADING.
 */
export const AEGIS_PIPAVAV_LOAD2_POLYGON: FencePolygon = [
  [20.936229, 71.498261],
  [20.935863, 71.498739],
  [20.935522, 71.498562],
  [20.935998, 71.497966],
];

const AEGIS_PIPAVAV_LOAD2_CENTER = {
  lat:
    AEGIS_PIPAVAV_LOAD2_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    AEGIS_PIPAVAV_LOAD2_POLYGON.length,
  lng:
    AEGIS_PIPAVAV_LOAD2_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    AEGIS_PIPAVAV_LOAD2_POLYGON.length,
};

/**
 * Shreji parking Aegis Pipavav — Google Maps corners (clockwise from NW).
 * GPS inside this outline is PARK.
 */
export const SHREJI_PIPAVAV_PARK_POLYGON: FencePolygon = [
  [20.987817, 71.509719],
  [20.987745, 71.511007],
  [20.986494, 71.511365],
  [20.986899, 71.512615],
  [20.985396, 71.513162],
  [20.985172, 71.510114],
];

const SHREJI_PIPAVAV_PARK_CENTER = {
  lat:
    SHREJI_PIPAVAV_PARK_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    SHREJI_PIPAVAV_PARK_POLYGON.length,
  lng:
    SHREJI_PIPAVAV_PARK_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    SHREJI_PIPAVAV_PARK_POLYGON.length,
};

/**
 * Porbandar Confidence — one yard for parking and loading (clockwise from N).
 * GPS inside this outline is LOADING. Leave it → filled.
 */
export const PORBANDAR_LOAD_POLYGON: FencePolygon = [
  [21.654215, 69.570169],
  [21.652923, 69.571327],
  [21.652163, 69.569115],
  [21.652722, 69.568291],
];

const PORBANDAR_LOAD_CENTER = {
  lat:
    PORBANDAR_LOAD_POLYGON.reduce((s, [lat]) => s + lat, 0) /
    PORBANDAR_LOAD_POLYGON.length,
  lng:
    PORBANDAR_LOAD_POLYGON.reduce((s, [, lng]) => s + lng, 0) /
    PORBANDAR_LOAD_POLYGON.length,
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
    lat: AEGIS_PIPAVAV_LOAD1_CENTER.lat,
    lng: AEGIS_PIPAVAV_LOAD1_CENTER.lng,
    radiusM: 30,
    kind: "loading",
    polygon: AEGIS_PIPAVAV_LOAD1_POLYGON,
  },
  {
    id: "pipavav-aegis-load2",
    name: "Aegis Pipavav Loading Point 2",
    port: "PIPAVAV",
    lat: AEGIS_PIPAVAV_LOAD2_CENTER.lat,
    lng: AEGIS_PIPAVAV_LOAD2_CENTER.lng,
    radiusM: 30,
    kind: "loading",
    polygon: AEGIS_PIPAVAV_LOAD2_POLYGON,
  },
  {
    id: "pipavav-aegis-parking",
    name: "Aegis Pipavav Parking",
    port: "PIPAVAV",
    lat: AEGIS_PIPAVAV_PARK_CENTER.lat,
    lng: AEGIS_PIPAVAV_PARK_CENTER.lng,
    radiusM: 40,
    kind: "parking",
    polygon: AEGIS_PIPAVAV_PARK_POLYGON,
  },
  {
    id: "pipavav-shreji-parking",
    name: "Shreji Parking Aegis Pipavav",
    port: "PIPAVAV",
    lat: SHREJI_PIPAVAV_PARK_CENTER.lat,
    lng: SHREJI_PIPAVAV_PARK_CENTER.lng,
    radiusM: 75,
    kind: "parking",
    polygon: SHREJI_PIPAVAV_PARK_POLYGON,
  },
  // —— Aegis Kandla ——
  {
    id: "kandla-aegis-parking",
    name: "Aegis Kandla Parking",
    port: "KANDLA",
    lat: AEGIS_KANDLA_PARK_CENTER.lat,
    lng: AEGIS_KANDLA_PARK_CENTER.lng,
    radiusM: 40,
    kind: "parking",
    polygon: AEGIS_KANDLA_PARK_POLYGON,
  },
  {
    id: "kandla-aegis-loading",
    name: AEGIS_KANDLA_LOADING_NAME,
    port: "KANDLA",
    lat: AEGIS_KANDLA_LOAD_CENTER.lat,
    lng: AEGIS_KANDLA_LOAD_CENTER.lng,
    radiusM: 40,
    kind: "loading",
    polygon: AEGIS_KANDLA_LOAD_POLYGON,
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
    lat: PORBANDAR_LOAD_CENTER.lat,
    lng: PORBANDAR_LOAD_CENTER.lng,
    radiusM: 58,
    kind: "loading",
    polygon: PORBANDAR_LOAD_POLYGON,
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

/** Retired Aegis Kandla Loading Point 1/2 → the merged yard name. */
export function canonicalLoadingName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const n = name.trim();
  if (/aegis/i.test(n) && /kandla/i.test(n) && /load/i.test(n)) {
    return AEGIS_KANDLA_LOADING_NAME;
  }
  return n;
}
