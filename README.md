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
EMPTY/PARK → enter parking (site radius)  → PARK
PARK       → leave parking                → EMPTY
EMPTY/PARK → enter loading (site radius)  → LOADING
LOADING    → leave loading                → LOADED   (filled → factory)
LOADED     → enter factory                → AT_FACTORY
AT_FACTORY → leave factory                → EMPTY
```

- Each loading/parking pin has its **own radius** (Neel field pins, Sep 2026)  
- Loading bay wins over parking if both apply  
- On road: **LOADED** (filled) or **EMPTY** / **PARK** at yards  
- WhatsApp on transitions + live track link (`/track/<imei>`)  
- Factory unload hubs: `src/lib/factory-points.ts`  
- Set `APP_PUBLIC_URL` for WhatsApp live-track links  
- Production status memory: **Upstash Redis** (`KV_REST_API_URL` / `KV_REST_API_TOKEN`)

## GPS source

- **portal** (current): logs into protrack365.com for both accounts and reads live positions
- **openapi**: official API (needs dealer enable; error 10007 until then)

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
