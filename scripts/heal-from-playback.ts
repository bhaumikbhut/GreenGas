/**
 * Rebuild live status + trips from ProTrack portal playback (36h default).
 *
 *   npx tsx scripts/heal-from-playback.ts
 *   npx tsx scripts/heal-from-playback.ts --hours=48 --dry
 *   npx tsx scripts/heal-from-playback.ts --only=ON_ROAD,EMPTY --max=40
 */
import { readFileSync } from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
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
function has(name: string): boolean {
  return args.includes(`--${name}`);
}

async function main() {
  const { healFleetFromPlayback } = await import(
    "../src/lib/heal-from-playback"
  );

  const onlyRaw = flag("only");
  const result = await healFleetFromPlayback({
    hours: Number(flag("hours") || 48),
    concurrency: Number(flag("concurrency") || 1),
    maxTrucks: flag("max") ? Number(flag("max")) : undefined,
    onlyStatuses: onlyRaw
      ? (onlyRaw.split(",").map((s) => s.trim().toUpperCase()) as Array<
          | "PARK"
          | "LOADING"
          | "LOADED"
          | "AT_FACTORY"
          | "EMPTY"
          | "ON_ROAD"
          | "OFFLINE"
        >)
      : undefined,
    dryRun: has("dry"),
    pauseMs: flag("pause") ? Number(flag("pause")) : 600,
  });

  const { readFleetSnapshot } = await import("../src/lib/fleet-cache");
  const snap = await readFleetSnapshot();
  const byProduct: Record<string, Record<string, number>> = {
    LPG: {},
    PROPANE: {},
  };
  for (const t of snap?.trucks || []) {
    const pl = t.productLine === "LPG" ? "LPG" : "PROPANE";
    byProduct[pl][t.status] = (byProduct[pl][t.status] || 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        ...result,
        propane: byProduct.PROPANE,
        lpg: byProduct.LPG,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
