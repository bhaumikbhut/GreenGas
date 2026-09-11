# Green Gas Fleet Tracker

Live truck map + auto status from ProTrack (portal bridge) + WhatsApp alerts.

**Pilot production:** always-on deploy is supported; GPS uses the ProTrack website bridge and alerts use personal WhatsApp (QR link). Long-term production should move to Open API + WhatsApp Business API.

## Accounts

| Product | Portal account |
|---------|----------------|
| LPG | `GGLPG` |
| Propane | `GG11` |

## Local setup

1. Copy `.env.example` to `.env.local` and fill passwords.
2. `GPS_SOURCE=portal` (default).
3. `npm install && npm run dev` → http://localhost:3000
4. Link WhatsApp at http://localhost:3000/whatsapp-link (scan QR once).

## Status rules (no driver input)

- Enter 500 m of a loading pin → `LOADING` → WhatsApp
- Leave that zone (2 polls) → `RELEASED` → WhatsApp
- Otherwise `ON_ROAD` / `OFFLINE`

## GPS source

- **portal** (current): logs into protrack365.com for both accounts and reads live positions
- **openapi**: official API (needs dealer enable; error 10007 until then)

## WhatsApp

| Provider | Use |
|----------|-----|
| `personal` | QR link at `/whatsapp-link` (testing / pilot) |
| `meta` | WhatsApp Business Cloud API |
| `callmebot` | Personal free API (often full) |
| `dry-run` | Log only |

## Production (Railway)

1. Docker image builds from [Dockerfile](Dockerfile).
2. Mount a **persistent volume** at `/app/.data` (truck status + WhatsApp auth session).
3. Set env vars from `.env.example` (never commit secrets).
4. Health check: `GET /api/health`
5. After first deploy, open `https://<your-host>/whatsapp-link` and scan QR again (local session does not carry over).

Required env:

```bash
GPS_SOURCE=portal
PROTRACK_ACCOUNT_LPG=...
PROTRACK_PASSWORD_LPG=...
PROTRACK_ACCOUNT_PROPANE=...
PROTRACK_PASSWORD_PROPANE=...
PROTRACK_PORTAL_URL=https://www.protrack365.com
PROTRACK_GPSDATA_URL=https://real.gpscenter.xyz
GEOFENCE_RADIUS_M=500
WHATSAPP_PROVIDER=personal
WHATSAPP_TO=91XXXXXXXXXX
```
