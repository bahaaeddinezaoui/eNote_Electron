// Rasterises build/icon.svg into the icon files the app and its installers use —
// one complete mark per accent palette (emerald, red, gold, blue, pink).
//
// Chromium is the only image engine in this project (there is no sharp/canvas
// dependency), so the mark is rendered by an offscreen Electron window rather
// than by a drawing library. That also means the anti-aliasing, the font and
// the gradients match what the renderer would draw.
//
//   npx electron scripts/make-icon.cjs
//
// Writes, for every palette:
//   build/icon[-<accent>].png        1024px master
//   src/renderer/public/icon[-<accent>].png   512px, what the window loads
// and, for emerald only (the installer and the executable), build/icons/<size>.png
// and build/icon.ico. Emerald keeps the plain file names because it is the
// product default and every existing shortcut points at it.
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow, screen } = require('electron')

const ROOT = path.resolve(__dirname, '..')
const BUILD = path.join(ROOT, 'build')
const ICONS = path.join(BUILD, 'icons')
const PUBLIC = path.join(ROOT, 'src', 'renderer', 'public')
const SIZES = [16, 24, 32, 48, 64, 128, 256]
const MASTER = 1024

// The tile stays a near-black in the palette's own hue; the jade details — the
// glow, the hairline ring and the period that closes the wordmark — take the
// palette's action colour. Those are the values from src/renderer/accents.css,
// so an icon, a rule and a button are the same metal.
const ACCENTS = {
  emerald: {},
  red: {
    '#3ba97d': '#d95c64',
    '#14261c': '#1b1012',
    '#0c1a14': '#140b0d',
    '#06120d': '#0a0506'
  },
  gold: {
    '#3ba97d': '#d9a93f',
    '#14261c': '#1c170c',
    '#0c1a14': '#151107',
    '#06120d': '#0a0803'
  },
  blue: {
    '#3ba97d': '#5b93d6',
    '#14261c': '#14171c',
    '#0c1a14': '#0d1013',
    '#06120d': '#05070a'
  },
  pink: {
    '#3ba97d': '#dd6f96',
    '#14261c': '#1b1017',
    '#0c1a14': '#140b0f',
    '#06120d': '#0a0507'
  }
}

// The mark's letters are the collection's display serif — the same Instrument
// Serif that draws every display heading in the app (src/shared/typography.js) —
// so the icon and the wordmark beside it are one typeface. This window loads a
// data: URL, where the bundled file is not reachable as a relative URL, so the
// face travels with the page as a data URL.
const MARK_FONT = path.join(BUILD, 'fonts', 'instrument-serif-latin-400-italic.woff2')

const markFontCss = () => {
  try {
    const base64 = fs.readFileSync(MARK_FONT).toString('base64')
    return `@font-face{font-family:'Instrument Serif';font-style:italic;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${base64}) format('woff2');}`
  } catch (error) {
    // A missing font must degrade to the serif stack, never break the mark.
    console.warn(`mark font unavailable: ${error.message}`)
    return ''
  }
}

const tint = (svg, palette) =>
  Object.entries(palette).reduce((out, [from, to]) => out.split(from).join(to), svg)

// An .ico is a small directory followed by the images themselves. PNG data is
// allowed inside since Vista, which keeps this dependency-free.
const buildIco = (entries) => {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = 6 + 16 * entries.length
  entries.forEach(({ size, png }, index) => {
    const at = index * 16
    directory.writeUInt8(size >= 256 ? 0 : size, at)
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1)
    directory.writeUInt8(0, at + 2) // palette size
    directory.writeUInt8(0, at + 3) // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}

// How much of the tile actually has ink: a blank or transparent capture would
// pass a file-size check, a coverage number would not.
const coverage = (image) => {
  const { width, height } = image.getSize()
  const bitmap = image.getBitmap() // BGRA
  let painted = 0
  for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] > 8) painted += 1
  return painted / (width * height)
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  const baseSvg = fs.readFileSync(path.join(BUILD, 'icon.svg'), 'utf8')
  // The offscreen window is still a real window: the system clamps it to the
  // work area, so asking for 1024 CSS px on a scaled display yields a shorter
  // capture and stretches the disc into an ellipse. Render into a square that
  // certainly fits, then scale that capture up to the master size.
  const work = screen.getPrimaryDisplay().workAreaSize
  const viewport = Math.max(256, Math.min(MASTER, Math.floor(Math.min(work.width, work.height))))
  console.log(`viewport ${viewport}x${viewport} CSS px (work area ${work.width}x${work.height})`)

  // A fresh offscreen window per palette, because only a window's first paint
  // keeps the tile's transparent corners: a second navigation in the same
  // window comes back on an opaque black card, and the mark would ship with
  // square corners in the taskbar.
  let win = null
  let frame = null
  const openSurface = () => {
    win = new BrowserWindow({
      width: viewport,
      height: viewport,
      // The capture has to be the page, not the window: a frame a few pixels off
      // square gets stretched back to a square and turns the disc into an ellipse.
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })
    win.webContents.setFrameRate(10)
    win.webContents.on('paint', (_event, _dirty, image) => { frame = image })
  }

  // The mark must be laid out at exactly the capture size and with no inline
  // leading: an inline <svg> sits on a text baseline, which pushes it down a few
  // pixels and clips the bottom of the disc.
  const renderMark = async (svg) => {
    frame = null
    const page = `<!doctype html><meta charset="utf-8">
      <style>
        ${markFontCss()}
        html,body{margin:0;padding:0;line-height:0;background:transparent;overflow:hidden}
        svg{display:block;width:${viewport}px;height:${viewport}px}
      </style>
      ${svg}`
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
    // The mark's face is embedded, so the page can be laid out in it; wait for
    // that rather than capturing the fallback the first paint would show.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)')
    // Two beats of the offscreen clock: the first paint can still be the blank
    // canvas that precedes font layout.
    await new Promise((resolve) => setTimeout(resolve, 900))

    if (!frame || frame.isEmpty()) throw new Error('The offscreen window never painted the mark.')

    // Crop to a centred square before scaling, so a capture that is a pixel or
    // two off square can never stretch the circle.
    const rawSize = frame.getSize()
    const side = Math.min(rawSize.width, rawSize.height)
    const square = rawSize.width === rawSize.height
      ? frame
      : frame.crop({
          x: Math.round((rawSize.width - side) / 2),
          y: Math.round((rawSize.height - side) / 2),
          width: side,
          height: side
        })
    console.log(`  capture ${rawSize.width}x${rawSize.height}, squared to ${side}`)
    return square.resize({ width: MASTER, height: MASTER, quality: 'best' })
  }

  fs.mkdirSync(ICONS, { recursive: true })
  fs.mkdirSync(PUBLIC, { recursive: true })

  for (const [accent, palette] of Object.entries(ACCENTS)) {
    const previous = win
    openSurface()
    const master = await renderMark(tint(baseSvg, palette))
    if (previous && !previous.isDestroyed()) previous.destroy()
    const painted = coverage(master)
    console.log(`${accent}: master ${MASTER}x${MASTER} coverage ${(painted * 100).toFixed(1)}%`)
    if (painted < 0.5) {
      throw new Error(`The ${accent} capture is mostly empty; refusing to write it.`)
    }

    // Emerald keeps the plain names: it is the default, so the installer, the
    // executable and any shortcut created earlier keep pointing at it.
    const masterFile = accent === 'emerald' ? 'icon.png' : `icon-${accent}.png`
    fs.writeFileSync(path.join(BUILD, masterFile), master.toPNG())
    fs.writeFileSync(
      path.join(PUBLIC, masterFile),
      master.resize({ width: 512, height: 512, quality: 'best' }).toPNG()
    )

    if (accent === 'emerald') {
      const entries = []
      for (const size of SIZES) {
        const scaled = master.resize({ width: size, height: size, quality: 'best' })
        const png = scaled.toPNG()
        fs.writeFileSync(path.join(ICONS, `${size}.png`), png)
        entries.push({ size, png })
      }
      fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(entries))
    }
  }

  console.log(
    `wrote build/icon.png, build/icon-red.png, build/icon-gold.png, build/icon-blue.png, ` +
    `build/icon-pink.png, build/icon.ico (${SIZES.join(', ')}) and the same five in ` +
    `src/renderer/public/`
  )
  app.exit(0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
