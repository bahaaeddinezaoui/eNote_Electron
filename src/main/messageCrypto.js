import crypto from 'crypto'
import fs from 'fs'
import { join, dirname } from 'path'
import { app, safeStorage } from 'electron'

// Direct messages are encrypted at rest in the main process before they reach
// PostgreSQL. A message must stay readable by its two participants, so this is
// symmetric encryption (AES-256-GCM), not a one-way hash.
//
// Stored form (the `direct_message.message_body` text column):
//   istudy:enc:v1:<iv b64>:<auth tag b64>:<ciphertext b64>
// Rows written before this existed are plain text; the messaging service
// encrypts them on startup (see encryptStoredDirectMessages).
//
// The 32-byte key lives outside the database in the app's user-data folder so a
// database dump alone cannot reveal messages. Where the OS provides a key
// store (Electron safeStorage: DPAPI / Keychain / libsecret), the key file is
// itself encrypted by it; otherwise the key file is plain with owner-only
// permissions and is the single secret that must be backed up. If the OS
// keystore entry ever becomes unreadable (e.g. after a Windows account or
// profile change), the key file is moved aside and replaced with a fresh key
// so messaging keeps working; messages stored under the old key stay
// unreadable (see rotateUnreadableKeyFile).

// The marker keeps its original spelling on purpose: it is part of the stored
// ciphertext format, so every message already written as `istudy:enc:v1:` stays
// readable after the application was renamed to eNote.
export const MESSAGE_ENCRYPTION_PREFIX = 'istudy:enc:v1:'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_FILE = 'direct-message-key.json'

let cachedKey = null

// Kept beside the user-data folder, resolved from the same app name, so
// development and packaged builds of one installation share a single key and
// can read each other's messages. Back this file up separately from the
// database: without it stored messages cannot be recovered.
function keyFilePath() {
  return join(app.getPath('appData'), app.getName(), KEY_FILE)
}

function safeStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function decodeKeyFile(parsed) {
  if (!parsed || typeof parsed !== 'object' || !parsed.key) {
    throw new Error('The direct-message key file is invalid.')
  }

  let keyBase64 = parsed.key
  if (parsed.protection === 'safeStorage') {
    if (!safeStorageAvailable()) {
      const unavailable = new Error(
        'Direct messages are protected by the operating-system key store, which is unavailable on this machine.'
      )
      unavailable.keyStoreUnusable = true
      throw unavailable
    }
    try {
      keyBase64 = safeStorage.decryptString(Buffer.from(parsed.key, 'base64'))
    } catch (cause) {
      // The store wrote this file and now cannot read it back (a copied or
      // roaming profile, a reset account, a keystore that never really worked).
      // Flagged so the replacement is stored in the fallback format instead of
      // repeating the same failure on the next launch.
      const unreadable = new Error(`The operating-system key store could not decrypt the key: ${cause.message}`)
      unreadable.keyStoreUnusable = true
      throw unreadable
    }
  }

  const key = Buffer.from(String(keyBase64), 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error('The direct-message key file has an unexpected key size.')
  }
  return key
}

// The key file exists but is unusable: either its JSON is corrupt or the OS
// key store refuses to decrypt it. The latter happens when the file was
// written under a key-store context that no longer exists (a different
// account, a copied or roaming profile, a reset account). The old key cannot
// be recovered, and old messages are just as unreadable whether we keep
// refusing or not — so instead of bricking messaging permanently, move the
// unusable file aside and mint a fresh one. Nothing is shown to the user: the
// messages it protected are gone either way, and a modal that reappears on
// every launch is noise, not information. The log keeps the details.
function rotateUnreadableKeyFile(path, failure) {
  let backupPath = null
  try {
    backupPath = `${path}.unreadable-${Date.now()}`
    fs.renameSync(path, backupPath)
  } catch (err) {
    backupPath = null
    console.error('Could not move the unreadable direct-message key file aside:', err.message)
  }

  console.error('The direct-message key file could not be used:', failure.message)
  console.error(
    backupPath
      ? `It was kept as ${backupPath}. Messages encrypted with the old key can no longer be read; new messages keep working.`
      : 'Messages encrypted with the old key can no longer be read; new messages keep working.'
  )
}

function readOrCreateKey() {
  const path = keyFilePath()
  // Cleared when the OS key store is the thing that failed: writing another
  // blob it cannot read would rotate the key on every single launch.
  let trustKeyStore = true

  if (fs.existsSync(path)) {
    // I/O errors (locked file, permissions) still propagate: they are
    // transient, and replacing the key over a transient failure would make
    // every stored message unreadable for no reason.
    const raw = fs.readFileSync(path, 'utf8')
    let key = null
    let failure = null
    try {
      key = decodeKeyFile(JSON.parse(raw))
    } catch (err) {
      failure = err
    }
    if (key) return key
    rotateUnreadableKeyFile(path, failure)
    if (failure?.keyStoreUnusable) trustKeyStore = false
  }

  const key = crypto.randomBytes(KEY_BYTES)
  const keyBase64 = key.toString('base64')
  let payload
  if (trustKeyStore && safeStorageAvailable()) {
    payload = {
      version: 1,
      protection: 'safeStorage',
      key: safeStorage.encryptString(keyBase64).toString('base64')
    }
  } else {
    payload = { version: 1, protection: 'plain', key: keyBase64 }
  }

  fs.mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, path)
  try {
    fs.chmodSync(path, 0o600)
  } catch {
    // Ownership/ACL is already limited to the account on Windows.
  }

  return key
}

function getKey() {
  if (!cachedKey) cachedKey = readOrCreateKey()
  return cachedKey
}

// Loads (or replaces) the key eagerly so a broken key file is handled once at
// startup instead of the first time someone sends a message.
export function ensureMessageKey() {
  return getKey()
}

export function isEncryptedMessageBody(value) {
  return typeof value === 'string' && value.startsWith(MESSAGE_ENCRYPTION_PREFIX)
}

export function encryptMessageBody(plainText) {
  const key = getKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return MESSAGE_ENCRYPTION_PREFIX + [
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64')
  ].join(':')
}

// Plain-text rows from before encryption are returned unchanged so an upgrade
// never hides an existing conversation.
export function decryptMessageBody(stored) {
  if (!isEncryptedMessageBody(stored)) return stored

  const parts = stored.slice(MESSAGE_ENCRYPTION_PREFIX.length).split(':')
  if (parts.length !== 3) throw new Error('Unsupported direct-message encoding.')

  const iv = Buffer.from(parts[0], 'base64')
  const tag = Buffer.from(parts[1], 'base64')
  const ciphertext = Buffer.from(parts[2], 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Corrupted direct-message payload.')
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
