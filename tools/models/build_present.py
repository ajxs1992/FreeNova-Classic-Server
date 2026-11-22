#!/usr/bin/env python3
"""Build the Winterfest present prop from scratch.

This is the *source of truth* for the model: run it through Blender's Python and
it regenerates every artefact, so nothing in tools/models/present.blend is ever
hand-edited.

    blender -b -P tools/models/build_present.py -- [--out DIR]

Artefacts written next to this script (or into --out):
    present.blend      the scene, for a human to look at / tweak and re-run
    present.smd        GoldSrc reference SMD: version 1, one `root` bone,
                       flat-shaded triangles with normals + UVs
    present.bmp        128x128 8-bit paletted BMP: paper, ribbon and bow colours
    preview_3q.png     three-quarter render (how it reads in game)
    preview_front.png  front render

Geometry, in engine units (1 unit ~ 1 inch):
    box     24 x 24 x 20, sitting on z = 0
    ribbon  two 6-unit bands, one per axis, 0.3 proud of the paper;
            the Y-axis band rides 0.3 over the X-axis band so they do not
            z-fight where they cross
    bow     knot + two flattened loops + two tails, 20.6 .. ~24.6

Everything is generated from python lists (verts / quads / uv rects) so the
`.blend`, the SMD and the previews can never disagree with each other.
"""
import math
import os
import struct
import sys

import bpy

# --------------------------------------------------------------------------- #
# arguments
# --------------------------------------------------------------------------- #
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = HERE
for n, a in enumerate(argv):
    if a == "--out" and n + 1 < len(argv):
        OUT = os.path.abspath(argv[n + 1])
os.makedirs(OUT, exist_ok=True)

SMD_NAME = "present.smd"
BMP_NAME = "present.bmp"
BLEND_NAME = "present.blend"
TEX_SIZE = 128

# --------------------------------------------------------------------------- #
# 1. texture regions
#
# One 128x128 texture, three vertical bands.  Every face's UVs are placed inside
# one band, which is what lets a single material carry paper + ribbon + bow.
# (u0, v0, u1, v1) - v is measured from the *top* here and flipped for the BMP.
# --------------------------------------------------------------------------- #
PAPER = (0.020, 0.060, 0.460, 0.940)
RIBBON = (0.520, 0.060, 0.720, 0.940)
BOW = (0.760, 0.060, 0.980, 0.940)

PAPER_RGB = (172, 26, 40)      # deep Christmas red
RIBBON_RGB = (208, 156, 44)    # gold
BOW_RGB = (240, 208, 138)      # pale gold, one step lighter than the ribbon


def build_bmp(path):
    """A 128x128 8-bit paletted BMP: paper, ribbon, bow, plus a little weave."""
    pixels = bytearray(TEX_SIZE * TEX_SIZE)
    # palette index -> rgb
    pal = [PAPER_RGB, RIBBON_RGB, BOW_RGB,
           (150, 20, 34), (232, 196, 116), (252, 242, 214),
           (196, 210, 226), (255, 255, 255)]
    x0 = int(0.50 * TEX_SIZE)   # paper  : 0 .. 64
    x1 = int(0.74 * TEX_SIZE)   # ribbon : 64 .. 94
    for y in range(TEX_SIZE):
        for x in range(TEX_SIZE):
            if x < x0:
                # paper: a faint woven cross every 8 px, plus snow dots
                v = 0
                if x % 8 == 0 or y % 8 == 0:
                    v = 3
                if (x * 7 + y * 13) % 37 == 0:
                    v = 6
                pixels[y * TEX_SIZE + x] = v
            elif x < x1:
                # ribbon: a vertical sheen gradient so it reads as silk
                band = (x - x0) / max(1, (x1 - x0))
                v = 1 if 0.25 < band < 0.75 else 4
                if y % 16 < 2:
                    v = 4
                pixels[y * TEX_SIZE + x] = v
            else:
                # bow: cream with a soft inner shading band
                band = (x - x1) / max(1, (TEX_SIZE - x1))
                v = 2 if 0.2 < band < 0.85 else 5
                pixels[y * TEX_SIZE + x] = v
    with open(path, "wb") as f:
        # BITMAPINFOHEADER, 8bpp, bottom-up, 4-byte aligned rows
        row = (TEX_SIZE + 3) & ~3
        datasize = row * TEX_SIZE
        palbytes = 256 * 4
        offset = 14 + 40 + palbytes
        filesize = offset + datasize
        f.write(b"BM" + struct.pack("<IHHI", filesize, 0, 0, offset))
        f.write(struct.pack("<IiiHHIIiiII", 40, TEX_SIZE, TEX_SIZE, 1, 8, 0,
                            datasize, 2835, 2835, 256, 256))
        for n in range(256):
            r, g, b = pal[n] if n < len(pal) else (0, 0, 0)
            f.write(struct.pack("<BBBB", b, g, r, 0))
        # BMP rows are bottom-up: v = 0 is the bottom row of the image
        for y in range(TEX_SIZE - 1, -1, -1):
            f.write(bytes(pixels[y * TEX_SIZE:(y + 1) * TEX_SIZE]))
            f.write(b"\0" * (row - TEX_SIZE))


# --------------------------------------------------------------------------- #
# 2. geometry
# --------------------------------------------------------------------------- #
class Mesh:
    """verts + faces + per-face UV rectangle, all in engine units."""

    def __init__(self):
        self.verts = []          # list of (x, y, z)
        self.faces = []          # list of (tuple_of_indices, rect)

    def _v(self, p):
        self.verts.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.verts) - 1

    @staticmethod
    def _normal(p0, p1, p2):
        ab = [p1[k] - p0[k] for k in range(3)]
        ac = [p2[k] - p0[k] for k in range(3)]
        n = (ab[1] * ac[2] - ab[2] * ac[1],
             ab[2] * ac[0] - ab[0] * ac[2],
             ab[0] * ac[1] - ab[1] * ac[0])
        ln = math.sqrt(sum(x * x for x in n)) or 1.0
        return tuple(x / ln for x in n)

    def quad(self, p0, p1, p2, p3, rect, outward=None):
        """Add a quad.  `outward` is a point (or direction) the face should
        point away from; the winding is flipped to match, so every generated
        face ends up with an outward normal and the SMD writer can trust it."""
        if outward is not None:
            n = self._normal(p0, p1, p2)
            mid = [sum(p[k] for p in (p0, p1, p2, p3)) / 4.0 for k in range(3)]
            ref = [mid[k] - outward[k] for k in range(3)]
            if sum(n[k] * ref[k] for k in range(3)) < 0:
                p0, p1, p2, p3 = p3, p2, p1, p0
        i = [self._v(p) for p in (p0, p1, p2, p3)]
        self.faces.append((i, rect))

    def box(self, cx, cy, cz, sx, sy, sz, rect):
        x0, x1 = cx - sx / 2.0, cx + sx / 2.0
        y0, y1 = cy - sy / 2.0, cy + sy / 2.0
        z0, z1 = cz - sz / 2.0, cz + sz / 2.0
        # CCW when seen from outside
        c = (cx, cy, cz)
        self.quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), rect, outward=c)  # top
        self.quad((x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1), rect, outward=c)  # +Y
        self.quad((x1, y0, z0), (x0, y0, z0), (x0, y0, z1), (x1, y0, z1), rect, outward=c)  # -Y
        self.quad((x1, y1, z0), (x1, y0, z0), (x1, y0, z1), (x1, y1, z1), rect, outward=c)  # +X
        self.quad((x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1), rect, outward=c)  # -X
        self.quad((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0), rect, outward=c)  # bottom

    def tube_ring(self, centre, ax, az, tube_r, flat, segs=14, tube_segs=8, rect=BOW,
                  a0=0.0, a1=math.tau, taper=0.0, tilt=0.0):
        """A flattened tube swept along an elliptical arc in the XZ plane."""
        cols = []
        self.centres = []
        for s in range(segs if abs(a1 - a0 - math.tau) < 1e-6 else segs + 1):
            t = a0 + (a1 - a0) * (s / float(segs))
            # point on the ellipse, and the in-plane tangent
            px = centre[0] + ax * math.cos(t)
            pz = centre[2] + az * math.sin(t)
            self.centres.append((px, centre[1], pz))
            tx, tz = -ax * math.sin(t), az * math.cos(t)
            # gathered ribbon: narrow at the knot (cos t == 1), full at the far side
            w = 1.0 - taper * max(0.0, math.cos(t))
            pz -= tilt * (px - centre[0])
            ln = math.hypot(tx, tz) or 1.0
            nx, nz = -tz / ln, tx / ln          # in-plane normal (radial)
            col = []
            for k in range(tube_segs):
                a = math.tau * k / tube_segs
                # radial direction gets tube_r, Y gets `flat` -> a ribbon loop
                col.append(self._v((px + nx * tube_r * w * math.cos(a),
                                    centre[1] + flat * math.sin(a),
                                    pz + nz * tube_r * w * math.cos(a))))
            cols.append(col)
        closed = abs(a1 - a0 - math.tau) < 1e-6
        for s in range(len(cols) - (0 if closed else 1)):
            c0, c1 = cols[s], cols[(s + 1) % len(cols)]
            for k in range(tube_segs):
                k1 = (k + 1) % tube_segs
                hub = (px + centre[0]) / 2.0 if False else (
                    (self.verts[c0[k]][0] + self.verts[c0[k1]][0] +
                     self.verts[c1[k]][0] + self.verts[c1[k1]][0]) / 4.0,
                    centre[1],
                    (self.verts[c0[k]][2] + self.verts[c0[k1]][2] +
                     self.verts[c1[k]][2] + self.verts[c1[k1]][2]) / 4.0)
                # outward reference: the arc centreline point for this column
                base = self.centres[s]
                self.quad(self.verts[c0[k]], self.verts[c0[k1]],
                          self.verts[c1[k1]], self.verts[c1[k]], rect,
                          outward=base)

    def flat_strip(self, p0, p1, p2, p3, rect, outward=None):
        self.quad(p0, p1, p2, p3, rect, outward=outward)


def build_mesh():
    m = Mesh()
    HW, HH, BH = 12.0, 12.0, 20.0      # half width, half depth, body height
    RB = 3.0                            # ribbon half-width (6 units wide)
    PI = 0.3                            # ribbon proud of the paper
    PO = 0.6                            # the band that crosses on top

    # --- box ------------------------------------------------------------- #
    m.box(0, 0, BH / 2.0, HW * 2, HH * 2, BH, PAPER)

    # --- ribbon, X axis: top + the two Y sides --------------------------- #
    m.quad((-RB, -HH - PI, BH + PI), (RB, -HH - PI, BH + PI),
           (RB, HH + PI, BH + PI), (-RB, HH + PI, BH + PI), RIBBON, outward=(0, 0, BH / 2))      # top
    m.quad((-RB, HH + PI, 0), (RB, HH + PI, 0),
           (RB, HH + PI, BH + PI), (-RB, HH + PI, BH + PI), RIBBON, outward=(0, 0, BH / 2))      # +Y
    m.quad((RB, -HH - PI, 0), (-RB, -HH - PI, 0),
           (-RB, -HH - PI, BH + PI), (RB, -HH - PI, BH + PI), RIBBON, outward=(0, 0, BH / 2))    # -Y

    # --- ribbon, Y axis: rides over the first band ----------------------- #
    m.quad((-HW - PI, -RB, BH + PO), (HW + PI, -RB, BH + PO),
           (HW + PI, RB, BH + PO), (-HW - PI, RB, BH + PO), RIBBON, outward=(0, 0, BH / 2))      # top
    m.quad((HW + PI, RB, 0), (HW + PI, -RB, 0),
           (HW + PI, -RB, BH + PO), (HW + PI, RB, BH + PO), RIBBON, outward=(0, 0, BH / 2))      # +X
    m.quad((-HW - PI, -RB, 0), (-HW - PI, RB, 0),
           (-HW - PI, RB, BH + PO), (-HW - PI, -RB, BH + PO), RIBBON, outward=(0, 0, BH / 2))    # -X

    # --- bow ------------------------------------------------------------- #
    knot_z = BH + PO + 1.6
    m.box(0, 0, knot_z, 3.2, 3.6, 3.0, BOW)
    # two flattened loops, mirrored, standing in the XZ plane; the inner edge
    # of each loop sits on the knot so the bow reads as one piece
    m.tube_ring((-4.4, 0.0, BH + PO + 2.3), 5.0, 3.0, 1.25, 0.5,
                segs=22, tube_segs=8, taper=0.55, tilt=-0.10)
    m.tube_ring((4.4, 0.0, BH + PO + 2.3), 5.0, 3.0, 1.25, 0.5,
                segs=22, tube_segs=8, taper=0.55, tilt=0.10)
    # two tails falling away from the knot, tilted outwards
    m.flat_strip((-1.2, -2.4, BH + PO + 1.4), (-5.0, -2.4, BH + PO - 4.6),
                 (-6.6, -2.4, BH + PO - 3.0), (-2.2, -2.4, BH + PO + 1.8), BOW,
                 outward=(0, 0, BH))
    m.flat_strip((1.2, -2.4, BH + PO + 1.4), (2.2, -2.4, BH + PO + 1.8),
                 (6.6, -2.4, BH + PO - 3.0), (5.0, -2.4, BH + PO - 4.6), BOW,
                 outward=(0, 0, BH))
    return m


# --------------------------------------------------------------------------- #
# 3. Blender scene
# --------------------------------------------------------------------------- #
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 0.0254  # 1 unit = 1 inch


def make_object(m, bmp_path):
    me = bpy.data.meshes.new("present")
    me.from_pydata([v for v in m.verts], [], [f[0] for f in m.faces])
    me.update()

    uvl = me.uv_layers.new(name="UVMap")
    for poly, (_, rect) in zip(me.polygons, m.faces):
        u0, v0, u1, v1 = rect
        # Blender quads come back with the same corner order they were built in
        corners = [(u0, 1.0 - v1), (u1, 1.0 - v1), (u1, 1.0 - v0), (u0, 1.0 - v0)]
        for n, li in enumerate(poly.loop_indices):
            uvl.data[li].uv = corners[n]

    ob = bpy.data.objects.new("present", me)
    bpy.context.collection.objects.link(ob)

    # material: the generated BMP, so the previews show the real texture
    mat = bpy.data.materials.new("present_paper")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(bmp_path)
    img.colorspace_settings.name = "sRGB"
    tex.image = img
    tex.interpolation = "Closest"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    me.materials.append(mat)
    return ob


def add_lighting_and_camera(ob, angle_deg, path, res=(720, 720)):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("w")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.14, 0.15, 0.19, 1)
    bg.inputs[1].default_value = 1.0

    # key + fill
    for name, loc, energy, size in (
        ("key", (55, -65, 85), 2600.0, 45.0),
        ("fill", (-75, -45, 45), 900.0, 70.0),
    ):
        lamp = bpy.data.lights.new(name, "AREA")
        lamp.energy = energy
        lamp.size = size
        lo = bpy.data.objects.new(name, lamp)
        lo.location = loc
        lo.rotation_euler = (math.radians(55), 0, math.radians(35 if name == "key" else -35))
        bpy.context.collection.objects.link(lo)

    cam = bpy.data.cameras.new("cam")
    cam.lens = 60
    camo = bpy.data.objects.new("cam", cam)
    a = math.radians(angle_deg)
    dist, height, target = 92.0, 44.0, 12.0
    camo.location = (dist * math.sin(a), -dist * math.cos(a), height)
    bpy.context.collection.objects.link(camo)
    # aim at the middle of the present
    import mathutils
    direction = mathutils.Vector((0, 0, target)) - camo.location
    camo.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = camo
    scene.render.filepath = path
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 100
    bpy.ops.render.render(write_still=True)


# --------------------------------------------------------------------------- #
# 4. SMD writer (owned here on purpose - no add-on dependency)
# --------------------------------------------------------------------------- #
def write_smd(m, path, material=BMP_NAME, bone="root"):
    """GoldSrc reference SMD.

    Sections: `version 1`, `nodes`, `skeleton`, `triangles`.  One static bone
    at the origin; triangles are flat shaded (the face normal is repeated for
    all three corners) and wound clockwise as seen from outside, which is the
    hand GoldSrc's renderer expects.
    """
    # flatten to triangles with a face normal, then de-duplicate
    index = {}
    out = []

    def corner(pos, nrm, uv):
        key = (round(pos[0], 4), round(pos[1], 4), round(pos[2], 4),
               round(nrm[0], 3), round(nrm[1], 3), round(nrm[2], 3),
               round(uv[0], 5), round(uv[1], 5))
        if key not in index:
            index[key] = len(out)
            out.append(key)
        return index[key]

    tris = []
    for verts, rect in m.faces:
        p = [m.verts[i] for i in verts]
        u0, v0, u1, v1 = rect
        uvs = [(u0, 1.0 - v1), (u1, 1.0 - v1), (u1, 1.0 - v0), (u0, 1.0 - v0)]
        for a, b, c in ((0, 1, 2), (0, 2, 3)):
            ab = [p[b][k] - p[a][k] for k in range(3)]
            ac = [p[c][k] - p[a][k] for k in range(3)]
            n = (ab[1] * ac[2] - ab[2] * ac[1],
                 ab[2] * ac[0] - ab[0] * ac[2],
                 ab[0] * ac[1] - ab[1] * ac[0])
            ln = math.sqrt(sum(x * x for x in n)) or 1.0
            n = tuple(x / ln for x in n)
            # counter-clockwise from outside - Blender's own winding.  GoldSrc's
            # studiomdl reverses every triangle on the way in (flip_triangles),
            # so CCW here is what lands as CW in the .mdl, which is the hand the
            # engine's renderer culls for.  Emitting CW here inverts the prop.
            tris.append((corner(p[a], n, uvs[a]),
                         corner(p[b], n, uvs[b]),
                         corner(p[c], n, uvs[c])))

    with open(path, "w") as f:
        f.write("version 1\n")
        f.write("nodes\n")
        f.write('0 "%s" -1\n' % bone)
        f.write("end\n")
        f.write("skeleton\n")
        f.write("time 0\n")
        f.write("0 0 0 0  0 0 0\n")
        f.write("end\n")
        f.write("triangles\n")
        for t in tris:
            # GoldSrc's studiomdl reads a material line before every single
            # triangle (see Grab_Triangles in the HLSDK utils) - one shared
            # material header is not enough
            f.write("%s\n" % material)
            for ci in t:
                px, py, pz, nx, ny, nz, u, v = out[ci]
                f.write("0 %.6f %.6f %.6f %.6f %.6f %.6f %.6f %.6f\n"
                        % (px, py, pz, nx, ny, nz, u, v))
        # block terminator, as the SMD reference has it; this studiomdl also
        # stops cleanly at EOF, so it is belt and braces
        f.write("end\n")
    return len(tris)


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #
def main():
    bmp_path = os.path.join(OUT, BMP_NAME)
    build_bmp(bmp_path)

    m = build_mesh()
    reset_scene()
    ob = make_object(m, bmp_path)

    bbox = [min(v[k] for v in m.verts) for k in range(3)] + \
           [max(v[k] for v in m.verts) for k in range(3)]

    blend_path = os.path.join(OUT, BLEND_NAME)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)

    add_lighting_and_camera(ob, 40.0, os.path.join(OUT, "preview_3q.png"))
    add_lighting_and_camera(ob, 0.0, os.path.join(OUT, "preview_front.png"))

    ntris = write_smd(m, os.path.join(OUT, SMD_NAME))

    print("[build_present] verts=%d faces=%d tris=%d" % (len(m.verts), len(m.faces), ntris))
    print("[build_present] bbox min=(%.2f %.2f %.2f) max=(%.2f %.2f %.2f)" % tuple(bbox))
    print("[build_present] wrote %s, %s, %s, preview_3q.png, preview_front.png" % (
        BLEND_NAME, SMD_NAME, BMP_NAME))


main()
