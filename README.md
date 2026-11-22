# FreeNova Classic Server

![snapshot](https://img.shields.io/badge/snapshot-2026--11--22-blue)
![panel](https://img.shields.io/badge/panel%20smoke%20suite-PASS-brightgreen)
![plugins](https://img.shields.io/badge/plugins%2085%2F88-compile-brightgreen)
![review](https://img.shields.io/badge/review-REVIEW.md-informational)

Working repository for the FreeNova CS 1.6 "Classic" game server and its web
panel. The first commit is a **verbatim snapshot of the two live servers**, taken
over SFTP on **2026-11-22 13:09 UTC**; everything after it is review and
hardening work on that snapshot.

Nothing here is a build product: it is the running code as it exists on the
hosts, so it is the reference both sides (game server plugins ↔ web panel) are
diffed against from now on.

## Where to look

| Document | What it is |
|---|---|
| [`REVIEW.md`](REVIEW.md) | Full code review: findings by severity with `file:line`, the panel↔plugin contract, route truth, and the fixes applied while reviewing |
| [`DEBUG.md`](DEBUG.md) | Every command that was actually run and its real output: smoke suite, route/HMAC/admin probes, DB integrity and drift, PAWN compilation |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How a player action flows plugin → HMAC → panel → SQLite → page, with the tables and the endpoint shapes |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Deploy the panel, deploy a plugin, rotate the HMAC secrets, restore from this snapshot |
| [`docs/DEPLOY-plugins.md`](docs/DEPLOY-plugins.md) | The one-shot plugin deploy: which `.amxx` to upload, which server, the per-file SFTP recipe, restart, verify, rollback |
| [`SECRETS.md`](SECRETS.md) | Every path that holds a live credential or player data, and the rotation checklist |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch/commit style and the checks that must pass |

## How the two halves fit

```
HLDS + AMX Mod X 1.10                       Node panel (no Cloudflare in path)
  battlepass_core, freenova_vip, …            server_local.mjs
  freenova_sync  ── HMAC POST :8762 ───────▶  src/sync.js  ──▶ SQLite (WAL)
        ▲                                     src/*.js pages ◀──┘
        └──────── action queue in the ◀────── web "buy/claim" requests
                  push response                (queued, never granted)
```

The game server is the only authority: it pushes signed snapshots, the panel
records and displays them, and every web-side purchase is a *queued intent* the
game re-validates before it spends a coin. `docs/ARCHITECTURE.md` has the detail.

## Contents

| Path | Source account | What it is |
| --- | --- | --- |
| `game-server/cstrike/addons/` | `cmux305a200lt01pppogfv4wj@193.70.81.30:2022` | AMX Mod X 1.10 (`amxmodx/`), Metamod (`metamod/`), YaPB bots (`yapb/`) |
| `game-server/cstrike/` (root files) | same | `server.cfg`, `reunion.cfg`, `liblist.gam`, `mapcycle.txt`, `motd.txt`, `game.cfg` and the other small config/text files at the cstrike root |
| `web-panel/` | `cmuyj281s0c0i01p3edt001f0@193.70.81.30:2022` | FreeNova web panels — Cloudflare Worker + D1 source (`src/`, `schema.sql`), Node local runner (`server_local.mjs`), relay, asset pipeline scripts and the SQLite replica in `data/` |
| `tools/` | — | `compile-plugins.sh`: build every `.sma`, native or in an i386 container |
| `docs/` | — | Architecture and runbook |

## Size and integrity

| Tree | Files | Size |
| --- | --- | --- |
| `game-server/` | 1649 | 90 MB |
| `web-panel/` | 1355 | 47 MB |
| total | 3004 | 137 MB |

* Every regular file was enumerated from the remote and downloaded one by one,
  then re-verified by size against a second remote listing:
  `1626/1626` addon files and `1355/1355` panel files matched. The only file that
  differed was the live AMX Mod X log `amxmodx/logs/L20261122.log`, which the
  server was still writing to; it was re-fetched after the check.
* `MANIFEST-game-server.sha256` and `MANIFEST-web-panel.sha256` hold a sha256 of
  every file, so a restore can be checked with
  `sha256sum -c MANIFEST-web-panel.sha256` from the repo root. Two files now
  legitimately differ from the manifests (fixes from this review) — the
  `integrity` workflow reports drift rather than failing on it.
* The SFTP hosts have an unusual attribute implementation: `sftp -r` refuses
  every transfer with `not a regular file`. Plain per-file `get`/`put` works,
  which is what the backup and any restore must use.

## Current state

| | |
|---|---|
| AMX Mod X | 88 `.sma` sources, 136 compiled `.amxx`. `tools/compile-plugins.sh`: **85 compile clean**, 3 need third-party includes that are not in the snapshot (`bypass_guard.inc` ×2, `easy_http.inc`) |
| Web panel | `freenova-panel` v2.0.0, Worker + D1 source with a Node local runner on `:8080`; `node test_harness.mjs` → **PASS** |
| Game → panel data path | HMAC `POST /api/v1/server/stats` every 30 s (`freenova_sync.amxx` → `src/sync.js`) |
| Database | `data/freenova_panel.sq3` + WAL: `PRAGMA integrity_check` = ok; `schema.sql` drifts on `reg_requests` (missing) and the two `*_mult` column types (see `REVIEW.md` §3) |

### Known issues worth knowing before changing anything

1. **The contract is held together by details.** Read `REVIEW.md` §3 before
   touching `web-panel/src/sync.js`, `freenova_sync.sma` or `amxx.cfg` — the
   signature covers the request path, the plugin speaks HTTP/1.0 on purpose, and
   the registration plugin cannot parse a chunked reply.
2. **`HUB.md` is now accurate, `README-DEPLOY.md` is not** — the Cloudflare path
   it describes is retired, the local Node runner is live.
3. **Coins can be granted twice by a replayed action** and **a clutch reward can
   be mis-attributed** — both are documented with patches in `REVIEW.md` §8,
   not applied, because they need a plugin rebuild and operator sign-off.
4. **`plugins.ini` comments are load-order contracts.** Two of them are wrong
   (`REVIEW.md` §5.3); the rest must be respected when enabling a plugin.
5. **The `web-panel` lockfile has been refreshed** — GitHub reported 20
   advisories (8 high) against the snapshot lockfile, all inside the `wrangler`
   devDependency tree; after `npm audit fix` it is `found 0 vulnerabilities`,
   and `sharp` (imported by 18 `scripts/*` files but previously undeclared) is
   now a devDependency. Nothing in the deployed Worker changed: `wrangler` is
   only a CLI here. The smoke suite still passes.
6. **Actions cannot start on this repository yet.** Every run — the four
   workflows here, a manual `workflow_dispatch`, and Dependabot's own updates —
   ends in `startup_failure` within a second. The workflow files parse and
   lint clean (`actionlint 1.7.7`, 0 findings) and every step was executed
   locally with the results in `DEBUG.md` §10, so this is an account/repository
   setting (Actions availability, billing or a spending limit), not the YAML.
   Turn Actions on in Settings → Actions before relying on these badges.

## What is *not* in the snapshot

* `web-panel/node_modules/` and `web-panel/.npm/` — regenerable with
  `npm install`; the panel itself needs no runtime dependency.
* The rest of the game install: `cstrike/maps/`, `models/`, `sound/`,
  `sprites/`, `gfx/`, `*.wad`, `resource/`, `dlls/`, the HLDS binaries and
  `steamapps/`. Only `addons/` and the small cstrike-root config files were
  copied. Say so if a fuller copy is wanted.
* `core.15`, `core.16` (crash dumps, ~440 MB) at the HLDS root.

`web-panel/data/freenova_panel.sq3` (+ `-wal`, `-shm`) is a **copy of the live
replica database**, i.e. real player records, taken while the panel was
running. It is not a consistent SQLite backup taken by the engine; if the data
matters, dump it on the host with `sqlite3 ... ".backup"`. Open it only after
copying all three files elsewhere — opening it in place mutates the `-shm`.

## Secrets in this repository

`web-panel/relay/relay.env` and several AMX Mod X configs contain live
credentials and player data. The repo is private, but anyone with read access
gets them. See `SECRETS.md` for the exact list and the rotation checklist.
Rotate anything that has been shared, and ask for a scrub commit if these should
not live in git history.

## Restoring or syncing

Upload one file at a time — recursive `put -r` hits the same
`not a regular file` bug as `get -r`:

```sh
export SFTP_PASS='...' SSH_ASKPASS=/path/to/askpass.sh SSH_ASKPASS_REQUIRE=force
cd game-server
printf 'put cstrike/addons/amxmodx/configs/amxx.cfg cstrike/addons/amxmodx/configs/amxx.cfg\n' \
  | sftp -P 2022 cmux305a200lt01pppogfv4wj@193.70.81.30
```

`askpass.sh` is any script that prints `$SFTP_PASS`; `SSH_ASKPASS_REQUIRE=force`
is what makes it work without a TTY. Note that `sftp -b file` forces
`BatchMode=yes` and will *not* use the password at all — feed commands on stdin
instead. `docs/RUNBOOK.md` has the deploy, rotation and restore procedures.

## Development checks

```sh
cd web-panel && node test_harness.mjs        # panel smoke suite
tools/compile-plugins.sh                     # every .sma, PASS/FAIL per plugin
python3 -m py_compile web-panel/scripts/*.py
```

`.github/workflows/` runs the same four checks (panel, plugins, secret scan,
manifest integrity) on push and pull request to `main`.

## License

**No license has been chosen.** This repository carries the upstream AMX Mod X
distribution (GPL) alongside FreeNova's own plugins and panel code, so the
choice is not a formality — pick a license before making the repository public
or sharing it outside the admin team.
