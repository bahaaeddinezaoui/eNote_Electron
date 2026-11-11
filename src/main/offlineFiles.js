import fs from 'fs'
import { basename, extname, join } from 'path'
import { app } from 'electron'

// Files this workstation has copied out of the library, so a document can be
// opened during an outage.
//
// Library and lesson files live on the server share, which disappears with the
// server. "Save for offline" copies one here, and open/download then uses the
// copy when the share cannot be read. Unlike the record cache this is an
// explicit choice per file — a librarian decides what a machine keeps — and it
// never writes to PostgreSQL, so nothing here can conflict with anybody else's
// work.
//
// The catalogue itself (the rows) is served by the read cache; this module only
// remembers where each saved copy went. The cache is bounded and evicts the
// copy read longest ago first.

const DIR_NAME = 'offline-files'
const INDEX_FILE = 'index.json'
const MAX_BYTES = 2 * 1024 * 1024 * 1024
const TARGET_BYTES = 1536 * 1024 * 1024
const KINDS = new Set(['library', 'documents'])

let overriddenDirectory = null

export function configureOfflineFileDirectory(path) {
  overriddenDirectory = path || null
}

function baseDirectory() {
  try {
    return overriddenDirectory || app.getPath('userData')
  } catch {
    return null
  }
}

function kindDirectory(kind) {
  if (!KINDS.has(kind)) return null
  const base = baseDirectory()
  if (!base) return null
  const dir = join(base, DIR_NAME, kind)
  try {
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch (error) {
    console.warn('The offline file folder is unavailable:', error.message)
    return null
  }
}

const keyOf = (id) => String(Number(id) || '')

function readIndex(kind) {
  const dir = kindDirectory(kind)
  if (!dir) return {}
  try {
    const path = join(dir, INDEX_FILE)
    if (!fs.existsSync(path)) return {}
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeIndex(kind, index) {
  const dir = kindDirectory(kind)
  if (!dir) return false
  try {
    const path = join(dir, INDEX_FILE)
    const temporary = `${path}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(index, null, 2), 'utf8')
    fs.renameSync(temporary, path)
    return true
  } catch (error) {
    console.warn('Could not record a saved copy:', error.message)
    return false
  }
}

// A file name that is safe on every platform, while keeping the extension the
// system viewer needs to pick an application.
function targetName(id, sourcePath) {
  const extension = extname(String(sourcePath || '')).slice(0, 12)
  const stem = basename(String(sourcePath || 'file'), extension)
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .slice(0, 60)
  return `${Number(id) || 'file'}-${stem || 'file'}${extension}`
}

function entryPath(kind, entry) {
  const dir = kindDirectory(kind)
  return dir && entry?.file ? join(dir, entry.file) : null
}

// Copy one file here. Returns { saved, bytes } or { error } — a failure never
// throws, because the caller is a button in a page that must stay usable.
export function saveOfflineFile({ kind, id, sourcePath, label = null, mime = null } = {}) {
  const key = keyOf(id)
  if (!KINDS.has(kind) || !key) return { error: 'This file cannot be saved for offline use.' }
  if (!sourcePath) return { error: 'The stored file could not be found.' }

  const dir = kindDirectory(kind)
  if (!dir) return { error: 'This computer cannot keep a copy of that file.' }

  try {
    const stat = fs.statSync(sourcePath)
    if (!stat.isFile()) return { error: 'The stored file could not be found.' }
  } catch {
    return { error: 'The stored file is missing on disk. It may have been moved or deleted.' }
  }

  const index = readIndex(kind)
  const previous = index[key]
  const file = targetName(key, sourcePath)
  const target = join(dir, file)

  try {
    fs.copyFileSync(sourcePath, target)
    // A re-save may pick a different name (the share path changed); the old copy
    // is no longer referenced.
    if (previous?.file && previous.file !== file) {
      try {
        fs.rmSync(join(dir, previous.file), { force: true })
      } catch {
        /* the new copy is what matters */
      }
    }
    const bytes = fs.statSync(target).size
    const now = Date.now()
    index[key] = {
      id: Number(key),
      file,
      label: label || previous?.label || basename(sourcePath),
      mime: mime || previous?.mime || null,
      bytes,
      savedAt: previous?.savedAt || now,
      lastUsed: now
    }
    writeIndex(kind, index)
    pruneOfflineFiles(kind)
    return { saved: true, bytes, path: target }
  } catch (error) {
    console.warn('Could not keep a copy of that file:', error.message)
    return { error: 'This computer could not keep a copy of that file.' }
  }
}

// The saved copy of one item, or null when this computer does not have one.
// Reading it refreshes its place in the eviction order.
export function recallOfflineFile(kind, id) {
  const key = keyOf(id)
  if (!KINDS.has(kind) || !key) return null
  const index = readIndex(kind)
  const entry = index[key]
  const path = entryPath(kind, entry)
  if (!path || !fs.existsSync(path)) {
    // The file was removed outside the application: forget the entry rather
    // than claiming a copy that is not there.
    if (entry) {
      delete index[key]
      writeIndex(kind, index)
    }
    return null
  }
  try {
    const now = new Date()
    fs.utimesSync(path, now, now)
    if (entry) {
      entry.lastUsed = now.getTime()
      writeIndex(kind, index)
    }
  } catch {
    /* the copy is still readable */
  }
  return {
    path,
    label: entry?.label || null,
    mime: entry?.mime || null,
    bytes: Number(entry?.bytes) || null,
    savedAt: Number(entry?.savedAt) || null
  }
}

export function removeOfflineFile(kind, id) {
  const key = keyOf(id)
  if (!KINDS.has(kind) || !key) return { removed: false }
  const index = readIndex(kind)
  const entry = index[key]
  if (!entry) return { removed: false }
  const path = entryPath(kind, entry)
  if (path) {
    try {
      fs.rmSync(path, { force: true })
    } catch (error) {
      console.warn('Could not remove a saved copy:', error.message)
    }
  }
  delete index[key]
  writeIndex(kind, index)
  return { removed: true }
}

// Which items this computer holds, for the page to mark them.
export function offlineFileIds(kind) {
  if (!KINDS.has(kind)) return []
  const index = readIndex(kind)
  const ids = []
  for (const [key, entry] of Object.entries(index)) {
    const path = entryPath(kind, entry)
    if (path && fs.existsSync(path)) ids.push(Number(key))
  }
  return ids
}

function totalBytes(kind) {
  const index = readIndex(kind)
  let total = 0
  for (const entry of Object.values(index)) {
    total += Number(entry?.bytes) || 0
  }
  return total
}

// Keep the folder within its budget by dropping the copy read longest ago.
export function pruneOfflineFiles(kind) {
  if (!KINDS.has(kind)) return
  if (totalBytes(kind) <= MAX_BYTES) return

  const index = readIndex(kind)
  const entries = Object.entries(index).sort(
    (left, right) => (Number(left[1]?.lastUsed) || 0) - (Number(right[1]?.lastUsed) || 0)
  )
  let bytes = totalBytes(kind)
  for (const [key, entry] of entries) {
    if (bytes <= TARGET_BYTES) break
    const path = entryPath(kind, entry)
    if (path) {
      try {
        fs.rmSync(path, { force: true })
      } catch {
        continue
      }
    }
    bytes -= Number(entry?.bytes) || 0
    delete index[key]
  }
  writeIndex(kind, index)
}

// What the offline details panel reports: how many files are kept here and how
// much room they take.
export function offlineFileStats() {
  let count = 0
  let bytes = 0
  let lastUsedAt = null
  for (const kind of KINDS) {
    const index = readIndex(kind)
    for (const entry of Object.values(index)) {
      const path = entryPath(kind, entry)
      if (!path || !fs.existsSync(path)) continue
      count += 1
      bytes += Number(entry?.bytes) || 0
      const used = Number(entry?.lastUsed) || 0
      if (used && (!lastUsedAt || used > lastUsedAt)) lastUsedAt = used
    }
  }
  return { available: true, count, bytes, lastUsedAt }
}
