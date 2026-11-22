# Asset Manifest — FreeNova Rank Showcase

| File | Size target | Colors | Placeholder? | Fallback text (MOTD alt) |
|---|---|---|---|---|
| vip-badge.svg | <15KB | emerald #10B981 / #065F46 on #111827 | No — final badge | "VIP badge" |
| admin-badge.svg | <15KB | cyan #22D3EE / #0E7490 | No — final badge | "Admin badge" |
| superadmin-badge.svg | <15KB | purple #8B5CF6/#4C1D95 + gold #F59E0B | No — final badge | "Super Admin badge — highest tier" |
| ghost-grenade.svg | <15KB | purple spectral | No — stylized artwork (not a photo of item) | "Ghost Grenade" |
| stinger.svg | <15KB | neutral + purple | **PLACEHOLDER silhouette — replace with in-game Stinger model render** | "Stinger weapon" |
| vip-model.svg | <15KB | emerald tactical silhouette | **PLACEHOLDER — replace with real VIP player model render** | "VIP player model" |
| parachute.svg | <15KB | emerald canopy | No — diagram (shared VIP/Admin) | "VIP parachute (VIP included, Admin inherited)" |
| pistols.svg | <15KB | cyan pistols + 400 HS DMG ribbon | **PLACEHOLDER silhouettes — replace with pistol model renders** | "Exclusive pistols — 400 HS DMG" |

Rules:
- No CS2 weapons presented as CS 1.6 content. Stinger/pistols are generic GoldSrc-era silhouettes until replaced.
- All SVGs: pure vector, no external refs, width/height + viewBox + &lt;title&gt;. MOTD uses alt text if SVG unsupported.
- Replacement: drop real PNG/JPG renders next to SVGs with same basename (e.g. stinger.png) and update &lt;img&gt; srcset — no HTML rewrite needed if you keep filenames.
