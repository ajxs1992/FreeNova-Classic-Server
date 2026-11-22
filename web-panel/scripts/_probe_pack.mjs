import http from "http"

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: "127.0.0.1",
      port: 8080,
      path,
      headers: { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" },
      timeout: 8000
    }, res => {
      const chunks = []
      res.on("data", d => chunks.push(d))
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], len: Buffer.concat(chunks).length, b: Buffer.concat(chunks) }))
    }).on("error", reject)
  })
}

const uaPages = [
  "/m/b/0-0-683671116.htm",
  "/m/a/0-0-683671116.htm",
  "/m/i/0-0-683671116.htm",
  "/m/p/0-0-683671116.htm",
  "/m/s/0-0-683671116/skills.htm"
]
for (const p of uaPages) {
  const r = await get(p)
  const html = r.b.toString("utf8")
  const imgs = [...html.matchAll(/src='([^']+\.png)'/g)].map(m => m[1])
  const unique = [...new Set(imgs)]
  const groups = {}
  for (const u of unique) {
    const g = u.split("/")[1] || "?"
    groups[g] = (groups[g] || 0) + 1
  }
  console.log("PAGE", r.status, r.len, p, groups)
  console.log("  sample", unique.slice(0, 8).join(" "))
  console.log("  old-mi", html.includes("/missions/mi_"), "old-bp", html.includes("/bp/bp_"), "emoji", /[\u{1F300}-\u{1FAFF}]/u.test(html))
}

const assets = [
  "/logo.png", "/bp/star.png", "/bp/prem_01.png", "/bp/free_01.png",
  "/bp/skill_multi_jump.png", "/missions/msn_01.png", "/ranks/rank_01.png",
  "/medals/fn_first_blood.png", "/i/gun_ak47.png", "/i/trophy_1.png"
]
for (const p of assets) {
  const r = await get(p)
  console.log("ASSET", r.status, String(r.len).padStart(6), r.type, p, r.b.slice(0, 4).toString("hex"))
}
