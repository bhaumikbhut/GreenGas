/**
 * Public base URL used in WhatsApp "live track" links.
 * Set APP_PUBLIC_URL on Vercel to your production domain.
 */
export function appPublicUrl(): string {
  const explicit =
    process.env.APP_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, "")}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, "")}`;
  }
  return "http://localhost:3000";
}

/** Shareable page that auto-refreshes that truck's GPS. */
export function liveTrackLink(imei: string): string {
  return `${appPublicUrl()}/track/${encodeURIComponent(imei)}`;
}

export function mapsPinLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`;
}
