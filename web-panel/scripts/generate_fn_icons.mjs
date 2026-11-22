import { mkdirSync, writeFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "assets")
mkdirSync(join(assets, "ranks"), { recursive: true })
mkdirSync(join(assets, "medals"), { recursive: true })
mkdirSync(join(assets, "i"), { recursive: true })

function svg(body, vb = "0 0 100 100") {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="128" height="128" fill="none">
  ${body}
</svg>
`
}

const RANKS = [
  { id: 1, stroke: "#64748b", fill: "#1e293b", inner: "none" },
  { id: 2, stroke: "#94a3b8", fill: "#334155", inner: "chev1" },
  { id: 3, stroke: "#cbd5e1", fill: "#475569", inner: "chev1" },
  { id: 4, stroke: "#e2e8f0", fill: "#64748b", inner: "chev2" },
  { id: 5, stroke: "#f1f5f9", fill: "#94a3b8", inner: "chev2" },
  { id: 6, stroke: "#cbd5e1", fill: "#64748b", inner: "chev3" },
  { id: 7, stroke: "#f8fafc", fill: "#94a3b8", inner: "star" },
  { id: 8, stroke: "#facc15", fill: "#854d0e", inner: "nova1" },
  { id: 9, stroke: "#fbbf24", fill: "#a16207", inner: "nova1" },
  { id: 10, stroke: "#f59e0b", fill: "#b45309", inner: "nova2" },
  { id: 11, stroke: "#fcd34d", fill: "#d97706", inner: "nova3" },
  { id: 12, stroke: "#38bdf8", fill: "#075985", inner: "shield" },
  { id: 13, stroke: "#22d3ee", fill: "#0e7490", inner: "shield" },
  { id: 14, stroke: "#67e8f9", fill: "#155e75", inner: "shield2" },
  { id: 15, stroke: "#a5f3fc", fill: "#164e63", inner: "shield2" },
  { id: 16, stroke: "#fb923c", fill: "#9a3412", inner: "eagle" },
  { id: 17, stroke: "#fdba74", fill: "#7c2d12", inner: "eagle" },
  { id: 18, stroke: "#fb7185", fill: "#9f1239", inner: "crown" },
  { id: 19, stroke: "#74E600", fill: "#14532d", inner: "global" }
]

function hex() {
  return "50,6 88,28 88,72 50,94 12,72 12,28"
}
function innerMark(kind, stroke) {
  if (kind === "none") return `<polygon points="50,22 74,36 74,64 50,78 26,64 26,36" fill="#0b1220" fill-opacity="0.55" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4 3"/>`
  if (kind === "chev1") return `<path d="M36 58 L50 40 L64 58" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
  if (kind === "chev2") return `<path d="M36 62 L50 44 L64 62" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/><path d="M36 50 L50 32 L64 50" stroke="${stroke}" stroke-width="3.5" stroke-linecap="round" opacity="0.75"/>`
  if (kind === "chev3") return `<path d="M34 66 L50 46 L66 66" stroke="${stroke}" stroke-width="4"/><path d="M34 54 L50 34 L66 54" stroke="${stroke}" stroke-width="3.5" opacity="0.8"/><path d="M34 42 L50 24 L66 42" stroke="${stroke}" stroke-width="3" opacity="0.55"/>`
  if (kind === "star") return `<polygon points="50,26 54,42 70,42 57,52 62,68 50,58 38,68 43,52 30,42 46,42" fill="${stroke}"/>`
  if (kind === "nova1") return `<circle cx="50" cy="50" r="10" fill="${stroke}"/><circle cx="50" cy="50" r="18" stroke="${stroke}" stroke-width="2" opacity="0.7"/>`
  if (kind === "nova2") return `<circle cx="50" cy="50" r="8" fill="${stroke}"/><circle cx="50" cy="50" r="16" stroke="${stroke}" stroke-width="2"/><circle cx="50" cy="50" r="24" stroke="${stroke}" stroke-width="1.5" opacity="0.6"/>`
  if (kind === "nova3") return `<polygon points="50,22 56,44 78,44 60,56 66,78 50,64 34,78 40,56 22,44 44,44" fill="${stroke}"/><circle cx="50" cy="50" r="8" fill="#0b1220"/>`
  if (kind === "shield") return `<path d="M50 24 L72 34 V54 C72 68 50 80 50 80 C50 80 28 68 28 54 V34 Z" fill="#0b1220" stroke="${stroke}" stroke-width="3"/><path d="M50 36 L62 42 V54 C62 62 50 70 50 70 C50 70 38 62 38 54 V42 Z" fill="${stroke}" opacity="0.85"/>`
  if (kind === "shield2") return `<path d="M50 22 L74 33 V55 C74 71 50 84 50 84 C50 84 26 71 26 55 V33 Z" fill="#0b1220" stroke="${stroke}" stroke-width="3"/><path d="M44 46 H56 V62 H44 Z" fill="${stroke}"/><path d="M50 36 L58 46 H42 Z" fill="${stroke}"/>`
  if (kind === "eagle") return `<path d="M50 30 L58 48 L78 46 L62 58 L68 76 L50 64 L32 76 L38 58 L22 46 L42 48 Z" fill="${stroke}"/><path d="M28 44 Q50 36 72 44" stroke="${stroke}" stroke-width="3" fill="none"/>`
  if (kind === "crown") return `<path d="M28 62 L32 38 L44 52 L50 30 L56 52 L68 38 L72 62 Z" fill="${stroke}"/><rect x="28" y="62" width="44" height="8" fill="${stroke}"/>`
  if (kind === "global") return `<circle cx="50" cy="50" r="22" stroke="${stroke}" stroke-width="3"/><ellipse cx="50" cy="50" rx="10" ry="22" stroke="${stroke}" stroke-width="2"/><path d="M28 50 H72 M32 38 H68 M32 62 H68" stroke="${stroke}" stroke-width="2"/><polygon points="50,20 54,30 50,28 46,30" fill="${stroke}"/>`
  return ""
}

function shineDef(id) {
  return `<linearGradient id="shine${id}" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#fff" stop-opacity="0"/>
    <stop offset="50%" stop-color="#fff" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>`
}
function shineSweep(id, dur = "3.4s") {
  return `<rect x="-22" y="0" width="18" height="100" fill="url(#shine${id})" opacity="0.45">
    <animateTransform attributeName="transform" type="translate" values="-40,0;125,0;-40,0" dur="${dur}" repeatCount="indefinite"/>
  </rect>`
}

const WRITE_RANKS = false // rank emblems come from "rank medals no background1.png"
for (const r of RANKS) {
  if (!WRITE_RANKS) break
  const n = String(r.id).padStart(2, "0")
  const body = `
  <defs>
    <linearGradient id="rg${n}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${r.stroke}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${r.fill}"/>
    </linearGradient>
    ${shineDef("r" + n)}
  </defs>
  <polygon points="${hex()}" fill="url(#rg${n})" stroke="${r.stroke}" stroke-width="4"/>
  <polygon points="50,16 78,32 78,68 50,84 22,68 22,32" fill="#070c14" fill-opacity="0.45"/>
  ${innerMark(r.inner, r.stroke)}
  ${shineSweep("r" + n)}
  <circle cx="50" cy="50" r="46" stroke="${r.stroke}" stroke-width="1" opacity="0.25">
    <animate attributeName="opacity" values="0.15;0.55;0.15" dur="${2.4 + (r.id % 5) * 0.2}s" repeatCount="indefinite"/>
  </circle>`
  writeFileSync(join(assets, "ranks", `rank_${n}.svg`), svg(body))
}

const MEDALS = [
  { id: "kills_100", stroke: "#94a3b8", mark: "coin" },
  { id: "kills_1000", stroke: "#22c55e", mark: "gear" },
  { id: "kills_5000", stroke: "#a855f7", mark: "wreath" },
  { id: "kills_10000", stroke: "#f59e0b", mark: "diamond" },
  { id: "hs_100", stroke: "#94a3b8", mark: "cross" },
  { id: "hs_500", stroke: "#38bdf8", mark: "scope" },
  { id: "wins_100", stroke: "#22c55e", mark: "flag" },
  { id: "mvp_50", stroke: "#38bdf8", mark: "star" },
  { id: "hours_100", stroke: "#38bdf8", mark: "clock" },
  { id: "hours_500", stroke: "#f59e0b", mark: "laurel" },
  { id: "rank_max", stroke: "#74E600", mark: "global" },
  { id: "ak_spec", stroke: "#38bdf8", mark: "ak" },
  { id: "ak_master", stroke: "#f59e0b", mark: "akgold" }
]

function medalMark(kind, c) {
  if (kind === "coin") return `<circle cx="50" cy="46" r="22" stroke="${c}" stroke-width="4"/><path d="M50 32 V60 M42 38 H58" stroke="${c}" stroke-width="3"/>`
  if (kind === "gear") return `<circle cx="50" cy="46" r="12" stroke="${c}" stroke-width="4"/>${[0,45,90,135].map(a => `<rect x="48" y="22" width="4" height="10" fill="${c}" transform="rotate(${a} 50 46)"/>`).join("")}`
  if (kind === "wreath") return `<path d="M28 60 Q32 28 50 24 Q68 28 72 60" stroke="${c}" stroke-width="3" fill="none"/><path d="M38 58 Q50 70 62 58" stroke="${c}" stroke-width="3"/>`
  if (kind === "diamond") return `<polygon points="50,20 74,46 50,74 26,46" stroke="${c}" stroke-width="4" fill="${c}" fill-opacity="0.2"/>`
  if (kind === "cross") return `<circle cx="50" cy="46" r="20" stroke="${c}" stroke-width="3"/><path d="M50 30 V62 M34 46 H66" stroke="${c}" stroke-width="3"/><circle cx="50" cy="46" r="4" fill="${c}"/>`
  if (kind === "scope") return `<circle cx="50" cy="46" r="22" stroke="${c}" stroke-width="3"/><circle cx="50" cy="46" r="8" stroke="${c}" stroke-width="3"/><path d="M50 24 V32 M50 60 V68 M28 46 H36 M64 46 H72" stroke="${c}" stroke-width="3"/>`
  if (kind === "flag") return `<path d="M34 24 V72" stroke="${c}" stroke-width="4"/><path d="M36 24 H70 L60 36 L70 48 H36 Z" fill="${c}"/>`
  if (kind === "star") return `<polygon points="50,22 56,40 76,40 60,52 66,70 50,58 34,70 40,52 24,40 44,40" fill="${c}"/>`
  if (kind === "clock") return `<circle cx="50" cy="46" r="22" stroke="${c}" stroke-width="3"/><path d="M50 30 V46 L62 54" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`
  if (kind === "laurel") return `<path d="M28 70 Q24 40 50 26 Q76 40 72 70" stroke="${c}" stroke-width="3" fill="none"/><path d="M36 44 Q42 38 46 46 M54 46 Q58 38 64 44 M38 56 Q46 50 50 58 M50 58 Q54 50 62 56" stroke="${c}" stroke-width="2"/>`
  if (kind === "global") return `<circle cx="50" cy="46" r="20" stroke="${c}" stroke-width="3"/><ellipse cx="50" cy="46" rx="8" ry="20" stroke="${c}" stroke-width="2"/><path d="M32 46 H68" stroke="${c}" stroke-width="2"/>`
  if (kind === "ak" || kind === "akgold") {
    const fill = kind === "akgold" ? c : "none"
    return `<rect x="22" y="42" width="52" height="8" rx="2" fill="${c}"/><rect x="64" y="38" width="18" height="6" fill="${c}"/><rect x="30" y="50" width="8" height="16" fill="${c}"/><rect x="48" y="36" width="6" height="8" fill="${fill === "none" ? c : c}"/>`
  }
  return ""
}

for (const m of MEDALS) {
  const body = `
  ${medalMark(m.mark, m.stroke)}
  <path d="M28 78 Q50 90 72 78" stroke="${m.stroke}" stroke-width="4" fill="none"/>`
  writeFileSync(join(assets, "medals", `fn_${m.id}.svg`), svg(body))
}

const GUNS = {
  ak47: `<rect x="8" y="44" width="58" height="10" fill="#74E600"/><rect x="62" y="40" width="28" height="8" fill="#74E600"/><rect x="18" y="54" width="8" height="18" fill="#94a3b8"/><rect x="40" y="38" width="8" height="8" fill="#38bdf8"/><rect x="70" y="34" width="6" height="8" fill="#94a3b8"/>`,
  m4a1: `<rect x="10" y="44" width="54" height="9" fill="#38bdf8"/><rect x="60" y="42" width="26" height="7" fill="#38bdf8"/><rect x="22" y="53" width="7" height="16" fill="#94a3b8"/><rect x="46" y="36" width="16" height="8" fill="#64748b"/>`,
  awp: `<rect x="6" y="46" width="70" height="7" fill="#f59e0b"/><rect x="40" y="34" width="22" height="12" fill="#94a3b8"/><rect x="18" y="53" width="8" height="16" fill="#64748b"/><rect x="76" y="44" width="16" height="6" fill="#f59e0b"/>`,
  deagle: `<rect x="28" y="40" width="40" height="12" fill="#e2e8f0"/><rect x="36" y="52" width="10" height="18" fill="#94a3b8"/><rect x="62" y="42" width="16" height="8" fill="#64748b"/>`,
  knife: `<path d="M20 58 L78 30 L82 36 L28 66 Z" fill="#cbd5e1"/><rect x="16" y="56" width="16" height="8" fill="#74E600"/>`,
  usp: `<rect x="30" y="42" width="36" height="10" fill="#94a3b8"/><rect x="36" y="52" width="9" height="16" fill="#64748b"/>`,
  glock: `<rect x="32" y="42" width="34" height="10" fill="#38bdf8"/><rect x="38" y="52" width="9" height="16" fill="#64748b"/>`,
  famas: `<rect x="14" y="40" width="50" height="12" fill="#22c55e"/><rect x="58" y="44" width="22" height="7" fill="#22c55e"/><rect x="24" y="52" width="8" height="16" fill="#94a3b8"/>`,
  galil: `<rect x="12" y="44" width="56" height="9" fill="#4ade80"/><rect x="62" y="42" width="22" height="7" fill="#4ade80"/><rect x="22" y="53" width="8" height="16" fill="#94a3b8"/>`,
  scout: `<rect x="8" y="46" width="68" height="7" fill="#38bdf8"/><rect x="40" y="36" width="18" height="10" fill="#94a3b8"/><rect x="20" y="53" width="8" height="16" fill="#64748b"/>`,
  aug: `<rect x="16" y="40" width="52" height="12" fill="#67e8f9"/><rect x="58" y="36" width="18" height="8" fill="#94a3b8"/><rect x="26" y="52" width="8" height="16" fill="#64748b"/>`,
  sg552: `<rect x="16" y="42" width="50" height="11" fill="#22d3ee"/><rect x="60" y="38" width="16" height="8" fill="#94a3b8"/><rect x="24" y="53" width="8" height="16" fill="#64748b"/>`,
  mp5: `<rect x="22" y="42" width="46" height="10" fill="#a78bfa"/><rect x="30" y="52" width="8" height="16" fill="#94a3b8"/><rect x="62" y="44" width="16" height="6" fill="#a78bfa"/>`,
  p90: `<rect x="24" y="38" width="48" height="18" fill="#c084fc"/><rect x="36" y="56" width="10" height="14" fill="#94a3b8"/>`,
  ump: `<rect x="22" y="42" width="44" height="10" fill="#818cf8"/><rect x="30" y="52" width="8" height="16" fill="#94a3b8"/>`,
  mac10: `<rect x="30" y="40" width="36" height="12" fill="#fb7185"/><rect x="38" y="52" width="10" height="16" fill="#94a3b8"/>`,
  tmp: `<rect x="32" y="42" width="34" height="10" fill="#f472b6"/><rect x="40" y="52" width="8" height="16" fill="#94a3b8"/>`,
  m249: `<rect x="10" y="40" width="62" height="14" fill="#f59e0b"/><rect x="24" y="54" width="10" height="16" fill="#94a3b8"/><rect x="48" y="32" width="18" height="10" fill="#64748b"/>`,
  m3: `<rect x="12" y="44" width="64" height="10" fill="#fdba74"/><rect x="22" y="54" width="8" height="16" fill="#94a3b8"/>`,
  xm1014: `<rect x="12" y="42" width="64" height="12" fill="#fbbf24"/><rect x="22" y="54" width="8" height="16" fill="#94a3b8"/>`,
  sg550: `<rect x="10" y="44" width="60" height="9" fill="#38bdf8"/><rect x="42" y="34" width="16" height="10" fill="#94a3b8"/><rect x="22" y="53" width="8" height="16" fill="#64748b"/>`,
  g3sg1: `<rect x="8" y="44" width="66" height="9" fill="#fb923c"/><rect x="40" y="34" width="18" height="10" fill="#94a3b8"/><rect x="20" y="53" width="8" height="16" fill="#64748b"/>`,
  he: `<ellipse cx="50" cy="48" rx="18" ry="22" fill="#65a30d" stroke="#74E600" stroke-width="3"/><rect x="46" y="22" width="8" height="10" fill="#94a3b8"/>`
}

for (const [name, mark] of Object.entries(GUNS)) {
  const body = `
  <rect x="8" y="18" width="84" height="64" rx="8" fill="#070c14" fill-opacity="0.35" stroke="#38bdf8" stroke-opacity="0.25"/>
  ${mark}
`
  writeFileSync(join(assets, "i", `gun_${name}.svg`), svg(body))
}

console.log("wrote ranks 19, medals 13, guns", Object.keys(GUNS).length)
