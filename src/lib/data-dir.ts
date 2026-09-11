import path from "path";
import os from "os";

/** Local disk under the app; on Vercel use /tmp (ephemeral per instance). */
export function dataDir(): string {
  if (process.env.VERCEL || process.env.DATA_DIR === "tmp") {
    return path.join(os.tmpdir(), "green-gas-data");
  }
  return path.join(process.cwd(), ".data");
}
