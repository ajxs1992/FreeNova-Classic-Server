# SOURCES.md — where every deployed plugin binary comes from

Written after the source recovery of 2026-11-22. Before this work the live tree
shipped **134** `.amxx` plugins and only **83** of them had a `.sma` in
`scripting/`: 51 binaries were running on this server with no source in the
repository. That is the whole reason a plugin could not be fixed, re-read or
audited without guessing. All 51 are now accounted for and 137 sources compile
clean.

## 1. Numbers

| | before | after |
|---|---:|---:|
| deployed `.amxx` in `plugins/` | 134 | 134 (unchanged — see §6) |
| deployed plugins **with** a source | 83 | **134** |
| deployed plugins **without** a source | 51 | **0** |
| `.sma` in `scripting/` | 86 | 137 |
| `.inc` in `scripting/include/` | 110 | 131 |
| `tools/compile-plugins.sh` | 85 pass, 3 allowlisted, 0 real | **137 pass, 0 failed, 0 allowlisted** |

Of the 51: **50 were copied verbatim from the project source archive** at
`/home/ajxs/Desktop/Projects/cs16/CS16-FREENOVA/_SOURCES/` and **1 (`admin_sql`)
was reconstructed** because no `admin_sql.sma` exists anywhere on this machine
(§4). Nothing is still missing.

The archive holds 1 202 `.sma` across ten collections; only the 50 needed files
and the 21 `.inc` they require were copied. No trees, no binaries that this tree
did not build.

## 2. How a source was matched to a binary

Size is a weak signal on its own (see §5), so the primary evidence is
**provenance**: AMXX 1.10 embeds the absolute path of the compiled `.sma` in the
plugin's debug section. `amxxpc` output in this tree is a zlib stream inside an
`XXMA` container; decompressing it and reading the `….sma` strings recovers the
build path of the deployed binary verbatim. Every one of the 50 restored
binaries names a file under `…\FreeNova-Unified\src\<dir>\<name>.sma`, and the
file copied into `scripting/` is byte-identical to that archive file
(`cmp` clean for all 50 — `ALL-CENTRAL/<dir>/` and `FreeNova-Unified/src/<dir>/`
hold the same bytes for every one of them).

Where several archive copies existed, that is the tie-break that was used:

* **identical copies** — the archive keeps every source two to four times
  (`ALL-CENTRAL/`, `FreeNova-Unified/src/`, plus per-module trees). For 47 of the
  50 files every copy is byte-identical, so the pick is arbitrary; the canonical
  `ALL-CENTRAL/` copy was taken.
* **real variants** — three plugins exist in two genuinely different versions,
  and `AMXX 1.10 BASE PLUGINS SMA/` holds the other one:

  | plugin | `ALL-CENTRAL` = `FreeNova-Unified` (chosen) | `AMXX 1.10 BASE PLUGINS SMA` |
  |---|---:|---:|
  | `amx_chattags` | 6 237 B → 8 405 B | 5 838 B → 8 292 B |
  | `amx_ghostchat` | 6 470 B → 8 295 B | 6 092 B → 8 118 B |
  | `amx_rtv` | 2 770 B → 2 714 B | 2 033 B → 2 454 B |

  Both candidates were compiled with the same toolchain and the same
  in-container paths so that only the source differs. Size alone would have
  picked the smaller `AMXX 1.10 BASE` build for the two chat plugins; provenance
  proves that wrong — the deployed `amx_chattags.amxx` embeds
  `…/FreeNova-Unified/src/chat/amx_chattags.sma`, i.e. the **larger** variant,
  and `amx_rtv` matches it decisively (2 714 vs 2 454). The `AMXX 1.10 BASE`
  copies are an older branch (they lack the `reapi`/`fn_chat` integration).

## 3. The table

`Δ` is the freshly built `.amxx` against the deployed one. Positive means the
rebuild is larger. §5 explains why these are not zero.

| plugin | deployed | source chosen in `_SOURCES` | src | rebuilt | Δ | provenance embedded in the deployed `.amxx` |
|---|---:|---|---:|---:|---:|---|
| `admin_sql` | 11,887 | `*(none — see §4)*` | — | 12,941 | +8.9% | `*(no debug path)*` |
| `adminvote_ab` | 13,314 | `ALL-CENTRAL/bans-admin/adminvote_ab.sma` | 19,949 | 14,183 | +6.5% | `…/FreeNova-Unified/src/menus/adminvote_ab.sma` |
| `amx_chattags` | 7,682 | `ALL-CENTRAL/stock-amxx/amx_chattags.sma` | 6,237 | 8,405 | +9.4% | `…/FreeNova-Unified/src/chat/amx_chattags.sma` |
| `amx_ghostchat` | 7,330 | `ALL-CENTRAL/stock-amxx/amx_ghostchat.sma` | 6,470 | 8,295 | +13.2% | `…/FreeNova-Unified/src/chat/amx_ghostchat.sma` |
| `amx_helpmenu` | 4,067 | `ALL-CENTRAL/stock-amxx/amx_helpmenu.sma` | 2,845 | 4,349 | +6.9% | `…/FreeNova-Unified/src/menus/amx_helpmenu.sma` |
| `amx_notify` | 3,680 | `ALL-CENTRAL/stock-amxx/amx_notify.sma` | 2,098 | 3,587 | -2.5% | `…/FreeNova-Unified/src/chat/amx_notify.sma` |
| `amx_profiles` | 3,704 | `ALL-CENTRAL/stock-amxx/amx_profiles.sma` | 1,962 | 4,291 | +15.8% | `…/FreeNova-Unified/src/admin/amx_profiles.sma` |
| `amx_rtv` | 2,875 | `ALL-CENTRAL/stock-amxx/amx_rtv.sma` | 2,770 | 2,712 | -5.7% | `…/FreeNova-Unified/src/maps/amx_rtv.sma` |
| `backend_pg_sync` | 32,122 | `ALL-CENTRAL/other-custom/backend_pg_sync.sma` | 52,315 | 32,014 | -0.3% | `…/FreeNova-Unified/src/sync/backend_pg_sync.sma` |
| `bg_provider_geoip` | 1,373 | `ALL-CENTRAL/bans-admin/bg_provider_geoip.sma` | 2,060 | 1,333 | -2.9% | `…/FreeNova-Unified/src/guard/bg_provider_geoip.sma` |
| `bg_provider_ip-api` | 5,399 | `ALL-CENTRAL/bans-admin/bg_provider_ip-api.sma` | 16,502 | 5,553 | +2.9% | `…/FreeNova-Unified/src/guard/bg_provider_ip-api.sma` |
| `bg_provider_iphub` | 7,304 | `ALL-CENTRAL/bans-admin/bg_provider_iphub.sma` | 21,267 | 7,887 | +8.0% | `…/FreeNova-Unified/src/guard/bg_provider_iphub.sma` |
| `bg_provider_iphub_curl` | 8,680 | `ALL-CENTRAL/bans-admin/bg_provider_iphub_curl.sma` | 24,316 | 9,436 | +8.7% | `…/FreeNova-Unified/src/guard/bg_provider_iphub_curl.sma` |
| `bg_provider_iphubclient` | 6,411 | `ALL-CENTRAL/bans-admin/bg_provider_iphubclient.sma` | 18,823 | 6,942 | +8.3% | `…/FreeNova-Unified/src/guard/bg_provider_iphubclient.sma` |
| `bg_supervisor` | 17,527 | `ALL-CENTRAL/bans-admin/bg_supervisor.sma` | 51,732 | 18,959 | +8.2% | `…/FreeNova-Unified/src/guard/bg_supervisor.sma` |
| `fn_admin` | 4,356 | `ALL-CENTRAL/freenova/fn_admin.sma` | 4,384 | 4,493 | +3.1% | `…/FreeNova-Unified/src/menus/fn_admin.sma` |
| `fn_admincmd` | 17,589 | `ALL-CENTRAL/freenova/fn_admincmd.sma` | 28,778 | 19,186 | +9.1% | `…/FreeNova-Unified/src/admin/fn_admincmd.sma` |
| `fn_afk` | 6,250 | `ALL-CENTRAL/freenova/fn_afk.sma` | 4,462 | 5,863 | -6.2% | `…/FreeNova-Unified/src/players/fn_afk.sma` |
| `fn_antiflood` | 2,623 | `ALL-CENTRAL/freenova/fn_antiflood.sma` | 2,620 | 2,983 | +13.7% | `…/FreeNova-Unified/src/discipline/fn_antiflood.sma` |
| `fn_ban_range` | 8,354 | `ALL-CENTRAL/freenova/fn_ban_range.sma` | 7,914 | 9,644 | +15.4% | `…/FreeNova-Unified/src/bans/fn_ban_range.sma` |
| `fn_diag` | 3,931 | `ALL-CENTRAL/freenova/fn_diag.sma` | 3,174 | 4,010 | +2.0% | `…/FreeNova-Unified/src/diag/fn_diag.sma` |
| `fn_doctor` | 6,388 | `ALL-CENTRAL/freenova/fn_doctor.sma` | 6,145 | 5,646 | -11.6% | `…/FreeNova-Unified/src/diag/fn_doctor.sma` |
| `fn_gag` | 12,676 | `ALL-CENTRAL/freenova/fn_gag.sma` | 9,302 | 11,674 | -7.9% | `…/FreeNova-Unified/src/discipline/fn_gag.sma` |
| `fn_guard` | 2,876 | `ALL-CENTRAL/freenova/fn_guard.sma` | 2,069 | 2,928 | +1.8% | `…/FreeNova-Unified/src/guard/fn_guard.sma` |
| `fn_hud` | 3,348 | `ALL-CENTRAL/freenova/fn_hud.sma` | 2,376 | 2,856 | -14.7% | `…/FreeNova-Unified/src/players/fn_hud.sma` |
| `fn_identity` | 3,293 | `ALL-CENTRAL/freenova/fn_identity.sma` | 2,503 | 2,960 | -10.1% | `…/FreeNova-Unified/src/core/fn_identity.sma` |
| `fn_link` | 3,809 | `ALL-CENTRAL/freenova/fn_link.sma` | 3,364 | 4,038 | +6.0% | `…/FreeNova-Unified/src/sync/fn_link.sma` |
| `fn_maps` | 4,659 | `ALL-CENTRAL/freenova/fn_maps.sma` | 5,149 | 5,192 | +11.4% | `…/FreeNova-Unified/src/maps/fn_maps.sma` |
| `fn_match` | 8,419 | `ALL-CENTRAL/freenova/fn_match.sma` | 8,350 | 9,408 | +11.7% | `…/FreeNova-Unified/src/maps/fn_match.sma` |
| `fn_menus` | 6,858 | `ALL-CENTRAL/freenova/fn_menus.sma` | 7,526 | 7,100 | +3.5% | `…/FreeNova-Unified/src/menus/fn_menus.sma` |
| `fn_moderation` | 3,311 | `ALL-CENTRAL/freenova/fn_moderation.sma` | 4,129 | 3,771 | +13.9% | `…/FreeNova-Unified/src/moderation/fn_moderation.sma` |
| `fn_modes` | 6,207 | `ALL-CENTRAL/freenova/fn_modes.sma` | 6,631 | 6,415 | +3.4% | `…/FreeNova-Unified/src/maps/fn_modes.sma` |
| `fn_modules` | 4,776 | `ALL-CENTRAL/freenova/fn_modules.sma` | 4,353 | 4,862 | +1.8% | `…/FreeNova-Unified/src/diag/fn_modules.sma` |
| `fn_perf` | 4,380 | `ALL-CENTRAL/freenova/fn_perf.sma` | 4,039 | 4,804 | +9.7% | `…/FreeNova-Unified/src/diag/fn_perf.sma` |
| `fn_perms` | 7,563 | `ALL-CENTRAL/freenova/fn_perms.sma` | 10,615 | 8,545 | +13.0% | `…/FreeNova-Unified/src/core/fn_perms.sma` |
| `fn_pinfo` | 5,747 | `ALL-CENTRAL/freenova/fn_pinfo.sma` | 5,185 | 5,532 | -3.7% | `…/FreeNova-Unified/src/players/fn_pinfo.sma` |
| `fn_pingkick` | 8,742 | `ALL-CENTRAL/freenova/fn_pingkick.sma` | 9,028 | 10,054 | +15.0% | `…/FreeNova-Unified/src/discipline/fn_pingkick.sma` |
| `fn_policy` | 4,646 | `ALL-CENTRAL/freenova/fn_policy.sma` | 4,867 | 5,091 | +9.6% | `…/FreeNova-Unified/src/guard/fn_policy.sma` |
| `fn_ratelimit` | 3,868 | `ALL-CENTRAL/freenova/fn_ratelimit.sma` | 3,526 | 4,253 | +10.0% | `…/FreeNova-Unified/src/core/fn_ratelimit.sma` |
| `fn_reconnect` | 3,780 | `ALL-CENTRAL/freenova/fn_reconnect.sma` | 3,760 | 3,849 | +1.8% | `…/FreeNova-Unified/src/players/fn_reconnect.sma` |
| `fn_reports` | 8,102 | `ALL-CENTRAL/freenova/fn_reports.sma` | 10,103 | 9,271 | +14.4% | `…/FreeNova-Unified/src/menus/fn_reports.sma` |
| `fn_roles` | 7,668 | `ALL-CENTRAL/freenova/fn_roles.sma` | 4,366 | 8,459 | +10.3% | `…/FreeNova-Unified/src/roles/fn_roles.sma` |
| `fn_scan` | 19,909 | `ALL-CENTRAL/freenova/fn_scan.sma` | 21,508 | 20,493 | +2.9% | `…/FreeNova-Unified/src/discipline/fn_scan.sma` |
| `fn_servers` | 4,702 | `ALL-CENTRAL/freenova/fn_servers.sma` | 3,954 | 5,175 | +10.1% | `…/FreeNova-Unified/src/menus/fn_servers.sma` |
| `fn_settings` | 4,197 | `ALL-CENTRAL/freenova/fn_settings.sma` | 3,975 | 4,936 | +17.6% | `…/FreeNova-Unified/src/players/fn_settings.sma` |
| `fn_slots` | 2,859 | `ALL-CENTRAL/freenova/fn_slots.sma` | 3,317 | 3,184 | +11.4% | `…/FreeNova-Unified/src/discipline/fn_slots.sma` |
| `fn_spectate` | 6,042 | `ALL-CENTRAL/freenova/fn_spectate.sma` | 3,843 | 6,727 | +11.3% | `…/FreeNova-Unified/src/menus/fn_spectate.sma` |
| `fn_state` | 5,121 | `ALL-CENTRAL/freenova/fn_state.sma` | 6,442 | 5,663 | +10.6% | `…/FreeNova-Unified/src/core/fn_state.sma` |
| `fn_sync` | 2,723 | `ALL-CENTRAL/freenova/fn_sync.sma` | 1,585 | 2,735 | +0.4% | `…/FreeNova-Unified/src/sync/fn_sync.sma` |
| `fn_welcome` | 2,997 | `ALL-CENTRAL/freenova/fn_welcome.sma` | 3,147 | 3,246 | +8.3% | `…/FreeNova-Unified/src/players/fn_welcome.sma` |
| `mapmanager` | 10,072 | `ALL-CENTRAL/other-custom/mapmanager.sma` | 10,963 | 11,070 | +9.9% | `…/FreeNova-Unified/src/maps/mapmanager.sma` |

## 4. `admin_sql` — the one source that had to be reconstructed

No `admin_sql.sma` exists on this machine: not in the archive, not in the
vendored `amxmodx-1.10.0-git5481-base-linux.tar.gz`, not in any of the ~20
copies of the deployed `admin_sql.amxx`. The deployed binary's debug section
says why:

```
/home/builds/amxmodx/linux-1.10/build/plugins/admin.sma
```

That is the AMXX release build farm's path. Upstream has never shipped a
separate `admin_sql.sma` — `admin.amxx` and `admin_sql.amxx` are the same
`plugins/admin.sma` compiled twice, second time with `USING_SQL` defined, which
is exactly what the commented-out `// #define USING_SQL` at the top of
`scripting/admin.sma` is for. The `admin.sma` in this tree is byte-identical to
the stock 1.10 file in the vendored base tarball.

So `scripting/admin_sql.sma` is a two-line build recipe (`#define USING_SQL` +
`#include "admin.sma"`), not a fork, and it cannot drift from `admin.amxx`. It
compiles to 12 941 B against the deployed 11 887 B (+8.9 %, inside the §5 band).

`plugins.ini` loads `admin.amxx` and comments `admin_sql.amxx` out. That stays
as it is: enabling both would register the admin commands and every native
twice.

## 5. Why the rebuilt binaries are not byte-identical, and what the Δ band means

`cmp` between a fresh build and the deployed binary is clean for only 19 of the
83 plugins whose source was *already* in the repo — including
`battlepass_core`, `weapon_models`, `fn_bans`, `rsu_core` and `postgres_engine`.
For everything else the two differ, so size and bytes cannot be used as a
"correct source" proof by themselves and must be read against a control group:

| group | n | Δ min | Δ max | mean | byte-identical |
|---|---:|---:|---:|---:|---:|
| **control** — sources that were always here | 83 | −15.5 % (`nextmap`) | +14.9 % (`adminchat`) | +2.8 % | 19 |
| **restored** — the 51 recovered just now | 51 | −14.7 % (`fn_hud`) | +17.6 % (`fn_settings`) | +5.8 % | 0 |

The restored set sits inside the same band as the control group, which is the
result that matters: nothing was picked that builds wildly unlike the binary it
is supposed to replace. `amxxpc` is not byte-reproducible across the toolchains
that produced these binaries — the deployed ones were built on Windows
(`C:\Users\conts\…` paths, and the `admin_sql` one on an AMXX release box), so
the embedded debug path length, the compiler build and the include set all move
the output by a few hundred bytes either way. Anyone tempted to "fix" a Δ by
editing a source should stop: the Δ is the compiler, not the source.

Three restored plugins land above the control maximum and are called out in §6
as worth a look before their binaries are trusted over the deployed ones:
`fn_settings` +17.6 %, `amx_profiles` +15.8 %, `fn_ban_range` +15.4 %. None
reaches the 20 % threshold, and none of the three is a jump in what the plugin
registers — they are simply the top of the distribution.

## 6. Did not replace a single deployed binary

**No `.amxx` in `game-server/cstrike/addons/amxmodx/plugins/` was overwritten by
this work.** Restoring a source is not a reason to swap the binary on a live
server: the point of the exercise is that the tree can now be rebuilt, not that
the running stack should change behaviour. Everything the recovery produces
goes to `tools/build/` and is compared, never installed.

Review before deploying, if the coordinator wants to install any of these:

| plugin | why it is on the list |
|---|---|
| `fn_settings` +17.6 %, `amx_profiles` +15.8 %, `fn_ban_range` +15.4 % | above the control band; install one at a time and diff `amx_plugins` output |
| `amx_chattags`, `amx_ghostchat`, `amx_rtv` | two archive variants exist; provenance picked one, but the built binary is 9–13 % larger than the deployed one, so the deployed build had something this build does not (most likely the 1.10 release compiler) |
| `admin_sql` | reconstructed source; the deployed binary is the AMXX official build. Leave it disabled. |
| all 7 `bg_*` guard plugins + `bypass_guard` + `ab_bypass_bridge` | see `docs/RUNBOOK.md` §6 — the chain is deliberately not enabled |

The three plugins whose binaries exist but which `plugins.ini` does not load
(`bypass_guard`, `ab_bypass_bridge`, `freenova_http_probe`) are unchanged for
the same reason; their *sources* are now in the tree and compile.

## 7. Includes recovered (21)

`amxxpc` 1.10.0.5467 dies with `std::bad_alloc` instead of naming a missing
include, which is why the three unbuildable plugins took a whole round of
guessing. All 21 files below were copied from `ALL-CENTRAL/include/`; for every
one of them **every archive copy on the machine is byte-identical**, except
`iphubclient.inc`, so there is no variant question to answer — including for
`bypass_guard.inc` (four copies, all 10 568 B, all the same md5).

| include | bytes | copies in archive / distinct | required by |
|---|---:|---|---|
| `fn_maps.inc` | 344 | 2 / 1 | `adminvote_ab`, `amx_rtv`, `fn_admincmd` |
| `fn_chat.inc` | 409 | 2 / 1 | `amx_chattags`, `amx_ghostchat`, `fn_perf` |
| `fn_menus.inc` | 154 | 2 / 1 | `fn_admin` |
| `fn_perms.inc` | 1 780 | 2 / 1 | `fn_admin`, `fn_pinfo` |
| `fn_hud.inc` | 529 | 2 / 1 | `fn_afk` |
| `fn_bans.inc` | 759 | 2 / 1 | `fn_ban_range`, `fn_menus`, `fn_moderation`, `fn_perf`, `fn_scan` |
| `fn_moderation.inc` | 577 | 2 / 1 | `fn_pinfo`, `fn_reports` |
| `fn_link.inc` | 568 | 2 / 1 | `fn_moderation` |
| `fn_state.inc` | 713 | 2 / 1 | `fn_modes`, `fn_perms` |
| `fn_guard.inc` | 204 | 2 / 1 | `fn_policy` |
| `fn_admin.inc` | 449 | 2 / 1 | `fn_menus` |
| `fn_settings.inc` | 501 | 2 / 1 | `fn_welcome` |
| `bypass_guard.inc` | 10 568 | 4 / 1 | `bypass_guard`, `ab_bypass_bridge`, all 6 `bg_*` |
| `easy_http.inc` | 25 308 | 2 / 1 | `freenova_http_probe` |
| `easy_http_json.inc` | 25 874 | 2 / 1 | (pulled in by `easy_http.inc`) |
| `grip.inc` | 37 980 | 2 / 1 | `bg_provider_ip-api`, `bg_provider_iphub` |
| `curl.inc` | 9 452 | 2 / 1 | `bg_provider_iphub_curl` |
| `curl_consts.inc` | 52 873 | 2 / 1 | (pulled in by `curl.inc`) |
| `iphubclient.inc` | 3 985 | 4 / **2** | `bg_provider_iphubclient` |
| `pg_crypto.inc` | 11 322 | 4 / 1 | `backend_pg_sync` |
| `amx_banpersist.inc` | 282 | 3 / 1 | `fn_admincmd` |

`iphubclient.inc` is the only genuine choice: 3 985 B (`ALL-CENTRAL/`,
`BAN AMXX CS 1.6/modules/`, `FreeNova-Unified/include/vendor/`) against 3 842 B
in `FREENOVA System/`. The 3 985 B copy was taken because it is the one the
deployed build used — `FreeNova-Unified/include/vendor/iphubclient.inc` — and the
plugin still builds to +8.3 % of its deployed binary with it.

The missing-include scanner in `tools/compile-plugins.sh` is unchanged and still
reports `missing include(s):` on a real failure, so the next time a third-party
header goes walkabout the failure names it instead of printing `std::bad_alloc`.

## 8. Verification

* `tools/compile-plugins.sh` → **compiled: 137  failed: 0  allowed-failures: 0**,
  exit 0, no warnings in any of the 137 logs. `bypass_guard`, `ab_bypass_bridge`
  and `freenova_http_probe` now build, so the default `KNOWN_UNBUILDABLE`
  allowlist is empty — the mechanism stays, and `ALLOW_FAIL="name.sma"` still
  works for the next genuinely unbuildable source.
* The local ReHLDS harness boots the FreeNova profile with the whole stack
  (see `REVIEW.md` §9e for the before/after console comparison).

## 9. What is left for an operator

1. Decide whether to install any of the §6 binaries. Nothing here requires it.
2. `MANIFEST-game-server.sha256` was **not** regenerated: doing so from this
   working tree would bake in another agent's in-flight edits. Refresh it once,
   after the round is merged —
   `find game-server -type f -print0 | sort -z | xargs -0 sha256sum > MANIFEST-game-server.sha256`.
3. The two remaining plugin behaviours nobody has re-checked since the sources
   were lost: `fn_settings` (+17.6 %) and `amx_profiles` (+15.8 %) — both loaded
   live. A one-map boot with `amx_plugins` captured before and after a swap is
   enough to settle them.
