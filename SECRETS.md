# Credentials and personal data in this snapshot

This repository is a verbatim copy of two live hosts, so it carries whatever
those hosts carry. It is private, but **git history keeps every value forever**
- rotating on the host does not remove it from a commit here. Read this before
sharing the repo with anyone, or before making it public.

| File | What is in it |
| --- | --- |
| `web-panel/relay/relay.env` | `FNWEB_SECRET`, `SYNC_SECRET` (the HMAC shared with the game server), `ADMIN_PASSWORD`, `REG_SECRET`, a Discord webhook URL |
| `game-server/cstrike/addons/amxmodx/configs/amxx.cfg` | `fnweb_secret`, `freenova_reg_server_secret` - the same panel HMAC secrets, in the plugin config |
| `game-server/cstrike/addons/amxmodx/configs/freenova_registration.cfg` | `freenova_reg_server_secret` |
| `game-server/cstrike/addons/amxmodx/configs/calladmin.cfg` | `fn_admin_webhook` - Discord webhook URL for admin calls |
| `game-server/cstrike/addons/amxmodx/configs/users.ini`, `users.ini.bak-zgun` | admin accounts: names, SteamIDs, AMX Mod X password hashes, access flags |
| `game-server/cstrike/server.cfg.bak-*`, `freenova.cfg` | commented-out `rcon_password` values |
| `web-panel/test_harness.mjs`, `web-panel/src/top15/page.js` | test/dev secret literals used by the harness |
| `web-panel/data/freenova_panel.sq3`, `-wal`, `-shm` | the live D1/SQLite replica: player rows (SteamIDs, IPs, coins, XP, VIP) |
| `game-server/cstrike/addons/amxmodx/configs/bypass_guard/*.ini` | IP / country allow and ban lists; `iphub_api_keys.ini` is empty |
| `game-server/cstrike/addons/amxmodx/data/` | ranking, vault and user data written by the plugins |
| `web-panel/wrangler.toml` | Cloudflare `database_id` (an identifier, not a credential) |

`web-panel/node_modules/` and `.npm/` were deliberately not copied; the panel's
`.dev.vars`/secret files are not in the snapshot either (only `relay.env` is).

## If these must not live in git

Ask for a scrub commit: the values get replaced with placeholders
(`<ROTATE-ME>`), `.gitignore` gains the real files, and history is rewritten
with `git filter-repo` before the remote ever sees them. Doing it after a push
means force-pushing and any fork or clone keeps the old objects, so it is
cheaper to decide now than later.

## Rotation checklist

0. **2026-11-22 review note:** `fnweb_secret` and `freenova_reg_server_secret`
   were printed into an operator session transcript while this repository was
   being reviewed (a grep on `amxx.cfg` was not secret-aware). No value was copied
   into a commit, a document or a ticket, but both should be treated as exposed
   and rotated with the procedure in `docs/RUNBOOK.md` §3.
1. `FNWEB_SECRET` / `SYNC_SECRET` -> new random value in `relay.env`, in
   `amxx.cfg` (`fnweb_secret`) and in the Worker secret (`wrangler secret put`).
2. `REG_SECRET` -> same, plus `freenova_registration.cfg`.
3. `ADMIN_PASSWORD` -> panel admin login.
4. Discord webhooks -> regenerate the URL in Discord, update `relay.env` and
   `calladmin.cfg`.
5. AMX Mod X admins -> re-set passwords in `users.ini` and `amx_rehashadmins`.
