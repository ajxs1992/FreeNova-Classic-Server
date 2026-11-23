# A dedicated desktop session for agent-driven testing

Giving an agent full pointer and keyboard control on your **live session** means
it can click your browser, your Steam wallet or a terminal. This gives it a
**separate X display with its own D-Bus and window manager**, so a mis-aimed
click lands in the sandbox and your desktop is untouched.

## Install (one line, needs your password)
```bash
sudo pacman -S --needed xorg-server-xvfb openbox xdotool
```

## Use
```bash
scripts/pc-sandbox.sh start          # Xvfb :99 (1600x1000x24) + openbox + private D-Bus
scripts/pc-sandbox.sh status
scripts/pc-sandbox.sh env            # the environment to point a tool at
scripts/pc-sandbox.sh exec xterm     # run anything inside it
scripts/pc-sandbox.sh shot /tmp/s.png
scripts/pc-sandbox.sh stop
```
`LIBGL_ALWAYS_SOFTWARE=1` is set inside, so OpenGL works through llvmpipe on the
Xvfb screen — enough for GoldSrc.

## Point an agent at it
Add a **second** MCP entry in `~/.config/karucode/config.toml`, leaving the live
one headless:

```toml
[[mcp_servers]]
name = "desktop-sandbox"
transport = "stdio"
enabled = true
command = [
  "/home/ajxs/.local/share/karucode-mcp/node_modules/agent-desktop/bin/agent-desktop",
  "mcp", "--headed",
]
[mcp_servers.env]
DISPLAY = ":99"
XDG_SESSION_TYPE = "x11"
XDG_RUNTIME_DIR = "/run/user/1000"
DBUS_SESSION_BUS_ADDRESS = "unix:path=/tmp/pc-sandbox/bus"
```
`--headed` is what enables physical input (mouse moves, holds, drags, real key
presses). The live `agent-desktop` keeps its current headless policy, so a normal
agent cannot click anything on your real desktop by accident.

Restart karucode after editing the config (the MCP servers are spawned by the
service): `systemctl --user restart karucode` — that also ends any run in flight,
so do it between tasks.

## The CS 1.6 test recipe
```bash
scripts/pc-sandbox.sh start
scripts/pc-sandbox.sh exec env DISPLAY=:99 steam -applaunch 10 \
  +connect 127.0.0.1:27016 -window -w 800 -h 600
sleep 25
scripts/pc-sandbox.sh shot /tmp/cs16-motd.png
```
Steam itself starts on `:99` only if it is not already running on your desktop —
a single Steam instance serves one display. If Steam is up, quit it first or use
the sandbox for a standalone client.

## Rules for agents using it
- A game holds pointer lock: keep it **windowed** (`-window`), never fullscreen,
  or input injection is captured and the agent looks "stuck".
- Snapshot the accessibility tree before clicking; coordinates break on any
  window move.
- Stop the sandbox when done — an Xvfb at 1600×1000 costs a few hundred MB.
