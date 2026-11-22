# FreeNova Classic Server

Working repository for the FreeNova CS 1.6 "Classic" game server and its web
panel. The first commit is a **verbatim snapshot of the two live servers**,
taken over SFTP on **2026-11-22 13:09 UTC**.

Nothing here is a build product: it is the running code as it exists on the
hosts, so it is the reference both sides (game server plugins <-> web panel)
are diffed against from now on.

## Contents

| Path | Source account | What it is |
| --- | --- | --- |
| `game-server/cstrike/addons/` | `cmux305a200lt01pppogfv4wj@193.70.81.30:2022` | AMX Mod X 1.10 (`amxmodx/`), Metamod (`metamod/`), YaPB bots (`yapb/`) |
| `game-server/cstrike/` (root files) | same | `server.cfg`, `reunion.cfg`, `liblist.gam`, `mapcycle.txt`, `motd.txt`, `game.cfg` and the other small config/text files at the cstrike root |
| `web-panel/` | `cmuyj281s0c0i01p3edt001f0@193.70.81.30:2022` | FreeNova web panels - Cloudflare Worker + D1 source (`src/`, `schema.sql`), Node local runner (`server_local.mjs`), relay, asset pipeline scripts and the SQLite replica in `data/` |

## Size and integrity

| Tree | Files | Size |
| --- | --- | --- |
| `game-server/` | 1649 | 90 MB |
| `web-panel/` | 1355 | 47 MB |
| total | 3004 | 137 MB |

* Every regular file was enumerated from the remote and downloaded one by one,
  then re-verified by size against a second remote listing:
  `1626/1626` addon files and `1355/1355` panel files matched.
  The only file that differed was the live AMX Mod X log
  `amxmodx/logs/L20261122.log`, which the server was still writing to; it was
  re-fetched after the check.
* `MANIFEST-game-server.sha256` and `MANIFEST-web-panel.sha256` hold a sha256 of
  every file, so a restore can be checked with
  `sha256sum -c MANIFEST-web-panel.sha256` from the repo root.
* The SFTP hosts have an unusual attribute implementation: `sftp -r` refuses
  every transfer with `not a regular file`. Plain per-file `get`/`put` works,
  which is what the backup and any restore must use.

## What is *not* in the snapshot

* `web-panel/node_modules/` and `web-panel/.npm/` - regenerable with
  `npm install` from `package-lock.json`.
* The rest of the game install: `cstrike/maps/`, `models/`, `sound/`,
  `sprites/`, `gfx/`, `*.wad`, `resource/`, `dlls/`, the HLDS binaries and
  `steamapps/`. Only `addons/` and the small cstrike-root config files were
  copied. Say so if a fuller copy is wanted.
* `core.15`, `core.16` (crash dumps, ~440 MB) at the HLDS root.

`web-panel/data/freenova_panel.sq3` (+ `-wal`, `-shm`) is a **copy of the live
replica database**, i.e. real player records, taken while the panel was
running. It is not a consistent SQLite backup taken by the engine; if the data
matters, dump it on the host with `sqlite3 ... ".backup"`.

## Secrets in this repository

`web-panel/relay/relay.env` and several AMX Mod X configs contain live
credentials and player data. The repo is private, but anyone with read access
gets them. See `SECRETS.md` for the exact list. Rotate anything that has been
shared, and ask for a scrub commit if these should not live in git history.

## Restoring or syncing

Upload one file at a time - recursive `put -r` hits the same
`not a regular file` bug as `get -r`:

```sh
export SFTP_PASS='...' SSH_ASKPASS=/path/to/askpass.sh SSH_ASKPASS_REQUIRE=force
cd game-server
printf 'put cstrike/addons/amxmodx/configs/amxmodx.cfg cstrike/addons/amxmodx/configs/amxmodx.cfg\n' \
  | sftp -P 2022 cmux305a200lt01pppogfv4wj@193.70.81.30
```

`askpass.sh` is any script that prints `$SFTP_PASS`; `SSH_ASKPASS_REQUIRE=force`
is what makes it work without a TTY. Note that `sftp -b file` forces
`BatchMode=yes` and will *not* use the password at all - feed commands on stdin
instead.

## Deploying the panel side

```sh
cd web-panel
npm install
npm test          # node test_harness.mjs
npm run dev       # wrangler dev
npm run deploy    # wrangler deploy
```

`HUB.md` documents the product surface (`/profile`, `/top15`, `/battlepass`,
`/missions`, `/achievements`, `/tournament`, `/vip`, `/events`),
`README-DEPLOY.md` the Cloudflare/D1 deploy steps.

## Where things stand

* AMX Mod X: 88 `.sma` sources, 136 compiled `.amxx` plugins, plus local
  `.bak` revisions of the big ones (`battlepass_core.sma.*`, `plugins.ini.*`).
* Web panel: `freenova-panel` v2.0.0, Worker + D1, Node local runner on
  `:8080`; game -> panel data path is HMAC `POST /api/v1/server/stats`.
* Panel/plugin contract worth checking first when something breaks:
  `web-panel/src/sync.js`, `web-panel/schema.sql` versus the `.sma` sources
  that call the panel HTTP endpoints.
