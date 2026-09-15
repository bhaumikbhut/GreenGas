/**
 * Repair trips where Loaded and Arrived are the same poll clock.
 * Pulls GPS playback and stamps Loaded = leave port, Arrived = factory enter.
 *
 *   npx tsx scripts/fix-trip-stamps.ts --dry
 *   npx tsx scripts/fix-trip-stamps.ts --hours=72
 */
import { readFileSync } from "fs";
import path from "path";

for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  process.env[m[1].trim()] = v;
}

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function needsStampFix(t: { status: string; loadedAt: string; arrivedAt: string | null }): boolean {
  if (t.status === "IN_TRANSIT") return false;
  if (!t.arrivedAt) return t.status === "AT_FACTORY";
  const a = Date.parse(t.loadedAt);
  const b = Date.parse(t.arrivedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  if (a > b) return true;
  return Math.abs(b - a) < 15 * 60_000;
}

async function main() {
  const hours = Number(flag("hours") || 96);
  const pauseMs = Number(flag("pause") || 900);
  const dry = args.includes("--dry");
  const max = flag("max") ? Number(flag("max")) : 0;

  const { listTrips, replaceAllTrips } = await import("../src/lib/trips");
  const { readFleetSnapshot } = await import("../src/lib/fleet-cache");
  const { gpsTripStamps } = await import("../src/lib/heal-from-playback");
  const {
    walkTripsFromPlayback,
    pickDraftForTrip,
    applyDraftTimes,
  } = await import("../src/lib/trips-from-playback");
  const { fetchAllPortalFleets, fetchPortalPlayback } = await import(
    "../src/lib/protrack-portal"
  );
  const { getConfiguredAccounts } = await import("../src/lib/protrack");
  type Trip = import("../src/lib/trips").Trip;

  const all = await listTrips({ limit: 800, status: "ALL" });
  const candidates = all.filter((t) => needsStampFix(t));
  const limited = max > 0 ? candidates.slice(0, max) : candidates;
  const imeis = [...new Set(limited.map((t) => t.imei))];

  const snap = await readFleetSnapshot();
  const radiusM = snap?.radiusM || 500;

  const portal = await fetchAllPortalFleets();
  const accounts = getConfiguredAccounts();
  const accountByLabel = new Map(accounts.map((a) => [a.label, a]));
  const deviceByImei = new Map<
    string,
    { deviceId: string; account: (typeof accounts)[0]; plate: string }
  >();
  for (const row of portal.rows) {
    if (!row.device.deviceId) continue;
    const acc = accountByLabel.get(row.device.accountLabel);
    if (!acc) continue;
    deviceByImei.set(row.device.imei, {
      deviceId: row.device.deviceId,
      account: acc,
      plate: row.device.plate,
    });
  }

  const byImei = new Map<string, Trip[]>();
  for (const t of limited) {
    const list = byImei.get(t.imei) || [];
    list.push(t);
    byImei.set(t.imei, list);
  }

  const next = all.map((t) => ({ ...t }));
  const byId = new Map(next.map((t) => [t.id, t]));
  const samples: string[] = [];
  let fixed = 0;
  let skipped = 0;
  let failed = 0;
  const end = Math.floor(Date.now() / 1000);
  const begin = end - hours * 3600;

  for (let i = 0; i < imeis.length; i++) {
    const imei = imeis[i];
    if (i > 0 && i % 10 === 0) {
      console.error(`stamps ${i}/${imeis.length} fixed=${fixed}`);
    }
    const meta = deviceByImei.get(imei);
    const trips = byImei.get(imei) || [];
    if (!meta) {
      skipped += trips.length;
      continue;
    }
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      const pb = await fetchPortalPlayback({
        imei,
        begin,
        end,
        deviceId: meta.deviceId,
        account: meta.account,
        maxPages: 50,
      });
      const drafts = walkTripsFromPlayback(pb.points, radiusM);
      const stamps = gpsTripStamps(pb.points, radiusM);
      for (const trip of trips) {
        const row = byId.get(trip.id);
        if (!row) continue;
        const draft = pickDraftForTrip(row, drafts);
        let changed = false;
        if (draft) {
          const applied = applyDraftTimes(row, draft);
          if (applied.changed) {
            Object.assign(row, applied.trip);
            changed = true;
          }
        }
        const stillSame = needsStampFix(row);
        const stampsSafe =
          stillSame &&
          (row.status === "AT_FACTORY" || trips.length === 1) &&
          stamps.loadedAt &&
          (row.arrivedAt || stamps.arrivedAt) &&
          Date.parse(row.arrivedAt || stamps.arrivedAt || "") -
            Date.parse(stamps.loadedAt) >=
            10 * 60_000;
        if (stampsSafe && stamps.loadedAt) {
          row.loadedAt = stamps.loadedAt;
          if (stamps.arrivedAt) row.arrivedAt = stamps.arrivedAt;
          if (
            row.status === "DELIVERED" &&
            stamps.departedAt
          ) {
            row.departedAt = stamps.departedAt;
          }
          if (stamps.loadedFrom && /^unknown/i.test(row.loadedFrom)) {
            row.loadedFrom = stamps.loadedFrom;
            row.port = stamps.port ?? row.port;
          }
          changed = true;
        } else if (stillSame && row.status === "AT_FACTORY" && stamps.arrivedAt) {
          if (row.arrivedAt !== stamps.arrivedAt) {
            row.arrivedAt = stamps.arrivedAt;
            changed = true;
          }
        }
        if (changed) {
          fixed += 1;
          if (samples.length < 40) {
            samples.push(
              `${row.plate}: ${fmt(row.loadedAt)} → ${fmt(row.arrivedAt)} ${row.factory || "—"}`,
            );
          }
        } else {
          skipped += 1;
        }
      }
    } catch (err) {
      failed += 1;
      console.error(
        `${meta.plate}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!dry) await replaceAllTrips(next);

  const remaining = next.filter((t) => needsStampFix(t)).length;

  console.log(
    JSON.stringify(
      {
        dry,
        hours,
        candidates: limited.length,
        trucks: imeis.length,
        fixed,
        skipped,
        failed,
        remainingSameClock: remaining,
        samples,
      },
      null,
      2,
    ),
  );
}

function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(5, 16);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
