#!/usr/bin/env python3
"""FreeNova CS 1.6 Discord bot.

Answers questions about the Classic server and keeps a live presence:
`/status`, `/players`, `/map`, `/top`, `/events`. Data comes straight from the
game server (A2S over UDP), the map cycle file, and the public leaderboard, so
the bot keeps working even when the panel is down.

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

Run with the venv that has discord.py: ~/.local/share/freenova-bot/venv/bin/python
"""
from __future__ import annotations

import html
import json
import os
import re
import socket
import struct
import urllib.request
from datetime import datetime, timezone

import discord
from discord import app_commands
from discord.ext import commands, tasks

CONFIG_PATH = os.path.expanduser("~/.config/freenova-bot/config.json")


def load_config() -> dict:
    with open(CONFIG_PATH) as fh:
        return json.load(fh)


CFG = load_config()
SERVER = CFG["server"]
HOST, PORT = SERVER["host"], int(SERVER["port"])
BASE = CFG.get("leaderboard", "https://leaderboard.fn-gaming.net").rstrip("/")


# --------------------------------------------------------------------------- A2S
def a2s_info(timeout: float = 4.0) -> dict | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(b"\xff\xff\xff\xffTSource Engine Query\x00", (HOST, PORT))
        data, _ = s.recvfrom(4096)
    except OSError:
        return None
    finally:
        s.close()

    def cstr(b, off):
        end = b.index(b"\x00", off)
        return b[off:end].decode("latin1"), end + 1

    try:
        i, kind = 4, data[4:5]
        i += 1
        if kind == b"m":                       # GoldSrc
            _a, i = cstr(data, i)
            name, i = cstr(data, i)
            mapname, i = cstr(data, i)
            _folder, i = cstr(data, i)
            _game, i = cstr(data, i)
            players, maxp = data[i], data[i + 1]
        elif kind == b"I":                     # Source
            i += 1
            name, i = cstr(data, i)
            mapname, i = cstr(data, i)
            _folder, i = cstr(data, i)
            _game, i = cstr(data, i)
            i += 2
            players, maxp = data[i], data[i + 1]
        else:
            return None
    except (IndexError, ValueError):
        return None
    return {"name": name, "map": mapname, "players": players, "max": maxp}


def a2s_players(timeout: float = 4.0) -> list[dict]:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(timeout)
    try:
        s.sendto(b"\xff\xff\xff\xffU\xff\xff\xff\xff", (HOST, PORT))
        data, _ = s.recvfrom(4096)
        if data[4:5] == b"A":
            s.sendto(b"\xff\xff\xff\xffU" + data[5:9], (HOST, PORT))
            data, _ = s.recvfrom(4096)
    except OSError:
        return []
    finally:
        s.close()
    if data[4:5] != b"D":
        return []
    count, i, out = data[5], 6, []
    try:
        for _ in range(count):
            i += 1
            end = data.index(b"\x00", i)
            name = data[i:end].decode("latin1")
            i = end + 1
            score = struct.unpack("<i", data[i:i + 4])[0]
            i += 4
            seconds = struct.unpack("<f", data[i:i + 4])[0]
            i += 4
            out.append({"name": name, "score": score, "seconds": int(seconds)})
    except (IndexError, ValueError):
        pass
    return out


# ----------------------------------------------------------------------- helpers
def map_pool() -> list[str]:
    path = CFG.get("mapcycle")
    try:
        with open(path) as fh:
            maps = [l.strip() for l in fh if l.strip() and not l.strip().startswith("//")]
    except OSError:
        return []
    return maps


def next_map(current: str) -> str | None:
    pool = map_pool()
    if not pool:
        return None
    try:
        idx = pool.index(current)
    except ValueError:
        return pool[0]
    return pool[(idx + 1) % len(pool)]


def fmt_duration(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, _ = divmod(rem, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def fetch_top(limit: int = 5) -> list[tuple[int, str, str]]:
    """(rank, name, value) from the public leaderboard; best effort."""
    try:
        with urllib.request.urlopen(f"{BASE}/top15", timeout=10) as r:
            body = r.read().decode("utf-8", "replace")
    except Exception:
        return []
    rows: list[tuple[int, str, str]] = []
    # the page renders a table of players; keep it tolerant of markup tweaks
    for m in re.finditer(r"<tr[^>]*>(.*?)</tr>", body, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", m.group(1), re.S)
        if len(cells) < 2:
            continue
        text = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
        text = [html.unescape(t) for t in text if t]
        if not text or not re.search(r"\d", " ".join(text)):
            continue
        rows.append((len(rows) + 1, text[0] if text else "?", " ".join(text[1:3])))
        if len(rows) >= limit:
            break
    return rows


def humanise_map(mapname: str) -> str:
    return mapname.replace("de_", "").replace("cs_", "").replace("awp_", "awp ").replace("_", " ").title()


# --------------------------------------------------------------------------- bot
intents = discord.Intents.default()
bot = commands.Bot(command_prefix="!fn ", intents=intents, help_command=None)


@bot.event
async def on_ready() -> None:
    print(f"[bot] logged in as {bot.user}", flush=True)
    guild_id = CFG.get("guild_id")
    try:
        if guild_id:
            guild = discord.Object(id=int(guild_id))
            bot.tree.copy_global_to(guild=guild)
            synced = await bot.tree.sync(guild=guild)
        else:
            synced = await bot.tree.sync()
        print(f"[bot] synced {len(synced)} command(s)", flush=True)
    except Exception as exc:                       # noqa: BLE001
        print(f"[bot] command sync failed: {exc}", flush=True)
    if not presence_loop.is_running():
        presence_loop.start()


@tasks.loop(seconds=int(CFG.get("presence_refresh", 60)))
async def presence_loop() -> None:
    info = a2s_info()
    if info:
        activity = discord.Activity(
            type=discord.ActivityType.playing,
            name=f"{humanise_map(info['map'])} · {info['players']}/{info['max']}",
        )
    else:
        activity = discord.Activity(type=discord.ActivityType.watching, name="the server come back")
    try:
        await bot.change_presence(activity=activity, status=discord.Status.online)
    except Exception:                              # noqa: BLE001
        pass


@bot.tree.command(name="status", description="Live status of the FreeNova Classic server")
async def status_cmd(interaction: discord.Interaction) -> None:
    await interaction.response.defer(thinking=True)
    info = a2s_info()
    if not info:
        await interaction.followup.send(f"🔴 **{SERVER['name']}** is not answering on `{HOST}:{PORT}`.")
        return
    nxt = next_map(info["map"])
    embed = discord.Embed(title=info["name"], colour=0x36DEAB,
                          description=f"`{HOST}:{PORT}`")
    embed.add_field(name="Map", value=f"`{info['map']}`", inline=True)
    embed.add_field(name="Players", value=f"**{info['players']}/{info['max']}**", inline=True)
    embed.add_field(name="Next map", value=f"`{nxt}`" if nxt else "—", inline=True)
    embed.set_footer(text=f"Updated {datetime.now(timezone.utc).strftime('%H:%M UTC')}")
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="players", description="Who is on the server right now")
async def players_cmd(interaction: discord.Interaction) -> None:
    await interaction.response.defer(thinking=True)
    players = a2s_players()
    if not players:
        await interaction.followup.send("Nobody is on right now — or the server isn't answering.")
        return
    players.sort(key=lambda p: (-p["score"], -p["seconds"]))
    lines = [f"`{i:>2}.` **{p['name'][:24]}** — {p['score']} pts, {fmt_duration(p['seconds'])}"
             for i, p in enumerate(players, 1)]
    embed = discord.Embed(title=f"{len(players)} on {SERVER['name']}", colour=0x7dd3fc,
                          description="\n".join(lines[:25]))
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="map", description="Current and next map")
async def map_cmd(interaction: discord.Interaction) -> None:
    info = a2s_info()
    current = info["map"] if info else "unknown"
    nxt = next_map(current)
    pool = map_pool()
    text = f"**Now:** `{current}`" + (f"\n**Next:** `{nxt}`" if nxt else "")
    if pool and current in pool:
        text += f"\n**Position:** {(pool.index(current) + 1)}/{len(pool)} in the cycle"
    await interaction.response.send_message(text)


@bot.tree.command(name="top", description="Top players on the leaderboard")
async def top_cmd(interaction: discord.Interaction) -> None:
    await interaction.response.defer(thinking=True)
    rows = fetch_top(5)
    if not rows:
        await interaction.followup.send(f"No leaderboard data yet — see {BASE}/top15")
        return
    embed = discord.Embed(title="Top players", colour=0xd3b35a, url=f"{BASE}/top15",
                          description="\n".join(f"`{i}.` **{n}** — {v}" for i, n, v in rows))
    await interaction.followup.send(embed=embed)


@bot.tree.command(name="events", description="What is running on the server this week")
async def events_cmd(interaction: discord.Interaction) -> None:
    path = os.path.expanduser("~/.config/freenova-bot/events.json")
    try:
        with open(path) as fh:
            events = json.load(fh)
    except (OSError, ValueError):
        await interaction.response.send_message(
            "No events are scheduled right now — check back, or watch this channel.")
        return
    lines = []
    for e in events[:8]:
        lines.append(f"• **{e.get('title', 'Event')}** — {e.get('when', '')}"
                     + (f" ({e['detail']})" if e.get("detail") else ""))
    await interaction.response.send_message("\n".join(lines) or "Nothing scheduled.")


if __name__ == "__main__":
    bot.run(CFG["token"], log_handler=None)
