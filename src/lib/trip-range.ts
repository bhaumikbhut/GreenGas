/** Calendar days are IST (Asia/Kolkata), same as the trips table. */

export const TRIP_TZ = "Asia/Kolkata";

export type DatePreset = "today" | "7d" | "all";

export function istYmd(ms = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TRIP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function istDayStartMs(ymd: string): number {
  const ms = new Date(`${ymd}T00:00:00+05:30`).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

export function addIstDays(ymd: string, days: number): string {
  const start = istDayStartMs(ymd);
  if (!Number.isFinite(start)) return ymd;
  return istYmd(start + days * 86_400_000);
}

export function istRangeMs(
  fromYmd: string,
  toYmd: string,
): { fromMs: number; toMs: number } | null {
  let from = fromYmd.trim();
  let to = toYmd.trim();
  if (!from && !to) return null;
  if (from && !to) to = from;
  if (to && !from) from = to;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const fromMs = istDayStartMs(from);
  const toMs = istDayStartMs(addIstDays(to, 1));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return { fromMs, toMs };
}

export function tripOverlapsRange(
  trip: {
    loadedAt: string;
    arrivedAt: string | null;
    departedAt: string | null;
  },
  fromMs: number,
  toMs: number,
): boolean {
  for (const iso of [trip.loadedAt, trip.arrivedAt, trip.departedAt]) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms >= fromMs && ms < toMs) return true;
  }
  return false;
}

export function stampInRange(
  iso: string | null | undefined,
  fromMs: number,
  toMs: number,
): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
}

/** For a date range: count Loaded / Arrived / Left events in that window. */
export function eventCountsInRange(
  trips: Array<{
    loadedAt: string;
    arrivedAt: string | null;
    departedAt: string | null;
  }>,
  fromMs: number,
  toMs: number,
): { loaded: number; arrived: number; left: number } {
  let loaded = 0;
  let arrived = 0;
  let left = 0;
  for (const t of trips) {
    if (stampInRange(t.loadedAt, fromMs, toMs)) loaded += 1;
    if (stampInRange(t.arrivedAt, fromMs, toMs)) arrived += 1;
    if (stampInRange(t.departedAt, fromMs, toMs)) left += 1;
  }
  return { loaded, arrived, left };
}

export function formatIstRangeLabel(fromYmd: string | null, toYmd: string | null): string {
  if (!fromYmd && !toYmd) return "All stored trips";
  const from = fromYmd || toYmd!;
  const to = toYmd || fromYmd!;
  const fmt = (ymd: string) => {
    const ms = istDayStartMs(ymd);
    if (!Number.isFinite(ms)) return ymd;
    return new Date(ms).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      timeZone: TRIP_TZ,
    });
  };
  if (from === to) {
    const today = istYmd();
    return from === today ? `Today · ${fmt(from)}` : fmt(from);
  }
  return `${fmt(from)} – ${fmt(to)}`;
}

export function dateRangeButtonLabel(
  preset: DatePreset | "custom",
  fromYmd: string,
  toYmd: string,
): string {
  if (preset === "today") return "Today";
  if (preset === "7d") return "Last 7 days";
  if (preset === "all") return "All time";
  return formatIstRangeLabel(fromYmd || null, toYmd || null);
}

export function presetRange(
  preset: DatePreset,
  nowMs = Date.now(),
): { from: string; to: string } | null {
  if (preset === "all") return null;
  const today = istYmd(nowMs);
  if (preset === "today") return { from: today, to: today };
  return { from: addIstDays(today, -6), to: today };
}
