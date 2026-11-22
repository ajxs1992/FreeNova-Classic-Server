import { readFileSync, writeFileSync } from "fs"
const p = "C:/Users/conts/Desktop/FREENOVA System/web-panel/src/pages.js"
let s = readFileSync(p, "utf8")
const start = s.indexOf("\n  const _legacyBanner")
const end = s.indexOf("\n  if (tab === \"stats\")")
if (start < 0 || end < 0 || end <= start) throw new Error(`markers ${start} ${end}`)
s = s.slice(0, start) + s.slice(end)
writeFileSync(p, s)
console.log("removed", end - start, "chars, new length", s.length)
