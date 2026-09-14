/**
 * Rebuild trip history from portal GPS (real pin times, fill-at, factory).
 *   npx tsx scripts/rebuild-trips.ts
 *   npx tsx scripts/rebuild-trips.ts --hours=72 --dry
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

async function main() {
  const hours = Number(flag("hours") || 72);
  const pauseMs = Number(flag("pause") || 900);
  const dry = args.includes("--dry");

  const { readFleetSnapshot } = await import("../src/lib/fleet-cache");
  const {
    draftsToTrips,
    walkTripsFromPlayback,
  } = await import("../src/lib/trips-from-playback");
  const tripsMod = await import("../src/lib/trips");
  const { replaceAllTrips } = tripsMod;
  type Trip = import("../src/lib/trips").Trip;
  const { fetchAllPortalFleets, fetchPortalPlayback } = await import(
    "../src/lib/protrack-portal"
  );
  const { getConfiguredAccounts } = await import("../src/lib/protrack");

  const snap = await readFleetSnapshot();
  if (!snap?.trucks?.length) throw new Error("No fleet snapshot");
  const radiusM = snap.radiusM || 500;

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

  const rebuilt: Trip[] = [];
  let failed = 0;
  const samples: string[] = [];
  const end = Math.floor(Date.now() / 1000);
  const begin = end - hours * 3600;

  for (let i = 0; i < snap.trucks.length; i++) {
    const t = snap.trucks[i];
    if (i > 0 && i % 10 === 0) {
      console.error(`trips ${i}/${snap.trucks.length}`);
    }
    const meta = deviceByImei.get(t.imei);
    if (!meta) continue;
    if (pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      const pb = await fetchPortalPlayback({
        imei: t.imei,
        begin,
        end,
        deviceId: meta.deviceId,
        account: meta.account,
        maxPages: 50,
      });
      const drafts = walkTripsFromPlayback(pb.points, radiusM);
      if (t.lastLoadedFrom) {
        for (const d of drafts) {
          if (!d.loadedFrom || /^unknown/i.test(d.loadedFrom)) {
            d.loadedFrom = t.lastLoadedFrom;
            d.port = t.port || d.port;
          }
        }
      }
      let last = drafts[drafts.length - 1];
      if (
        t.status === "AT_FACTORY" &&
        t.lastFactory &&
        last?.status === "DELIVERED" &&
        last.factory === t.lastFactory
      ) {
        last.status = "AT_FACTORY";
        last.departedAt = null;
      } else if (
        (t.status === "LOADED" || t.status === "AT_FACTORY") &&
        last?.status === "DELIVERED"
      ) {
        drafts.push({
          loadedFrom: t.lastLoadedFrom || last.loadedFrom,
          port: t.port || last.port,
          factory: t.status === "AT_FACTORY" ? t.lastFactory : null,
          status: t.status === "AT_FACTORY" ? "AT_FACTORY" : "IN_TRANSIT",
          loadedAt: last.departedAt || last.loadedAt,
          arrivedAt:
            t.status === "AT_FACTORY" ? last.departedAt || last.loadedAt : null,
          departedAt: null,
        });
        last = drafts[drafts.length - 1];
      }
      if (last && last.status !== "DELIVERED") {
        if (t.status === "AT_FACTORY" && t.lastFactory) {
          last.status = "AT_FACTORY";
          last.factory = t.lastFactory;
          last.arrivedAt = last.arrivedAt || last.loadedAt;
        } else if (t.status === "LOADED") {
          last.status = "IN_TRANSIT";
          last.factory = null;
          last.arrivedAt = null;
          last.departedAt = null;
        } else if (
          t.status === "PARK" ||
          t.status === "ON_ROAD" ||
          t.status === "EMPTY" ||
          t.status === "LOADING" ||
          t.status === "OFFLINE"
        ) {
          if (last.factory || t.lastFactory) {
            last.status = "DELIVERED";
            last.factory = last.factory || t.lastFactory;
            last.departedAt = last.departedAt || last.arrivedAt || last.loadedAt;
          } else {
            drafts.pop();
          }
        }
      }
      const trips = draftsToTrips(drafts, t);
      rebuilt.push(...trips);
      if (samples.length < 25 && trips.length) {
        const cur = trips[trips.length - 1];
        samples.push(
          `${t.plate}: ${trips.length} trip(s) last ${cur.status} ${cur.loadedFrom} → ${cur.factory || "—"} @ ${cur.loadedAt.slice(0, 16)}`,
        );
      }
    } catch (err) {
      failed += 1;
      console.error(
        `${t.plate}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const counts = { IN_TRANSIT: 0, AT_FACTORY: 0, DELIVERED: 0 };
  const unk = rebuilt.filter((t) => /^unknown/i.test(t.loadedFrom)).length;
  const noFac = rebuilt.filter(
    (t) => t.status !== "IN_TRANSIT" && !t.factory,
  ).length;
  for (const t of rebuilt) counts[t.status] += 1;

  if (!dry) await replaceAllTrips(rebuilt);

  console.log(
    JSON.stringify(
      {
        dry,
        trucks: snap.trucks.length,
        trips: rebuilt.length,
        failed,
        counts,
        unknownFill: unk,
        missingFactory: noFac,
        samples,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
