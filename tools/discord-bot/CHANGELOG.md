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
