import fs from 'fs'
import { join, dirname } from 'path'
import { app, safeStorage } from 'electron'
import bcrypt from 'bcryptjs'

// Signing in while the server is unreachable.
//
// The login screen normally asks PostgreSQL who the account is. During an
// outage it asks this file instead: the credential of the ONE account that
// signed in last on this computer, kept so a secretary or teacher can reach
// their saved records without waiting for the server.
//
// What is stored is the password hash the database already holds (bcrypt), never
// the password. It is encrypted with the operating-system key store
// (Electron safeStorage, the same mechanism the direct-message key uses), and
// falls back to an owner-only file where no key store exists. Roles and the
// session payload are stored beside it so the interface can open exactly the
// pages that account had.
//
// Three deliberate limits:
//   - one account per machine, the last to sign in, so a shared workstation
//     does not accumulate credentials;
//   - an old copy (90 days) refuses to sign in and asks for a connection;
//   - five wrong passwords in a row while offline lock offline sign-in until
//     the server answers again, so the cached hash cannot be guessed freely.

const FILE_NAME = 'offline-sign-in.json'
const FORMAT_VERSION = 1
const MAX_AGE_DAYS = 90
const MAX_OFFLINE_ATTEMPTS = 5

let overriddenDirectory = null

export function configureOfflineAuthDirectory(path) {
  overriddenDirectory = path || null
}

function filePath() {
  const dir = overriddenDirectory || app.getPath('userData')
  return join(dir, FILE_NAME)
}

function safeStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function encode(payload) {
  const json = JSON.stringify(payload)
  if (safeStorageAvailable()) {
    try {
      return {
        version: FORMAT_VERSION,
        protection: 'safeStorage',
        payload: safeStorage.encryptString(json).toString('base64')
      }
    } catch (error) {
      console.warn('Could not encrypt the offline sign-in record:', error.message)
    }
  }
  return { version: FORMAT_VERSION, protection: 'plain', payload: Buffer.from(json, 'utf8').toString('base64') }
}

function decode(stored) {
  if (!stored || typeof stored !== 'object') return null
  if (stored.protection === 'safeStorage') {
    if (!safeStorageAvailable()) return null
    try {
      return JSON.parse(safeStorage.decryptString(Buffer.from(stored.payload, 'base64')))
    } catch (error) {
      // A copied profile or a reset account: the file is useless now. It is
      // removed so the next online sign-in simply writes a new one.
      console.warn('The offline sign-in record could not be decrypted:', error.message)
      return null
    }
  }
  try {
    return JSON.parse(Buffer.from(stored.payload, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function read() {
  try {
    const path = filePath()
    if (!fs.existsSync(path)) return null
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'))
    const payload = decode(parsed)
    if (!payload || !payload.username || !payload.passwordHash || !payload.user) return null
    return payload
  } catch (error) {
    console.warn('Could not read the offline sign-in record:', error.message)
    return null
  }
}

function write(payload) {
  const path = filePath()
  fs.mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(encode(payload), null, 2), { mode: 0o600 })
  fs.renameSync(temporary, path)
  try {
    fs.chmodSync(path, 0o600)
  } catch {
    // Windows already limits the file to the account that owns the profile.
  }
}

// Called after every successful online sign-in. It replaces the previous
// record, so a shared workstation keeps one account and an administrator's
// password reset takes effect at the next online sign-in.
export function rememberSignIn(user, passwordHash) {
  if (!user?.id || !user?.username || !passwordHash) return false
  try {
    write({
      savedAt: Date.now(),
      userId: user.id,
      personId: user.personId ?? null,
      username: user.username,
      passwordHash,
      user,
      failedAttempts: 0
    })
    return true
  } catch (error) {
    console.warn('Could not keep the offline sign-in record:', error.message)
    return false
  }
}

// What the sign-in screen may mention before anybody types: which account can
// sign in here without the server.
export function describeOfflineSignIn() {
  const stored = read()
  if (!stored) return null
  const age = Date.now() - Number(stored.savedAt || 0)
  return {
    username: stored.username,
    savedAt: Number(stored.savedAt) || null,
    expired: age > MAX_AGE_DAYS * 86400000,
    locked: Number(stored.failedAttempts || 0) >= MAX_OFFLINE_ATTEMPTS
  }
}

export function getRememberedUser() {
  const stored = read()
  return stored ? { userId: stored.userId, username: stored.username } : null
}

export function clearOfflineSignIn() {
  try {
    fs.rmSync(filePath(), { force: true })
  } catch (error) {
    console.warn('Could not remove the offline sign-in record:', error.message)
  }
}

// Verify a sign-in against the saved credential. Returns null when this
// computer has never completed a sign-in, so the caller can say so plainly.
export async function verifyOfflineSignIn(username, password) {
  const stored = read()
  if (!stored) return null

  const wanted = String(username ?? '').trim().toLowerCase()
  const known = String(stored.username ?? '').trim().toLowerCase()

  if (wanted && wanted !== known) {
    return {
      success: false,
      offline: true,
      code: 'OFFLINE_OTHER_ACCOUNT',
      username: stored.username,
      message: `While the server is unreachable, only ${stored.username} — the last account to sign in on this computer — can sign in.`
    }
  }

  if (Date.now() - Number(stored.savedAt || 0) > MAX_AGE_DAYS * 86400000) {
    return {
      success: false,
      offline: true,
      code: 'OFFLINE_CREDENTIAL_EXPIRED',
      message: `The saved sign-in on this computer is more than ${MAX_AGE_DAYS} days old. Connect to the server once to sign in again.`
    }
  }

  const failed = Number(stored.failedAttempts || 0)
  if (failed >= MAX_OFFLINE_ATTEMPTS) {
    return {
      success: false,
      offline: true,
      code: 'OFFLINE_SIGN_IN_LOCKED',
      message: `Too many wrong passwords while the server was unreachable. Connect to the server to sign in again.`
    }
  }

  let matches = false
  try {
    matches = await bcrypt.compare(String(password ?? ''), stored.passwordHash)
  } catch {
    matches = false
  }

  if (!matches) {
    const attempts = failed + 1
    try {
      write({ ...stored, failedAttempts: attempts })
    } catch {
      /* the refusal below is what matters */
    }
    const remaining = Math.max(0, MAX_OFFLINE_ATTEMPTS - attempts)
    return {
      success: false,
      offline: true,
      code: 'INVALID_CREDENTIALS',
      attempts,
      remainingAttempts: remaining,
      message:
        remaining === 0
          ? 'Invalid credentials. Offline sign-in is now locked until the server answers again.'
          : `Invalid credentials. ${remaining} more attempt${remaining === 1 ? '' : 's'} before offline sign-in locks.`
    }
  }

  if (failed > 0) {
    try {
      write({ ...stored, failedAttempts: 0 })
    } catch {
      /* non-fatal */
    }
  }

  return {
    success: true,
    offline: true,
    user: { ...stored.user, offline: true }
  }
}
