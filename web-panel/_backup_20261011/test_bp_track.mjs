import assert from "assert"
import {
  RARITY_OF, FREE_XP, FREE_COINS, premiumExtraCoins, premiumPerk,
  emptyBoosts, applyPremiumPerk, migrateVip, spawnHp, starOf, cellClass,
  premiumLaneName
} from "./src/bp_track.js"

assert.equal(RARITY_OF[1], "normal")
assert.equal(RARITY_OF[5], "rare")
assert.equal(RARITY_OF[25], "super_rare")
assert.equal(RARITY_OF[50], "mythic")
assert.equal(RARITY_OF[52], "legendary")
assert.equal(starOf("normal"), "white")
assert.equal(starOf("rare"), "gold")
assert.equal(cellClass("normal"), "bp-rarity-normal")
assert.equal(cellClass("legendary"), "bp-rarity-legendary")
assert.equal(FREE_COINS[10], 750)
assert.equal(FREE_COINS[52], 10000)
assert.equal(FREE_COINS[60], 7500)
assert.equal(FREE_XP.normal, 50)
assert.equal(FREE_XP.rare, 150)
assert.equal(premiumExtraCoins(50), 500)
assert.equal(premiumExtraCoins(52), 2000)
assert.equal(premiumExtraCoins(60), 5000)
assert.equal(premiumExtraCoins(50, 2), 1250)
assert.equal(premiumExtraCoins(52, 2), 5000)
assert.equal(premiumExtraCoins(60, 2), 7500)
assert.equal(premiumExtraCoins(50, 3), 2500)
assert.equal(premiumExtraCoins(52, 3), 10000)
assert.equal(premiumExtraCoins(60, 3), 12500)
assert.equal(premiumLaneName(1), "VIP")
assert.equal(premiumLaneName(2), "VIP+")
assert.equal(premiumLaneName(3), "ELITE")
assert.equal(FREE_COINS[53], 750)
assert.equal(FREE_COINS[56], 750)
assert.equal(FREE_COINS[20], 500)
assert.equal(premiumPerk(6).key, "armor")
assert.equal(premiumPerk(21).key, "sniper")
assert.equal(premiumPerk(10).key, "hp")
assert.equal(premiumPerk(51), null)

const shop = { sniper: 0, laststand: 0, jumps: 0, spawn_hp: 0 }
let b = emptyBoosts()
const xp = { active: false, end: 0, mult: 1 }
applyPremiumPerk(b, shop, 10, 0, xp)
assert.equal(b.hp, 2)
assert.equal(spawnHp(10, 0, b.hp), 100 + 9 + 2)

b = emptyBoosts()
applyPremiumPerk(b, shop, 5, 0, xp)
applyPremiumPerk(b, shop, 57, 0, xp)
applyPremiumPerk(b, shop, 57, 0, xp)
assert.equal(b.jumps, 2)

shop.sniper = 0
b = emptyBoosts()
applyPremiumPerk(b, shop, 20, 0, xp)
assert.equal(b.sniper, 1)
shop.sniper = 1
b = emptyBoosts()
applyPremiumPerk(b, shop, 20, 0, xp)
assert.equal(b.sniper, 2)

xp.active = true; xp.mult = 2.0; xp.end = 999
const skip = applyPremiumPerk(emptyBoosts(), shop, 15, 0, xp)
assert.equal(skip.skipped, true)

const mig = migrateVip(40, { sniper: 0, laststand: 0 })
assert.equal(mig.hp, 6)
assert.equal(mig.armor, 100)
assert.equal(mig.jumps, 1)
assert.equal(mig.sniper, 2)

b = emptyBoosts(); b.hp = 20
applyPremiumPerk(b, shop, 10, 0, xp)
assert.equal(b.hp, 20)

import { DEFAULT_REWARD_TRACK } from "./src/catalogs.js"
assert.equal(DEFAULT_REWARD_TRACK.version, 2)
assert.equal(DEFAULT_REWARD_TRACK.tiers.length, 60)
const t5 = DEFAULT_REWARD_TRACK.tiers[4]
assert.equal(t5.rarity, "rare")
assert.equal(t5.star, "gold")
assert.equal(t5.free_xp, 150)
assert.equal(t5.premium_perk.key, "jumps")
assert.ok(!("icon" in t5))
const t1 = DEFAULT_REWARD_TRACK.tiers[0]
assert.equal(t1.rarity, "normal")
assert.equal(t1.star, "white")
assert.equal(t1.premium_perk, null)

const t51 = DEFAULT_REWARD_TRACK.tiers[50]
assert.equal(t51.tier, 51)
assert.equal(t51.rarity, "mythic")
assert.equal(t51.star, "gold")
assert.equal(t51.free_xp, 750)
assert.equal(t51.free_coins, 5000)
assert.equal(t51.premium_perk, null)

// Test chute and chat_color perks
const perkBoosts = emptyBoosts()
applyPremiumPerk(perkBoosts, shop, 48, 0, xp)
assert.equal(perkBoosts.chat_color, 1)
applyPremiumPerk(perkBoosts, shop, 54, 0, xp)
assert.equal(perkBoosts.chute, 1)

console.log("PASS bp_track")
