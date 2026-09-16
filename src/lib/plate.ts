/** Strip spaces / dashes so "GJ39TA2804" matches "GJ 39 TA 2804". */
export function normalizePlate(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function plateMatches(plate: string, query: string): boolean {
  const raw = query.trim().toLowerCase();
  const compact = normalizePlate(query);
  if (!raw) return false;
  if (plate.toLowerCase().includes(raw)) return true;
  return compact.length > 0 && normalizePlate(plate).includes(compact);
}

export function matchTrucksByPlate<T extends { plate: string; name?: string }>(
  trucks: T[],
  query: string,
): T[] {
  const raw = query.trim().toLowerCase();
  const compact = normalizePlate(query);
  if (!raw) return [];
  return trucks
    .filter((t) => {
      if (plateMatches(t.plate, query)) return true;
      return Boolean(t.name?.toLowerCase().includes(raw));
    })
    .sort((a, b) => {
      const aExact = normalizePlate(a.plate) === compact ? 0 : 1;
      const bExact = normalizePlate(b.plate) === compact ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aStart = normalizePlate(a.plate).startsWith(compact) ? 0 : 1;
      const bStart = normalizePlate(b.plate).startsWith(compact) ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return a.plate.localeCompare(b.plate);
    });
}
