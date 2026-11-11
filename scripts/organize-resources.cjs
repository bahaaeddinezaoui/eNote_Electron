// Moves files that were uploaded before the folder hierarchy existed into the
// folders the current build writes to.
//
//   node scripts/organize-resources.cjs                          dry run
//   node scripts/organize-resources.cjs --apply                  do it
//   node scripts/organize-resources.cjs --root \\SERVER\eNote\files --apply
//
// Before this change every file in documents/ and library/ sat directly in the
// kind's folder:
//
//   documents/1762345678_handout.pdf
//   library/1762345678_book.pdf
//
// The current build files them as:
//
//   documents/<MAJOR_CODE>/<CHAPTER_CODE>/<LESSON_CODE>/<codes>_<labels>_<file>_<timestamp>
//   library/<TYPE_CODE>/<CATEGORY_CODE>/<TYPE>_<CATEGORY>_<title>_<file>_<timestamp>
//
// The script moves each file into its folder and rewrites the row that points
// at it (document.document_path / library_item.file_path). Files that are
// already in the right folder are left alone. A dry run only reports what it
// would do; pass --apply to move the files and update the database.
//
// The storage root is taken from --root, then ENOTE_RESOURCE_ROOT, then
// storage_config.json, then a deployment preset, and finally this computer's
// user-data folder. A file that cannot be found is left alone: it may belong to
// another workstation, and pointing the row at a file that does not exist would
// only hide the problem. Run it while the application is closed on the
// workstations, so no window is reading a file while it moves.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APP_FOLDERS = ['enote', 'eNote', 'istudy', 'iStudy']
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

const parseArgs = (argv) => {
  const args = { root: null, appData: null, apply: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apply') args.apply = true
    else if (arg === '--root') args.root = argv[++i]
    else if (arg.startsWith('--root=')) args.root = arg.slice('--root='.length)
    else if (arg === '--app-data') args.appData = argv[++i]
    else if (arg.startsWith('--app-data=')) args.appData = arg.slice('--app-data='.length)
  }
  return args
}

const appDataRoot = (override) => {
  if (override) return override
  if (process.env.APPDATA) return process.env.APPDATA
  if (process.platform !== 'win32') {
    return process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '', '.config')
  }
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return path.join(home, 'AppData', 'Roaming')
}

// The user-data folder that holds this installation's storage_config.json and
// pg_config.json.
const findUserData = (root) => {
  for (const folder of APP_FOLDERS) {
    const candidate = path.join(root, folder)
    if (!fs.existsSync(candidate)) continue
    if (fs.existsSync(path.join(candidate, 'pg_config.json'))) return candidate
  }
  for (const folder of APP_FOLDERS) {
    const candidate = path.join(root, folder)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const resolveRoot = (userData, explicit) => {
  if (explicit) return path.resolve(String(explicit).replace(/^"|"$/g, ''))
  const fromEnv = String(process.env.ENOTE_RESOURCE_ROOT || '').trim()
  if (fromEnv) return path.resolve(fromEnv)

  const config = readJson(path.join(userData, 'storage_config.json')) || {}
  if (config.mode === 'shared' && config.root) return path.resolve(config.root)

  // No per-user choice: accept the machine-wide deployment preset, as the
  // application does when it starts.
  if (!config.mode) {
    const candidates = []
    if (process.env.ENOTE_DEPLOYMENT_FILE) candidates.push(process.env.ENOTE_DEPLOYMENT_FILE)
    if (process.env.ProgramData) candidates.push(path.join(process.env.ProgramData, 'eNote', 'deployment.json'))
    candidates.push(path.join(userData, 'deployment.json'))
    for (const file of candidates) {
      const preset = readJson(file)
      const presetRoot = preset?.storageRoot || preset?.resourceRoot
      if (presetRoot) return path.resolve(String(presetRoot))
    }
  }
  return userData
}

const safeSegment = (value, fallback) => {
  let segment = String(value ?? '')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 60)
  if (!segment) segment = fallback
  if (WINDOWS_RESERVED.test(segment)) segment = `_${segment}`
  return segment
}

const keyPath = (value) => value.split(path.sep).join('/')

const isAbsolutePath = (value) =>
  path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')

// Every file below `dir`, capped so a bad root cannot scan a whole disk.
const findInTree = (dir, name, depth = 0) => {
  if (depth > 4) return null
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const equal = (candidate) =>
    process.platform === 'win32'
      ? candidate.toLowerCase() === name.toLowerCase()
      : candidate === name
  for (const entry of entries) {
    if (entry.isFile() && equal(entry.name)) return path.join(dir, entry.name)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = findInTree(path.join(dir, entry.name), name, depth + 1)
    if (found) return found
  }
  return null
}

// The file behind a stored key, whether the row holds a portable key or the
// absolute path written by an older build.
const resolveStored = (root, kind, stored) => {
  const value = String(stored || '').trim()
  if (!value) return null
  const direct = isAbsolutePath(value) ? value : path.join(root, value)
  if (fs.existsSync(direct)) return direct
  return findInTree(path.join(root, kind), path.basename(value))
}

const uniqueTarget = (dir, name) => {
  const extension = path.extname(name)
  const stem = extension ? name.slice(0, -extension.length) : name
  let target = path.join(dir, name)
  let suffix = 1
  while (fs.existsSync(target)) {
    target = path.join(dir, `${stem}_${suffix++}${extension}`)
  }
  return target
}

const moveFile = (from, to) => {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch {
    // A local file moving onto a mounted share cannot be renamed; copy first so
    // a failure never deletes the only copy.
    fs.copyFileSync(from, to)
    fs.unlinkSync(from)
  }
}

const sameDir = (left, right) => {
  const normalise = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  return normalise(path.dirname(left)) === normalise(right)
}

// Move one row's file and return the new portable key, or null when there is
// nothing to do / the file cannot be found.
const refile = ({ root, kind, stored, segments, apply, label }) => {
  const file = resolveStored(root, kind, stored)
  if (!file) return { missing: true }

  const targetDir = path.join(root, kind, ...segments.filter(Boolean).map((s) => safeSegment(s, 'GENERAL')))
  if (sameDir(file, targetDir)) return { unchanged: true }

  const target = uniqueTarget(targetDir, path.basename(file))
  const key = keyPath(path.relative(root, target))
  console.log(`  ${label}: ${path.relative(root, file)} -> ${key}`)
  if (apply) {
    try {
      moveFile(file, target)
    } catch (error) {
      console.warn(`  ${label}: could not move (${error.message})`)
      return { failed: true }
    }
  }
  return { key }
}

const organizeLibrary = async (client, { root, apply }) => {
  let rows
  try {
    rows = (await client.query(`
      SELECT li.library_item_id AS id, li.file_path AS stored, li.item_type_code AS type_code,
             c.category_code
        FROM library_item li
        LEFT JOIN library_category c ON c.library_category_id = li.library_category_id
       WHERE li.file_path IS NOT NULL
       ORDER BY li.library_item_id`)).rows
  } catch (error) {
    console.log(`library        skipped (${error.message})`)
    return { moved: 0, unchanged: 0, missing: 0, failed: 0 }
  }

  let moved = 0
  let unchanged = 0
  let missing = 0
  let failed = 0
  for (const row of rows) {
    const segments = [row.type_code || 'BOOK', row.category_code || 'UNCATEGORISED']
    const result = refile({
      root,
      kind: 'library',
      stored: row.stored,
      segments,
      apply,
      label: `library#${row.id}`
    })
    if (result.missing) {
      missing += 1
      continue
    }
    if (result.unchanged) {
      unchanged += 1
      continue
    }
    if (result.failed) {
      failed += 1
      continue
    }
    moved += 1
    if (apply) {
      await client.query('UPDATE library_item SET file_path = $1 WHERE library_item_id = $2', [result.key, row.id])
    }
  }
  return { moved, unchanged, missing, failed }
}

const organizeDocuments = async (client, { root, apply }) => {
  let rows
  try {
    rows = (await client.query(`
      SELECT DISTINCT ON (d.document_id)
             d.document_id AS id, d.document_path AS stored,
             l.lesson_id, l.lesson_code, c.chapter_id, c.chapter_code,
             m.major_id, m.major_code
        FROM document d
        LEFT JOIN lesson_has_document lhd ON lhd.document_id = d.document_id
        LEFT JOIN lesson l ON l.lesson_id = lhd.lesson_id
        LEFT JOIN chapter c ON c.chapter_id = l.chapter_id
        LEFT JOIN major m ON m.major_id = c.major_id
       WHERE d.document_path IS NOT NULL
       ORDER BY d.document_id, l.lesson_id`)).rows
  } catch (error) {
    console.log(`documents      skipped (${error.message})`)
    return { moved: 0, unchanged: 0, missing: 0, failed: 0 }
  }

  let moved = 0
  let unchanged = 0
  let missing = 0
  let failed = 0
  for (const row of rows) {
    const segments = row.lesson_id
      ? [
          row.major_code || `MAJOR_${row.major_id}`,
          row.chapter_code || `CHAPTER_${row.chapter_id}`,
          row.lesson_code || `LESSON_${row.lesson_id}`
        ]
      : ['GENERAL']
    const result = refile({
      root,
      kind: 'documents',
      stored: row.stored,
      segments,
      apply,
      label: `document#${row.id}`
    })
    if (result.missing) {
      missing += 1
      continue
    }
    if (result.unchanged) {
      unchanged += 1
      continue
    }
    if (result.failed) {
      failed += 1
      continue
    }
    moved += 1
    if (apply) {
      await client.query('UPDATE document SET document_path = $1 WHERE document_id = $2', [result.key, row.id])
    }
  }
  return { moved, unchanged, missing, failed }
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  const userData = findUserData(appDataRoot(args.appData))
  if (!userData) {
    console.error('Could not find this installation\'s user-data folder (looked for enote / istudy under APPDATA).')
    process.exit(1)
  }

  const root = resolveRoot(userData, args.root)
  if (!fs.existsSync(root)) {
    console.error(`The storage root does not exist: ${root}`)
    process.exit(1)
  }

  const configPath = path.join(userData, 'pg_config.json')
  if (!fs.existsSync(configPath)) {
    console.error(`No pg_config.json in ${userData}; connect the application to the database first.`)
    process.exit(1)
  }

  console.log(`user data  ${userData}`)
  console.log(`storage    ${root}`)
  console.log(`mode       ${args.apply ? 'APPLY (files moved, rows rewritten)' : 'dry run (nothing is written)'}`)

  const client = new Client(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  await client.connect()

  const library = await organizeLibrary(client, { root, apply: args.apply })
  const documents = await organizeDocuments(client, { root, apply: args.apply })

  for (const [name, stats] of [['library', library], ['documents', documents]]) {
    console.log(`${name.padEnd(14)} moved ${String(stats.moved).padStart(4)} | already filed ${String(stats.unchanged).padStart(4)} | not on this disk ${stats.missing} | failed ${stats.failed}`)
  }
  if (!args.apply) console.log('Re-run the same command with --apply once the plan looks right.')

  await client.end()
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
