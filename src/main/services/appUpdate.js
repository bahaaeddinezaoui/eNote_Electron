import { app } from 'electron'
import { join, basename } from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { getStorageConfig } from './resourceStorage'
import { getUpdateStatus as getGateStatus, compareVersions } from './updateGateService'

// Automatic client update from the LAN share.
//
// Releases are published to <storage root>\installers on the server share: the
// installer plus a small latest.json manifest describing it. When the version
// gate says this client is too old, the client copies the installer from the
// share into a local temporary folder, checks it against the manifest's
// SHA-256, and only then runs it — silently, reusing the existing installation,
// and starting eNote again afterwards.
//
// Windows only: the NSIS installer is the one artifact that can replace a
// running installation on its own. Elsewhere the renderer falls back to opening
// the installers folder.
//
// The manifest the administrator writes beside the installer:
//   { "version": "4.0.1", "file": "eNote Setup 4.0.1.exe", "sha256": "…" }
const MANIFEST_FILE = 'latest.json'
const LOCAL_DIR = 'enote-update'

// Where releases are published. Without a shared root there is nothing to
// update from and the renderer only offers the installers folder.
function installersDir() {
  const config = getStorageConfig()
  if (config.mode !== 'shared' || !config.root) return null
  return join(config.root, 'installers')
}

export function readManifest() {
  const dir = installersDir()
  if (!dir) return null
  try {
    const manifest = JSON.parse(fs.readFileSync(join(dir, MANIFEST_FILE), 'utf8'))
    return manifest && typeof manifest === 'object' ? manifest : null
  } catch {
    // Absent or malformed: automatic updating switches itself off, nothing else.
    return null
  }
}

// The release this client could install, or null. The file name must be a bare
// name so a manifest can never point outside the installers folder.
function autoUpdateTarget() {
  if (process.platform !== 'win32') return null
  const manifest = readManifest()
  if (!manifest) return null
  const version = String(manifest.version || '').trim()
  const file = String(manifest.file || '').trim()
  const sha256 = String(manifest.sha256 || '').trim().toLowerCase()
  if (!version || !file || basename(file) !== file) return null
  return { version, file, sha256 }
}

// The installer already copied and verified on this computer.
let readyInstaller = null
let inFlight = null
const progressListeners = new Set()

function emitProgress(percent) {
  for (const listener of progressListeners) {
    try {
      listener(percent)
    } catch {
      // A closed window must not abort the copy.
    }
  }
}

// Streams the installer to a local file, hashing as it goes, so the checksum
// costs no second read of a file that may be a hundred megabytes over the
// network.
function copyAndVerify(source, dest, expectedHash) {
  return new Promise((resolve, reject) => {
    const total = fs.statSync(source).size || 0
    const hash = crypto.createHash('sha256')
    let copied = 0
    let lastPercent = -1

    const reader = fs.createReadStream(source)
    const writer = fs.createWriteStream(dest)

    reader.on('data', (chunk) => {
      copied += chunk.length
      hash.update(chunk)
      if (total > 0) {
        const percent = Math.min(99, Math.round((copied / total) * 100))
        if (percent !== lastPercent) {
          lastPercent = percent
          emitProgress(percent)
        }
      }
    })
    reader.on('error', reject)
    writer.on('error', reject)
    writer.on('close', () => {
      const digest = hash.digest('hex')
      if (expectedHash && digest !== expectedHash) {
        reject(new Error('checksum'))
        return
      }
      emitProgress(100)
      resolve(digest)
    })

    reader.pipe(writer)
  })
}

async function runDownload() {
  const target = autoUpdateTarget()
  if (!target) return { ok: false, error: 'no-release' }
  if (readyInstaller?.version === target.version) {
    return { ok: true, version: target.version }
  }
  readyInstaller = null

  const dir = installersDir()
  const source = join(dir, target.file)
  if (!fs.existsSync(source)) return { ok: false, error: 'missing-file' }

  const destDir = join(app.getPath('temp'), LOCAL_DIR)
  fs.mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, target.file)

  try {
    await copyAndVerify(source, dest, target.sha256)
  } catch (err) {
    try {
      fs.rmSync(dest, { force: true })
    } catch {
      // Leftover file in our own temp folder; harmless.
    }
    return { ok: false, error: err.message === 'checksum' ? 'checksum' : 'copy-failed' }
  }

  readyInstaller = { version: target.version, path: dest }
  return { ok: true, version: target.version }
}

// Everything the renderer needs to decide what to show.
export async function getUpdateInfo() {
  const gate = await getGateStatus()
  const info = {
    ...gate,
    canAutoUpdate: false,
    targetVersion: '',
    updateReady: false
  }
  if (!gate.required) return info

  const target = autoUpdateTarget()
  if (!target) return info
  // A manifest no newer than the running build is not an update.
  if (compareVersions(target.version, gate.currentVersion) <= 0) return info

  return {
    ...info,
    canAutoUpdate: true,
    targetVersion: target.version,
    updateReady: readyInstaller?.version === target.version
  }
}

// Copies and verifies the release. Concurrent callers share one copy, and
// every caller's `onProgress` sees the same percentages.
export async function downloadUpdate(onProgress) {
  if (onProgress) progressListeners.add(onProgress)
  try {
    if (inFlight) return await inFlight
    inFlight = runDownload()
    try {
      return await inFlight
    } finally {
      inFlight = null
    }
  } finally {
    if (onProgress) progressListeners.delete(onProgress)
  }
}

// Runs the verified installer and lets it replace this installation. The flags
// are the ones electron-builder's NSIS script understands: /S silent,
// --updated reuses the previous location and does not need the interactive
// pages, --force-run starts eNote again once the files are in place.
export function installUpdate() {
  if (!readyInstaller) return { ok: false, error: 'not-ready' }

  const child = spawn(readyInstaller.path, ['/S', '--updated', '--force-run'], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()

  // Give the installer a moment to get going before the window disappears; if
  // this process lingers, the installer closes it itself.
  setTimeout(() => app.quit(), 400)
  return { ok: true }
}
