import http from "http"

function get(path, ua) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: "127.0.0.1",
      port: 8080,
      path,
      headers: { "user-agent": ua || "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" },
      timeout: 8000
    }, res => {
      const chunks = []
      res.on("data", d => chunks.push(d))
      res.on("end", () => {
        const b = Buffer.concat(chunks)
        resolve({ status: res.statusCode, type: res.headers["content-type"], len: b.length, b })
      })
    }).on("error", reject)
  })
}

const ua = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)"
const pages = [
  "/m/b/0-0-683671116.htm",
  "/m/a/0-0-683671116.htm",
  "/m/p/0-0-683671116.htm",
  "/m/t/0-0-683671116.htm",
  "/m/i/0-0-683671116.htm",
  "/m/s/0-0-683671116/skills.htm"
]
for (const p of pages) {
  const r = await get(p, ua)
  const html = r.b.toString("utf8")
  const imgs = [...html.matchAll(/src='([^']+\.png)'/g)].map(m => m[1])
  const unique = [...new Set(imgs)]
  console.log("PAGE", r.status, r.len, p)
  console.log("  bp", unique.filter(u => u.startsWith("/bp/")).length, unique.filter(u => u.startsWith("/bp/")).slice(0, 6).join(" "))
  console.log("  medals", unique.filter(u => u.startsWith("/medals/")).slice(0, 8).join(" "))
  console.log("  ranks", unique.filter(u => u.startsWith("/ranks/")).join(" "))
  console.log("  missions", unique.filter(u => u.startsWith("/missions/")).slice(0, 4).join(" "))
  console.log("  missing-fn_first", html.includes("fn_first_blood"), "emoji", /[\u{1F300}-\u{1FAFF}]/u.test(html))
}

const assets = [
  "/bp/bp_01.png", "/bp/bp_21.png", "/bp/bp_41.png",
  "/ranks/rank_01.png", "/medals/fn_badge_01.png", "/medals/fn_kills_100.png",
  "/logo.png", "/medals/fn_first_blood.png"
]
for (const p of assets) {
  const r = await get(p, ua)
  const sig = r.b.slice(0, 8).toString("hex")
  console.log("ASSET", r.status, String(r.len).padStart(6), r.type, p, sig)
}
