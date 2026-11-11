import { isOffline } from './db'
import { rememberRosterWarmup } from './offlineCache'
import { getPersons, getStudentsWithSections, getTeachers } from './services/personService'
import {
  getAcademicGrades,
  getDepartments,
  getMajors,
  getSections,
  getStudySessionTimeSlots,
  getStudySessionTypes,
  getStudyWeeks
} from './services/academicService'
import {
  getExaminationGuards,
  getExaminationSeating,
  getExaminations
} from './services/examinationService'
import { getStudentSessions, getTeacherSessions } from './services/scheduleService'
import { getStudentRecordOptions } from './services/profileService'
import {
  getAbsenceJustifications,
  getAbsencesForSession,
  getSessionStudentsForAbsence,
  getTeacherSessionsForPeriod
} from './services/absenceService'
import { getObservationMotifs, getObservationsForSession } from './services/observationService'
import { getSessionRegister } from './services/teacherAttendanceService'

// Warming the offline cache.
//
// The cache fills itself as pages are opened, but the first page after an
// outage is not always one that was open before. After a sign-in (and after a
// reconnection) the main process therefore runs the same reads the directory,
// schedule and reference pages run, so their results are on disk before
// anybody needs them. Only reads: this never writes to PostgreSQL.
//
// Two kinds of warming happen here:
//
//   - the reference reads (sections, majors, people…) every page needs;
//   - a teacher's own sessions for the coming week, with each session's roster,
//     absences, observations and register. Those are the reads the attendance
//     page makes, and a teacher does not open tomorrow's class today: without
//     this, a class that was never opened on this workstation could be read
//     about during an outage but not marked.
//
// It runs in the background, once per ten minutes at most, and every step is
// allowed to fail on its own — a role that cannot read a page simply does not
// warm that page.

const WARM_INTERVAL_MS = 10 * 60 * 1000
// How far ahead a teacher's sessions are kept, and how many of them.
const SESSION_LOOKAHEAD_DAYS = 7
const MAX_SESSIONS_TO_WARM = 12
// The exams an outage is most likely to interrupt, and how far ahead they are
// kept: an exam morning is when the seating and the guard list are opened, and
// neither can be rebuilt without the server.
const EXAM_LOOKAHEAD_DAYS = 7
const MAX_EXAMS_TO_WARM = 6

let lastWarmAt = 0
let warming = false

const pad = (value) => String(value).padStart(2, '0')

// 'YYYY-MM-DD' in the application's own time zone. Date columns reach the main
// process either as strings or as a Date at local midnight, so both are read
// without shifting the day.
const localDay = (value) => {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  return String(value ?? '').slice(0, 10)
}

// The sessions worth keeping on disk: those of the next `days` days, in the
// order they will be taught, capped so that a term of rosters never crowds out
// everything else in the cache.
export function upcomingSessionIds(
  rows,
  { now = new Date(), days = SESSION_LOOKAHEAD_DAYS, limit = MAX_SESSIONS_TO_WARM } = {}
) {
  const from = localDay(now)
  const to = localDay(new Date(now.getTime() + days * 86400000))
  return (rows || [])
    .filter((row) => {
      const day = localDay(row?.STUDY_DAY_DATE)
      return day.length === 10 && day >= from && day <= to
    })
    .sort(
      (left, right) =>
        localDay(left.STUDY_DAY_DATE).localeCompare(localDay(right.STUDY_DAY_DATE)) ||
        String(left.STUDY_SESSION_START_TIME || '').localeCompare(
          String(right.STUDY_SESSION_START_TIME || '')
        )
    )
    .map((row) => Number(row.STUDY_SESSION_ID))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, limit)
}

// The study week the timetable pages show: the one whose dates contain today.
// The weeks are read anyway (they are the schedule page's own reference data),
// so the current one is found there rather than with another query.
export function currentWeekId(rows, now = new Date()) {
  const today = localDay(now)
  const week = (rows || []).find((row) => {
    const start = localDay(row?.STUDY_WEEK_START_DATE)
    const end = localDay(row?.STUDY_WEEK_END_DATE)
    return start.length === 10 && end.length === 10 && start <= today && today <= end
  })
  return week ? Number(week.STUDY_WEEK_ID) || null : null
}

// The exams of the coming days, with the two lists an exam day opens: who
// guards it and how its candidates are seated. Both are read-only on the day,
// which is why they are worth keeping.
async function warmUpcomingExams(
  rows,
  { now = new Date(), days = EXAM_LOOKAHEAD_DAYS, limit = MAX_EXAMS_TO_WARM } = {}
) {
  const from = localDay(now)
  const to = localDay(new Date(now.getTime() + days * 86400000))
  const ids = (rows || [])
    .filter((row) => {
      const day = String(row?.EXAMINATION_START_DATETIME || '').slice(0, 10)
      return day.length === 10 && day >= from && day <= to
    })
    .sort((left, right) =>
      String(left.EXAMINATION_START_DATETIME || '').localeCompare(
        String(right.EXAMINATION_START_DATETIME || '')
      )
    )
    .map((row) => Number(row.EXAMINATION_ID))
    .filter((id) => Number.isFinite(id) && id > 0)
    .slice(0, limit)

  let reads = 0
  for (const id of ids) {
    for (const call of [() => getExaminationGuards(id), () => getExaminationSeating(id)]) {
      try {
        await call()
        reads += 1
      } catch {
        // One unreadable exam must not stop the rest of the week.
      }
    }
  }

  return { exams: ids.length, reads }
}

// Reads the attendance page's own queries for each of those sessions, so the
// cached rows match what the page asks for exactly (the cache is keyed on the
// statement and its parameters).
async function warmTeacherSessions(personId) {
  const res = await getTeacherSessionsForPeriod(personId)
  const ids = upcomingSessionIds(res?.data || [])
  let reads = 0

  for (const id of ids) {
    const calls = [
      () => getSessionStudentsForAbsence(id),
      () => getAbsencesForSession(id),
      () => getObservationsForSession(id),
      () => getSessionRegister(id)
    ]
    for (const call of calls) {
      try {
        await call()
        reads += 1
      } catch {
        // One unreadable session (no teaching group, a dropped connection) must
        // not stop the rest of the week from being kept.
      }
    }
  }

  return { sessions: ids.length, reads }
}

export function scheduleWarmup(userId = null, { force = false, personId = null } = {}) {
  if (isOffline()) return false
  if (warming) return false
  if (!force && Date.now() - lastWarmAt < WARM_INTERVAL_MS) return false

  warming = true
  const run = async () => {
    const started = Date.now()
    const steps = [
      ['sections', () => getSections()],
      ['majors', () => getMajors()],
      ['departments', () => getDepartments()],
      ['grades', () => getAcademicGrades()],
      ['session types', () => getStudySessionTypes()],
      ['time slots', () => getStudySessionTimeSlots()],
      ['record options', () => getStudentRecordOptions()],
      ['justifications', () => getAbsenceJustifications()],
      ['observation motifs', () => getObservationMotifs()],
      ['people', () => getPersons()],
      ['teachers', () => getTeachers()],
      ['study weeks', () => getStudyWeeks()]
    ]
    if (userId) steps.unshift(['students', () => getStudentsWithSections(userId)])

    let saved = 0
    let skipped = 0
    for (const [, step] of steps) {
      try {
        await step()
        saved += 1
      } catch (error) {
        skipped += 1
      }
    }

    // The timetables: this account's own week, so the schedule pages open from
    // disk during an outage. Either read may have nothing to keep — an account
    // that neither teaches nor studies — and that is not a failure.
    let timetable = null
    if (personId) {
      try {
        const weeks = await getStudyWeeks()
        const weekId = currentWeekId(weeks?.data || [])
        if (weekId) {
          let kept = 0
          const reads = [
            () => getTeacherSessions(personId, weekId),
            () => getStudentSessions(personId, weekId)
          ]
          for (const read of reads) {
            try {
              await read()
              kept += 1
            } catch {
              // Nothing to keep for this side; the other read still runs.
            }
          }
          timetable = { weekId, reads: kept }
        }
      } catch (error) {
        console.warn('The offline timetable warm-up failed:', error.message)
      }
    }

    // Exams of the coming week, with their guard and seating lists.
    let exams = null
    try {
      const examRows = await getExaminations()
      exams = await warmUpcomingExams(examRows?.data || [])
    } catch (error) {
      console.warn('The offline exam warm-up failed:', error.message)
    }

    // The signed-in account teaches: keep next week's classes markable.
    let rosters = null
    if (personId) {
      try {
        rosters = await warmTeacherSessions(personId)
        rememberRosterWarmup(rosters)
      } catch (error) {
        console.warn('The offline roster warm-up failed:', error.message)
      }
    }

    warming = false
    lastWarmAt = Date.now()
    console.log(
      `Offline cache warm-up: ${saved} reads saved, ${skipped} skipped` +
        (rosters ? `, ${rosters.sessions} session rosters (${rosters.reads} reads)` : '') +
        (timetable ? `, week ${timetable.weekId} timetable` : '') +
        (exams ? `, ${exams.exams} exams (${exams.reads} reads)` : '') +
        ` (${Date.now() - started} ms).`
    )
  }

  // Not awaited on purpose: a sign-in never waits for the cache to fill.
  setImmediate(() => {
    run().catch((error) => {
      warming = false
      console.warn('Offline cache warm-up failed:', error.message)
    })
  })
  return true
}
