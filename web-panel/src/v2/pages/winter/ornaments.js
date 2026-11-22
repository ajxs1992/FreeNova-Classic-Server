// /v2/winter/ornaments — the collection book, rebuilt on the profile reference's
// collection look.
//
// Two rules are load-bearing here, both the old page's:
//
//   1. a missing entry is never pictured as the thing you have not found: owned
//      ornaments get the generated art, missing ones a silhouette;
//   2. if the catalogue marks an entry `secret` (the ini's `hidden` column) its
//      NAME is not printed either — "? ? ?" until it is owned, and a secret
//      set's title is "? ? ?" until the set is complete. That is the "never
//      leak" rule, enforced by omission rather than by hiding with CSS.
//
// Every number comes from ornamentStatus()/setProgress() over the same read the
// rest of the family uses (../../data/winter.js). The catalogue's own secret
// rule is the catalog helper's (ornamentLockedLabel), not one written here.
import { esc, fmt, pct } from "../../theme.js"
import { icon } from "../../icons.js"
import { artIcon } from "../../art.js"
import { card, bar, emptyState, button } from "../../components.js"
import { ornamentStatus, setProgress } from "../../../winter/progress.js"
import { ornamentLockedLabel, rarity, rarityName } from "../../../winter/catalog.js"
import { winterContext } from "../../data/winter.js"
import { winterPage, winterHero } from "./shared.js"

const ORN_CSS = `
/* --------------------------------------------------------------- the book --- */
.v2wo-set{margin:0 0 12px}
.v2wo-set:last-child{margin-bottom:0}
.v2wo-set-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 6px}
.v2wo-set-h b{font-size:14px;font-weight:800;letter-spacing:.2px}
.v2wo-set-n{font-size:12px;font-weight:800;color:var(--v2-gold);font-variant-numeric:tabular-nums}
.v2wo-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;margin-top:7px}
.v2wo-tile{margin:0;border-radius:10px;border:1px solid #33447c;padding:6px 4px 7px;min-width:0;
  background:linear-gradient(180deg,#141d44 0%, #0d1434 100%);
  display:grid;gap:2px;justify-items:center;text-align:center;
  box-shadow:inset 0 1px 0 rgba(130,160,230,.16)}
.v2wo-tile.locked{opacity:.7;border-style:dashed;background:linear-gradient(180deg,#0f1636 0%, #0a102b 100%)}
.v2wo-art{line-height:0;height:38px;display:grid;place-items:center;color:#33447c}
.v2wo-tile figcaption b{display:block;font-size:11px;font-weight:700;line-height:1.2;overflow-wrap:anywhere}
.v2wo-tile figcaption small{display:block;font-size:9.5px;font-weight:800;letter-spacing:.3px;color:var(--v2-muted)}

/* -------------------------------------------------------------- the sets --- */
.v2wo-sets{margin:7px 0 0;padding:0;list-style:none;display:grid;gap:4px;font-size:12px}
.v2wo-sets li{display:grid;grid-template-columns:16px minmax(0,1fr) auto;gap:7px;align-items:center;color:#cfdaf5}
.v2wo-sets li.done b{color:var(--v2-green-alt)}
.v2wo-sets li b{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.v2wo-sets-ic{line-height:0;color:var(--v2-faint);display:inline-flex}
.v2wo-sets li.done .v2wo-sets-ic{color:var(--v2-green-alt)}
.v2wo-sets li > span:last-child{font-weight:800;color:var(--v2-gold);font-variant-numeric:tabular-nums}

/* ------------------------------------------------------------- rarity row --- */
.v2wo-rar{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.v2wo-tally{gap:1px;padding:6px 3px}
.v2wo-tally-n{font-size:10px;font-weight:800;color:#cfdaf5;text-align:center;line-height:1.15;overflow-wrap:anywhere}
.v2wo-tally-t{font-size:9.5px;color:var(--v2-faint);font-variant-numeric:tabular-nums}

@media (max-width:820px){
  .v2wo-rar{grid-template-columns:repeat(2,minmax(0,1fr))}
  .v2wo-tiles{grid-template-columns:repeat(auto-fill,minmax(78px,1fr))}
}
`

/** The generated art that stands for each rarity tier. */
const TIER_ART = ["bauble", "star", "trophy"]

/**
 * A rarity as the catalogue describes it. Only the rows the game pushed exist in
 * `cat.rarities`, so an unnamed tier is reported by its own index ("Rarity 2")
 * instead of borrowing another tier's name.
 */
function rarityOf(cat, id) {
  const n = Math.max(0, Math.trunc(Number(id) || 0))
  const published = cat && cat.rarities ? cat.rarities[n] : null
  return {
    n,
    name: published ? rarityName(cat, n) : `Rarity ${n}`,
    color: rarity(cat, n).color
  }
}

/**
 * One tally per rarity the catalogue uses, plus the whole book when that leaves
 * room. The reference paints four tiles, but this deployment's catalogue defines
 * three tiers (winterfest.inc: WF_RARITY_MAX 3, "the ini may define fewer"), so
 * the fourth tile is the book itself — a fourth rarity is never invented to fill
 * the row.
 */
function rarityTallies(cat, orn, owned) {
  const ornaments = (cat && cat.ornaments) || []
  const ids = new Set()
  for (const o of ornaments) ids.add(Math.max(0, Math.trunc(Number(o.rarity) || 0)))
  for (const k of Object.keys((cat && cat.rarities) || {})) ids.add(Math.trunc(Number(k)))
  const rows = [...ids]
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b)
    .map(n => {
      const items = ornaments.filter(o => Math.max(0, Math.trunc(Number(o.rarity) || 0)) === n)
      const rar = rarityOf(cat, n)
      return {
        key: `r${n}`,
        name: rar.name,
        color: rar.color,
        art: artIcon(TIER_ART[n] || "bauble", 26),
        owned: items.filter(o => owned.has(o.id)).length,
        total: items.length
      }
    })
  const tiers = rows.length
  if (tiers < 4) {
    rows.push({
      key: "all",
      name: "In the book",
      color: "",
      art: artIcon("tree", 26),
      owned: orn.ownedInCatalogue,
      total: orn.catalogueTotal
    })
  }
  return { rows, tiers }
}

/** The page's view model: the book grouped by set, the set rows, the tallies. */
export function ornamentsView(ctx) {
  const { cat, state } = ctx
  const owned = (state && state.ownedIds) || new Set()
  const orn = ornamentStatus(cat, state)
  const sets = setProgress(cat, state)
  const ornaments = (cat && cat.ornaments) || []
  const tally = rarityTallies(cat, orn, owned)
  return {
    cat,
    owned,
    orn,
    sets,
    loose: ornaments.filter(o => !o.set),
    tallies: tally.rows,
    tiers: tally.tiers,
    completeSets: sets.filter(s => s.complete).length,
    setCount: sets.length,
    catalogue: !!cat.ok,
    extra: orn.extra || []
  }
}

/** A missing entry is a silhouette; a secret missing entry has no name either. */
function ornTile(cat, o, owned) {
  const have = owned.has(o.id)
  const rar = rarityOf(cat, o.rarity)
  const label = have ? o.name : ornamentLockedLabel(cat, o.id)
  return `<figure class="v2wo-tile${have ? "" : " locked"}">
    <span class="v2wo-art" aria-hidden="true">${have ? artIcon(TIER_ART[rar.n] || "bauble", 34) : ""}</span>
    <figcaption>
      <b>${esc(label)}</b>
      <small${have ? ` style="color:${esc(rar.color)}"` : ""}>${have ? esc(rar.name) : "missing"}</small>
    </figcaption>
  </figure>`
}

/** One set of the book: its ornaments in catalogue order, owned or missing. */
function setBlock(v, s) {
  const items = s.total
    ? `<div class="v2wo-tiles">${s.ornaments.map(o => ornTile(v.cat, o, v.owned)).join("")}</div>`
    : emptyState("No ornaments published for this set", "The game has not pushed this set's rows yet.")
  return `<div class="v2wo-set">
    <div class="v2wo-set-h">
      <b>${esc(s.name)}</b>
      <span class="v2wo-set-n">${fmt(s.owned)} / ${fmt(s.total)}</span>
    </div>
    ${bar(s.owned, s.total, s.complete ? "gold" : "")}
    ${items}
  </div>`
}

function bookCard(v) {
  const blocks = v.sets.map(s => setBlock(v, s)).join("")
  const looseBlock = v.loose.length
    ? `<div class="v2wo-set">
        <div class="v2wo-set-h"><b>No set</b><span class="v2wo-set-n">${fmt(v.loose.filter(o => v.owned.has(o.id)).length)} / ${fmt(v.loose.length)}</span></div>
        <div class="v2wo-tiles">${v.loose.map(o => ornTile(v.cat, o, v.owned)).join("")}</div>
      </div>`
    : ""
  const filled = blocks || looseBlock
  const body = filled
    ? `${v.orn.ownedTotal ? "" : emptyState("Nothing owned yet", "Open a present in game and the first ornament appears here, owned.")}
      ${blocks}${looseBlock}
      ${v.catalogue ? "" : `<p class="v2w-note" style="margin-top:6px">The ornament catalogue has not been pushed by the game server yet, so the book lists only what the game says this player owns (by id). Nothing is invented to fill it.</p>`}`
    : emptyState("The catalogue is empty", "The game has not pushed its ornament rows yet, so there is nothing to list.")
  return card({
    head: { icon: artIcon("bauble", 26), title: "The book", sub: "Every ornament, grouped by set. Missing entries are silhouettes." },
    body
  })
}

function setCard(s) {
  const p = pct(s.owned, s.total)
  const title = s.complete
    ? `${esc(s.title)} &middot; awarded in game`
    : `${esc(s.title)} &middot; ${s.secret ? "secret until the set is complete" : `${fmt(s.total - s.owned)} to go`}`
  const bonus = Number(s.snowflakes) > 0
    ? `+${fmt(s.snowflakes)} GingerBread once, on completion`
    : "No bonus published"
  const body = `${bar(s.owned, s.total, s.complete ? "gold" : "")}
    <p class="v2w-note" style="margin-top:6px">Title: ${title}</p>
    <p class="v2w-note">Bonus: ${esc(bonus)}</p>
    ${s.complete ? `<p class="v2w-note" style="color:var(--v2-green-alt);margin:0">Complete</p>` : ""}`
  return card({
    head: { icon: artIcon("trophy", 24), title: s.name, sub: `${fmt(s.owned)} / ${fmt(s.total)} ornaments · ${p}%` },
    body
  })
}

function collectedCard(v) {
  const body = v.orn.catalogueTotal > 0
    ? `<div class="v2w-progress">
      <p class="v2w-big"><b>${fmt(v.orn.ownedInCatalogue)}</b> <span>/ ${fmt(v.orn.catalogueTotal)} ornaments</span></p>
      ${bar(v.orn.ownedInCatalogue, v.orn.catalogueTotal)}
      <p class="v2w-note">${v.orn.pct}% of the book &middot; ${fmt(v.orn.missing)} still missing</p>
      ${v.extra.length ? `<p class="v2w-note">The game reports ${fmt(v.extra.length)} ornament id${v.extra.length === 1 ? "" : "s"} the pushed catalogue has no row for yet: ${v.extra.map(id => `<code>#${fmt(id)}</code>`).join(" ")}.</p>` : ""}
      ${button({ href: "/v2/winter/tree", label: "View my tree", icon: icon("arrow", 18) })}
    </div>`
    : `<div class="v2w-progress">
      ${emptyState("No catalogue yet", "The game has not pushed its ornament rows, so there is nothing to count.")}
      ${v.extra.length ? `<p class="v2w-note">It reports ${fmt(v.extra.length)} ornament id${v.extra.length === 1 ? "" : "s"} this player owns: ${v.extra.map(id => `<code>#${fmt(id)}</code>`).join(" ")}.</p>` : ""}
      ${button({ href: "/v2/winter/tree", label: "View my tree", icon: icon("arrow", 18) })}
    </div>`
  return card({
    head: { icon: "", title: "Collected" },
    body
  })
}

function setsCard(v) {
  const body = v.setCount
    ? `<p class="v2w-big"><b>${fmt(v.completeSets)}</b> <span>/ ${fmt(v.setCount)} sets complete</span></p>
      ${bar(v.completeSets, v.setCount, v.completeSets === v.setCount ? "gold" : "")}
      <ul class="v2wo-sets">${v.sets.map(s => `<li${s.complete ? ' class="done"' : ""}>
        <span class="v2wo-sets-ic" aria-hidden="true">${s.complete ? icon("check", 15) : ""}</span>
        <b>${esc(s.name)}</b>
        <span>${fmt(s.owned)}/${fmt(s.total)}</span>
      </li>`).join("")}</ul>
      <p class="v2w-note" style="margin-top:6px">A completed set pays its title and its GingerBread bonus once, in game.</p>`
    : `<p class="v2w-big"><b>No sets published</b></p>
      <p class="v2w-note">The game has not pushed its set rows yet, so there is no set progress to show.</p>`
  return card({
    head: { icon: artIcon("star", 24), title: "Sets" },
    body
  })
}

function tallyCard(v) {
  const tiles = v.tallies.map(t => `<div class="v2-count-tile v2wo-tally" title="${esc(t.name)}">
    <span aria-hidden="true">${t.art}</span>
    <b>${fmt(t.owned)}</b>
    <span class="v2wo-tally-n">${esc(t.name)}</span>
    <span class="v2wo-tally-t">of ${fmt(t.total)}</span>
  </div>`).join("")
  const note = v.tiers === 0
    ? "The catalogue has not published its rarity rows yet, so there is no per-tier count to show."
    : v.tiers < 4
      ? `The catalogue defines ${fmt(v.tiers)} rarit${v.tiers === 1 ? "y" : "ies"} here (winterfest.inc: WF_RARITY_MAX 3), so the last tile is the whole book rather than a tier that does not exist.`
      : "One tally per rarity the catalogue defines."
  return card({
    head: { icon: artIcon("bauble", 24), title: "By rarity", sub: "Owned / published, per tier." },
    body: `<div class="v2wo-rar">${tiles}</div><p class="v2w-note" style="margin-top:6px">${esc(note)}</p>`
  })
}

export async function pageWinterOrnamentsV2(env, url, nowSec) {
  const ctx = await winterContext(env, url, nowSec)
  const v = ornamentsView(ctx)

  const hero = winterHero({
    title: "Ornament Collection",
    sub: "Find them in presents, complete a set and unlock its title.",
    badge: v.orn.catalogueTotal > 0
      ? `<b>${fmt(v.orn.ownedInCatalogue)}</b> / ${fmt(v.orn.catalogueTotal)} collected`
      : "No catalogue yet"
  })

  const right = v.sets.length
    ? v.sets.map(s => setCard(s)).join("")
    : card({
      head: { icon: artIcon("trophy", 24), title: "Sets" },
      body: emptyState("No set rows yet", "The game has not pushed its set rows, so there is no set progress to show.")
    })

  const body = `${hero}
<div class="v2w-cols">
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${bookCard(v)}</div>
  <div style="display:grid;gap:clamp(10px,1.1vw,18px)">${right}</div>
</div>
<div class="v2w-strip">${collectedCard(v)}${setsCard(v)}${tallyCard(v)}</div>
<p class="v2w-note">Every count on this page comes from the player's ornament mirror and the catalogue the game pushed. The panel shows the book; it cannot grant, sell or reveal an ornament.</p>`

  return winterPage({
    title: "Ornament Collection",
    active: "",
    tab: "ornaments",
    ctx,
    content: body,
    extraCss: ORN_CSS
  })
}
