// FreeNova local relay: game server (plain TCP socket) -> remote panel (HTTPS)
//
// The AMXX socket module can only do plain TCP, while the remote panel
// is HTTPS-only. This zero-dependency Node relay listens on 127.0.0.1:8787 and
// forwards every request body + headers verbatim to the panel URL given in
// PANEL_URL. It adds nothing and reads nothing - the push stays signed
// end-to-end (the Worker verifies the HMAC over the raw body).
//
// Usage:
//   set PANEL_URL=https://panel.<host>
//   node relay.js            (listens on 8787)
//
// Optional env: PORT (default 8787), PANEL_URL (required).

const http = require("http")
const https = require("https")

let PANEL = process.env.PANEL_URL
if (!PANEL) {
  // WMI/Task Scheduler launches have no inherited env; read the sibling file
  try {
    PANEL = require("fs").readFileSync(__dirname + "/relay.env", "utf8")
      .split(/\r?\n/).find(l => l.startsWith("PANEL_URL="))
      .slice("PANEL_URL=".length).trim()
  } catch {}
}
if (!PANEL || !/^https?:\/\//.test(PANEL)) {
  console.error("PANEL_URL must be set to the panel URL (https:// in production)")
  process.exit(1)
}
const panelUrl = new URL(PANEL)
const PORT = parseInt(process.env.PORT || "8787", 10)

const server = http.createServer((req, res) => {
  const chunks = []
  req.on("data", c => chunks.push(c))
  req.on("end", () => {
    const body = Buffer.concat(chunks)
    const isHttps = panelUrl.protocol === "https:"
    const transport = isHttps ? https : http
    const upstream = transport.request(
      {
        hostname: panelUrl.hostname,
        port: panelUrl.port || (isHttps ? 443 : 80),
        path: req.url,
        method: req.method,
        headers: {
          // forward the sync headers; hop-by-hop ones are rebuilt
          "content-type": req.headers["content-type"] || "application/json",
          "content-length": body.length,
          "x-freenova-server-id": req.headers["x-freenova-server-id"] || "unknown",
          "x-freenova-timestamp": req.headers["x-freenova-timestamp"] || "",
          "x-freenova-nonce": req.headers["x-freenova-nonce"] || "",
          "x-freenova-signature": req.headers["x-freenova-signature"] || "",
          host: panelUrl.hostname,
        },
        timeout: 10000,
      },
      upRes => {
        res.writeHead(upRes.statusCode || 502, { "content-type": upRes.headers["content-type"] || "text/plain" })
        upRes.pipe(res)
      }
    )
    upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")))
    upstream.on("error", err => {
      console.error(`[relay] upstream error: ${err.message}`)
      if (!res.headersSent) res.writeHead(502)
      res.end("relay: upstream error")
    })
    upstream.end(body)
    console.log(`[relay] ${req.method} ${req.url} ${body.length}B -> ${panelUrl.hostname}`)
  })
})

server.listen(PORT, "127.0.0.1", () =>
  console.log(`[relay] listening on 127.0.0.1:${PORT} -> ${PANEL}`)
)
