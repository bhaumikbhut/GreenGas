/**
 * Find long GPS stops that are NOT on a known factory / loading / parking pin.
 *   npx tsx scripts/find-unknown-factory-stops.ts
 *   npx tsx scripts/find-unknown-factory-stops.ts --hours=48 --min-dwell=20
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

function toSec(gpstime: number): number {
  return gpstime > 1e12 ? Math.floor(gpstime / 1000) : Math.floor(gpstime);
}

type Stop = {
  lat: number;
  lng: number;
  dwellMin: number;
  plate: string;
  nearestFactory: string | null;
  nearestFactoryKm: number | null;
};

async function main() {
  const hours = Number(flag("hours") || 48);
  const minDwellMin = Number(flag("min-dwell") || 20);
  const pauseMs = Number(flag("pause") || 800);
  const clusterM = 300;
  const minPortKm = 15;
  const maxSpeed = 8;

  const {
    haversineMeters,
    findNearestLoadingPoint,
    findNearestParkingPoint,
    resolveFactoryGeofence,
  } = await import("../src/lib/geofence");
  const { FACTORY_POINTS } = await import("../src/lib/factory-points");
  const { PORT_LOADING_POINTS, PARKING_POINTS } = await import(
    "../src/lib/loading-points"
  );
  const { readFleetSnapshot } = await import("../src/lib/fleet-cache");
  const { fetchAllPortalFleets, fetchPortalPlayback } = await import(
    "../src/lib/protrack-portal"
  );
  const { getConfiguredAccounts } = await import("../src/lib/protrack");

  const snap = await readFleetSnapshot();
  if (!snap?.trucks?.length) throw new Error("No fleet snapshot");
  const radiusM = snap.radiusM || 500;
  const trucks = snap.trucks.filter((t) => t.online !== false);
  console.error(`scan ${trucks.length} trucks, ${hours}h, dwell≥${minDwellMin}m`);

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

  function nearestFactory(lat: number, lng: number) {
    let best: { name: string; km: number } | null = null;
    for (const p of FACTORY_POINTS) {
      const km = haversineMeters(lat, lng, p.lat, p.lng) / 1000;
      if (!best || km < best.km) best = { name: p.name, km };
    }
    return best;
  }

  function farFromPort(lat: number, lng: number): boolean {
    const sites = [...PORT_LOADING_POINTS, ...PARKING_POINTS];
    for (const p of sites) {
      if (haversineMeters(lat, lng, p.lat, p.lng) < minPortKm * 1000) {
        return false;
      }
    }
    return true;
  }

  const stops: Stop[] = [];
  const end = Math.floor(Date.now() / 1000);
  const begin = end - hours * 3600;

  for (let i = 0; i < trucks.length; i++) {
    const t = trucks[i];
    if (i > 0 && i % 15 === 0) console.error(`progress ${i}/${trucks.length} stops=${stops.length}`);
    const meta = deviceByImei.get(t.imei);
    if (!meta) continue;
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    try {
      const pb = await fetchPortalPlayback({
        imei: t.imei,
        begin,
        end,
        deviceId: meta.deviceId,
        account: meta.account,
        maxPages: 40,
      });
      type Pt = { lat: number; lng: number; at: number };
      let segStart: Pt | null = null;
      let last: Pt | null = null;
      const flush = (at: number) => {
        if (!segStart || !last) return;
        const dwellMin = (at - segStart.at) / 60;
        if (dwellMin < minDwellMin) return;
        const lat = (segStart.lat + last.lat) / 2;
        const lng = (segStart.lng + last.lng) / 2;
        if (findNearestLoadingPoint(lat, lng)) return;
        if (findNearestParkingPoint(lat, lng)) return;
        if (resolveFactoryGeofence(lat, lng, radiusM, 0)) return;
        if (!farFromPort(lat, lng)) return;
        const nf = nearestFactory(lat, lng);
        stops.push({
          lat,
          lng,
          dwellMin: Math.round(dwellMin),
          plate: t.plate,
          nearestFactory: nf?.name ?? null,
          nearestFactoryKm: nf ? Math.round(nf.km * 10) / 10 : null,
        });
      };

      for (const p of pb.points) {
        const at = toSec(p.gpstime);
        const speed = Number(p.speed) || 0;
        const moving = speed > maxSpeed;
        if (!moving) {
          if (!segStart) segStart = { lat: p.latitude, lng: p.longitude, at };
          else if (
            haversineMeters(segStart.lat, segStart.lng, p.latitude, p.longitude) >
            120
          ) {
            flush(at);
            segStart = { lat: p.latitude, lng: p.longitude, at };
          }
          last = { lat: p.latitude, lng: p.longitude, at };
        } else if (segStart) {
          flush(at);
          segStart = null;
          last = null;
        }
      }
      if (segStart && last) flush(end);
    } catch (e) {
      console.error(
        `${t.plate}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  type Cluster = {
    lat: number;
    lng: number;
    dwellMin: number;
    trucks: Set<string>;
    nearestFactory: string | null;
    nearestFactoryKm: number | null;
    maps: string;
  };
  const clusters: Cluster[] = [];
  for (const s of stops) {
    let hit = clusters.find(
      (c) => haversineMeters(c.lat, c.lng, s.lat, s.lng) <= clusterM,
    );
    if (!hit) {
      hit = {
        lat: s.lat,
        lng: s.lng,
        dwellMin: s.dwellMin,
        trucks: new Set(),
        nearestFactory: s.nearestFactory,
        nearestFactoryKm: s.nearestFactoryKm,
        maps: `https://maps.google.com/?q=${s.lat.toFixed(6)},${s.lng.toFixed(6)}`,
      };
      clusters.push(hit);
    }
    hit.trucks.add(s.plate);
    hit.dwellMin = Math.max(hit.dwellMin, s.dwellMin);
    hit.lat = (hit.lat * (hit.trucks.size - 1) + s.lat) / hit.trucks.size;
    hit.lng = (hit.lng * (hit.trucks.size - 1) + s.lng) / hit.trucks.size;
    hit.maps = `https://maps.google.com/?q=${hit.lat.toFixed(6)},${hit.lng.toFixed(6)}`;
  }

  clusters.sort((a, b) => b.trucks.size - a.trucks.size || b.dwellMin - a.dwellMin);
  const out = clusters
    .filter((c) => c.trucks.size >= 2 || c.dwellMin >= 45)
    .slice(0, 40)
    .map((c) => ({
      lat: Number(c.lat.toFixed(6)),
      lng: Number(c.lng.toFixed(6)),
      trucks: c.trucks.size,
      maxDwellMin: c.dwellMin,
      plates: [...c.trucks].slice(0, 8),
      nearestListedFactory: c.nearestFactory,
      kmFromListed: c.nearestFactoryKm,
      maps: c.maps,
    }));

  console.log(
    JSON.stringify(
      {
        scanned: trucks.length,
        rawStops: stops.length,
        clusters: out.length,
        sites: out,
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
