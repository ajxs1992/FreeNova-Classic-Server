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
