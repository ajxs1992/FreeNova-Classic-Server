# Art rule (owner, 2026-11-22) — the references are the only source

> "Use exactly the photos I provided — just put them there and make them
> functional. Do NOT make anything by itself."

## The rule
1. **Every picture in the panel is a rectangle cut out of the owner's reference
   images** in `docs/design/refs/winterfest/`. Cut at native pixel size. Never
   upscale, never recolour, never "improve", never redraw.
2. **Nothing is generated.** No AI images, no drawn SVG stand-ins for pictures,
   no substitute art. If the reference does not contain an element, the page
   shows text or nothing, and the gap is reported — it is not filled by
   invention.
3. **The layout follows the reference**, because the art now literally *is* the
   reference: an element gets the same box the mockup gives it.
4. Code-drawn things stay code: borders, shadows, gradients, progress bars, tab
   underlines, the wheel's sectors, check marks. The rule is about *pictures*.
5. Every cut is recorded in `web-panel/assets/winter/ref/MANIFEST.json` with its
   source file and x/y/w/h, so any piece can be traced back to the plate it came
   from.

## Generated assets: retired
`wf-hero.png`, `wf-santa.png`, `wf-tree.png`, `advent-house-a/b.png`,
`advent-gift.png`, `advent-pass.png` and `icons/*.png` were produced by an image
model before this rule. They move to `web-panel/assets/winter/_generated_unused/`
and are not referenced by any page. The directory stays only as a record of what
was tried; it is not shipped and can be deleted once the owner says so.

## Tooling
`tools/art/slice_refs.py` — the only art tool. `--list` prints the region table,
`--check` verifies every region fits inside its source image.
