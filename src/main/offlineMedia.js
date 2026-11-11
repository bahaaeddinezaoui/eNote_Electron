import { createHash } from 'crypto'
import fs from 'fs'
import { join, extname } from 'path'
import { app } from 'electron'

// A local copy of every student photo this workstation has displayed.
//
// Photos live on the server share, so they vanish with the server. Each one
// that is shown is copied here (they are small), and the copy is used when the
// share cannot be read — which keeps rosters and printed reports looking
// complete during an outage. The cache is bounded and evicts the photographs
// seen longest ago first.

const DIR_NAME = 'offline-media'
const MAX_BYTES = 512 * 1024 * 1024
const TARGET_BYTES = 384 * 1024 * 1024
const PRUNE_EVERY_WRITES = 100
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

let overriddenDirectory = null
let writesSincePrune = 0

export function configureMediaCacheDirectory(path) {
  overriddenDirectory = path || null
}

function cacheDir() {
  try {
    const base = overriddenDirectory || app.getPath('userData')
    const dir = join(base, DIR_NAME, 'person_photos')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch (error) {
    console.warn('The offline photo cache is unavailable:', error.message)
    return null
  }
}

// One file per stored photo value. The stored value carries the photo's own
// timestamp, so a replaced photograph is a different entry, never a stale hit.
function entryFor(storedValue) {
  const dir = cacheDir()
  if (!dir) return null
  const hash = createHash('sha1').update(String(storedValue)).digest('hex')
  const extension = extname(String(storedValue)).toLowerCase()
  return join(dir, `${hash}${ALLOWED_EXTENSIONS.has(extension) ? extension : '.png'}`)
}

export function rememberPhoto(storedValue, sourcePath) {
  if (!storedValue || !sourcePath) return false
  const target = entryFor(storedValue)
  if (!target) return false
  try {
    if (fs.existsSync(target)) {
      // Still shown: keep it away from the pruning pass.
      const now = new Date()
      fs.utimesSync(target, now, now)
      return true
    }
    fs.copyFileSync(sourcePath, target)
    if (++writesSincePrune >= PRUNE_EVERY_WRITES) {
      writesSincePrune = 0
      prunePhotoCache()
    }
    return true
  } catch (error) {
    // A full disk or a photo larger than the quota is not a reason to break
    // the record that displays it.
    return false
  }
}

// The saved copy of that photo, or null when this computer has not shown it.
export function recallPhoto(storedValue) {
  if (!storedValue) return null
  const target = entryFor(storedValue)
  if (!target) return null
  try {
    if (!fs.existsSync(target)) return null
    const now = new Date()
    fs.utimesSync(target, now, now)
    return target
  } catch {
    return null
  }
}

export function prunePhotoCache() {
  const dir = cacheDir()
  if (!dir) return
  try {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(dir, entry.name)
        try {
          const stat = fs.statSync(path)
          return { path, bytes: stat.size, usedAt: stat.mtimeMs }
        } catch {
          return null
        }
      })
      .filter(Boolean)

    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    if (total <= MAX_BYTES) return

    entries.sort((a, b) => a.usedAt - b.usedAt)
    for (const entry of entries) {
      if (total <= TARGET_BYTES) break
      try {
        fs.unlinkSync(entry.path)
        total -= entry.bytes
      } catch {
        /* another process may hold it; try the next one */
      }
    }
  } catch (error) {
    console.warn('Could not prune the offline photo cache:', error.message)
  }
}

// How many photographs are held, how much room they take and when the one seen
// most recently was used. `lastUsedAt` comes from the files' modification times,
// which recallPhoto refreshes, so it is the last time a copy was actually read.
export function photoCacheStats() {
  const dir = cacheDir()
  if (!dir) return { available: false, count: 0, bytes: 0, lastUsedAt: null }
  try {
    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile())
    let bytes = 0
    let lastUsedAt = 0
    for (const file of files) {
      try {
        const stat = fs.statSync(join(dir, file.name))
        bytes += stat.size
        lastUsedAt = Math.max(lastUsedAt, stat.mtimeMs)
      } catch {
        // Removed between the listing and the stat: just not counted.
      }
    }
    return { available: true, count: files.length, bytes, lastUsedAt: lastUsedAt || null }
  } catch (error) {
    console.warn('Could not measure the offline photo cache:', error.message)
    return { available: false, count: 0, bytes: 0, lastUsedAt: null }
  }
}
