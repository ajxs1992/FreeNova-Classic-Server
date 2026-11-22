> NOTE: the Cloudflare Worker path below is retired — current deploys run the panel direct-host (Node `server_local.mjs`, plain HTTP for MOTD).

# FreeNova Web Panel — deploy to Cloudflare (free plan, runs indefinitely)

Static-free Worker: all pages are generated per request from a D1 database.
Free tier: 100k requests/day, 10 GB D1 — far beyond this panel's needs. No
credit card, no server to maintain, no expiry.

## One-time setup (5 minutes)

Requires Node.js (portable copy at `C:\Users\conts\nodejs-portable\`):

```bat
cd "C:\Users\conts\Desktop\FREENOVA System\web-panel"
set PATH=C:\Users\conts\nodejs-portable\node-v22.20.0-win-x64;%PATH%

:: 1. login (opens a browser; free account at dash.cloudflare.com)
npx wrangler login

:: 2. create the database, copy the database_id it prints
npx wrangler d1 create freenova-panel

:: 3. paste that id into wrangler.toml  ->  database_id = "..."

:: 4. create the tables
npx wrangler d1 execute freenova-panel --remote --file=schema.sql

:: 5. put the shared secret (do not commit it)
npx wrangler secret put SYNC_SECRET

:: 6. deploy
npx wrangler deploy
```

Wrangler prints the live URL, e.g. `https://panel.<your-host>`.
That URL is permanent and free.

## Game server wiring

In `cstrike/addons/amxmodx/configs/amxx.cfg` (or server.cfg):

```
fnweb_enabled 1
fnweb_host 188.114.97.8
fnweb_port 80
fnweb_vhost panel.<your-host>
fnweb_path /api/v1/server/stats
fnweb_secret <same value as `wrangler secret put SYNC_SECRET`>
fnweb_url http://panel.<your-host>
fnweb_public_host panel.<your-host>
fnweb_server_id freenova-public-1
fnweb_interval 30
```

Notes (all required, all verified live):

- `fnweb_host` must be a **numeric IPv4** (the patched binary rejects
  hostnames). A bare-IP `Host:` header is rejected by Cloudflare with
  error 1003, so `fnweb_vhost` supplies the real panel hostname
  as the Host header while the socket connects to the edge IP.
- Transport is plain HTTP on port 80 straight to the Cloudflare edge —
  the game cannot speak TLS and **no local relay is needed**.
- `fnweb_url` / `fnweb_public_host` are used for MOTD and outbound
  links (browser-side, where https works).
- After changing amxx.cfg or swapping freenova_sync.amxx, run
  `changelevel <map>` — AMXX 1.10 re-reads every plugin `.amxx` from
  disk and re-executes amxx.cfg on each map start (no server restart).

HMAC is **outbound only** (game → panel POST). Web → game purchases are a
GET queue plus a same-day action token in the MOTD URL. The game still
validates coins/inventory before spend. Do not put `fnweb_secret` in the
browser or require HMAC on GET.

The local HTTPS relay in `relay/` is **legacy/dev-only**: the production
game server pushes directly to the Cloudflare edge (see wiring above).
To run it anyway (e.g. for local testing against a staging Worker):

```bat
cd "C:\Users\conts\Desktop\.,\FREENOVA System\web-panel\relay"
set PANEL_URL=https://panel.<your-host>
node relay.cjs
```

## Verify after deploy

```bat
curl https://panel.<your-host>/ctop
```

`{"ok":true,...}`-style JSON on `/` errors means D1 binding missing — recheck
step 3. Pages render empty tables until the first push lands (within
`fnweb_interval` seconds of the map loading — pushes are an envelope
heartbeat and fire even with 0 players). Check `SELECT * FROM meta;` for
`last_push` / `server_online`.
