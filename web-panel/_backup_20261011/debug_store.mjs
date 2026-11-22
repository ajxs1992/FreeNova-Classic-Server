import { actionToken, queueAction, checkActionToken } from "./src/sync.js"
import * as pages from "./src/pages.js"
import Database from "better-sqlite3"
const SECRET = "test_secret"
function makeD1() {
  const db = new Database(":memory:")
  db.exec(`CREATE TABLE IF NOT EXISTS players (steamid TEXT PRIMARY KEY, name TEXT, xp INT DEFAULT 0, level INT DEFAULT 0, rank_id INT DEFAULT 0, kills INT DEFAULT 0, deaths INT DEFAULT 0, headshots INT DEFAULT 0, vip_tier INT DEFAULT 0, coins INT DEFAULT 0, rating_x100 INT DEFAULT 0, comp_season TEXT, comp_kills INT DEFAULT 0, comp_hs INT DEFAULT 0, comp_wins INT DEFAULT 0, comp_mvp INT DEFAULT 0, bp_milestone INT DEFAULT 0, bp_premium INT DEFAULT 0, skills TEXT, updated_at INT DEFAULT 0);
    CREATE TABLE IF NOT EXISTS actions (id INTEGER PRIMARY KEY AUTOINCREMENT, steamid TEXT, type TEXT, arg TEXT, status TEXT DEFAULT 'pending', result TEXT, created_at INT, closed_at INT);
    CREATE TABLE IF NOT EXISTS player_skins (steamid TEXT, grp TEXT, skin INT, equipped INT DEFAULT 0);
    CREATE TABLE IF NOT EXISTS catalog (key TEXT PRIMARY KEY, json TEXT);
    CREATE TABLE IF NOT EXISTS player_profile (steamid TEXT PRIMARY KEY, featured TEXT, updated_at INT);
    CREATE TABLE IF NOT EXISTS server_meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO players (steamid,name,coins) VALUES ('STEAM_0:1:11111','ziz',4850);`)
  function wrap(stmt) {
    return { bind:(...a)=>wrap(stmt.bind(...a)), first:()=>stmt.get(), all:()=>({results:stmt.all()}), run:()=>{const r=stmt.run();return{meta:{last_row_id:r.lastInsertRowid}}} }
  }
  return { prepare:(sql)=>wrap(db.prepare(sql)), batch:(stmts)=>Promise.all(stmts.map(s=>s.run())) }
}
const env={DB:makeD1(),SYNC_SECRET:SECRET}
const tok=await actionToken(SECRET,"STEAM_0:1:11111")
console.log("validates:",await checkActionToken(SECRET,"STEAM_0:1:11111",tok))
console.log("direct:",JSON.stringify(await queueAction(env,"STEAM_0:1:11111","buy_skill","healthnade",tok)))
const env2={DB:makeD1(),SYNC_SECRET:SECRET}
const tok2=await actionToken(SECRET,"STEAM_0:1:11111")
const u=new URL(`https://x/store?steamid=STEAM_0:1:11111&t=${encodeURIComponent(tok2)}&buy=buy_skill:healthnade`)
console.log("t:",u.searchParams.get("t").slice(0,16))
console.log("buy:",u.searchParams.get("buy"))
try{await pages.pageStore(env2,u)}catch(e){console.log("threw:",e.message)}
const act=await env2.DB.prepare(`SELECT * FROM actions WHERE steamid='STEAM_0:1:11111' AND type='buy_skill'`).first()
console.log("row:",JSON.stringify(act))