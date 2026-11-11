// Derives the complete red, gold, blue and pink palettes from the emerald tokens in
// index.css: every surface, line, ink and legacy hue ramp is re-hued to the
// palette's metal at the same lightness and saturation, so the result keeps the
// design's value ladder. The accent ramp itself is curated by hand; semantic
// colours (success, warning, danger, info) are never re-hued — a success state
// stays green in a red theme.
//
// Run once, from the project root:  node scripts/make-palettes.cjs
// Writes src/renderer/accents.css.
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'src', 'renderer', 'index.css')
const TARGET = path.join(ROOT, 'src', 'renderer', 'accents.css')

const source = fs.readFileSync(SOURCE, 'utf8')

// The block that starts at `selector {`, up to its matching brace.
const blockAt = (text, selector) => {
  const start = text.indexOf(selector)
  if (start === -1) throw new Error(`Could not find ${selector}`)
  const open = text.indexOf('{', start)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  throw new Error(`Unbalanced block ${selector}`)
}

const parseTokens = (block) => {
  const tokens = new Map()
  const re = /(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g
  let match
  while ((match = re.exec(block))) tokens.set(match[1], match[2].toLowerCase())
  return tokens
}

const darkBase = parseTokens(blockAt(source, '@theme {'))
const lightBase = parseTokens(blockAt(source, ':root:not(.dark) {'))
if (darkBase.size < 40 || lightBase.size < 20) {
  throw new Error(`Unexpected token counts: ${darkBase.size} dark / ${lightBase.size} light`)
}

const toRgb = (hex) => {
  let value = hex.replace('#', '')
  if (value.length === 3) value = value.split('').map((c) => c + c).join('')
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
}

const toHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

const rgbToHsl = ([r, g, b]) => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

const hslToRgb = ([h, s, l]) => {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

// Re-hue at the same lightness and saturation: the palette keeps the design's
// value ladder and only changes the metal. Achromatic tokens are left alone.
const rehue = (hex, hue) => {
  const [h, s, l] = rgbToHsl(toRgb(hex))
  if (s < 0.02) return hex
  return toHex(hslToRgb([hue / 360, s, l]))
}

// Semantic colours are not part of the metal: success stays green, danger stays
// red, whatever the accent.
const isSemantic = (name) => /^--color-(success|warning|danger|info)(-bg|-ink)?$/.test(name)

const isAccent = (name) =>
  name.startsWith('--color-jade') ||
  name === '--color-on-jade' ||
  name === '--color-selection' ||
  name.startsWith('--color-ember') ||
  name === '--color-on-ember'

const ACCENTS = {
  red: {
    hue: 357,
    dark: {
      '--color-jade-50': '#2a1417',
      '--color-jade-100': '#3a1a1e',
      '--color-jade-300': '#b34a52',
      '--color-jade-500': '#d95c64',
      '--color-jade-600': '#e8828a',
      '--color-jade-700': '#f2a9af',
      '--color-jade-solid': '#c94a52',
      '--color-on-jade': '#1a0507',
      '--color-selection': '#3a1e22',
      '--color-jade-ui': '#d95c64',
      '--color-jade-ink': '#1a0507',
      // Attention moves to gold: a red action and a red warning would read as
      // the same signal twice, so the secondary colour steps aside.
      '--color-ember-50': '#2a2314',
      '--color-ember-100': '#3a301a',
      '--color-ember-300': '#b08a34',
      '--color-ember-500': '#e0a458',
      '--color-ember-600': '#eec07e',
      '--color-ember-700': '#f6d7a6',
      '--color-ember-solid': '#e0a458',
      '--color-on-ember': '#1c1403'
    },
    light: {
      '--color-jade-50': '#fbe9ea',
      '--color-jade-100': '#f7d3d5',
      '--color-jade-300': '#b3444b',
      '--color-jade-500': '#9e2f37',
      '--color-jade-600': '#82242b',
      '--color-jade-700': '#661a20',
      '--color-jade-solid': '#a02f36',
      '--color-on-jade': '#fdf5f5',
      '--color-selection': '#f3d7d9',
      '--color-jade-ui': '#a02f36',
      '--color-jade-ink': '#fdf5f5',
      '--color-ember-50': '#f6ead4',
      '--color-ember-100': '#f0e0c0',
      '--color-ember-300': '#c08a2e',
      '--color-ember-500': '#a06a1e',
      '--color-ember-600': '#855514',
      '--color-ember-700': '#6b4512',
      '--color-ember-solid': '#a06a1e',
      '--color-on-ember': '#fdfaf0'
    }
  },
  blue: {
    hue: 214,
    dark: {
      '--color-jade-50': '#131f2c',
      '--color-jade-100': '#1a2a3a',
      '--color-jade-300': '#3f6f9e',
      '--color-jade-500': '#5b93d6',
      '--color-jade-600': '#7fade3',
      '--color-jade-700': '#a7c8ee',
      '--color-jade-solid': '#4a86cc',
      '--color-on-jade': '#06101c',
      '--color-selection': '#17293c',
      '--color-jade-ui': '#5b93d6',
      '--color-jade-ink': '#06101c'
    },
    light: {
      '--color-jade-50': '#e8f0fa',
      '--color-jade-100': '#d2e3f5',
      '--color-jade-300': '#3d6fa3',
      '--color-jade-500': '#245a8c',
      '--color-jade-600': '#1b4a75',
      '--color-jade-700': '#143a5d',
      '--color-jade-solid': '#25598a',
      '--color-on-jade': '#f6faff',
      '--color-selection': '#d5e5f5',
      '--color-jade-ui': '#25598a',
      '--color-jade-ink': '#f6faff'
    }
  },
  pink: {
    hue: 336,
    dark: {
      '--color-jade-50': '#2a141d',
      '--color-jade-100': '#3a1a27',
      '--color-jade-300': '#b34a70',
      '--color-jade-500': '#dd6f96',
      '--color-jade-600': '#e995b3',
      '--color-jade-700': '#f2bcd0',
      '--color-jade-solid': '#cf5b84',
      '--color-on-jade': '#1a0510',
      '--color-selection': '#3a1a27',
      '--color-jade-ui': '#dd6f96',
      '--color-jade-ink': '#1a0510'
    },
    light: {
      '--color-jade-50': '#fbe9ef',
      '--color-jade-100': '#f7d3e0',
      '--color-jade-300': '#b3446e',
      '--color-jade-500': '#9e2f5c',
      '--color-jade-600': '#82244a',
      '--color-jade-700': '#661a38',
      '--color-jade-solid': '#a02f5a',
      '--color-on-jade': '#fdf5f8',
      '--color-selection': '#f3d7e3',
      '--color-jade-ui': '#a02f5a',
      '--color-jade-ink': '#fdf5f8'
    }
  },
  gold: {
    hue: 42,
    dark: {
      '--color-jade-50': '#2a2314',
      '--color-jade-100': '#3a301a',
      '--color-jade-300': '#b08a34',
      '--color-jade-500': '#d9a93f',
      '--color-jade-600': '#e8bf63',
      '--color-jade-700': '#f0d391',
      '--color-jade-solid': '#c99a33',
      '--color-on-jade': '#1c1403',
      '--color-selection': '#3a3019',
      '--color-jade-ui': '#d9a93f',
      '--color-jade-ink': '#1c1403'
    },
    light: {
      '--color-jade-50': '#faf3df',
      '--color-jade-100': '#f4e7c3',
      '--color-jade-300': '#a9822a',
      '--color-jade-500': '#8a6314',
      '--color-jade-600': '#6f4f0f',
      '--color-jade-700': '#573d0a',
      '--color-jade-solid': '#8a6314',
      '--color-on-jade': '#fdfaf0',
      '--color-selection': '#f2e6c6',
      '--color-jade-ui': '#8a6314',
      '--color-jade-ink': '#fdfaf0'
    }
  }
}

const buildPalette = (base, curated, hue) => {
  const out = new Map()
  for (const [name, value] of base) {
    if (curated[name]) out.set(name, curated[name])
    else if (isSemantic(name)) out.set(name, value)
    else if (isAccent(name)) out.set(name, value) // ember kept when not curated
    else out.set(name, rehue(value, hue))
  }
  // Curated tokens the base block does not declare (jade-ui, jade-ink, and the
  // ember family in the light block) are added so each palette stands alone.
  for (const [name, value] of Object.entries(curated)) {
    if (!out.has(name)) out.set(name, value)
  }
  return out
}

const render = (selector, palette) =>
  `${selector} {\n` +
  [...palette].map(([name, value]) => `  ${name}: ${value};`).join('\n') +
  '\n}\n'

const header = `/* ============================================================================
   Accent palettes — the whole interface in one of five metals.
   ----------------------------------------------------------------------------
   Emerald is the product palette and needs no block: the values in index.css
   are it. Red, gold, blue and pink are derived from those values by re-hueing every
   surface, line, ink and legacy hue ramp at the same lightness and saturation, so the
   palette keeps the design's value ladder and changes only the metal. The accent
   ramp and the attention colour are curated; the semantic colours (success,
   warning, danger, info) are deliberately untouched — a success state stays
   green in a red theme, and colour is never the only signal.

   Generated by scripts/make-palettes.cjs — edit that script (the curated ramps)
   rather than this file, or a regeneration will overwrite the change.

   Every component names tokens, never colours, so these overrides are the whole
   change: no component knows which palette is active.

   Two axes decide which block applies:
     appearance — light (:root:not(.dark)) or dark / pure black (everything
                  else; the pure-black appearance changes surfaces to true black
                  and keeps the accent);
     accent     — data-accent on <html>, written by theme.js and, before the
                  first paint, by public/theme-init.js.

   The light blocks carry an extra selector so they win over the light palette
   in index.css whatever order the files are imported in.
   ========================================================================= */

`

const blocks = []
for (const [accent, palette] of Object.entries(ACCENTS)) {
  const dark = buildPalette(darkBase, palette.dark, palette.hue)
  const light = buildPalette(lightBase, palette.light, palette.hue)
  blocks.push(render(`:root[data-accent='${accent}']`, dark))
  blocks.push(render(`:root:not(.dark)[data-accent='${accent}']`, light))
  console.log(
    `${accent}: dark ${dark.size} tokens (${Object.keys(palette.dark).length} curated), ` +
    `light ${light.size} tokens (${Object.keys(palette.light).length} curated)`
  )
  for (const name of ['--color-canvas', '--color-surface', '--color-line', '--color-ink', '--color-white', '--color-slate-400', '--color-blue-500']) {
    console.log(`   ${name.padEnd(20)} ${(darkBase.get(name) || '–').padEnd(9)} → ${dark.get(name)}`)
  }
}

fs.writeFileSync(TARGET, header + blocks.join('\n'))
console.log(`wrote ${path.relative(ROOT, TARGET)}`)
