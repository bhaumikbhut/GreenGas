import type { AutoStatus } from "./geofence";

/** One human label per truck — status already implies cargo. */
export function statusLabel(status: AutoStatus | string): string {
  switch (status) {
    case "PARK":
      return "PARK";
    case "LOADING":
      return "LOADING";
    case "LOADED":
      return "FILLED ROAD";
    case "AT_FACTORY":
      return "AT FACTORY · FILLED";
    case "EMPTY":
    case "ON_ROAD":
    case "OFFLINE":
      return "EMPTY";
    default:
      return String(status);
  }
}

/** Short badge text (no cargo duplicate). */
export function statusBadge(status: AutoStatus | string): string {
  if (status === "AT_FACTORY") return "FACTORY";
  if (status === "PARK") return "PARK";
  if (status === "ON_ROAD" || status === "EMPTY" || status === "OFFLINE") return "EMPTY";
  if (status === "LOADED") return "FILLED";
  return String(status);
}
