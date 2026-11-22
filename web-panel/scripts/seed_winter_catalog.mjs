#!/usr/bin/env node
// Seed the panel's `catalog` row from winterfest.ini.
//
// The game pushes this row (src/winter/catalog.js: `SELECT json FROM catalog
// WHERE key='winterfest'`); until it does, every Winterfest page has to render
// "reward not published", which is honest but makes the local instance look
// empty. This script builds the SAME payload the game builds — straight from the
// ini's own columns — and writes it to ONE database you name explicitly. It is a
// local/dev tool: it never runs as part of the server and refuses to write to a
// database outside the panel's own data directory unless --force is given.
//
//   node scripts/seed_winter_catalog.mjs --db /tmp/v2test/fixture.sq3
//   node scripts/seed_winter_catalog.mjs --db path --ini ../game-server/.../winterfest.ini
//
// After it runs, /v2/winter/advent, /v2/winter/pass and /v2/winter/ornaments show
// the real day/tier/ornament rewards instead of the "not published" state.
import { DatabaseSync } from "node:sqlite"
import { readFileSync } from "node:fs"
import { resolve, basename } from "node:path"

const args = process.argv.slice(2)
const opt = (name, fallback = "") => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const DB = opt("--db", process.env.PANEL_DB || "")
const INI = opt("--ini", resolve(import.meta.dirname, "../../game-server/cstrike/addons/amxmodx/configs/freenova/winterfest.ini"))
const FORCE = args.includes("--force")

if (!DB) {
  console.error("usage: node scripts/seed_winter_catalog.mjs --db <panel.sqlite> [--ini <winterfest.ini>] [--force]")
  process.exit(2)
}
// A guard, not a sandbox: the point is that nobody seeds the production file by
// accident while poking at a local instance.
if (!FORCE && !/^\/(tmp|home|var\/folders)\//.test(resolve(DB))) {
  console.error(`refusing to write ${DB}: pass --force for a database outside /tmp or /home`)
  process.exit(2)
}

/** Parse `[section]` + `a | b | c` rows, ignoring ; comments and blank lines. */
function parseIni(text) {
  const out = {}
  let section = ""
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith(";") || line.startsWith("#")) continue
    const m = /^\[([a-z_]+)\]$/i.exec(line)
    if (m) { section = m[1].toLowerCase(); out[section] = out[section] || []; continue }
    if (!section) continue
    const cols = line.split("|").map(c => c.trim())
    if (cols.length < 2) continue
    out[section].push(cols)
  }
  return out
}

const ini = parseIni(readFileSync(INI, "utf8"))
const num = v => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0 }

const sets = (ini.set || []).map(c => ({ id: num(c[0]), name: c[1] || "", title: c[2] || "", snowflakes: num(c[3]) }))
const ornaments = (ini.ornament || []).map(c => ({
  id: num(c[0]), name: c[1] || "", rarity: num(c[2]), set: num(c[3]), hidden: num(c[4]) ? 1 : 0
}))
const advent = (ini.advent || []).map(c => ({ day: num(c[0]), type: c[1] || "", id: num(c[2]), amount: num(c[3]) }))
const pass = (ini.pass || []).map(c => ({ tier: num(c[0]), xp: num(c[1]), type: c[2] || "", id: num(c[3]), amount: num(c[4]) }))

const payload = { sets, ornaments, advent, pass }

const db = new DatabaseSync(DB)
const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog'").get()
if (!exists) {
  console.error(`${DB}: no catalog table — open the panel against this database once first`)
  process.exit(1)
}
const now = Math.floor(Date.now() / 1000)
const json = JSON.stringify(payload)
db.prepare("INSERT INTO catalog (key, json, version, updated_at) VALUES ('winterfest', ?, 1, ?) " +
  "ON CONFLICT(key) DO UPDATE SET json=excluded.json, version=version+1, updated_at=excluded.updated_at")
  .run(json, now)
db.close()
console.log(`seeded ${basename(DB)}: ${sets.length} sets, ${ornaments.length} ornaments, ${advent.length} advent days, ${pass.length} pass tiers (${json.length} bytes)`)
