# Web panel rebuild — replacing every page with the Winterfest design

Owner decision (2026-11-22): *"we remake every single thing from the webpanels,
we are going to replace a lot of stuff."* This is the plan that does that without
taking the live panel down.

## The rule that protects the live panel

The panel serves players **right now**. So:

1. **New pages are built under `/v2/…`** (or behind a `?skin=v2` switch for pages
   where a separate path is awkward). The current routes keep working, unchanged,
   until their replacement passes verification.
2. **Cutover is per page**, one commit each: the old handler starts delegating to
   the new renderer, the `/v2/` path keeps working as the escape hatch for a
   week, then is removed.
3. **No data changes during the rebuild.** Same tables, same queries, same auth,
   same sync. A redesign that also changes behaviour is two bugs in one commit.
4. **The in-game MOTD (`/m/…`) is NOT part of this.** It is an MSIE-class browser
   with different rules (`web-panel/src/motd.js` documents them). It gets linked
   from the new pages, not redesigned by them.

## The design system (one shell, every page)

`web-panel/src/v2/` — new, owned by the design workstream:

| file | what it holds |
| --- | --- |
| `theme.js` | palette, spacing scale, radii, shadows, type scale — sampled from the reference |
| `shell.js` | sidebar (4 groups, active state, icon + title + subtitle), top bar (currency chips, bell, envelope, profile chip), page frame, breadcrumbs |
| `components.js` | card, stat card, progress bar, pill/state badge, table, list row, empty state, item tile, countdown, section label |
| `icons.js` | inline SVG set (no images, no webfonts) |
| `pages/*.js` | one module per page, each exporting `render(ctx)` |

Every page must work with **JS disabled**, at **1280 / 1672 / 1920** wide, and
render an honest empty state for a player with no data. No new dependencies.

## Route inventory to replace (45 today)

Dashboard / home: `/` `/home` `/hub`
Player: `/profile` `/rank` `/rankstats` `/stats` `/statsme` `/statsviewer`
`/rsumissions` `/rsu.php` `/models` `/skins` `/cosmetics` `/settings` `/search`
Boards: `/top15` `/top` `/leaderboard` `/rankings` `/records` `/competitive` `/ctop`
`/halloffame` `/hof` `/tournament` `/top/{xp,kills,kd,level,mvps,playtime,rating,wins,headshots,week,month}`
Progression: `/bp` `/battlepass` `/battlepass.php` `/missions` `/achievements`
Events: `/events` `/mapend`
Economy: `/vip` `/shop` `/store`
Misc: `/rules` `/discord` `/compare` `/icon` `/icons` `/favicon.ico`
Admin: `/admin` (+ sections)

New in this rebuild: `/levels` `/winter/*` (`hub`, `tree`, `gifts`, `ornaments`,
`advent`, `pass`, `spin`, `mail`).

## Conversion order (impact first)

1. **Shell + theme + components** (blocks everything else).
2. **Dashboard** — the owner's reference; becomes `/` (old `/` redirects).
3. **Profile** — the most-visited player page.
4. **Top 15 / boards family** — one renderer, 13 routes; biggest single win.
5. **Progression** — BattlePass, Missions, Achievements.
6. **Events**, then **VIP / Shop**.
7. **Rankstats / rank / stats family**, **Cosmetics / Models / Skins**, **Settings**.
8. **Admin** — last, because it is the one surface where a mistake costs data.
9. Delete the `/v2/` escape hatches once each page has a week of clean service.

## Per-page acceptance (same for every page)

- Same data source and same numbers as the page it replaces (compare two
  screenshots and one query result).
- All existing harness checks still pass; add checks for the empty state, the
  zero-data player and the error path.
- `node --check` clean, `npm audit` still 0, no new dependency, no external
  request.
- Works at 1280/1672/1920 and with JS off.
- Contrast checked on the dark base; nav focusable; `aria-current` correct.
- A screenshot in `docs/design/renders/<page>.png` next to the reference.

## What the owner needs to send

One reference per page (or per family), in this order of value: **profile**, then
the **Top 15/board**, then **BattlePass**, **Missions**, **Events**, **VIP**,
**Shop**, **Admin**. The shell from the dashboard reference covers the frame; the
per-page references decide the content layout.
