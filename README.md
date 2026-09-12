# Green Gas Fleet Tracker

Live truck map + auto status from ProTrack (portal bridge) + WhatsApp alerts via **Meta Business Cloud API**.

## Accounts

| Product | Portal account |
|---------|----------------|
| LPG | `GGLPG` |
| Propane | `GG11` |

## Local setup

1. Copy `.env.example` to `.env.local` and fill ProTrack + Meta WhatsApp values.
2. `GPS_SOURCE=portal` (default).
3. `npm install && npm run dev` → http://localhost:3000
4. Use **Test WhatsApp** on the dashboard once Meta credentials are set.

## Status rules (no driver input)

```text
ON_ROAD     → enter parking → PARK
PARK        → leave parking → LOADED     (yard → loading → filled)
PARK/ON_ROAD→ enter loading → LOADING
LOADING     → leave loading → LOADED     (filled — never empty after load bay)
LOADED      → enter factory → AT_FACTORY
AT_FACTORY  → leave factory → ON_ROAD    (empty)
```

- Out of **loading** → filled (`LOADED`)
- Out of **parking** → filled (`LOADED`) — they go to the loading bay next
- Out of **factory** → empty (`ON_ROAD`)
- Status only from **known** loading / parking / factory pins (no “Unknown factory”)
- Filled truck off known pins stays **Filled road** (`LOADED`) until it hits a factory pin
- **Live map** and **Trips** stay in sync: every live GPS refresh updates status memory + opens/arrives/closes trips
- One-time catch-up: `npx tsx scripts/heal-from-playback.ts` (portal history → statuses + Filled-at names)
- Each loading/parking pin has its **own radius** (Neel field pins, Sep 2026)  
- Loading bay wins over parking if both apply  
- WhatsApp on transitions + live track link (`/track/<imei>`)  
- Factory yards: Google Maps pins in `src/lib/factory-points.ts` (per-plant radius from nearest neighbor)  
- Set `APP_PUBLIC_URL` for WhatsApp live-track links  
- Production status memory: **Turso** (open-source libSQL/SQLite). Set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` on Vercel.
- Fleet positions: cached in Turso. UI polls ~every **60s**; live ProTrack ~every **3 min** while the tab is open. Hobby cron warms cache once daily.

## GPS source

- **portal** (current): logs into protrack365.com for both accounts and reads live positions + history
- **openapi**: official API (needs dealer enable; error 10007 until then)
- History: `GET /api/playback?imei=…&hours=12` (portal `LocationService?method=playback` bridge)

## WhatsApp (Meta Cloud API)

Required in `.env.local`:

```bash
WHATSAPP_TO=91XXXXXXXXXX
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
# Optional approved template (needed for outbound outside 24h window)
WHATSAPP_TEMPLATE_NAME=
WHATSAPP_TEMPLATE_LANG=en
```

Create an app in [Meta for Developers](https://developers.facebook.com/), add WhatsApp, then paste the permanent token and phone number ID.

## Deploy

- **Local:** `npm run build && npm run start` → http://localhost:3000  
- **Production:** https://green-gas-sigma.vercel.app  
- Health: `GET /api/health`  
- Warm cache: `GET /api/cron/refresh-fleet` (set `CRON_SECRET`; Vercel Cron sends `Authorization: Bearer …`)  
- Optional force live pull: `GET /api/trucks?live=1`  
# GreenGas
