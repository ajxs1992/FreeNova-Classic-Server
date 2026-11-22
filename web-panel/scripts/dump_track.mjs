import { DEFAULT_REWARD_TRACK } from '../src/catalogs.js';
import { writeFileSync } from 'node:fs';
const row = { key: 'reward_track', version: 2, json: DEFAULT_REWARD_TRACK, updated_at: Math.floor(Date.now()/1000) };
writeFileSync(process.env.OUT || 'C:\\Users\\conts\\AppData\\Local\\Temp\\opencode\\reward_track_v2.json', JSON.stringify(row.json));
console.log('tiers:', row.json.tiers.length, 'version:', row.json.version);
