import sharp from "sharp"
import { join } from "path"

const root = "C:/Users/conts/Desktop/FREENOVA System"
const files = [
  "csgo medals.JPG",
  "level badges.JPG",
  "example profile.png",
  "freenova_logo.png",
  "battlepass example.png"
]
for (const f of files) {
  const meta = await sharp(join(root, f)).metadata()
  const stats = await sharp(join(root, f)).stats()
  const mean = stats.channels.map(c => Math.round(c.mean))
  console.log(JSON.stringify({
    file: f,
    width: meta.width,
    height: meta.height,
    format: meta.format,
    channels: meta.channels,
    mean
  }))
}
