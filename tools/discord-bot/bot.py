#!/usr/bin/env python3
"""FreeNova CS 1.6 Discord bot.

Answers questions about the Classic server and keeps a live presence:
`/status`, `/players`, `/map`, `/top`, `/events`, `/profile`. Data comes
straight from the game server (A2S over UDP), the map cycle file and the public
leaderboard, so the bot keeps working even when the panel is down.

Config: ~/.config/freenova-bot/config.json (mode 600, never in git)

    {
      "token": "…",
      "guild_id": "1574…",                    # optional: instant command sync
      "channels": {"alerts": "…", "events": "…", "leaderboard": "…"},
      "server": {"name": "CS 1.6 Classic", "host": "193.70.81.30", "port": 27015},
      "mapcycle": "/home/ajxs/projects/FreeNova-Classic-Server/game-server/cstrike/mapcycle.txt",
      "leaderboard": "https://leaderboard.fn-gaming.net",
      "hourly_status_channel": null,
      "presence_refresh": 60
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
import os
import re
import socket
import struct
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
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


# ----------------------------------------------------------------------- config
DEFAULT_CONFIG: dict[str, Any] = {
    "token": "",
    "guild_id": None,
    "channels": {},
    "server": {"name": "CS 1.6 Classic", "host": "127.0.0.1", "port": 27015},
    "mapcycle": None,
    "leaderboard": "https://leaderboard.fn-gaming.net",
    "hourly_status_channel": None,
    "presence_refresh": 60,
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
    if not mapname:
        return "unknown map"
    name = mapname.strip()
    if not name:
        return "unknown map"
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
    ("deathrun_", "deathrun"),
    ("surf_", "surf"),
    ("kz_", "kreedz"),
    ("zm_", "zombie"),
    ("awp_", "AWP only"),
    ("aim_", "aim"),
    ("fy_", "iceworld"),
    ("he_", "grenades only"),
    ("de_", "defuse"),
    ("cs_", "hostage rescue"),
)


def map_kind(mapname: str | None) -> str:
    """Game mode implied by the map prefix; `custom` for anything else."""
    name = (mapname or "").lower()
    for prefix, label in MAP_KINDS:
        if name.startswith(prefix):
            return label
    return "custom"


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
        return Presence("offline", "watching", "for the server to come back", "idle")

    players = int(info.get("players") or 0)
    maxp = int(info.get("max") or 0)
    mapname = info.get("map") or ""
    label = humanise_map(mapname)
    count = f"{players}/{maxp}" if maxp else str(players)

    if players <= 0:
        return Presence("empty", "playing", f"{count} · waiting for players", "online")
    if maxp and players >= maxp:
        return Presence("full", "playing", f"{label} · {count} · full house", "online")

    hints = [map_kind(mapname), f"{maxp - players} free" if maxp else "", event_title or ""]
    hint = hints[cycle % len(hints)] if hints else ""
    text = f"{label} · {count}" + (f" · {hint}" if hint else "")
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


def fetch_top(base: str, limit: int = 5) -> list[tuple[int, str, str]]:
    """(rank, name, value) from the public leaderboard; best effort."""
    body = _http_get(f"{base}/top15")
    if not body:
        return []
    rows: list[tuple[int, str, str]] = []
    # the page renders a table of players; keep it tolerant of markup tweaks
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", m.group(1), re.S)
        if len(cells) < 2:
            continue
        text = [_strip_tags(c) for c in cells]
        text = [cell for cell in text if cell]
        if not text or not re.search(r"\d", " ".join(text)):
            continue
        rows.append((len(rows) + 1, text[0] if text else "?", " ".join(text[1:3])))
        if len(rows) >= limit:
            break
    return rows


# --------------------------------------------------------------------------- bot
def instrument(interaction: discord.Interaction) -> str:
    """`/profile in #general by ajxs` for the log line of one command."""
    where = f"#{interaction.channel}" if interaction.channel else "dm"
    return f"/{interaction.command.name if interaction.command else '?'} in {where} by {interaction.user}"


async def _reply(interaction: discord.Interaction, *, content: str | None = None,
                 embed: discord.Embed | None = None, ephemeral: bool = False) -> None:
    """Answer whether or not the interaction was already deferred; never raise."""
    try:
        if interaction.response.is_done():
            await interaction.followup.send(content=content, embed=embed, ephemeral=ephemeral)
        else:
            await interaction.response.send_message(content=content, embed=embed, ephemeral=ephemeral)
    except discord.HTTPException:
        log.warning("could not answer %s", instrument(interaction), exc_info=True)


def command_guard(ephemeral: bool = False):
    """Defer early (3 s budget), log, and answer with an apology on failure."""

    def decorator(func: Callable[[discord.Interaction], Any]):
        @functools.wraps(func)
        async def wrapper(interaction: discord.Interaction) -> None:
            started = time.monotonic()
            try:
                if not interaction.response.is_done():
                    await interaction.response.defer(thinking=True, ephemeral=ephemeral)
            except discord.HTTPException:
                log.warning("defer failed for %s", instrument(interaction), exc_info=True)
            try:
                await func(interaction)
            except Exception:                  # noqa: BLE001 - one bad command must not kill the bot
                log.exception("command %s failed", instrument(interaction))
                await _reply(interaction, content=ERROR_TEXT, ephemeral=ephemeral)
            finally:
                log.info("%s (%.2fs)", instrument(interaction), time.monotonic() - started)
        return wrapper

    return decorator


ERROR_TEXT = "Something went wrong on my side - the server and the leaderboard are still up. Try again in a moment."

SERVER_ERROR_TEXT = "🔴 **{name}** is not answering on `{host}:{port}` right now."


def build_bot(cfg: dict) -> commands.Bot:
    """Build a fresh bot instance (one per connection attempt)."""
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
            else:
                synced = await bot.tree.sync()
            log.info("synced %d command(s): %s", len(synced),
                     ", ".join(sorted(c.name for c in synced)))
        except Exception:                      # noqa: BLE001
            log.exception("command sync failed")
        if not presence_loop.is_running():
            presence_loop.start()

    @bot.event
    async def on_disconnect() -> None:
        log.warning("gateway disconnected; discord.py will reconnect")

    @bot.event
    async def on_resumed() -> None:
        log.info("gateway session resumed")

    @bot.tree.error
    async def on_app_error(interaction: discord.Interaction, error: Exception) -> None:
        log.exception("app command error in %s", instrument(interaction), exc_info=error)
        await _reply(interaction, content=ERROR_TEXT)

    # ---------------------------------------------------------------- presence
    presence_state: dict[str, Any] = {"last": None, "cycle": 0}

    async def apply_presence() -> None:
        """Refresh the presence line, skipping the write when nothing changed."""
        info = await get_info(server)
        desired = presence_for(info, presence_state["cycle"])
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

    @tasks.loop(seconds=max(30, int(cfg.get("presence_refresh") or 60)))
    async def presence_loop() -> None:
        await apply_presence()

    # ---------------------------------------------------------------- commands
    @bot.tree.command(name="status", description="Live status of the FreeNova Classic server")
    @command_guard()
    async def status_cmd(interaction: discord.Interaction) -> None:
        info = await get_info(server)
        if not info:
            await _reply(interaction, content=SERVER_ERROR_TEXT.format(
                name=server["name"], host=server["host"], port=server["port"]))
            return
        nxt = next_map(map_pool(cfg.get("mapcycle")), info["map"])
        embed = discord.Embed(title=info["name"], colour=COLOUR_OK,
                              description=f"`{server['host']}:{server['port']}`")
        embed.add_field(name="Map", value=f"`{info['map']}`", inline=True)
        embed.add_field(name="Players", value=f"**{info['players']}/{info['max']}**", inline=True)
        embed.add_field(name="Next map", value=f"`{nxt}`" if nxt else "—", inline=True)
        embed.set_footer(text=f"Updated {datetime.now(timezone.utc).strftime('%H:%M UTC')}")
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="players", description="Who is on the server right now")
    @command_guard()
    async def players_cmd(interaction: discord.Interaction) -> None:
        players = await get_players(server)
        if players is None:
            await _reply(interaction, content=SERVER_ERROR_TEXT.format(
                name=server["name"], host=server["host"], port=server["port"]))
            return
        if not players:
            await _reply(interaction, content="Nobody is on right now - the server is up and waiting.")
            return
        players.sort(key=lambda p: (-p["score"], -p["seconds"]))
        lines = [f"`{i:>2}.` **{p['name'][:24]}** - {p['score']} pts, {fmt_duration(p['seconds'])}"
                 for i, p in enumerate(players, 1)]
        embed = discord.Embed(title=f"{len(players)} on {server['name']}", colour=COLOUR_LIVE,
                              description="\n".join(lines[:25]))
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="map", description="Current and next map")
    @command_guard()
    async def map_cmd(interaction: discord.Interaction) -> None:
        info = await get_info(server)
        current = info["map"] if info else None
        pool = map_pool(cfg.get("mapcycle"))
        nxt = next_map(pool, current)
        if not current:
            await _reply(interaction, content=SERVER_ERROR_TEXT.format(
                name=server["name"], host=server["host"], port=server["port"]))
            return
        embed = discord.Embed(title="Map", colour=COLOUR_OK, description=f"**Now:** `{current}`")
        if nxt:
            embed.add_field(name="Next", value=f"`{nxt}`", inline=True)
        if current in pool:
            embed.add_field(name="In the cycle", value=f"{pool.index(current) + 1}/{len(pool)}",
                            inline=True)
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="top", description="Top players on the leaderboard")
    @command_guard()
    async def top_cmd(interaction: discord.Interaction) -> None:
        rows = await _in_thread(fetch_top, base, 5, budget=HTTP_TIMEOUT + 1)
        if not rows:
            await _reply(interaction, content=f"No leaderboard data yet - see {base}/top15")
            return
        embed = discord.Embed(title="Top players", colour=COLOUR_BP, url=f"{base}/top15",
                              description="\n".join(f"`{i}.` **{n}** - {v}" for i, n, v in rows))
        await _reply(interaction, embed=embed)

    @bot.tree.command(name="events", description="What is running on the server this week")
    @command_guard()
    async def events_cmd(interaction: discord.Interaction) -> None:
        try:
            with open(EVENTS_PATH, encoding="utf-8") as fh:
                events = json.load(fh)
        except (OSError, ValueError):
            await _reply(interaction,
                         content="No events are scheduled right now - check back, or watch this channel.")
            return
        lines = []
        for event in (events or [])[:8]:
            lines.append(f"• **{event.get('title', 'Event')}** - {event.get('when', '')}"
                         + (f" ({event['detail']})" if event.get("detail") else ""))
        await _reply(interaction, content="\n".join(lines) or "Nothing scheduled.")

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
    logging.getLogger("discord").setLevel(logging.WARNING)
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
