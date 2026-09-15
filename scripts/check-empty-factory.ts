/**
 * Check ON_ROAD/EMPTY trucks vs GPS history: did they reach a factory?
 *   npx tsx scripts/check-empty-factory.ts
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

function iso(sec: number | null | undefined) {
  if (!sec) return "-";
  return new Date(sec * 1000).toISOString().slice(5, 16);
}

async function main() {
  const hours = 72;
  const pauseMs = 900;
  const { readFleetSnapshot } = await import("../src/lib/fleet-cache");
  const { extractPinEvents } = await import("../src/lib/heal-from-playback");
  const { resolveFactoryGeofence: nearFac } = await import("../src/lib/geofence");
  const { fetchAllPortalFleets, fetchPortalPlayback } = await import(
    "../src/lib/protrack-portal"
  );
  const { getConfiguredAccounts } = await import("../src/lib/protrack");

  const snap = await readFleetSnapshot();
  if (!snap?.trucks?.length) throw new Error("No fleet snapshot");
  const radiusM = snap.radiusM || 500;
  const empty = snap.trucks.filter(
    (t) => t.status === "ON_ROAD" || t.status === "EMPTY",
  );
  console.error(`empty traveling ${empty.length}`);

  const portal = await fetchAllPortalFleets();
  const accounts = getConfiguredAccounts();
  const accountByLabel = new Map(accounts.map((a) => [a.label, a]));
  const deviceByImei = new Map<
    string,
    { deviceId: string; account: (typeof accounts)[0] }
  >();
  for (const row of portal.rows) {
    if (!row.device.deviceId) continue;
    const acc = accountByLabel.get(row.device.accountLabel);
    if (!acc) continue;
    deviceByImei.set(row.device.imei, {
      deviceId: row.device.deviceId,
      account: acc,
    });
  }

  const buckets = {
    liveOnFactory: 0,
    stillAtFactoryInTrail: 0,
    deliveredLeftFactory: 0,
    driveByOnlyShouldLoaded: 0,
    neverFactoryShouldLoaded: 0,
    neverFactoryTrueEmpty: 0,
    fail: 0,
  };
  const samples: Record<string, string[]> = {
    liveOnFactory: [],
    stillAtFactoryInTrail: [],
    deliveredLeftFactory: [],
    driveByOnlyShouldLoaded: [],
    neverFactoryShouldLoaded: [],
    neverFactoryTrueEmpty: [],
  };

  const end = Math.floor(Date.now() / 1000);
  const begin = end - hours * 3600;

  for (let i = 0; i < empty.length; i++) {
    const t = empty[i];
    if (i > 0 && i % 10 === 0) console.error(`check ${i}/${empty.length}`);
    const liveFac =
      t.lat != null && t.lng != null
        ? nearFac(t.lat, t.lng, radiusM, t.speed)
        : null;
    const meta = deviceByImei.get(t.imei);
    if (!meta) {
      buckets.fail += 1;
      continue;
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      const pb = await fetchPortalPlayback({
        imei: t.imei,
        begin,
        end,
        deviceId: meta.deviceId,
        account: meta.account,
        maxPages: 50,
      });
      const ev = extractPinEvents(pb.points, radiusM);
      const portLeave = Math.max(
        ev.lastLeaveLoad?.atSec ?? 0,
        ev.lastLeavePark?.atSec ?? 0,
      );
      const line = `${t.plate} ${t.productLine}: live=${liveFac?.point.name || "-"} enterFac=${ev.lastEnterFactory?.name || "-"} ${iso(ev.lastEnterFactory?.atSec)} leaveFac=${ev.lastRealFactoryLeave?.name || "-"} ${iso(ev.lastRealFactoryLeave?.atSec)} loadLeave=${iso(ev.lastLeaveLoad?.atSec)} parkLeave=${iso(ev.lastLeavePark?.atSec)}`;

      if (liveFac) {
        buckets.liveOnFactory += 1;
        if (samples.liveOnFactory.length < 40) samples.liveOnFactory.push(line);
        continue;
      }
      if (ev.stillInFactory && ev.lastEnterFactory) {
        buckets.stillAtFactoryInTrail += 1;
        if (samples.stillAtFactoryInTrail.length < 40) {
          samples.stillAtFactoryInTrail.push(line);
        }
        continue;
      }
      if (
        ev.lastRealFactoryLeave &&
        (!portLeave || ev.lastRealFactoryLeave.atSec >= portLeave)
      ) {
        buckets.deliveredLeftFactory += 1;
        if (samples.deliveredLeftFactory.length < 40) {
          samples.deliveredLeftFactory.push(line);
        }
        continue;
      }
      if (portLeave > 0 && ev.lastEnterFactory && !ev.lastRealFactoryLeave) {
        buckets.driveByOnlyShouldLoaded += 1;
        if (samples.driveByOnlyShouldLoaded.length < 40) {
          samples.driveByOnlyShouldLoaded.push(line);
        }
        continue;
      }
      if (portLeave > 0) {
        buckets.neverFactoryShouldLoaded += 1;
        if (samples.neverFactoryShouldLoaded.length < 40) {
          samples.neverFactoryShouldLoaded.push(line);
        }
        continue;
      }
      buckets.neverFactoryTrueEmpty += 1;
      if (samples.neverFactoryTrueEmpty.length < 40) {
        samples.neverFactoryTrueEmpty.push(line);
      }
    } catch (e) {
      buckets.fail += 1;
      console.error(
        `${t.plate}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log(JSON.stringify({ hours, empty: empty.length, buckets, samples }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
