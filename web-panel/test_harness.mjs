// Self-contained panel smoke test. It starts the local Node panel against a
// disposable SQLite database, checks every player-facing route, and verifies
// the compact MOTD skin does not depend on flex/grid/CSS variables.
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const dbDir = mkdtempSync(join(tmpdir(), "freenova-panel-test-"))
const port = 18080
const base = `http://127.0.0.1:${port}`
const child = spawn(process.execPath, ["server_local.mjs"], {
  cwd: here,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    PANEL_DB: join(dbDir, "panel.sq3"),
    FNWEB_SECRET: "test-only-secret",
    ADMIN_PASSWORD: "test-only-admin",
  },
  stdio: ["ignore", "pipe", "pipe"],
})

let output = ""
child.stdout.on("data", chunk => { output += chunk.toString() })
child.stderr.on("data", chunk => { output += chunk.toString() })

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    if (output.includes("[panel] HTTP")) return
    await wait(250)
  }
  throw new Error(`panel did not become ready:\n${output}`)
}

const routes = ["/hub", "/profile", "/bp", "/battlepass", "/missions", "/achievements",
  "/competitive", "/events", "/vip", "/shop", "/skins", "/models", "/cosmetics",
  "/settings", "/rules", "/top15", "/admin"]

try {
  await waitReady()
  let failed = 0
  for (const route of routes) {
    const res = await fetch(base + route, { redirect: "manual" })
    if (![200, 302].includes(res.status)) {
      console.error(`FAIL ${route} -> ${res.status}`)
      failed++
    } else {
      console.log(`PASS ${route} -> ${res.status}`)
    }
  }
  for (const route of ["/hub", "/profile", "/bp", "/shop"]) {
    const res = await fetch(base + route + "?compact=1", {
      headers: { "user-agent": "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)" },
    })
    const body = await res.text()
    if (res.status !== 200) { console.error(`FAIL compact ${route} -> ${res.status}`); failed++; continue }
    for (const needle of ["display:flex", "display: grid", "var("]) {
      if (body.includes(needle)) { console.error(`FAIL compact ${route} contains ${needle}`); failed++ }
    }
    console.log(`PASS compact ${route}`)
  }

  // Every internal target advertised by the hub must resolve.
  const hub = await (await fetch(base + "/hub")).text()
  const links = [...new Set([...hub.matchAll(/href=['"]([^'"]+)/g)].map(m => m[1]))]
  for (const link of links) {
    if (/^(#|mailto:|javascript:)/i.test(link)) continue
    if (/^https?:/i.test(link)) { console.log(`SKIP external ${link}`); continue }
    const res = await fetch(base + link, { redirect: "manual" })
    if (![200, 302].includes(res.status)) {
      console.error(`FAIL hub link ${link} -> ${res.status}`)
      failed++
    }
  }
  console.log(`PASS hub link audit (${links.length} targets)`)
  if (failed) process.exitCode = 1
  else console.log("PASS panel smoke suite")
} finally {
  child.kill()
  await wait(200)
  try { rmSync(dbDir, { recursive: true, force: true }) } catch {}
}
