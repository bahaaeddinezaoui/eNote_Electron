import { app } from 'electron'
import { join, isAbsolute, basename, dirname, extname, relative, sep } from 'path'
import fs from 'fs'
import { getDeploymentInfo } from '../deployment'
import { ensureShareSession, scheduleShareReconnect, shareSessionStatus } from './smbShare'

// Where the files the application manages live: student photos, lesson
// documents and bug-report screenshots.
//
// The application is deployed against a server that several machines share one
// database with, so the files have to sit beside that database, not in each
// client's own user-data folder — a photo copied into machine A's folder is
// invisible to machine B, and disappears when A is reimaged.
//
// Two settings decide where they go (storage_config.json in the user-data
// folder, next to pg_config.json):
//
//   { "mode": "local" }                                  this computer only
//   { "mode": "shared", "root": "\\\\SERVER\\eNote\\files" }  the server share
//
// ENOTE_RESOURCE_ROOT overrides the file, so a launcher or an installer can
// point an installation at the share without touching user data.
//
// The database only ever stores a *key*: the path of the file relative to the
// root, e.g. "person_photos/12_Mohamed_Benali_محمد_بن_علي_1762345678.png". A key survives the root moving
// (a share today, a mounted drive tomorrow) and rows written by older builds,
// which held absolute paths, are still read.
const CONFIG_FILE = 'storage_config.json'
const ENV_ROOT = 'ENOTE_RESOURCE_ROOT'
export const RESOURCE_KINDS = ['person_photos', 'documents', 'library', 'screenshots']

const normaliseMode = (value) => (value === 'shared' ? 'shared' : 'local')

// The configured mode/root. A root set in the environment always wins: a
// deployment that exports it is not overridable from the interface.
export function getStorageConfig() {
  let stored = {}
  try {
    const path = join(app.getPath('userData'), CONFIG_FILE)
    if (fs.existsSync(path)) stored = JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (err) {
    console.warn('Could not read storage_config.json:', err.message)
  }

  const fromEnv = String(process.env[ENV_ROOT] || '').trim()
  let presetRoot = null
  try {
    const preset = getDeploymentInfo()
    if (preset?.storageRoot) presetRoot = String(preset.storageRoot).trim()
  } catch {
    // preset not available in non-app environment
  }
  const root = fromEnv || String(stored.root || '').trim() || presetRoot
  const mode = fromEnv ? 'shared' : (stored.mode ? normaliseMode(stored.mode) : (presetRoot ? 'shared' : 'local'))
  return {
    mode,
    root: root || null,
    // Where the setting came from, so the log can say why a root is ignored.
    source: fromEnv ? 'environment' : (stored.root ? 'config file' : (presetRoot ? 'deployment preset' : 'default'))
  }
}

export function saveStorageConfig(config) {
  const next = {
    mode: normaliseMode(config?.mode),
    root: String(config?.root || '').trim() || null
  }
  if (next.mode === 'shared' && !next.root) {
    throw new Error('A shared storage root is required (for example \\\\SERVER\\eNote\\files).')
  }
  const path = join(app.getPath('userData'), CONFIG_FILE)
  fs.writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
  return next
}

// The folder every managed file hangs off: the server root when one is
// configured, otherwise this computer's user-data folder.
export function resourcesRoot() {
  const config = getStorageConfig()
  if (config.mode === 'shared' && config.root) return config.root
  return app.getPath('userData')
}

// The folder for one kind of file. Created on demand — the root may be a share
// that the administrator creates later.
export function resourceDir(kind, { create = true } = {}) {
  if (!RESOURCE_KINDS.includes(kind)) throw new Error(`Unknown resource kind: ${kind}`)
  const dir = join(resourcesRoot(), kind)
  if (create) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      console.warn(`Could not create the ${kind} folder at ${dir}:`, err.message)
      // On a share this usually means the SMB session expired. Ask for a new
      // one in the background; the next call finds the folder.
      scheduleShareReconnect(resourcesRoot())
    }
  }
  return dir
}

// A folder name made from a database code or a label. Files end up on a share
// that Windows workstations also read, so every segment has to be a legal
// Windows name: no reserved punctuation, no trailing dot or space, and no
// device name (CON, NUL, COM1…). The value keeps its case and its non-ASCII
// letters, so an Arabic label stays readable.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function safePathSegment(value, fallback = 'GENERAL') {
  let segment = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 60)
  if (!segment) segment = fallback
  if (WINDOWS_RESERVED.test(segment)) segment = `_${segment}`
  return segment
}

// The file name saved inside a folder. Unlike a folder name it may keep its
// spaces and dots; only the characters that cannot appear in a path are
// replaced.
const safeFileName = (value) => {
  const name = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[\s.]+$/g, '')
    .trim()
  return name || 'file'
}

// A folder below the kind's root, created on demand. `documents` and `library`
// are filed by curriculum and by shelf, so the caller passes the segments that
// describe the file and gets back the folder it belongs in.
export function resourceSubdir(kind, segments = []) {
  const clean = segments.filter(Boolean).map((segment) => safePathSegment(segment))
  const dir = join(resourceDir(kind), ...clean)
  if (clean.length) {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (err) {
      console.warn(`Could not create the ${kind} folder at ${dir}:`, err.message)
    }
  }
  return dir
}

// A file name built from everything the record knows about the file, so a file
// opened straight on the share still says what it is. Parts are cleaned for a
// Windows share, repeated parts are dropped, and the name is capped so a long
// label cannot push the path past the share's limit. The extension is kept.
const MAX_RESOURCE_FILE_NAME = 150

export function resourceFileName(parts, extension = '') {
  const seen = new Set()
  const cleaned = []
  for (const part of parts) {
    if (part === null || part === undefined || String(part).trim() === '') continue
    const segment = safeFileName(part)
      .replace(/^[._\s-]+|[._\s-]+$/g, '')
      .trim()
    if (!segment) continue
    const key = segment.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push(segment)
  }

  const ext = extension
    ? (String(extension).startsWith('.') ? String(extension) : `.${extension}`)
    : ''
  const limit = Math.max(32, MAX_RESOURCE_FILE_NAME - ext.length)
  const characters = [...(cleaned.join('_') || 'file')]
  const stem = (characters.length > limit ? characters.slice(0, limit).join('') : characters.join(''))
    .replace(/[._\s-]+$/g, '')
  return `${stem || 'file'}${ext}`
}

// A free destination for a new file: <kind>/<segments…>/<name>_<timestamp>.
// The timestamp comes last so the name stays readable from its first character,
// and it keeps two uploads with the same name from overwriting one another.
export function newResourceFile(kind, segments, fileName) {
  const dir = resourceSubdir(kind, segments)
  const base = safeFileName(fileName)
  const extension = extname(base)
  const stem = extension ? base.slice(0, -extension.length) : base
  const stamp = Date.now()
  let destination = join(dir, `${stem}_${stamp}${extension}`)
  let suffix = 1
  while (fs.existsSync(destination)) {
    destination = join(dir, `${stem}_${stamp}_${suffix++}${extension}`)
  }
  return destination
}

const samePath = (left, right) => {
  const normalise = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  return normalise(left) === normalise(right)
}

// Move an already stored file into the folder that now describes it, keeping
// its file name. Used when an edited Library item changes type or category, so
// the shelf on disk keeps matching the catalogue. Returns the (possibly
// unchanged) absolute path.
export function moveResourceFile(storedPath, kind, segments = []) {
  const targetDir = resourceSubdir(kind, segments)
  if (samePath(dirname(storedPath), targetDir)) return storedPath

  const base = basename(storedPath)
  const extension = extname(base)
  const stem = extension ? base.slice(0, -extension.length) : base
  let target = join(targetDir, base)
  let suffix = 1
  while (fs.existsSync(target) && !samePath(target, storedPath)) {
    target = join(targetDir, `${stem}_${suffix++}${extension}`)
  }

  try {
    fs.renameSync(storedPath, target)
  } catch (err) {
    // Different volumes (a local file moving to a mounted share) cannot be
    // renamed; copy it and remove the old copy only when the copy succeeded.
    fs.copyFileSync(storedPath, target)
    fs.unlinkSync(storedPath)
  }
  return target
}

// Last-resort lookup for a row whose stored key no longer matches the file's
// folder: walk the kind's tree looking for the file name. Depth is capped so a
// misconfigured root cannot turn one open into a full-disk scan.
const findFileInTree = (dir, name, depth = 0) => {
  if (depth > 4) return null
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    return null
  }
  const wanted = process.platform === 'win32' ? name.toLowerCase() : name
  const matches = (candidate) => (process.platform === 'win32' ? candidate.toLowerCase() : candidate) === wanted

  for (const entry of entries) {
    if (entry.isFile() && matches(entry.name)) return join(dir, entry.name)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = findFileInTree(join(dir, entry.name), name, depth + 1)
    if (found) return found
  }
  return null
}

const looksAbsolute = (value) =>
  isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value)

const toKeyPath = (value) => String(value).split(sep).join('/')

// The key stored in the database for a file: its path relative to the kind's
// folder, always with forward slashes so a row written on Windows reads the
// same anywhere.
export function toStoredKey(kind, absolutePath) {
  const name = basename(absolutePath)
  try {
    const rel = relative(resourceDir(kind, { create: false }), absolutePath)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return `${kind}/${toKeyPath(rel)}`
    }
  } catch (err) {
    // Different volumes: fall through to the bare file name.
  }
  return `${kind}/${name}`
}

// The file behind a stored value, or null when it cannot be found:
//   1. an absolute path written by an older build, if it still exists;
//   2. a key, resolved against the configured root;
//   3. a file of that name inside the kind's folder or one of its subfolders —
//      the folder may have been renamed or the rows may come from a machine
//      whose root was different.
// `managedName` limits step 3 to names this application itself writes.
export function resolveStoredResource(value, kind, { managedName = null } = {}) {
  const stored = String(value || '').trim()
  if (!stored || /^https?:\/\//i.test(stored)) return null

  try {
    if (looksAbsolute(stored)) {
      if (fs.existsSync(stored)) return stored
    } else {
      const candidate = join(resourcesRoot(), stored)
      if (fs.existsSync(candidate)) return candidate
    }

    const name = basename(stored)
    if (managedName && !managedName.test(name)) return null
    const fallback = join(resourceDir(kind, { create: false }), name)
    if (fs.existsSync(fallback)) return fallback
    // Older flat folders and hand-reorganised shares: the file may now sit one
    // or two folders deeper, so look for it by name.
    const deeper = findFileInTree(resourceDir(kind, { create: false }), name)
    // A file that is nowhere on an unreachable share looks exactly like a file
    // that was never saved. Re-open the session so the next look can tell.
    if (!deeper) scheduleShareReconnect(resourcesRoot())
    return deeper
  } catch (err) {
    return null
  }
}

// What the app can say about storage at startup: mode, root, and whether the
// files can actually be reached and written. A share that is down looks exactly
// like "every photo is missing", so this is worth a line in the log.
export function describeStorage() {
  const config = getStorageConfig()
  const root = resourcesRoot()
  let reachable = false
  let writable = false
  try {
    reachable = fs.existsSync(root)
    if (reachable) {
      fs.accessSync(root, fs.constants.W_OK)
      writable = true
    }
  } catch (err) {
    writable = false
  }

  const where = config.mode === 'shared'
    ? `shared root ${root} (${config.source})`
    : `this computer (${root})`
  // Only a share has a session to report; a local root that is missing is a
  // folder problem, not a sign-in problem.
  const share = shareSessionStatus()
  const why = config.mode === 'shared' ? ` (${share.message})` : ''
  return {
    ...config,
    root,
    reachable,
    writable,
    share,
    ok: reachable && writable,
    summary: reachable
      ? `${where} — ${writable ? 'reachable and writable' : 'read-only'}`
      : `${where} — NOT reachable${why}`
  }
}

// Called once at startup: logs the resolved root and warms the folders so a
// misconfigured share is reported before the first photo is saved.
export async function initStorage() {
  // A share this computer has no session with reads as an empty folder. Open
  // the session with the account from the deployment preset before anything
  // asks for a photo or a document.
  if (getStorageConfig().mode === 'shared') {
    const session = await ensureShareSession(resourcesRoot())
    if (!session.ok) console.warn(`Shared storage is not open: ${session.message}`)
  }

  const status = describeStorage()
  if (status.ok) {
    console.log(`Resource storage: ${status.summary}`)
  } else {
    console.warn(`Resource storage: ${status.summary}. Files cannot be stored until it is available.`)
  }
  if (status.mode === 'shared') {
    for (const kind of RESOURCE_KINDS) resourceDir(kind)
  }
  return status
}
