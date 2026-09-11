export type LoadingPoint = {
  id: string;
  name: string;
  port: string;
  lat: number;
  lng: number;
};

/** Loading terminals from Jalpesh map pins (500m geofence default). */
export const LOADING_POINTS: LoadingPoint[] = [
  {
    id: "pipavav-1",
    name: "Pipavav Port",
    port: "PIPAVAV",
    lat: 20.936492,
    lng: 71.496157,
  },
  {
    id: "pipavav-2",
    name: "Pipavav / Rajula",
    port: "PIPAVAV",
    lat: 20.985285,
    lng: 71.511515,
  },
  {
    id: "porbandar-1",
    name: "Porbandar",
    port: "PORBANDER",
    lat: 21.652871,
    lng: 69.569653,
  },
  {
    id: "kandla-1",
    name: "Kandla area A",
    port: "KANDLA",
    lat: 22.343957,
    lng: 69.76512,
  },
  {
    id: "kandla-2",
    name: "Kandla area B",
    port: "KANDLA",
    lat: 22.355751,
    lng: 69.77233,
  },
  {
    id: "kandla-3",
    name: "Kandla area C",
    port: "KANDLA",
    lat: 22.354288,
    lng: 69.773495,
  },
  {
    id: "kandla-4",
    name: "Kandla area D",
    port: "KANDLA",
    lat: 22.345424,
    lng: 69.870554,
  },
  {
    id: "dahej-1",
    name: "Dahej A",
    port: "DAHEJ",
    lat: 21.690044,
    lng: 72.5399,
  },
  {
    id: "dahej-2",
    name: "Dahej B",
    port: "DAHEJ",
    lat: 21.69249,
    lng: 72.539973,
  },
];
