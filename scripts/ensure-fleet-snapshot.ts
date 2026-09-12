import { readFileSync } from "fs";
import path from "path";

for (const line of readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1].trim()] = v;
}

async function main() {
  const { readFleetSnapshot } = await import("../src/lib/fleet-cache");
  const { refreshFleetLiveGps } = await import("../src/lib/refresh-fleet");
  const before = await readFleetSnapshot();
  console.log("before", before ? { n: before.trucks.length, at: before.fetchedAt } : null);
  if (!before?.trucks?.length) {
    console.log("refreshing live GPS…");
    const r = await refreshFleetLiveGps();
    console.log("refresh", {
      skipped: r.skipped,
      trucks: r.snapshot?.trucks?.length ?? 0,
    });
  }
  const after = await readFleetSnapshot();
  console.log("after", after ? { n: after.trucks.length, counts: after.statusCounts } : null);
}
main().catch((e) => { console.error(e); process.exit(1); });
