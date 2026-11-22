# Contributing

This repository is a private, verbatim snapshot of two live hosts: the FreeNova
web panel (`web-panel/`) and a CS 1.6 game server (`game-server/`). It is not a
mirror of an upstream project, so `main` is the description of what is actually
deployed — a merge here is a change to a running server. Read `README.md` and
`docs/ARCHITECTURE.md` before your first change, and `SECRETS.md` before you
paste anything anywhere.

## Ground rules

- One change per branch, one behaviour per commit. Do not mix reformatting with
  behaviour; a reviewer must be able to revert one commit without losing the
  other.
- A **plugin behaviour change** (anything under
  `game-server/cstrike/addons/amxmodx/scripting/`) needs its own commit and an
  entry in `REVIEW.md` saying what changed and why. If the change came out of an
  investigation, `DEBUG.md` gets the command you ran and its output.
- Build output under `tools/build/` is gitignored and must never be committed —
  and must never be written into the live `plugins/` tree.
- **No new secret may be committed.** See [Secrets](#secrets) below; it is the
  one rule with no exceptions.

## Branches

- `main` is what is deployed. Never commit to it directly if you can avoid it.
- Work on a short-lived branch named for the change: `fix/panel-motd-redirect`,
  `fix/plugin-teamxp-double-award`, `docs/runbook-backups`,
  `build/ci-panel-workflow`. Use the same prefixes as the commit types below.
- Keep the branch to one topic. Rebase on `main` rather than merging `main` in,
  so history stays linear and each commit still reads as a single change.
- Push and open a pull request (`.github/pull_request_template.md`). The PR body
  is the review artefact; do not rely on the chat or an issue thread instead.

## Commit messages

Subject line:

```
<type>(<scope>): <imperative summary, no trailing period, <= 72 chars>
```

- `type` is one of `fix`, `feat`, `build`, `docs`, `test`, `chore`, `refactor`.
- `scope` names the half you touched. In use today: `panel`, `plugins`, `motd`,
  `db`, `ci`, `docs`. Use `panel`/`plugins` when you are not sure.
- Imperative mood: "make the HMAC replay guard atomic", not "made"/"makes".
- 72 characters maximum, counted on the whole subject line.

Body (wrapped at ~76 columns) explains **why**, not what the diff already shows:

- what the old behaviour was and what went wrong, with a concrete before/after
  (a route and its status code, a plugin and its log line);
- what the fix does and why that is the right place for it;
- the commands you actually ran, and their result — `test_harness.mjs -> PASS
  panel smoke suite`, `tools/compile-plugins.sh -> compiled: 85 failed: 3
  allowed-failures: 3`.

A commit whose body is only "fix bug" or only restates the diff will be sent
back.

## Pre-PR checks

Run these from the repository root before you ask for review. They are exactly
what CI runs, so a green local run means a green PR.

```sh
# 1. Panel smoke suite (~1 s). Starts server_local.mjs on a throwaway SQLite db
#    and probes every player-facing route.
cd web-panel && node test_harness.mjs && cd ..

# 2. Syntax-check every tracked panel source: server, relay, worker, scripts,
#    the _backup_ copy — everything git knows about, at any depth.
for f in $(git ls-files 'web-panel/*.js' 'web-panel/*.mjs' 'web-panel/*.cjs'); do node --check "$f"; done

# 3. Python tooling (writes __pycache__, which is gitignored).
python3 -m py_compile web-panel/scripts/*.py

# 4. Every AMXX plugin.
tools/compile-plugins.sh
```

Notes on step 4:

- It compiles the **88 top-level `.sma` files** in
  `game-server/cstrike/addons/amxmodx/scripting/` (the count in this snapshot).
  It does not touch the upstream `scripting/testsuite/` or `include/` sources —
  those are vendored, not ours.
- `amxxpc` is a 32-bit i386 ELF, so it needs an i386 runtime:
  `docker pull i386/debian:bookworm-slim` on a host that cannot run i386
  binaries directly (the script tries native first, then the container).
- Three sources are *expected* to fail and are allowlisted with
  `ALLOW_FAIL="bypass_guard.sma ab_bypass_bridge.sma freenova_http_probe.sma"`:
  they `#include` third-party `.inc` files that are not part of this snapshot.
  Any failure outside those three is yours to fix.
- Output lands in `tools/build/plugins/` with one log per plugin.

Step 2 only *parses* each file — `node --check` never resolves imports. That
matters for the asset scripts under `web-panel/scripts/`: 18 of them
`import sharp from "sharp"`, which is not in `package.json` and not installed, and
the syntax check still passes. Running one of those scripts by hand needs
`npm i sharp` first; nothing in CI does.

CI (`.github/workflows/`) runs the same four things split by path:
`panel.yml` (1–3), `plugins.yml` (4), `secret-scan.yml` (gitleaks over full
history), `integrity.yml` (the `MANIFEST-*.sha256` drift report).

## Running the panel locally

```sh
cd web-panel
PANEL_DB=/tmp/panel.sq3 FNWEB_SECRET=test-only node server_local.mjs
# then browse http://127.0.0.1:8080/hub (PORT=8080 is the default)
```

- `PANEL_DB` seeds `schema.sql` + `seed_catalogs.sql` into a scratch database.
  Without it `server_local.mjs` picks the live replica in `web-panel/data/`, so
  always set it for development.
- `FNWEB_SECRET` (or `SYNC_SECRET`) is the HMAC the panel and the plugins share.
  Pass a throwaway value like the above so your dev server never holds the live
  one; `server_local.mjs` would otherwise load `relay/relay.env` and sign with
  the real key.
- Never echo either value into a terminal you will paste from, and never add a
  `.env`/`.dev.vars` file to the tree (`**/.dev.vars` is gitignored for that
  reason).
- The game server's MOTD loads plain HTTP on the LAN only — there is no TLS on
  that path, so do not test MOTD work over HTTPS and conclude it is broken.

## Secrets

The snapshot carries live credentials because it is a copy of two live hosts.
`SECRETS.md` lists every file that holds one and what needs rotating if it ever
leaks; read it before you copy a config, a log or an env file into an issue, a
PR or another machine.

- **Adding a secret to the tree is forbidden**, even temporarily, even in a
  branch you will delete. Put development values in the environment as shown
  above, or in a file `.gitignore` already covers.
- `.github/workflows/secret-scan.yml` runs gitleaks 8.30.1 over full history on
  every push, so a committed secret is visible to the next person who runs it —
  and to anyone watching the Actions tab.
- `.gitleaks.toml` allowlists *paths*, not values, and only the files
  `SECRETS.md` already documents as part of the snapshot. A new hit outside
  those paths fails the scan. Do not add your file to that list to get a green
  run: that is a rotate-and-scrub decision for the operator, not a CI tweak.
- Rotation is the operator's call. If a value leaks, the order in `SECRETS.md`
  (rotate on the host, then scrub the file, then rewrite history with
  `git filter-repo`) matters — rotating alone does not remove the old value from
  a commit.
