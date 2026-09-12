import { getRedis, statusStoreMode, TRUCK_STATE_KEY } from "../src/lib/kv";

async function main() {
  console.log("storeMode:", statusStoreMode());
  console.log("TURSO_URL set:", Boolean(process.env.TURSO_DATABASE_URL));
  console.log("TURSO_TOKEN set:", Boolean(process.env.TURSO_AUTH_TOKEN));

  const kv = getRedis();
  if (!kv) {
    console.error("FAIL: no KV client (Turso env missing?)");
    process.exit(1);
  }

  const probeKey = "green-gas:local-probe";
  const payload = { ok: true, at: new Date().toISOString() };
  await kv.set(probeKey, payload, { ex: 60 });
  const roundtrip = await kv.get<typeof payload>(probeKey);
  console.log("roundtrip:", roundtrip);

  if (!roundtrip?.ok) {
    console.error("FAIL: Turso roundtrip mismatch");
    process.exit(1);
  }

  const truckState = await kv.get(TRUCK_STATE_KEY);
  const truckCount =
    truckState && typeof truckState === "object"
      ? Object.keys(truckState as object).length
      : 0;
  console.log("truckState keys:", truckCount);

  await kv.del(probeKey);
  console.log("PASS: Turso KV works");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
