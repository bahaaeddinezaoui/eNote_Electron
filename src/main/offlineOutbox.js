import fs from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { app } from 'electron'

// The offline queue for attendance work.
//
// While the server is unreachable a teacher can still record an absence, clear
// one, or confirm that a session was held. Each action is written here — a
// separate SQLite file from the read cache, so clearing or pruning saved
// records can never throw away work that has not reached the server yet — and
// replayed, in order, the moment the server answers again.
//
// Every entry keeps two states:
//   expected  the record the teacher saw when they acted (null: no row)
//   desired   what the teacher decided
// On replay the server's current row is compared with `expected`. If somebody
// changed it in the meantime the entry is NOT applied: it becomes a CONFLICT and
// the user is shown both versions. That is the whole point of the queue — an
// offline change may be late, but it never silently overwrites a colleague's.

const FILE_NAME = 'offline-outbox.sqlite'
const KEEP_RESOLVED_DAYS = 7
const MAX_ATTEMPTS = 25

const nodeRequire = createRequire(import.meta.url)

let store = null
let storeUnavailable = false
let directory = null

export function configureOutboxDirectory(path) {
  directory = path || null
  close()
}

function outboxDirectory() {
  if (directory) return directory
  try {
    return app.getPath('userData')
  } catch {
    return null
  }
}

function open() {
  if (store || storeUnavailable) return store
  const dir = outboxDirectory()
  if (!dir) return null
  try {
    const { DatabaseSync } = nodeRequire('node:sqlite')
    fs.mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, FILE_NAME))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS outbox (
        outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        user_id INTEGER,
        person_id INTEGER NOT NULL DEFAULT 0,
        session_id INTEGER NOT NULL,
        desired TEXT,
        expected TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        forced INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        conflict TEXT,
        resolved_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS outbox_status ON outbox (status, outbox_id);
    `)
    store = db
    db.prepare(
      `DELETE FROM outbox WHERE status IN ('SENT', 'DISCARDED') AND resolved_at IS NOT NULL AND resolved_at < ?`
    ).run(Date.now() - KEEP_RESOLVED_DAYS * 86400000)
  } catch (error) {
    storeUnavailable = true
    console.warn('The offline change queue is unavailable:', error.message)
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

const parse = (value) => {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const toEntry = (row) => ({
  id: Number(row.outbox_id),
  createdAt: Number(row.created_at),
  kind: row.kind,
  userId: row.user_id === null ? null : Number(row.user_id),
  personId: Number(row.person_id) || null,
  sessionId: Number(row.session_id),
  desired: parse(row.desired),
  expected: parse(row.expected),
  status: row.status,
  attempts: Number(row.attempts || 0),
  forced: Number(row.forced || 0) === 1,
  lastError: row.last_error || null,
  conflict: parse(row.conflict),
  resolvedAt: row.resolved_at ? Number(row.resolved_at) : null
})

// Adds one action. A second action on the same record *by the same queue*
// replaces the first: the teacher changed their mind before anything was sent,
// so only the last decision matters. Entries already in conflict are left alone
// — they are waiting for a human.
//
// An additive action (an observation) is the exception: two observations for one
// student in one session are two records, so each is kept.
export function enqueueOutbox({ kind, userId = null, personId = null, sessionId, desired = null, expected = null, additive = false }) {
  const db = open()
  if (!db) return null
  // Attendance entries carry their session; a report or a comment has none, and
  // 0 says so. The replay reads the kind and its own payload.
  const session = Number(sessionId) || 0
  const person = Number(personId) || 0
  try {
    const now = Date.now()
    const owner = userId === null || userId === undefined ? null : Number(userId) || null
    const desiredJson = desired ? JSON.stringify(desired) : null
    const expectedJson = expected ? JSON.stringify(expected) : null

    const existing = additive
      ? null
      : db
          .prepare(
            `SELECT outbox_id FROM outbox WHERE kind = ? AND person_id = ? AND session_id = ? AND status = 'PENDING'`
          )
          .get(kind, person, session)

    if (existing) {
      // Same record, newer decision: update the row in place, keeping its id, so
      // anything already pointing at this entry still points at it.
      db.prepare(
        `UPDATE outbox SET created_at = ?, user_id = ?, desired = ?, expected = ?, attempts = 0, last_error = NULL
         WHERE outbox_id = ?`
      ).run(now, owner, desiredJson, expectedJson, existing.outbox_id)
      return Number(existing.outbox_id)
    }

    const result = db
      .prepare(
        `INSERT INTO outbox (created_at, kind, user_id, person_id, session_id, desired, expected, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`
      )
      .run(now, kind, owner, person, session, desiredJson, expectedJson)
    return Number(result.lastInsertRowid)
  } catch (error) {
    console.warn('Could not queue an offline change:', error.message)
    return null
  }
}

export function pendingOutbox() {
  const db = open()
  if (!db) return []
  try {
    return db.prepare(`SELECT * FROM outbox WHERE status = 'PENDING' ORDER BY outbox_id ASC`).all().map(toEntry)
  } catch {
    return []
  }
}

export function listOutbox() {
  const db = open()
  if (!db) return []
  try {
    return db
      .prepare(
        `SELECT * FROM outbox WHERE status <> 'DISCARDED' ORDER BY
           CASE status WHEN 'CONFLICT' THEN 0 WHEN 'FAILED' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END,
           outbox_id ASC`
      )
      .all()
      .map(toEntry)
  } catch {
    return []
  }
}

export function outboxCounts() {
  const db = open()
  if (!db) return { available: false, total: 0, pending: 0, conflict: 0, failed: 0 }
  try {
    const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM outbox GROUP BY status`).all()
    const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.n)]))
    const pending = byStatus.PENDING || 0
    const conflict = byStatus.CONFLICT || 0
    const failed = byStatus.FAILED || 0
    return { available: true, total: pending + conflict + failed, pending, conflict, failed }
  } catch {
    return { available: false, total: 0, pending: 0, conflict: 0, failed: 0 }
  }
}

export function markOutboxSent(id) {
  const db = open()
  if (!db) return false
  try {
    db.prepare(`UPDATE outbox SET status = 'SENT', resolved_at = ?, last_error = NULL WHERE outbox_id = ?`).run(
      Date.now(),
      Number(id)
    )
    return true
  } catch {
    return false
  }
}

export function markOutboxConflict(id, conflict) {
  const db = open()
  if (!db) return false
  try {
    db.prepare(`UPDATE outbox SET status = 'CONFLICT', conflict = ?, resolved_at = ? WHERE outbox_id = ?`).run(
      JSON.stringify(conflict || {}),
      Date.now(),
      Number(id)
    )
    return true
  } catch {
    return false
  }
}

// A failed entry stays visible: it is either a record that no longer exists or
// a permission that changed while the client was offline. Retrying costs
// nothing, and discarding it is an explicit choice.
export function markOutboxFailed(id, message) {
  const db = open()
  if (!db) return false
  try {
    db.prepare(
      `UPDATE outbox SET status = 'FAILED', last_error = ?, attempts = attempts + 1 WHERE outbox_id = ?`
    ).run(String(message || 'The change could not be sent.').slice(0, 500), Number(id))
    return true
  } catch {
    return false
  }
}

// Back to PENDING, ignoring the expected-state check once: the user looked at
// the server's version and chose their own.
export function forceOutbox(id) {
  const db = open()
  if (!db) return false
  try {
    db.prepare(
      `UPDATE outbox SET status = 'PENDING', forced = 1, conflict = NULL, resolved_at = NULL WHERE outbox_id = ?`
    ).run(Number(id))
    return true
  } catch {
    return false
  }
}

export function retryOutbox(id) {
  const db = open()
  if (!db) return false
  try {
    db.prepare(
      `UPDATE outbox SET status = 'PENDING', last_error = NULL, resolved_at = NULL, attempts = 0 WHERE outbox_id = ?`
    ).run(Number(id))
    return true
  } catch {
    return false
  }
}

export function discardOutbox(id) {
  const db = open()
  if (!db) return false
  try {
    db.prepare(`UPDATE outbox SET status = 'DISCARDED', resolved_at = ? WHERE outbox_id = ?`).run(
      Date.now(),
      Number(id)
    )
    return true
  } catch {
    return false
  }
}

export function attemptsFor(entry) {
  return Number(entry?.attempts || 0)
}

export { MAX_ATTEMPTS }
