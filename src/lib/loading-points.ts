export type PortSiteKind = "loading" | "parking";

export type LoadingPoint = {
  id: string;
  name: string;
  port: string;
  lat: number;
  lng: number;
  /** Geofence radius in meters (from field ops / Neel). */
  radiusM: number;
  kind: PortSiteKind;
};

/**
 * Port loading + parking pins from Neel Gadhiya (Sep 2026).
 * Each site has its own radius — do not use a global 500 m default.
 */
export const LOADING_POINTS: LoadingPoint[] = [
  // —— Mundra Adani ——
  {
    id: "mundra-mokha-parking",
    name: "Mundra Adani Mokha Parking",
    port: "MUNDRA",
    lat: 22.924155,
    lng: 69.792248,
    radiusM: 500,
    kind: "parking",
  },
  {
    id: "mundra-ct4-parking",
    name: "Mundra Adani CT 4 Parking",
    port: "MUNDRA",
    lat: 22.753098,
    lng: 69.680227,
    radiusM: 200,
    kind: "parking",
  },
  {
    id: "mundra-loading",
    name: "Mundra Adani Loading Point",
    port: "MUNDRA",
    lat: 22.736042,
    lng: 69.707443,
    radiusM: 75,
    kind: "loading",
  },
  // —— Kandla IOCL ——
  {
    id: "kandla-iocl-loading",
    name: "Kandla IOCL Loading Point",
    port: "KANDLA",
    lat: 23.034444,
    lng: 70.193498,
    radiusM: 140,
    kind: "loading",
  },
  {
    id: "kandla-iocl-gate1",
    name: "Kandla IOCL Parking Gate 1",
    port: "KANDLA",
    lat: 23.036486,
    lng: 70.193519,
    radiusM: 100,
    kind: "parking",
  },
  {
    id: "kandla-iocl-gate2",
    name: "Kandla IOCL Parking Gate 2",
    port: "KANDLA",
    lat: 23.03602,
    lng: 70.195551,
    radiusM: 100,
    kind: "parking",
  },
  // —— Aegis Pipavav ——
  {
    id: "pipavav-aegis-load1",
    name: "Aegis Pipavav Loading Point 1",
    port: "PIPAVAV",
    lat: 20.93516,
    lng: 71.496846,
    radiusM: 100,
    kind: "loading",
  },
  {
    id: "pipavav-aegis-load2",
    name: "Aegis Pipavav Loading Point 2",
    port: "PIPAVAV",
    lat: 20.935888,
    lng: 71.498414,
    radiusM: 100,
    kind: "loading",
  },
  {
    id: "pipavav-aegis-parking",
    name: "Aegis Pipavav Parking",
    port: "PIPAVAV",
    lat: 20.936296,
    lng: 71.496275,
    radiusM: 80,
    kind: "parking",
  },
  {
    id: "pipavav-shreji-parking",
    name: "Shreji Parking Aegis Pipavav",
    port: "PIPAVAV",
    lat: 20.985982,
    lng: 71.51144,
    radiusM: 150,
    kind: "parking",
  },
  // —— Aegis Kandla ——
  {
    id: "kandla-aegis-parking",
    name: "Aegis Kandla Parking",
    port: "KANDLA",
    lat: 23.026978,
    lng: 70.196829,
    radiusM: 150,
    kind: "parking",
  },
  {
    id: "kandla-aegis-load1",
    name: "Aegis Kandla Loading Point 1",
    port: "KANDLA",
    lat: 23.028229,
    lng: 70.20123,
    radiusM: 35,
    kind: "loading",
  },
  {
    id: "kandla-aegis-load2",
    name: "Aegis Kandla Loading Point 2",
    port: "KANDLA",
    lat: 23.028769,
    lng: 70.199516,
    radiusM: 100,
    kind: "loading",
  },
  // —— Dahej GTPCL ——
  {
    id: "dahej-gtpcl-parking",
    name: "Dahej GTPCL Parking",
    port: "DAHEJ",
    lat: 21.690055,
    lng: 72.539483,
    radiusM: 80,
    kind: "parking",
  },
  {
    id: "dahej-gtpcl-load1",
    name: "Dahej GTPCL Loading Point 1",
    port: "DAHEJ",
    lat: 21.692484,
    lng: 72.53928,
    // Was 25m — too tight; ProTrack often skipped the bay → false EMPTY ROAD.
    radiusM: 120,
    kind: "loading",
  },
  {
    id: "dahej-gtpcl-load2",
    name: "Dahej GTPCL Loading Point 2",
    port: "DAHEJ",
    lat: 21.692309,
    lng: 72.540375,
    radiusM: 120,
    kind: "loading",
  },
  // —— Porbandar Confidence ——
  {
    id: "porbandar-confidence",
    name: "Porbandar Confidence Loading & Parking",
    port: "PORBANDAR",
    lat: 21.652721,
    lng: 69.569991,
    radiusM: 115,
    kind: "loading",
  },
];

export const PARKING_POINTS = LOADING_POINTS.filter((p) => p.kind === "parking");
export const PORT_LOADING_POINTS = LOADING_POINTS.filter(
  (p) => p.kind === "loading",
);
