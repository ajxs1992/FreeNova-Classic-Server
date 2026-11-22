"""Slice FreeNova icon pack sheets with connected-component blobs."""
from pathlib import Path
from PIL import Image
import json

ROOT = Path(r"C:\Users\conts\Desktop\.,\FREENOVA System")
ASSETS = ROOT / "web-panel" / "assets"
CACHE = Path(r"C:\Users\conts\AppData\Local\Temp\opencode\icon-cache")
MOTD_BG = (13, 15, 14)
PREVIEW = CACHE / "sheet_12.png"
BLACK = CACHE / "sheet_11.png"


def flatten(im, size=96):
    # Fixed 2026-10-10: preserve transparency + 8px breathing room.
    # Old version baked opaque RGB on MOTD_BG with 4px margins (trimmed look).
    im = im.convert("RGBA")
    pix = im.load()
    w, h = im.size

    def is_bg(x, y):
        r, g, b, a = pix[x, y]
        if a < 18:
            return True
        return abs(r - MOTD_BG[0]) < 12 and abs(g - MOTD_BG[1]) < 12 and abs(b - MOTD_BG[2]) < 12

    minx, miny, maxx, maxy = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            if not is_bg(x, y):
                found = True
                if x < minx: minx = x
                if y < miny: miny = y
                if x > maxx: maxx = x
                if y > maxy: maxy = y
    if not found:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = max(8, int(0.12 * max(maxx - minx + 1, maxy - miny + 1)))
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad)
    maxy = min(h - 1, maxy + pad)
    crop = im.crop((minx, miny, maxx + 1, maxy + 1))
    cw, ch = crop.size
    scale = min((size - 16) / cw, (size - 16) / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(crop, ((size - nw) // 2, (size - nh) // 2)) if crop.mode == "RGBA" else canvas.paste(crop, ((size - nw) // 2, (size - nh) // 2))
    return canvas


def is_icon_pixel_preview(r, g, b, a):
    if a < 18:
        return False
    L = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = max(r, g, b) - min(r, g, b)
    # skip light gray panel
    if sat < 18 and L > 145:
        return False
    # skip dark header bars
    if L < 35 and sat < 20:
        return False
    return sat > 22 or (L > 40 and L < 230)


def is_icon_pixel_black(r, g, b, a):
    if a < 18:
        return False
    L = 0.2126 * r + 0.7152 * g + 0.0722 * b
    sat = max(r, g, b) - min(r, g, b)
    if L < 22 and sat < 18:
        return False
    # skip the yellow-green haze between clusters
    if 70 < L < 160 and 20 < sat < 55 and g > r and g > b:
        return False
    return sat > 28 or L > 45


def blobs(im, mode="preview", min_area=380, max_area=28000, min_side=16, max_side=160, max_ar=2.3):
    rgba = im.convert("RGBA")
    w, h = rgba.size
    pix = rgba.load()
    test = is_icon_pixel_preview if mode == "preview" else is_icon_pixel_black
    mask = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b, a = pix[x, y]
            if test(r, g, b, a):
                mask[row + x] = 1
    seen = bytearray(w * h)
    out = []
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for y in range(h):
        row = y * w
        for x in range(w):
            i = row + x
            if not mask[i] or seen[i]:
                continue
            stack = [i]
            seen[i] = 1
            minx = maxx = x
            miny = maxy = y
            area = 0
            while stack:
                ci = stack.pop()
                cx = ci % w
                cy = ci // w
                area += 1
                if cx < minx: minx = cx
                if cy < miny: miny = cy
                if cx > maxx: maxx = cx
                if cy > maxy: maxy = cy
                for dx, dy in dirs:
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    ni = ny * w + nx
                    if mask[ni] and not seen[ni]:
                        seen[ni] = 1
                        stack.append(ni)
            bw = maxx - minx + 1
            bh = maxy - miny + 1
            ar = bw / max(1, bh)
            if area < min_area or area > max_area:
                continue
            if bw < min_side or bh < min_side or bw > max_side or bh > max_side:
                continue
            if ar > max_ar or ar < 1 / max_ar:
                continue
            pad = 8
            crop = rgba.crop((
                max(0, minx - pad), max(0, miny - pad),
                min(w, maxx + 1 + pad), min(h, maxy + 1 + pad)
            ))
            out.append((miny, minx, crop, area, bw, bh))
    out.sort(key=lambda t: (t[0] // 28, t[1]))
    return [t[2] for t in out]


def save_list(images, dest_dir, names):
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    if len(images) < len(names):
        raise SystemExit(
            f"save_list: only {len(images)} images for {len(names)} names "
            f"in {dest_dir} — refusing wrap-copy (would duplicate icons). "
            f"Supply distinct art or placeholders."
        )
    n = 0
    for i, name in enumerate(names):
        flatten(images[i]).save(dest_dir / name, "PNG")
        n += 1
    return n, len(images)


def crop_box(im, box):
    return im.crop(box)


def main():
    preview = Image.open(PREVIEW)
    black = Image.open(BLACK)
    W, H = preview.size
    print("preview", W, H, "black", black.size)

    panels = {
        "logo": (18, 70, 250, 330),
        "ranks": (255, 48, 795, 335),
        "missions": (800, 48, 1168, 335),
        "bp": (1172, 48, 1528, 335),
        "free": (14, 355, 565, 645),
        "medals": (568, 355, 1045, 645),
        "badges": (1048, 355, 1528, 645),
        "cats": (14, 665, 305, 905),
        "events": (308, 665, 525, 905),
        "skills": (528, 665, 865, 905),
        "guns": (868, 665, 1225, 905),
        "trophies": (1228, 665, 1528, 805),
        "models": (1228, 805, 1528, 935),
    }

    extracted = {}
    for key, box in panels.items():
        region = crop_box(preview, box)
        imgs = blobs(region, "preview")
        extracted[key] = imgs
        print(f"preview {key:10s} {len(imgs):3d}  box={box} region={region.size}")

    black_panels = {
        "logo": (8, 8, 230, 230),
        "ranks_row1": (230, 8, 1185, 115),
        "ranks_row2": (230, 115, 1185, 230),
        "trophies": (1185, 8, 1530, 230),
        "missions": (8, 220, 760, 510),
        "bp": (760, 220, 1530, 510),
        "free": (8, 500, 760, 755),
        "skills": (760, 500, 1110, 755),
        "guns": (1110, 500, 1530, 920),
        "medals": (8, 745, 900, 1020),
        "models": (900, 745, 1210, 1020),
        "star": (1210, 745, 1365, 940),
        "events": (1365, 745, 1530, 940),
    }
    black_ex = {}
    for key, box in black_panels.items():
        region = crop_box(black, box)
        imgs = blobs(region, "black", min_area=280, max_side=180)
        black_ex[key] = imgs
        print(f"black   {key:12s} {len(imgs):3d}")

    report = {}
    ASSETS.mkdir(parents=True, exist_ok=True)

    logo_src = extracted["logo"][0] if extracted["logo"] else black_ex["logo"][0]
    flatten(logo_src, 128).save(ASSETS / "logo.png")
    report["logo"] = 1

    ranks = extracted["ranks"]
    if len(ranks) < 19:
        ranks = black_ex["ranks_row1"] + black_ex["ranks_row2"]
    n, t = save_list(ranks, ASSETS / "ranks", [f"rank_{i:02d}.png" for i in range(1, 20)])
    report["ranks"] = {"saved": n, "found": t}

    msn = extracted["missions"]
    if len(msn) < 19:
        msn = black_ex["missions"]
    n, t = save_list(msn, ASSETS / "missions", [f"msn_{i:02d}.png" for i in range(1, 20)])
    report["missions"] = {"saved": n, "found": t}

    skill_names = [
        "skill_multi_jump.png", "skill_spawn_hp.png", "skill_spawn_armor.png",
        "skill_vampire.png", "skill_nimble.png", "skill_featherfall.png",
        "skill_healthnade.png", "skill_fast_sniper.png", "skill_revive.png",
        "skill_laststand.png", "skill_parachute.png", "skill_awp_unlock.png",
        "skill_chat_color.png"
    ]
    skills = extracted["skills"]
    if len(skills) < 13:
        skills = black_ex["skills"]
    n, t = save_list(skills, ASSETS / "bp", skill_names)
    report["skills"] = {"saved": n, "found": t}

    gun_keys = [
        "ak47", "m4a1", "awp", "deagle", "knife", "usp", "glock",
        "famas", "galil", "scout", "aug", "sg552", "mp5", "p90", "ump",
        "mac10", "tmp", "m249", "m3", "xm1014", "sg550", "g3sg1", "he"
    ]
    guns = extracted["guns"]
    if len(guns) < 23:
        guns = black_ex["guns"]
    n, t = save_list(guns, ASSETS / "i", [f"gun_{k}.png" for k in gun_keys])
    report["guns"] = {"saved": n, "found": t}

    trophies = extracted["trophies"] if len(extracted["trophies"]) >= 3 else black_ex["trophies"]
    n, t = save_list(trophies, ASSETS / "i", ["trophy_1.png", "trophy_2.png", "trophy_3.png"])
    report["trophies"] = {"saved": n, "found": t}

    models = extracted["models"] if len(extracted["models"]) >= 4 else black_ex["models"]
    n, t = save_list(models, ASSETS / "i", [
        "model_vip_ct.png", "model_vip_tero.png", "model_legend_ct.png", "model_legend_t.png"
    ])
    report["models"] = {"saved": n, "found": t}

    cat_names = [
        "cat_combat.png", "cat_weapons.png", "cat_competitive.png", "cat_clutches.png",
        "cat_maps.png", "cat_progression.png", "cat_activity.png", "cat_special.png", "cat_secret.png"
    ]
    n, t = save_list(extracted["cats"], ASSETS / "medals", cat_names)
    report["cats"] = {"saved": n, "found": t}

    events = extracted["events"] if len(extracted["events"]) >= 3 else black_ex["events"]
    n, t = save_list(events, ASSETS / "medals", [
        "event_kill_race.png", "event_hs_frenzy.png", "event_objective.png"
    ])
    report["events"] = {"saved": n, "found": t}

    n, t = save_list(extracted["badges"], ASSETS / "medals", [f"fn_badge_{i:02d}.png" for i in range(1, 33)])
    report["badges"] = {"saved": n, "found": t}

    star_imgs = black_ex.get("star") or []
    if star_imgs:
        flatten(star_imgs[0]).save(ASSETS / "bp" / "star.png")
        report["star"] = 1
    elif len(ranks) >= 8:
        flatten(ranks[7]).save(ASSETS / "bp" / "star.png")
        report["star"] = "rank_08"

    prem = extracted["bp"]
    if len(prem) < 60:
        # Do NOT wrap-copy head to fill 60 (old code made prem_42.. dupes of prem_01..).
        # Fail loudly so distinct art gets supplied.
        if len(prem) < 30 and black_ex.get("bp"):
            prem = prem + black_ex["bp"]
    n, t = save_list(prem[:60], ASSETS / "bp", [f"prem_{i:02d}.png" for i in range(1, 61)])
    report["prem"] = {"saved": n, "found": t}

    free = extracted["free"]
    if len(free) < 60:
        if len(free) < 30 and black_ex.get("free"):
            free = free + black_ex["free"]
    n, t = save_list(free[:60], ASSETS / "bp", [f"free_{i:02d}.png" for i in range(1, 61)])
    report["free"] = {"saved": n, "found": t}

    medals = extracted["medals"] + black_ex["medals"]
    showcase = [
        "fn_kills_100.png", "fn_kills_1000.png", "fn_kills_5000.png", "fn_kills_10000.png",
        "fn_hs_100.png", "fn_hs_500.png", "fn_wins_100.png", "fn_mvp_50.png",
        "fn_hours_100.png", "fn_hours_500.png", "fn_rank_max.png", "fn_ak_spec.png", "fn_ak_master.png"
    ]
    ach = [
        "fn_first_blood.png", "fn_headhunter_1.png", "fn_headhunter_2.png", "fn_headhunter_3.png",
        "fn_kill_machine_1.png", "fn_kill_machine_2.png", "fn_rampage.png", "fn_ace_master.png",
        "fn_damage_dealer.png", "fn_ak47_specialist.png", "fn_m4a1_operative.png", "fn_awp_god.png",
        "fn_deagle_artist.png", "fn_ninja_blade.png", "fn_he_maestro.png", "fn_scout_elite.png",
        "fn_comp_ladder.png", "fn_comp_master.png", "fn_win_streak_10.png", "fn_mvp_magnet.png",
        "fn_bomb_specialist.png", "fn_defusal_angel.png", "fn_clutch_1v1.png", "fn_clutch_1v2.png",
        "fn_clutch_1v3.png", "fn_clutch_1v4.png", "fn_clutch_1v5.png", "fn_map_dust2.png",
        "fn_map_inferno.png", "fn_map_nuke.png", "fn_map_mirage.png", "fn_level_25.png",
        "fn_level_52.png", "fn_coin_tycoon.png", "fn_skill_master.png", "fn_playtime_100h.png",
        "fn_daily_streaker.png", "fn_weekly_conqueror.png", "fn_comeback_kings.png",
        "fn_flawless_half.png", "fn_collector.png", "fn_knife_the_awp.png", "fn_one_hp_survivor.png",
        "fn_smoke_defuse.png"
    ]
    # Fixed 2026-10-10: showcase + ach shared medals[0:13] (13 byte-identical dupes).
    # Showcase keeps medals[0:13]; achievements must use DISTINCT art starting at index 13.
    # Requires at least 13 + 44 = 57 distinct medal blobs, else fail loudly (no silent dupes).
    if len(medals) < 57:
        raise SystemExit(
            f"medals: only {len(medals)} distinct blobs for 13 showcase + 44 achievements "
            f"(need 57). Supply distinct art — refusing to duplicate."
        )
    n1, t1 = save_list(medals[:13], ASSETS / "medals", showcase)
    n2, t2 = save_list(medals[13:13+len(ach)], ASSETS / "medals", ach)
    report["showcase"] = {"saved": n1, "found": t1}
    report["achievements"] = {"saved": n2, "found": len(medals)}

    (ASSETS / "icon_pack_extract_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
