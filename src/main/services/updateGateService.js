import { app } from 'electron'
import { query } from '../db'

// Client version gate.
//
// The application runs on several workstations against one PostgreSQL server
// and has no internet connection: nothing pulls a release onto the other
// machines. The administrator records, in the shared database, the oldest
// client version that may still use the server; every client reads it here and
// refuses to go further while it is older.
//
// The value lives in the same key/value store as the other global options
// (app_option, see settingsService) and is empty by default: no gate until an
// administrator sets one.

const OPTION_KEY = 'required_client_version'

// "4.0.1" -> [4, 0, 1]. A part that is not a number counts as 0, so a malformed
// value can never make a client look newer than it is.
function parseVersion(value) {
  return String(value || '')
    .trim()
    .split('.')
    .map((part) => {
      const n = parseInt(part, 10)
      return Number.isFinite(n) ? n : 0
    })
}

// < 0 when `a` is older than `b`, 0 when equal, > 0 when newer.
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

export async function getRequiredClientVersion() {
  const res = await query(
    `SELECT option_value FROM app_option WHERE option_key = $1`,
    [OPTION_KEY]
  )
  return String(res?.data?.[0]?.OPTION_VALUE || '').trim()
}

// What the renderer should know about this client. A database it cannot read
// yields "no gate": an unreachable server must never masquerade as "update
// required", or a blip would lock every workstation out of the application.
export async function getUpdateStatus() {
  const currentVersion = app.getVersion()
  let requiredVersion = ''
  try {
    requiredVersion = await getRequiredClientVersion()
  } catch {
    return { currentVersion, requiredVersion: '', required: false }
  }
  if (!requiredVersion) {
    return { currentVersion, requiredVersion: '', required: false }
  }
  return {
    currentVersion,
    requiredVersion,
    required: compareVersions(currentVersion, requiredVersion) < 0
  }
}
