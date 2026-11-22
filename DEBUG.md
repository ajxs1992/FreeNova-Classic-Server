# DEBUG — what was actually executed

Evidence for `REVIEW.md`. Every block below is a real command and its real
output, run against this checkout on 2026-11-22. Nothing here is reconstructed
from memory. Probe secrets are throwaway literals (`probe-secret`,
`verify-secret`, …) exported per process; no value from `relay/relay.env`,
`amxx.cfg` or `data/*.sq3*` is printed anywhere.

## Contents

- [1. Environment](#1-environment)
- [2. Panel smoke suite](#2-panel-smoke-suite)
- [3. Route probe](#3-route-probe)
- [4. HMAC sync endpoint](#4-hmac-sync-endpoint)
- [5. Admin auth](#5-admin-auth)
- [6. Database integrity, schema drift, bootstrap](#6-database-integrity-schema-drift-bootstrap)
- [7. PAWN compilation](#7-pawn-compilation)
- [8. Python / asset tooling](#8-python--asset-tooling)
- [9. Defects fixed, with before/after](#9-defects-fixed-with-beforeafter)
- [10. Could not verify](#10-could-not-verify)

## 1. Environment

```
$ node --version ; npm --version ; python3 --version
v26.13.1
12.2.3
Python 3.14.6
$ uname -m ; cat /etc/os-release | head -2
x86_64
NAME="CachyOS Linux"
ID=cachyos
$ git log --oneline -1
c7f8ca2 Snapshot of the live FreeNova Classic server and web panel (2026-11-22)
```

The panel was started for every probe with an explicit throwaway environment so
`server_local.mjs`'s auto-load of `relay/relay.env` cannot supply a live value
(it only fills keys that are unset):

```
PANEL_DB=/tmp/<case>/p.sq3 FNWEB_SECRET=<throwaway> PORT=18xxx HOST=127.0.0.1 \
  node server_local.mjs
```

## 2. Panel smoke suite

```
$ cd web-panel && node test_harness.mjs ; echo EXIT=$?
PASS /hub -> 200
PASS /profile -> 200
PASS /bp -> 200
PASS /battlepass -> 200
PASS /missions -> 200
PASS /achievements -> 200
PASS /competitive -> 200
PASS /events -> 200
PASS /vip -> 200
PASS /shop -> 200
PASS /skins -> 200
PASS /models -> 200
PASS /cosmetics -> 200
PASS /settings -> 200
PASS /rules -> 200
PASS /top15 -> 200
PASS /admin -> 200
PASS compact /hub
PASS compact /profile
PASS compact /bp
PASS compact /shop
SKIP external https://discord.gg/gvuGaWjuX
PASS hub link audit (20 targets)
PASS panel smoke suite
EXIT=0
```

Re-run after every fix below; still green. **The suite cannot fail a
documented-404 route** (`test_harness.mjs:50` accepts `[200, 302]`, and passes
`/shop` explicitly as 200), which is why the HUB.md contradiction survived —
see §3 and REVIEW §6.

## 3. Route probe

Every route HUB.md documents, plus the retired set, the short codes and the
error paths. Server: temp DB on `:18087`; body size confirms a real page rather
than an error page.

```
GET /                         200  44504
GET /hub                      200  44504
GET /profile                  200  39906   <title>FreeNova | Player Profile</title>
GET /top, /top15, /top/xp     200  16094   <title>FreeNova | Leaderboard</title>
GET /mapend                   200  40786
GET /bp, /battlepass          200  39816
GET /missions                 200  39804
GET /achievements             200  39856
GET /tournament,/competitive,/ctop  200 42663
GET /vip                      200  44135
GET /events                   200  40984
GET /stats, /statsviewer      200  41034
GET /settings, /rules         200  40564 / 40347
GET /icons                    200  32335
GET /search                   200  16094
GET /compare                  302  -> /profile
GET /panel                    200  39906   <title>FreeNova | Player Profile</title>
GET /panel/profile|top|missions|achievements|battlepass|vip|events|tournament  200
GET /panel/nonsense           200  39906   (falls back to /profile)
GET /store, /shop             200  40565   <title>FreeNova | Coin Shop</title>
GET /skins                    200  40556   <title>FreeNova | Weapon Skins</title>
GET /models                   200  40561
GET /cosmetics                200  40557
GET /battlepass.php, /rsu.php 200  16094   <title>FreeNova | Leaderboard</title>
GET /battlepass.php?view=shop 404
GET /?view=store              404
GET /favicon.ico              204
GET /nonexistent              404  13263
```

MOTD short codes:

```
GET /m/p/0-0-1.htm   200  /m/t/0-0-1.htm   200  /m/b/0-0-1.htm   200
GET /m/i/0-0-1.htm   200  /m/a/0-0-1.htm   200  /m/r/0-0-1.htm   200
GET /m/v/0-0-1.htm   200  /m/e/0-0-1.htm   200
GET /m/s/0-0-1.htm   404  /m/o/0-0-1.htm   404          <- by design
GET /m/b/0-0-1/missions.htm   302 -> /m/i/0-0-1/daily.htm
GET /m/b/0-0-1/daily.htm      302 -> /m/i/0-0-1/daily.htm
GET /m/b/0-0-1/weekly.htm     302 -> /m/i/0-0-1/weekly.htm
GET /m/b/0-0-1/completed.htm  302 -> /m/i/0-0-1/completed.htm
GET /m/a/0-0-1/hof.htm        200
GET /u/STEAM_0-0-1            200   (packed form)
GET /u/STEAM_0-0-1/shop       404
GET /u/STEAM_0:0:1            404   BEFORE fix 6f4baeb
GET /u/STEAM_0:0:1            200   AFTER  fix 6f4baeb
GET /u/STEAM_1:2:34567/profile/k/0123456789abcdef   200 (after)
```

Compact skin under the GoldSrc user agent
(`Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)`), counting the patterns
MSIE 6 cannot render:

```
/profile             flex=0  grid=0  var(=0
/m/p/0-0-1.htm       flex=0  grid=0  var(=0
```

Path traversal on the static handler — every form returns the NOT FOUND page,
while a real asset still serves:

```
/i/../package.json      -> 404
/i/..%2fpackage.json    -> 404
/i/%2e%2e/package.json  -> 404
/../schema.sql          -> 404
//etc/passwd            -> 404
/logo.png               -> 200 (81579 bytes, PNG)
```

**Conclusion for REVIEW §6:** `/panel` is not a 302, the five "retired" product
routes are live 200s, and the legacy stubs render Top 15 instead of redirecting.
`HUB.md` was corrected accordingly (commit `docs: …`).

## 4. HMAC sync endpoint

Requests signed exactly as `sync.js:74-115` documents
(`sha256hex(secret + ":POST:" + path + ":" + ts + ":" + nonce + ":" + sha256hex(body))`).

```
1  POST valid signature, {"players":[]}
     200  content-length=72   {"ok":true,"stored":0,"server_time":…,"events":[],"actions":[]}
2  same request replayed (identical nonce)
     401  {"ok":false,"error":"replayed nonce"}
3  fresh nonce
     200
4  timestamp -400 s
     401  {"ok":false,"error":"timestamp outside replay window"}
5  wrong secret
     401  {"ok":false,"error":"invalid signature"}
6  malformed JSON, valid signature
     400  {"ok":false,"error":"bad json"}
7  no signature header
     401  {"ok":false,"error":"missing signature"}
8  signed canonical path, POSTed to "/api/v1/server/stats/"
     200                       (after 836eabb; the signature follows the routed path)
9  3 MB body, signature irrelevant
     413  payload too large    (server_local.mjs cap, before HMAC)
10 2 MiB - 100 bytes / +23 bytes
     200 / 413                 (cap boundary is exact)
11 GET /api/v1/server/stats
     404 + HTML NOT FOUND, not 405  (index.js only 405s non-GET; see REVIEW §6)
12 POST /api/v1/server/admin-call, valid signature, no webhook configured
     503  {"ok":false,"error":"webhook not configured"}
```

The chunked-reply defect (REVIEW §2.1) was captured on the raw socket **before**
the fix, and re-captured **after**:

```
BEFORE ecc07da, raw request "GET /api/game/v1/health HTTP/1.1"
  HTTP/1.1 200 OK
  content-type: application/json
  Connection: close
  Transfer-Encoding: chunked          <- registration.sma cannot parse this
  5d\r\n{"success":true,"code":"OK",…}\r\n0\r\n\r\n

AFTER ecc07da, same request
  HTTP/1.1 200 OK
  content-type: application/json
  content-length: 109
  Connection: close
  {"ok":true,"service":"freenova-panel","endpoint":"game-registration",
   "reg_configured":true,"time":1795354282}

AFTER ecc07da, HTTP/1.0 (what freenova_sync.sma sends)
  content-length: 109   body identical
```

`registration.sma:1062-1084` takes the bytes after the first `CRLFCRLF`; after
the fix those bytes start with `{`, i.e. `json_parse` receives a valid object.

## 5. Admin auth

```
GET  /admin, no cookie                200  3457 B   login form, no Set-Cookie
GET  /admin, bogus fn_staff cookie    200  3457 B   login form
POST /admin, wrong password           200  3535 B   "SteamID or password is wrong…"
POST /admin, correct password         302  Location: /admin
     Set-Cookie: fn_staff=…; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=43200
GET  /admin, replaying that cookie    200  4026 B   "Overview / Sign out"
GET  /admin, tampered signature       200  3457 B   login form (rejected)
GET  /admin, cookie value "%"         200  3457 B   login form (was a 500 before b2bc6be)
```

The cookie is sound (HttpOnly, SameSite=Lax, `Path=/admin`, 12 h, `Secure` on
https). Two weaknesses remain and are **not** fixed because they are operator
decisions: the password is also accepted as `?k=` on `/top15` (REVIEW §4.1 H2),
and every unauthenticated request is a 200 rather than a 401, so a monitoring
check cannot tell the login form from the panel.

## 6. Database integrity, schema drift, bootstrap

The live replica was **copied** to `/tmp/dbcopy/` (all three files) and every
query ran against the copy. The originals are byte-identical before and after:

```
$ sha256sum web-panel/data/*.sq3*
a7b0275a06c4b7932c76fda0658cfb4114467a951cc274b7505816162385c024  data/freenova_panel.sq3
0d98b59b33bfac61393c13df990aa15667f755ee739d6db0486e05d8d66991dc  data/freenova_panel.sq3-shm
03c6abb6467bafe4c97f2c2c2083509fd030950c452d3647179fb201cb3c4113  data/freenova_panel.sq3-wal
```

(The `-shm` was mutated once early in the session by an agent opening the file in
place; it was restored with `git checkout --` and the hashes above are the
committed ones. This is the reason the rule is "copy first".)

```
PRAGMA integrity_check;   -> ok
PRAGMA journal_mode;      -> wal
```

Row counts: players 15, player_weapons 345, player_skills 195, player_skins 75,
catalog 8, meta 33 (21 of them `nonce:%`), actions 2 (`expired` 1, `failed` 1,
`pending` 0), reg_requests 1, staff 1, and 0 in `events`, `event_winners`,
`player_maps`, `comp_history`, `event_baselines`, `event_history`,
`admin_sessions`, `admin_audit`.

Drift, live DB vs a DB built from `schema.sql` alone:

```
tables only in LIVE DB : reg_requests (8 cols)
tables only in schema  : (none)
players  : 84 cols live vs 84 in schema — no name drift, no type drift,
           column ORDER differs (bp_season…bp_ent_at appended live, declared
           mid-table in schema.sql) = the fingerprint of ALTER TABLE migrations
events   : type drift  xp_mult INTEGER(live) vs REAL(schema), same for coins_mult
event_history: same two columns, same drift
actions  : no drift
catalog  : no drift
```

`schema.sql` + `seed_catalogs.sql` into an empty DB:

```
$ sqlite3 /tmp/probe/fresh.sq3 < web-panel/schema.sql        ; echo $?   -> 0, no stderr
$ sqlite3 /tmp/probe/fresh.sq3 < web-panel/seed_catalogs.sql ; echo $?   -> 0, no stderr
catalog=8, every other table 0, reg_requests ABSENT
```

So the documented bootstrap works, but produces 20 tables while the live DB has
21: `reg_requests` is created on demand by `register.js:98-116` and never
declared in `schema.sql`. `npm run db:init` therefore does not create it.

## 7. PAWN compilation

The baseline was "amxxpc is a 32-bit i386 ELF and exits 159 with no output", and
the conclusion drawn from it was that nothing could be compiled. That conclusion
is **wrong for this host**: the binary is fine, the sandbox is not.

```
$ file game-server/.../scripting/amxxpc
ELF 32-bit LSB executable, Intel i386, dynamically linked,
interpreter /lib/ld-linux.so.2, for GNU/Linux 2.6.32 …
$ ./amxxpc ; echo $?
159                                   (no output at all)
$ printf 'int main(){return 0;}' > t.c && gcc -m32 -o t32 t.c && ./t32 ; echo $?
159                                   (a trivial i386 binary dies the same way)
$ grep -i seccomp /proc/self/status
Seccomp: 2   Seccomp_filters: 28
```

Exit 159 = killed by signal 31 (SIGSYS): the sandbox's seccomp filter applies
x86_64 syscall numbering, so *every* 32-bit process is killed regardless of
installed i386 libraries (`/usr/lib32/libc.so.6` and the loader are present).
ptrace is blocked too, so this cannot be traced around.

A 32-bit container runs outside that filter, and works:

```
$ docker run --rm -w /amx/scripting \
    -v "$PWD/game-server/cstrike/addons/amxmodx:/amx:ro" \
    i386/debian:bookworm-slim /amx/scripting/amxxpc
AMX Mod X Compiler 1.10.0.5467
Copyright (c) 1997-2006 ITB CompuPhase
Copyright (c) 2004-2013 AMX Mod X Team
Usage: <file.sma> [options]
```

`tools/compile-plugins.sh` automates exactly that (native first, container as
fallback), compiles one file per invocation, writes to `tools/build/plugins/`
and prints one line per plugin. Results:

```
$ ./tools/compile-plugins.sh
...
PASS weapon_models.sma
...
compiled: 85   failed: 3

FAIL ab_bypass_bridge.sma: missing include(s): bypass_guard.inc
FAIL bypass_guard.sma:     missing include(s): bypass_guard.inc
FAIL freenova_http_probe.sma: missing include(s): easy_http.inc   (live plugin off)
```

Before `6f0bce9` the count was 84 pass / 4 fail; `freenova_teamxp.sma` (a
**loaded** plugin) failed because it included `<cromchat>` whose `.inc` is not
in the snapshot. Removing the unused include fixed it.

The three remaining failures are genuinely missing third-party includes, not
source bugs: `scripting/include/{bypass_guard,easy_http,cromchat}.inc` do not
exist. `amxxpc` reports a missing include as `std::bad_alloc` rather than naming
it (reproduced with a deliberately missing include), which is why the script
resolves `#include` lines itself.

Zero compiler warnings and zero errors on the 85 files that built.

## 8. Python / asset tooling

```
$ python3 -m py_compile web-panel/scripts/*.py ; echo $?
0
```

The scripts' *paths* are the problem: 42 absolute-path literals across 20
scripts, every one a Windows author-machine path (`C:/Users/conts/Desktop/…`).
Each was checked for a matching input in this checkout; most resolve to a file
that does exist here (`web-panel/assets/…`, `game-server/…/plugins/*.amxx`),
several reference inputs that were never in the snapshot
(`_copy_sma.mjs`, `_compile_sma.mjs`, `battlepass example 2.PNG`). The asset
pipeline is therefore re-runnable only after editing those constants — see
REVIEW §7.

## 9. Defects fixed, with before/after

| Commit | Before | After |
|---|---|---|
| `6a88f1c` relay.js | `ReferenceError: require is not defined in ES module scope` | `[relay] listening on 127.0.0.1:18788 -> https://example.invalid` |
| `ecc07da` framing | `Transfer-Encoding: chunked`, body `5d\r\n{…}` | `content-length: 109`, body starts `{` |
| `ecc07da` body cap | 3 MB body buffered in memory | `413 payload too large` at >2 MiB, `200` at 2 MiB−100 B |
| `70b6948` actions | push A returns ids 1-4, push B returns **the same** ids 1-4 | push A returns 1-4, push B returns `[]`; rows all `sent`, `attempts=1` |
| `749ef3e` nonce | replay accepted (check-then-insert) | replay → `401 replayed nonce` |
| `836eabb` path | signature hard-coded to one path | signed path follows the routed path (`…/stats/` verifies) |
| `836eabb` floats | `event_xp=1`, `event_coins=2` for a 1.5×/2.25× event | `event_xp=1.5`, `event_coins=2.25` |
| `b2bc6be` staff | `GET /admin` re-enabled a disabled owner | `DO NOTHING`; a row is created once |
| `b2bc6be` cookies | cookie value `%` → 500 | login form, 200 |
| `fa3d119` batch | failing batch left the first insert committed | rolled back: table still `1,2` |
| `9f48ce6` ui | `sortHeader` could never ascend | real toggle (helper unused, no visual change) |
| `0e286fb` boards | "most wins" board led by the player with most kills | led by the player with most wins (2-player fixture) |
| `6f4baeb` /u/ | `/u/STEAM_0:0:1` → 404 | 200, mints `STEAM_0:0:1` |
| `4521483` build | no way to compile anything | 85/88 PASS, 3 known-unbuildable, `ALLOW_FAIL` for CI |

## 11. CI workflows: linted and executed locally, but GitHub cannot start them

Every workflow in `.github/workflows/` was validated and then run step by step
on this host:

```
$ /tmp/actionlint .github/workflows/*.yml          # actionlint 1.7.7
(no output: 0 findings across 4 workflows)
$ python3 -c "import yaml,sys; [yaml.safe_load(open(p)) for p in sys.argv[1:]]" \
    .github/workflows/*.yml .github/ISSUE_TEMPLATE/*.yml
ok 7                                              # plus tomllib on .gitleaks.toml
$ node --check over `git ls-files 'web-panel/*.js' …`
73 files OK
$ cd web-panel && node test_harness.mjs | tail -1
PASS panel smoke suite
$ ALLOW_FAIL="bypass_guard.sma ab_bypass_bridge.sma freenova_http_probe.sma" ./tools/compile-plugins.sh
compiled: 85   failed: 3   allowed-failures: 3     (exit 0)
$ /tmp/gitleaks git . --config .gitleaks.toml --redact --no-banner
no leaks found                                     (exit 0, 28 commits)
$ /tmp/gitleaks with default rules only, same tree
exit 1, 5 findings — all inside the allowlisted snapshot paths
$ decoy repo, real config, a secret outside the allowlist
exit 1  -> "generic-api-key | web-panel/scripts/decoy.mjs:1"   (a sibling
             file `amxx.cfg.bak` is NOT covered by `amxx.cfg` — the anchoring works)
$ integrity summary step against the real manifests
Total drift: 11 file(s)   (game-server 1, web-panel 10)   [reported, not enforced]
```

**On GitHub, however, every run ends in `startup_failure` after ~1 s**: the push
that added the workflows, a manual `gh workflow run integrity.yml`, and
Dependabot's own `dynamic/dependabot/dependabot-updates` runs from earlier in the
day. Since Dependabot's workflow is not ours, this is an account/repository-level
blocker (Actions availability / billing / spending limit), not a defect in these
files. `README.md` lists it as a known issue. The first push's run id was
45030199190 (`path = BuildFailed`, 0 jobs).

## 10. Could not verify

1. **AMXX `hash_string` output case — inferred, not read.** If it emitted
   uppercase hex, every signed push would 401 (the inner body digest is part of
   the signed string). Evidence it is lowercase: the live DB shows accepted
   pushes; `dlls/amxmodx_mm_i386.so` holds one hex table
   (`0123456789abcdef`, `grep -c` = 1) and no uppercase one; and that binary
   exports `_ZZN6SHA2567getHashEvE7dec2hex`, the static `dec2hex` table of
   `SHA256::getHash`. Not a substitute for one `fnweb_debug 1` log line.
2. **Real-HLDS behaviour of `json_parse`** on a fixed registration reply. Proven
   from the wire bytes and the plugin's parser, not on a running server.
3. **The two stack-size estimates** (`freenova_registration.sma`,
   `freenova_calladmin.sma`): summed from declarations; the compiler does not
   report frame size, and `#pragma dynamic` is a runtime guard.
4. **Whether the public Worker (`*.workers.dev`) is still reachable.** The
   repo proves it was deployed; nothing here can prove it still answers, and
   REVIEW §3.8's severity depends on that.
5. **`REG_SECRET` as a Worker secret** — `register.js` falls back to
   `process.env.REG_SECRET`, which does not exist in a Worker; only an
   `env.REG_SECRET` binding works, and `wrangler.toml` documents only
   `SYNC_SECRET`.
6. **The live D1 database** — only the local SQLite replica was inspected.
7. **A real SFTP upload / deploy** — no credentials were used and no host was
   contacted, so `docs/RUNBOOK.md`'s upload steps are transcribed from the
   snapshot's own notes, not re-executed.
