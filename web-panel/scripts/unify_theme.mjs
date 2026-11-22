import { readFileSync, writeFileSync, copyFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const fn = join(root, "..")
const cstrike = "C:/Users/conts/Desktop/Server CS 1.6/cstrike"
const serverRoot = "C:/Users/conts/Desktop/Server CS 1.6"

const extras = `<style>
/* MOTD extras only. Palette, cards, tabs, and tables live in freenova_theme.css. */
.app-wrapper.zoom-85 { transform: scale(0.85); transform-origin: top center; width: 117.6%; margin-left: -8.8%; }
.app-wrapper.zoom-70 { transform: scale(0.70); transform-origin: top center; width: 142.8%; margin-left: -21.4%; }
#cyber-cursor, #cyber-cursor-dot { display: none !important; }
.fx-neon { border-color: var(--lime); box-shadow: 0 0 24px var(--lime-glow), inset 0 0 20px rgba(116,230,0,0.25); background: radial-gradient(circle at 50% 50%, rgba(116,230,0,0.25), #04080c); }
.fx-void { border-color: #a855f7; box-shadow: 0 0 24px rgba(168,85,247,0.45), inset 0 0 20px rgba(168,85,247,0.25); background: radial-gradient(circle at 50% 50%, rgba(168,85,247,0.25), #08020c); }
.fx-divine { border-color: var(--gold); box-shadow: 0 0 28px var(--gold-glow), inset 0 0 25px rgba(255,215,0,0.3); background: radial-gradient(circle at 50% 50%, rgba(255,215,0,0.3), #0a0801); }
.sub-nav { display: none; }
@media (max-width: 800px) {
  body { padding: 8px; }
  .brand-text span { display: none; }
}
</style>`

function patchBattlepass(path) {
  let s = readFileSync(path, "utf8")
  const start = s.indexOf("<style>\n/* Layout extras")
  const start2 = start >= 0 ? start : s.indexOf("<style>\r\n/* Layout extras")
  const idx = start2 >= 0 ? start2 : s.indexOf("<style>")
  if (idx < 0) throw new Error("no style in " + path)
  const end = s.indexOf("</style>", idx)
  if (end < 0) throw new Error("no </style> in " + path)
  s = s.slice(0, idx) + extras + s.slice(end + "</style>".length)
  s = s.split("'Segoe UI', 'Trebuchet MS', Arial, sans-serif").join("var(--font-heading)")
  s = s.split("\"Segoe UI\", \"Trebuchet MS\", Arial, sans-serif").join("var(--font-heading)")
  s = s.split("'Segoe UI', Tahoma, Arial, sans-serif").join("var(--font-heading)")
  s = s.split("#0f170f").join("var(--bg-card)")
  s = s.split("#0e150e").join("var(--bg-surface)")
  s = s.split("#0d140d").join("var(--bg-primary)")
  s = s.split("#0f1a0f").join("var(--bg-surface)")
  s = s.split("#0c120c").join("var(--bg-surface)")
  s = s.split("#9bb09b").join("var(--text-muted)")
  s = s.split("#607560").join("var(--text-dim)")
  writeFileSync(path, s)
  const leftover = (s.match(/Segoe UI|#0f170f|#0e150e/g) || []).length
  console.log("patched battlepass", path, "leftover", leftover)
}

function extractTheme() {
  const ui = readFileSync(join(root, "src/ui.js"), "utf8")
  const m = ui.match(/<style>([\s\S]*?)<\/style>/)
  if (!m) throw new Error("could not extract ui.js CSS")
  const css = "/* FreeNova shared theme */\n" + m[1].trim() + "\n"
  writeFileSync(join(fn, "freenova_theme.css"), css)
  writeFileSync(join(root, "assets/theme.css"), css)
  writeFileSync(join(cstrike, "freenova_theme.css"), css)
  console.log("wrote theme.css", css.length, "bytes")
}

patchBattlepass(join(fn, "battlepass.php"))
extractTheme()
