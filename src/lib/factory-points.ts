export type FactoryPoint = {
  id: string;
  name: string;
  /** Optional OMC / company label */
  company?: string;
  lat: number;
  lng: number;
};

/**
 * Destination factories (unload). Add pins from Google Maps links.
 * Until this list has entries, trucks stay LOADED after leaving port
 * (cannot flip to EMPTY).
 *
 * Example:
 * { id: "factory-1", name: "IOCL Depot X", company: "IOCL", lat: 23.0, lng: 72.5 }
 */
export const FACTORY_POINTS: FactoryPoint[] = [
  // Paste factory coordinates here (or share Maps links and we will fill these).
];
