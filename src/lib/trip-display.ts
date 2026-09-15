export type TripStatus = "IN_TRANSIT" | "AT_FACTORY" | "DELIVERED";

export type TripTimes = {
  status: TripStatus;
  loadedAt: string | null | undefined;
  arrivedAt: string | null | undefined;
  departedAt: string | null | undefined;
};

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

function toIso(ms: number | null): string | null {
  return ms != null ? new Date(ms).toISOString() : null;
}

/**
 * Column times by status:
 *   In transit  — Loaded; Arrived/Left blank
 *   At factory  — Loaded + Arrived; Left blank
 *   Delivered   — Loaded + Arrived + Left
 * Times are forced chronological when more than one is present.
 */
export function displayTimes(t: TripTimes): {
  loadedAt: string | null;
  arrivedAt: string | null;
  departedAt: string | null;
} {
  let loaded = parseMs(t.loadedAt);
  let arrived = parseMs(t.arrivedAt);
  let left = parseMs(t.departedAt);

  if (t.status === "IN_TRANSIT") {
    arrived = null;
    left = null;
  } else if (t.status === "AT_FACTORY") {
    left = null;
  }

  if (t.status === "DELIVERED") {
    const stamps = [loaded, arrived, left].filter(
      (n): n is number => n != null,
    );
    stamps.sort((a, b) => a - b);
    if (loaded != null && arrived != null && left != null && stamps.length === 3) {
      loaded = stamps[0];
      arrived = stamps[1];
      left = stamps[2];
    } else {
      if (loaded != null && arrived != null && loaded > arrived) loaded = arrived;
      if (arrived != null && left != null && arrived > left) arrived = left;
      if (loaded != null && left != null && loaded > left) loaded = left;
    }
  } else if (loaded != null && arrived != null && loaded > arrived) {
    loaded = arrived;
  }

  return {
    loadedAt: toIso(loaded) ?? t.loadedAt ?? null,
    arrivedAt: toIso(arrived),
    departedAt: toIso(left),
  };
}

export function durationLabel(t: TripTimes, nowMs = Date.now()): string {
  const times = displayTimes(t);
  const start = parseMs(times.loadedAt);
  if (start == null) return "—";
  const end =
    t.status === "DELIVERED"
      ? parseMs(times.departedAt) ?? parseMs(times.arrivedAt)
      : nowMs;
  if (end == null || end < start) return "—";
  const mins = Math.round((end - start) / 60000);
  if (t.status === "DELIVERED" && mins < 5) return "—";
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
