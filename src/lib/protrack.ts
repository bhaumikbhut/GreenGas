import { createHash } from "crypto";

export type ProtrackAccount = {
  label: "LPG" | "PROPANE";
  account: string;
  password: string;
};

export type ProtrackDevice = {
  imei: string;
  name: string;
  plate: string;
  accountLabel: "LPG" | "PROPANE";
  account: string;
};

export type ProtrackTrackPoint = {
  imei: string;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  gpstime: number;
  hearttime: number;
  datastatus: number;
  accstatus: number;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

const tokenCache = new Map<string, TokenCache>();

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function baseUrl(): string {
  return (
    process.env.PROTRACK_BASE_URL?.replace(/\/$/, "") ||
    "https://api.protrack365.com"
  );
}

export function getConfiguredAccounts(): ProtrackAccount[] {
  const accounts: ProtrackAccount[] = [];
  const lpgUser = process.env.PROTRACK_ACCOUNT_LPG;
  const lpgPass = process.env.PROTRACK_PASSWORD_LPG;
  const propaneUser = process.env.PROTRACK_ACCOUNT_PROPANE;
  const propanePass = process.env.PROTRACK_PASSWORD_PROPANE;

  if (lpgUser && lpgPass) {
    accounts.push({ label: "LPG", account: lpgUser, password: lpgPass });
  }
  if (propaneUser && propanePass) {
    accounts.push({
      label: "PROPANE",
      account: propaneUser,
      password: propanePass,
    });
  }
  return accounts;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`ProTrack HTTP ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

export async function getAccessToken(
  account: string,
  password: string,
): Promise<string> {
  const cached = tokenCache.get(account);
  const now = Date.now();
  // Refresh ~15 min before expiry (token lasts 2h)
  if (cached && cached.expiresAt - now > 15 * 60 * 1000) {
    return cached.accessToken;
  }

  const time = Math.floor(now / 1000);
  const signature = md5(md5(password) + String(time));
  const url =
    `${baseUrl()}/api/authorization` +
    `?time=${time}&account=${encodeURIComponent(account)}` +
    `&signature=${signature}`;

  const data = await fetchJson<{
    code: number;
    message?: string;
    record?: { access_token: string; expires_in: number };
  }>(url);

  if (data.code !== 0 || !data.record?.access_token) {
    throw new Error(
      `ProTrack auth failed for ${account}: code=${data.code} ${data.message || ""}`.trim(),
    );
  }

  tokenCache.set(account, {
    accessToken: data.record.access_token,
    expiresAt: now + (data.record.expires_in || 7200) * 1000,
  });

  return data.record.access_token;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

export async function listDevices(
  acc: ProtrackAccount,
): Promise<ProtrackDevice[]> {
  const token = await getAccessToken(acc.account, acc.password);
  const url =
    `${baseUrl()}/api/device/list` +
    `?access_token=${encodeURIComponent(token)}` +
    `&account=${encodeURIComponent(acc.account)}`;

  const data = await fetchJson<{
    code: number;
    message?: string;
    record?: unknown;
  }>(url);

  if (data.code !== 0) {
    throw new Error(
      `ProTrack device list failed for ${acc.account}: code=${data.code} ${data.message || ""}`.trim(),
    );
  }

  const records = Array.isArray(data.record) ? data.record : [];
  return records
    .map((raw) => {
      const row = (raw || {}) as Record<string, unknown>;
      const imei = pickString(row, ["imei", "IMEI"]);
      if (!imei) return null;
      const name = pickString(row, [
        "devicename",
        "device_name",
        "name",
        "platename",
        "carnumber",
      ]);
      const plate = pickString(row, [
        "carnumber",
        "platename",
        "platenumber",
        "plate",
        "name",
        "devicename",
      ]);
      return {
        imei,
        name: name || plate || imei,
        plate: plate || name || imei,
        accountLabel: acc.label,
        account: acc.account,
      } satisfies ProtrackDevice;
    })
    .filter((d): d is ProtrackDevice => d != null);
}

export async function trackDevices(
  account: string,
  password: string,
  imeis: string[],
): Promise<ProtrackTrackPoint[]> {
  if (imeis.length === 0) return [];
  const token = await getAccessToken(account, password);
  const chunks: string[][] = [];
  for (let i = 0; i < imeis.length; i += 100) {
    chunks.push(imeis.slice(i, i + 100));
  }

  const points: ProtrackTrackPoint[] = [];
  for (const chunk of chunks) {
    const url =
      `${baseUrl()}/api/track` +
      `?access_token=${encodeURIComponent(token)}` +
      `&imeis=${encodeURIComponent(chunk.join(","))}`;
    const data = await fetchJson<{
      code: number;
      message?: string;
      record?: Array<Record<string, unknown>>;
    }>(url);
    if (data.code !== 0) {
      throw new Error(
        `ProTrack track failed for ${account}: code=${data.code} ${data.message || ""}`.trim(),
      );
    }
    for (const row of data.record || []) {
      const imei = String(row.imei || "");
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      if (!imei || Number.isNaN(latitude) || Number.isNaN(longitude)) continue;
      points.push({
        imei,
        latitude,
        longitude,
        speed: Number(row.speed ?? 0),
        course: Number(row.course ?? 0),
        gpstime: Number(row.gpstime ?? 0),
        hearttime: Number(row.hearttime ?? 0),
        datastatus: Number(row.datastatus ?? 0),
        accstatus: Number(row.accstatus ?? -1),
      });
    }
  }
  return points;
}

export function isOnline(datastatus: number): boolean {
  // 2: OK per ProTrack docs
  return datastatus === 2;
}
