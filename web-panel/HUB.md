# FreeNova web hub — independent panels

Live surface: Node `web-panel/server_local.mjs` on `http://192.168.1.3:8080`.

GoldSrc MOTD: `http://<lan>:8080/m/<code>/<steam>.htm` (max ~96 chars, HTTP, `.htm` required).

Each product is fully isolated — unique header colour, accent, and kicker. No shared nav, no cross-product links.

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

> **Retired (404):** `/store`, `/shop`, `/skins`, `/cosmetics`, `/models`.  
> `s` and `o` short-codes return 404. `/panel` → 302 to `/profile`.  
> **Home hub:** `/` renders the panel directory — all eight products plus the stats viewer. Product pages never link back to it (isolation).

### Redirect rules
- `/m/b/<sid>/missions.htm` (and `/daily`, `/weekly`, `/completed`) → 302 to `/m/i/<sid>/daily.htm`
- `/panel` → `/profile`; `/panel/<slug>` → canonical slug route
- Legacy PHP stubs (`battlepass.php`, `rsu.php`) → 302 to this hub

### Missions product (`/m/i/`, `/missions`)
In-page tabs: `daily`, `weekly`, `special`, `seasonal`, `completed`.  
Missions is **not** a Battle Pass tab. A link from BP to `/missions` is a foreign hit in the isolation harness.

Aliases: `/panel/profile`, `/panel/top`, `/panel/missions`, `/panel/achievements`, `/panel/battlepass`, `/panel/vip`, `/panel/events`, `/panel/tournament` all map to their canonical product routes. `/admin` is staff-only (not MOTD).

Data: game HMAC POST `/api/v1/server/stats` → SQLite replica. Web never grants coins. GET actions use a same-day token `t`.

No iframes in MOTD.

### Local ops (this machine only — no Cloudflare in the path)
- Start: `web-panel\start_panel.bat` → Node `server_local.mjs` on `0.0.0.0:8080`, DB = live-tree `freenova_panel.sq3` (open the real `.,` path, never a fresh copy).
- Game wiring (`cstrike/.../configs/amxx.cfg`): `fnweb_enabled 1`, `fnweb_host 127.0.0.1`, `fnweb_port 8080`; sync pushes POST directly to `:8080` — `relay/` (local `:8787` forwarder) is dormant while local.
- Registration: `POST /api/game/v1/register` + `GET /api/game/v1/health`, shared secret `freenova_reg_server_secret` (amxx.cfg) = `REG_SECRET` (relay.env). Plugin stays fail-closed while empty.
- Secrets live in `relay.env` + `amxx.cfg` on disk only — rotate both before any public upload/push. `ADMIN_PASSWORD` in relay.env unlocks `/admin` (staff table must list the SteamID).
- Discord webhook empty → call-admin endpoint answers 503; set `DISCORD_WEBHOOK_URL` to enable.
