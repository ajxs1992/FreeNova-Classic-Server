# The dashboard MOTD, measured against the plate

`docs/design/refs/winterfest/01-dashboard.png` is the owner's file (1672×941,
sha256 `4e9ea10d…0878af`). The MOTD is that file and nothing else: one `<img>`,
CSS that only scales it, no script, no data.

Two URLs, one document (all three byte-identical, checked below):

| URL | who uses it |
| --- | --- |
| `/dashboard` | what a person types in a browser (route in `web-panel/src/index.js`) |
| `/dashboard.html` | what the game is sent: a GoldSrc MOTD needs a file extension (`web-panel/assets/dashboard.html`) |
| `/dashboard.png` | the plate itself, served from `web-panel/assets/` |

Everything here was produced by `diff.py` against the local stack
(game `127.0.0.1:27016`, panel `http://192.168.1.5:18101`):

```
python3 docs/design/verify/diff.py http://192.168.1.5:18101
```

## What is where

| file | what it is |
| --- | --- |
| `motd-1672x941-native.png` | the page screenshotted at the plate's own size |
| `motd-1024x768.png` | the page at the modern MOTD viewport |
| `motd-800x600.png` | the page at the classic MOTD viewport |
| `motd-*-vs-plate.png` | MOTD ‖ `dashboard.png` at the drawn size ‖ difference ×8 |
| `motd-log.txt` | the server log lines proving the MOTD was dispatched |
| `diff.py` | the checker that produced all of the above |

Screenshots: `brave --headless=new --force-device-scale-factor=1
--window-size=W,H --screenshot=… http://192.168.1.5:18101/dashboard`.

## The numbers

| check | 1672×941 (native) | 1024×768 | 800×600 |
| --- | --- | --- | --- |
| drawn area | 1672×941 at (0,0) | 1024×576 at (0,96) | 800×450 at (0,75) |
| aspect vs plate | 1:1 | 1.77778 vs 1.77683 | 1.77778 vs 1.77683 |
| **page vs the plate, 1:1** | **0 of 1 573 352 pixels differ (0.0000 %), max channel delta 0** | — | — |
| **page vs the browser's own render of `dashboard.png` at that size** | — | **0 of 589 824 (0.0000 %), max delta 0** | **0 of 360 000 (0.0000 %), max delta 0** |
| page vs the plate resized by PIL LANCZOS, pixels over 8/255 | — | 49 905 (8.461 %) | 78 176 (21.716 %) |
| … over 32/255 | — | 0.293 % | 2.803 % |
| … mean absolute channel error | — | 2.709/255 | 5.621/255 |
| … 16×16 block means | — | worst 4/255 | worst 3/255 |
| … averaged to 8×8 blocks, over 8/255 | — | 0.043 % | 0.000 % |
| … flat areas (where the plate is locally smooth) | — | median 0/255, p95 1/255 | median 0/255, p95 1/255 |

How to read the two kinds of number:

* The two **zero** rows are what fidelity means here. At the plate's own size the
  browser draws the PNG 1:1 and the screenshot is bit-identical to the file. At
  the MOTD sizes the drawn area is bit-identical to what the same browser paints
  when the PNG is put on a page alone at that size — so the page contributes
  nothing: no crop, no shift, no overlay, no colour change.
* The LANCZOS row is **not** the page vs the plate; it is PIL's resampling kernel
  vs Chrome's on a very detailed picture. Both are honest downscales of the same
  pixels, and that is why it falls to 0.000 % once both are averaged into 8×8
  blocks and why flat areas agree to the last bit. A reconstruction (drawn boxes,
  text, gradients) would light up the block and flat-area columns instead.

800×600 leaves 75 px of letterbox above and below in the page's own `#0d0b18`;
1024×768 leaves 96 px. Nothing is cropped and no scrollbar appears at either
size.
