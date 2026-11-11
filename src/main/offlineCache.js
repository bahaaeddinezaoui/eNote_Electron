import { createHash } from 'crypto'
import fs from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { app } from 'electron'
import { getLanguage } from './localization'

// The local read cache.
//
// A workstation talks to PostgreSQL at 192.214.23.15. When that machine goes
// away, every page that has already been loaded on this computer stays
// readable from here, with the time its copy was taken. This is a cache, not a
// second database: it never accepts writes and never merges anything, which is
// what keeps two secretaries from silently overwriting each other while the
// server is down.
//
// One row per SELECT the main process has run, keyed by the statement, its
// parameters and the display language (the main process localizes labels in
// the row it returns, so each language needs its own copy). SQLite ships with
// Electron's Node — node:sqlite — so the deployment gains no dependency and
// nothing has to be built on an offline machine. If that module is ever
// unavailable the cache degrades to "off" and the application keeps working
// online.

const FILE_NAME = 'offline-cache.sqlite'
// Room for a whole school registry and its reference tables, with headroom.
const MAX_BYTES = 256 * 1024 * 1024
const TARGET_BYTES = 192 * 1024 * 1024
// A single result larger than this is not worth freezing the main process for.
const MAX_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_AGE_DAYS = 30
const PRUNE_EVERY_WRITES = 200
const FLUSH_SYNC_EVERY_MS = 30000

const nodeRequire = createRequire(import.meta.url)

let store = null
let storeUnavailable = false
let directory = null
let writesSincePrune = 0
let lastSyncAt = 0
let lastSyncFlushedAt = 0

// Tests (and a technician's override) can point the cache at another folder.
export function configureCacheDirectory(path) {
  directory = path || null
  close()
}

function cacheDirectory() {
  if (directory) return directory
  try {
    return app.getPath('userData')
  } catch {
    return null
  }
}

function open() {
  if (store || storeUnavailable) return store
  const dir = cacheDirectory()
  if (!dir) return null
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite')
    fs.mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, FILE_NAME))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS read_cache (
        cache_key TEXT PRIMARY KEY,
        sql TEXT NOT NULL,
        params TEXT NOT NULL,
        body TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        saved_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cache_meta (
        meta_key TEXT PRIMARY KEY,
        meta_value TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS read_cache_last_used ON read_cache (last_used);
    `)
    store = db
    readSyncTime()
    prune()
  } catch (error) {
    storeUnavailable = true
    console.warn('The offline record cache is unavailable:', error.message)
  }
  return store
}

function close() {
  if (!store) return
  try {
    store.close()
  } catch {
    /* already closed */
  }
  store = null
  storeUnavailable = false
}

const normalizeSql = (sql) => String(sql ?? '').replace(/\s+/g, ' ').trim()

// The cache key: statement, parameters and language. Two calls that differ in
// any of the three are two different results.
export function cacheKey(sql, params) {
  return createHash('sha256')
    .update(getLanguage())
    .update('\u0000')
    .update(normalizeSql(sql))
    .update('\u0000')
    .update(JSON.stringify(params ?? []))
    .digest('hex')
}

function readMeta(key) {
  const db = open()
  if (!db) return null
  try {
    const row = db.prepare('SELECT meta_value FROM cache_meta WHERE meta_key = ?').get(key)
    return row ? row.meta_value : null
  } catch {
    return null
  }
}

function writeMeta(key, value) {
  const db = open()
  if (!db) return
  try {
    db.prepare(
      `INSERT INTO cache_meta (meta_key, meta_value) VALUES (?, ?)
         ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value`
    ).run(key, String(value))
  } catch (error) {
    console.warn('Could not write the offline cache metadata:', error.message)
  }
}

function readSyncTime() {
  const stored = Number(readMeta('last_sync_at') || 0)
  if (Number.isFinite(stored) && stored > 0) lastSyncAt = stored
}

// The last moment this workstation successfully read from the server. It is
// persisted, though only every so often: writing it on every query would cost
// more than the information is worth.
export function markServerContact(at = Date.now()) {
  lastSyncAt = at
  if (at - lastSyncFlushedAt < FLUSH_SYNC_EVERY_MS) return
  lastSyncFlushedAt = at
  writeMeta('last_sync_at', at)
}

export function getLastSyncAt() {
  if (!lastSyncAt) readSyncTime()
  return lastSyncAt || null
}

// The last roster warm-up: how many of a teacher's coming sessions were read,
// and when. Only the details panel reports it; nothing depends on it.
export function rememberRosterWarmup({ sessions = 0, reads = 0 } = {}) {
  writeMeta('roster_warmup', JSON.stringify({ sessions, reads, at: Date.now() }))
}

export function getRosterWarmup() {
  const stored = readMeta('roster_warmup')
  if (!stored) return null
  try {
    const parsed = JSON.parse(stored)
    return {
      sessions: Number(parsed.sessions) || 0,
      reads: Number(parsed.reads) || 0,
      at: Number(parsed.at) || null
    }
  } catch {
    return null
  }
}

// Store one SELECT result. Best effort on purpose: a cache that cannot be
// written must never fail the query that produced the data.
export function rememberRead(sql, params, data, rowCount) {
  if (!Array.isArray(data)) return false
  const body = JSON.stringify({ data, rowCount: rowCount ?? data.length })
  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes > MAX_ENTRY_BYTES) return false

  const db = open()
  if (!db) return false

  const now = Date.now()
  try {
    db.prepare(
      `INSERT INTO read_cache (cache_key, sql, params, body, bytes, saved_at, last_used)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         body = excluded.body,
         bytes = excluded.bytes,
         saved_at = excluded.saved_at,
         last_used = excluded.last_used`
    ).run(
      cacheKey(sql, params),
      normalizeSql(sql).slice(0, 4000),
      JSON.stringify(params ?? []).slice(0, 4000),
      body,
      bytes,
      now,
      now
    )
    if (++writesSincePrune >= PRUNE_EVERY_WRITES) {
      writesSincePrune = 0
      prune()
    }
    return true
  } catch (error) {
    console.warn('Could not cache a query result:', error.message)
    return false
  }
}

// The stored result for the same statement and parameters, or null when this
// workstation has never run it.
export function recallRead(sql, params) {
  const db = open()
  if (!db) return null
  const key = cacheKey(sql, params)
  try {
    const row = db.prepare('SELECT body, saved_at FROM read_cache WHERE cache_key = ?').get(key)
    if (!row) return null
    db.prepare('UPDATE read_cache SET last_used = ? WHERE cache_key = ?').run(Date.now(), key)
    const parsed = JSON.parse(row.body)
    return {
      data: Array.isArray(parsed.data) ? parsed.data : [],
      rowCount: parsed.rowCount ?? (parsed.data?.length || 0),
      savedAt: Number(row.saved_at) || null
    }
  } catch (error) {
    console.warn('Could not read the offline cache:', error.message)
    return null
  }
}

export function forgetRead(sql, params) {
  const db = open()
  if (!db) return
  try {
    db.prepare('DELETE FROM read_cache WHERE cache_key = ?').run(cacheKey(sql, params))
  } catch {
    /* best effort */
  }
}

export function clearCache() {
  const db = open()
  if (!db) return { cleared: false }
  try {
    db.exec('DELETE FROM read_cache')
    writeMeta('last_sync_at', '')
    lastSyncAt = 0
    return { cleared: true }
  } catch (error) {
    console.warn('Could not clear the offline cache:', error.message)
    return { cleared: false, error: error.message }
  }
}

function totalBytes(db) {
  const row = db.prepare('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM read_cache').get()
  return Number(row?.bytes || 0)
}

// Drop what is too old, then the least recently used rows until the cache is
// back under its working size.
export function prune() {
  const db = open()
  if (!db) return
  try {
    db.prepare('DELETE FROM read_cache WHERE saved_at < ?').run(Date.now() - MAX_AGE_DAYS * 86400000)

    let bytes = totalBytes(db)
    if (bytes <= MAX_BYTES) return

    const victims = db
      .prepare('SELECT cache_key, bytes FROM read_cache ORDER BY last_used ASC LIMIT 500')
      .all()
    const remove = db.prepare('DELETE FROM read_cache WHERE cache_key = ?')
    for (const row of victims) {
      if (bytes <= TARGET_BYTES) break
      remove.run(row.cache_key)
      bytes -= Number(row.bytes || 0)
    }
  } catch (error) {
    console.warn('Could not prune the offline cache:', error.message)
  }
}

// What the interface reports: how much is saved and how old it is.
export function cacheStats() {
  const db = open()
  const lastSync = getLastSyncAt()
  if (!db) {
    return { available: false, entries: 0, bytes: 0, lastSyncAt: lastSync }
  }
  try {
    const row = db.prepare('SELECT COUNT(*) AS entries, COALESCE(SUM(bytes), 0) AS bytes FROM read_cache').get()
    return {
      available: true,
      entries: Number(row?.entries || 0),
      bytes: Number(row?.bytes || 0),
      lastSyncAt: lastSync
    }
  } catch {
    return { available: false, entries: 0, bytes: 0, lastSyncAt: lastSync }
  }
}

export function cacheFilePath() {
  const dir = cacheDirectory()
  return dir ? join(dir, FILE_NAME) : null
}

export function closeCache() {
  close()
}
