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

- **`/status` answers "when is it busiest?"** (`bot.py`): the embed gained a
  `Peak (24 h)` field computed from the bot's own probe samples
  (`digest_stats`, so no extra network) - `**21/32** at 19:40` - and it is
  simply absent until there is data. Two new string ids
  (`cmd.status.peak`, `cmd.status.peak_value`).
  *Verified:* `py_compile`; new test `test_status_shows_the_peak_from_samples`
  (no samples → no field; two samples → `**21/32**`) → **58/58 tests pass**;
  the real callback prints `Peak (24 h): **9/32** at <t:…>` for the live
  server, and a restart shows login, `synced 7 command(s)`, presence.

- **Honest failures from the leaderboard** (`bot.py`): the board sits behind
  Cloudflare, so a challenge or error page used to be parsed into zero rows and
  reported as "the board has no ranked players yet". Now `_fetch_rows()` checks
  the page actually contains the board markup (challenge/error page → `None`),
  `fetch_leaderboard()` says "I couldn't get the leaderboard … it may be down,
  or answering with a challenge page", and a profile page without the expected
  markup is reported as "something I can't read for `STEAM_…`" instead of
  "no snapshot". A genuinely empty board still reports `empty`.
  *Verified:* `py_compile`; two new tests - a fake Cloudflare challenge body →
  `note_kind="unavailable"` while a real-but-empty board → `"empty"`, and an
  unreadable profile page → `note_kind="unreachable"` with "can't read" in the
  note → **60/60 tests pass**; restart clean (login, `synced 7 command(s)`,
  presence) and `/top all` + `/profile ajxs` still render live data.

- **Digest retry + translated profile state** (`bot.py`): a digest that fails to
  post is retried on the next five-minute cycle and gives up after three tries
  (`digest_attempt_result()`), so a wrong channel id does not mark the day done
  silently nor log every five minutes all evening. The player's online/offline
  state from the profile page now goes through the string table too
  (`profile.state.online` / `profile.state.offline`) instead of being echoed in
  whatever language the site used.
  *Verified:* `py_compile`; tests `test_digest_attempt_result` (posted → done,
  failure → retry, three failures → give up, late success resets) and
  `test_profile_state_is_translated` (a French table turns `offline` into
  `hors ligne` in the headline) → **62/62 tests pass**; restart clean.

- **Lint clean** (`test_bot.py`): dropped a leftover `import logging`; `ruff
  check tools/discord-bot --select F,E9,B` now passes with no findings (it also
  reported nothing in `bot.py`). *Verified:* `All checks passed!` and
  `62/62 tests passed in 2.11s`.

- **Scheduled digest verified in the wild** (no code change): with the unit left
  running, the 21:00 digest fired on its own at 21:04 local - journal
  `daily digest for 2026-11-22: peak=9 map=de_dust2 posted=True (attempt 0)`,
  and the channel message read back through the REST API:
  `Peak players **9/32** at <t:…>, Average 8.8/32, Probes 45 up / 48,
  Map of the day de_dust2 · 78% of probes, Leaderboard leader ajxs · 24,889 XP`,
  footer `CS 1.6 Classic · last 24 h · A2S + public leaderboard`, colour
  `#36DEAB`; `state.json` then held `digest.last_day = 2026-11-22`.

- **`/status` reads the panel's public API** (`bot.py`): new API layer
  (`api_get`/`get_api` with a TTL cache, `ApiResult` carrying the panel's own
  error code, 429/5xx/timeouts never cached) and `server_state_from_api()`
  parsing `/api/public/status` defensively. `/status` now shows the panel's
  `map`/`players`/`max`/`online` and the running event, computes `next_map`
  from the mapcycle (the API always sends `null`), and states the source in the
  footer: `panel API · game push 12s ago`. A stale push is never smoothed over:
  the players field says the count is unknown while the push is stale, a
  `Panel data: 10 m old` field carries the age, and the A2S probe fills the
  count in (`panel API · 10 m old · player count from the A2S probe`). With no
  panel answer the card falls back to A2S and says why (`A2S probe · panel API
  is rate-limiting me` / `didn't answer`). Presence still uses A2S only.
  *Verified against production:* `GET /api/public/status` observed `200` with
  `{server:{name:"FreeNova CS 1.6 | fn-gaming.net",map:"de_dust2",online:true,
  players:1,max:32,next_map:null,last_push:1795376528,stale:false},events:{now:
  [],next:null},updated:1795376555}`; the real `/status` callback rendered
  `Map de_dust2 · Players 0/32 · Next map de_inferno · Peak (24 h) 10/32`,
  footer `panel API · game push 7s ago`; tests 71 → 72.

- **`/top` is the JSON board now; the HTML parser is gone** (`bot.py`):
  `fetch_leaderboard()` is async and reads `/api/public/top?period=&metric=&limit=`
  (always `limit=15` so one cache entry serves every `count`), and
  `leaderboard_from_api()` builds the internal `Leaderboard` from
  `rows`/`window`/`coverage`/`total`/`updated`. `parse_top_html`, `_fetch_rows`
  and `PERIOD_DATA_AVAILABLE` are deleted; `LeaderRow` now carries
  `rank/name/steamid/value/metric` (`13 kills`, `1 kill` - plural handled).
  `/top` gained a `metric` option (XP / Kills) and the title carries the real
  window: `Top 10 · Week 47 · 2026`, `Top 3 kills · Lifetime`. `coverage` is
  never hidden: a partial week footers `Week 47 · 2026 · tracked since <date> ·
  15 players observed`, and an empty week says `No finished week yet - the
  board started tracking <date> (Week 47 · 2026) ... Lifetime numbers are on
  /top all` instead of "no data". 429 says the panel is rate-limiting the bot;
  the digest's leader line uses the same row shape (`· 24,889 XP`).
  *Verified against production:* observed `GET /api/public/top?period=all`
  `200` with `rows[{rank,steamid,name,value,metric,period}]`, `window.label
  "Lifetime"`, `coverage.complete:true`; `period=week` `200` with `rows: []`,
  `key "2026-W47"`, `window.label "Week 47 · 2026"`, `coverage
  {observed_players:16,first_seen:1795376533,complete:false}`; `metric=kills`
  `200` with `NPC_Leaders value 12`; the real callbacks rendered
  `Leaderboard · Week 47 · 2026` (dim, "No finished week yet - the board
  started tracking <date>"), `Top 10 · Lifetime` (gold, real XP rows) and
  `Top 3 kills · Lifetime` (`**1.** NPC_Leaders - 12 kills`). Tests 72 → 78.

- **`/profile` is the player API plus an A2S liveness check** (`bot.py`):
  `lookup_profile()` is async and resolves the query to a steamid first
  (`STEAM_0:0:123`, the packed `0-0-123`, or a name via the board's search page
  - the one thing the API does not do), then reads
  `/api/public/player/<steamid>` (`PlayerProfile`, 60 s cache). The HTML profile
  parser, its `Profile` dataclass and the fixtures are deleted; only
  `parse_search_html` remains, for names. The embed now shows what the API
  actually publishes: server rank (`Unranked` when `rank` is null), playtime,
  coins (`2,400`) and **badges as plain text** (`Weekly #1 · Week 46 · 2026 ·
  Weekly top 3 · Week 45 · 2026`, or "none yet"), plus a gold Battle Pass card
  (`Tier 18 / 60 · 17,889 BP XP`, `Progress 889 / 1,000 XP · 111 to the next
  tier`, `max tier reached` at 60). A2S decides the live line: `in game now ·
  7h 27m played, 12 pts` by name match, `n players share this name`, `not on
  the server right now`, or "couldn't check the live player list"; the footer
  says `panel stats`. A 404 from the API is a real "no snapshot"; a 400 is
  "I couldn't read that as a steamid"; 429/timeout say so.
  *Verified against production:* `GET /api/public/player/STEAM_0:0:683671116`
  and the packed `0-0-683671116` both `200` with
  `{name:ajxs,rank:1,bp_tier:1,bp_xp:0,bp_next_xp:1000,bp_progress:0,
  bp_tier_xp:1000,bp_max_tier:60,coins:999862237,playtime_minutes:447,
  badges:[],updated:…}`; `STEAM_0:0:999999999` → `404 player_not_found`;
  `garbage` → `400 bad_steamid`; the real callback rendered `ajxs · Server rank
  #1 · not on the server right now · Playtime 7h 27m · Coins 999,862,237 ·
  Badges none yet` + `Tier 1 / 60 · 0 BP XP`; a third call inside 20 s was
  answered with the cooldown. Tests 78 → 83.

- **`/events` reads the panel schedule** (`bot.py`): `refresh_events()` is async
  and merges `/api/public/events` (5-minute cache) with `events.json`, where a
  file entry whose title matches a panel row **overrides** it (ops can pin).
  `parse_panel_events()` maps the panel's own lifecycle state onto the bot's:
  `active`→running, `scheduled`→upcoming, `overdue`→**overdue**, `unscheduled`→
  undated, `ended`/`cancelled`→ended/cancelled, so a row the scheduler never
  activated is shown as `🟠 was due 2 h ago · the scheduler has not started it`
  and is never announced as running. The embed carries the panel's own markers
  and a footer naming the source (`Panel schedule · updated <t:…>` /
  `· plus events.json` / `events.json only · the panel schedule didn't answer`).
  Start/end notices are unchanged in wording and destination, but transitions
  now have a 30-minute **grace window**: a bot restarting mid-event marks the
  old transition as announced instead of shouting "starts now" for something
  from noon (`StateStore.transitions(..., grace=ANNOUNCE_GRACE)`, `store.dirty`
  persists the skip). The presence hint now comes from that merged list too.
  *Verified against production:* `GET /api/public/events` observed `200` with
  `{events:[], now:0, next:null, updated:1795377478, source:"panel"}` - the live
  `/events` rendered "Nothing scheduled" with `Panel schedule · updated <t:…>`;
  with a real pinned `events.json` (two entries) the same live call rendered
  `🕒 Pinned ops cup - in 59 m` + `🗓 Community night` and the footer
  `Panel schedule · updated <t:…> · plus events.json`, then the pin was removed;
  restart logs `events: 0 panel + 0 pinned = 0 event(s) [panel]`. Offline: panel
  state mapping (all six states), file-overrides-title merge, overdue/cancelled
  markers, file fallback footer, 5-minute cache (two reads → one request), and
  stale-transition skipping. Tests 83 → 91.

- **`/status` cross-checks the panel push against A2S** (`bot.py`): the command
  now asks the panel **and** the game server at the same time (`asyncio.gather`,
  so the answer time is the slower of the two, not the sum). When the two agree
  the card is the panel's; when they disagree - observed live:
  `last_push` 11 s old, `stale:false`, `players:0` while A2S saw 9 - the card
  shows the **A2S** count, a `Panel push says: 0/32 - the A2S count above is
  live` field, and the footer
  `panel API · game push 9s ago · its player count disagrees, so the A2S count is shown`;
  the journal logs `panel push says 0/32 but A2S says 9/32 - showing A2S`.
  *Verified against production:* the real callback rendered exactly
  `Players: **9/32**`, `Panel push says: 0/32`, that footer, with
  `GET /api/public/status` at the same moment reporting `players: 0, stale:
  false, last_push: now-11s` and an A2S probe reporting `9/32` (three rounds,
  same result). This is a panel/game-push bug outside this bot's boundary -
  reported, not worked around silently. Tests 91 → 92 (a fresh-but-wrong push
  keeps the A2S number and names the panel's).

- **Post-crash tidy** (`bot.py`, `test_bot.py`): the events reload log no longer
  repeats every 30 s when the schedule is empty (it compares
  `(source, count)` against the cache instead of re-computing the count), and
  the badge fixture now carries all four kinds the API can award
  (`weekly_champion`, `monthly_champion`, `weekly_top3`, `weekly_streak3`), each
  asserted as plain text in the profile embed. *Verified:* `py_compile`, `ruff
  --select F,E9,B` clean, **92/92 tests**; restart → one
  `events: 0 panel + 0 pinned = 0 event(s) [panel]` line and a quiet journal
  afterwards; all four API-backed commands re-rendered against production.
