import Database from 'better-sqlite3'
const db = new Database('C:/Users/conts/Desktop/.,/Server CS 1.6/cstrike/addons/amxmodx/data/sqlite3/freenova_panel.sq3', { readonly: true })
console.log("=== meta ===")
db.prepare("SELECT key, value FROM meta WHERE key NOT LIKE 'nonce:%' ORDER BY rowid").all()
  .forEach(r => console.log(r.key.padEnd(25), r.value))
db.close()
