# Operations — what runs unattended, and what to do when it shouts

Everything in this file is about the **operations machine** (the box this
snapshot is worked on, user `ajxs`), not about the two live hosts. The live
hosts are described in `docs/RUNBOOK.md`; this is the machinery that watches
them and keeps a copy of them.

Two systemd **user** units do all of it:

| Unit | Kind | What it does |
|---|---|---|
| `freenova-watch.service` | long-running | probes `CS 1.6 Classic` over A2S every 60 s; posts to Discord when it stops answering (2 misses), when it comes back, and once a day with a digest |
| `freenova-backup.service` | oneshot, started by `freenova-backup.timer` | mirrors both hosts into the private `backup-freenova` repository, then commits and pushes |

They are user units, so every `systemctl`/`journalctl` call needs the user bus:

```sh
export XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
systemctl --user list-units 'freenova-*'
systemctl --user list-timers freenova-backup.timer
```

Both are enabled at login (`default.target.wants/`, `timers.target.wants/`) and
survive a reboot. Unit files live in `~/.config/systemd/user/`:

```
freenova-watch.service
freenova-backup.service
freenova-backup.timer
```

## 1. Where the configuration and the logs live

All of it is **outside this repository** and must stay there: it holds the
Discord webhook and the two SFTP passwords.

| Path | Mode | What it is |
|---|---|---|
| `~/.config/freenova-watch/watch.json` | 600 | probe interval, failure threshold, digest hour, webhook URL, the servers to probe |
| `~/.config/freenova-watch/backup.json` | 600 | backup repository path, askpass helper, and both SFTP sources with their exclude lists |
| `~/.config/freenova-watch/s1.pass`, `s2.pass` | 600 | SFTP passwords for the game host and the panel host |
| `~/.config/freenova-watch/askpass.sh` | 700 | prints `$SFTP_PASS`; lets `sftp` authenticate without a tty |
| `~/.local/state/freenova-watch/state.json` | 600 | probe counters, last successful A2S answer, last digest day |
| `~/.local/state/freenova-watch/watch.log` | 600 | **state changes only** (down, recovered, digest, webhook failures) — the file to read after an alert |
| `journalctl --user -u freenova-watch` | — | every probe, one line a minute, plus the same state changes |

`.gitignore` ignores `freenova-watch/`, `*.pass` and `askpass.sh` by name, so a
stray copy inside the tree cannot be staged. There is no copy: the two tools
read the paths above by default.

The two tools themselves are in this repository and take an optional config
path as their only argument:

```sh
python3 tools/watch-server.py      # defaults to ~/.config/freenova-watch/watch.json
python3 tools/backup-pull.py       # defaults to ~/.config/freenova-watch/backup.json
```

## 2. Running either one by hand

```sh
cd /home/ajxs/projects/FreeNova-Classic-Server

# watcher: foreground, Ctrl-C to stop. Talks to Discord, so it is not a dry run.
python3 tools/watch-server.py

# backup: foreground, prints one line per batch, exits 0 when it pushed or had
# nothing to push. The first full pull is ~10-30 min; later runs are seconds to
# a couple of minutes.
python3 tools/backup-pull.py
```

Same thing through systemd, which is what you usually want:

```sh
systemctl --user restart freenova-watch.service     # after editing watch.json
journalctl --user -u freenova-watch -f -n 20        # watch it live
systemctl --user start freenova-backup.service      # run a backup now
journalctl --user -u freenova-backup -n 40          # what that run did
```

`freenova-backup.service` is oneshot: `start` blocks until the pull is done, and
the exit status is the tool's (`1` = a transfer or a push failed). Its journal
is the only place the per-batch progress goes; a failed push says so there.

## 3. Changing what is watched

All of it is in `~/.config/freenova-watch/watch.json`:

```jsonc
{
  "interval": 60,              // seconds between probe rounds
  "fail_threshold": 2,         // consecutive misses before it shouts
  "digest_hour": 9,            // local hour of the daily digest
  "webhook": "https://discord.com/api/webhooks/…",
  "servers": [
    {"name": "CS 1.6 Classic", "host": "193.70.81.30", "port": 27015}
  ]
}
```

- **Another port or another server**: add an entry to `servers` with a distinct
  `name`. The state key is `host:port`, so the same host on a second port is a
  separate entry. Then `systemctl --user restart freenova-watch.service`.
- **Quieter alerts**: raise `fail_threshold` (each unit is one minute).
- **Digest hour**: change `digest_hour`; the digest is sent once per day, the
  first round at or after that hour.
- The webhook is the same one the panel relays through
  (`web-panel/relay/relay.env`, `DISCORD_WEBHOOK_URL`). If it is rotated in
  Discord, update **both** — the tool does not read the panel's file.

**Known gap (2026-11-22).** The webhook currently configured answers
`404 Unknown Webhook` (`code: 10015`): it was deleted on Discord's side, and it
is the *only* webhook URL in the tree, so the panel relay is pointing at a dead
one too. The watcher keeps running and logs `webhook failed: …` to `watch.log`,
but nothing it sends reaches Discord. Two ways to close it, and the choice is
the owner's:

- regenerate a webhook in the alerts channel and put the URL into
  `watch.json` (and `DISCORD_WEBHOOK_URL` in `web-panel/relay/relay.env`), then
  `systemctl --user restart freenova-watch`; or
- move watch-day alerting onto the `freenova-bot` Discord application
  (`~/.config/freenova-bot/config.json`, token + the same alerts channel),
  which is what the bot already posts to — that needs a change to the tool, not
  to the config.

The watcher's own delivery path is otherwise proven: on 2026-11-22 the exact
test message was delivered to that channel (through the bot, because the
webhook was already dead), and the Discord API answered `200` with a message id.

## 4. Changing the backup

`~/.config/freenova-watch/backup.json`:

- `repo` — where the checkout lives (`/home/ajxs/backups/freenova-backup`).
- `askpass` — the helper that feeds `$SFTP_PASS` to `sftp`.
- `sources[]` — one entry per host: `name`, `host`, `port`, `user`,
  `passwordFile`, `local` (the directory name inside the backup repo),
  `excludeDirs` and `excludeGlobs`.

`excludeDirs` / `excludeGlobs` are matched on the **leaf name** only, and are
what keeps the snapshot ~670 MB instead of several GB: `steamapps`, `Steam`,
`valve`, `linux64`, `steamcmd`, `_retired`, `node_modules`, plus `*.so`,
`hlds_linux`, `hlds_run`, `hltv`, `core.[0-9]*` and the SQLite `-wal`/`-shm`
sidecars. See the backup repository's `README.md` for why each one is out.

Both hosts reject `sftp -r`, so the tool lists each directory with `ls -l` and
transfers one file at a time in batches of 200 inside a single `sftp` session.
It downloads only files whose size differs from the local copy, deletes local
files that vanished remotely, and rewrites `SNAPSHOT.md` before committing.
"The same size" is the whole change detector, deliberately: it is what makes a
nightly run cheap. A file edited to the *same* byte length between two nights
would be missed — nothing in this tree does that, and `git log` would show the
wrong night if it did.

**Cadence.** `freenova-backup.timer`:

```ini
[Timer]
OnCalendar=*-*-* 04:15:00
RandomizedDelaySec=120
Persistent=true
```

Change the time with `systemctl --user edit freenova-backup.timer` (it drops a
drop-in), then `systemctl --user daemon-reload` and
`systemctl --user restart freenova-backup.timer`. `Persistent=true` means a run
missed while the machine was off happens at the next boot. `RandomizedDelaySec`
keeps it from hitting the hosts at exactly `04:15:00`.

## 5. The backup repository

`https://github.com/ajxs1992/backup-freenova` — **private**, checked out at
`/home/ajxs/backups/freenova-backup`.

```
README.md          what it is, what is excluded, how to restore
SNAPSHOT.md        taken-at timestamp and a file count per tree (rewritten when a run moved files)
.gitignore         refuses *.pass, askpass.sh, node_modules/, SQLite sidecars, core dumps
game-server/       the live game tree as of the last run   (~4.2k files, ~630 MB)
web-panel/         the panel as of the last run            (~1.4k files, ~45 MB)
```

**Retention is the git history.** One commit per night, nothing pruned, no
tagging policy, no separate archive: `backup: YYYY-MM-DD HH:MM (n changed, m
removed)` is the per-night record, and every version of every mirrored file is
reachable with `git show <sha>:<path>`. A run with nothing new prints
`no changes (…)` and exits 0 **without** committing, so an idle night leaves no
commit. Deleting a file on the host deletes it in the next commit, which is why
the history matters.

The repository grows by whatever changed that night — usually a few plugin
sources, a config, a log. While players are on, the file that changes on almost
every run is the HLDS log (`game-server/cstrike/logs/L*.log`, appended for as
long as that map runs), so a night with activity always produces a commit; that
is the log being archived, not drift. To see where it stands:

```sh
cd /home/ajxs/backups/freenova-backup
git count-objects -vH          # size-pack: on-disk size of all history
git log --oneline | wc -l      # nights recorded
```

If it ever gets unwieldy, `git gc --aggressive --prune=now` first; as a last
resort, archive the repository and start a fresh history rather than rewriting
it. Nothing here expires, so a mistake is expensive: treat a push failure as a
problem to fix (the run exits 1 and the journal says so), never as a reason to
`push --force`.

Restoring one file:

```sh
cd /home/ajxs/backups/freenova-backup
git log --oneline -- game-server/cstrike/server.cfg   # pick the night
git show <sha>:game-server/cstrike/server.cfg > /tmp/server.cfg
```

then upload that one file over SFTP (`docs/RUNBOOK.md` §0 has the per-file
recipe). Do not restore a whole tree: the checkout is missing the engine and
Steam binaries on purpose.

## 6. When the alert fires

The Discord message looks like

    🔴 **CS 1.6 Classic is not answering** (2 failed A2S probes on 193.70.81.30:27015). Last seen: de_dust2 9/32.

Two minutes of no A2S answer is already suspicious, so look at the live box
before restarting anything:

1. **Read the watcher's own log first** — `tail -20
   ~/.local/state/freenova-watch/watch.log` shows whether it is a blip or whether
   it has been down for a while (each state change is one line), and
   `journalctl --user -u freenova-watch -n 30` shows the individual probes.
2. **Look at the game server's console** in the game host's control panel (the
   same place the SFTP credentials come from). That is the only place the last
   lines are — a crash-restart loop and a `Host_Error` look completely different
   there, and a map that failed to precache will say so by name.
3. **Read `cstrike/sys_error.log`** on the host (or in the backup, via
   `git show <sha>:game-server/cstrike/sys_error.log`). A `Host_Error:
   ED_ParseEdict: … item count is over the 512 limit` means a map is
   unrecoverable, not that the box is unhealthy — that is how `cs_havana` was
   retired.
4. **Restart from the host's panel** if the process is gone or wedged. A restart
   drops players; if the server answers A2S but players report problems, prefer
   `changelevel` from the console or `amx_map` (`docs/RUNBOOK.md` §2 step 5).
5. **Roll back** if it broke right after a deploy:

   ```sh
   cd /home/ajxs/backups/freenova-backup
   git log --oneline -5 -- game-server/cstrike/addons/amxmodx/configs/plugins.ini
   git show <sha>:game-server/cstrike/addons/amxmodx/configs/plugins.ini > /tmp/plugins.ini
   ```

   upload it, restart, then re-upload the plugin that caused it once it is fixed.
   `docs/DEPLOY-plugins.md` §“Rollback” has the per-file recipe.

6. When it comes back the watcher posts `🟢 **CS 1.6 Classic is back** after
   ~N min` by itself — nobody needs to clear anything. If the alert never
   arrived at all, see the webhook note in §3.
