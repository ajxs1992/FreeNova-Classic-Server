# FreeNova web hub — independent panels

Live surface: Node `web-panel/server_local.mjs` on `http://192.168.1.3:8080`
(the game server dials `fnweb_host`:`fnweb_port` from `amxx.cfg` — 8762 on the
current host — and `fnweb_url` carries the browser-facing host).

GoldSrc MOTD: `http://<lan>:8080/m/<code>/<steam>.htm` (max ~96 chars, HTTP,
`.htm` preferred). The `.htm` suffix is optional — `/m/p/0-0-1` works too — and
the authid may be packed (`0-0-123456`) everywhere; `/u/` also accepts the
colon form (`/u/STEAM_0:0:1`).

Each product has its own header colour, accent and kicker. Product pages carry
no cross-product links, only a `‹ Panels` link back to the hub.

| Code | Product | Slug | Chat aliases | Accent |
|---|---|---|---|---|
| p | Profile | /profile | /profile /statsme /rankstats /rank | #7dd3fc |
| t | Top 15 | /top15 | /top /top15 | Tornado gold #d3b35a |
| b | Battle Pass | /battlepass | /bp | #e8c547 |
| i | Missions | /missions | /missions | #36DEAB |
| a | Achievements | /achievements | /achievements | #c084fc |
| r | Competitive | /tournament | /ctop /pts | #f07178 |
| v | VIP | /vip | /vip | #e8c547 |
| e | Events | /events | /events | #2EBF92 |

### What is actually served (verified 2026-11-22, see DEBUG.md §3)

These are **read-only landing pages**, not 404s: `/store`, `/shop`, `/skins`,
`/models`, `/cosmetics` all answer **200** and render "buy/equip in game"
(`src/index.js:194-199` → `src/gamepages.js`). Retirement is enforced only on
the *query* spellings of the same products: `/?view=shop`, `/battlepass.php?view=shop`
and `/u/<sid>/shop` return 404.

- `s` and `o` short-codes return 404.
- `/panel` is a **200 internal rewrite** to `/profile` (no redirect, the URL bar
  keeps `/panel`). `/panel/<slug>` maps the eight canonical slugs;
  `/panel/<anything else>` renders `/profile`.
- Legacy stubs `battlepass.php` / `rsu.php` render the **Top 15** page (200), not
  a redirect to the hub.
- `/admin` is staff-only (session cookie) and not an MOTD surface.
- **Home hub:** `/` renders the panel directory.

### Redirect rules

- `/m/b/<sid>/missions.htm` (and `/daily`, `/weekly`, `/completed`) → 302 to `/m/i/<sid>/…`
- `/compare` → 302 to `/profile` (`?steamid=` forwarded)
- `/discord` → 302 to the Discord invite

### Missions product (`/m/i/`, `/missions`)
In-page tabs: `daily`, `weekly`, `special`, `seasonal`, `completed`.
Missions is **not** a Battle Pass tab. A link from BP to `/missions` is a foreign
hit in the isolation harness.

Aliases: `/panel/profile`, `/panel/top`, `/panel/missions`,
`/panel/achievements`, `/panel/battlepass`, `/panel/vip`, `/panel/events`,
`/panel/tournament` all map to their canonical product routes.

Data: game HMAC POST `/api/v1/server/stats` → SQLite replica. Web never grants
coins. GET actions use a same-day token `t`.

No iframes in MOTD.

### Local ops (this machine only — no Cloudflare in the path)
- Start: `node web-panel/server_local.mjs` → on `0.0.0.0:8080`, DB = live-tree
  `freenova_panel.sq3` (open the real path, never a fresh copy). `PANEL_DB=…`
  points a dev run somewhere else.
- Game wiring (`cstrike/.../configs/amxx.cfg`): `fnweb_enabled 1`,
  `fnweb_host 127.0.0.1`, `fnweb_port 8762`, `fnweb_path /api/v1/server/stats`;
  sync POSTs directly there — `relay/` (local `:8787` forwarder) is dormant
  while local.
- Registration: `POST /api/game/v1/register` + `GET /api/game/v1/health`, shared
  secret `freenova_reg_server_secret` (amxx.cfg) = `REG_SECRET` (relay.env).
  The plugin stays fail-closed while either side is empty.
- Secrets live in `relay.env` + `amxx.cfg` on disk only — see `../SECRETS.md`
  and rotate both before any public upload/push. `ADMIN_PASSWORD` in relay.env
  unlocks `/admin` (the staff table must list the SteamID).
- Discord webhook empty → call-admin endpoint answers 503; set
  `DISCORD_WEBHOOK_URL` to enable.
