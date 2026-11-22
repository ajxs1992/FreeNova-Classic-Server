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


TOP_HTML = """<table class='champ' cellspacing='0'><tr>
  <td class='ccrest'><img src='/ranks/rank_18.png' width='62' height='62' alt='Supreme Master First Class' title='Supreme Master First Class'></td>
  <td><div class='clabel'><span class='cplace'>1</span>Champion · Season 1</div>
    <div class='cname'><img src='https://flagcdn.com/20x15/ro.png' width='15'> <a href='/profile?steamid=STEAM_0%3A0%3A683671116' style='color:inherit;'>ajxs</a></div>
    <div class='crank'>Supreme Master First Class · Level 18 · last seen 26d</div></td>
  <td class='cxp'><b>24,889</b><span>XP</span></td>
</tr></table>
<table class='runner'><tr><td class='r2'>
  <span class='rplace'>2</span><img class='rcrest' src='/ranks/rank_14.png' width='26' title='Master Guardian Elite'>
  <span class='rname'><a href='/profile?steamid=STEAM_0%3A1%3A799106783' style='color:inherit;'>NPC_Leaders</a></span>
  <span class='rxp'>12,463 <em>XP</em></span>
  <span class='rmeta'>1.33 K/D · 41.7% · 76 wins</span>
</td></tr></table>
<table class='board' cellspacing='0'><tbody>
<tr class='row' onclick="location.href='/profile?steamid=STEAM_0%3A0%3A611856215'">
  <td class='idx'>4</td>
  <td class='l'><img src='https://flagcdn.com/20x15/se.png' width='13'> <a class='pname' href='/profile?steamid=STEAM_0%3A0%3A611856215'>npc_known</a>
    <span class='sub' title='Last seen 27d ago'>L1 · Unranked · seen 27d</span></td>
  <td class='metric'><span class='xp'>82</span></td>
  <td>0</td><td class='wcol'>0</td><td>0.00</td><td>—</td>
  <td class='c'><img class='crest' src='/ranks/rank_01.png' alt='Unranked' title='Unranked'></td>
</tr>
<tr class='row' onclick="location.href='/profile?steamid=STEAM_1%3A0%3A236593364'">
  <td class='idx'>5</td>
  <td class='l'><a class='pname' href='/profile?steamid=STEAM_1%3A0%3A236593364'>Ying</a>
    <span class='sub' title='Last seen 27d ago'>L1 · Unranked · seen 27d</span></td>
  <td class='metric'><span class='xp'>14</span></td>
  <td>0</td><td class='wcol'>0</td><td>—</td><td>—</td>
  <td class='c'><img class='crest' src='/ranks/rank_01.png' alt='Unranked' title='Unranked'></td>
</tr>
</tbody></table>"""

PROFILE_HTML = """<div class='panel idpanel'><table class='idtable'><tr>
  <td class='idcrestcell'><img class='bigcrest' src='/ranks/rank_18.png' width='42' height='42' alt='Supreme Master First Class' title='Supreme Master First Class'></td>
  <td><div class='pbig'><img src='https://flagcdn.com/20x15/ro.png' width='15' height='11' alt='ro'> ajxs</div>
    <div class='psmall'>Lvl 18 · Supreme Master First Class · offline · seen 26d</div></td>
  <td align='right' width='126'><div class='pxpbig'>24,889<span>XP</span></div>
    <div class='psmall'>Server rank #1</div></td>
</tr></table></div>
<table class='statgrid' cellspacing='0'>
  <tr><td><span class='sk'>Kills</span><span class='sv'>7</span></td><td><span class='sk'>Deaths</span><span class='sv'>7</span></td></tr>
  <tr><td><span class='sk'>K/D</span><span class='sv'>1.00</span></td><td><span class='sk'>HS%</span><span class='sv'>28.6%</span></td></tr>
  <tr><td><span class='sk'>Playtime</span><span class='sv'>7h 27m</span></td><td><span class='sk'>Wins</span><span class='sv'>14</span></td></tr>
</table>
<div class='skillrow'>Skill <span class='skill' style='background-color:#FCE590;color:#111'>L- 50</span></div>
<div class='skillrow'>VIP Elite · [ ajxs67 ]</div>
<div class='medal-count'>1 / 13 medals</div>
<table class='proghead'><tr>
  <td>Supreme Master First Class → Global Elite</td><td class='r'>5,111 XP to go</td></tr></table>
<table class='career'><tr><td class='first'><span class='k'>Battle Pass</span><span class='v p'>Tier 18 / 60</span><span class='sub'>889 / 1,000 XP</span><a href='/battlepass?steamid=STEAM_0%3A0%3A683671116&compact=1'>Open</a></td></tr></table>"""

PROFILE_MISSING_HTML = """<div class='pagehead'><div class='ph-t'>Player Profile</div></div>
<div class='panel msg'><b>No snapshot for STEAM_0:0:999999999</b><br>Play a few minutes on the server, then retry.</div>"""

SEARCH_HTML = """<table class='champ'><tr><td><span class='cplace'>1</span>
  <div class='cname'><a href='/profile?steamid=STEAM_0%3A0%3A683671116' style='color:inherit;'>ajxs</a></div></td></tr></table>
<table class='board'><tbody><tr class='row'><td class='idx'>8</td>
  <td class='l'><a class='pname' href='/profile?steamid=STEAM_2%3A1%3A2135760186'>ajxs</a></td></tr>
</tbody></table>"""

SEARCH_EMPTY_HTML = """<table class='board'><tbody><tr><td colspan='8' class='empty'>No player matches “ghost”.</td></tr></tbody></table>"""


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
def test_parse_top_html():
    rows = bot.parse_top_html(TOP_HTML)
    assert [r.rank for r in rows] == [1, 2, 4, 5]
    champion = rows[0]
    assert champion.name == "ajxs" and champion.xp == 24889
    assert champion.rank_name == "Supreme Master First Class" and champion.level == 18
    assert champion.steamid == "STEAM_0:0:683671116"
    runner = rows[1]
    assert runner.name == "NPC_Leaders" and runner.xp == 12463
    assert "76 wins" in runner.extra
    board = rows[2]
    assert board.name == "npc_known" and board.xp == 82 and board.level == 1
    assert board.extra == "seen 27d"
    assert "<Warrior>" not in " ".join(r.name for r in rows)
    assert rows[3].line().startswith("**5.** Ying - 14 XP")


def test_parse_top_html_empty_and_junk():
    assert bot.parse_top_html("") == []
    assert bot.parse_top_html("<html><body>maintenance</body></html>") == []
    assert bot.parse_top_html("<table class='board'><tbody></tbody></table>") == []


def test_fetch_leaderboard_unavailable_period():
    board = asyncio.run(asyncio.to_thread(bot.fetch_leaderboard, "https://example.invalid", "week"))
    assert board.period == "week" and not board.ok
    assert board.note_kind == "period"
    assert "weekly" in board.note and "invent" in board.note


def test_fetch_leaderboard_parses_stubbed_page():
    with stub_http({"example.invalid/top15": TOP_HTML}) as http:
        board = bot.fetch_leaderboard("https://example.invalid", "all", 3)
    assert board.ok and len(board.rows) == 3
    assert board.rows[0].name == "ajxs"
    assert board.url == "https://example.invalid/top15"
    assert http.calls == ["https://example.invalid/top15"]


def test_fetch_leaderboard_unreachable():
    with stub_http({"example.invalid/top15": None}):
        board = bot.fetch_leaderboard("https://example.invalid", "all")
    assert not board.ok and board.note_kind == "unavailable"


def test_fetch_leaderboard_challenge_page():
    """A Cloudflare challenge is not "no players" - it is "I could not read the board"."""
    challenge = ("<html><body><div id='cf-challenge'>Checking your browser…</div>"
                 "<script>window.__CF$cv$params={}</script></body></html>")
    with stub_http({"example.invalid/top15": challenge}):
        board = bot.fetch_leaderboard("https://example.invalid", "all")
    assert not board.ok and board.note_kind == "unavailable"
    assert "challenge" in board.note
    # an empty but genuine board is still reported as empty, not as a failure
    with stub_http({"example.invalid/top15": "<table class='board'><tbody></tbody></table>"}):
        empty = bot.fetch_leaderboard("https://example.invalid", "all")
    assert empty.note_kind == "empty"


# --------------------------------------------------------------------- profile
def test_is_steamid():
    assert bot.is_steamid("STEAM_0:1:12345")
    assert bot.is_steamid("steam_2:0:15")
    assert not bot.is_steamid("ajxs")
    assert not bot.is_steamid("STEAM_0:1")
    assert not bot.is_steamid("")
    assert bot.normalise_steamid(" steam_0:1:123 ") == "STEAM_0:1:123"


def test_parse_profile_html():
    profile = bot.parse_profile_html(PROFILE_HTML, "https://x/profile?steamid=1")
    assert profile is not None
    assert profile.name == "ajxs"
    assert profile.rank_name == "Supreme Master First Class"
    assert profile.level == 18 and profile.xp == 24889 and profile.server_rank == 1
    assert profile.state == "offline" and profile.seen == "26d" and profile.country == "RO"
    assert profile.stats["Playtime"] == "7h 27m" and profile.stats["K/D"] == "1.00"
    assert profile.bp_tier == "Tier 18 / 60" and profile.bp_xp == "889 / 1,000 XP"
    assert profile.next_rank == "Supreme Master First Class → Global Elite · 5,111 XP to go"
    assert profile.skill.startswith("Skill") and profile.vip.startswith("VIP Elite")
    assert profile.medals == "1 / 13 medals"
    assert profile.steamid == "STEAM_0:0:683671116"


def test_parse_profile_html_missing_snapshot():
    assert bot.parse_profile_html(PROFILE_MISSING_HTML) is None
    assert bot.parse_profile_html("") is None
    assert bot.parse_profile_html("<html>nothing</html>") is None


def test_profile_embeds_colours():
    profile = bot.parse_profile_html(PROFILE_HTML, "https://x/profile?steamid=1")
    embeds = bot.profile_embeds(profile, "https://x")
    assert len(embeds) == 2
    assert embeds[0].colour.value == bot.COLOUR_OK         # mint career card
    assert embeds[1].colour.value == bot.COLOUR_BP         # gold battle pass card
    assert "Level 18" in embeds[0].description and "Server rank #1" in embeds[0].description
    assert "Tier 18 / 60" in embeds[1].description
    fields = {field.name: field.value for field in embeds[0].fields}
    assert fields["XP"] == "**24,889**" and fields["Playtime"] == "7h 27m"
    assert "STEAM_0:0:683671116" in embeds[0].footer.text


def test_profile_embeds_mention_duplicate_names():
    profile = bot.parse_profile_html(PROFILE_HTML, "https://x/profile?steamid=1")
    embeds = bot.profile_embeds(profile, "https://x", others=2)
    assert embeds[0].footer.text.startswith("2 other player(s)")


def test_lookup_profile_exact_name():
    with stub_http({"top15?q=": SEARCH_HTML, "/profile?": PROFILE_HTML}):
        result = bot.lookup_profile("https://x", "ajxs")
    assert result.ok and result.profile.name == "ajxs"
    assert result.others == 1, "two players called ajxs on the board"


def test_lookup_profile_by_steamid_skips_search():
    with stub_http({"top15?q=": SEARCH_HTML, "/profile?": PROFILE_HTML}) as http:
        result = bot.lookup_profile("https://x", "STEAM_0:0:683671116")
    assert result.ok
    assert not any("top15?q=" in url for url in http.calls), "a STEAM id needs no search"
    assert http.calls[0].endswith("STEAM_0%3A0%3A683671116")


def test_lookup_profile_not_found():
    with stub_http({"top15?q=": SEARCH_EMPTY_HTML}):
        result = bot.lookup_profile("https://x", "ghost")
    assert not result.ok and result.note_kind == "not-found"
    assert "ghost" in result.note
    embed = bot.lookup_embed(result)
    assert embed.colour.value == bot.COLOUR_WARN and "ghost" in embed.title


def test_lookup_profile_no_snapshot():
    with stub_http({"top15?q=": SEARCH_HTML, "/profile?": PROFILE_MISSING_HTML}):
        result = bot.lookup_profile("https://x", "STEAM_0:0:999999999")
    assert not result.ok and result.note_kind == "not-found"
    assert "no snapshot" in result.note.lower()


def test_lookup_profile_candidates():
    """An inexact name shows the candidates instead of guessing."""
    page = """<table class='board'><tbody><tr class='row'><td class='idx'>4</td><td class='l'>
      <a class='pname' href='/profile?steamid=STEAM_0%3A0%3A1'>Arkanian</a></td></tr>
      <tr class='row'><td class='idx'>5</td><td class='l'>
      <a class='pname' href='/profile?steamid=STEAM_0%3A0%3A2'>Aran5005</a></td></tr></tbody></table>"""
    with stub_http({"top15?q=": page}):
        result = bot.lookup_profile("https://x", "aran")
    assert not result.ok and result.note_kind == "ambiguous"
    assert [name for _, name in result.candidates] == ["Arkanian", "Aran5005"]
    embed = bot.lookup_embed(result)
    assert "Arkanian" in embed.description and "STEAM_0:0:1" in embed.description


def test_lookup_profile_unreachable():
    with stub_http({"top15?q=": None}):
        result = bot.lookup_profile("https://x", "ajxs")
    assert not result.ok and result.note_kind == "unreachable"


def test_lookup_profile_unexpected_page():
    """A challenge page is reported as "can't read it", not as "no such player"."""
    page = "<html><body><div id='cf'>Checking your browser…</div></body></html>"
    with stub_http({"top15?q=": SEARCH_HTML, "/profile?": page}):
        result = bot.lookup_profile("https://x", "STEAM_0:0:683671116")
    assert not result.ok and result.note_kind == "unreachable"
    assert "can't read" in result.note


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


def test_state_store_announces_once():
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "state.json")
        store = bot.StateStore(path)
        events = bot.parse_events([{"title": "Cup", "start": "2026-11-22T19:00:00Z",
                                    "end": "2026-11-22T21:00:00Z"}], NOW)
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
        later = NOW + timedelta(hours=2)
        assert [(event.title, kind) for event, kind in again.transitions(events, later)] == [
            ("Cup", "ended")]
        again.mark_announced(events[0], "ended")
        assert bot.StateStore(path).transitions(events, later) == []


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


def test_command_guard_ephemeral_for_profile():
    instance = bot.build_bot(sample_cfg())
    with stub_http({"top15?q=": SEARCH_HTML, "/profile?": PROFILE_HTML}):
        interaction = FakeInteraction()
        asyncio.run(instance.tree.get_command("profile").callback(interaction, "ajxs"))
    assert interaction.response.defer_kw == {"thinking": True, "ephemeral": True}
    answer = interaction.answer
    assert answer["ephemeral"] is True
    assert [embed.title for embed in answer["embeds"]] == ["ajxs (RO)", "Battle Pass"]


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
    assert [parameter.name for parameter in top.parameters] == ["period", "count"]
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
    try:
        with stub_http({"top15?q=": SEARCH_HTML, "/profile?": PROFILE_HTML}):
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
        instance = bot.build_bot(cfg)
        original = bot.get_info
        bot.get_info = fake_info
        try:
            empty = FakeInteraction()
            asyncio.run(instance.tree.get_command("status").callback(empty))
            names = [field.name for field in empty.answer["embeds"][0].fields]
            assert bot.t("cmd.status.peak") not in names, "no samples, no peak field"

            now = datetime.now(timezone.utc)
            for minutes, players in ((5, 12), (15, 21)):
                bot.append_sample(path, now - timedelta(minutes=minutes),
                                  {"players": players, "map": "de_dust2", "max": 32})
            busy = FakeInteraction()
            asyncio.run(instance.tree.get_command("status").callback(busy))
            fields = {field.name: field.value for field in busy.answer["embeds"][0].fields}
            assert fields[bot.t("cmd.status.peak")].startswith("**21/32**")
        finally:
            bot.get_info = original


def test_digest_attempt_result():
    assert bot.digest_attempt_result(True, 0) == (True, 0)        # posted: day is done
    assert bot.digest_attempt_result(False, 0) == (False, 1)      # failed: retry next cycle
    assert bot.digest_attempt_result(False, 1) == (False, 2)
    assert bot.digest_attempt_result(False, 2) == (True, 3)       # three tries, then give up
    assert bot.digest_attempt_result(True, 2) == (True, 0)        # a late success resets it


def test_profile_state_is_translated():
    profile = bot.parse_profile_html(PROFILE_HTML, "https://x/profile?steamid=1")
    assert profile.state == "offline"
    bot.STRINGS["test"] = {"profile.state.offline": "hors ligne"}
    try:
        bot.set_language("test")
        embeds = bot.profile_embeds(profile, "https://x")
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
