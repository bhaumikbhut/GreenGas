/**
 * Persistent KV via Turso (open-source libSQL / SQLite).
 * Set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN on Vercel.
 */
import { createClient, type Client } from "@libsql/client";

export type KvSetOpts = { ex?: number; nx?: boolean };

export type KvClient = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    opts?: KvSetOpts,
  ): Promise<"OK" | null | string>;
  del(...keys: string[]): Promise<number>;
  lpush(key: string, ...values: unknown[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<"OK" | string>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
};

let client: KvClient | null | undefined;
let schemaReady: Promise<void> | null = null;

function encode(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function decode<T>(raw: string | null | undefined): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
}

async function ensureSchema(db: Client): Promise<void> {
  if (!schemaReady) {
    schemaReady = db
      .execute(
        `CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER
        )`,
      )
      .then(() => undefined);
  }
  await schemaReady;
}

function wrapTurso(db: Client): KvClient {
  const ready = () => ensureSchema(db);

  return {
    async get<T>(key: string) {
      await ready();
      const now = Date.now();
      const row = await db.execute({
        sql: `SELECT value, expires_at FROM kv WHERE key = ?`,
        args: [key],
      });
      const r = row.rows[0];
      if (!r) return null;
      const exp = r.expires_at == null ? null : Number(r.expires_at);
      if (exp != null && exp > 0 && exp < now) {
        await db.execute({ sql: `DELETE FROM kv WHERE key = ?`, args: [key] });
        return null;
      }
      return decode<T>(String(r.value));
    },

    async set(key: string, value: unknown, opts?: KvSetOpts) {
      await ready();
      const payload = encode(value);
      const expiresAt =
        opts?.ex != null ? Date.now() + opts.ex * 1000 : null;

      if (opts?.nx) {
        const existing = await db.execute({
          sql: `SELECT key, expires_at FROM kv WHERE key = ?`,
          args: [key],
        });
        const r = existing.rows[0];
        if (r) {
          const exp = r.expires_at == null ? null : Number(r.expires_at);
          if (exp == null || exp > Date.now()) return null;
        }
      }

      await db.execute({
        sql: `INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
        args: [key, payload, expiresAt],
      });
      return "OK";
    },

    async del(...keys: string[]) {
      if (keys.length === 0) return 0;
      await ready();
      let n = 0;
      for (const key of keys) {
        const res = await db.execute({
          sql: `DELETE FROM kv WHERE key = ?`,
          args: [key],
        });
        n += Number(res.rowsAffected || 0);
      }
      return n;
    },

    async lpush(key: string, ...values: unknown[]) {
      await ready();
      const cur = (await this.get<unknown[]>(key)) || [];
      const next = [...values, ...cur];
      await this.set(key, next);
      return next.length;
    },

    async ltrim(key: string, start: number, stop: number) {
      const cur = (await this.get<unknown[]>(key)) || [];
      const end = stop < 0 ? cur.length + stop + 1 : stop + 1;
      await this.set(key, cur.slice(start, end));
      return "OK";
    },

    async lrange<T>(key: string, start: number, stop: number) {
      const cur = (await this.get<T[]>(key)) || [];
      const end = stop < 0 ? cur.length + stop + 1 : stop + 1;
      return cur.slice(start, end);
    },
  };
}

/** Turso only. Null = local file store (dev) / ephemeral on Vercel without env. */
export function getRedis(): KvClient | null {
  if (client !== undefined) return client;

  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (tursoUrl) {
    client = wrapTurso(
      createClient({
        url: tursoUrl,
        authToken: tursoToken,
      }),
    );
    return client;
  }

  client = null;
  return null;
}

export function statusStoreMode(): "turso" | "file" | "ephemeral" {
  if (process.env.TURSO_DATABASE_URL?.trim()) return "turso";
  if (process.env.VERCEL || process.env.DATA_DIR === "tmp") return "ephemeral";
  return "file";
}

export const TRUCK_STATE_KEY = "green-gas:truck-state:v2";
export const NOTIF_LIST_KEY = "green-gas:notifications";
export const PORTAL_SESSION_KEY_PREFIX = "green-gas:portal-session:";
