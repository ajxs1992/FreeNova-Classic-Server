#!/usr/bin/env python3
"""Offline tests for the FreeNova Discord bot.

No network, no Discord token, no game server: every helper takes its input as an
argument or is fed a saved HTML snippet, and the probes/HTTP calls are stubbed
where a command needs them.

Run either way:

    ~/.local/share/freenova-bot/venv/bin/python tools/discord-bot/test_bot.py
    ~/.local/share/freenova-bot/venv/bin/python -m pytest tools/discord-bot/test_bot.py
"""
from __future__ import annotations

import asyncio
import json
import os
import struct
import sys
import time
import traceback
import urllib.parse
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bot  # noqa: E402  (path has to be set first)

NOW = datetime(2026, 11, 22, 20, 0, tzinfo=timezone.utc)


# ------------------------------------------------------------------- fixtures
def goldsrc_info(mapname: str = "de_dust2", players: int = 9, maxp: int = 32,
                 name: str = "FreeNova CS 1.6") -> bytes:
    body = (b"m" + bytes([48]) + b"193.70.81.30:27015\x00" + name.encode() + b"\x00"
            + mapname.encode() + b"\x00" + b"cstrike\x00" + b"Counter-Strike\x00")
    return b"\xff\xff\xff\xff" + body + bytes([players, maxp]) + b"ld\x00\x01"


def source_info(mapname: str = "de_nuke", players: int = 3, maxp: int = 16) -> bytes:
    body = (b"I" + bytes([17]) + b"srv\x00" + mapname.encode() + b"\x00" + b"cstrike\x00"
            + b"Counter-Strike\x00" + struct.pack("<h", 10))
    return b"\xff\xff\xff\xff" + body + bytes([players, maxp])


def a2s_players(*entries: tuple[str, int, int]) -> bytes:
    body = b"D" + bytes([len(entries)])
    for index, (name, score, seconds) in enumerate(entries):
        body += bytes([index]) + name.encode() + b"\x00"
        body += struct.pack("<i", score) + struct.pack("<f", seconds)
    return b"\xff\xff\xff\xff" + body


SEARCH_HTML = """<table class='champ'><tr><td><span class='cplace'>1</span>
  <div class='cname'><a href='/profile?steamid=STEAM_0%3A0%3A683671116' style='color:inherit;'>ajxs</a></div></td></tr></table>
<table class='board'><tbody><tr class='row'><td class='idx'>8</td>
  <td class='l'><a class='pname' href='/profile?steamid=STEAM_2%3A1%3A2135760186'>ajxs</a></td></tr>
</tbody></table>"""

SEARCH_EMPTY_HTML = """<table class='board'><tbody><tr><td colspan='8' class='empty'>No player matches “ghost”.</td></tr></tbody></table>"""


# ------------------------------------------------------------- public API fixtures
# Shapes copied from live answers of GET /api/public/* (see docs/PUBLIC-API.md).
NOW_TS = int(NOW.timestamp())

API_STATUS_FRESH = {
    "server": {"name": "FreeNova CS 1.6 | fn-gaming.net", "map": "de_dust2", "online": True,
               "players": 9, "max": 32, "next_map": None, "last_push": NOW_TS - 12,
               "stale": False},
    "events": {"now": [{"title": "Double XP Weekend", "starts_at": NOW_TS - 3600,
                        "ends_at": NOW_TS + 3600, "detail": "2x XP", "state": "active"}],
               "next": None},
    "updated": NOW_TS,
}

API_STATUS_STALE = {
    "server": {"name": "FreeNova CS 1.6 | fn-gaming.net", "map": "de_nuke", "online": False,
               "players": None, "max": None, "next_map": None, "last_push": NOW_TS - 600,
               "stale": True},
    "events": {"now": [], "next": "Happy Hour"},
    "updated": NOW_TS,
}

# live production shape: last_push seconds old, but the push still says 0 players
API_STATUS_DISAGREE = {
    "server": {"name": "FreeNova CS 1.6 | fn-gaming.net", "map": "de_dust2", "online": True,
               "players": 0, "max": 32, "next_map": None, "last_push": NOW_TS - 11,
               "stale": False},
    "events": {"now": [], "next": None},
    "updated": NOW_TS,
}

API_STATUS_OFFLINE = {
    "server": {"name": "FreeNova CS 1.6 | fn-gaming.net", "map": None, "online": False,
               "players": 0, "max": 32, "next_map": None, "last_push": NOW_TS - 5,
               "stale": False},
    "events": {"now": [], "next": None},
    "updated": NOW_TS,
}

API_TOP_WEEK = {
    "period": "week", "metric": "xp", "limit": 3, "key": "2026-W47",
    "window": {"key": "2026-W47", "start": NOW_TS - 604800, "end": NOW_TS,
               "tz": "Europe/Paris", "label": "Week 47 · 2026"},
    "rows": [
        {"rank": 1, "steamid": "STEAM_2:0:1537328478", "name": "zerbou3I", "value": 950,
         "metric": "xp", "period": "week"},
        {"rank": 2, "steamid": "STEAM_0:1:799106783", "name": "NPC_Leaders", "value": 500,
         "metric": "xp", "period": "week"},
    ],
    "total": 2,
    "coverage": {"observed_players": 15, "first_seen": NOW_TS - 1800, "complete": False},
    "updated": NOW_TS,
}

API_TOP_EMPTY_WEEK = {
    "period": "week", "metric": "xp", "limit": 10, "key": "2026-W47",
    "window": {"key": "2026-W47", "start": NOW_TS - 604800, "end": NOW_TS,
               "tz": "Europe/Paris", "label": "Week 47 · 2026"},
    "rows": [], "total": 0,
    "coverage": {"observed_players": 16, "first_seen": NOW_TS - 120, "complete": False},
    "updated": NOW_TS,
}

API_TOP_ALL = {
    "period": "all", "metric": "xp", "limit": 10, "key": "all",
    "window": {"key": "all", "start": None, "end": None, "tz": "UTC", "label": "Lifetime"},
    "rows": [
        {"rank": 1, "steamid": "STEAM_0:0:683671116", "name": "ajxs", "value": 24889,
         "metric": "xp", "period": "all"},
        {"rank": 2, "steamid": "STEAM_0:1:799106783", "name": "NPC_Leaders", "value": 12463,
         "metric": "xp", "period": "all"},
        {"rank": 3, "steamid": "STEAM_2:0:1537328478", "name": "zerbou3I", "value": 90,
         "metric": "xp", "period": "all"},
    ],
    "total": 12,
    "coverage": {"observed_players": 12, "first_seen": 0, "complete": True},
    "updated": NOW_TS,
}

API_PLAYER = {
    "steamid": "STEAM_0:0:683671116", "name": "ajxs", "rank": 1,
    "bp_tier": 18, "bp_xp": 17889, "bp_next_xp": 111, "bp_progress": 889,
    "bp_tier_xp": 1000, "bp_max_tier": 60, "coins": 2400,
    "playtime_minutes": 447,
    "badges": [{"kind": "weekly_champion", "period": "2026-W46",
                "label": "Weekly #1 · Week 46 · 2026"},
               {"kind": "monthly_champion", "period": "2026-10",
                "label": "Monthly #1 · October 2026"},
               {"kind": "weekly_top3", "period": "2026-W45",
                "label": "Weekly top 3 · Week 45 · 2026"},
               {"kind": "weekly_streak3", "period": "2026-W44",
                "label": "Top 3 three weeks running · Week 44 · 2026"}],
    "updated": NOW_TS,
}

API_PLAYER_UNRANKED = {
    "steamid": "STEAM_0:0:1", "name": "Fresh", "rank": None,
    "bp_tier": 1, "bp_xp": 0, "bp_next_xp": 1000, "bp_progress": 0,
    "bp_tier_xp": 1000, "bp_max_tier": 60, "coins": 0, "playtime_minutes": 3,
    "badges": [], "updated": NOW_TS,
}

API_PLAYER_404 = {"error": "player_not_found",
                  "message": "the panel has no snapshot for this steamid yet",
                  "steamid": "STEAM_0:0:999999999"}
API_BAD_STEAMID = {"error": "bad_steamid",
                   "message": "steamid must look like STEAM_0:0:123 or 0-0-123",
                   "given": "garbage"}
API_RATE_LIMITED = {"error": "rate_limited", "message": "more than 120 requests in a minute"}

API_EVENTS = {
    "events": [
        {"title": "Double XP Weekend", "starts_at": NOW_TS - 3600, "ends_at": NOW_TS + 3600,
         "detail": "2x XP on every kill.", "state": "active"},
        {"title": "Happy Hour", "starts_at": NOW_TS + 7200, "ends_at": NOW_TS + 10800,
         "detail": "Bonus coins.", "state": "scheduled"},
        {"title": "Overdue cup", "starts_at": NOW_TS - 7200, "ends_at": NOW_TS + 1800,
         "detail": "scheduler never started it", "state": "overdue"},
        {"title": "Kill Race", "starts_at": 0, "ends_at": 0,
         "detail": "First to 1,000 kills.", "state": "unscheduled"},
    ],
    "now": 1, "next": "Happy Hour", "updated": NOW_TS, "source": "panel",
}


class stub_api:
    """Replace `bot.api_get` for a block: path -> (status, payload) or ApiResult."""

    def __init__(self, routes: dict[str, object]):
        self.routes = routes
        self.calls: list[str] = []

    def __enter__(self):
        self._original = bot.api_get

        def fake(base, path, params=None, timeout=bot.HTTP_TIMEOUT):
            key = path
            if params:
                key += "?" + urllib.parse.urlencode(sorted(params.items()))
            self.calls.append(key)
            value = self.routes.get(key, self.routes.get(path))
            if value is None:
                return bot.ApiResult(0, error="unreachable")
            if isinstance(value, bot.ApiResult):
                return value
            status, payload = value                    # type: ignore[misc]
            if status == 200:
                return bot.ApiResult(200, payload)
            error = payload.get("error", "") if isinstance(payload, dict) else ""
            return bot.ApiResult(status, payload, error=error)

        bot.api_get = fake
        bot.API_CACHE.clear()
        return self

    def __exit__(self, *exc):
        bot.api_get = self._original
        bot.API_CACHE.clear()
        return False


def call_command(name: str, *args, api: dict[str, object] | None = None,
                 cfg: dict | None = None) -> "FakeInteraction":
    """Drive one real command callback with the API stubbed (unreachable by default)."""
    instance = bot.build_bot(cfg or sample_cfg())
    interaction = FakeInteraction()
    bot.COOLDOWN_BUCKETS.clear()          # every test starts with a clean cooldown window
    with stub_api(api or {}):
        asyncio.run(instance.tree.get_command(name).callback(interaction, *args))
    return interaction


class stub_http:
    """Replace `bot._http_get` for the duration of a `with` block."""

    def __init__(self, responses: dict[str, str | None]):
        self.responses = responses
        self.calls: list[str] = []

    def __enter__(self):
        self._original = bot._http_get

        def fake(url: str, timeout: float = bot.HTTP_TIMEOUT):
            self.calls.append(url)
            for needle, body in self.responses.items():
                if needle in url:
                    return body
            return None

        bot._http_get = fake
        return self

    def __exit__(self, *exc):
        bot._http_get = self._original
        return False


# ------------------------------------------------------------ fake interaction
class FakeResponse:
    def __init__(self):
        self.done = False
        self.defer_kw = None
        self.sent = None

    def is_done(self):
        return self.done

    async def defer(self, thinking=False, ephemeral=False):
        self.done = True
        self.defer_kw = {"thinking": thinking, "ephemeral": ephemeral}

    async def send_message(self, **kwargs):
        self.sent = kwargs
        self.done = True


class FakeFollowup:
    def __init__(self, sink):
        self.sink = sink

    async def send(self, **kwargs):
        self.sink.append(kwargs)


class FakeUser:
    def __str__(self):
        return "tester#0001"


class FakeInteraction:
    def __init__(self):
        self.response = FakeResponse()
        self.sent = []
        self.followup = FakeFollowup(self.sent)
        self.channel = None
        self.user = FakeUser()
        self.command = None

    @property
    def answer(self) -> dict:
        return self.sent[-1] if self.sent else (self.response.sent or {})


def sample_cfg() -> dict:
    return bot._merge(bot.DEFAULT_CONFIG, {
        "server": {"name": "CS 1.6 Classic", "host": "127.0.0.1", "port": 1},
        "mapcycle": None,
        "leaderboard": "https://example.invalid",
        "digest": {"enabled": False},
    })


# ------------------------------------------------------------------ formatting
def test_fmt_duration():
    assert bot.fmt_duration(0) == "0m"
    assert bot.fmt_duration(None) == "0m"
    assert bot.fmt_duration(-30) == "0m"
    assert bot.fmt_duration(45) == "45s"
    assert bot.fmt_duration(90) == "1m"
    assert bot.fmt_duration(3727) == "1h 02m"


def test_fmt_age():
    assert bot.fmt_age(None) == "?"
    assert bot.fmt_age(12) == "12s"
    assert bot.fmt_age(89) == "89s"
    assert bot.fmt_age(600) == "10 m"
    assert bot.fmt_age(7200) == "2 h"


def test_fmt_delta():
    assert bot.fmt_delta(0) == "<1 m"
    assert bot.fmt_delta(59) == "<1 m"
    assert bot.fmt_delta(60) == "1 m"
    assert bot.fmt_delta(8100) == "2 h 15 m"
    assert bot.fmt_delta(86400) == "1 d"
    assert bot.fmt_delta(93600) == "1 d 2 h"
    assert bot.fmt_delta(-8100) == "2 h 15 m"      # magnitude only


def test_humanise_map():
    assert bot.humanise_map("de_dust2") == "de Dust2"
    assert bot.humanise_map("cs_office") == "cs Office"
    assert bot.humanise_map("awp_india") == "awp India"
    assert bot.humanise_map("surf_ski_2") == "surf Ski 2"
    assert bot.humanise_map("") == "unknown map"
    assert bot.humanise_map(None) == "unknown map"


# ------------------------------------------------------------------- map cycle
def test_next_map_cycle():
    pool = ["de_dust2", "de_nuke", "de_train"]
    assert bot.next_map(pool, "de_dust2") == "de_nuke"
    assert bot.next_map(pool, "de_train") == "de_dust2"       # wraps
    assert bot.next_map(pool, "de_unknown") == pool[0]        # unknown map
    assert bot.next_map([], "de_dust2") is None               # empty pool
    assert bot.next_map(pool, None) == pool[0]


def test_map_pool_missing_file():
    missing = os.path.join(HERE, "does-not-exist.txt")
    assert bot.map_pool(missing) == []
    assert bot.map_pool(None) == []


def test_map_pool_reads_and_skips_comments():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "mapcycle.txt")
        with open(path, "w") as fh:
            fh.write("de_dust2\n// a comment\n\n  de_nuke  \n")
        assert bot.map_pool(path) == ["de_dust2", "de_nuke"]
        assert bot.next_map(bot.map_pool(path), "de_nuke") == "de_dust2"


# ------------------------------------------------------------------- A2S bytes
def test_parse_a2s_info_goldsrc():
    info = bot.parse_a2s_info(goldsrc_info("de_nuke", 9, 32))
    assert info == {"name": "FreeNova CS 1.6", "map": "de_nuke", "players": 9, "max": 32}


def test_parse_a2s_info_source():
    info = bot.parse_a2s_info(source_info("de_dust2", 3, 16))
    assert info["map"] == "de_dust2" and info["players"] == 3 and info["max"] == 16


def test_parse_a2s_info_malformed():
    assert bot.parse_a2s_info(None) is None
    assert bot.parse_a2s_info(b"") is None
    assert bot.parse_a2s_info(b"garbage") is None
    assert bot.parse_a2s_info(b"\xff\xff\xff\xff") is None
    assert bot.parse_a2s_info(b"\xff\xff\xff\xffXbroken") is None      # unknown kind
    assert bot.parse_a2s_info(goldsrc_info()[:20]) is None             # truncated
    assert bot.parse_a2s_info(b"\xff\xff\xff\xffm\x30no-nulls") is None


def test_parse_a2s_players():
    parsed = bot.parse_a2s_players(a2s_players(("aimer", 12, 900), ("camper", 3, 60)))
    assert [p["name"] for p in parsed] == ["aimer", "camper"]
    assert parsed[0]["score"] == 12 and parsed[0]["seconds"] == 900


def test_parse_a2s_players_edge_cases():
    assert bot.parse_a2s_players(a2s_players()) == []                  # empty server
    assert bot.parse_a2s_players(b"\xff\xff\xff\xffD\x02") is None     # says 2, has none
    assert bot.parse_a2s_players(b"not a reply") is None
    assert bot.parse_a2s_players(b"\xff\xff\xff\xffI\x01") is None     # wrong kind
    assert bot.parse_a2s_players(None) is None


# ------------------------------------------------------------------ A2S cache
def test_cache_caches_and_negatives():
    calls = {"n": 0}

    def fake_probe(host, port, timeout=bot.PROBE_TIMEOUT):
        calls["n"] += 1
        return {"name": "x", "map": "de_dust2", "players": 1, "max": 2} if calls["n"] == 1 else None

    original = bot.probe_info
    bot.probe_info = fake_probe
    bot.CACHE.clear()
    try:
        server = {"host": "h", "port": 1}
        first = asyncio.run(bot.get_info(server))
        second = asyncio.run(bot.get_info(server))          # served from cache
        assert first and second == first
        assert calls["n"] == 1, "a burst of commands must not re-probe"
        assert bot.CACHE.hits >= 1
        # a failing probe is cached too, so a dead server is not hammered
        bot.probe_info = lambda *a, **k: None
        bot.CACHE.clear()
        assert asyncio.run(bot.get_info(server, fresh=True)) is None
        assert asyncio.run(bot.get_info(server)) is None
        assert bot.CACHE.misses >= 1
    finally:
        bot.probe_info = original
        bot.CACHE.clear()


def test_cache_expiry():
    cache = bot.TTLCache(ttl=0.05)
    cache.put("k", "v")
    assert cache.get("k") == "v"
    time.sleep(0.06)
    assert cache.get("k") is bot.MISS
    cache.put("none", None)
    assert cache.get("none") is None            # negative results are values too


# -------------------------------------------------------------------- presence
def test_presence_offline():
    presence = bot.presence_for(None)
    assert presence.kind == "offline" and presence.status == "idle"
    assert "come back" in presence.text


def test_presence_empty_and_full():
    empty = bot.presence_for({"map": "de_dust2", "players": 0, "max": 32})
    assert empty.kind == "empty" and "waiting for players" in empty.text
    full = bot.presence_for({"map": "de_nuke", "players": 32, "max": 32})
    assert full.kind == "full" and "full house" in full.text


def test_presence_rotation_and_event_hint():
    info = {"map": "de_train", "players": 9, "max": 32}
    texts = [bot.presence_for(info, cycle) .text for cycle in range(3)]
    assert texts[0] == "de Train · 9/32 · defuse"
    assert texts[1] == "de Train · 9/32 · 23 free"
    assert texts[2] == "de Train · 9/32"
    assert bot.presence_for(info, 2, "Knife night").text == "de Train · 9/32 · Knife night"
    assert bot.presence_for(info, 0).status == "online"


def test_map_kind():
    assert bot.map_kind("de_dust2") == "defuse"
    assert bot.map_kind("cs_office") == "hostage rescue"
    assert bot.map_kind("awp_india") == "AWP only"
    assert bot.map_kind("fun_map") == "custom"
    assert bot.map_kind(None) == "custom"


# ---------------------------------------------------------------- leaderboard
def test_leaderboard_from_api_rows():
    board = bot.leaderboard_from_api(API_TOP_ALL, "all", "xp", 10, "https://x/top15")
    assert board.ok and board.period == "all" and board.metric == "xp"
    assert [row.rank for row in board.rows] == [1, 2, 3]
    assert board.rows[0].name == "ajxs" and board.rows[0].value == 24889
    assert board.rows[0].steamid == "STEAM_0:0:683671116"
    assert board.rows[0].line() == "**1.** ajxs - 24,889 XP"
    assert board.subtitle() == "Lifetime" and board.complete and board.total == 12
    assert board.coverage_note() == "Lifetime", "a complete board has no caveat"


def test_leaderboard_week_carries_partial_coverage():
    board = bot.leaderboard_from_api(API_TOP_WEEK, "week", "xp", 10, "https://x/top/week")
    assert board.ok and board.subtitle() == "Week 47 · 2026" and not board.complete
    assert board.rows[0].line() == "**1.** zerbou3I - 950 XP"
    assert board.key == "2026-W47" and board.total == 2
    note = board.coverage_note()
    assert "Week 47 · 2026" in note and "tracked since" in note
    assert "15 players observed" in note


def test_leaderboard_kills_metric():
    payload = json.loads(json.dumps(API_TOP_WEEK))
    payload["metric"] = "kills"
    for row in payload["rows"]:
        row["metric"] = "kills"
        row["value"] = 120
    board = bot.leaderboard_from_api(payload, "week", "kills")
    assert board.metric == "kills"
    assert board.rows[0].line() == "**1.** zerbou3I - 120 kills"
    assert board.rows[0].value_text() == "120 kills"
    single = bot.LeaderRow(rank=3, name="One", value=1, metric="kills")
    assert single.value_text() == "1 kill", "one kill is not '1 kills'"
    assert bot.LeaderRow(rank=1, name="X").value_text() == ""


def test_leaderboard_empty_week_says_when_tracking_started():
    board = bot.leaderboard_from_api(API_TOP_EMPTY_WEEK, "week", "xp")
    assert not board.ok and board.note_kind == "not_started"
    assert "No finished week yet" in board.note
    assert f"<t:{NOW_TS - 120}:D>" in board.note, "the date the board started tracking"
    assert "Week 47 · 2026" in board.note


def test_leaderboard_empty_without_baseline():
    payload = json.loads(json.dumps(API_TOP_EMPTY_WEEK))
    payload["coverage"] = {"observed_players": 0, "first_seen": 0, "complete": False}
    board = bot.leaderboard_from_api(payload, "week", "xp")
    assert not board.ok and board.note_kind == "empty"
    assert board.note == "Nothing on the Week 47 · 2026 board yet."


def test_leaderboard_tolerates_junk():
    board = bot.leaderboard_from_api(None, "week", "xp")
    assert not board.ok and board.note_kind == "unavailable"
    weird = bot.leaderboard_from_api({"rows": [{"rank": "x"}, "junk", {"name": "   "}],
                                      "coverage": "nope", "window": 5}, "week", "xp")
    assert weird.rows == () and weird.note_kind == "empty"


def test_fetch_leaderboard_asks_the_api_for_week():
    with stub_api({"/top?limit=15&metric=xp&period=week": (200, API_TOP_WEEK)}) as api:
        board = asyncio.run(bot.fetch_leaderboard("https://example.invalid", "week", 1))
    assert board.ok and len(board.rows) == 1, "the count is sliced locally"
    assert api.calls == ["/top?limit=15&metric=xp&period=week"]
    assert board.url == "https://example.invalid/top/week"


def test_fetch_leaderboard_unreachable_and_rate_limited():
    board = asyncio.run(bot.fetch_leaderboard("https://example.invalid", "all", 10))
    assert not board.ok and board.note_kind == "unavailable"
    limited = asyncio.run(bot.fetch_leaderboard("https://example.invalid", "all", 10)) \
        if False else None
    with stub_api({"/top?limit=15&metric=xp&period=all": (429, API_RATE_LIMITED)}):
        limited = asyncio.run(bot.fetch_leaderboard("https://example.invalid", "all", 10))
    assert limited.note_kind == "rate_limited" and "120" in limited.note


def test_top_command_renders_the_api_board():
    interaction = call_command("top", "week", 10, None,
                               api={"/top?limit=15&metric=xp&period=week": (200, API_TOP_WEEK)})
    embed = interaction.answer["embeds"][0]
    assert embed.title == "Top 2 · Week 47 · 2026"
    assert embed.colour.value == bot.COLOUR_BP
    assert embed.description.splitlines()[0] == "**1.** zerbou3I - 950 XP"
    assert "tracked since" in embed.footer.text
    assert "panel API · board built" in embed.footer.text


def test_top_command_empty_week_is_dim_and_honest():
    interaction = call_command("top", "week", 10, None,
                               api={"/top?limit=15&metric=xp&period=week":
                                    (200, API_TOP_EMPTY_WEEK)})
    embed = interaction.answer["embeds"][0]
    assert embed.title == "Leaderboard · Week 47 · 2026"
    assert embed.colour.value == bot.COLOUR_DIM
    assert "No finished week yet" in embed.description


def test_top_command_kills():
    payload = json.loads(json.dumps(API_TOP_WEEK))
    payload["metric"] = "kills"
    for row in payload["rows"]:
        row["metric"] = "kills"
        row["value"] = 120
    interaction = call_command("top", "week", 10, "kills",
                               api={"/top?limit=15&metric=kills&period=week": (200, payload)})
    embed = interaction.answer["embeds"][0]
    assert embed.title == "Top 2 kills · Week 47 · 2026"
    assert "120 kills" in embed.description


def test_top_command_rate_limited():
    interaction = call_command("top", "all", 10, None,
                               api={"/top?limit=15&metric=xp&period=all":
                                    (429, API_RATE_LIMITED)})
    embed = interaction.answer["embeds"][0]
    assert embed.colour.value == bot.COLOUR_WARN
    assert "rate-limiting" in embed.description


# --------------------------------------------------------------------- profile
def test_is_steamid():
    assert bot.is_steamid("STEAM_0:1:12345")
    assert bot.is_steamid("steam_2:0:15")
    assert not bot.is_steamid("ajxs")
    assert not bot.is_steamid("STEAM_0:1")
    assert not bot.is_steamid("")
    assert bot.normalise_steamid(" steam_0:1:123 ") == "STEAM_0:1:123"
    assert bot.packed_steamid("0-0-683671116") == "STEAM_0:0:683671116"
    assert bot.packed_steamid("STEAM_0:0:1") is None
    assert bot.packed_steamid("junk") is None


def test_player_from_api():
    profile = bot.player_from_api(API_PLAYER, "https://x/profile?steamid=1")
    assert profile is not None
    assert profile.name == "ajxs" and profile.steamid == "STEAM_0:0:683671116"
    assert profile.rank == 1
    assert profile.bp_tier == 18 and profile.bp_xp == 17889
    assert profile.bp_next_xp == 111 and profile.bp_tier_xp == 1000 and profile.bp_max_tier == 60
    assert profile.coins == 2400 and profile.playtime_minutes == 447
    assert profile.playtime_seconds == 447 * 60
    assert profile.badge_labels() == ("Weekly #1 · Week 46 · 2026",
                                      "Monthly #1 · October 2026",
                                      "Weekly top 3 · Week 45 · 2026",
                                      "Top 3 three weeks running · Week 44 · 2026"), \
        "all four badge kinds the API can award"
    assert profile.url == "https://x/profile?steamid=1"

    unranked = bot.player_from_api(API_PLAYER_UNRANKED)
    assert unranked is not None and unranked.rank is None and unranked.badges == ()

    assert bot.player_from_api(None) is None
    assert bot.player_from_api({}) is None
    assert bot.player_from_api({"steamid": "STEAM_0:0:1"}) is None, "no name is not a profile"
    odd = bot.player_from_api({"steamid": "STEAM_0:0:9", "name": "Odd", "badges": "nope",
                               "coins": None, "bp_max_tier": None})
    assert odd is not None and odd.coins == 0 and odd.bp_max_tier == 60


def test_match_live_player():
    players = [{"name": "ajxs", "score": 8, "seconds": 720},
               {"name": "Ajxs", "score": 1, "seconds": 60},
               {"name": "other", "score": 2, "seconds": 30}]
    single = bot.match_live_player([players[0], players[2]], "AJXS")
    assert single.state == "online" and single.seconds == 720 and single.score == 8
    shared = bot.match_live_player(players, "ajxs")
    assert shared.state == "shared" and shared.count == 2
    assert bot.match_live_player([players[2]], "ajxs").state == "offline"
    assert bot.match_live_player(None, "ajxs").state == "unknown", "probe failed"
    assert bot.match_live_player([], "ajxs").state == "offline", "empty server"


def test_lookup_profile_by_steamid_uses_the_api():
    with stub_api({"/player/STEAM_0%3A0%3A683671116": (200, API_PLAYER)}) as api:
        result = asyncio.run(bot.lookup_profile("https://x", "STEAM_0:0:683671116"))
    assert result.ok and result.profile.name == "ajxs"
    assert api.calls == ["/player/STEAM_0%3A0%3A683671116"], "one API call, no HTML page"
    assert result.url == "https://x/profile?steamid=STEAM_0%3A0%3A683671116"


def test_lookup_profile_accepts_a_packed_steamid():
    with stub_api({"/player/STEAM_0%3A0%3A683671116": (200, API_PLAYER)}) as api:
        result = asyncio.run(bot.lookup_profile("https://x", "0-0-683671116"))
    assert result.ok and api.calls == ["/player/STEAM_0%3A0%3A683671116"]


def test_lookup_profile_by_name_uses_the_search_page_then_the_api():
    with stub_api({"/player/STEAM_0%3A0%3A683671116": (200, API_PLAYER)}) as api:
        with stub_http({"top15?q=ajxs": SEARCH_HTML}):
            result = asyncio.run(bot.lookup_profile("https://x", "ajxs"))
    assert result.ok and result.profile.name == "ajxs"
    assert result.others == 1, "two players called ajxs on the board"
    assert api.calls == ["/player/STEAM_0%3A0%3A683671116"]


def test_lookup_profile_not_found_is_a_real_404():
    with stub_api({"/player/STEAM_0%3A0%3A999999999": (404, API_PLAYER_404)}):
        result = asyncio.run(bot.lookup_profile("https://x", "STEAM_0:0:999999999"))
    assert not result.ok and result.note_kind == "not-found"
    assert "no snapshot" in result.note
    embed = bot.lookup_embed(result)
    assert embed.colour.value == bot.COLOUR_WARN


def test_lookup_profile_bad_steamid_from_the_api():
    with stub_api({"/player/STEAM_0%3A0%3A1": (400, API_BAD_STEAMID)}):
        result = asyncio.run(bot.lookup_profile("https://x", "STEAM_0:0:1"))
    assert not result.ok and result.note_kind == "not-found"
    assert "couldn't read" in result.note


def test_lookup_profile_rate_limited():
    with stub_api({"/player/STEAM_0%3A0%3A683671116": (429, API_RATE_LIMITED)}):
        result = asyncio.run(bot.lookup_profile("https://x", "STEAM_0:0:683671116"))
    assert not result.ok and result.note_kind == "unreachable"
    assert "rate-limiting" in result.note


def test_lookup_profile_api_unreachable():
    result = asyncio.run(bot.lookup_profile("https://x", "STEAM_0:0:683671116"))
    assert not result.ok and result.note_kind == "unreachable"


def test_lookup_profile_name_not_found_needs_no_api_call():
    with stub_api({}) as api:
        with stub_http({"top15?q=": SEARCH_EMPTY_HTML}):
            result = asyncio.run(bot.lookup_profile("https://x", "ghost"))
    assert not result.ok and result.note_kind == "not-found"
    assert api.calls == [], "an unknown name never reaches the player endpoint"


def test_lookup_profile_candidates():
    """An inexact name shows the candidates instead of guessing."""
    page = """<table class='board'><tbody><tr class='row'><td class='idx'>4</td><td class='l'>
      <a class='pname' href='/profile?steamid=STEAM_0%3A0%3A1'>Arkanian</a></td></tr>
      <tr class='row'><td class='idx'>5</td><td class='l'>
      <a class='pname' href='/profile?steamid=STEAM_0%3A0%3A2'>Aran5005</a></td></tr></tbody></table>"""
    with stub_api({}) as api:
        with stub_http({"top15?q=": page}):
            result = asyncio.run(bot.lookup_profile("https://x", "aran"))
    assert not result.ok and result.note_kind == "ambiguous"
    assert [name for _, name in result.candidates] == ["Arkanian", "Aran5005"]
    assert api.calls == []
    embed = bot.lookup_embed(result)
    assert "Arkanian" in embed.description and "STEAM_0:0:1" in embed.description


def test_lookup_profile_search_page_unreachable():
    with stub_http({"top15?q=": None}):
        result = asyncio.run(bot.lookup_profile("https://x", "ajxs"))
    assert not result.ok and result.note_kind == "unreachable"


def test_profile_embeds_from_the_api():
    profile = bot.player_from_api(API_PLAYER, "https://x/profile?steamid=1")
    live = bot.LiveMatch(state="online", seconds=447 * 60, score=12, count=1)
    embeds = bot.profile_embeds(profile, "https://x", others=1, live=live)
    assert len(embeds) == 2
    main, battle_pass = embeds
    assert main.colour.value == bot.COLOUR_OK
    assert battle_pass.colour.value == bot.COLOUR_BP
    assert main.title == "ajxs"
    assert "Server rank #1" in main.description
    assert "in game now" in main.description and "7h 27m" in main.description
    assert "12 pts" in main.description
    fields = {field.name: field.value for field in main.fields}
    assert fields["Playtime"] == "7h 27m"
    assert fields["Coins"] == "2,400"
    assert fields["Badges"] == ("Weekly #1 · Week 46 · 2026 · Monthly #1 · October 2026 · "
                                "Weekly top 3 · Week 45 · 2026 · "
                                "Top 3 three weeks running · Week 44 · 2026"), \
        "badges are plain text, in the API's order"
    assert "STEAM_0:0:683671116" in main.footer.text
    assert "1 other player(s) share this name" in main.footer.text
    assert battle_pass.description == "Tier 18 / 60 · 17,889 BP XP"
    bp_fields = {field.name: field.value for field in battle_pass.fields}
    assert bp_fields["Progress"] == "889 / 1,000 XP · 111 to the next tier"


def test_profile_embeds_unranked_offline_no_badges():
    profile = bot.player_from_api(API_PLAYER_UNRANKED)
    embeds = bot.profile_embeds(profile, "https://x", live=bot.LiveMatch(state="offline"))
    main = embeds[0]
    assert "Unranked" in main.description
    assert "not on the server right now" in main.description
    fields = {field.name: field.value for field in main.fields}
    assert fields["Badges"].startswith("none yet")
    assert embeds[1].description == "Tier 1 / 60 · 0 BP XP"


def test_profile_embeds_maxed_battle_pass():
    payload = dict(API_PLAYER, bp_tier=60, bp_max_tier=60, bp_next_xp=0)
    profile = bot.player_from_api(payload)
    bp = bot.profile_embeds(profile, "https://x")[1]
    assert bp.description == "Tier 60 / 60 · 17,889 BP XP"
    assert "max tier reached" in bp.fields[0].value


def test_profile_command_is_ephemeral_and_shows_badges():
    async def fake_players(server, fresh=False):
        return [{"name": "ajxs", "score": 9, "seconds": 900},
                {"name": "someone", "score": 1, "seconds": 60}]

    original = bot.get_players
    bot.get_players = fake_players
    try:
        with stub_http({"top15?q=ajxs": SEARCH_HTML}):
            interaction = call_command("profile", "ajxs",
                                       api={"/player/STEAM_0%3A0%3A683671116": (200, API_PLAYER)})
    finally:
        bot.get_players = original
    assert interaction.response.defer_kw == {"thinking": True, "ephemeral": True}
    answer = interaction.answer
    assert answer["ephemeral"] is True
    assert [embed.title for embed in answer["embeds"]] == ["ajxs", "Battle Pass"]
    assert "in game now" in answer["embeds"][0].description
    assert "Weekly #1" in {field.name: field.value
                           for field in answer["embeds"][0].fields}["Badges"]


def test_profile_command_not_found_is_honest():
    interaction = call_command("profile", "STEAM_0:0:999999999",
                               api={"/player/STEAM_0%3A0%3A999999999": (404, API_PLAYER_404)})
    embed = interaction.answer["embeds"][0]
    assert embed.colour.value == bot.COLOUR_WARN
    assert "no snapshot" in embed.description
    assert interaction.answer["ephemeral"] is True


# ---------------------------------------------------------------------- events
def test_parse_events_states():
    raw = [
        {"title": "Running", "start": "2026-11-22T19:30:00Z", "end": "2026-11-22T21:00:00Z"},
        {"title": "Upcoming", "start": "2026-11-22T22:15:00Z", "end": "2026-11-23T00:00:00Z"},
        {"title": "Undated", "when": "Sundays after 20:00"},
        {"title": "Old", "start": "2026-11-20T18:00:00Z", "end": "2026-11-20T20:00:00Z"},
        {"nope": "no title"},
        "junk",
    ]
    events = bot.parse_events(raw, NOW)
    by_title = {event.title: event for event in events}
    assert set(by_title) == {"Running", "Upcoming", "Undated", "Old"}
    assert by_title["Running"].state(NOW) == "running"
    assert by_title["Upcoming"].state(NOW) == "upcoming"
    assert by_title["Undated"].state(NOW) == "undated"
    assert by_title["Old"].state(NOW) == "ended"
    assert [e.title for e in events][:2] == ["Running", "Upcoming"]


def test_event_that_already_ended():
    ended = bot.parse_events([{"title": "Old cup", "start": "2026-11-20T18:00:00Z",
                               "end": "2026-11-20T20:00:00Z"}], NOW)[0]
    assert ended.state(NOW) == "ended"
    assert bot.event_countdown(ended, NOW) == "ended 2 d ago"
    assert bot.select_events([ended], NOW) == [], "an event from two days ago drops off the schedule"
    recent = bot.parse_events([{"title": "Just ended",
                                "start": "2026-11-22T18:00:00Z",
                                "end": "2026-11-22T19:30:00Z"}], NOW)[0]
    assert bot.select_events([recent], NOW) == [recent]
    assert bot.event_countdown(recent, NOW) == "ended 30 m ago"
    embed = bot.events_embed([recent], NOW)
    assert "⚪ **Just ended**" in embed.description


def test_event_countdowns():
    running = bot.parse_events([{"title": "Now", "start": "2026-11-22T19:30:00Z",
                                 "end": "2026-11-22T21:00:00Z"}], NOW)[0]
    assert bot.event_countdown(running, NOW) == "running now · ends in 1 h"
    upcoming = bot.parse_events([{"title": "Later", "start": "2026-11-22T22:15:00Z"}], NOW)[0]
    assert bot.event_countdown(upcoming, NOW) == "in 2 h 15 m"
    undated = bot.parse_events([{"title": "Someday", "when": "Sundays"}], NOW)[0]
    assert bot.event_countdown(undated, NOW) == "Sundays"


def test_parse_events_tolerates_shapes():
    assert bot.parse_events(None, NOW) == []
    assert bot.parse_events({"events": [{"title": "Wrapped"}]}, NOW)[0].title == "Wrapped"
    assert bot.parse_time("2026-11-23 19:00").hour == 19       # naive read as UTC
    assert bot.parse_time("junk") is None and bot.parse_time(None) is None
    assert bot.parse_time(1732300000).year == 2024


def test_events_embed_empty():
    embed = bot.events_embed([], NOW)
    assert embed.colour.value == bot.COLOUR_DIM
    assert "Nothing scheduled" in embed.description
    assert bot.select_events([], NOW, limit="junk") == []


# ---------------------------------------------------------------- events + API
def test_parse_panel_events_states():
    events = bot.parse_panel_events(API_EVENTS, NOW)
    by_title = {event.title: event for event in events}
    assert by_title["Double XP Weekend"].state(NOW) == "running"
    assert by_title["Happy Hour"].state(NOW) == "upcoming"
    assert by_title["Overdue cup"].state(NOW) == "overdue", "the scheduler never started it"
    assert by_title["Kill Race"].state(NOW) == "undated"
    assert by_title["Kill Race"].start is None, "epoch 0 means no window"
    assert all(event.source == "panel" for event in events)
    assert events[0].title == "Double XP Weekend", "running first"
    assert bot.parse_panel_events(None, NOW) == []
    assert bot.parse_panel_events({"events": [{"title": "X", "state": "weird"}]}, NOW)[0].state_hint == ""
    assert bot.parse_panel_events({"events": ["junk", {"detail": "no title"}]}, NOW) == []


def test_merge_events_file_overrides_a_pinned_title():
    panel = bot.parse_panel_events(API_EVENTS, NOW)
    pinned = bot.parse_events([{"title": "double xp weekend", "detail": "ops pinned this",
                                "start": "2026-11-22T19:00:00Z",
                                "end": "2026-11-22T22:00:00Z"}], NOW)
    merged = bot.merge_events(panel, pinned, NOW)
    titles = [event.title for event in merged]
    assert titles.count("double xp weekend") == 1, "the file wins, no duplicate"
    winner = next(event for event in merged if event.title.lower() == "double xp weekend")
    assert winner.detail == "ops pinned this" and winner.source == "file"
    assert "Happy Hour" in titles, "panel rows without a pinned twin survive"


def test_events_embed_marks_overdue_and_cancelled():
    events = bot.parse_panel_events(API_EVENTS, NOW)
    events.append(bot.Event(title="Scrapped", start=NOW - timedelta(minutes=10),
                            end=NOW + timedelta(minutes=50), state_hint="cancelled",
                            source="panel"))
    embed = bot.events_embed(events, NOW, 10)
    assert "🟠 **Overdue cup**" in embed.description
    assert "the scheduler has not started it" in embed.description
    assert "⛔ **Scrapped**" in embed.description and "cancelled" in embed.description
    assert "not started: Overdue cup" in embed.footer.text


def test_events_command_reads_the_panel_schedule():
    interaction = call_command("events", 10, api={"/events": (200, API_EVENTS)})
    embed = interaction.answer["embeds"][0]
    assert "🟢 **Double XP Weekend**" in embed.description
    assert "🕒 **Happy Hour**" in embed.description
    assert "partial" not in embed.footer.text
    assert embed.footer.text.startswith("Panel schedule · updated <t:")


def test_events_command_falls_back_to_the_file():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "events.json")
        with open(path, "w") as fh:
            json.dump([{"title": "Pinned cup", "detail": "ops pinned",
                        "start": "2026-11-22T22:00:00Z", "end": "2026-11-22T23:00:00Z"}], fh)
        original = bot.EVENTS_PATH
        bot.EVENTS_PATH = path
        try:
            interaction = call_command("events", 10)          # API stubbed as unreachable
        finally:
            bot.EVENTS_PATH = original
    embed = interaction.answer["embeds"][0]
    assert "Pinned cup" in embed.description
    assert embed.footer.text == "events.json only · the panel schedule didn't answer"


def test_events_command_caches_the_api_for_five_minutes():
    """The events endpoint is polled every 30 s but fetched at most every 5 min."""
    calls: list[str] = []

    def fake(base, path, params=None, timeout=bot.HTTP_TIMEOUT):
        calls.append(path)
        return bot.ApiResult(200, API_EVENTS)

    original = bot.api_get
    bot.api_get = fake
    bot.API_CACHE.clear()
    try:
        first = asyncio.run(bot.get_api("https://x", "/events", ttl=bot.EVENTS_TTL))
        second = asyncio.run(bot.get_api("https://x", "/events", ttl=bot.EVENTS_TTL))
    finally:
        bot.api_get = original
        bot.API_CACHE.clear()
    assert bot.EVENTS_TTL == 300.0
    assert first.ok and second.ok and calls == ["/events"], "two reads, one request"


def test_notices_ignore_overdue_and_cancelled_rows():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        store = bot.StateStore(os.path.join(tmp, "state.json"))
        events = bot.parse_panel_events(API_EVENTS, NOW)
        events.append(bot.Event(title="Scrapped", start=NOW - timedelta(minutes=5),
                                state_hint="cancelled", source="panel"))
        assert store.transitions(events, NOW) == [], "nothing running, nothing to announce"
        fresh_running = [bot.Event(title="Live now", start=NOW - timedelta(minutes=2),
                                   state_hint="active", source="panel")]
        assert [kind for _, kind in store.transitions(fresh_running, NOW)] == ["started"]


def test_state_store_announces_once():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "state.json")
        store = bot.StateStore(path)
        events = bot.parse_events([{"title": "Cup",
                                    "start": "2026-11-22T19:55:00Z",
                                    "end": "2026-11-22T20:10:00Z"}], NOW)
        first = store.transitions(events, NOW)
        assert [(event.title, kind) for event, kind in first] == [("Cup", "started")]
        # unmarked transitions are offered again: a failed post is retried next cycle
        assert len(store.transitions(events, NOW)) == 1
        store.mark_announced(events[0], "started")
        assert store.transitions(events, NOW) == [], "not announced again once marked"
        assert json.load(open(path))["events"]              # the file was written
        # a restart must not re-announce either
        again = bot.StateStore(path)
        assert again.transitions(events, NOW) == []
        # and the end is announced exactly once when the event is over
        later = NOW + timedelta(minutes=15)
        assert [(event.title, kind) for event, kind in again.transitions(events, later)] == [
            ("Cup", "ended")]
        again.mark_announced(events[0], "ended")
        assert bot.StateStore(path).transitions(events, later) == []


def test_state_store_skips_stale_transitions():
    """A restart mid-event must not shout 'starts now' for something from noon."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        store = bot.StateStore(os.path.join(tmp, "state.json"))
        old = bot.parse_events([{"title": "Noon cup",
                                 "start": "2026-11-22T16:00:00Z",
                                 "end": "2026-11-22T22:00:00Z"}], NOW)
        assert store.transitions(old, NOW) == [], "6 h old is past the grace window"
        assert store.dirty, "the skip still has to be remembered"
        assert store.section("events")[old[0].key]["posted"] == ["started"]
        assert store.transitions(old, NOW) == []
        fresh = bot.parse_events([{"title": "Just started",
                                   "start": "2026-11-22T19:59:00Z",
                                   "end": "2026-11-22T22:00:00Z"}], NOW)
        assert [kind for _, kind in store.transitions(fresh, NOW)] == ["started"]
        stale_end = bot.parse_events([{"title": "Finished ages ago",
                                       "start": "2026-11-22T15:00:00Z",
                                       "end": "2026-11-22T16:00:00Z"}], NOW)
        assert store.transitions(stale_end, NOW) == []


# ------------------------------------------------------------------ monitoring
def test_alert_transition():
    state = {}
    state, kind = bot.alert_transition(state, None, down_after=2, now=100)
    assert kind is None and state["fails"] == 1
    state, kind = bot.alert_transition(state, None, down_after=2, now=101)
    assert kind == "down" and state["down"] is True and state["since"] == 101
    state, kind = bot.alert_transition(state, None, down_after=2, now=102)
    assert kind is None and state["fails"] == 3, "no second 'down' while already down"
    state, kind = bot.alert_transition(state, {"map": "de_nuke", "players": 0, "max": 32},
                                       down_after=2, now=103)
    assert kind == "up" and state["down"] is False and state["fails"] == 0
    state, kind = bot.alert_transition(state, {"map": "de_nuke"}, down_after=2, now=104)
    assert kind is None and state["fails"] == 0
    one = {}
    one, kind = bot.alert_transition(one, None, down_after=1, now=200)
    assert kind == "down", "down_after=1 shouts on the first miss"


def test_updown_policy():
    assert bot.updown_enabled("on", on_duty=True) is True
    assert bot.updown_enabled("OFF", on_duty=False) is False
    assert bot.updown_enabled("auto", on_duty=True) is False
    assert bot.updown_enabled("auto", on_duty=False) is True
    assert bot.updown_enabled(None, on_duty=False) is True


def test_watcher_detection():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        cfg = os.path.join(tmp, "watch.json")
        state = os.path.join(tmp, "state.json")
        now = time.time()
        assert bot.watcher_on_duty(cfg, state, now=now) is False        # both missing
        with open(cfg, "w") as fh:
            json.dump({"webhook": "https://discord.com/api/webhooks/1/x"}, fh)
        assert bot.watcher_on_duty(cfg, state, now=now) is False        # no state yet
        with open(state, "w") as fh:
            fh.write("{}")
        assert bot.watcher_on_duty(cfg, state, now=now) is True         # fresh state
        assert bot.watcher_on_duty(cfg, state, max_age=60, now=now + 600) is False
        with open(cfg, "w") as fh:
            json.dump({"webhook": ""}, fh)
        assert bot.watcher_on_duty(cfg, state, now=now) is False        # no webhook


def test_samples_roundtrip_and_prune():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "samples.jsonl")
        bot.append_sample(path, NOW, {"players": 9, "map": "de_train", "max": 32})
        bot.append_sample(path, NOW, None)
        with open(path, "a") as fh:
            fh.write("not json\n")
        rows = bot.load_samples(path)
        assert len(rows) == 2 and rows[0]["p"] == 9 and rows[1]["p"] is None
        old = {"t": int(NOW.timestamp()) - 30 * 86400, "p": 5, "m": "old", "max": 32}
        with open(path, "a") as fh:
            fh.write(json.dumps(old) + "\n")
        assert len(bot.load_samples(path)) == 3
        assert bot.load_samples(path, since=NOW.timestamp() - 60) != []
        kept = bot.prune_samples(path, keep=86400, now=NOW.timestamp())
        assert kept == 2
        assert all(row["t"] >= NOW.timestamp() - 86400 for row in bot.load_samples(path))


def test_maybe_prune_samples_runs_once_a_day():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "samples.jsonl")
        bot.append_sample(path, NOW, {"players": 1, "map": "de_dust2", "max": 32})
        old = {"t": int(NOW.timestamp()) - 10 * 86400, "p": 2, "m": "old", "max": 32}
        with open(path, "a") as fh:
            fh.write(json.dumps(old) + "\n")
        state: dict = {}
        first = bot.maybe_prune_samples(state, path, NOW.timestamp())
        assert first == 1, "the first cycle prunes old rows"
        assert bot.maybe_prune_samples(state, path, NOW.timestamp() + 60) is None
        again = bot.maybe_prune_samples(state, path, NOW.timestamp() + 86401)
        assert again == 1, "and then it prunes at most once a day"


def test_digest_stats_and_embed():
    samples = []
    for index in range(10):
        stamp = int((NOW - timedelta(minutes=30 * index)).timestamp())
        players = None if index == 4 else 4 + index
        samples.append({"t": stamp, "p": players,
                        "m": None if players is None else ("de_dust2" if index % 3 else "de_nuke"),
                        "max": 32})
    samples.append({"t": int(NOW.timestamp()) - 3 * 86400, "p": 99, "m": "ancient", "max": 32})
    stats = bot.digest_stats(samples, NOW)
    assert stats["peak"] == 13 and stats["samples"] == 10 and stats["up"] == 9
    assert stats["map"] == "de_dust2"
    assert abs(stats["average"] - sum([4 + i for i in range(10) if i != 4]) / 9) < 0.01
    embed = bot.digest_embed(stats, {"name": "CS 1.6 Classic"})
    fields = {field.name: field.value for field in embed.fields}
    assert fields["Peak players"].startswith("**13/32**")
    assert "de_dust2" in fields["Map of the day"]
    assert embed.colour.value == bot.COLOUR_OK
    empty = bot.digest_embed(bot.digest_stats([], NOW), {"name": "x"})
    assert empty.colour.value == bot.COLOUR_DIM and "nothing to summarise" in empty.description


# -------------------------------------------------------------------- language
def test_string_table_covers_every_key_used():
    """No `t("…")` in the bot may be missing from the English table."""
    import re

    source = open(os.path.join(HERE, "bot.py"), encoding="utf-8").read()
    used = set(re.findall(r'(?<![A-Za-z0-9_."\'])t\("([a-z][a-zA-Z0-9_.]*)"', source))
    assert used, "the scan should find the string keys"
    missing = sorted(key for key in used if key not in bot.STRINGS["en"])
    assert missing == [], f"missing from STRINGS['en']: {missing}"
    dynamic = ([f"events.marker.{state}" for state in ("running", "upcoming", "ended", "undated")]
               + [f"period.adj.{period}" for period in ("all", "week", "month")]
               + [f"mapkind.{kind}" for kind in ("defuse", "hostage", "awp", "aim", "iceworld",
                                                 "grenades", "surf", "kz", "zombie", "deathrun",
                                                 "custom")])
    assert [key for key in dynamic if key not in bot.STRINGS["en"]] == []


def test_translation_can_drop_in():
    """A partial translation works: translated keys win, the rest fall back to English."""
    bot.STRINGS["test"] = {"presence.offline": "en attente du serveur",
                           "cmd.status.map": "Carte"}
    try:
        assert bot.set_language("test") == "test"
        assert bot.t("presence.offline") == "en attente du serveur"
        assert bot.t("cmd.status.players") == "Players", "missing keys fall back to English"
        assert bot.presence_for(None).text == "en attente du serveur"
        assert bot.t("no.such.key") == "no.such.key"
        assert bot.set_language("klingon") == "en", "unknown languages fall back to English"
        assert bot.t("presence.offline") == "for the server to come back"
    finally:
        bot.STRINGS.pop("test", None)
        bot.set_language("en")


def test_t_survives_bad_placeholders():
    bot.STRINGS["test"] = {"broken": "hello {nope}"}
    try:
        bot.set_language("test")
        assert bot.t("broken") == "hello {nope}"        # logged, not raised
    finally:
        bot.STRINGS.pop("test", None)
        bot.set_language("en")


# ---------------------------------------------------------------------- embeds
def test_offline_embed():
    embed = bot.offline_embed({"name": "CS 1.6 Classic", "host": "1.2.3.4", "port": 27015})
    assert embed.colour.value == bot.COLOUR_WARN
    assert "offline" in embed.title and "1.2.3.4:27015" in embed.description


def test_help_embed():
    embed = bot.help_embed([("status", "Live status", []),
                            ("top", "The leaderboard", [("period", "Which board")])],
                           "https://example.invalid", "CS 1.6 Classic")
    fields = {field.name: field.value for field in embed.fields}
    assert "/status" in fields and "/top" in fields
    assert "`period` · Which board" in fields["/top"]
    assert embed.colour.value == bot.COLOUR_OK


# ------------------------------------------------------------------ command glue
def test_command_guard_defers_and_reports_offline():
    """The real command callback answers even with the game server unreachable."""
    instance = bot.build_bot(sample_cfg())
    interaction = FakeInteraction()
    asyncio.run(instance.tree.get_command("status").callback(interaction))
    assert interaction.response.defer_kw == {"thinking": True, "ephemeral": False}
    answer = interaction.answer
    assert answer["embeds"][0].colour.value == bot.COLOUR_WARN
    assert "offline" in answer["embeds"][0].title.lower()


def test_command_guard_empty_server():
    """An empty server is not an error: /players says so and stays calm."""
    instance = bot.build_bot(sample_cfg())

    async def empty_players(server, fresh=False):
        return []

    original = bot.get_players
    bot.get_players = empty_players
    try:
        interaction = FakeInteraction()
        asyncio.run(instance.tree.get_command("players").callback(interaction, 5))
    finally:
        bot.get_players = original
    answer = interaction.answer
    embed = answer["embeds"][0]
    assert embed.colour.value == bot.COLOUR_DIM
    assert "empty" in embed.title.lower() and "waiting for players" in embed.description


def test_command_guard_catches_exceptions():
    """A raising helper turns into an apology, not a dead handler."""
    instance = bot.build_bot(sample_cfg())

    async def boom(server, fresh=False):
        raise RuntimeError("kaboom")

    original = bot.get_players
    bot.get_players = boom
    bot.log.disabled = True                    # keep the deliberate traceback out of the output
    try:
        interaction = FakeInteraction()
        asyncio.run(instance.tree.get_command("players").callback(interaction, 5))
    finally:
        bot.get_players = original
        bot.log.disabled = False
    assert interaction.answer["content"] == bot.t("error.generic")


def test_registered_command_table():
    instance = bot.build_bot(sample_cfg())
    names = sorted(command.name for command in instance.tree.get_commands())
    assert names == ["events", "help", "map", "players", "profile", "status", "top"]
    top = instance.tree.get_command("top")
    assert [parameter.name for parameter in top.parameters] == ["period", "count", "metric"]
    assert top.parameters[1].required is False
    profile = instance.tree.get_command("profile")
    assert profile.parameters[0].name == "player" and profile.parameters[0].required is True


def test_cooldown_remaining():
    bucket: dict[str, list[float]] = {}
    assert bot.cooldown_remaining(bucket, "u1", 0.0, 2, 10.0) == 0.0
    assert bot.cooldown_remaining(bucket, "u1", 1.0, 2, 10.0) == 0.0
    wait = bot.cooldown_remaining(bucket, "u1", 2.0, 2, 10.0)
    assert 7.9 < wait <= 8.0, f"third call inside the window waits ~8 s (got {wait})"
    assert bot.cooldown_remaining(bucket, "u2", 2.0, 2, 10.0) == 0.0, "per user, not global"
    assert bot.cooldown_remaining(bucket, "u1", 11.0, 2, 10.0) == 0.0, "window slides"
    assert bot.cooldown_remaining(bucket, "u1", 12.0, 0, 0) == 0.0, "rate 0 means no limit"


def test_command_guard_rate_limits_profile():
    """Two /profile calls are fine, the third inside 20 s is answered with a cooldown."""
    bot.COOLDOWN_BUCKETS.clear()
    instance = bot.build_bot(sample_cfg())
    routes = {"/player/STEAM_0%3A0%3A683671116": (200, API_PLAYER)}
    try:
        with stub_http({"top15?q=": SEARCH_HTML}), stub_api(routes):
            first = FakeInteraction()
            asyncio.run(instance.tree.get_command("profile").callback(first, "ajxs"))
            second = FakeInteraction()
            asyncio.run(instance.tree.get_command("profile").callback(second, "ajxs"))
            third = FakeInteraction()
            asyncio.run(instance.tree.get_command("profile").callback(third, "ajxs"))
    finally:
        bot.COOLDOWN_BUCKETS.clear()
    assert first.answer["embeds"], "the first call answers with the profile"
    assert second.answer["embeds"], "the second call is still inside the limit"
    assert third.answer.get("ephemeral") is True
    assert third.answer["content"].startswith("Easy there")
    assert not third.answer.get("embeds"), "the blocked call does not hit the leaderboard"


def test_status_shows_the_peak_from_samples():
    """`/status` adds the 24 h peak when the sample log has data - and omits it when not."""
    import tempfile

    async def fake_info(server, fresh=False):
        return {"name": "FreeNova CS 1.6", "map": "de_dust2", "players": 9, "max": 32}

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "samples.jsonl")
        cfg = sample_cfg()
        cfg["samples_path"] = path
        original = bot.get_info
        bot.get_info = fake_info
        try:
            empty = call_command("status", cfg=cfg)          # API stubbed as unreachable
            names = [field.name for field in empty.answer["embeds"][0].fields]
            assert bot.t("cmd.status.peak") not in names, "no samples, no peak field"

            now = datetime.now(timezone.utc)
            for minutes, players in ((5, 12), (15, 21)):
                bot.append_sample(path, now - timedelta(minutes=minutes),
                                  {"players": players, "map": "de_dust2", "max": 32})
            busy = call_command("status", cfg=cfg)
            fields = {field.name: field.value for field in busy.answer["embeds"][0].fields}
            assert fields[bot.t("cmd.status.peak")].startswith("**21/32**")
        finally:
            bot.get_info = original


# ------------------------------------------------------------------ /status + API
def test_api_result_parsing():
    """`api_get` turns status codes and bodies into one honest result."""
    original = bot._http_json
    try:
        bot._http_json = lambda url, timeout=bot.HTTP_TIMEOUT: (200, '{"ok": true}')
        assert bot.api_get("https://x", "/status").ok
        bot._http_json = lambda url, timeout=bot.HTTP_TIMEOUT: (404, json.dumps(API_PLAYER_404))
        result = bot.api_get("https://x", "/player/STEAM_0:0:999999999")
        assert result.status == 404 and result.not_found and result.error == "player_not_found"
        bot._http_json = lambda url, timeout=bot.HTTP_TIMEOUT: (429, json.dumps(API_RATE_LIMITED))
        result = bot.api_get("https://x", "/top")
        assert result.rate_limited and result.error == "rate_limited"
        bot._http_json = lambda url, timeout=bot.HTTP_TIMEOUT: (400, json.dumps(API_BAD_STEAMID))
        assert bot.api_get("https://x", "/player/garbage").error == "bad_steamid"
        bot._http_json = lambda url, timeout=bot.HTTP_TIMEOUT: (0, "")
        result = bot.api_get("https://x", "/status")
        assert result.status == 0 and result.error == "unreachable" and not result.ok
        bot._http_json = lambda url, timeout=bot.HTTP_TIMEOUT: (200, "<html>challenge</html>")
        result = bot.api_get("https://x", "/status")
        assert not result.ok and result.error == "bad_json"
    finally:
        bot._http_json = original


def test_api_get_caches_but_not_errors():
    calls = {"n": 0}

    def fake(base, path, params=None, timeout=bot.HTTP_TIMEOUT):
        calls["n"] += 1
        if path == "/rate":
            return bot.ApiResult(429, error="rate_limited")
        return bot.ApiResult(200, {"hello": "world"})

    original = bot.api_get
    bot.api_get = fake
    bot.API_CACHE.clear()
    try:
        first = asyncio.run(bot.get_api("https://x", "/status"))
        second = asyncio.run(bot.get_api("https://x", "/status"))
        assert first.ok and second.ok and calls["n"] == 1, "a 200 is cached"
        asyncio.run(bot.get_api("https://x", "/rate"))
        asyncio.run(bot.get_api("https://x", "/rate"))
        assert calls["n"] == 3, "a 429 is never cached"
        bot.API_CACHE.clear()
    finally:
        bot.api_get = original
        bot.API_CACHE.clear()


def test_server_state_from_api():
    state = bot.server_state_from_api(API_STATUS_FRESH, NOW)
    assert state is not None
    assert state.map == "de_dust2" and state.players == 9 and state.max == 32
    assert state.online and not state.stale and state.has_players
    assert state.push_age == 12
    assert state.active_events == ("Double XP Weekend",)
    assert state.next_event is None

    stale = bot.server_state_from_api(API_STATUS_STALE, NOW)
    assert stale is not None and stale.stale and not stale.has_players
    assert stale.players is None and stale.map == "de_nuke" and stale.next_event == "Happy Hour"
    assert stale.push_age == 600

    # tolerant: junk, missing blocks, "—" map, null last_push
    assert bot.server_state_from_api(None, NOW) is None
    assert bot.server_state_from_api({}, NOW) is None
    assert bot.server_state_from_api({"server": "nope"}, NOW) is None
    odd = bot.server_state_from_api({"server": {"map": "—", "players": None, "max": None,
                                               "last_push": None, "stale": True}}, NOW)
    assert odd is not None and odd.map is None and odd.push_age is None and odd.stale


def test_status_uses_the_api_when_fresh():
    import tempfile

    async def same_info(server, fresh=False):
        return {"name": "FreeNova CS 1.6", "map": "de_dust2", "players": 9, "max": 32}

    original = bot.get_info
    bot.get_info = same_info
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cycle = os.path.join(tmp, "mapcycle.txt")
            with open(cycle, "w") as fh:
                fh.write("de_dust2\nde_inferno\nde_nuke\n")
            cfg = sample_cfg()
            cfg["mapcycle"] = cycle
            interaction = call_command("status", api={"/status": (200, API_STATUS_FRESH)}, cfg=cfg)
    finally:
        bot.get_info = original
    embed = interaction.answer["embeds"][0]
    fields = {field.name: field.value for field in embed.fields}
    assert embed.title == "FreeNova CS 1.6 | fn-gaming.net"
    assert fields["Map"] == "`de_dust2`"
    assert fields["Players"] == "**9/32**"
    assert fields["Next map"] == "`de_inferno`", "next map comes from the mapcycle"
    assert fields[bot.t("cmd.status.event")] == "Double XP Weekend"
    assert embed.footer.text == "panel API · game push 12s ago"


def test_status_prefers_a2s_when_the_panel_push_disagrees():
    """A fresh push can still carry a stale count - show the live one and say so."""

    async def live_info(server, fresh=False):
        return {"name": "FreeNova CS 1.6", "map": "de_dust2", "players": 9, "max": 32}

    original = bot.get_info
    bot.get_info = live_info
    try:
        cfg = sample_cfg()
        cfg["mapcycle"] = None
        interaction = call_command("status", api={"/status": (200, API_STATUS_DISAGREE)}, cfg=cfg)
    finally:
        bot.get_info = original
    embed = interaction.answer["embeds"][0]
    fields = {field.name: field.value for field in embed.fields}
    assert fields["Players"] == "**9/32**", "A2S is the live number"
    assert fields[bot.t("cmd.status.panel_push")] == "0/32 - the A2S count above is live"
    assert "its player count disagrees" in embed.footer.text
    assert embed.colour.value == bot.COLOUR_OK


def test_status_stale_shows_the_age_and_the_a2s_count():
    async def fake_info(server, fresh=False):
        return {"name": "FreeNova CS 1.6", "map": "de_nuke", "players": 7, "max": 32}

    original = bot.get_info
    bot.get_info = fake_info
    try:
        interaction = call_command("status", api={"/status": (200, API_STATUS_STALE)})
    finally:
        bot.get_info = original
    embed = interaction.answer["embeds"][0]
    fields = {field.name: field.value for field in embed.fields}
    assert fields["Players"] == "**7/32**", "the A2S probe fills in while the push is stale"
    assert fields[bot.t("cmd.status.panel_data")] == "**10 m old**"
    assert fields["Map"] == "`de_nuke`"
    assert "panel API · 10 m old · player count from the A2S probe" in embed.footer.text


def test_status_stale_without_a2s_says_the_count_is_unknown():
    async def no_info(server, fresh=False):
        return None

    original = bot.get_info
    bot.get_info = no_info
    try:
        interaction = call_command("status", api={"/status": (200, API_STATUS_STALE)})
    finally:
        bot.get_info = original
    embed = interaction.answer["embeds"][0]
    players = [field.value for field in embed.fields if field.name == bot.t("cmd.status.players")]
    assert players[0] == bot.t("cmd.status.unknown")
    assert players[-1] == bot.t("cmd.status.panel_players_unknown")
    assert "player count unknown" in embed.footer.text
    assert embed.colour.value == bot.COLOUR_DIM


def test_status_rate_limited_falls_back_to_a2s():
    async def fake_info(server, fresh=False):
        return {"name": "FreeNova CS 1.6", "map": "de_aztec", "players": 3, "max": 32}

    original = bot.get_info
    bot.get_info = fake_info
    try:
        interaction = call_command("status",
                                   api={"/status": (429, API_RATE_LIMITED)})
    finally:
        bot.get_info = original
    embed = interaction.answer["embeds"][0]
    fields = {field.name: field.value for field in embed.fields}
    assert fields["Players"] == "**3/32**" and fields["Map"] == "`de_aztec`"
    assert embed.footer.text == "A2S probe · panel API is rate-limiting me"
    assert embed.colour.value == bot.COLOUR_OK


def test_status_panel_says_offline():
    async def no_info(server, fresh=False):
        return None

    original = bot.get_info
    bot.get_info = no_info
    try:
        interaction = call_command("status", api={"/status": (200, API_STATUS_OFFLINE)})
    finally:
        bot.get_info = original
    embed = interaction.answer["embeds"][0]
    assert embed.colour.value == bot.COLOUR_WARN
    assert embed.description.startswith("The panel says the server is offline.")
    fields = {field.name: field.value for field in embed.fields}
    assert fields["Map"] == bot.t("cmd.status.unknown")


def test_status_nothing_answers_is_the_offline_card():
    async def no_info(server, fresh=False):
        return None

    original = bot.get_info
    bot.get_info = no_info
    try:
        interaction = call_command("status")          # API unreachable by default
    finally:
        bot.get_info = original
    embed = interaction.answer["embeds"][0]
    assert embed.colour.value == bot.COLOUR_WARN
    assert "offline" in embed.title.lower()


def test_digest_attempt_result():
    assert bot.digest_attempt_result(True, 0) == (True, 0)        # posted: day is done
    assert bot.digest_attempt_result(False, 0) == (False, 1)      # failed: retry next cycle
    assert bot.digest_attempt_result(False, 1) == (False, 2)
    assert bot.digest_attempt_result(False, 2) == (True, 3)       # three tries, then give up
    assert bot.digest_attempt_result(True, 2) == (True, 0)        # a late success resets it


def test_profile_live_line_is_translated():
    profile = bot.player_from_api(API_PLAYER)
    bot.STRINGS["test"] = {"profile.not_in_game": "hors ligne"}
    try:
        bot.set_language("test")
        embeds = bot.profile_embeds(profile, "https://x", live=bot.LiveMatch(state="offline"))
        assert "hors ligne" in embeds[0].description
    finally:
        bot.STRINGS.pop("test", None)
        bot.set_language("en")


# ----------------------------------------------------------------------- runner
def main() -> int:
    tests = sorted((name, obj) for name, obj in globals().items()
                   if name.startswith("test_") and callable(obj))
    failures = 0
    started = time.monotonic()
    for name, test in tests:
        try:
            test()
        except Exception:                      # noqa: BLE001 - a test failure is data
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"ok   {name}")
    elapsed = time.monotonic() - started
    print(f"\n{len(tests) - failures}/{len(tests)} tests passed in {elapsed:.2f}s")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
