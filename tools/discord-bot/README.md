# FreeNova Discord bot

A small, read-only Discord bot for **CS 1.6 Classic** (`193.70.81.30:27015`).

It answers questions about the game server straight from A2S over UDP and about
players from the public leaderboard over HTTPS, so it keeps working when the
web panel is down. It never writes to the game server.

| Command | What it answers |
| --- | --- |
| `/status` | server name, map, players, next map, probe time |
| `/players [count]` | who is on right now, by score, with time played |
| `/map` | current map, next map, position in the cycle |
| `/top [period] [count]` | the leaderboard (all time; week/month say they are not published yet) |
| `/profile <name or STEAM_0:x:y:z>` | rank, XP, K/D, playtime, battle pass (ephemeral) |
| `/events [count]` | the event schedule with countdowns |
| `/help` | the list above, generated from the live command tree |

Plus, automatically:

* a **presence line** under the bot's name - `de Dust2 · 9/32 · defuse`,
  rotating the hint between map type, free slots and a running event;
  `0/32 · waiting for players` when empty; idle
  `watching for the server to come back` when the game server stops answering;
* **event notices** - one `🟢 … starts now` and one `⚪ … has ended` per event;
* **a daily digest** at a configured hour - peak players, average, probe
  coverage, map of the day, leaderboard leader;
* **down/up notices** - unless the webhook watcher already posts them (below).

Everything the bot says lives in one string table, so English is a choice, not
a hard-coded decision (see *Language*).

---

## Run it

The runtime is a venv outside the repo; the token lives only in the config.

```sh
# the systemd user unit (this is how it runs in production)
export XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
systemctl --user status freenova-bot.service
systemctl --user restart freenova-bot.service
journalctl --user -u freenova-bot.service -n 40 --no-pager

# by hand, in the foreground (Ctrl-C to stop)
~/.local/share/freenova-bot/venv/bin/python tools/discord-bot/bot.py
```

Files it touches (none of them inside git):

| Path | What |
| --- | --- |
| `~/.config/freenova-bot/config.json` | config + bot token, mode `600` |
| `~/.config/freenova-bot/events.json` | the event schedule (see below) |
| `~/.local/share/freenova-bot/state.json` | announced events, down latch, last digest day |
| `~/.local/share/freenova-bot/samples.jsonl` | one probe sample per refresh, kept 7 days |
| `~/.local/share/freenova-bot/venv` | Python venv with `discord.py` |

## Config

`~/.config/freenova-bot/config.json`, mode `600`. Missing keys fall back to the
defaults in `bot.py`; a broken file logs an error and the bot starts with
defaults (it will refuse to start without a token).

```json
{
  "token": "…",
  "language": "en",
  "guild_id": "1574121446014320742",
  "channels": {"alerts": "…", "events": "…", "leaderboard": "…"},
  "server": {"name": "CS 1.6 Classic", "host": "193.70.81.30", "port": 27015},
  "mapcycle": "/home/ajxs/projects/FreeNova-Classic-Server/game-server/cstrike/mapcycle.txt",
  "leaderboard": "https://leaderboard.fn-gaming.net",
  "presence_refresh": 60,
  "alerts": {"updown": "auto", "down_after": 2},
  "digest": {"enabled": true, "hour": 21, "channel": "leaderboard"}
}
```

* `language` - the string table to use (`en` today).
* `guild_id` - when set, commands are synced **to that guild only** (instant on
  restart) and the global command set is emptied, so nothing appears twice.
  Without it the bot syncs global commands (up to an hour to appear).
* `channels` - `alerts`, `events`, `leaderboard`. A missing channel name just
  means that kind of post is skipped (and logged).
* `presence_refresh` - seconds between presence updates, floored at 30 because
  Discord rate-limits presence writes.
* `alerts.updown` - `auto` (default), `on`, `off`. See *Duplicate alerts*.
* `alerts.down_after` - consecutive failed probes before "server went down"
  (default 2, so one dropped UDP packet is not an outage).
* `digest.hour` - local hour for the daily digest; `digest.enabled: false`
  turns it off; `digest.channel` picks the channel key.

The token is read at startup only. To rotate it: paste the new one into
`config.json`, `systemctl --user restart freenova-bot.service`. Never put it in
this repository.

## Test it (offline)

```sh
~/.local/share/freenova-bot/venv/bin/python tools/discord-bot/test_bot.py
# or, anywhere pytest is installed:
python -m pytest tools/discord-bot/test_bot.py
```

Both run the same tests: no network, no token, no game server. They cover the
pure helpers (A2S parsing incl. malformed replies, `next_map`, map cycle
reading, presence states, countdowns, the leaderboard and profile parsers on
saved HTML, the up/down latch, sample statistics, pruning) and drive the real
command callbacks through a fake interaction (defer flags, ephemeral
`/profile`, empty server, an exception turning into an apology, the registered
command table).

After changing code, also do the two checks that need the real thing:

```sh
~/.local/share/freenova-bot/venv/bin/python -m py_compile tools/discord-bot/bot.py
systemctl --user restart freenova-bot.service && journalctl --user -u freenova-bot.service -n 30 --no-pager
```

The journal should show `logged in as …`, `synced N command(s) …`,
`commands: …` and a `presence: …` line. A slash command can only be *invoked*
by a human in Discord; everything up to the Discord API (parse, embed, colour,
option table) is covered by the tests.

## Add a command

1. Add the strings to `STRINGS["en"]` first (`cmd.<name>.desc`, field labels,
   any other text) - no literal sentence goes into the handler.
2. In `build_bot()`, next to the others:

   ```python
   @bot.tree.command(name="seed", description=t("cmd.seed.desc"))
   @command_guard()                      # defer, log, apology on failure
   @app_commands.describe(count=t("cmd.seed.count"))
   async def seed_cmd(interaction: discord.Interaction,
                      count: app_commands.Range[int, 1, 10] = 3) -> None:
       info = await get_info(server)     # cached A2S, never blocks the loop
       embed = discord.Embed(title=t("cmd.seed.title", n=count), colour=COLOUR_OK)
       await _reply(interaction, embed=embed)
   ```

   `@command_guard(ephemeral=True)` for anything personal.
3. Keep the work off the event loop: `await get_info(...)`/`get_players(...)`
   for A2S, `await _in_thread(func, ...)` for HTTP or file work that can block.
4. Add a test: a pure helper for the logic, and a fake-interaction call for the
   handler. `python tools/discord-bot/test_bot.py` must stay green.
5. Restart the unit and check the command appears (`/help` too - it is built
   from the tree, so it cannot go stale).

## Events

`~/.config/freenova-bot/events.json` is a list (or `{"events": [...]}`) of:

```json
[
  {"title": "Knife night", "detail": "Knives only, AWP off",
   "start": "2026-11-23T20:00:00Z", "end": "2026-11-23T22:00:00Z"},
  {"title": "Movie night", "when": "Sundays after 20:00"}
]
```

`start`/`end` accept ISO-8601 (`Z` or offset), epoch seconds or
`YYYY-MM-DD HH:MM` (read as UTC); `when` is free text for events without a
date. The bot re-reads the file within 30 s of a change and posts one start and
one end notice per event to `channels.events`, remembering what it announced in
`state.json` (so restarts do not double-post; bookkeeping is pruned after 14
days). `/events` shows running first, then upcoming, then anything that ended
in the last 24 hours.

## Leaderboard source

`https://leaderboard.fn-gaming.net` has no JSON API (`/api/*`, `?format=json`
and `?period=week` all answer 404 or the same HTML), so rows come from the
public HTML board by class selectors (`table.champ`, `td.r2`/`td.r3`,
`tr.row`, `td.idx`, `a.pname`, `span.xp`, `img.crest`). Player lookups use the
board's own search (`/top15?q=`) and then `/profile?steamid=…`.

`fetch_leaderboard()` is the only place that knows about the source;
`_fetch_rows()` is the one function a JSON endpoint would replace. Weekly and
monthly boards do not exist yet, so `/top week` and `/top month` say so rather
than inventing numbers - flip `PERIOD_DATA_AVAILABLE` when the board serves
them.

## Duplicate alerts (the judgement call)

`tools/watch-server.py` (`freenova-watch.service`) already probes the same
server and posts "went down"/"is back" plus a 09:00 digest through a webhook.
To avoid two notices per outage, the bot's own up/down notices are `auto`:
they are **suppressed when the webhook watcher is on duty**, detected as

* `~/.config/freenova-watch/watch.json` exists **with** a webhook, and
* `~/.local/state/freenova-watch/state.json` was written in the last 5 minutes
  (the daemon rewrites it every interval, so a fresh mtime means it is alive).

Set `"alerts": {"updown": "on"}` to force the bot's notices, `"off"` to never
send them. The daily digest is deliberately kept and defaults to 21:00 local:
different hour, different content (players, map of the day, board leader) from
the watcher's uptime digest.

## Language

`STRINGS` in `bot.py` is `{language: {id: template}}`; English is the only
entry today. To add French:

1. copy `STRINGS["en"]` into `STRINGS["fr"]` and translate the values (ids and
   `{placeholders}` stay as they are);
2. add `"fr": "Français"` to `LANGUAGE_NAMES`;
3. set `"language": "fr"` in `config.json` and restart.

Missing ids fall back to English, an unknown language code falls back to
English, and a bad placeholder logs a warning and returns the raw template
instead of breaking the command. The tests check that every `t("…")` key in
the source exists.

## If the bot is silent

1. **Is the unit running?**
   ```sh
   systemctl --user is-active freenova-bot.service
   systemctl --user status freenova-bot.service --no-pager
   ```
   `activating`/`failed` with `Restart=always` means it is crash-looping - go
   to the journal.
2. **Read the journal.**
   ```sh
   journalctl --user -u freenova-bot.service -n 80 --no-pager
   ```
   * `no token in …/config.json` → the config is missing or has no `"token"`;
     the bot exits with code 2.
   * `Discord rejected the token` (`discord.LoginFailure`) → the token was
     rotated or mistyped; paste the new one and restart. This is the expected
     reaction to a rotated token, not a crash loop.
   * `the bot needs a privileged intent …` → a privileged intent was revoked in
     the Discord developer portal; the bot only needs `bot` scope and no
     message-content intent, so re-enable what was switched off.
   * `command sync failed` → usually a permissions problem: the bot needs
     `applications.commands` in the guild. Commands stay as they were.
   * `gateway disconnected; discord.py will reconnect` / `reconnecting in Ns` →
     Discord or the network dropped; the bot rebuilds itself and retries with
     5 s → 300 s backoff. If it repeats for hours, check that outbound
     `discord.com:443` and the UDP A2S port are allowed (no DNS, no egress, a
     blocked gateway or a proxy will all look like this).
3. **Are the commands missing in Discord?** With `guild_id` set they sync on
   every restart (check for `synced N command(s) to guild …`); without it the
   global set can take up to an hour. `/help` lists what the bot registered.
4. **Does it answer but with old data?** A2S results are cached for 5 s and the
   presence refreshes every `presence_refresh` seconds; `/status` always probes
   (and falls back to "offline" within ~2 s). If the game server itself is
   down, the bot stays online and says so - that is not a bot problem.
5. **Nothing in the channel but the journal is fine?** Check the channel ids in
   `config.json` and that the bot has *Send Messages* + *Embed Links* there;
   "no events channel configured" / "could not resolve channel" in the journal
   names the missing piece.
