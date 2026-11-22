import { copyFileSync, unlinkSync, existsSync } from "fs"
const files = [
  ["C:/Users/conts/Desktop/Server CS 1.6/cstrike/addons/amxmodx/plugins/rsu_core.amxx", "C:/Users/conts/Desktop/FREENOVA System/cstrike/addons/amxmodx/plugins/rsu_core.amxx"],
  ["C:/Users/conts/Desktop/Server CS 1.6/cstrike/addons/amxmodx/plugins/rsu_matchstats.amxx", "C:/Users/conts/Desktop/FREENOVA System/cstrike/addons/amxmodx/plugins/rsu_matchstats.amxx"],
  ["C:/Users/conts/Desktop/Server CS 1.6/cstrike/addons/amxmodx/plugins/freenova_sync.amxx", "C:/Users/conts/Desktop/FREENOVA System/cstrike/addons/amxmodx/plugins/freenova_sync.amxx"]
]
for (const [src, dst] of files) {
  copyFileSync(src, dst)
  console.log("plugin", dst)
}
const scratch = [
  "C:/Users/conts/Desktop/FREENOVA System/web-panel/scripts/_copy_sma.mjs",
  "C:/Users/conts/Desktop/FREENOVA System/web-panel/scripts/_compile_sma.mjs",
  "C:/Users/conts/Desktop/FREENOVA System/web-panel/scripts/_check_preview.mjs",
  "C:/Users/conts/Desktop/FREENOVA System/web-panel/scripts/_find_preview.mjs",
  "C:/Users/conts/Desktop/FREENOVA System/web-panel/scripts/_snip_preview.mjs"
]
for (const f of scratch) {
  if (existsSync(f)) unlinkSync(f)
}
console.log("scratch removed")
