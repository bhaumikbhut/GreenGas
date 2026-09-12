import { createHash } from "crypto";
import * as https from "https";
import { URL } from "url";
import type {
  ProtrackAccount,
  ProtrackDevice,
  ProtrackTrackPoint,
} from "./protrack";
import { getConfiguredAccounts } from "./protrack";
import { getRedis, PORTAL_SESSION_KEY_PREFIX } from "./kv";

const PORTAL_ORIGIN =
  process.env.PROTRACK_PORTAL_URL?.replace(/\/$/, "") ||
  "https://www.protrack365.com";
const GPS_DATA_URL =
  process.env.PROTRACK_GPSDATA_URL?.replace(/\/$/, "") ||
  "https://real.gpscenter.xyz";

/** Keep session this long; refresh a bit early so we never send an expired token. */
const SESSION_TTL_MS = 55 * 60 * 1000;
const SESSION_REUSE_SKEW_MS = 5 * 60 * 1000;

type PortalSession = {
  token: string;
  customerId: string;
  account: string;
  label: "LPG" | "PROPANE";
  expiresAt: number;
};

type FieldKeyMap = Record<string, number>;

const sessionCache = new Map<string, PortalSession>();

function sessionRedisKey(account: string): string {
  return `${PORTAL_SESSION_KEY_PREFIX}${account}`;
}

function isReusable(session: PortalSession | null | undefined): session is PortalSession {
  return Boolean(
    session &&
      session.token &&
      session.customerId &&
      session.expiresAt > Date.now() + SESSION_REUSE_SKEW_MS,
  );
}

async function readSession(account: string): Promise<PortalSession | null> {
  const mem = sessionCache.get(account);
  if (isReusable(mem)) return mem;

  const redis = getRedis();
  if (!redis) return null;

  try {
    const raw = await redis.get<PortalSession | string>(sessionRedisKey(account));
    if (!raw) return null;
    const session =
      typeof raw === "string" ? (JSON.parse(raw) as PortalSession) : raw;
    if (!isReusable(session)) return null;
    sessionCache.set(account, session);
    return session;
  } catch {
    return null;
  }
}

async function writeSession(session: PortalSession): Promise<void> {
  sessionCache.set(session.account, session);
  const redis = getRedis();
  if (!redis) return;
  const ttlSec = Math.max(
    60,
    Math.floor((session.expiresAt - Date.now()) / 1000),
  );
  try {
    await redis.set(sessionRedisKey(session.account), session, { ex: ttlSec });
  } catch {
    // Memory cache still helps within this instance
  }
}

async function clearSession(account: string): Promise<void> {
  sessionCache.delete(account);
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(sessionRedisKey(account));
  } catch {
    // ignore
  }
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function tzOffsetMinutes(): number {
  return -330; // Asia/Kolkata
}

function httpsRequest(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; headers: Record<string, string | string[]>; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: options.method || "GET",
        headers: options.headers || {},
        timeout: options.timeoutMs || 60000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers as Record<string, string | string[]>,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Request timeout"));
    });
    if (options.body != null) req.write(options.body);
    req.end();
  });
}

function extractToken(headers: Record<string, string | string[]>): string | null {
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const line of list) {
    const m = line.match(/(?:^|;\s*)token=([^;]+)/i) || line.match(/^token=([^;]+)/i);
    if (m?.[1]) return m[1];
  }
  return null;
}

async function portalLogin(acc: ProtrackAccount): Promise<PortalSession> {
  const cached = await readSession(acc.account);
  if (cached) return cached;

  const passwd = md5(acc.password);
  const url =
    `${PORTAL_ORIGIN}/LoginService?method=login` +
    `&username=${encodeURIComponent(acc.account)}` +
    `&passwd=${passwd}` +
    `&logintype=webcustomer` +
    `&_t=${Date.now()}` +
    `&tzOffset=${tzOffsetMinutes()}`;

  const res = await httpsRequest(url, {
    method: "POST",
    headers: {
      Accept: "application/json,*/*",
      "Content-Type": "application/json",
      Referer: `${PORTAL_ORIGIN}/`,
      "User-Agent": "Mozilla/5.0 (compatible; GreenGasFleet/1.0)",
      "Content-Length": "0",
    },
    body: "",
  });

  let data: {
    errorcode?: number;
    customerid?: number | string;
    errormsg?: string;
  };
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new Error(`Portal login invalid JSON for ${acc.account}`);
  }

  if (res.status >= 400 || data.errorcode !== 0 || !data.customerid) {
    throw new Error(
      `Portal login failed for ${acc.account}: code=${data.errorcode} ${data.errormsg || ""}`.trim(),
    );
  }

  const token = extractToken(res.headers);
  if (!token) {
    throw new Error(`Portal login for ${acc.account} missing token cookie`);
  }

  const session: PortalSession = {
    token,
    customerId: String(data.customerid),
    account: acc.account,
    label: acc.label,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await writeSession(session);
  return session;
}

function decodeRecord(
  raw: Record<string, unknown>,
  keyMap: FieldKeyMap,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, index] of Object.entries(keyMap)) {
    const value = raw[String(index)];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

async function postForm<T>(
  url: string,
  params: Record<string, string>,
): Promise<T> {
  const body = new URLSearchParams(params).toString();
  const res = await httpsRequest(url, {
    method: "POST",
    headers: {
      Accept: "application/json,*/*",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Referer: `${PORTAL_ORIGIN}/`,
      Origin: PORTAL_ORIGIN,
      "User-Agent": "Mozilla/5.0 (compatible; GreenGasFleet/1.0)",
      "Content-Length": String(Buffer.byteLength(body)),
    },
    body,
  });
  if (res.status >= 400) {
    throw new Error(`Portal HTTP ${res.status} for ${url}`);
  }
  return JSON.parse(res.body) as T;
}

type PortalFleetResponse = {
  errorcode?: number;
  errormsg?: string;
  servertime?: number;
  key?: FieldKeyMap;
  records?: Array<Record<string, unknown>>;
};

export type PortalFleetRow = {
  device: ProtrackDevice;
  track: ProtrackTrackPoint;
};

function toEpochSeconds(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

/**
 * OFFLINE only when GPS is really dead — not merely static / parked.
 * ProTrack still shows last pin + ACC for hours; do not over-flag those.
 *
 * Online if freshest hearttime/gpstime is within PROTRACK_ONLINE_MAX_AGE_SEC
 * (default 24h). If timestamps are missing but a map pin exists, keep online
 * (last-known position). Otherwise use validate / explicit offline flags.
 */
function isOnlineFromPortal(
  row: Record<string, unknown>,
  servertime?: number,
): boolean {
  const server = servertime
    ? servertime > 1e12
      ? Math.floor(servertime / 1000)
      : Math.floor(servertime)
    : Math.floor(Date.now() / 1000);

  const flagged = row.online ?? row.isonline ?? row.status;
  if (
    flagged === 1 ||
    flagged === "1" ||
    flagged === true ||
    flagged === "online" ||
    flagged === "ONLINE"
  ) {
    return true;
  }

  const heart = toEpochSeconds(row.hearttime);
  const gps = toEpochSeconds(row.gpstime);
  const lastSignal = Math.max(heart || 0, gps || 0);
  const maxAgeSec = Number(process.env.PROTRACK_ONLINE_MAX_AGE_SEC || 86400);

  if (lastSignal > 0) {
    return server - lastSignal <= maxAgeSec;
  }

  if (
    flagged === 0 ||
    flagged === "0" ||
    flagged === false ||
    flagged === "offline" ||
    flagged === "OFFLINE"
  ) {
    return false;
  }

  const lat = Number(row.lat);
  const lng = Number(row.lng);
  const hasFix =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);
  if (hasFix) return true;

  return (
    row.validate === true || row.validate === 1 || row.validate === "1"
  );
}

export async function fetchPortalFleet(
  acc: ProtrackAccount,
): Promise<PortalFleetRow[]> {
  return fetchPortalFleetOnce(acc, true);
}

async function fetchPortalFleetOnce(
  acc: ProtrackAccount,
  allowRetry: boolean,
): Promise<PortalFleetRow[]> {
  const session = await portalLogin(acc);
  const payload = await postForm<PortalFleetResponse>(
    `${GPS_DATA_URL}/LocationService?method=customerDeviceAndGpsone`,
    {
      token: session.token,
      customerid: session.customerId,
      version: process.env.PROTRACK_PORTAL_VERSION || "20260903101324",
      _t: String(Date.now()),
      lang: "en-us",
      fromweb: "1",
      timezone: String(tzOffsetMinutes()),
    },
  );

  if (payload.errorcode !== 0 || !payload.key || !payload.records) {
    await clearSession(acc.account);
    if (allowRetry) {
      return fetchPortalFleetOnce(acc, false);
    }
    throw new Error(
      `Portal fleet failed for ${acc.account}: code=${payload.errorcode} ${payload.errormsg || ""}`.trim(),
    );
  }

  const rows: PortalFleetRow[] = [];
  for (const raw of payload.records) {
    const row = decodeRecord(raw, payload.key);
    const imei = String(row.imei || "").trim();
    if (!imei) continue;

    const plate =
      String(row.car_number || "").trim() ||
      String(row.device_name || "").trim() ||
      imei;
    const name = String(row.device_name || "").trim() || plate;
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    const online = isOnlineFromPortal(row, payload.servertime);
    const hasFix = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

    const deviceIdRaw = row.deviceid ?? row.device_id ?? row.id;
    const deviceId =
      deviceIdRaw != null && String(deviceIdRaw).trim()
        ? String(deviceIdRaw).trim()
        : undefined;

    rows.push({
      device: {
        imei,
        name,
        plate,
        accountLabel: acc.label,
        account: acc.account,
        deviceId,
      },
      track: {
        imei,
        latitude: hasFix ? lat : 0,
        longitude: hasFix ? lng : 0,
        speed: Number(row.speed ?? 0) || 0,
        course: Number(row.course ?? 0) || 0,
        gpstime: toEpochSeconds(row.gpstime),
        hearttime: toEpochSeconds(row.hearttime),
        datastatus: online ? 2 : 4,
        accstatus: Number(row.accstatus ?? -1),
      },
    });
  }

  return rows;
}

export type PortalPlaybackPoint = {
  latitude: number;
  longitude: number;
  /** Unix seconds (normalized from portal ms). */
  gpstime: number;
  speed: number;
  course: number;
};

type PortalPlaybackResponse = {
  errorcode?: number;
  errormsg?: string;
  record?: string;
};

function parsePlaybackRecord(record: string | undefined): PortalPlaybackPoint[] {
  if (!record || typeof record !== "string") return [];
  const points: PortalPlaybackPoint[] = [];
  for (const line of record.split(";")) {
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 3) continue;
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    const gpstime = toEpochSeconds(parts[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !gpstime) continue;
    if (lat === 0 && lng === 0) continue;
    points.push({
      latitude: lat,
      longitude: lng,
      gpstime,
      speed: Number(parts[3] ?? 0) || 0,
      course: Number(parts[4] ?? 0) || 0,
    });
  }
  return points;
}

function toPortalMs(epochSecOrMs: number): number {
  if (!Number.isFinite(epochSecOrMs) || epochSecOrMs <= 0) return 0;
  return epochSecOrMs > 1e12 ? Math.floor(epochSecOrMs) : Math.floor(epochSecOrMs * 1000);
}

async function lookupDeviceOnAccount(
  acc: ProtrackAccount,
  imei: string,
): Promise<{ deviceId: string; plate: string; name: string } | null> {
  const rows = await fetchPortalFleet(acc);
  const hit = rows.find((r) => r.device.imei === imei);
  if (!hit?.device.deviceId) return null;
  return {
    deviceId: hit.device.deviceId,
    plate: hit.device.plate,
    name: hit.device.name,
  };
}

/**
 * Portal history bridge — same login as live GPS.
 * Calls LocationService?method=playback (not OpenAPI /api/playback).
 */
export async function fetchPortalPlayback(options: {
  imei: string;
  /** Unix seconds or ms. */
  begin: number;
  /** Unix seconds or ms. */
  end: number;
  /** Prefer this product account; otherwise try both. */
  accountLabel?: "LPG" | "PROPANE";
  /** Skip IMEI lookup when known. */
  deviceId?: string;
  account?: ProtrackAccount;
  /** Max pages (each page up to ~1000 points). */
  maxPages?: number;
}): Promise<{
  imei: string;
  deviceId: string;
  plate: string;
  accountLabel: "LPG" | "PROPANE";
  account: string;
  points: PortalPlaybackPoint[];
  pages: number;
}> {
  const imei = options.imei.trim();
  if (!imei) throw new Error("imei required");

  const beginMs = toPortalMs(options.begin);
  const endMs = toPortalMs(options.end);
  if (!beginMs || !endMs || endMs <= beginMs) {
    throw new Error("invalid begin/end range");
  }

  let acc: ProtrackAccount | null = options.account ?? null;
  let deviceId = options.deviceId?.trim() || "";
  let plate = "";
  let name = "";

  if (!acc || !deviceId) {
    const accounts = getConfiguredAccounts().filter((a) =>
      options.accountLabel ? a.label === options.accountLabel : true,
    );
    if (!accounts.length) throw new Error("No ProTrack accounts configured");

    for (const candidate of accounts) {
      const found = await lookupDeviceOnAccount(candidate, imei);
      if (found) {
        acc = candidate;
        deviceId = found.deviceId;
        plate = found.plate;
        name = found.name;
        break;
      }
    }
  }
  if (!acc || !deviceId) {
    throw new Error(`Device ${imei} not found on portal accounts`);
  }

  // Plate optional when deviceId was supplied by caller
  if (!plate) plate = imei;

  const maxPages = Math.max(1, Math.min(options.maxPages ?? 40, 80));
  const pageSize = 1000;
  const points: PortalPlaybackPoint[] = [];
  let cursorMs = beginMs;
  let pages = 0;

  const fetchPage = async (fromMs: number, allowRetry: boolean) => {
    const session = await portalLogin(acc!);
    const payload = await postForm<PortalPlaybackResponse>(
      `${GPS_DATA_URL}/LocationService?method=playback`,
      {
        token: session.token,
        customerid: session.customerId,
        version: process.env.PROTRACK_PORTAL_VERSION || "20260903101324",
        _t: String(Date.now()),
        lang: "en-us",
        fromweb: "1",
        timezone: String(tzOffsetMinutes()),
        deviceid: deviceId,
        begintime: String(fromMs),
        endtime: String(endMs),
        maptype: "google",
        count: String(pageSize),
      },
    );
    // Rate limit — back off and retry a few times
    if (payload.errorcode === 10009) {
      if (!allowRetry) {
        throw new Error(
          `Portal playback failed for ${imei}: code=10009 Over TPS Limit`,
        );
      }
      await new Promise((r) => setTimeout(r, 2500));
      await clearSession(acc!.account);
      return fetchPage(fromMs, false);
    }
    if (payload.errorcode !== 0) {
      await clearSession(acc!.account);
      if (allowRetry) return fetchPage(fromMs, false);
      throw new Error(
        `Portal playback failed for ${imei}: code=${payload.errorcode} ${payload.errormsg || ""}`.trim(),
      );
    }
    return parsePlaybackRecord(payload.record);
  };

  while (cursorMs < endMs && pages < maxPages) {
    pages += 1;
    // Rate-limit retries inside fetchPage (one backoff). Extra attempts for TPS.
    let attempt = 0;
    const maxAttempts = 4;
    let pagePts: PortalPlaybackPoint[] = [];
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        pagePts = await fetchPage(cursorMs, true);
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("10009") || attempt >= maxAttempts) throw err;
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    if (!pagePts.length) break;
    points.push(...pagePts);
    const lastMs = toPortalMs(pagePts[pagePts.length - 1].gpstime);
    if (!lastMs || lastMs <= cursorMs) break;
    cursorMs = lastMs + 1;
    if (pagePts.length < pageSize) break;
    // Soft pacing between pages
    await new Promise((r) => setTimeout(r, 200));
  }

  // Deduplicate consecutive identical stamps
  const deduped: PortalPlaybackPoint[] = [];
  for (const p of points) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      prev.gpstime === p.gpstime &&
      prev.latitude === p.latitude &&
      prev.longitude === p.longitude
    ) {
      continue;
    }
    deduped.push(p);
  }

  return {
    imei,
    deviceId,
    plate: plate || name || imei,
    accountLabel: acc.label,
    account: acc.account,
    points: deduped,
    pages,
  };
}

/** Pull both LPG (GGLPG) and Propane (GG11) fleets from portal. */
export async function fetchAllPortalFleets(): Promise<{
  rows: PortalFleetRow[];
  errors: string[];
  accountsUsed: string[];
}> {
  const accounts = getConfiguredAccounts();
  const rows: PortalFleetRow[] = [];
  const errors: string[] = [];
  const accountsUsed: string[] = [];

  // Parallel fetch both product accounts
  const results = await Promise.allSettled(
    accounts.map(async (acc) => {
      const part = await fetchPortalFleet(acc);
      return { acc, part };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      rows.push(...result.value.part);
      accountsUsed.push(
        `${result.value.acc.label}:${result.value.acc.account}(${result.value.part.length})`,
      );
    } else {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
      );
    }
  }

  return { rows, errors, accountsUsed };
}

export function gpsSource(): "portal" | "openapi" | "auto" {
  const v = (process.env.GPS_SOURCE || "portal").toLowerCase();
  if (v === "openapi" || v === "api") return "openapi";
  if (v === "auto") return "auto";
  return "portal";
}
