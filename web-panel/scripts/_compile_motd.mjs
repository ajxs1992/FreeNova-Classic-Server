import { spawnSync } from "child_process"
import { copyFileSync, existsSync } from "fs"
import { join } from "path"
const script = "C:/Users/conts/Desktop/Server CS 1.6/cstrike/addons/amxmodx/scripting"
const plugins = "C:/Users/conts/Desktop/Server CS 1.6/cstrike/addons/amxmodx/plugins"
const amxxpc = join(script, "amxxpc.exe")
for (const name of ["rsu_core", "freenova_vip", "freenova_cosmetics", "battlepass_core"]) {
  const sma = join(script, name + ".sma")
  const out = join(script, name + ".amxx")
  const r = spawnSync(amxxpc, [sma, "-o" + out], { cwd: script, encoding: "utf8" })
  process.stdout.write("--- " + name + " ---\n" + (r.stdout || "") + (r.stderr || ""))
  if (r.status) { console.error("FAILED", name); continue }
  if (existsSync(out)) {
    copyFileSync(out, join(plugins, name + ".amxx"))
    console.log("installed", name)
  }
}
