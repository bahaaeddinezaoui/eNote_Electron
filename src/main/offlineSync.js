import { isOffline, isConnectionError, query } from './db'
import {
  discardOutbox,
  forceOutbox,
  listOutbox,
  markOutboxConflict,
  markOutboxFailed,
  markOutboxSent,
  outboxCounts,
  pendingOutbox,
  retryOutbox
} from './offlineOutbox'
import { markStudentAbsent, markStudentPresent } from './services/absenceService'
import {
  createObservation,
  deleteObservation,
  deleteStudentObservationsForSession
} from './services/observationService'
import { markSessionAttended } from './services/teacherAttendanceService'
import { createBugReport } from './services/bugReportService'
import { saveBetaTestReport } from './services/betaTestService'
import { addNotificationComment } from './services/notificationService'

// Replaying queued attendance work.
//
// Runs when the server is reachable again (a status poll that succeeds, a
// reconnect, or the user pressing Retry). Entries are applied oldest first, and
// each one is checked against the record as it is NOW:
//
//   current == desired   nothing to do, the change is already there
//   current == expected  apply it (the record is exactly what the teacher saw)
//   anything else        CONFLICT: somebody changed it in between, so it is not
//                        applied and both versions are kept for the user
//
// Nothing is ever merged field by field. Attendance is a single decision per
// student per session, and silently blending two decisions would produce a
// state neither teacher chose.

let changeListener = null
let flushing = Promise.resolve()
let lastRun = null

export function setOutboxChangeListener(listener) {
  changeListener = typeof listener === 'function' ? listener : null
}

export function getOutboxState() {
  return { ...outboxCounts(), lastRun }
}

function emitChange() {
  try {
    changeListener?.(getOutboxState())
  } catch (error) {
    console.warn('The offline queue listener failed:', error.message)
  }
}

// Public API for the UI: resolve a conflict one way or the other.
export async function resolveOutboxConflict(id, choice) {
  if (choice === 'mine') {
    forceOutbox(id)
    return await flushOutbox({ trigger: 'resolve' })
  }
  discardOutbox(id)
  emitChange()
  return getOutboxState()
}

export function discardOutboxEntry(id) {
  const done = discardOutbox(id)
  emitChange()
  return { ...getOutboxState(), discarded: done }
}

export function retryOutboxEntry(id) {
  retryOutbox(id)
  return getOutboxState()
}

export function listOutboxEntries() {
  return listOutbox()
}

// The unsent work for one session, in the order it will be sent. Both attendance
// pages put this on top of their saved rows, so a student marked absent offline
// is absent on the Observations page too, before the queue reaches the server.
// Only PENDING entries count: a conflicted absence was not applied, and showing
// it as applied would be a lie until somebody chooses a version.
export function getSessionPending(sessionId) {
  const session = Number(sessionId)
  if (!session) return { absences: [], observations: [] }

  const absences = []
  const observations = []
  for (const entry of pendingOutbox()) {
    if (entry.sessionId !== session) continue

    if (entry.kind === 'absence.mark' || entry.kind === 'absence.clear') {
      absences.push({
        outboxId: entry.id,
        action: entry.kind === 'absence.clear' ? 'clear' : 'mark',
        personId: entry.personId,
        sessionId: entry.sessionId,
        justificationId: entry.desired?.justificationId ?? null,
        perPersonId: entry.desired?.perPersonId ?? null,
        note: entry.desired?.note || ''
      })
    } else if (entry.kind === 'observation.create') {
      observations.push({
        outboxId: entry.id,
        personId: entry.personId,
        sessionId: entry.sessionId,
        motifId: entry.desired?.OBSERVATION_MOTIF_ID ?? null,
        perPersonId: entry.desired?.PER_PERSON_ID ?? null,
        note: entry.desired?.TEACHER_OBSERVATION_NOTE || '',
        datetime: entry.desired?.OBSERVATION_DATETIME || null
      })
    } else if (entry.kind === 'observation.delete') {
      observations.push({
        outboxId: entry.id,
        personId: entry.personId,
        sessionId: entry.sessionId,
        motifId: entry.desired?.OBSERVATION_MOTIF_ID ?? null,
        perPersonId: entry.desired?.PER_PERSON_ID ?? null,
        datetime: entry.desired?.OBSERVATION_DATETIME || null,
        deleted: true
      })
    } else if (entry.kind === 'observation.clear') {
      observations.push({
        outboxId: entry.id,
        personId: entry.personId,
        sessionId: entry.sessionId,
        all: true,
        deleted: true
      })
    }
  }

  return { absences, observations }
}

const asNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const noteOf = (value) => String(value ?? '').trim()

// The row as the replay comparisons see it: ids as numbers, note trimmed.
function stateOf(row) {
  if (!row) return null
  return {
    justificationId: asNumber(row.ABSENCE_JUSTIFICATION_ID ?? row.absence_justification_id),
    perPersonId: asNumber(row.PER_PERSON_ID ?? row.per_person_id),
    note: noteOf(row.TEACHER_ABSENCE_NOTE ?? row.teacher_absence_note)
  }
}

const sameState = (left, right) => {
  if (!left || !right) return !left && !right
  return (
    left.justificationId === right.justificationId &&
    left.perPersonId === right.perPersonId &&
    left.note === right.note
  )
}

// The rule, kept pure so it can be tested without a server:
//   already as desired  -> nothing to do
//   still as expected   -> apply
//   anything else       -> conflict (a human chooses)
// A forced entry is one the user already chose after seeing both versions.
export function decideReplay({ entry, current, writesRow }) {
  const normalized = current || null
  if (!writesRow) {
    if (!normalized) return 'sent'
    if (!entry.forced && !sameState(normalized, entry.expected)) return 'conflict'
    return 'apply'
  }
  if (sameState(normalized, entry.desired || null)) return 'sent'
  if (!entry.forced && !sameState(normalized, entry.expected)) return 'conflict'
  return 'apply'
}

async function readAbsence(personId, sessionId) {
  const res = await query(
    `SELECT person_id, study_session_id, absence_justification_id, per_person_id, teacher_absence_note
       FROM student_gets_absent
      WHERE person_id = $1 AND study_session_id = $2`,
    [personId, sessionId]
  )
  return res.data?.[0] || null
}

// Justification labels travel with a conflict so the dialog can name both
// versions in the interface language rather than showing a bare id.
async function loadJustificationLabels() {
  try {
    const res = await query(
      `SELECT absence_justification_id,
              absence_justification_label_en,
              absence_justification_label_ar,
              absence_justification_label_fr
         FROM absence_justification`
    )
    const map = new Map()
    for (const row of res.data || []) {
      map.set(Number(row.ABSENCE_JUSTIFICATION_ID), row)
    }
    return map
  } catch (error) {
    if (isConnectionError(error)) throw error
    return new Map()
  }
}

const labelFor = (labels, id) => {
  if (!id) return null
  const row = labels?.get(Number(id))
  if (!row) return null
  return {
    ABSENCE_JUSTIFICATION_LABEL_EN: row.ABSENCE_JUSTIFICATION_LABEL_EN,
    ABSENCE_JUSTIFICATION_LABEL_AR: row.ABSENCE_JUSTIFICATION_LABEL_AR,
    ABSENCE_JUSTIFICATION_LABEL_FR: row.ABSENCE_JUSTIFICATION_LABEL_FR
  }
}

function describe(state, labels) {
  if (!state) return null
  return {
    justificationId: state.justificationId,
    justification: labelFor(labels, state.justificationId),
    note: state.note
  }
}

function conflictFor(entry, current, labels) {
  return {
    at: Date.now(),
    desired: describe(entry.desired, labels),
    current: describe(current, labels)
  }
}

async function applyAbsenceMark(entry, labels) {
  const current = stateOf(await readAbsence(entry.personId, entry.sessionId))
  const desired = entry.desired || null

  const decision = decideReplay({ entry, current, writesRow: true })
  if (decision === 'sent') {
    markOutboxSent(entry.id)
    return 'sent'
  }
  if (decision === 'conflict') {
    markOutboxConflict(entry.id, conflictFor(entry, current, labels))
    return 'conflict'
  }

  const result = await markStudentAbsent({
    PERSON_ID: entry.personId,
    STUDY_SESSION_ID: entry.sessionId,
    ABSENCE_JUSTIFICATION_ID: desired?.justificationId ?? null,
    PER_PERSON_ID: desired?.perPersonId ?? null,
    TEACHER_ABSENCE_NOTE: desired?.note ?? ''
  })
  if (result?.queued) return 'pending'

  markOutboxSent(entry.id)
  return 'sent'
}

async function applyAbsenceClear(entry, labels) {
  const current = stateOf(await readAbsence(entry.personId, entry.sessionId))

  const decision = decideReplay({ entry, current, writesRow: false })
  if (decision === 'sent') {
    // Already present: the intent is satisfied.
    markOutboxSent(entry.id)
    return 'sent'
  }
  if (decision === 'conflict') {
    markOutboxConflict(entry.id, conflictFor(entry, current, labels))
    return 'conflict'
  }

  const result = await markStudentPresent(entry.userId, entry.personId, entry.sessionId)
  if (result?.queued) return 'pending'

  markOutboxSent(entry.id)
  return 'sent'
}

// Observations are additive: there is nothing to compare with a colleague's
// version, because both are kept. The timestamp fixed when the entry was queued
// is part of the row's key, so a retry after a lost reply updates that record
// instead of recording a second one.
async function applyObservationCreate(entry) {
  await createObservation({ ...(entry.desired || {}) })
  markOutboxSent(entry.id)
  return 'sent'
}

// The key of one observation row, as the queue stores it.
const observationKeyOf = (entry) => {
  const key = entry.desired || {}
  return [
    key.PERSON_ID ?? entry.personId,
    key.STUDY_SESSION_ID ?? entry.sessionId,
    key.OBSERVATION_MOTIF_ID,
    key.PER_PERSON_ID,
    key.OBSERVATION_DATETIME
  ]
}

async function readObservation(key) {
  const res = await query(
    `SELECT person_id, study_session_id, observation_motif_id, per_person_id, teacher_observation_note
       FROM student_undergoes_observation_by_teacher
      WHERE person_id = $1 AND study_session_id = $2 AND observation_motif_id = $3
        AND per_person_id = $4 AND observation_datetime = $5`,
    key
  )
  return res.data?.[0] || null
}

// A deletion: gone already means the intent is satisfied; the note the teacher
// saw still being there means delete; a different note means somebody changed it
// after them, so the two versions are kept for a person to choose.
async function applyObservationDelete(entry) {
  const key = observationKeyOf(entry)
  const row = await readObservation(key)
  const current = row
    ? {
        justificationId: null,
        perPersonId: asNumber(row.PER_PERSON_ID),
        note: noteOf(row.TEACHER_OBSERVATION_NOTE)
      }
    : null

  const decision = decideReplay({ entry, current, writesRow: false })
  if (decision === 'sent') {
    markOutboxSent(entry.id)
    return 'sent'
  }
  if (decision === 'conflict') {
    markOutboxConflict(entry.id, {
      at: Date.now(),
      action: 'delete',
      desired: null,
      current: { justificationId: null, justification: null, note: current?.note || '' }
    })
    return 'conflict'
  }

  const result = await deleteObservation({
    PERSON_ID: key[0],
    STUDY_SESSION_ID: key[1],
    OBSERVATION_MOTIF_ID: key[2],
    PER_PERSON_ID: key[3],
    OBSERVATION_DATETIME: key[4]
  })
  if (result?.queued) return 'pending'

  markOutboxSent(entry.id)
  return 'sent'
}

// Every note of one student in one session: unconditional, and a second attempt
// simply finds nothing left.
async function applyObservationClear(entry) {
  const res = await query(
    'SELECT 1 FROM student_undergoes_observation_by_teacher WHERE person_id = $1 AND study_session_id = $2 LIMIT 1',
    [entry.personId, entry.sessionId]
  )
  if ((res.rowCount || 0) === 0) {
    markOutboxSent(entry.id)
    return 'sent'
  }

  const result = await deleteStudentObservationsForSession(entry.personId, entry.sessionId)
  if (result?.queued) return 'pending'

  markOutboxSent(entry.id)
  return 'sent'
}

// A bug report is append-only, so there is no state to compare. What matters is
// that a retry after a lost reply does not file it twice: the reporter's own
// reports are searched for the same subject and description first.
async function applyBugReport(entry) {
  const data = entry.desired || {}
  const subject = String(data.REPORT_SUBJECT || '').trim()
  const description = String(data.REPORT_DESCRIPTION || '').trim()
  if (!entry.userId) throw new Error('The report has no reporter.')

  const existing = await query(
    `SELECT 1 FROM bug_report
      WHERE user_id = $1 AND report_subject = $2 AND report_description = $3
      LIMIT 1`,
    [entry.userId, subject, description]
  )
  if ((existing.rowCount || 0) > 0) {
    markOutboxSent(entry.id)
    return 'sent'
  }

  await createBugReport(entry.userId, data, false)
  markOutboxSent(entry.id)
  return 'sent'
}

// A beta test report is one row per tester and version, and saving it replaces
// its answers: sending it twice leaves exactly one report, so no extra check is
// needed here.
async function applyBetaTestReport(entry) {
  const payload = entry.desired || {}
  await saveBetaTestReport(entry.userId, payload.changelogId, payload.data || {})
  markOutboxSent(entry.id)
  return 'sent'
}

// A comment is append-only too. The same director writing the same text on the
// same record within a day is treated as the entry that already arrived, so a
// reply lost on its way back does not post it twice.
async function applyNotificationComment(entry) {
  const payload = entry.desired || {}
  const recordKey = String(payload.recordKey || '')
  const text = String(payload.text || '').trim()
  if (!recordKey || !text) throw new Error('The comment is empty.')

  const who = await query('SELECT person_id FROM "user" WHERE user_id = $1', [entry.userId])
  const personId = who.data?.[0]?.PERSON_ID
  if (personId) {
    const existing = await query(
      `SELECT 1 FROM director_comment
        WHERE director_person_id = $1 AND record_key = $2 AND comment_text = $3
          AND created_at >= now() - interval '1 day'
        LIMIT 1`,
      [personId, recordKey, text]
    )
    if ((existing.rowCount || 0) > 0) {
      markOutboxSent(entry.id)
      return 'sent'
    }
  }

  await addNotificationComment(entry.userId, recordKey, text)
  markOutboxSent(entry.id)
  return 'sent'
}

async function applySessionAttended(entry) {
  const res = await query('SELECT 1 FROM study_session_register WHERE study_session_id = $1', [
    entry.sessionId
  ])
  if ((res.rowCount || 0) > 0) {
    markOutboxSent(entry.id)
    return 'sent'
  }

  const result = await markSessionAttended(entry.userId, entry.sessionId)
  if (result?.queued) return 'pending'

  markOutboxSent(entry.id)
  return 'sent'
}

async function runFlush(trigger) {
  const started = Date.now()
  const before = outboxCounts()
  if (before.pending === 0) {
    lastRun = { trigger, at: started, sent: 0, conflicts: 0, failed: 0, pending: 0 }
    return getOutboxState()
  }
  if (isOffline()) {
    return getOutboxState()
  }

  let labels
  try {
    labels = await loadJustificationLabels()
  } catch {
    // The server went away between the check and the first read.
    return getOutboxState()
  }

  const entries = pendingOutbox()
  let sent = 0
  let conflicts = 0
  let failed = 0

  for (const entry of entries) {
    if (isOffline()) break
    try {
      let outcome
      if (entry.kind === 'absence.mark') outcome = await applyAbsenceMark(entry, labels)
      else if (entry.kind === 'absence.clear') outcome = await applyAbsenceClear(entry, labels)
      else if (entry.kind === 'observation.create') outcome = await applyObservationCreate(entry)
      else if (entry.kind === 'observation.delete') outcome = await applyObservationDelete(entry)
      else if (entry.kind === 'observation.clear') outcome = await applyObservationClear(entry)
      else if (entry.kind === 'session.attended') outcome = await applySessionAttended(entry)
      else if (entry.kind === 'bugReport.create') outcome = await applyBugReport(entry)
      else if (entry.kind === 'betaTest.save') outcome = await applyBetaTestReport(entry)
      else if (entry.kind === 'notification.comment') outcome = await applyNotificationComment(entry)
      else {
        markOutboxFailed(entry.id, 'Unknown queued change.')
        failed += 1
        continue
      }

      if (outcome === 'sent') sent += 1
      else if (outcome === 'conflict') conflicts += 1
    } catch (error) {
      // Losing the connection mid-replay is not a failure of this entry: the
      // rest of the queue waits for the next attempt.
      if (isConnectionError(error) || isOffline()) break
      markOutboxFailed(entry.id, error.message)
      failed += 1
    }
  }

  lastRun = { trigger, at: started, sent, conflicts, failed, ms: Date.now() - started }
  emitChange()
  if (sent || conflicts || failed) {
    console.log(
      `Offline queue: ${sent} sent, ${conflicts} conflicted, ${failed} failed (${trigger}).`
    )
  }
  return getOutboxState()
}

// Serialised: a status poll, a reconnect and a user click may all arrive at
// once, and replaying the same entry twice would duplicate notifications.
export function flushOutbox({ trigger = 'auto' } = {}) {
  flushing = flushing.then(() => runFlush(trigger)).catch((error) => {
    console.warn('The offline queue could not be sent:', error.message)
    return getOutboxState()
  })
  return flushing
}
