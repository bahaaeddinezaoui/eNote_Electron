import { spawn } from 'child_process'
import fs from 'fs'
import { getDeploymentInfo } from '../deployment'

// The shared storage root is a Windows share (\\SERVER\eNoteFiles). Windows
// opens a share only for an account that already has an SMB session with the
// server, and a freshly imaged workstation has none: the drive was never
// mapped, no one typed the share password on that machine, so every photo and
// document resolves to "missing" while PostgreSQL answers normally.
//
// Rather than asking each user to map a drive by hand, the application opens
// the session itself, using the account an administrator put in the machine-wide
// deployment preset (or in the environment):
//
//   deployment.json  { "smbUser": "enote_files", "smbPassword": "...",
//                      "storageRoot": "\\\\SERVER\\eNoteFiles" }
//   ENOTE_SMB_USER / ENOTE_SMB_PASSWORD   override the file
//
// The session is opened once at startup and again, at most every RETRY_AFTER_MS,
// when a file operation cannot find the share — so a server that comes up after
// the workstations keeps working without a restart.
//
// Limits worth knowing:
//   - the password is an argument to `net use`, so it is visible to the same
//     machine's administrators while the call runs. It is never logged.
//   - a session another account already holds (error 1219) is reported, not
//     deleted: the other mapping may belong to something else on the machine.
//   - Linux workstations mount the share through CIFS at boot (deployment
//     guide, step 6.3); mounting needs root, so the app only reports it.

const RETRY_AFTER_MS = 20 * 1000
// Bounded because startup waits for the first attempt: a server that is off
// must delay the window by seconds, not by the whole logon timeout.
const CONNECT_TIMEOUT_MS = 8 * 1000

const shareOf = (root) => {
  const match = /^\\\\([^\\/]+)[\\/]([^\\/]+)/.exec(String(root || '').trim())
  if (!match) return null
  return { host: match[1], share: match[2], unc: `\\\\${match[1]}\\${match[2]}` }
}

// The account the app signs in with. The environment wins so a technician can
// fix one machine without editing the preset.
export function getShareCredentials() {
  const envUser = String(process.env.ENOTE_SMB_USER || '').trim()
  if (envUser) {
    return { user: envUser, password: String(process.env.ENOTE_SMB_PASSWORD ?? ''), source: 'environment' }
  }
  try {
    const preset = getDeploymentInfo()
    const user = String(preset?.smbUser || '').trim()
    if (user) return { user, password: String(preset.smbPassword ?? ''), source: 'deployment preset' }
  } catch {
    // No preset in a plain Node process (scripts, tests).
  }
  return null
}

// Windows' own words for the failures a share produces, so the log and the
// storage status can say "the password was refused" instead of "not reachable".
const FAILURES = {
  5: ['access-denied', 'the account may not open this share'],
  53: ['share-missing', 'the server answered but the share name was not found'],
  67: ['server-unreachable', 'the server did not answer for the share'],
  1219: ['conflicting-session', 'another account already has a session with this server'],
  1231: ['server-unreachable', 'the network path is not reachable'],
  1311: ['server-unreachable', 'no logon server could be reached'],
  1326: ['bad-credentials', 'the account or password was refused'],
  1327: ['bad-credentials', 'the account is not allowed to sign in here'],
  1909: ['bad-credentials', 'the share account is locked out']
}

const failureOf = (code, output) => {
  const reported = /system error (\d+)/i.exec(String(output || ''))
  const number = reported ? Number(reported[1]) : Number(code)
  return FAILURES[number] || ['failed', 'the share could not be opened']
}

function run(command, args, timeout = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ ok: false, code: null, output: error.message })
      return
    }
    let output = ''
    const collect = (chunk) => {
      output += chunk.toString()
      if (output.length > 2000) output = output.slice(-2000)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // Already gone.
      }
      finish({ ok: false, code: 'timeout', output })
    }, timeout)
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, code: null, output: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ ok: code === 0, code, output })
    })
  })
}

const canOpen = (root) => {
  try {
    fs.accessSync(root, fs.constants.R_OK)
    return true
  } catch {
    return false
  }
}

let lastAttemptAt = 0
let lastStatus = { ok: false, reason: 'unknown', message: 'the share has not been opened yet', host: null }
let inFlight = null

// The most recent outcome, for the storage status and the log.
export function shareSessionStatus() {
  return lastStatus
}

// Open the SMB session for `root` when it is a share this computer cannot
// already read. Safe to call often: an open share is detected without a
// subprocess, and a failed attempt is not repeated for RETRY_AFTER_MS.
export async function ensureShareSession(root, { force = false } = {}) {
  const share = shareOf(root)
  if (!share) {
    lastStatus = { ok: true, reason: 'local', message: 'this computer keeps the files itself', host: null }
    return lastStatus
  }
  if (canOpen(root)) {
    lastStatus = { ok: true, reason: 'available', message: `${share.unc} is open on this computer`, host: share.host }
    return lastStatus
  }
  if (inFlight) return inFlight

  const now = Date.now()
  if (!force && now - lastAttemptAt < RETRY_AFTER_MS) return lastStatus
  lastAttemptAt = now

  const credentials = getShareCredentials()
  if (process.platform !== 'win32') {
    lastStatus = {
      ok: false,
      reason: 'mount-required',
      message: `${share.unc} must be mounted on this computer (see the CIFS mount in the deployment guide)`,
      host: share.host
    }
    return lastStatus
  }
  if (!credentials) {
    lastStatus = {
      ok: false,
      reason: 'no-credentials',
      message: `${share.unc} needs a sign-in and no share account is configured (smbUser/smbPassword in deployment.json, or ENOTE_SMB_USER/ENOTE_SMB_PASSWORD)`,
      host: share.host
    }
    return lastStatus
  }

  inFlight = (async () => {
    // `/persistent:no`: the session serves this logon and installs no mapping
    // in the user's profile, so nothing is left behind for the next person.
    const result = await run('net', [
      'use',
      share.unc,
      credentials.password,
      `/user:${credentials.user}`,
      '/persistent:no'
    ])

    if (result.ok && canOpen(root)) {
      console.log(`Opened the storage share ${share.unc} as ${credentials.user} (${credentials.source}).`)
      return {
        ok: true,
        reason: 'connected',
        message: `${share.unc} opened as ${credentials.user}`,
        host: share.host
      }
    }

    const [reason, why] = failureOf(result.code, result.output)
    if (reason === 'conflicting-session') {
      return {
        ok: false,
        reason,
        message: `${why}; sign this computer out and in again, or run: net use ${share.unc} /delete`,
        host: share.host
      }
    }
    if (reason === 'bad-credentials') {
      return {
        ok: false,
        reason,
        message: `${share.unc} rejected the ${credentials.user} account: ${why}`,
        host: share.host
      }
    }
    return { ok: false, reason, message: `${share.unc}: ${why}`, host: share.host }
  })()
    .then((status) => {
      lastStatus = status
      return status
    })
    .catch((error) => {
      lastStatus = {
        ok: false,
        reason: 'failed',
        message: `${share.unc}: ${error.message}`,
        host: share.host
      }
      return lastStatus
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}

// A file operation missed: the share may have dropped since startup, or the
// session was never opened. Asked for in the background so the caller is not
// blocked; the next read finds the folder.
export function scheduleShareReconnect(root) {
  ensureShareSession(root).catch(() => {})
}
