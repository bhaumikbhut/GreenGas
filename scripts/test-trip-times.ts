import { displayTimes, durationLabel } from "../src/lib/trip-display";
import { sanitizeTrip, type Trip } from "../src/lib/trips";

let fails = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    fails += 1;
  } else {
    console.log("ok:", msg);
  }
}

const now = Date.parse("2026-09-15T12:00:00.000Z");

const transit = displayTimes({
  status: "IN_TRANSIT",
  loadedAt: "2026-09-15T08:00:00.000Z",
  arrivedAt: "2026-09-15T09:00:00.000Z",
  departedAt: "2026-09-15T10:00:00.000Z",
});
assert(Boolean(transit.loadedAt?.startsWith("2026-09-15T08:00")), "in transit keeps Loaded");
assert(transit.arrivedAt == null, "in transit hides Arrived");
assert(transit.departedAt == null, "in transit hides Left");
assert(
  durationLabel(
    {
      status: "IN_TRANSIT",
      loadedAt: "2026-09-15T08:00:00.000Z",
      arrivedAt: null,
      departedAt: null,
    },
    now,
  ) === "4h",
  "in transit duration = loaded → now",
);

const atFac = displayTimes({
  status: "AT_FACTORY",
  loadedAt: "2026-09-15T08:00:00.000Z",
  arrivedAt: "2026-09-15T10:00:00.000Z",
  departedAt: "2026-09-15T11:00:00.000Z",
});
assert(Boolean(atFac.arrivedAt?.startsWith("2026-09-15T10:00")), "at factory shows Arrived");
assert(atFac.departedAt == null, "at factory hides Left");
assert(
  durationLabel(
    {
      status: "AT_FACTORY",
      loadedAt: "2026-09-15T08:00:00.000Z",
      arrivedAt: "2026-09-15T10:00:00.000Z",
      departedAt: null,
    },
    now,
  ) === "4h",
  "at factory duration = loaded → now, not arrived",
);

const delivered = displayTimes({
  status: "DELIVERED",
  loadedAt: "2026-09-15T08:00:00.000Z",
  arrivedAt: "2026-09-15T10:00:00.000Z",
  departedAt: "2026-09-15T11:00:00.000Z",
});
assert(Boolean(delivered.departedAt?.startsWith("2026-09-15T11:00")), "delivered shows Left");
assert(
  durationLabel(
    {
      status: "DELIVERED",
      loadedAt: "2026-09-15T08:00:00.000Z",
      arrivedAt: "2026-09-15T10:00:00.000Z",
      departedAt: "2026-09-15T11:00:00.000Z",
    },
    now,
  ) === "3h",
  "delivered duration = loaded → left",
);

const inverted = displayTimes({
  status: "DELIVERED",
  loadedAt: "2026-09-14T17:07:25.000Z",
  arrivedAt: "2026-09-14T17:04:51.000Z",
  departedAt: "2026-09-14T17:04:51.000Z",
});
assert(inverted.loadedAt == null, "same-clock delivered hides Loaded copy");
assert(Boolean(inverted.arrivedAt), "same-clock delivered keeps Arrived");

const sameClock = displayTimes({
  status: "AT_FACTORY",
  loadedAt: "2026-09-15T06:10:55.031Z",
  arrivedAt: "2026-09-15T06:10:55.031Z",
  departedAt: null,
});
assert(sameClock.loadedAt == null, "identical Loaded/Arrived hides Loaded");
assert(
  Boolean(sameClock.arrivedAt?.startsWith("2026-09-15T06:10")),
  "identical clocks keep Arrived",
);

const split = displayTimes({
  status: "AT_FACTORY",
  loadedAt: "2026-09-15T02:00:00.000Z",
  arrivedAt: "2026-09-15T08:00:00.000Z",
  departedAt: null,
});
assert(
  Boolean(split.loadedAt?.startsWith("2026-09-15T02:00")),
  "hours-apart Loaded stays",
);
assert(
  Boolean(split.arrivedAt?.startsWith("2026-09-15T08:00")),
  "hours-apart Arrived stays",
);

assert(
  durationLabel(
    {
      status: "DELIVERED",
      loadedAt: "2026-09-15T05:29:55.000Z",
      arrivedAt: null,
      departedAt: "2026-09-15T05:29:57.000Z",
    },
    now,
  ) === "—",
  "sub-5m delivered duration is blank, not 0m",
);

const junk: Trip = {
  id: "1",
  imei: "x",
  plate: "GJ 00 AA 0000",
  productLine: "PROPANE",
  port: "MUNDRA",
  loadedFrom: "Mundra Adani Loading Point",
  factory: "RIO GRANITO INDIA LLP",
  status: "IN_TRANSIT",
  loadedAt: "2026-09-15T08:00:00.000Z",
  arrivedAt: "2026-09-15T09:00:00.000Z",
  departedAt: "2026-09-15T10:00:00.000Z",
};
const cleaned = sanitizeTrip(junk);
assert(cleaned.arrivedAt == null && cleaned.departedAt == null && cleaned.factory == null, "sanitize in-transit");

if (fails) {
  console.error(`${fails} failed`);
  process.exit(1);
}
console.log("All passed");
