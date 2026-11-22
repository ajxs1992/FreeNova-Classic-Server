import fs from 'fs'
import * as cat from '../src/catalogs.js'

const now = Math.floor(Date.now() / 1000)
const entries = [
  ['reward_track', cat.DEFAULT_REWARD_TRACK],
  ['skills', cat.DEFAULT_SKILLS],
  ['skins', cat.DEFAULT_SKINS],
  ['models', cat.DEFAULT_MODELS],
  ['cosmetics', cat.DEFAULT_COSMETICS],
  ['achievements', cat.DEFAULT_ACHIEVEMENTS],
  ['events', cat.DEFAULT_EVENTS],
  ['hall_of_fame', cat.DEFAULT_HALL_OF_FAME]
]

let sql = '-- Seed Catalogs for FreeNova D1\n'
for (const [key, data] of entries) {
  const jsonStr = JSON.stringify(data).replace(/'/g, "''")
  sql += `INSERT OR REPLACE INTO catalog (key, version, json, updated_at) VALUES ('${key}', 1, '${jsonStr}', ${now});\n`
}

fs.writeFileSync('seed_catalogs.sql', sql, 'utf8')
console.log(`Generated seed_catalogs.sql with ${entries.length} catalogs, size: ${sql.length} bytes`)
