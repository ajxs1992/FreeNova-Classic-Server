// present.qc - the Winterfest present prop.
// Compiled by tools/models/compile.sh; regenerated geometry comes from
// tools/models/build_present.py (Blender) -> present.smd + present.bmp.
//
// One static bone ("root"), one idle sequence, one 128x128 paletted BMP.

$modelname "models/winterfest/present.mdl"

// where the source files and the texture live (GoldSrc has no $cdmaterials -
// that is a Source command, and this studiomdl rejects it outright)
$cd "models/winterfest"

// one body part, one mesh, one reference skin
// keep the animation inside the main .mdl: without this the compiler splits the
// single idle frame into a separate models/winterfest/present01.mdl sequence
// group, and the prop would need two files instead of one
$sequencegroupsize 4096

$body studio "present"

// keeps the engine's culling box tight around the real geometry (24.6 x 24.6 x 27.2)
$bbox -12.30 -12.30 0.00 12.30 12.30 27.20
$cbox 0 0 0 0 0 0

// a single static frame on the root bone; props are rendered at frame 0
$sequence idle "present" fps 30
