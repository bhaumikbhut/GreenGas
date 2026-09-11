export type FactoryPoint = {
  id: string;
  name: string;
  /** Optional OMC / company label */
  company?: string;
  lat: number;
  lng: number;
  /** Override default GEOFENCE_RADIUS_M for large industrial areas */
  radiusM?: number;
};

/**
 * Destination unload areas (from loading-sheet LOCATION + OSM geocode).
 * Company-level street addresses are rarely on OpenStreetMap, so these are
 * area hubs (Morbi ceramic belt, Wankaner, Kutch locations, etc.).
 * Share Google Maps pins later for exact factory yards.
 */
export const FACTORY_POINTS: FactoryPoint[] = [
  {
    id: "hub-morbi",
    name: "Morbi ceramic hub",
    company: "Morbi",
    lat: 22.800396,
    lng: 70.886232,
    radiusM: 8000,
  },
  {
    id: "hub-wankaner",
    name: "Wankaner",
    company: "Wakaner",
    lat: 22.615393,
    lng: 70.949562,
    radiusM: 4000,
  },
  {
    id: "hub-maliya",
    name: "Maliya",
    company: "Maliya",
    lat: 23.093175,
    lng: 70.759946,
    radiusM: 4000,
  },
  {
    id: "hub-khedoi",
    name: "Khedoi",
    company: "Khedoi",
    lat: 23.062596,
    lng: 69.918559,
    radiusM: 3000,
  },
  {
    id: "hub-mokha",
    name: "Mokha (Mundra)",
    company: "Mokha",
    lat: 22.944542,
    lng: 69.818029,
    radiusM: 3000,
  },
  {
    id: "hub-padana",
    name: "Padana",
    company: "Padana",
    lat: 22.72845,
    lng: 70.555912,
    radiusM: 3000,
  },
  {
    id: "hub-gandhidham",
    name: "Gandhidham",
    company: "Gandhidham",
    lat: 23.071874,
    lng: 70.131715,
    radiusM: 5000,
  },
  {
    id: "hub-sayla",
    name: "Sayla",
    company: "Sayla",
    lat: 22.549431,
    lng: 71.482084,
    radiusM: 3000,
  },
  {
    id: "hub-khirai",
    name: "Khirai",
    company: "Khirai",
    lat: 23.465049,
    lng: 70.652597,
    radiusM: 3000,
  },
  {
    id: "hub-surajbari",
    name: "Surajbari",
    company: "Surjbari",
    lat: 23.225281,
    lng: 70.698298,
    radiusM: 3000,
  },
];
