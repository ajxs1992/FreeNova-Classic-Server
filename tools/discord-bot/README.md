# FreeNova Discord bot

`/status`, `/players`, `/map`, `/top`, `/events` for the Classic server, plus a
live presence line (`de Dust2 · 9/32`). It reads the server directly over A2S
and the public leaderboard over HTTPS, so it keeps answering when the panel is
down.

Config lives outside the repo: `~/.config/freenova-bot/config.json` (mode 600)
with the bot token - never commit it. The runtime is a venv at
`~/.local/share/freenova-bot/venv` (`python3 -m venv` + `pip install "discord.py>=2.4"`).

```sh
# by hand
~/.local/share/freenova-bot/venv/bin/python tools/discord-bot/bot.py

# or as the systemd user unit
systemctl --user restart freenova-bot.service
journalctl --user -u freenova-bot.service -f
```

`/events` reads `~/.config/freenova-bot/events.json` - write a list of
`{"title": "...", "when": "...", "detail": "..."}` objects there and the command
renders it; when the panel starts publishing a schedule this is the file it
should be generated into.
