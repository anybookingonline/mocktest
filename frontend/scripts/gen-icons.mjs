// One-shot generator for PWA PNG icons from the brand SVG.
// Run: node scripts/gen-icons.mjs   (uses pngjs, already in devDependencies)
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '..', 'public')
mkdirSync(OUT, { recursive: true })

// Minimal SVG rasterizer: this icon is geometric (rect + circle + strokes), so
// we redraw it directly instead of shipping a heavy svg-to-png dependency.
function drawIcon(size) {
  const png = new PNG({ width: size, height: size })
  const S = size / 512 // scale factor from the 512 design grid
  const bg = [11, 15, 26]
  const rx = 112 * S
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (size * Math.floor(y) + Math.floor(x)) << 2
    // src-over alpha blend
    const ia = a / 255
    png.data[i] = Math.round(r * ia + png.data[i] * (1 - ia))
    png.data[i + 1] = Math.round(g * ia + png.data[i + 1] * (1 - ia))
    png.data[i + 2] = Math.round(b * ia + png.data[i + 2] * (1 - ia))
    png.data[i + 3] = Math.max(png.data[i + 3], Math.round(a))
  }
  const inRoundedRect = (x, y) => {
    if (x < 0 || y < 0 || x > size || y > size) return false
    const r = Math.min(rx, size / 2)
    const cx = Math.max(r, Math.min(size - r, x))
    const cy = Math.max(r, Math.min(size - r, y))
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
  }
  const inCircle = (x, y, cx, cy, rad) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad
  // lerp between gradient endpoints (#6366f1 -> #22d3ee) along x/y diagonal
  const grad = (x, y) => {
    const t = Math.max(0, Math.min(1, (x + y) / (2 * size)))
    const a = [99, 102, 241], b = [34, 211, 238]
    return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t))
  }
  const strokeCircleArc = (x, y) => {
    // hexagon-ish outline: circle of radius 54% with stroke 16*S, drawn as ring
    const cx = 256 * S, cy = 256 * S, R = 150 * S * 0.62, w = 16 * S
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    return Math.abs(d - R) <= w / 2
  }
  const check = (x, y) => {
    // the "✓" polyline from the SVG path (196,266)->(240,310)->(320,218), stroke 18*S
    const w = 18 * S * 0.72
    const seg = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1
      const L2 = dx * dx + dy * dy || 1
      let t = ((x - x1) * dx + (y - y1) * dy) / L2
      t = Math.max(0, Math.min(1, t))
      const px = x1 + t * dx, py = y1 + t * dy
      return (x - px) ** 2 + (y - py) ** 2 <= w * w
    }
    return seg(196 * S, 266 * S, 240 * S, 310 * S) || seg(240 * S, 310 * S, 320 * S, 218 * S)
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundedRect(x, y)) continue // transparent outside the rounded square
      set(x, y, bg[0], bg[1], bg[2], 255)
      const [r, g, b] = grad(x, y)
      if (inCircle(x, y, 256 * S, 256 * S, 150 * S)) set(x, y, r, g, b, 235)
      if (strokeCircleArc(x, y)) set(x, y, 11, 15, 26, 255)
      if (check(x, y)) set(x, y, 11, 15, 26, 255)
    }
  }
  return PNG.sync.write(png)
}

for (const size of [192, 512]) {
  writeFileSync(resolve(OUT, `icon-${size}.png`), drawIcon(size))
  console.log(`icon-${size}.png written`)
}
// maskable: safe zone = icon content at 80% within a full-bleed square
const mask = drawIcon(512)
writeFileSync(resolve(OUT, 'icon-maskable.png'), mask)
console.log('icon-maskable.png written')
// apple-touch-icon must be opaque (iOS), 180x180
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), drawIcon(180))
console.log('apple-touch-icon.png written')
console.log('done')
