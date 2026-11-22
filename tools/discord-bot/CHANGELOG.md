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
