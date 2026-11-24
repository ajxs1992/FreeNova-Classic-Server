# FreeNova Classic Server + Winterfest panelled web client

A CS 1.6 (GoldSrc) dedicated server with an AMX Mod X plugin set and a Node web panel that
renders the player-facing site: profile, rankstats, Top 15, battle pass, missions,
achievements, events, VIP, shop, advent calendar, spin wheel, levels and admin.

## Fastest way in

```bash
git clone https://github.com/ajxs1992/FreeNova-Classic-Server.git
cd FreeNova-Classic-Server
git checkout winterfest          # the Winterfest work lives on this branch
```

## The two rules the panel is built on

1. **The database is authoritative.** A page only reads. A page action inserts a
   `winter_actions` row; `applyAction` writes the state change *and* a `winter_ledger` line
   in one transaction; the game server pulls `GET /api/game/pending` and acknowledges with
   `POST /api/game/ack`. Nothing pays out twice, and every currency change has a ledger row.
2. **Each page follows its own mockup.** No shared layout template. Shared code is data
   access, formatting and the action protocol — never layout.

Read `docs/panel/00-CONTRACT.md` before changing anything in `web-panel/`, and
`docs/panel/SPEC-14.md` for the feature list the 14 pages implement.

## Running the panel

```bash
cd web-panel
npm test                 # the suite
PORT=18101 node server_local.mjs
# http://127.0.0.1:18101/panel      ← the live panel
# http://127.0.0.1:18101/dashboard  ← the plate page
```

## Compiling the plugins

```bash
bash tools/compile-plugins.sh      # needs Docker with i386/debian:bookworm-slim
```

## What is deliberately not in this repository

Runtime state and player identity: the SQLite databases, the AMX Mod X data directory and
the server logs. They contain real players' SteamIDs, nicknames, bans and admin
credentials. They were tracked before this repo was published and are ignored now. A fresh
clone creates its own on first run.

## Licence

See `LICENSE`. Bundled third-party content (maps, models, sprites) keeps its own licence —
see `thirdparty/` and `docs/` for provenance.
