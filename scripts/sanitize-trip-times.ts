/**
 * Persist sanitized trip timestamps (drop <15m delivered, fix inverted stamps).
 *   npx tsx scripts/sanitize-trip-times.ts
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

async function main() {
  const { persistSanitizedTrips, listTrips } = await import("../src/lib/trips");
  const n = await persistSanitizedTrips();
  const all = await listTrips({ limit: 800 });
  const counts = { IN_TRANSIT: 0, AT_FACTORY: 0, DELIVERED: 0 };
  for (const t of all) counts[t.status] += 1;
  console.log(JSON.stringify({ persisted: n, listed: all.length, counts }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
