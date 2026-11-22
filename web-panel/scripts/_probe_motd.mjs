import http from "http"

function get(path, ua) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: 8080, path, headers: { "user-agent": ua || "Mozilla/4.0 (compatible; MSIE 6.0)" }, timeout: 8000 }, res => {
      const chunks = []
      res.on("data", d => chunks.push(d))
      res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], len: Buffer.concat(chunks).length, b: Buffer.concat(chunks).toString("utf8") }))
    }).on("error", reject)
  })
}

const ua = "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)"
for (const p of [
  "/profile?steamid=STEAM_0:0:683671116&compact=1",
  "/vip?steamid=STEAM_0:0:683671116&compact=1",
  "/store?steamid=STEAM_0:0:683671116&compact=1",
  "/battlepass?steamid=STEAM_0:0:683671116&compact=1",
  "/logo.png",
  "/ranks/rank_01.png"
]) {
  const r = await get(p, ua)
  const head = r.b.slice(0, 180).replace(/\s+/g, " ")
  console.log(r.status, String(r.len).padStart(6), p, "logo", r.b.includes("/logo.png") || r.type === "image/png", "navy", r.b.includes("070c14") || r.type === "image/png", "ajxs", /ajxs/i.test(r.b), r.type)
  if (p.includes("profile")) console.log("  overview table", r.b.includes("WEAPON MASTERY"), r.b.includes("PRIVATE RANK") || r.b.includes("Unranked"), head)
}
