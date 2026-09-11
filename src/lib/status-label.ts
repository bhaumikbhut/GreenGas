import type { AutoStatus } from "./geofence";

/** One human label per truck — status already implies cargo. */
export function statusLabel(status: AutoStatus | string): string {
  switch (status) {
    case "PARK":
      return "PARK";
    case "LOADING":
      return "LOADING";
    case "LOADED":
      return "LOADED · FILLED";
    case "AT_FACTORY":
      return "AT FACTORY · FILLED";
    case "EMPTY":
      return "EMPTY";
    case "OFFLINE":
      return "OFFLINE";
    default:
      return String(status);
  }
}

/** Short badge text (no cargo duplicate). */
export function statusBadge(status: AutoStatus | string): string {
  if (status === "AT_FACTORY") return "FACTORY";
  if (status === "PARK") return "PARK";
  return String(status);
}
