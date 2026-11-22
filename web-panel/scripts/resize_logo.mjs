import sharp from "sharp"
import { join } from "path"
const root = join(import.meta.dirname, "..")
await sharp(join(root, "assets/logo.png")).resize(88, 88).png().toFile(join(root, "assets/logo_nav.png"))
console.log("wrote logo_nav.png")
