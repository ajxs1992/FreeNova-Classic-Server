import { readFileSync, writeFileSync } from "fs"
const p = "C:/Users/conts/Desktop/.,/FREENOVA System/battlepass.php"
let s = readFileSync(p, "utf8")
const start = s.indexOf("    <div id=\"sub-pass-timeline\"")
const end = s.indexOf("    <!-- 13 Skills Grid -->")
if (start < 0 || end < 0) throw new Error(`markers ${start} ${end}`)
const inner = `    <div id="sub-pass-timeline" class="sub-pane <?= ($initialPortal === 'pass' && $initialSub === 'timeline') ? 'active' : '' ?>">
<?php
  $bpNeed = 1000;
  $bpInto = ((int)$xp) % $bpNeed;
  $bpProg = min(100, (int)round(($bpInto / $bpNeed) * 100));
  $bpTier = max(0, min(60, (int)$level));
  $logoSrc = $logoBase64 ? $logoBase64 : 'freenova_logo.png';
  $customTiers = [
    1 => ['name' => 'Recruit Stash', 'free' => '+100 Coins', 'premium' => '+100c Recruit Stash', 'milestone' => false],
    2 => ['name' => 'Field Ammo Pack', 'free' => '+50 Coins', 'premium' => '+50c Munitions', 'milestone' => false],
    3 => ['name' => 'Tactical Ration', 'free' => '+150 Coins', 'premium' => '+100c Supply Crate', 'milestone' => false],
    4 => ['name' => 'Recon Scout Kit', 'free' => '+50 Coins', 'premium' => '+50c Recon Munitions', 'milestone' => false],
    5 => ['name' => 'Double Jump Perk', 'free' => '+250 Coins', 'premium' => 'Double Jump Stage I', 'milestone' => true],
    10 => ['name' => 'Novice Vanguard', 'free' => '+500 Coins', 'premium' => '+500c & Bronze Badge', 'milestone' => true],
    15 => ['name' => '1.5x XP Booster', 'free' => '+750 Coins', 'premium' => '30m 1.5x XP Boost', 'milestone' => true],
    20 => ['name' => 'Quick Bolt Module', 'free' => '+500 Coins', 'premium' => 'Fast Sniper Stage I', 'milestone' => true],
    25 => ['name' => 'Godlike Title License', 'free' => '+1,000 Coins', 'premium' => '[★ GODLIKE]', 'milestone' => true],
    30 => ['name' => 'Tag License Voucher', 'free' => '+750 Coins', 'premium' => '+1,000c Tag Voucher', 'milestone' => true],
    35 => ['name' => 'Spawn HP Titan Perk', 'free' => '+500 Coins', 'premium' => 'Vitality II (+20 HP)', 'milestone' => true],
    40 => ['name' => 'Lightning Spawn Aura', 'free' => '+750 Coins', 'premium' => 'Lightning Spawn Effect', 'milestone' => true],
    45 => ['name' => '2.0x Double XP Boost', 'free' => '+1,000 Coins', 'premium' => 'Double XP (30m)', 'milestone' => true],
    50 => ['name' => 'Tactical Flip Knife Skin', 'free' => '+2,000 Coins', 'premium' => 'Flip Knife Skin + 2,500c', 'milestone' => true],
    52 => ['name' => 'VIP Legend Player Skin', 'free' => '+10,000 Coins', 'premium' => 'Legend Player Model', 'milestone' => true],
    60 => ['name' => 'The Global Elite Trophy', 'free' => '+5,000 Coins', 'premium' => 'Global Elite Title + 10,000c', 'milestone' => true]
  ];
?>
      <div class="csgo-pass">
        <div class="csgo-pass-layout">
          <div class="csgo-pass-left">
            <div class="op-kicker">OPERATION</div>
            <div class="op-title">CYBER GENESIS</div>
            <div class="op-art"><img src="<?= hs($logoSrc) ?>" width="92" height="92" alt="FreeNova"></div>
            <div class="op-meta">Season 1 · <?= hs($curPlayer['name']) ?></div>
            <div class="op-meta"><?= number_format($curPlayer['coins']) ?> coins</div>
            <div class="csgo-pass-xp">
              <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase;">Pass level</div>
              <div class="lvl"><?= (int)$bpTier ?></div>
              <div style="display:flex;justify-content:space-between;font-size:11px;margin:6px 0 4px;">
                <span><?= number_format($bpInto) ?> XP</span>
                <span><?= number_format($bpNeed - $bpInto) ?> to next</span>
              </div>
              <div class="bar"><div style="width:<?= $bpProg ?>%"></div></div>
            </div>
          </div>
          <div class="csgo-pass-track-wrap">
            <div class="csgo-pass-track">
              <div class="csgo-pass-rail premium">Premium</div>
              <div class="csgo-pass-row">
<?php for ($t = 1; $t <= 60; $t++):
  $info = $customTiers[$t] ?? ['name' => "Tier $t", 'free' => '+100 Coins', 'premium' => '+100c', 'milestone' => false];
  $st = ($t < $bpTier) ? 'claimed' : (($t == $bpTier) ? 'current' : 'locked');
  $mile = !empty($info['milestone']) ? ' milestone' : '';
?>
                <div class="csgo-pass-cell premium <?= $st . $mile ?>">
                  <div class="nm"><?= hs($info['premium']) ?></div>
                  <div class="rw">VIP</div>
                </div>
<?php endfor; ?>
              </div>
              <div class="csgo-pass-row csgo-pass-stars">
<?php for ($t = 1; $t <= 60; $t++):
  $st = ($t < $bpTier) ? 'done' : (($t == $bpTier) ? 'now' : '');
?>
                <div class="csgo-pass-star <?= $st ?>"><?= $t ?></div>
<?php endfor; ?>
              </div>
              <div class="csgo-pass-row">
<?php for ($t = 1; $t <= 60; $t++):
  $info = $customTiers[$t] ?? ['name' => "Tier $t", 'free' => '+100 Coins', 'premium' => '+100c', 'milestone' => false];
  $st = ($t < $bpTier) ? 'claimed' : (($t == $bpTier) ? 'current' : 'locked');
  $mile = !empty($info['milestone']) ? ' milestone' : '';
?>
                <div class="csgo-pass-cell <?= $st . $mile ?>">
                  <div class="nm"><?= hs($info['name']) ?></div>
                  <div class="rw"><?= hs($info['free']) ?></div>
                </div>
<?php endfor; ?>
              </div>
              <div class="csgo-pass-rail free">Free rewards</div>
            </div>
          </div>
        </div>
      </div>
      <p class="muted">Horizontal dual track matching the Operation Pass. Claim in-game with /bp.</p>
    </div>

`
s = s.slice(0, start) + inner + s.slice(end)
writeFileSync(p, s)
console.log("patched MOTD timeline", start, "->", end, "new", s.length)
