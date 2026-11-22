export const FREE_XP = { normal: 50, rare: 150, super_rare: 300, mythic: 750, legendary: 1500 }

export const FREE_COINS = {
  1:100,2:50,3:150,4:50,5:250,6:100,7:50,8:100,9:50,10:500,
  11:100,12:50,13:100,14:50,15:750,16:100,17:50,18:250,19:100,20:50,
  21:500,22:100,23:50,24:100,25:1000,26:100,27:50,28:500,29:100,30:750,
  31:100,32:50,33:100,34:50,35:500,36:100,37:50,38:100,39:50,40:750,
  41:200,42:100,43:200,44:100,45:1000,46:200,47:100,48:200,49:100,50:2000,
  51:5000,52:10000,53:500,54:500,55:2500,56:500,57:500,58:1000,59:1000,60:5000
}

const PREMIUM_TOTAL = {
  1: { 50: 2500, 52: 10000, 60: 10000 },
  2: { 50: 3000, 52: 12500, 60: 12500 },
  3: { 50: 4000, 52: 15000, 60: 15000 }
}

export function premiumLaneName(lane) {
  if (lane >= 3) return "ELITE"
  if (lane >= 2) return "VIP+"
  if (lane >= 1) return "VIP"
  return "FREE"
}

export function premiumExtraCoins(tier, lane = 1) {
  const table = PREMIUM_TOTAL[lane] || PREMIUM_TOTAL[1]
  const extra = (table[tier] || 0) - (FREE_COINS[tier] || 0)
  return extra > 0 ? extra : 0
}

export const PERKS = {
  5: { key: "jumps", n: 1 },
  10: { key: "hp", n: 2 },
  15: { key: "xpboost", n: 1.5, sec: 1800 },
  20: { key: "sniper", n: 1 },
  25: { key: "title", n: 1 },
  30: { key: "tag", n: 1 },
  35: { key: "hp", n: 2 },
  40: { key: "spawn", n: 3 },
  45: { key: "xpboost", n: 2.0, sec: 1800 },
  48: { key: "chat_color", n: 1 },
  50: { key: "skin_flip", n: 1 },
  52: { key: "model_legend", n: 1 },
  54: { key: "chute", n: 1 },
  55: { key: "title", n: 11 },
  57: { key: "jumps", n: 1 },
  58: { key: "spawn", n: 5 },
  59: { key: "laststand", n: 1 },
  60: { key: "title", n: 6 }
}

export function premiumPerk(tier) { return PERKS[tier] || null }

export function RARITY_OF_BUILD() {
  const r = {}
  for (let t = 1; t <= 60; t++) r[t] = "normal"
  for (const t of [5,10,15,20,35,48,53,54,56,57]) r[t] = "rare"
  for (const t of [25,30,40,45,58,59]) r[t] = "super_rare"
  for (const t of [50,51,55]) r[t] = "mythic"
  r[52] = "legendary"; r[60] = "legendary"
  return r
}
export const RARITY_OF = RARITY_OF_BUILD()
export function starOf(rarity) { return rarity === "normal" ? "white" : "gold" }
export function cellClass(rarity) { return `bp-rarity-${rarity}` }

export function emptyBoosts() {
  return { hp: 0, armor: 0, jumps: 0, sniper: 0, laststand: 0, chute: 0, chat_color: 0 }
}

export function applyPremiumPerk(boosts, shop, tier, now, xpBoost) {
  const p = PERKS[tier]
  if (!p) return { skipped: false }
  if (p.key === "hp") boosts.hp = Math.min(20, boosts.hp + p.n)
  else if (p.key === "jumps") boosts.jumps = Math.min(2, boosts.jumps + p.n)
  else if (p.key === "chute") boosts.chute = 1
  else if (p.key === "chat_color") boosts.chat_color = 1
  else if (p.key === "sniper") {
    const have = Math.max(shop.sniper || 0, boosts.sniper)
    boosts.sniper = Math.min(2, have === 0 ? 1 : have + 1)
  } else if (p.key === "laststand") {
    const have = Math.max(shop.laststand || 0, boosts.laststand)
    boosts.laststand = Math.min(2, have === 0 ? 1 : have + 1)
  } else if (p.key === "xpboost") {
    if (xpBoost.active && xpBoost.end > now && xpBoost.mult > p.n)
      return { skipped: true }
    xpBoost.active = true
    xpBoost.mult = p.n
    xpBoost.end = now + p.sec
  }
  return { skipped: false }
}

export function migrateVip(milestone, shop) {
  const b = emptyBoosts()
  const xp = { active: false, end: 0, mult: 1 }
  for (let t = 1; t <= milestone; t++) applyPremiumPerk(b, shop, t, 0, xp)
  return b
}

export function spawnHp(level, shopHp, passHp) {
  const table = Math.min(15, Math.max(0, level - 1))
  return 100 + table + (shopHp || 0) + Math.min(20, passHp || 0)
}

// ---- battle pass display helpers (owner: bp_track.js) ---------------------
import { num } from "./ui.js"
// battle pass: D1 pushes UPPERCASE rarities; cells key off lowercase ids
export function normalizeBpRarity(r) {
  return String(r == null ? "" : r).trim().toLowerCase().replace(/[\s-]+/g, "_") || "normal"
}
// battle pass: per-season premium entitlement (S2+ store rows; S1 handled
// inline with the legacy bp_premium cursor at the call site)
export function hasSeasonPremium(p, season) {
  return !!p && String(p.bp_premium_season || "") === String(season) && num(p.bp_ent_lane) > 0
}
