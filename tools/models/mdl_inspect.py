#!/usr/bin/env python3
"""Inspect a GoldSrc studio model (IDST version 10).

Read-only reference tool for tools/models/.  It exists so that
`tools/models/mdlwrite.py` can be validated against models the engine is
already known to load: parse a shipped .mdl, re-emit it, and compare.

usage: mdl_inspect.py path/to/model.mdl [--dump-verts]

Struct layouts are taken verbatim from the engine header that actually loads
these files on FreeNova (`hlsdk/engine/studio.h`, studiohdr_t v10).
"""
import math
import struct
import sys

# ---------------------------------------------------------------- struct sizes
HDR_FIELDS = [
    "flags", "numbones", "boneindex",
    "numbonecontrollers", "bonecontrollerindex",
    "numhitboxes", "hitboxindex",
    "numseq", "seqindex",
    "numseqgroups", "seqgroupindex",
    "numtextures", "textureindex", "texturedataindex",
    "numskinref", "numskinfamilies", "skinindex",
    "numbodyparts", "bodypartindex",
    "numattachments", "attachmentindex",
    "soundtable", "soundindex", "soundgroups", "soundgroupindex",
    "numtransitions", "transitionindex",
]
SIZEOF_HEADER = 244          # 4 + 4 + 64 + 4 + 5*12 + 27*4
SIZEOF_BONE = 112            # name[32] parent flags bonecontroller[6] value[6] scale[6]
SIZEOF_BBOX = 32             # bone group bbmin bbmax
SIZEOF_SEQDESC = 176
SIZEOF_SEQGROUP = 104        # label[32] name[64] unused1 unused2
SIZEOF_BODYPART = 76         # name[64] nummodels base modelindex
SIZEOF_MODEL = 112           # name[64] type radius + 10 ints
SIZEOF_MESH = 20             # numtris triindex skinref numnorms normindex
SIZEOF_TEXTURE = 80          # name[64] flags width height index
SIZEOF_TRIVERT = 8           # short vertindex, normindex, s, t


def _cstr(buf, off, n):
    raw = buf[off:off + n]
    return raw.split(b"\0")[0].decode("latin1")


class Mdl:
    def __init__(self, path):
        self.path = path
        self.data = d = open(path, "rb").read()
        self.header = h = {}
        (ident, version) = struct.unpack_from("<ii", d, 0)
        h["ident"] = ident
        h["version"] = version
        h["name"] = _cstr(d, 8, 64)
        h["length"] = struct.unpack_from("<i", d, 72)[0]
        h["eyeposition"] = struct.unpack_from("<3f", d, 76)
        h["min"] = struct.unpack_from("<3f", d, 88)
        h["max"] = struct.unpack_from("<3f", d, 100)
        h["bbmin"] = struct.unpack_from("<3f", d, 112)
        h["bbmax"] = struct.unpack_from("<3f", d, 124)
        for n, f in enumerate(HDR_FIELDS):
            h[f] = struct.unpack_from("<i", d, 136 + n * 4)[0]

    # ------------------------------------------------------------------ pieces
    def bones(self):
        out = []
        base = self.header["boneindex"]
        for n in range(self.header["numbones"]):
            o = base + n * SIZEOF_BONE
            out.append(dict(
                name=_cstr(self.data, o, 32),
                parent=struct.unpack_from("<i", self.data, o + 32)[0],
                flags=struct.unpack_from("<i", self.data, o + 36)[0],
                bonecontroller=struct.unpack_from("<6i", self.data, o + 40),
                value=struct.unpack_from("<6f", self.data, o + 64),
                scale=struct.unpack_from("<6f", self.data, o + 88),
            ))
        return out

    def hitboxes(self):
        out = []
        base = self.header["hitboxindex"]
        for n in range(self.header["numhitboxes"]):
            o = base + n * SIZEOF_BBOX
            out.append(dict(
                bone=struct.unpack_from("<i", self.data, o)[0],
                group=struct.unpack_from("<i", self.data, o + 4)[0],
                bbmin=struct.unpack_from("<3f", self.data, o + 8),
                bbmax=struct.unpack_from("<3f", self.data, o + 20),
            ))
        return out

    def sequences(self):
        out = []
        base = self.header["seqindex"]
        for n in range(self.header["numseq"]):
            o = base + n * SIZEOF_SEQDESC
            d = self.data
            out.append(dict(
                label=_cstr(d, o, 32),
                fps=struct.unpack_from("<f", d, o + 32)[0],
                flags=struct.unpack_from("<i", d, o + 36)[0],
                activity=struct.unpack_from("<i", d, o + 40)[0],
                actweight=struct.unpack_from("<i", d, o + 44)[0],
                numevents=struct.unpack_from("<i", d, o + 48)[0],
                eventindex=struct.unpack_from("<i", d, o + 52)[0],
                numframes=struct.unpack_from("<i", d, o + 56)[0],
                numpivots=struct.unpack_from("<i", d, o + 60)[0],
                pivotindex=struct.unpack_from("<i", d, o + 64)[0],
                motiontype=struct.unpack_from("<i", d, o + 68)[0],
                motionbone=struct.unpack_from("<i", d, o + 72)[0],
                linearmovement=struct.unpack_from("<3f", d, o + 76),
                bbmin=struct.unpack_from("<3f", d, o + 96),
                bbmax=struct.unpack_from("<3f", d, o + 108),
                numblends=struct.unpack_from("<i", d, o + 120)[0],
                animindex=struct.unpack_from("<i", d, o + 124)[0],
                blendtype=struct.unpack_from("<2i", d, o + 128),
                blendstart=struct.unpack_from("<2f", d, o + 136),
                blendend=struct.unpack_from("<2f", d, o + 144),
                blendparent=struct.unpack_from("<i", d, o + 152)[0],
                seqgroup=struct.unpack_from("<i", d, o + 156)[0],
                entrynode=struct.unpack_from("<i", d, o + 160)[0],
                exitnode=struct.unpack_from("<i", d, o + 164)[0],
                nodeflags=struct.unpack_from("<i", d, o + 168)[0],
                nextseq=struct.unpack_from("<i", d, o + 172)[0],
                _offset=o,
            ))
        return out

    def seqgroups(self):
        out = []
        base = self.header["seqgroupindex"]
        for n in range(self.header["numseqgroups"]):
            o = base + n * SIZEOF_SEQGROUP
            out.append(dict(
                label=_cstr(self.data, o, 32),
                name=_cstr(self.data, o + 32, 64),
                unused1=struct.unpack_from("<i", self.data, o + 96)[0],
                unused2=struct.unpack_from("<i", self.data, o + 100)[0],
                _offset=o,
            ))
        return out

    def textures(self):
        out = []
        base = self.header["textureindex"]
        for n in range(self.header["numtextures"]):
            o = base + n * SIZEOF_TEXTURE
            out.append(dict(
                name=_cstr(self.data, o, 64),
                flags=struct.unpack_from("<i", self.data, o + 64)[0],
                width=struct.unpack_from("<i", self.data, o + 68)[0],
                height=struct.unpack_from("<i", self.data, o + 72)[0],
                index=struct.unpack_from("<i", self.data, o + 76)[0],
                _offset=o,
            ))
        return out

    def skinrefs(self):
        h = self.header
        n = h["numskinref"] * h["numskinfamilies"]
        return list(struct.unpack_from("<%dh" % n, self.data, h["skinindex"]))

    def bodyparts(self):
        out = []
        base = self.header["bodypartindex"]
        for n in range(self.header["numbodyparts"]):
            o = base + n * SIZEOF_BODYPART
            out.append(dict(
                name=_cstr(self.data, o, 64),
                nummodels=struct.unpack_from("<i", self.data, o + 64)[0],
                base=struct.unpack_from("<i", self.data, o + 68)[0],
                modelindex=struct.unpack_from("<i", self.data, o + 72)[0],
                _offset=o,
            ))
        return out

    def models(self, bp, relative_to="file"):
        """bp: one dict from bodyparts().  studiomdl writes every offset after
        the header as a file-absolute offset: on a shipped model, bodypart
        modelindex 760 lands exactly at bodypart_offset + sizeof(bodypart), and
        model.meshindex lands exactly where the vertex/normal arrays end.  The
        "bodypart" mode is kept only to show that the relative reading is wrong."""
        base = {"file": 0, "bodypart": bp["_offset"]}[relative_to]
        out = []
        o = base + bp["modelindex"]
        for n in range(bp["nummodels"]):
            m = dict(
                name=_cstr(self.data, o, 64),
                type=struct.unpack_from("<i", self.data, o + 64)[0],
                boundingradius=struct.unpack_from("<f", self.data, o + 68)[0],
                nummesh=struct.unpack_from("<i", self.data, o + 72)[0],
                meshindex=struct.unpack_from("<i", self.data, o + 76)[0],
                numverts=struct.unpack_from("<i", self.data, o + 80)[0],
                vertinfoindex=struct.unpack_from("<i", self.data, o + 84)[0],
                vertindex=struct.unpack_from("<i", self.data, o + 88)[0],
                numnorms=struct.unpack_from("<i", self.data, o + 92)[0],
                norminfoindex=struct.unpack_from("<i", self.data, o + 96)[0],
                normindex=struct.unpack_from("<i", self.data, o + 100)[0],
                numgroups=struct.unpack_from("<i", self.data, o + 104)[0],
                groupindex=struct.unpack_from("<i", self.data, o + 108)[0],
                _offset=o,
            )
            m["meshes"] = self.meshes(m)
            m["verts"] = [struct.unpack_from("<3f", self.data, m["vertindex"] + k * 12)
                          for k in range(m["numverts"])]
            m["vertinfo"] = list(self.data[m["vertinfoindex"]:
                                           m["vertinfoindex"] + m["numverts"]])
            m["normals"] = [struct.unpack_from("<3f", self.data, m["normindex"] + k * 12)
                            for k in range(m["numnorms"])]
            out.append(m)
            o += SIZEOF_MODEL
        return out

    def meshes(self, model):
        out = []
        o = model["meshindex"]
        for n in range(model["nummesh"]):
            me = dict(
                numtris=struct.unpack_from("<i", self.data, o)[0],
                triindex=struct.unpack_from("<i", self.data, o + 4)[0],
                skinref=struct.unpack_from("<i", self.data, o + 8)[0],
                numnorms=struct.unpack_from("<i", self.data, o + 12)[0],
                normindex=struct.unpack_from("<i", self.data, o + 16)[0],
                _offset=o,
            )
            t = me["triindex"]
            me["tris"] = [struct.unpack_from("<4h", self.data, t + k * SIZEOF_TRIVERT)
                          for k in range(me["numtris"] * 3)]
            out.append(me)
            o += SIZEOF_MESH
        return out

    def tricommands(self, mesh):
        """The triangle *command* stream at mesh.triindex, not raw triverts.

        studiomdl stores the strip/fan the renderer will replay: a run of
        int16s, a positive count meaning TRI_STRIP and a negative one TRI_FAN,
        followed by (vertindex, normindex, s, t) per vertex, terminated by 0.
        Knowing this is what let the winding of a compiled model be checked
        against a shipped one - see `winding()`.
        """
        o = mesh["triindex"]
        out = []
        while True:
            n = struct.unpack_from("<h", self.data, o)[0]
            o += 2
            if n == 0:
                break
            fan = n < 0
            cnt = abs(n)
            vs = [struct.unpack_from("<4h", self.data, o + k * 8) for k in range(cnt)]
            o += cnt * 8
            for k in range(cnt - 2):
                if fan:
                    tri = (vs[0], vs[k + 1], vs[k + 2])
                elif k % 2 == 0:
                    tri = (vs[k], vs[k + 1], vs[k + 2])
                else:                        # strips alternate their winding
                    tri = (vs[k + 1], vs[k], vs[k + 2])
                out.append(tri)
        return out

    def winding(self, model, mesh):
        """(clockwise, counter_clockwise, degenerate) triangle counts.

        `cross(v1-v0, v2-v0) . normal` is negative for a triangle wound
        clockwise as seen from outside - which is what GoldSrc models are, and
        what a model compiled from a counter-clockwise SMD comes out as.
        """
        verts, norms = model["verts"], model["normals"]
        cw = ccw = flat = 0
        for a, b, c in self.tricommands(mesh):
            if max(a[0], b[0], c[0]) >= len(verts) or a[1] >= len(norms):
                continue
            pa, pb, pc = verts[a[0]], verts[b[0]], verts[c[0]]
            e1 = [pb[k] - pa[k] for k in range(3)]
            e2 = [pc[k] - pa[k] for k in range(3)]
            sn = [e1[1] * e2[2] - e1[2] * e2[1],
                  e1[2] * e2[0] - e1[0] * e2[2],
                  e1[0] * e2[1] - e1[1] * e2[0]]
            ln = math.sqrt(sum(x * x for x in sn)) or 1.0
            n = norms[a[1]]
            dot = sum(sn[k] / ln * n[k] for k in range(3))
            if dot < -0.1:
                cw += 1
            elif dot > 0.1:
                ccw += 1
            else:
                flat += 1
        return cw, ccw, flat

    def anim_raw(self):
        """Where the sequence-group-0 anim data actually landed."""
        seqs = self.sequences()
        groups = self.seqgroups()
        hint = []
        for s in seqs:
            hint.append((s["label"], s["animindex"],
                         s["_offset"] + s["animindex"],
                         groups[s["seqgroup"]]["_offset"] + s["animindex"]))
        return hint


def report(path, dump_verts=False):
    m = Mdl(path)
    h = m.header
    print(f"== {path} ==")
    print(f"   ident={h['ident']:#x} version={h['version']} length={h['length']} "
          f"name={h['name']!r}")
    print(f"   bb {h['bbmin']} .. {h['bbmax']}")
    print(f"   bones={h['numbones']}@{h['boneindex']} "
          f"hitboxes={h['numhitboxes']}@{h['hitboxindex']} "
          f"seq={h['numseq']}@{h['seqindex']} "
          f"seqgroups={h['numseqgroups']}@{h['seqgroupindex']} "
          f"tex={h['numtextures']}@{h['textureindex']} "
          f"skinref={h['numskinref']}@{h['skinindex']} "
          f"texdata@{h['texturedataindex']} "
          f"bodyparts={h['numbodyparts']}@{h['bodypartindex']}")
    for b in m.bones():
        print(f"   bone {b['name']!r} parent={b['parent']} flags={b['flags']}")
        print(f"        value={tuple(round(v, 6) for v in b['value'])}")
        print(f"        scale={tuple(round(v, 6) for v in b['scale'])}")
    for hb in m.hitboxes():
        print(f"   hitbox bone={hb['bone']} {hb['bbmin']} .. {hb['bbmax']}")
    for s in m.sequences():
        print(f"   seq {s['label']!r} fps={s['fps']} frames={s['numframes']} "
              f"blends={s['numblends']} animindex={s['animindex']} "
              f"group={s['seqgroup']}")
    for g in m.seqgroups():
        print(f"   seqgroup {g['label']!r} name={g['name']!r} @{g['_offset']}")
    print(f"   anim offsets (seqdesc+idx, group+idx): {m.anim_raw()}")
    for t in m.textures():
        print(f"   texture {t['name']!r} flags={t['flags']} "
              f"{t['width']}x{t['height']} data@{t['index']}")
        payload = m.data[t["index"]:t["index"] + 4]
        print(f"        payload magic {payload.hex()}")
    print(f"   skinrefs {m.skinrefs()}")
    for bp in m.bodyparts():
        print(f"   bodypart {bp['name']!r} nummodels={bp['nummodels']} "
              f"base={bp['base']} modelindex={bp['modelindex']} @{bp['_offset']}")
        for rel in ("file", "bodypart"):
            try:
                mm = m.models(bp, relative_to=rel)[0]
            except struct.error:
                print(f"      [{rel}] <out of range>")
                continue
            print(f"      [{rel}] model @{mm['_offset']} name={mm['name']!r} "
                  f"mesh={mm['nummesh']} verts={mm['numverts']} "
                  f"norms={mm['numnorms']}")
            for me in mm["meshes"]:
                print(f"          mesh @{me['_offset']} tris={me['numtris']} "
                      f"skinref={me['skinref']} norms={me['numnorms']}")
                cw, ccw, flat = m.winding(mm, me)
                verdict = "clockwise (GoldSrc)" if cw >= ccw else "COUNTER-clockwise (inside out)"
                print(f"          winding: cw={cw} ccw={ccw} flat={flat} -> {verdict}")
    if dump_verts:
        for bp in m.bodyparts():
            for rel in ("file", "bodypart"):
                try:
                    mm = m.models(bp, relative_to=rel)[0]
                    print(f"   verts[{rel}]: {mm['verts'][:8]}")
                except struct.error:
                    pass


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    report(sys.argv[1], dump_verts="--dump-verts" in sys.argv)
