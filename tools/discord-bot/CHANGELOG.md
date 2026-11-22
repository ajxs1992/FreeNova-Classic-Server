# FreeNova Discord bot - changelog

One line per change, with the verification that was actually run. Newest last.

## 2026-11-22

- **Robustness pass** (`bot.py`): A2S results are cached for 5 s (`TTLCache`,
  negative results too), every command defers first and answers from a worker
  thread within ~3 s, commands run through `command_guard` (log + apology
  instead of a dying handler), `bot.tree.error` catches app-command failures,
  and `main()` rebuilds the bot and reconnects with 5 s → 300 s backoff instead
  of exiting. Logging now goes through `logging` so the journal has levels and
  timings. Config loading never raises (missing/broken file → defaults), so
  `import bot` works offline.
  *Verified:* `py_compile` clean; unit import check of the pure helpers
  (`fmt_duration`, `next_map`, `parse_a2s_info`, `parse_a2s_players` against
  junk/truncated/empty replies); live probes against `193.70.81.30:27015`
  returned the advertised map and 9 players; a dead port returned `None`;
  `systemctl --user restart` → journal shows fresh login
  (`logged in as FreeNova CS 1.6 Bot#7057`) and `synced 5 command(s): events,
  map, players, status, top`; REST `GET /applications/{id}/guilds/{guild}/commands`
  confirms the same five names. Slash-command invocation itself needs a human.

- **Presence that tells a story** (`bot.py`): `presence_for()` is a pure helper
  that picks the line from the A2S snapshot - `de Nuke · 9/32 · defuse` /
  `· 23 free` / plain, rotating the hint each refresh, `0/32 · waiting for
  players` when empty, `· full house` when full, and an idle
  `watching for the server to come back` when the server does not answer. The
  loop is floored at 30 s regardless of config, and the presence is only
  written when the line actually changes.
  *Verified:* `py_compile`; pure-helper check of all five states plus map-kind
  detection; restart → journal shows `presence: de Nuke · 9/32 · defuse (live)`.
  Note: "warmup"/"knife round" are **not** detectable over A2S - A2S_PLAYER
  carries no round state and A2S_RULES (cvars such as `mp_freezetime`) only
  arrives as a ~40-datagram split reply that is lossy in practice (probed: two
  of many chunks arrived). The code documents this rather than guessing.

- **`/top` without scraping guesswork, plus week/month** (`bot.py`): rows now
  come from the public HTML board by stable class selectors (`table.champ`,
  `td.r2`/`td.r3`, `tr.row`, `td.idx`, `a.pname`, `span.xp`, `img.crest`) and
  are modelled as `LeaderRow`/`Leaderboard`. `fetch_leaderboard()` is the only
  seam that knows the source, and `_fetch_rows()` is the single function a JSON
  endpoint would replace (no JSON exists today: `/api/*`, `?format=json`,
  `?period=week` all return HTML or 404). `/top` gained `period`
  (All time / This week / This month) and `count` (1-15, default 10). Week and
  month answer honestly that the board does not publish those rankings yet
  (`PERIOD_DATA_AVAILABLE`), instead of inventing numbers.
  *Verified:* `py_compile`; parser run against the live `/top15` page - 15 rows
  with rank, name, steamid, XP, rank tier, level and last-seen all correct
  (rank 1 `ajxs 24,889 XP · Supreme Master First Class · L18`); week/month
  return `note_kind=period`; an unreachable base returns `note_kind=unavailable`;
  empty/garbage HTML returns `[]`; restart → 5 commands synced and REST shows
  `/top ... [period, count]`, which also proves options survive `command_guard`.

- **`/profile <name or STEAM_0:x:y:z>`** (`bot.py`): resolves a STEAM_0 id
  directly, otherwise searches the board (`/top15?q=`) and requires a single
  exact name match - other players with that name are counted in the footer,
  and anything inexact is answered with a short candidate list instead of a
  guess. The board's search silently misses names with `_`/symbols, so a
  loosened prefix retry runs and is only accepted on an exact name match.
  The reply is two embeds: career snapshot (mint `#36DEAB`: level, rank tier,
  server rank, XP, K/D, HS%, playtime, wins, MVP, skill/VIP/medals, crest
  thumbnail, profile link) and battle pass (gold `#e8c547`: tier, XP, next rank
  and XP to go). Ephemeral, because it is personal data. "Coins" are not shown
  because the board does not publish a coin balance publicly (checked
  `/profile`, `/shop`, `/vip`, `/battlepass`, `/statsviewer`).
  *Verified:* `py_compile`; `parse_profile_html` against the live page returns
  every field (ajxs: L18, 24,889 XP, rank #1, 7h 27m, BP Tier 18/60 889/1000,
  `Supreme Master First Class → Global Elite · 5,111 XP to go`); not-found page
  → `None`; name/STEAM/soft-hyphen variants resolve (`npc_known`, `ENZO_123`
  via the loosened retry); `STEAM_0:0:999999999` → "no snapshot yet";
  the real command callback was driven with a fake interaction (defer
  `thinking=True, ephemeral=True`, both embeds rendered); restart → 6 commands
  synced, REST shows `/profile ... [player]`.

- **`/events` for real** (`bot.py`): `events.json` is parsed into `Event`
  objects (`start`/`end` accept ISO-8601, epoch seconds or `YYYY-MM-DD HH:MM`;
  `when` stays as free text for undated entries), and `/events` renders a
  schedule with countdowns (`in 2 h 15 m`, `running now · ends in 45 m`,
  `ended 2 d ago`) plus Discord timestamps, sorted running → upcoming →
  undated → recently ended, with a `count` option (1-10). An
  `events_loop` every 30 s re-reads the file only when its mtime changes and
  posts **one** notice per transition (`🟢 … starts now`, `⚪ … has ended`) to
  `channels.events`, tracked in `~/.local/share/freenova-bot/state.json`
  (pruned after 14 days), so restarts never double-post. A running event also
  feeds the presence hint (`de Train · 9/32 · Knife night`).
  *Verified end-to-end:* a real event was written 35 s in the future with a
  60 s duration; the journal shows `posted started notice for event 'Bot smoke
  test'` then `posted ended notice`, the channel REST read shows exactly those
  two embeds one minute apart, `state.json` recorded `posted: [started]` then
  `[started, ended]`; with `presence_refresh` briefly 30 the journal shows
  `presence: de Train · 9/32 · Bot smoke test`, proving the hint wiring; the
  `/events` callback was driven with a fake interaction (1- and 2-event
  renders). Test event, state file and test messages were then removed and the
  bot restarted clean. Offline checks: parse of 7 mixed entries (running,
  upcoming, undated, junk, missing title), `fmt_delta` for 0 s…3 d 4 h, empty
  schedule text, and ended-event filtering (24 h window).

- **Automatic, rate-limited posts: daily digest + up/down notices** (`bot.py`):
  the presence loop became `monitor_loop` - one A2S probe per cycle now feeds
  the presence, a sample log (`~/.local/share/freenova-bot/samples.jsonl`, one
  JSONL line per probe, pruned to 7 days) and an up/down latch
  (`alert_transition()`, pure): two consecutive misses before "went down", one
  answer to say "is back". The digest runs at `digest.hour` (default 21:00
  local) with peak players + time, average, probe coverage, map of the day and
  the leaderboard leader; it postpones itself (5 min retry) if there are no
  samples yet, and posts once a day (`digest.last_day` in the state file).
  **Duplicate-alert judgement:** `tools/watch-server.py` (`freenova-watch`)
  already posts down/up + a 9:00 status digest through its own webhook. The bot
  therefore defaults to `alerts.updown: "auto"`, which suppresses its up/down
  notices when the watcher is *on duty* - detected as: its config exists with a
  non-empty webhook **and** its state file was written in the last 5 minutes
  (it rewrites it every interval). The digest is deliberately kept (`21:00`,
  player-focused, complementary to the watcher's uptime digest) and its hour is
  configurable. `alerts.updown: "on"|"off"` overrides the detection.
  *Verified live:* digest posted with real numbers (`Peak players 9/32 at …,
  Average 9.0/32, Probes 1 up / 1, Map of the day de_train, Leaderboard leader
  ajxs · 24,889 XP`) and its body read back through the REST API; a dead port
  with `updown: on, down_after: 1` produced `Server went down` (red) then
  `Server is back (de_train, 9/32)` (mint) - both read back; with
  `updown: auto` on the same host the journal shows `server down: notice
  suppressed (freenova-watch posts its own)` and no message; offline presence
  confirmed live (`presence: for the server to come back (offline)`). Offline
  checks: `digest_stats`/`digest_embed` on a fabricated 30-probe day, sample
  loading with a corrupt line, `prune_samples`, `watcher_on_duty` for
  fresh/stale/no-webhook/missing files, `updown_enabled` for all modes, and
  `alert_transition` over down→down→up→down→down including `down_after=1`.
  All test messages were deleted and the config/state restored afterwards.

- **Command hygiene** (`bot.py`): descriptions and options now read like a
  player wrote them (`/players` gained `count` 1-32 and a "showing 3 of 9,
  sorted by score" footer; `/map` title is the map's name; `/profile` says
  "rank, XP, battle pass and playtime"). One red `offline_embed()` card is used
  by `/status`, `/players` and `/map` instead of three different sentences; the
  palette is the site's (`#36DEAB` mint for state, `#7DD3FC` for live players,
  `#E8C547` for XP/battle pass, dim grey for "nothing to show", `#F07178` for
  trouble). `/profile` stays ephemeral. New `/help` builds itself from the live
  command tree (so it cannot go stale) and explains the presence line. Command
  sync is now single-source: with a `guild_id` the tree is synced to the guild
  and the global set is emptied (verified: 7 guild commands, `[]` global);
  without one it syncs globally. The journal no longer carries discord.py's
  voice/message-intent warnings (logger levels set), so a restart reads as
  login → sync → presence.
  *Verified:* `py_compile`; every command driven through the real callback with
  a fake interaction (`/help` lists all seven with their options, `/players
  3` renders the footer, `/map` shows `de Train · next de_aztec · 4/24`,
  `/top week` is dim with the honest note, `/top all` is gold) and the
  rendered embed colours are exactly the ones above; restart → journal shows
  `synced 7 command(s) to guild …; global set emptied`, `commands: events, help,
  map, players, profile, status, top`, `presence: de Train · 9/32 · defuse
  (live)`; REST shows the same seven names with their new descriptions.

- **Offline tests** (`test_bot.py`): 51 tests, no network, no token, no game
  server - every helper takes its input as an argument or is fed a saved HTML
  snippet, and `bot._http_get` / the probes are stubbed where a command needs
  them. Covers what the brief asked for and more: empty server
  (`parse_a2s_players` on a 0-count reply, `/players` render), malformed A2S
  replies (junk, wrong header, unknown kind, truncated, "says 2 players, has
  none"), missing mapcycle file and unknown map (`next_map`), an event that
  already ended (state, countdown, dropped from `/events`), plus the A2S TTL
  cache (burst → one probe, negatives cached, expiry), presence states and
  rotation, the `/top15` and profile parsers on fixtures, lookup paths
  (exact/ambiguous/not-found/no-snapshot/unreachable/STEAM-id-skips-search),
  embed colours, event parsing/countdowns, `StateStore` "announce once across a
  restart", `alert_transition`, `updown_enabled`, `watcher_on_duty`, sample
  log round-trip + pruning, `digest_stats`/`digest_embed`, and the real command
  callbacks driven through a fake interaction (defer flags, ephemeral
  `/profile`, empty-server render, exception → apology, the registered command
  table and its option order).
  *Verified:* `~/.local/share/freenova-bot/venv/bin/python tools/discord-bot/test_bot.py`
  → `51/51 tests passed in 2.10s`; and in a throwaway venv with pytest
  (`/tmp/pt-venv/bin/python -m pytest tools/discord-bot/test_bot.py -q`) →
  `51 passed`. The bot venv itself has no pytest, which is why the plain runner
  exists.

- **One string table, ready for translations** (`bot.py`): every user-facing
  string now lives in `STRINGS` keyed by id (`presence.*`, `mapkind.*`,
  `period.*`, `board.*`, `profile.*`, `events.*`, `digest.*`, `alert.*`,
  `cmd.*`, `offline.*`, `error.generic`) with `{placeholders}` filled by the
  embed builders - no sentence is assembled anywhere else. `t(key, **values)`
  resolves against `LANGUAGE` (from `config.json` → `"language"`, default
  `en`), falls back to English for a missing key and to the key for an unknown
  one, and never raises on a bad placeholder. Adding French or German is one
  more entry in `STRINGS` plus `"language": "fr"` - `set_language()` rejects an
  unknown code and keeps English. Command names/descriptions/options are
  translated at build time (so the synced command list is localised too) and
  the `/help` footer shows the language name.
  *Verified:* `py_compile`; the test suite grew three language tests - every
  `t("…")` key in the source exists in `STRINGS["en"]` (114 keys, 0 missing),
  a partial `test` table proves translate-with-English-fallback and
  `set_language("klingon") == "en"`, and a broken placeholder returns the raw
  template instead of raising → **54/54 tests pass**; all seven commands
  re-rendered through the fake interaction in English (help, status, players,
  map, top, profile, events) with identical output to before the refactor;
  restart → journal shows login, `synced 7 command(s)`, presence line and REST
  shows the same seven descriptions, so the sync still carries them.

- **Docs** (`README.md`): rewritten as the operator manual - what every command
  answers and what the bot posts on its own, how to run/restart it and which
  files it owns (`config.json`, `events.json`, `state.json`, `samples.jsonl`,
  the venv), the full config shape with what each key does and how to rotate the
  token, how to run the offline tests plus the two checks that need the real
  thing (`py_compile`, restart → journal), a five-step "add a command" recipe
  that starts with the string table, the `events.json` format, why the
  leaderboard is parsed from HTML and where the JSON seam is, the duplicate-alert
  judgement call in full, how to add a language, and an "If the bot is silent"
  section (unit state → journal messages and what each means: missing token,
  rotated token, revoked intent, sync failure, gateway/network blocked, stale
  cache, wrong channel permissions).
  *Verified:* every JSON example in the README parses; the commands, paths,
  config keys and defaults it documents were read back from `bot.py`
  (`DEFAULT_CONFIG`, `STRINGS`, `SAMPLE_PATH`, `WATCH_CONFIG`, `PERIOD_DATA_AVAILABLE`)
  and from the live config; the journal messages quoted are the ones observed in
  this session.

- **Sample log pruning** (`bot.py`): `prune_samples()` existed but nothing called
  it, so `samples.jsonl` would have grown forever (one line per probe).
  `maybe_prune_samples()` now runs on the first monitor cycle and then at most
  once a day (7-day window), and the loop logs how many rows survived.
  *Verified:* `py_compile`; new test `test_maybe_prune_samples_runs_once_a_day`
  (first cycle prunes, a second call inside the interval is skipped, the next
  day prunes again) → **55/55 tests pass**; restart → journal shows
  `sample log pruned: 20 row(s) kept` right after the first probe.

- **Per-user cooldowns on the expensive commands** (`bot.py`): `/profile`
  (2 per 20 s), `/top` and `/events` (3 per 30 s) go through
  `cooldown_remaining()`, a sliding-window helper in `command_guard`. A blocked
  call answers immediately and ephemerally ("Easy there - that one can be used
  again in 18s") and never reaches the leaderboard, so one person cannot hammer
  the public site through the bot. Buckets are in memory, so a restart clears
  them. Also `prune_samples()` now reads the log once instead of twice.
  *Verified:* `py_compile`; new tests `test_cooldown_remaining` (window slides,
  per-user isolation, rate 0 disables) and
  `test_command_guard_rate_limits_profile` (call 1 and 2 answer with the
  profile, call 3 is ephemeral "Easy there…" with no embed) → **57/57 tests
  pass**; restart → login, `synced 7 command(s)`, presence line, REST still
  shows the same seven commands.
