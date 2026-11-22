#!/usr/bin/env python3
"""FreeNova CS 1.6 Discord bot.

Answers questions about the Classic server and keeps a live presence:
`/status`, `/players`, `/map`, `/top`, `/events`, `/profile`. Data comes
straight from the game server (A2S over UDP), the map cycle file and the public
leaderboard, so the bot keeps working even when the panel is down.

Config: ~/.config/freenova-bot/config.json (mode 600, never in git)

    {
      "token": "…",
      "language": "en",                        # all strings live in STRINGS
      "guild_id": "1574…",                    # optional: instant command sync
      "channels": {"alerts": "…", "events": "…", "leaderboard": "…"},
      "server": {"name": "CS 1.6 Classic", "host": "193.70.81.30", "port": 27015},
      "mapcycle": "/home/ajxs/projects/FreeNova-Classic-Server/game-server/cstrike/mapcycle.txt",
      "leaderboard": "https://leaderboard.fn-gaming.net",
      "hourly_status_channel": null,
      "presence_refresh": 60,
      "alerts": {"updown": "auto", "down_after": 2},
      "digest": {"enabled": true, "hour": 21, "channel": "leaderboard"}
    }

Everything blocking (UDP A2S, HTTP) runs in a worker thread, the A2S result is
cached for a few seconds so command bursts cannot hammer the game server, and
every command answers within ~3 s even when the server is unreachable.

Run with the venv that has discord.py: ~/.local/share/freenova-bot/venv/bin/python
"""
from __future__ import annotations

import asyncio
import copy
import functools
import html
import json
import logging
import math
import os
import re
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

import discord
from discord import app_commands
from discord.ext import commands, tasks

log = logging.getLogger("freenova.bot")

HOME = os.path.expanduser("~")
CONFIG_PATH = os.path.join(HOME, ".config", "freenova-bot", "config.json")
EVENTS_PATH = os.path.join(HOME, ".config", "freenova-bot", "events.json")
STATE_PATH = os.path.join(HOME, ".local", "share", "freenova-bot", "state.json")

# Palette shared with https://leaderboard.fn-gaming.net
COLOUR_OK = 0x36DEAB        # FreeNova mint accent
COLOUR_BP = 0xE8C547        # battle-pass gold
COLOUR_LIVE = 0x7DD3FC      # live/player cyan
COLOUR_WARN = 0xF07178      # offline / problem
COLOUR_DIM = 0x5D7A6E       # quiet secondary

A2S_TTL = 5.0               # seconds a probe result is reused
PROBE_TIMEOUT = 2.0         # per A2S socket timeout
ANSWER_BUDGET = 2.5         # extra seconds a command may wait on a probe
HTTP_TIMEOUT = 6.0          # leaderboard fetch timeout


# --------------------------------------------------------------------- language
# Every user-facing string lives here, keyed by id, with `{placeholders}` for the
# values the embed builders pass in. English is the product language; a
# translation is one more entry in this dict (`config.json` -> "language"), and
# nothing else has to change. Keep the ids stable - they are the translation keys.
STRINGS: dict[str, dict[str, str]] = {
    "en": {
        # presence (the line under the bot's name)
        "presence.offline": "for the server to come back",
        "presence.empty": "{count} · waiting for players",
        "presence.full": "{map} · {count} · full house",
        "presence.live": "{map} · {count}",
        "presence.free": "{n} free",
        # map kinds, by prefix
        "mapkind.defuse": "defuse",
        "mapkind.hostage": "hostage rescue",
        "mapkind.awp": "AWP only",
        "mapkind.aim": "aim",
        "mapkind.iceworld": "iceworld",
        "mapkind.grenades": "grenades only",
        "mapkind.surf": "surf",
        "mapkind.kz": "kreedz",
        "mapkind.zombie": "zombie",
        "mapkind.deathrun": "deathrun",
        "mapkind.custom": "custom",
        "map.unknown": "unknown map",
        # periods
        "period.all": "all time",
        "period.week": "this week",
        "period.month": "this month",
        "period.adj.all": "all-time",
        "period.adj.week": "weekly",
        "period.adj.month": "monthly",
        # leaderboard
        "board.period_note": ("The board doesn't publish a {adj} ranking yet - it only carries "
                              "the season table, so I won't invent numbers. Weekly and monthly "
                              "resets are agreed; as soon as the board serves them this command "
                              "returns them."),
        "board.period_footer": "Weekly and monthly boards are not live yet - all-time is.",
        "board.unreachable": "I couldn't reach {url} just now.",
        "board.unreachable_title": "The leaderboard at {url} didn't answer in time.",
        "board.empty": "The board is reachable but has no ranked players yet.",
        "board.title": "Top {n} · {period}",
        "board.title_plain": "Leaderboard · {period}",
        "board.source": "Source: {host}",
        "board.row": "**{rank}.** {name}",
        "board.row_detail": "**{rank}.** {name} - {detail}",
        "board.xp": "{xp:,} XP",
        "board.seen": "seen {seen}",
        # profile
        "profile.need_query": "Give me a player name or a STEAM_0:x:y:z id.",
        "profile.unreachable": "I couldn't reach the leaderboard at {base} just now.",
        "profile.ambiguous": "No exact match for “{query}”. Closest players:",
        "profile.ambiguous_loose": ("No exact match for “{query}” - the board's search skips "
                                    "symbols, so here is what “{loose}” found:"),
        "profile.not_found": ("I can't find anyone called “{query}” on the leaderboard. Names have "
                              "to match what the player uses in game; a STEAM_0:x:y:z id always "
                              "works."),
        "profile.no_snapshot": ("There's no snapshot for `{steamid}` yet - the board records a "
                                "player after a few minutes on the server. Play a round and try "
                                "again."),
        "profile.title": "{name} ({country})",
        "profile.headline_level": "Level {level}",
        "profile.headline_rank": "{rank}",
        "profile.headline_server_rank": "Server rank #{rank}",
        "profile.headline_seen": "last seen {seen}",
        "profile.field.xp": "XP",
        "profile.field.kd": "K/D",
        "profile.field.hs": "HS%",
        "profile.field.playtime": "Playtime",
        "profile.field.wins": "Wins",
        "profile.field.mvp": "MVP",
        "profile.field.also": "Also",
        "profile.bp_title": "Battle Pass",
        "profile.bp_next_rank": "Next rank",
        "profile.footer": "{steamid} · {host}",
        "profile.footer_others": "{n} other player(s) share this name · {steamid} · {host}",
        "profile.lookup_title": "Profile · {query}",
        "profile.lookup_title_plain": "Profile",
        "profile.lookup_footer": "Ask again with the name exactly as shown, or the STEAM_0:x:y:z id",
        "profile.timeout_title": "Leaderboard timeout",
        "profile.timeout": "{base} didn't answer in time - try again in a moment.",
        # events
        "events.title": "Events",
        "events.empty": ("Nothing scheduled right now. Events are published in this channel and "
                         "in `events.json` - the schedule shows up here as soon as it is written."),
        "events.marker.running": "🟢",
        "events.marker.upcoming": "🕒",
        "events.marker.ended": "⚪",
        "events.marker.undated": "🗓",
        "events.line": "{marker} **{title}** — {countdown}",
        "events.countdown.running": "running now",
        "events.countdown.running_until": "running now · ends in {delta}",
        "events.countdown.upcoming": "in {delta}",
        "events.countdown.ended": "ended {delta} ago",
        "events.countdown.ended_plain": "ended",
        "events.countdown.undated": "date to be confirmed",
        "events.footer_running": "running now: {titles}",
        "events.footer_next": "next: {title}",
        "events.command_footer": ("Schedule: ~/.config/freenova-bot/events.json · times in your "
                                  "timezone"),
        "events.notice.start_title": "🟢 {title} starts now",
        "events.notice.end_title": "⚪ {title} has ended",
        "events.notice.ends": "Ends",
        "events.notice.ends_value": "{time} (in {delta})",
        "events.notice.footer": "FreeNova events · times in your local timezone",
        # monitoring
        "alert.down": "🔴 **{name}** is not answering ({fails} failed A2S probes in a row).",
        "alert.up": "🟢 **{name}** is back (`{map}`, {players}/{max}).",
        "alert.down_title": "Server went down",
        "alert.up_title": "Server is back",
        "alert.footer": "A2S probe · tools/discord-bot",
        "digest.title": "Daily digest · {date}",
        "digest.empty": "No player samples in the last 24 h, so there is nothing to summarise yet.",
        "digest.peak": "Peak players",
        "digest.peak_value": "**{peak}{max}**{at}",
        "digest.average": "Average",
        "digest.probes": "Probes",
        "digest.probes_value": "{up} up / {total}",
        "digest.map": "Map of the day",
        "digest.map_value": "`{map}` · {share:.0%} of probes",
        "digest.leader": "Leaderboard leader",
        "digest.leader_value": "**{name}**{xp}",
        "digest.footer": "{server} · last 24 h · A2S + public leaderboard",
        # commands
        "cmd.status.desc": "Live status of the FreeNova Classic server",
        "cmd.status.map": "Map",
        "cmd.status.players": "Players",
        "cmd.status.next": "Next map",
        "cmd.status.footer": "Updated {time} UTC",
        "cmd.status.address": "`{host}:{port}`",
        "cmd.status.peak": "Peak (24 h)",
        "cmd.status.peak_value": "**{peak}{max}**{at}",
        "cmd.players.desc": "Who is on the server right now",
        "cmd.players.count": "How many players to list (default 20)",
        "cmd.players.title": "{n} on {server}",
        "cmd.players.empty_title": "{server} is empty",
        "cmd.players.empty": "Nobody is on right now - the server is up and waiting for players.",
        "cmd.players.footer": "showing {shown} of {total} · sorted by score",
        "cmd.players.line": "`{rank:>2}.` **{name}** - {score} pts, {time}",
        "cmd.map.desc": "The current map and what comes next",
        "cmd.map.title": "Map · {map}",
        "cmd.map.now": "**Now:** `{map}`",
        "cmd.map.next": "Next",
        "cmd.map.cycle": "In the cycle",
        "cmd.map.no_cycle": "No mapcycle file configured - next map unknown",
        "cmd.top.desc": "The leaderboard - all time, or by week/month",
        "cmd.top.period": "Which board to show",
        "cmd.top.count": "How many players (default 10, max 15)",
        "cmd.top.choice.all": "All time",
        "cmd.top.choice.week": "This week",
        "cmd.top.choice.month": "This month",
        "cmd.profile.desc": "A player's rank, XP, battle pass and playtime",
        "cmd.profile.player": "Player name as used in game, or a STEAM_0:0:12345 id",
        "cmd.events.desc": "The event schedule, with countdowns",
        "cmd.events.count": "How many events to show (default 5)",
        "cmd.help.desc": "What this bot can do",
        "cmd.help.title": "What I can do",
        "cmd.help.description": ("I watch **{server}** over A2S and the public leaderboard - no "
                                 "panel needed."),
        "cmd.help.option": "`{option}` · {description}",
        "cmd.help.also_title": "Also",
        "cmd.help.also": ("My status line shows the live map and player count, turns into "
                          "*waiting for players* when the server is empty and *for the server to "
                          "come back* when it is down.\nEvent notices and the daily digest are "
                          "posted automatically."),
        "cmd.help.footer": "Leaderboard: {host} · {language}",
        # shared
        "offline.title": "{server} is offline",
        "offline.body": ("No answer from `{host}:{port}` on the last probe. The bot keeps trying; "
                         "this is the game server, not the panel."),
        "offline.footer": "A2S over UDP · checked just now",
        "error.generic": ("Something went wrong on my side - the server and the leaderboard are "
                          "still up. Try again in a moment."),
        "error.cooldown": "Easy there - that one can be used again in {seconds}s.",
    },
    # "fr": {…} - drop a translation in here and set "language": "fr" in config.json
}

LANGUAGE = "en"
LANGUAGE_NAMES = {"en": "English"}


def t(key: str, **values: Any) -> str:
    """One user-facing string, formatted. Unknown keys fall back to English, then to the key."""
    table = STRINGS.get(LANGUAGE) or STRINGS["en"]
    template = table.get(key)
    if template is None:
        template = STRINGS["en"].get(key, key)
    try:
        return template.format(**values)
    except (KeyError, IndexError, ValueError):
        log.warning("string %r could not be formatted with %s", key, sorted(values))
        return template


def set_language(name: str | None) -> str:
    """Pick the language from config; unknown/absent means English."""
    global LANGUAGE
    LANGUAGE = name if name in STRINGS else "en"
    return LANGUAGE


# ----------------------------------------------------------------------- config
DEFAULT_CONFIG: dict[str, Any] = {
    "token": "",
    "language": "en",
    "guild_id": None,
    "channels": {},
    "server": {"name": "CS 1.6 Classic", "host": "127.0.0.1", "port": 27015},
    "mapcycle": None,
    "leaderboard": "https://leaderboard.fn-gaming.net",
    "presence_refresh": 60,
    "samples_path": None,
    "alerts": {"updown": "auto", "down_after": 2},
    "digest": {"enabled": True, "hour": 21, "channel": "leaderboard"},
}


def _merge(base: dict, over: dict) -> dict:
    """Deep-merge ``over`` into a copy of ``base`` (dicts merge, everything else wins)."""
    out = copy.deepcopy(base)
    for key, value in (over or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str = CONFIG_PATH) -> dict:
    """Read the config file; never raise, so the module stays importable offline."""
    raw: dict = {}
    try:
        with open(path, encoding="utf-8") as fh:
            loaded = json.load(fh)
        if isinstance(loaded, dict):
            raw = loaded
        else:
            log.error("config %s is not a JSON object; using defaults", path)
    except FileNotFoundError:
        log.warning("config %s not found; using defaults", path)
    except (OSError, ValueError) as exc:
        log.error("config %s unreadable (%s); using defaults", path, exc)
    return _merge(DEFAULT_CONFIG, raw)


# -------------------------------------------------------------- pure formatting
def fmt_duration(seconds: int | float | None) -> str:
    """`7h 27m`, `12m`, `45s` - never negative, never `0h 00m`."""
    try:
        total = int(seconds or 0)
    except (TypeError, ValueError):
        return "—"
    if total <= 0:
        return "0m"
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    if m:
        return f"{m}m"
    return f"{s}s"


def humanise_map(mapname: str | None) -> str:
    """`de_dust2` -> `de Dust2`; unknown/empty input degrades quietly."""
    if not mapname or not mapname.strip():
        return t("map.unknown")
    name = mapname.strip()
    for prefix, label in (("de_", "de "), ("cs_", "cs "), ("awp_", "awp "), ("aim_", "aim "),
                          ("fy_", "fy "), ("he_", "he "), ("surf_", "surf "), ("kz_", "kz "),
                          ("zm_", "zm "), ("deathrun_", "deathrun ")):
        if name.startswith(prefix):
            return label + name[len(prefix):].replace("_", " ").title()
    return name.replace("_", " ").title()


def next_map(pool: list[str], current: str | None) -> str | None:
    """Map after ``current`` in the cycle; first map when ``current`` is unknown."""
    if not pool:
        return None
    if current in pool:
        return pool[(pool.index(current) + 1) % len(pool)]
    return pool[0]


def map_pool(path: str | None) -> list[str]:
    """Read a mapcycle.txt: one map per line, `//` comment lines skipped."""
    if not path:
        return []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.readlines()
    except OSError:
        return []
    return [ln.strip() for ln in lines if ln.strip() and not ln.strip().startswith("//")]


# --------------------------------------------------------------------- presence
# A2S gives us the map, the player count and per-player score/connect time -
# nothing about rounds. A2S_RULES (which would carry cvars such as mp_freezetime)
# only arrives as a 40-datagram split reply that is routinely lossy, so a
# "warmup"/"knife round" hint cannot be derived honestly today. What *is*
# observable is the map, the population and the map type, so the presence tells
# that story and rotates which part of it it shows.
MAP_KINDS: tuple[tuple[str, str], ...] = (
    ("deathrun_", "mapkind.deathrun"),
    ("surf_", "mapkind.surf"),
    ("kz_", "mapkind.kz"),
    ("zm_", "mapkind.zombie"),
    ("awp_", "mapkind.awp"),
    ("aim_", "mapkind.aim"),
    ("fy_", "mapkind.iceworld"),
    ("he_", "mapkind.grenades"),
    ("de_", "mapkind.defuse"),
    ("cs_", "mapkind.hostage"),
)


def map_kind(mapname: str | None) -> str:
    """Game mode implied by the map prefix, as a translated label."""
    name = (mapname or "").lower()
    for prefix, key in MAP_KINDS:
        if name.startswith(prefix):
            return t(key)
    return t("mapkind.custom")


@dataclass(frozen=True)
class Presence:
    """What the bot shows under its name, and how loudly."""

    kind: str                       # offline / empty / live / full
    verb: str                       # playing / watching
    text: str
    status: str                     # online / idle

    def as_tuple(self) -> tuple[str, str, str, str]:
        return (self.kind, self.verb, self.text, self.status)


def presence_for(info: dict | None, cycle: int = 0, event_title: str | None = None) -> Presence:
    """Pick the presence line for one refresh.

    ``cycle`` rotates the extra hint (map type, free slots, a running event) so
    the line is informative without flickering faster than Discord likes.
    """
    if not info:
        return Presence("offline", "watching", t("presence.offline"), "idle")

    players = int(info.get("players") or 0)
    maxp = int(info.get("max") or 0)
    mapname = info.get("map") or ""
    label = humanise_map(mapname)
    count = f"{players}/{maxp}" if maxp else str(players)

    if players <= 0:
        return Presence("empty", "playing", t("presence.empty", count=count), "online")
    if maxp and players >= maxp:
        return Presence("full", "playing", t("presence.full", map=label, count=count), "online")

    hints = [map_kind(mapname),
             t("presence.free", n=maxp - players) if maxp else "",
             event_title or ""]
    hint = hints[cycle % len(hints)] if hints else ""
    text = t("presence.live", map=label, count=count) + (f" · {hint}" if hint else "")
    return Presence("live", "playing", text, "online")


# ------------------------------------------------------------------ A2S protocol
def _udp_query(host: str, port: int, payload: bytes, timeout: float = PROBE_TIMEOUT) -> bytes | None:
    """One UDP round trip; `None` on timeout/refusal. Never raises."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(payload, (host, port))
        data, _ = sock.recvfrom(8192)
        return data
    except OSError:
        return None
    finally:
        try:
            sock.close()
        except OSError:
            pass


def _cstr(data: bytes, offset: int) -> tuple[str, int]:
    end = data.index(b"\x00", offset)
    return data[offset:end].decode("latin1"), end + 1


def parse_a2s_info(data: bytes | None) -> dict | None:
    """Parse an A2S_INFO reply (GoldSrc `m` or Source `I`). `None` when malformed."""
    if not data or len(data) < 6 or data[:4] != b"\xff\xff\xff\xff":
        return None
    kind = data[4:5]
    try:
        i = 5
        if kind == b"m":                       # GoldSrc (ReHLDS)
            i += 1                             # protocol byte
            _address, i = _cstr(data, i)
            name, i = _cstr(data, i)
            mapname, i = _cstr(data, i)
            _folder, i = _cstr(data, i)
            _game, i = _cstr(data, i)
            players, maxp = data[i], data[i + 1]
        elif kind == b"I":                     # Source
            i += 1                             # protocol byte
            name, i = _cstr(data, i)
            mapname, i = _cstr(data, i)
            _folder, i = _cstr(data, i)
            _game, i = _cstr(data, i)
            i += 2                             # app id
            players, maxp = data[i], data[i + 1]
        else:
            return None
    except (IndexError, ValueError):
        return None
    return {"name": name, "map": mapname, "players": players, "max": maxp}


def parse_a2s_players(data: bytes | None) -> list[dict] | None:
    """Parse an A2S_PLAYER reply. `None` when the reply is unusable, `[]` when empty."""
    if not data or len(data) < 6 or data[:4] != b"\xff\xff\xff\xff" or data[4:5] != b"D":
        return None
    count, i, out = data[5], 6, []
    try:
        for _ in range(count):
            if i >= len(data):
                break
            i += 1                             # player index byte
            end = data.index(b"\x00", i)
            name = data[i:end].decode("latin1", "replace")
            i = end + 1
            score = struct.unpack("<i", data[i:i + 4])[0]
            i += 4
            seconds = struct.unpack("<f", data[i:i + 4])[0]
            i += 4
            out.append({"name": name, "score": score, "seconds": int(seconds)})
    except (IndexError, ValueError, struct.error):
        return out or None
    if count and not out:
        return None                            # declared players but nothing parsed: truncated
    return out


def probe_info(host: str, port: int, timeout: float = PROBE_TIMEOUT) -> dict | None:
    data = _udp_query(host, port, b"\xff\xff\xff\xffTSource Engine Query\x00", timeout)
    return parse_a2s_info(data)


def probe_players(host: str, port: int, timeout: float = PROBE_TIMEOUT) -> list[dict] | None:
    data = _udp_query(host, port, b"\xff\xff\xff\xffU\xff\xff\xff\xff", timeout)
    if data and data[4:5] == b"A":             # challenge: repeat with its token
        data = _udp_query(host, port, b"\xff\xff\xff\xffU" + data[5:9], timeout)
    return parse_a2s_players(data)


# ----------------------------------------------------------------- A2S caching
class _Miss:
    """Sentinel: the cache holds nothing for this key."""

    def __repr__(self) -> str:                 # pragma: no cover - debug only
        return "<cache miss>"


MISS = _Miss()


class TTLCache:
    """Tiny thread-safe TTL cache in front of the A2S probes.

    A burst of slash commands hits the game server at most once per ``ttl``
    seconds. Negative results are cached too, so an unreachable server is not
    hammered with UDP either.
    """

    def __init__(self, ttl: float = A2S_TTL) -> None:
        self.ttl = ttl
        self._lock = threading.Lock()
        self._items: dict[str, tuple[float, Any]] = {}
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Any:
        with self._lock:
            item = self._items.get(key)
            if item is None or item[0] < time.monotonic():
                self.misses += 1
                return MISS
            self.hits += 1
            return item[1]

    def put(self, key: str, value: Any, ttl: float | None = None) -> None:
        with self._lock:
            self._items[key] = (time.monotonic() + (self.ttl if ttl is None else ttl), value)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)


CACHE = TTLCache()


async def _in_thread(func: Callable[..., Any], *args: Any, budget: float = ANSWER_BUDGET) -> Any:
    """Run blocking work in a worker thread, bounded by ``budget`` seconds."""
    try:
        return await asyncio.wait_for(asyncio.to_thread(func, *args), timeout=budget)
    except (asyncio.TimeoutError, TimeoutError):
        log.warning("%s exceeded %.1fs budget", getattr(func, "__name__", func), budget)
        return None
    except Exception:                          # noqa: BLE001 - a probe must never kill a command
        log.exception("probe %s failed", getattr(func, "__name__", func))
        return None


async def get_info(server: dict, fresh: bool = False) -> dict | None:
    key = f"info:{server['host']}:{server['port']}"
    if not fresh:
        cached = CACHE.get(key)
        if cached is not MISS:
            return cached
    info = await _in_thread(probe_info, server["host"], int(server["port"]))
    CACHE.put(key, info)
    return info


async def get_players(server: dict, fresh: bool = False) -> list[dict] | None:
    key = f"players:{server['host']}:{server['port']}"
    if not fresh:
        cached = CACHE.get(key)
        if cached is not MISS:
            return cached
    players = await _in_thread(probe_players, server["host"], int(server["port"]))
    CACHE.put(key, players)
    return players


# ------------------------------------------------------------------ leaderboard
# One seam for the leaderboard source: `fetch_leaderboard()` is the only place
# that knows how the numbers are obtained. Today it parses the public HTML
# board at <base>/top15 (there is no JSON API: /api/* and ?format=json all
# answer 404/HTML). When the panel grows an endpoint, replace the body of
# `_fetch_rows()` with a JSON call and every command keeps working.
PERIODS = ("all", "week", "month")
PERIOD_LABEL = {"all": "period.all", "week": "period.week", "month": "period.month"}


def period_label(period: str) -> str:
    """`all time` / `this week` / `this month`, translated."""
    return t(PERIOD_LABEL.get(period, "period.all"))

# No period/weekly board is published yet, so asking for one says so instead of
# inventing numbers. Flip this to True the moment the source can serve it.
PERIOD_DATA_AVAILABLE = {"all": True, "week": False, "month": False}


def _http_get(url: str, timeout: float = HTTP_TIMEOUT) -> str | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FreeNovaBot/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError) as exc:
        log.warning("GET %s failed: %s", url, exc)
        return None


def _strip_tags(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()


def _text_of(block: str, pattern: str, group: int = 1) -> str:
    match = re.search(pattern, block, re.S)
    return _strip_tags(match.group(group)) if match else ""


def _int_of(block: str, pattern: str, group: int = 1) -> int | None:
    match = re.search(pattern, block, re.S)
    if not match:
        return None
    try:
        return int(match.group(group).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _steamid_of(block: str) -> str | None:
    match = re.search(r"steamid=([A-Za-z0-9_%:]+)", block)
    return urllib.parse.unquote(match.group(1)) if match else None


@dataclass(frozen=True)
class LeaderRow:
    rank: int
    name: str
    steamid: str | None = None
    xp: int | None = None
    rank_name: str | None = None
    level: int | None = None
    extra: str = ""

    def line(self) -> str:
        detail = " · ".join(part for part in (
            t("board.xp", xp=self.xp) if self.xp is not None else "",
            self.rank_name or "",
            f"L{self.level}" if self.level else "",
            self.extra or "",
        ) if part)
        if not detail:
            return t("board.row", rank=self.rank, name=self.name)
        return t("board.row_detail", rank=self.rank, name=self.name, detail=detail)


@dataclass(frozen=True)
class Leaderboard:
    period: str
    rows: tuple[LeaderRow, ...] = ()
    url: str = ""
    note: str = ""
    note_kind: str = ""            # "" | "unavailable" | "period" | "empty"

    @property
    def ok(self) -> bool:
        return bool(self.rows)


def parse_top_html(body: str) -> list[LeaderRow]:
    """Parse <base>/top15 into rows ordered by rank.

    Selectors used (stable class names, no positional assumptions):
    `table.champ` + `td.cxp` for the champion, `td.r2`/`td.r3` for ranks 2-3,
    `tr.row` + `td.idx` + `a.pname` + `span.xp` + `img.crest` for ranks 4+.
    """
    rows: list[LeaderRow] = []
    if not body:
        return rows

    champion = re.search(r"<table class='champ'.*?</table>", body, re.S)
    if champion:
        block = champion.group(0)
        name = _text_of(block, r"<a href='/profile\?steamid=[^']*'[^>]*>(.*?)</a>")
        if name:
            rows.append(LeaderRow(
                rank=_int_of(block, r"class='cplace'>\s*(\d+)") or 1,
                name=name,
                steamid=_steamid_of(block),
                xp=_int_of(block, r"class='cxp'>\s*<b>([\d,]+)</b>"),
                rank_name=_text_of(block, r"<img src='/ranks/rank_\d+\.png'[^>]*alt='([^']*)'"),
                level=_int_of(block, r"Level\s*(\d+)"),
            ))

    for match in re.finditer(r"<td class='r([23])'>(.*?)</td>", body, re.S):
        block = match.group(2)
        name = _text_of(block, r"<a href='/profile\?steamid=[^']*'[^>]*>(.*?)</a>")
        if not name:
            continue
        rows.append(LeaderRow(
            rank=_int_of(block, r"class='rplace'>\s*(\d+)") or int(match.group(1)),
            name=name,
            steamid=_steamid_of(block),
            xp=_int_of(block, r"class='rxp'>\s*([\d,]+)"),
            rank_name=_text_of(block, r"<img class='rcrest'[^>]*title='([^']*)'"),
            extra=_text_of(block, r"class='rmeta'>([^<]*)"),
        ))

    for match in re.finditer(r"<tr class='row'[^>]*>(.*?)</tr>", body, re.S):
        block = match.group(1)
        name = _text_of(block, r"class='pname'[^>]*>(.*?)</a>")
        if not name:
            continue
        crest = re.search(r"<img class='crest'[^>]*title='([^']*)'", block)
        seen = re.search(r"seen ([0-9a-z]+)", block)
        rows.append(LeaderRow(
            rank=_int_of(block, r"class='idx'>\s*(\d+)") or (len(rows) + 1),
            name=name,
            steamid=_steamid_of(block),
            xp=_int_of(block, r"class='metric'>\s*<span class='xp'>([\d,]+)</span>"),
            rank_name=_strip_tags(crest.group(1)) if crest else None,
            level=_int_of(block, r">\s*L(\d+)\b"),
            extra=t("board.seen", seen=seen.group(1)) if seen else "",
        ))

    rows.sort(key=lambda row: row.rank)
    return rows


def _fetch_rows(base: str, period: str) -> list[LeaderRow] | None:
    """Raw rows for one period - the single function a JSON endpoint replaces."""
    body = _http_get(f"{base}/top15")
    if body is None:
        return None
    return parse_top_html(body)


def fetch_leaderboard(base: str, period: str = "all", limit: int = 10) -> Leaderboard:
    """The leaderboard for one period, ready to render. Never raises."""
    period = period if period in PERIODS else "all"
    url = f"{base}/top15"
    if not PERIOD_DATA_AVAILABLE.get(period, False):
        return Leaderboard(
            period=period,
            url=url,
            note=t("board.period_note", adj=t(f"period.adj.{period}")),
            note_kind="period",
        )
    rows = _fetch_rows(base, period)
    if rows is None:
        return Leaderboard(period=period, url=url,
                           note=t("board.unreachable", url=url), note_kind="unavailable")
    if not rows:
        return Leaderboard(period=period, url=url, note=t("board.empty"), note_kind="empty")
    return Leaderboard(period=period, rows=tuple(rows[:max(1, limit)]), url=url)


# --------------------------------------------------------------------- profile
STEAMID_RE = re.compile(r"^STEAM_[0-9]:[0-9]:[0-9]{1,12}$", re.I)


def is_steamid(query: str) -> bool:
    """`STEAM_0:1:12345` (the form players see in game, any case)."""
    return bool(STEAMID_RE.match((query or "").strip()))


def normalise_steamid(query: str) -> str:
    return (query or "").strip().upper().replace(" ", "")


@dataclass
class Profile:
    """Everything the public profile page tells us about one player."""

    name: str
    steamid: str | None = None
    rank_name: str = ""
    level: int | None = None
    xp: int | None = None
    server_rank: int | None = None
    state: str = ""
    seen: str = ""
    country: str = ""
    crest: str = ""
    stats: dict[str, str] = field(default_factory=dict)
    bp_tier: str = ""
    bp_xp: str = ""
    next_rank: str = ""
    skill: str = ""
    vip: str = ""
    medals: str = ""
    url: str = ""

    def playtime(self) -> str:
        return self.stats.get("Playtime", "")


def parse_profile_html(body: str, url: str = "") -> Profile | None:
    """Parse `<base>/profile?steamid=…`. `None` when the player has no snapshot."""
    if not body or re.search(r"class='panel msg'", body):
        return None
    name_block = re.search(r"<div class='pbig'>(.*?)</div>", body, re.S)
    if not name_block:
        return None
    name = _strip_tags(name_block.group(1))
    if not name:
        return None

    sub = _text_of(body, r"<div class='psmall'>([^<]*)</div>")
    level = _int_of(sub, r"Lvl\s*(\d+)")
    seen = ""
    seen_match = re.search(r"seen (\S+)", sub)
    if seen_match:
        seen = seen_match.group(1)
    state = "offline" if "offline" in sub.lower() else ("online" if "online" in sub.lower() else "")

    stats: dict[str, str] = {}
    for match in re.finditer(r"<span class='sk'>([^<]*)</span>\s*<span class='sv'>([^<]*)</span>", body):
        key = _strip_tags(match.group(1))
        value = _strip_tags(match.group(2))
        if key and value:
            stats[key] = value

    bp_block = re.search(r"<span class='k'>Battle Pass</span>\s*<span class='v[^']*'>([^<]*)</span>"
                         r"(?:\s*<span class='sub'>([^<]*)</span>)?", body)
    skills = [_strip_tags(m) for m in re.findall(r"<div class='skillrow'>(.*?)</div>", body, re.S)]
    skill = next((s for s in skills if s.lower().startswith("skill")), "")
    vip = next((s for s in skills if "vip" in s.lower()), "")
    flag = re.search(r"flagcdn\.com/20x15/([a-z]{2})\.png", body)
    crest = re.search(r"<img class='bigcrest'[^>]*src='([^']+)'", body)
    medals = _text_of(body, r"class='medal-count'>([^<]*)")
    next_rank = _text_of(body, r"<table class='proghead'[^>]*>\s*<tr>\s*<td>([^<]*)</td>")
    next_rank_to_go = _text_of(body, r"<table class='proghead'[^>]*>\s*<tr>\s*<td>[^<]*</td>\s*"
                                     r"<td class='r'>([^<]*)</td>")

    return Profile(
        name=name,
        steamid=_steamid_of(body),
        rank_name=_text_of(body, r"<img class='bigcrest'[^>]*alt='([^']*)'"),
        level=level,
        xp=_int_of(body, r"class='pxpbig'>\s*([\d,]+)"),
        server_rank=_int_of(body, r"Server rank #(\d+)"),
        state=state,
        seen=seen,
        country=flag.group(1).upper() if flag else "",
        crest=crest.group(1) if crest else "",
        stats=stats,
        bp_tier=_strip_tags(bp_block.group(1)) if bp_block else "",
        bp_xp=_strip_tags(bp_block.group(2) or "") if bp_block else "",
        next_rank=(next_rank + (f" · {next_rank_to_go}" if next_rank_to_go else "")) if next_rank else "",
        skill=skill,
        vip=vip,
        medals=medals,
        url=url,
    )


def parse_search_html(body: str) -> list[tuple[str, str]]:
    """(steamid, name) pairs from the leaderboard search page, best first."""
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for match in re.finditer(r"<a[^>]*href='/profile\?steamid=([^']+)'[^>]*>(.*?)</a>", body, re.S):
        steamid = urllib.parse.unquote(match.group(1))
        name = _strip_tags(match.group(2))
        if not steamid or not name or steamid in seen:
            continue
        seen.add(steamid)
        found.append((steamid, name))
    return found


@dataclass
class Lookup:
    """Result of a `/profile` lookup, ready to render."""

    profile: Profile | None = None
    query: str = ""
    candidates: tuple[tuple[str, str], ...] = ()
    note: str = ""
    note_kind: str = ""            # "" | "not-found" | "ambiguous" | "unreachable"
    others: int = 0                # other players sharing the queried name
    url: str = ""

    @property
    def ok(self) -> bool:
        return self.profile is not None


def profile_url(base: str, steamid: str) -> str:
    return f"{base}/profile?steamid={urllib.parse.quote(steamid, safe='')}"


def _search_candidates(base: str, query: str) -> list[tuple[str, str]] | None:
    """(steamid, name) pairs the board's search returns; `None` when unreachable."""
    body = _http_get(f"{base}/top15?q={urllib.parse.quote(query)}")
    return None if body is None else parse_search_html(body)


def _loose_query(query: str) -> str | None:
    """The board's search misses names containing `_` (its LIKE pattern), so
    retry with the leading alphanumeric run - e.g. `ENZO_123` -> `ENZO`."""
    match = re.match(r"[A-Za-z0-9]{3,}", query)
    if match and match.group(0) != query:
        return match.group(0)
    return None


def lookup_profile(base: str, query: str) -> Lookup:
    """Resolve a name or STEAM_0:x:y:z and fetch that player's public profile.

    Never guesses between players: anything but a single exact name match is
    answered with a short list of candidates (or a plain "not found").
    """
    query = (query or "").strip()
    if not query:
        return Lookup(query=query, note=t("profile.need_query"), note_kind="not-found")

    steamid: str | None = normalise_steamid(query) if is_steamid(query) else None
    others = 0
    if steamid is None:
        candidates = _search_candidates(base, query)
        if candidates is None:
            return Lookup(query=query, url=f"{base}/top15",
                          note=t("profile.unreachable", base=base),
                          note_kind="unreachable")
        exact = [c for c in candidates if c[1].casefold() == query.casefold()]
        if exact:
            # names are not unique on a public server: take the highest-ranked
            # exact match (board order is rank order) and say so if there are others
            steamid = exact[0][0]
            others = len(exact) - 1
        elif candidates:
            return Lookup(query=query, candidates=tuple(candidates[:5]),
                          note=t("profile.ambiguous", query=query),
                          note_kind="ambiguous",
                          url=f"{base}/top15?q={urllib.parse.quote(query)}")
        else:
            loose = _loose_query(query)
            near = _search_candidates(base, loose) if loose else None
            exact_near = [c for c in (near or []) if c[1].casefold() == query.casefold()]
            if exact_near:
                steamid = exact_near[0][0]
                others = len(exact_near) - 1
            elif near:
                return Lookup(query=query, candidates=tuple(near[:5]),
                              note=t("profile.ambiguous_loose", query=query, loose=loose),
                              note_kind="ambiguous",
                              url=f"{base}/top15?q={urllib.parse.quote(loose or query)}")
            else:
                return Lookup(query=query, url=f"{base}/top15?q={urllib.parse.quote(query)}",
                              note=t("profile.not_found", query=query),
                              note_kind="not-found")

    url = profile_url(base, steamid)
    body = _http_get(url)
    if body is None:
        return Lookup(query=query, url=url, note=t("profile.unreachable", base=base),
                      note_kind="unreachable")
    profile = parse_profile_html(body, url)
    if profile is None:
        return Lookup(query=query, url=url,
                      note=t("profile.no_snapshot", steamid=steamid), note_kind="not-found")
    if not profile.steamid:
        profile.steamid = steamid
    return Lookup(profile=profile, query=query, url=url, others=others)


def profile_embeds(profile: Profile, base: str, others: int = 0) -> list[discord.Embed]:
    """Two cards: the rank/career snapshot (mint) and the battle pass (gold)."""
    headline = " · ".join(part for part in (
        t("profile.headline_level", level=profile.level) if profile.level is not None else "",
        t("profile.headline_rank", rank=profile.rank_name) if profile.rank_name else "",
        t("profile.headline_server_rank", rank=profile.server_rank) if profile.server_rank else "",
        profile.state,
        t("profile.headline_seen", seen=profile.seen) if profile.seen else "",
    ) if part)

    title = (t("profile.title", name=profile.name, country=profile.country) if profile.country
             else profile.name)
    main = discord.Embed(title=title, url=profile.url or None, colour=COLOUR_OK,
                         description=headline or None)
    if profile.crest:
        main.set_thumbnail(url=profile.crest if profile.crest.startswith("http")
                           else f"{base}{profile.crest}")
    if profile.xp is not None:
        main.add_field(name=t("profile.field.xp"), value=f"**{profile.xp:,}**", inline=True)
    for label_key, stat_key in (("profile.field.kd", "K/D"), ("profile.field.hs", "HS%"),
                                ("profile.field.playtime", "Playtime"),
                                ("profile.field.wins", "Wins"), ("profile.field.mvp", "MVP")):
        value = profile.stats.get(stat_key)
        if value:
            main.add_field(name=t(label_key), value=value, inline=True)
    extras = " · ".join(part for part in (profile.skill, profile.vip, profile.medals) if part)
    if extras:
        main.add_field(name=t("profile.field.also"), value=extras, inline=False)
    if profile.steamid:
        host = base.replace("https://", "")
        if others:
            main.set_footer(text=t("profile.footer_others", n=others, steamid=profile.steamid,
                                   host=host))
        else:
            main.set_footer(text=t("profile.footer", steamid=profile.steamid, host=host))

    embeds = [main]
    if profile.bp_tier or profile.bp_xp:
        bp = discord.Embed(title=t("profile.bp_title"), colour=COLOUR_BP,
                           description="\n".join(part for part in (profile.bp_tier,
                                                                   profile.bp_xp) if part))
        if profile.next_rank:
            bp.add_field(name=t("profile.bp_next_rank"), value=profile.next_rank, inline=False)
        embeds.append(bp)
    return embeds


def lookup_embed(result: Lookup) -> discord.Embed:
    """The honest answer when a lookup found nothing (or more than one player)."""
    title = (t("profile.lookup_title", query=result.query) if result.query
             else t("profile.lookup_title_plain"))
    embed = discord.Embed(title=title, url=result.url or None,
                          colour=COLOUR_WARN if result.note_kind != "ambiguous" else COLOUR_LIVE,
                          description=result.note)
    if result.candidates:
        embed.description = (result.note + "\n" + "\n".join(
            f"• **{name}** - `{steamid}`" for steamid, name in result.candidates))
        embed.set_footer(text=t("profile.lookup_footer"))
    return embed


# ------------------------------------------------------------------ monitoring
# Samples of the A2S probe, one JSONL line per refresh: what the digest and
# `/status` need for "peak players" and "map of the day". Kept for a week.
SAMPLE_PATH = os.path.join(HOME, ".local", "share", "freenova-bot", "samples.jsonl")
SAMPLE_KEEP = 7 * 86400
WATCH_CONFIG = os.path.join(HOME, ".config", "freenova-watch", "watch.json")
WATCH_STATE = os.path.join(HOME, ".local", "state", "freenova-watch", "state.json")


def append_sample(path: str, now: datetime, info: dict | None, maxp: int = 0) -> None:
    """Record one probe result (or one miss) for the daily digest."""
    line = json.dumps({"t": int(now.timestamp()),
                       "p": int(info["players"]) if info else None,
                       "m": info["map"] if info else None,
                       "max": int(info["max"]) if info else maxp})
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        log.warning("could not append a sample to %s: %s", path, exc)


def load_samples(path: str, since: float | None = None) -> list[dict]:
    """Read the sample log, ignoring broken lines and anything older than `since`."""
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except FileNotFoundError:
        return []
    except OSError as exc:
        log.warning("could not read samples %s: %s", path, exc)
        return []
    out: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if not isinstance(row, dict) or not isinstance(row.get("t"), (int, float)):
            continue
        if since is not None and row["t"] < since:
            continue
        out.append(row)
    return out


def prune_samples(path: str, keep: int = SAMPLE_KEEP, now: float | None = None) -> int:
    """Drop samples older than `keep` seconds; returns how many survived."""
    now = time.time() if now is None else now
    everything = load_samples(path)
    rows = [row for row in everything if row["t"] >= now - keep]
    if len(rows) != len(everything):
        try:
            tmp = f"{path}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                for row in rows:
                    fh.write(json.dumps(row) + "\n")
            os.replace(tmp, path)
        except OSError as exc:
            log.warning("could not prune samples %s: %s", path, exc)
    return len(rows)


def maybe_prune_samples(state: dict, path: str, now: float, keep: int = SAMPLE_KEEP,
                        interval: int = 86400) -> int | None:
    """Prune at most once per `interval` - returns survivors, or None when skipped.

    The sample log only ever grows otherwise (one line per probe), so the bot
    prunes it on its first cycle and then once a day.
    """
    last = float(state.get("pruned_at") or 0)
    if now - last < interval:
        return None
    state["pruned_at"] = now
    return prune_samples(path, keep, now)


def digest_stats(samples: list[dict], now: datetime, window: int = 86400) -> dict[str, Any]:
    """Peak players, average, map of the day and coverage for the last `window`."""
    since = now.timestamp() - window
    rows = [r for r in samples if since <= r.get("t", 0) <= now.timestamp()]
    up = [r for r in rows if isinstance(r.get("p"), int)]
    stats: dict[str, Any] = {"samples": len(rows), "up": len(up), "peak": None,
                             "peak_at": None, "average": None, "map": None,
                             "map_share": None, "max": None, "down_share": None}
    if not up:
        return stats
    peak = max(up, key=lambda r: r["p"])
    stats["peak"] = peak["p"]
    stats["peak_at"] = datetime.fromtimestamp(peak["t"], timezone.utc)
    stats["average"] = sum(r["p"] for r in up) / len(up)
    stats["max"] = max((r.get("max") or 0) for r in up) or None
    counts: dict[str, int] = {}
    for row in up:
        if row.get("m"):
            counts[row["m"]] = counts.get(row["m"], 0) + 1
    if counts:
        best = max(counts.items(), key=lambda kv: kv[1])
        stats["map"] = best[0]
        stats["map_share"] = best[1] / len(up)
    stats["down_share"] = 1 - len(up) / len(rows) if rows else None
    return stats


def digest_embed(stats: dict[str, Any], server: dict, leader: Any = None,
                 now: datetime | None = None) -> discord.Embed:
    """The daily summary: peak players, map of the day, leaderboard leader."""
    now = now or datetime.now(timezone.utc)
    embed = discord.Embed(title=t("digest.title", date=f"{now.astimezone():%a %d %b}"),
                          colour=COLOUR_OK)
    if stats.get("peak") is None:
        embed.description = t("digest.empty")
        embed.colour = COLOUR_DIM
        return embed
    free = f"/{stats['max']}" if stats.get("max") else ""
    peak_at = f" at <t:{int(stats['peak_at'].timestamp())}:t>" if stats.get("peak_at") else ""
    embed.add_field(name=t("digest.peak"),
                    value=t("digest.peak_value", peak=stats["peak"], max=free, at=peak_at),
                    inline=True)
    embed.add_field(name=t("digest.average"), value=f"{stats['average']:.1f}{free}", inline=True)
    embed.add_field(name=t("digest.probes"),
                    value=t("digest.probes_value", up=stats["up"], total=stats["samples"]),
                    inline=True)
    if stats.get("map"):
        embed.add_field(name=t("digest.map"),
                        value=t("digest.map_value", map=stats["map"], share=stats["map_share"]),
                        inline=True)
    if leader is not None:
        xp = f" · {leader.xp:,} XP" if getattr(leader, "xp", None) else ""
        embed.add_field(name=t("digest.leader"),
                        value=t("digest.leader_value", name=leader.name, xp=xp), inline=True)
    embed.set_footer(text=t("digest.footer", server=server["name"]))
    return embed


def watcher_on_duty(config_path: str = WATCH_CONFIG, state_path: str = WATCH_STATE,
                    max_age: float = 300, now: float | None = None) -> bool:
    """Is `tools/watch-server.py` already posting down/up alerts?

    Judgement call (documented in the README): the webhook watcher counts as on
    duty when its config exists *with a webhook* and its state file has been
    written in the last five minutes - it rewrites that file every interval, so
    a fresh mtime means the daemon is alive. When it is on duty the bot keeps
    its own up/down latch but does not post, so the channel gets one notice per
    outage instead of two.
    """
    now = time.time() if now is None else now
    try:
        with open(config_path, encoding="utf-8") as fh:
            cfg = json.load(fh)
    except (OSError, ValueError):
        return False
    if not str((cfg or {}).get("webhook") or "").strip():
        return False
    try:
        mtime = os.stat(state_path).st_mtime
    except OSError:
        return False
    return (now - mtime) <= max_age


def updown_enabled(mode: str | None, on_duty: bool) -> bool:
    """`on` / `off` / `auto` (default): auto steps aside for the webhook watcher."""
    mode = (mode or "auto").lower()
    if mode == "on":
        return True
    if mode == "off":
        return False
    return not on_duty


def alert_transition(state: dict, info: dict | None, down_after: int = 2,
                     now: float | None = None) -> tuple[dict, str | None]:
    """Pure up/down latch: returns the next state and the notice to post.

    Two consecutive misses before shouting "down", one answer to say "back".
    """
    now = time.time() if now is None else now
    down = bool(state.get("down"))
    fails = int(state.get("fails") or 0)
    if info:
        if down:
            return {"down": False, "fails": 0, "since": None}, "up"
        return {"down": False, "fails": 0, "since": state.get("since")}, None
    fails += 1
    if not down and fails >= max(1, down_after):
        return {"down": True, "fails": fails, "since": int(now)}, "down"
    return {"down": down, "fails": fails, "since": state.get("since")}, None


# ---------------------------------------------------------------------- events
EVENT_KEEP_ENDED = 24 * 3600          # show events that ended up to a day ago
EVENT_STATE_KEEP = 14 * 86400         # forget start/end bookkeeping after this


def parse_time(value: Any) -> datetime | None:
    """ISO-8601 (`2026-11-23T19:00:00Z`), epoch seconds, or a couple of common
    human formats. Naive values are read as UTC."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    dt: datetime | None = None
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%d"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


@dataclass(frozen=True)
class Event:
    title: str
    start: datetime | None = None
    end: datetime | None = None
    when: str = ""
    detail: str = ""
    key: str = ""

    def state(self, now: datetime) -> str:
        """upcoming / running / ended / undated."""
        if self.start is None:
            return "undated"
        if now < self.start:
            return "upcoming"
        if self.end is not None and now >= self.end:
            return "ended"
        if self.end is None and (now - self.start).total_seconds() > 6 * 3600:
            return "ended"           # no end given: assume it is over after 6 h
        return "running"


def parse_events(raw: Any, now: datetime | None = None) -> list[Event]:
    """Tolerant `events.json` reader: a list, or `{"events": [...]}`.

    Each entry is `{title, when, detail, start, end}`; only `title` is required.
    Sorted running first, then upcoming, then the ones that already ended.
    """
    if isinstance(raw, dict):
        raw = raw.get("events", [])
    if not isinstance(raw, (list, tuple)):
        return []
    now = now or datetime.now(timezone.utc)
    out: list[Event] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        start = parse_time(item.get("start"))
        end = parse_time(item.get("end"))
        if start and end and end < start:
            end = None
        key = f"{title}|{start.isoformat() if start else 'undated'}"
        out.append(Event(title=title, start=start, end=end,
                         when=str(item.get("when") or "").strip(),
                         detail=str(item.get("detail") or "").strip(), key=key))
    order = {"running": 0, "upcoming": 1, "undated": 2, "ended": 3}
    out.sort(key=lambda e: (order.get(e.state(now), 4), e.start or now, e.title.lower()))
    return out


def load_events(path: str = EVENTS_PATH) -> list[Event]:
    """Read the events file; missing/broken file means "nothing scheduled"."""
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as exc:
        log.warning("events file %s unreadable: %s", path, exc)
        return []
    return parse_events(raw)


def fmt_delta(seconds: float | int) -> str:
    """`2 d 4 h`, `2 h 15 m`, `45 m`, `<1 m` - used by every countdown."""
    total = abs(int(seconds))
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days:
        return f"{days} d {hours} h" if hours else f"{days} d"
    if hours:
        return f"{hours} h {minutes:02d} m" if minutes else f"{hours} h"
    if minutes:
        return f"{minutes} m"
    return "<1 m"


def event_countdown(event: Event, now: datetime) -> str:
    """`running now`, `in 2 h 15 m`, `ended 40 m ago`, or the file's own `when`."""
    state = event.state(now)
    if state == "running":
        if event.end is not None:
            return t("events.countdown.running_until",
                     delta=fmt_delta((event.end - now).total_seconds()))
        return t("events.countdown.running")
    if state == "upcoming":
        return t("events.countdown.upcoming",
                 delta=fmt_delta((event.start - now).total_seconds()))
    if state == "ended" and event.end is not None:
        return t("events.countdown.ended", delta=fmt_delta((now - event.end).total_seconds()))
    if state == "ended":
        return t("events.countdown.ended_plain")
    return event.when or t("events.countdown.undated")


def select_events(events: list[Event], now: datetime, limit: int = 8) -> list[Event]:
    """What `/events` shows: running, then upcoming, then recently ended."""
    try:
        limit = max(1, int(limit))
    except (TypeError, ValueError):
        limit = 8

    def visible(event: Event) -> bool:
        state = event.state(now)
        if state != "ended":
            return True
        ended_at = event.end or event.start
        return bool(ended_at and (now - ended_at).total_seconds() <= EVENT_KEEP_ENDED)

    return [e for e in events if visible(e)][:limit]


def events_embed(events: list[Event], now: datetime, limit: int = 8) -> discord.Embed:
    chosen = select_events(events, now, limit)
    embed = discord.Embed(title=t("events.title"), colour=COLOUR_OK)
    if not chosen:
        embed.description = t("events.empty")
        embed.colour = COLOUR_DIM
        return embed
    blocks = []
    for event in chosen:
        state = event.state(now)
        marker = t(f"events.marker.{state}" if state in ("running", "upcoming", "ended")
                   else "events.marker.undated")
        lines = [t("events.line", marker=marker, title=event.title,
                   countdown=event_countdown(event, now))]
        if event.detail:
            lines.append(f"  {event.detail}")
        if event.start is not None:
            lines.append(f"  <t:{int(event.start.timestamp())}:f>")
        blocks.append("\n".join(lines))
    embed.description = "\n\n".join(blocks)
    running = [e.title for e in chosen if e.state(now) == "running"]
    upcoming = [e for e in chosen if e.state(now) == "upcoming"]
    footer = t("events.footer_running", titles=", ".join(running)) if running else ""
    if upcoming:
        nxt = t("events.footer_next", title=upcoming[0].title)
        footer = (footer + " · " if footer else "") + nxt
    if footer:
        embed.set_footer(text=footer)
    return embed


class StateStore:
    """The bot's small JSON state file (atomic writes, tolerant of corruption).

    Sections: `events` (what was announced), `alerts` (down latch, failure
    count), `digest` (last day a digest went out).
    """

    def __init__(self, path: str = STATE_PATH) -> None:
        self.path = path
        self.data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        try:
            with open(self.path, encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                return data
            log.warning("state file %s is not an object; starting fresh", self.path)
        except FileNotFoundError:
            pass
        except (OSError, ValueError) as exc:
            log.warning("state file %s unreadable (%s); starting fresh", self.path, exc)
        return {}

    def save(self) -> None:
        directory = os.path.dirname(self.path)
        try:
            os.makedirs(directory, exist_ok=True)
            tmp = f"{self.path}.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(self.data, fh, indent=2, sort_keys=True)
            os.replace(tmp, self.path)
        except OSError as exc:
            log.warning("could not write state file %s: %s", self.path, exc)

    def section(self, name: str) -> dict[str, Any]:
        value = self.data.get(name)
        if not isinstance(value, dict):
            value = {}
            self.data[name] = value
        return value

    # ------------------------------------------------------------------ events
    def transitions(self, events: list[Event], now: datetime) -> list[tuple[Event, str]]:
        """Transitions that still need announcing (nothing is marked here)."""
        book = self.section("events")
        out: list[tuple[Event, str]] = []
        for event in events:
            entry = book.setdefault(event.key, {})
            posted = entry.setdefault("posted", [])
            state = event.state(now)
            if state == "running" and "started" not in posted:
                out.append((event, "started"))
            if state == "ended" and "ended" not in posted:
                out.append((event, "ended"))
            entry["start"] = event.start.isoformat() if event.start else None
            entry["end"] = event.end.isoformat() if event.end else None
        self._prune(now)
        return out

    def mark_announced(self, event: Event, kind: str) -> None:
        book = self.section("events")
        posted = book.setdefault(event.key, {"posted": []}).setdefault("posted", [])
        if kind not in posted:
            posted.append(kind)
        self.save()

    def _prune(self, now: datetime) -> None:
        book = self.section("events")
        for key, entry in list(book.items()):
            stamp = parse_time(entry.get("end") or entry.get("start"))
            if stamp and (now - stamp).total_seconds() > EVENT_STATE_KEEP:
                del book[key]


def event_notice(event: Event, kind: str, now: datetime | None = None) -> discord.Embed:
    """The one-off message posted when an event starts or ends."""
    now = now or datetime.now(timezone.utc)
    if kind == "started":
        embed = discord.Embed(title=t("events.notice.start_title", title=event.title),
                              colour=COLOUR_OK, description=event.detail or None)
        if event.end is not None:
            embed.add_field(name=t("events.notice.ends"),
                            value=t("events.notice.ends_value",
                                    time=f"<t:{int(event.end.timestamp())}:t>",
                                    delta=fmt_delta((event.end - now).total_seconds())),
                            inline=True)
    else:
        embed = discord.Embed(title=t("events.notice.end_title", title=event.title),
                              colour=COLOUR_DIM, description=event.detail or None)
    if event.start is not None:
        embed.timestamp = event.start
    embed.set_footer(text=t("events.notice.footer"))
    return embed


# --------------------------------------------------------------------------- bot
def instrument(interaction: discord.Interaction) -> str:
    """`/profile in #general by ajxs` for the log line of one command."""
    where = f"#{interaction.channel}" if interaction.channel else "dm"
    return f"/{interaction.command.name if interaction.command else '?'} in {where} by {interaction.user}"


async def _reply(interaction: discord.Interaction, *, content: str | None = None,
                 embed: discord.Embed | None = None,
                 embeds: list[discord.Embed] | None = None, ephemeral: bool = False) -> None:
    """Answer whether or not the interaction was already deferred; never raise."""
    all_embeds = ([embed] if embed else []) + list(embeds or [])
    try:
        if interaction.response.is_done():
            await interaction.followup.send(content=content, embeds=all_embeds, ephemeral=ephemeral)
        else:
            await interaction.response.send_message(content=content, embeds=all_embeds,
                                                    ephemeral=ephemeral)
    except discord.HTTPException:
        log.warning("could not answer %s", instrument(interaction), exc_info=True)


# -------------------------------------------------------------------- cooldowns
# Per-user, per-command limits in front of the expensive commands (the ones that
# hit the public leaderboard). Sliding window, kept in memory - a restart clears
# it, which is exactly what we want for a bot this small.
COOLDOWN_BUCKETS: dict[str, dict[str, list[float]]] = {}


def cooldown_remaining(bucket: dict[str, list[float]], key: str, now: float,
                       rate: int, per: float) -> float:
    """Seconds the caller has to wait, or 0 when the call is allowed now.

    ``rate`` calls per ``per`` seconds per ``key`` (a user id); the oldest
    stamp that still counts decides how long the wait is.
    """
    if rate <= 0 or per <= 0:
        return 0.0
    stamps = [stamp for stamp in bucket.get(key, []) if now - stamp < per]
    bucket[key] = stamps
    if len(stamps) >= rate:
        return max(0.0, per - (now - stamps[0]))
    stamps.append(now)
    return 0.0


# ---------------------------------------------------------------------- errors
def command_guard(ephemeral: bool = False, rate: int = 0, per: float = 60.0):
    """Defer early (3 s budget), rate-limit, log, and apologise on failure."""

    def decorator(func: Callable[..., Any]):
        command_name = func.__name__

        @functools.wraps(func)
        async def wrapper(interaction: discord.Interaction, *args: Any, **kwargs: Any) -> None:
            started = time.monotonic()
            if rate:
                user_key = str(getattr(interaction.user, "id", 0))
                bucket = COOLDOWN_BUCKETS.setdefault(command_name, {})
                wait = cooldown_remaining(bucket, user_key, time.monotonic(), rate, per)
                if wait > 0:
                    log.info("cooldown: %s asked for %s again after %.1fs", user_key,
                             command_name, per - wait)
                    await _reply(interaction, content=t("error.cooldown",
                                                        seconds=max(1, math.ceil(wait))),
                                 ephemeral=True)
                    return
            try:
                if not interaction.response.is_done():
                    await interaction.response.defer(thinking=True, ephemeral=ephemeral)
            except discord.HTTPException:
                log.warning("defer failed for %s", instrument(interaction), exc_info=True)
            try:
                await func(interaction, *args, **kwargs)
            except Exception:                  # noqa: BLE001 - one bad command must not kill the bot
                log.exception("command %s failed", instrument(interaction))
                await _reply(interaction, content=t("error.generic"), ephemeral=ephemeral)
            finally:
                log.info("%s (%.2fs)", instrument(interaction), time.monotonic() - started)
        return wrapper

    return decorator


def offline_embed(server: dict, detail: str = "") -> discord.Embed:
    """One red card for "the game server is not answering", used by every command."""
    embed = discord.Embed(
        title=t("offline.title", server=server["name"]),
        colour=COLOUR_WARN,
        description=detail or t("offline.body", host=server["host"], port=server["port"]),
    )
    embed.set_footer(text=t("offline.footer"))
    return embed


def help_embed(entries: list[tuple[str, str, list[tuple[str, str]]]], base: str,
               server_name: str) -> discord.Embed:
    """`/help` built from the live command table, so it cannot go stale."""
    embed = discord.Embed(title=t("cmd.help.title"),
                          description=t("cmd.help.description", server=server_name),
                          colour=COLOUR_OK)
    for name, description, options in entries:
        value = description or "-"
        for option, option_description in options:
            value += "\n" + t("cmd.help.option", option=option, description=option_description)
        embed.add_field(name=f"/{name}", value=value[:1024], inline=False)
    embed.add_field(name=t("cmd.help.also_title"), value=t("cmd.help.also"), inline=False)
    embed.set_footer(text=t("cmd.help.footer", host=base.replace("https://", ""),
                            language=LANGUAGE_NAMES.get(LANGUAGE, LANGUAGE)))
    return embed


def build_bot(cfg: dict) -> commands.Bot:
    """Build a fresh bot instance (one per connection attempt)."""
    set_language(cfg.get("language"))
    server = cfg["server"]
    base = str(cfg.get("leaderboard") or DEFAULT_CONFIG["leaderboard"]).rstrip("/")
    intents = discord.Intents.default()
    bot = commands.Bot(command_prefix="!fn ", intents=intents, help_command=None)

    @bot.event
    async def on_ready() -> None:
        log.info("logged in as %s (guilds: %d)", bot.user, len(bot.guilds))
        guild_id = cfg.get("guild_id")
        try:
            if guild_id:
                guild = discord.Object(id=int(guild_id))
                bot.tree.copy_global_to(guild=guild)
                synced = await bot.tree.sync(guild=guild)
                # one source of truth: guild commands update instantly, so drop
                # any global copies instead of showing every command twice
                bot.tree.clear_commands(guild=None)
                await bot.tree.sync()
                log.info("synced %d command(s) to guild %s; global set emptied",
                         len(synced), guild_id)
            else:
                synced = await bot.tree.sync()
                log.info("synced %d global command(s)", len(synced))
            log.info("commands: %s", ", ".join(sorted(c.name for c in synced)))
        except Exception:                      # noqa: BLE001
            log.exception("command sync failed")
        if not monitor_loop.is_running():
            monitor_loop.start()
        if not events_loop.is_running():
            events_loop.start()
        if not digest_loop.is_running():
            digest_loop.start()

    @bot.event
    async def on_disconnect() -> None:
        log.warning("gateway disconnected; discord.py will reconnect")

    @bot.event
    async def on_resumed() -> None:
        log.info("gateway session resumed")

    @bot.tree.error
    async def on_app_error(interaction: discord.Interaction, error: Exception) -> None:
        log.exception("app command error in %s", instrument(interaction), exc_info=error)
        await _reply(interaction, content=t("error.generic"))

    # ---------------------------------------------------------------- presence
    presence_state: dict[str, Any] = {"last": None, "cycle": 0}
    sample_state: dict[str, Any] = {}
    event_cache: dict[str, Any] = {"mtime": object(), "list": []}
    store = StateStore()
    alerts_cfg = cfg.get("alerts") or {}
    digest_cfg = cfg.get("digest") or {}
    samples_path = str(cfg.get("samples_path") or SAMPLE_PATH)
    down_after = max(1, int(alerts_cfg.get("down_after") or 2))

    def refresh_events() -> list[Event]:
        """Re-read events.json only when it changed on disk."""
        try:
            mtime: Any = os.stat(EVENTS_PATH).st_mtime
        except OSError:
            mtime = None
        if mtime != event_cache["mtime"]:
            event_cache["list"] = load_events()
            event_cache["mtime"] = mtime
            log.info("events file reloaded: %d event(s)", len(event_cache["list"]))
        return event_cache["list"]

    def running_event(now: datetime) -> str | None:
        for event in refresh_events():
            if event.state(now) == "running":
                return event.title
        return None

    async def notify_channel(name: str):
        """The configured channel for `name`, or None when it cannot be reached."""
        raw = (cfg.get("channels") or {}).get(name) or alerts_cfg.get(f"{name}_channel")
        if not raw:
            return None
        try:
            channel_id = int(raw)
        except (TypeError, ValueError):
            log.warning("channel %r in config is not a snowflake: %r", name, raw)
            return None
        channel = bot.get_channel(channel_id)
        if channel is not None:
            return channel
        try:
            return await bot.fetch_channel(channel_id)
        except discord.HTTPException:
            log.warning("could not resolve channel %s (%s)", name, channel_id, exc_info=True)
            return None

    async def post(name: str, *, embed: discord.Embed | None = None,
                   content: str | None = None) -> bool:
        channel = await notify_channel(name)
        if channel is None:
            log.info("nothing to post to channel %r (not configured)", name)
            return False
        try:
            await channel.send(content=content, embed=embed)
            return True
        except discord.HTTPException:
            log.warning("could not post to channel %r", name, exc_info=True)
            return False

    async def apply_presence(info: dict | None, now: datetime) -> None:
        """Refresh the presence line, skipping the write when nothing changed."""
        desired = presence_for(info, presence_state["cycle"], running_event(now))
        presence_state["cycle"] = (presence_state["cycle"] + 1) % 3
        if desired.as_tuple() == presence_state["last"]:
            return
        verb = (discord.ActivityType.watching if desired.verb == "watching"
                else discord.ActivityType.playing)
        status = discord.Status.idle if desired.status == "idle" else discord.Status.online
        try:
            await bot.change_presence(activity=discord.Activity(type=verb, name=desired.text),
                                      status=status)
            presence_state["last"] = desired.as_tuple()
            log.info("presence: %s (%s)", desired.text, desired.kind)
        except Exception:                      # noqa: BLE001
            log.warning("presence update failed", exc_info=True)

    async def check_alerts(info: dict | None) -> None:
        """Server came back / went down, unless the webhook watcher already says so."""
        current = store.section("alerts")
        new_state, kind = alert_transition(current, info, down_after)
        if new_state == current:
            return
        current.clear()
        current.update(new_state)
        store.save()
        if kind == "up":
            await _alert("up", t("alert.up", name=server["name"], map=info["map"],
                                 players=info["players"], max=info["max"]))
        elif kind == "down":
            await _alert("down", t("alert.down", name=server["name"],
                                   fails=new_state["fails"]))

    async def _alert(kind: str, text: str) -> None:
        on_duty = watcher_on_duty()
        if not updown_enabled(str(alerts_cfg.get("updown") or "auto"), on_duty):
            log.info("server %s: notice suppressed (%s)", kind,
                     "freenova-watch posts its own" if on_duty else "alerts.updown is off")
            return
        colour = COLOUR_OK if kind == "up" else COLOUR_WARN
        embed = discord.Embed(title=t("alert.up_title" if kind == "up" else "alert.down_title"),
                              description=text, colour=colour)
        embed.set_footer(text=t("alert.footer"))
        if await post("alerts", embed=embed):
            log.info("posted %s notice for %s", kind, server["name"])

    @tasks.loop(seconds=max(30, int(cfg.get("presence_refresh") or 60)))
    async def monitor_loop() -> None:
        """One probe per cycle: sample, presence, and the up/down latch."""
        now = datetime.now(timezone.utc)
        info = await get_info(server)
        try:
            await asyncio.to_thread(append_sample, samples_path, now, info)
            kept = await asyncio.to_thread(maybe_prune_samples, sample_state, samples_path,
                                           now.timestamp())
            if kept is not None:
                log.info("sample log pruned: %d row(s) kept", kept)
        except Exception:                      # noqa: BLE001
            log.warning("could not record a sample", exc_info=True)
        await apply_presence(info, now)
        try:
            await check_alerts(info)
        except Exception:                      # noqa: BLE001
            log.exception("alert check failed")

    # ------------------------------------------------------------------ events
    @tasks.loop(seconds=30)
    async def events_loop() -> None:
        now = datetime.now(timezone.utc)
        try:
            pending = store.transitions(refresh_events(), now)
        except Exception:                      # noqa: BLE001
            log.exception("event check failed")
            return
        for event, kind in pending:
            channel = await notify_channel("events")
            if channel is None:
                log.info("event %r %s (no events channel configured)", event.title, kind)
                store.mark_announced(event, kind)
                continue
            try:
                await channel.send(embed=event_notice(event, kind, now))
                log.info("posted %s notice for event %r", kind, event.title)
            except discord.HTTPException:
                log.warning("could not post %s notice for %r; dropping it", kind, event.title,
                            exc_info=True)
            store.mark_announced(event, kind)

    # ------------------------------------------------------------------ digest
    @tasks.loop(minutes=5)
    async def digest_loop() -> None:
        if not bool(digest_cfg.get("enabled", True)):
            return
        now = datetime.now(timezone.utc).astimezone()
        hour = int(digest_cfg.get("hour") or 21)
        today = now.date().isoformat()
        digest_state = store.section("digest")
        if now.hour < hour or digest_state.get("last_day") == today:
            return
        since = time.time() - 86400
        samples = await asyncio.to_thread(load_samples, samples_path, since)
        stats = digest_stats(samples, datetime.now(timezone.utc))
        if stats.get("peak") is None:
            log.info("digest for %s postponed: no samples in the window yet", today)
            return
        board = await _in_thread(fetch_leaderboard, base, "all", 1, budget=HTTP_TIMEOUT + 1)
        leader = board.rows[0] if board and board.ok else None
        embed = digest_embed(stats, server, leader)
        channel_name = str(digest_cfg.get("channel") or "leaderboard")
        posted = await post(channel_name, embed=embed)
        digest_state["last_day"] = today
        store.save()
        log.info("daily digest for %s: peak=%s map=%s posted=%s", today, stats.get("peak"),
                 stats.get("map"), posted)

    # ---------------------------------------------------------------- commands
    @bot.tree.command(name="status", description=t("cmd.status.desc"))
    @command_guard()
    async def status_cmd(interaction: discord.Interaction) -> None:
        info = await get_info(server)
        if not info:
            await _reply(interaction, embed=offline_embed(server))
            return
        nxt = next_map(map_pool(cfg.get("mapcycle")), info["map"])
        embed = discord.Embed(title=info["name"], colour=COLOUR_OK,
                              description=t("cmd.status.address", host=server["host"],
                                            port=server["port"]))
        embed.add_field(name=t("cmd.status.map"), value=f"`{info['map']}`", inline=True)
        embed.add_field(name=t("cmd.status.players"),
                        value=f"**{info['players']}/{info['max']}**", inline=True)
        embed.add_field(name=t("cmd.status.next"), value=f"`{nxt}`" if nxt else "—", inline=True)
        # "when is it busiest?" - straight from our own probe samples
        now = datetime.now(timezone.utc)
        samples = await asyncio.to_thread(load_samples, samples_path, now.timestamp() - 86400)
        stats = digest_stats(samples, now)
        if stats.get("peak") is not None:
            free = f"/{stats['max']}" if stats.get("max") else ""
            at = f" at <t:{int(stats['peak_at'].timestamp())}:t>" if stats.get("peak_at") else ""
            embed.add_field(name=t("cmd.status.peak"),
                            value=t("cmd.status.peak_value", peak=stats["peak"], max=free, at=at),
                            inline=True)
        embed.set_footer(text=t("cmd.status.footer",
                                time=datetime.now(timezone.utc).strftime("%H:%M")))
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="players", description=t("cmd.players.desc"))
    @command_guard()
    @app_commands.describe(count=t("cmd.players.count"))
    async def players_cmd(interaction: discord.Interaction,
                          count: app_commands.Range[int, 1, 32] = 20) -> None:
        players = await get_players(server)
        if players is None:
            await _reply(interaction, embed=offline_embed(server))
            return
        if not players:
            embed = discord.Embed(title=t("cmd.players.empty_title", server=server["name"]),
                                  colour=COLOUR_DIM, description=t("cmd.players.empty"))
            await _reply(interaction, embed=embed)
            return
        players.sort(key=lambda p: (-p["score"], -p["seconds"]))
        shown = players[:int(count)]
        embed = discord.Embed(title=t("cmd.players.title", n=len(players), server=server["name"]),
                              colour=COLOUR_LIVE,
                              description="\n".join(
                                  t("cmd.players.line", rank=index, name=player["name"][:24],
                                    score=player["score"],
                                    time=fmt_duration(player["seconds"]))
                                  for index, player in enumerate(shown, 1)))
        if len(players) > len(shown):
            embed.set_footer(text=t("cmd.players.footer", shown=len(shown), total=len(players)))
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="map", description=t("cmd.map.desc"))
    @command_guard()
    async def map_cmd(interaction: discord.Interaction) -> None:
        info = await get_info(server)
        current = info["map"] if info else None
        pool = map_pool(cfg.get("mapcycle"))
        nxt = next_map(pool, current)
        if not current:
            await _reply(interaction, embed=offline_embed(server))
            return
        embed = discord.Embed(title=t("cmd.map.title", map=humanise_map(current)),
                              colour=COLOUR_OK, description=t("cmd.map.now", map=current))
        if nxt:
            embed.add_field(name=t("cmd.map.next"), value=f"`{nxt}`", inline=True)
        if current in pool:
            embed.add_field(name=t("cmd.map.cycle"),
                            value=f"{pool.index(current) + 1}/{len(pool)}", inline=True)
        if not pool:
            embed.set_footer(text=t("cmd.map.no_cycle"))
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="top", description=t("cmd.top.desc"))
    @command_guard(rate=3, per=30.0)
    @app_commands.describe(period=t("cmd.top.period"), count=t("cmd.top.count"))
    @app_commands.choices(period=[
        app_commands.Choice(name=t("cmd.top.choice.all"), value="all"),
        app_commands.Choice(name=t("cmd.top.choice.week"), value="week"),
        app_commands.Choice(name=t("cmd.top.choice.month"), value="month"),
    ])
    async def top_cmd(interaction: discord.Interaction,
                      period: app_commands.Choice[str] | None = None,
                      count: app_commands.Range[int, 1, 15] = 10) -> None:
        chosen = period.value if isinstance(period, app_commands.Choice) else period
        if chosen not in PERIODS:
            chosen = "all"
        board = await _in_thread(fetch_leaderboard, base, chosen, count, budget=HTTP_TIMEOUT + 1)
        if board is None:                      # budget blown: answer anyway
            board = Leaderboard(chosen, url=f"{base}/top15",
                                note=t("board.unreachable_title", url=f"{base}/top15"),
                                note_kind="unavailable")
        label = period_label(chosen)
        title = (t("board.title", n=len(board.rows), period=label) if board.ok
                 else t("board.title_plain", period=label))
        colour = COLOUR_BP if board.ok else (
            COLOUR_DIM if board.note_kind == "period" else COLOUR_WARN)
        embed = discord.Embed(title=title, url=board.url, colour=colour)
        if board.ok:
            embed.description = "\n".join(row.line() for row in board.rows)
            embed.set_footer(text=t("board.source", host=board.url.replace("https://", "")))
        else:
            embed.description = board.note
            if board.note_kind == "period":
                embed.set_footer(text=t("board.period_footer"))
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="profile", description=t("cmd.profile.desc"))
    @command_guard(ephemeral=True, rate=2, per=20.0)
    @app_commands.describe(player=t("cmd.profile.player"))
    async def profile_cmd(interaction: discord.Interaction, player: str) -> None:
        result = await _in_thread(lookup_profile, base, player, budget=HTTP_TIMEOUT * 2 + 1)
        if result is None:
            await _reply(interaction, embed=discord.Embed(
                title=t("profile.timeout_title"), colour=COLOUR_WARN,
                description=t("profile.timeout", base=base)), ephemeral=True)
            return
        if not result.ok:
            await _reply(interaction, embed=lookup_embed(result), ephemeral=True)
            return
        await _reply(interaction, embeds=profile_embeds(result.profile, base, result.others),
                     ephemeral=True)

    @bot.tree.command(name="events", description=t("cmd.events.desc"))
    @command_guard(rate=3, per=30.0)
    @app_commands.describe(count=t("cmd.events.count"))
    async def events_cmd(interaction: discord.Interaction,
                         count: app_commands.Range[int, 1, 10] = 5) -> None:
        now = datetime.now(timezone.utc)
        embed = events_embed(refresh_events(), now, limit=count)
        embed.set_footer(text=t("events.command_footer"))
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="help", description=t("cmd.help.desc"))
    @command_guard()
    async def help_cmd(interaction: discord.Interaction) -> None:
        entries = []
        for command in sorted(bot.tree.get_commands(), key=lambda c: c.name):
            options = [(parameter.name, parameter.description)
                       for parameter in getattr(command, "parameters", [])]
            entries.append((command.name, command.description, options))
        await _reply(interaction, embed=help_embed(entries, base, server["name"]))

    return bot


# --------------------------------------------------------------------------- run
def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,
    )
    # discord.py's chattier corners: voice deps we never use, and the
    # message-content intent warning that does not apply to slash commands
    logging.getLogger("discord.client").setLevel(logging.ERROR)
    logging.getLogger("discord.gateway").setLevel(logging.WARNING)
    logging.getLogger("discord.ext.commands.bot").setLevel(logging.ERROR)
    logging.getLogger("discord.http").setLevel(logging.WARNING)


def main(argv: list[str] | None = None) -> int:
    """Connect, and keep reconnecting with backoff if the gateway goes away."""
    setup_logging()
    cfg = load_config()
    token = (cfg.get("token") or "").strip()
    if not token:
        log.error("no token in %s - put the bot token there (mode 600) and restart", CONFIG_PATH)
        return 2
    backoff = 5
    while True:
        bot = build_bot(cfg)
        try:
            bot.run(token, log_handler=None)
            log.warning("gateway closed cleanly; reconnecting in %ss", backoff)
        except KeyboardInterrupt:
            return 0
        except discord.LoginFailure:
            log.error("Discord rejected the token - it was rotated or mistyped in %s", CONFIG_PATH)
            return 3
        except discord.PrivilegedIntentsRequired:
            log.error("the bot needs a privileged intent that is not enabled in the dev portal")
            return 4
        except Exception:                      # noqa: BLE001 - network, DNS, aiohttp …
            log.exception("bot stopped unexpectedly; reconnecting in %ss", backoff)
        time.sleep(backoff)
        backoff = min(backoff * 2, 300)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
