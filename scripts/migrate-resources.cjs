// Moves the files this application manages onto the server's shared folder and
// rewrites the rows that point at them.
//
//   node scripts/migrate-resources.cjs --root \\SERVER\eNote\files            dry run
//   node scripts/migrate-resources.cjs --root \\SERVER\eNote\files --apply    do it
//
// What it does, in order:
//   1. copies person_photos / documents / library / screenshots from this
//      machine's user-data folder into <root>/<kind>/ (files already there are
//      skipped, and subfolders are copied as they are);
//   2. rewrites person.person_photo, document.document_path,
//      library_item.file_path and bug_report.report_screenshot_path from
//      absolute paths to the portable keys the application now stores
//      ("person_photos/12_Mohamed_Benali_….png", "documents/MAJOR/CHAPTER/LESSON/…");
//   3. with --apply, writes storage_config.json so this installation reads from
//      the share from now on.
//
// A row whose file is not on this machine (another computer's absolute path) is
// left exactly as it is: there is nothing to copy, and pointing it at a file
// that does not exist would only hide the problem.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const KINDS = [
  {
    kind: 'person_photos',
    select: 'SELECT person_id AS id, person_photo AS stored FROM person WHERE person_photo IS NOT NULL',
    update: 'UPDATE person SET person_photo = $1 WHERE person_id = $2'
  },
  {
    kind: 'documents',
    select: 'SELECT document_id AS id, document_path AS stored FROM document WHERE document_path IS NOT NULL',
    update: 'UPDATE document SET document_path = $1 WHERE document_id = $2'
  },
  {
    kind: 'library',
    select: 'SELECT library_item_id AS id, file_path AS stored FROM library_item WHERE file_path IS NOT NULL',
    update: 'UPDATE library_item SET file_path = $1 WHERE library_item_id = $2'
  },
  {
    kind: 'screenshots',
    select: 'SELECT report_id AS id, report_screenshot_path AS stored FROM bug_report WHERE report_screenshot_path IS NOT NULL',
    update: 'UPDATE bug_report SET report_screenshot_path = $1 WHERE report_id = $2'
  }
]

// The application was called iStudy before eNote: both folder names are tried.
const APP_FOLDERS = ['enote', 'eNote', 'istudy', 'iStudy']

const parseArgs = (argv) => {
  const args = { root: null, apply: false, appData: null }
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

// The user-data folder that actually holds this installation's files and its
// saved database connection.
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

// Relative paths of every file below `dir`, so a documents/MAJOR/LESSON tree is
// copied as a tree and not flattened.
const listFiles = (dir, base = '', out = []) => {
  if (!fs.existsSync(dir)) return out
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    const full = path.join(dir, name)
    let stat
    try {
      stat = fs.lstatSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) listFiles(full, path.join(base, name), out)
    else if (stat.isFile()) out.push(path.join(base, name))
  }
  return out
}

const isAbsolutePath = (value) =>
  path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')

const keyPath = (value) => value.split(path.sep).join('/')

const lower = (value) => String(value || '').toLowerCase()

const main = async () => {
  const args = parseArgs(process.argv.slice(2))
  if (!args.root) {
    console.error('Missing --root: the shared folder on the server, e.g. --root \\\\SERVER\\eNote\\files')
    process.exit(1)
  }
  const root = path.resolve(args.root.replace(/^"|"$/g, ''))
  if (!fs.existsSync(root)) {
    console.error(`The storage root does not exist: ${root}`)
    console.error('Create it on the server (or map the share) and run this again.')
    process.exit(1)
  }

  const userData = findUserData(appDataRoot(args.appData))
  if (!userData) {
    console.error('Could not find this installation\'s user-data folder (looked for enote / istudy under APPDATA).')
    process.exit(1)
  }
  console.log(`source      ${userData}`)
  console.log(`destination ${root}`)
  console.log(`mode        ${args.apply ? 'APPLY (files copied, rows rewritten)' : 'dry run (nothing is written)'}`)

  const configPath = path.join(userData, 'pg_config.json')
  if (!fs.existsSync(configPath)) {
    console.error(`No pg_config.json in ${userData}; connect the application to the database first.`)
    process.exit(1)
  }
  const pgConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const client = new Client(pgConfig)
  await client.connect()

  let copiedTotal = 0
  let updatedTotal = 0
  let skippedTotal = 0

  for (const { kind, select, update } of KINDS) {
    const sourceDir = path.join(userData, kind)
    const targetDir = path.join(root, kind)
    const files = listFiles(sourceDir)
    // A file name can occur in more than one subfolder; the map says where.
    const byName = new Map()
    for (const rel of files) {
      const key = lower(path.basename(rel))
      const list = byName.get(key) || []
      list.push(rel)
      byName.set(key, list)
    }

    if (args.apply) fs.mkdirSync(targetDir, { recursive: true })

    let copied = 0
    for (const rel of files) {
      const from = path.join(sourceDir, rel)
      const to = path.join(targetDir, rel)
      let exists = false
      try {
        exists = fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size
      } catch {
        exists = false
      }
      if (exists) continue
      copied += 1
      if (args.apply) {
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.copyFileSync(from, to)
      }
    }

    let rows
    try {
      rows = (await client.query(select)).rows
    } catch (error) {
      // The Library table only exists once the Library page has been opened.
      console.log(`${kind.padEnd(14)} skipped (${error.message})`)
      continue
    }

    let updated = 0
    let skipped = 0
    for (const row of rows) {
      const stored = String(row.stored || '').trim()
      if (!stored) continue
      // Already a portable key: nothing to do. This includes the nested keys
      // written by the current build (documents/MAJOR/LESSON/…).
      if (!isAbsolutePath(stored)) continue

      const name = path.basename(stored)
      const matches = byName.get(lower(name)) || []
      const rel = matches.length ? (matches.includes(name) ? name : matches[0]) : null
      if (!rel) {
        skipped += 1
        continue
      }
      const target = path.join(targetDir, rel)
      const targetExists = args.apply ? fs.existsSync(target) : true
      if (!targetExists) {
        skipped += 1
        continue
      }
      updated += 1
      if (args.apply) {
        await client.query(update, [`${kind}/${keyPath(rel)}`, row.id])
      }
    }

    console.log(`${kind.padEnd(14)} files ${String(files.length).padStart(4)} → copy ${String(copied).padStart(4)} | rows ${String(rows.length).padStart(4)} → rewrite ${String(updated).padStart(4)} | left alone ${skipped}`)
    copiedTotal += copied
    updatedTotal += updated
    skippedTotal += skipped
  }

  if (args.apply) {
    const storageConfig = { mode: 'shared', root }
    fs.writeFileSync(path.join(userData, 'storage_config.json'), JSON.stringify(storageConfig, null, 2), 'utf8')
    console.log(`storage_config.json written: mode shared, root ${root}`)
  }

  console.log(`total: ${copiedTotal} file(s) ${args.apply ? 'copied' : 'to copy'}, ${updatedTotal} row(s) ${args.apply ? 'rewritten' : 'to rewrite'}, ${skippedTotal} row(s) left alone`)
  if (!args.apply) console.log('Re-run the same command with --apply once the destination looks right.')

  await client.end()
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
