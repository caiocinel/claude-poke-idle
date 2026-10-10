// Turns the packed sprite strings into Raster cells: two pixels per cell with half blocks.

import { FRONT, BACK } from '../data/sprites.js'

const DEFAULT = 0x01000000
const UPPER = 0x2580 // ▀
const LOWER = 0x2584 // ▄
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function fromBase64(s) {
  const clean = s.replace(/=+$/, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63)
    if (o < out.length) out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

export function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '='
    s += i + 2 < bytes.length ? B64[n & 63] : '='
  }
  return s
}

// Shiny Pokémon get their palette rotated (r, g, b) -> (b, r, g)
const shinyColor = (c) => ((c & 0xff) << 16) | ((c >> 16) & 0xff) << 8 | ((c >> 8) & 0xff)

const pixelCache = new Map()

// The sprite as { w, h, px }, px a row-major array of colors, -1 for transparent
export function pixels(s, back, shiny, half) {
  const key = `${s}:${back ? 1 : 0}:${shiny ? 1 : 0}:${half ? 1 : 0}`
  const hit = pixelCache.get(key)
  if (hit) return hit
  const [w0, h0, pal, data] = (back ? BACK : FRONT)[s - 1].split(',')
  const w = Number(w0)
  const h = Number(h0)
  const palette = []
  for (let i = 0; i < pal.length; i += 6) {
    const c = parseInt(pal.slice(i, i + 6), 16)
    palette.push(shiny ? shinyColor(c) : c)
  }
  const bytes = fromBase64(data)
  let px = new Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const b = bytes[i >> 1]
    const idx = i & 1 ? b & 15 : b >> 4
    px[i] = idx ? palette[idx - 1] : -1
  }
  let out = { w, h, px }
  if (half) {
    const hw = Math.ceil(w / 2)
    const hh = Math.ceil(h / 2)
    const hp = new Array(hw * hh)
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        // Keep an opaque pixel of the 2x2 block when there is one
        const cands = [[2 * x, 2 * y], [2 * x + 1, 2 * y], [2 * x, 2 * y + 1], [2 * x + 1, 2 * y + 1]]
          .filter(([a, b]) => a < w && b < h)
          .map(([a, b]) => px[b * w + a])
        const opaque = cands.filter((c) => c >= 0)
        hp[y * hw + x] = opaque.length >= 2 ? opaque[0] : -1
      }
    }
    out = { w: hw, h: hh, px: hp }
  }
  pixelCache.set(key, out)
  return out
}

// Cells for a Raster of `columns` by `rows`, with the sprite placed at the bottom
// center (or bottom left/right with align)
export function spriteCells(sprite, columns, rows, align = 'center', flip = false) {
  const { w, h, px } = sprite
  const words = new Uint32Array(columns * rows * 3)
  const ox = align === 'left' ? 0 : align === 'right' ? columns - w : Math.floor((columns - w) / 2)
  const oy = rows * 2 - h - (h % 2)
  const at = (x, y) => {
    const sx = flip ? w - 1 - (x - ox) : x - ox
    const sy = y - oy
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return -1
    return px[sy * w + sx]
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const top = at(c, r * 2)
      const bot = at(c, r * 2 + 1)
      const i = (r * columns + c) * 3
      if (top < 0 && bot < 0) {
        words[i] = 32
        words[i + 1] = DEFAULT
        words[i + 2] = DEFAULT
      } else if (top < 0) {
        words[i] = LOWER
        words[i + 1] = bot
        words[i + 2] = DEFAULT
      } else {
        words[i] = UPPER
        words[i + 1] = top
        words[i + 2] = bot < 0 ? DEFAULT : bot
      }
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

// A sprite with every opaque pixel painted one color, for unknown Pokédex entries
export function silhouette(sprite) {
  return { ...sprite, px: sprite.px.map((c) => (c < 0 ? -1 : 0x3a3a3a)) }
}

// The sprite shrunk to at most `maxH` pixels tall: each block of the grid keeps
// its most common opaque color when at least a third of it is opaque
export function tiny(s, back, shiny, maxH) {
  const key = `tiny:${s}:${back ? 1 : 0}:${shiny ? 1 : 0}:${maxH}`
  const hit = pixelCache.get(key)
  if (hit) return hit
  const { w, h, px } = pixels(s, back, shiny, false)
  const f = Math.max(1, Math.ceil(h / maxH))
  const tw = Math.ceil(w / f)
  const th = Math.ceil(h / f)
  const out = new Array(tw * th).fill(-1)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const counts = new Map()
      let opaque = 0
      let total = 0
      for (let yy = y * f; yy < Math.min(h, (y + 1) * f); yy++) {
        for (let xx = x * f; xx < Math.min(w, (x + 1) * f); xx++) {
          total++
          const c = px[yy * w + xx]
          if (c < 0) continue
          opaque++
          counts.set(c, (counts.get(c) || 0) + 1)
        }
      }
      if (opaque * 3 < total) continue
      let best = -1
      let n = 0
      for (const [c, k] of counts) if (k > n) [best, n] = [c, k]
      out[y * tw + x] = best
    }
  }
  const res = { w: tw, h: th, px: out }
  pixelCache.set(key, res)
  return res
}
