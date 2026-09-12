/**
 * Replace "Unknown loading point" on trips using fleet snapshot lastLoadedFrom
 * (no ProTrack playback — fast).
 *
 *   npx tsx scripts/fill-unknown-loaded-from.ts
 */
import { readFileSync } from "fs";
import path from "path";

for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env[m[1].trim()] = v;
}

async function main() {
  const { readFleetSnapshot } = await import("../src/lib/fleet-cache");
  const { fillUnknownLoadedFrom, listTrips } = await import("../src/lib/trips");
  const { PORT_LOADING_POINTS } = await import("../src/lib/loading-points");

  const snap = await readFleetSnapshot();
  if (!snap?.trucks?.length) {
    console.error("No fleet snapshot");
    process.exit(1);
  }

  let patched = 0;
  const samples: string[] = [];
  for (const t of snap.trucks) {
    if (!t.lastLoadedFrom) continue;
    const port =
      PORT_LOADING_POINTS.find((p) => p.name === t.lastLoadedFrom)?.port ??
      t.port;
    const n = await fillUnknownLoadedFrom({
      imei: t.imei,
      loadedFrom: t.lastLoadedFrom,
      port,
    });
    if (n > 0) {
      patched += n;
      if (samples.length < 30) {
        samples.push(`${t.plate}: → ${t.lastLoadedFrom} (${n})`);
      }
    }
  }

  const trips = await listTrips({ limit: 800, status: "ALL" });
  const stillUnknown = trips.filter((x) =>
    /unknown/i.test(x.loadedFrom || ""),
  ).length;

  console.log(
    JSON.stringify({ patched, stillUnknown, openOrRecentSamples: samples }, null, 2),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
