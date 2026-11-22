import { createServer } from "http"
import { readFile } from "fs/promises"
import { extname, join, normalize } from "path"

const root = normalize("C:/Users/conts/Desktop/FREENOVA System")
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".php": "text/plain; charset=utf-8"
}
createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || "/").split("?")[0])
  if (p === "/" || p === "") p = "/modern_web_preview.html"
  const fp = normalize(join(root, p.replace(/^\/+/, "")))
  if (!fp.toLowerCase().startsWith(root.toLowerCase())) { res.statusCode = 403; return res.end("no") }
  try {
    const data = await readFile(fp)
    res.setHeader("content-type", types[extname(fp)] || "application/octet-stream")
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end("missing " + p)
  }
}).listen(8765, "127.0.0.1", () => {
  console.log("listening http://127.0.0.1:8765/modern_web_preview.html")
})
