import { isConnectionError, isOffline, query } from '../db'
import { enqueueOutbox } from '../offlineOutbox'

// Teacher attendance: "was the class that the schedule programmed actually
// taken?"
//
// The register (study_session_register, see migration_teacher_attendance.sql) is
// the evidence. A session gains a row the moment its teacher does any of the
// things only that teacher can do for it:
//
//   SAVED_ABSENCE       an absence was recorded for the session
//   SAVED_OBSERVATION   an observation was recorded for the session
//   HELD                the teacher declared the session held with nothing to
//                       report (nobody absent, nothing observed)
//   ADMIN               an administrator acknowledged it on the teacher's behalf
//
// Everything after the end of the slot, with no register row, is a missed class.
// The detector in the database turns those into notifications addressed to the
// teacher (their own sessions only), the directors and the administrators; the
// application calls it on a timer, so nobody has to look for them.
//
// The same register drives the earlier, gentler nudge: a session that has
// started, has not ended and has no register row raises a TEACHER_REMINDER for
// its own teacher while there is still time to record the absences
// (scanStartedSessions). Recording anything withdraws it, and the end of the
// slot hands over to the missed-class alarm.

const GRACE_MINUTES = 10
const LOOKBACK_DAYS = 21
const MAX_SESSIONS_PER_SCAN = 40

// A teacher walking into the room gets a few minutes before the reminder;
// sessions are never reminded for further back than a couple of days.
const REMINDER_GRACE_MINUTES = 5
const REMINDER_LOOKBACK_DAYS = 2

// 'YYYY-MM-DD' in the application's own time zone.
function formatDbDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 'YYYY-MM-DD HH:MM:SS' in the application's own time zone, which is what the
// naive date/time columns of the schedule mean.
function formatDbTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function loadAccount(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query(
    `SELECT u.person_id, u.is_active,
            COALESCE(array_agg(DISTINCT r.role_code), '{}') AS roles
       FROM "user" u
       LEFT JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1
      GROUP BY u.user_id, u.person_id, u.is_active`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  if (row.IS_ACTIVE === false) throw new Error('Not allowed: this account is inactive.')
  return { userId: id, personId: row.PERSON_ID, roles: row.ROLES || [] }
}

// Records that a session was dealt with. Called from every write that proves the
// teacher was present, so the register fills itself as work is done.
export async function touchSessionRegister(sessionId, personId, source) {
  const session = parseInt(sessionId, 10)
  const person = parseInt(personId, 10)
  if (!session || !person) return { success: false }
  await query(
    `INSERT INTO study_session_register (study_session_id, person_id, source)
     VALUES ($1, $2, $3)
     ON CONFLICT (study_session_id) DO NOTHING`,
    [session, person, String(source || 'TEACHER').slice(0, 24)]
  )
  return { success: true }
}

// Whether this session has been registered (the Attendance page shows it).
export async function getSessionRegister(sessionId) {
  const session = parseInt(sessionId, 10)
  if (!session) return { success: true, register: null }
  const res = await query(
    `SELECT reg.study_session_id, reg.person_id, reg.marked_at, reg.source,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) || ' ' ||
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS marked_by_name
       FROM study_session_register reg
       JOIN person p ON p.person_id = reg.person_id
      WHERE reg.study_session_id = $1`,
    [session]
  )
  return { success: true, register: res.data?.[0] || null }
}

// The class was held but nothing could reach the server: the confirmation is
// kept on this computer and sent with the rest of the queue.
function queueSessionAttended(userId, sessionId) {
  const id = enqueueOutbox({
    kind: 'session.attended',
    userId: parseInt(userId, 10) || null,
    sessionId
  })
  if (!id) {
    throw new Error(
      'The server is unreachable and this computer could not store the change. Do not close the application; try again.'
    )
  }
  return { success: true, queued: true, outboxId: id, register: null }
}

// The teacher of the session (or an administrator) confirms the class was held.
// The register trigger drops the alarm the detector raised for that session.
export async function markSessionAttended(userId, sessionId) {
  const session = parseInt(sessionId, 10)
  if (!session) throw new Error('A study session is required.')
  if (isOffline()) return queueSessionAttended(userId, session)

  let me
  try {
    me = await loadAccount(userId)
  } catch (error) {
    if (isConnectionError(error)) return queueSessionAttended(userId, session)
    throw error
  }

  const res = await query(
    'SELECT study_session_id, instructor_id FROM study_session WHERE study_session_id = $1',
    [session]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('Study session not found.')

  const isInstructor = row.INSTRUCTOR_ID === me.personId
  const isAdmin = me.roles.includes('ADMIN')
  const isDirector = me.roles.includes('DIRECTOR')
  if (!isInstructor && !isAdmin && !isDirector) {
    throw new Error('Not allowed: only the teacher of this session or an administrator can confirm it.')
  }

  // A director of studies may vouch for the session too, but the register keeps
  // who actually said it.
  const source = isInstructor ? 'HELD' : 'ADMIN'
  try {
    await query(
      `INSERT INTO study_session_register (study_session_id, person_id, source)
       VALUES ($1, $2, $3)
       ON CONFLICT (study_session_id) DO NOTHING`,
      [session, me.personId, source]
    )
  } catch (error) {
    if (isConnectionError(error)) return queueSessionAttended(userId, session)
    throw error
  }

  const after = await getSessionRegister(session)
  return { success: true, register: after.register }
}

// Runs the detector. Idempotent: a session that already raised its notification
// is skipped by the SQL, so calling it often is cheap and harmless.
export async function scanMissedSessions({ now = new Date() } = {}) {
  const res = await query(
    'SELECT app_notify_missed_teacher_sessions($1::timestamp, $2::int, $3::int, $4::int) AS reported',
    [formatDbTimestamp(now), GRACE_MINUTES, LOOKBACK_DAYS, MAX_SESSIONS_PER_SCAN]
  )
  const reported = res.data?.[0]?.REPORTED || 0
  return { success: true, reported }
}

// Runs the in-class reminder detector: a session that has started, has not
// ended yet and has no register row is reminded once, to its own teacher. Like
// the missed-class scan it is idempotent — the SQL skips a session that already
// raised its reminder — so running it often is cheap.
export async function scanStartedSessions({ now = new Date() } = {}) {
  const res = await query(
    'SELECT app_notify_started_teacher_sessions($1::timestamp, $2::int, $3::int, $4::int) AS reported',
    [formatDbTimestamp(now), REMINDER_GRACE_MINUTES, REMINDER_LOOKBACK_DAYS, MAX_SESSIONS_PER_SCAN]
  )
  const reported = res.data?.[0]?.REPORTED || 0
  return { success: true, reported }
}

// Teacher attendance over a period: for every teacher with a programmed
// session in it, how many of those sessions were taken (a register row exists —
// an absence, an observation, or an explicit "held") and how many ended with no
// attendance at all. Only sessions that are already over are counted, so a class
// later today is neither taken nor missed.
//
// Directors and administrators only: this is oversight of the teaching staff.
export async function getTeacherAttendanceReport(userId, { from, to, now = new Date() } = {}) {
  const me = await loadAccount(userId)
  if (!me.roles.includes('ADMIN') && !me.roles.includes('DIRECTOR')) {
    throw new Error('Not allowed: requires the Director or Admin role.')
  }

  if (from && !DATE_PATTERN.test(String(from))) throw new Error('The period start must be a date.')
  if (to && !DATE_PATTERN.test(String(to))) throw new Error('The period end must be a date.')

  const end = to || formatDbDate(now)
  const start = from || formatDbDate(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000))
  if (start > end) throw new Error('The period must start on or before the day it ends.')

  const res = await query(
    `SELECT ss.instructor_id AS person_id,
            COALESCE(
              NULLIF(concat_ws(' ', COALESCE(p.person_first_name_la, p.person_first_name_ar),
                              COALESCE(p.person_last_name_la, p.person_last_name_ar)), ''),
              'Teacher #' || ss.instructor_id
            ) AS teacher_name,
            count(*)::int AS programmed_sessions,
            count(reg.study_session_id)::int AS taken_sessions,
            (count(*) - count(reg.study_session_id))::int AS missed_sessions,
            max(CASE WHEN reg.study_session_id IS NULL THEN sd.study_day_date END) AS last_missed_date
       FROM study_session ss
       JOIN study_day sd ON sd.study_day_id = ss.study_day_id
       LEFT JOIN study_session_register reg ON reg.study_session_id = ss.study_session_id
       LEFT JOIN person p ON p.person_id = ss.instructor_id
      WHERE ss.instructor_id IS NOT NULL
        AND sd.study_day_date >= $1::date
        AND sd.study_day_date <= $2::date
        AND (sd.study_day_date + ss.study_session_end_time) <= $3::timestamp
      GROUP BY ss.instructor_id,
               COALESCE(p.person_first_name_la, p.person_first_name_ar),
               COALESCE(p.person_last_name_la, p.person_last_name_ar)
      ORDER BY 5 DESC, 2`,
    [start, end, formatDbTimestamp(now)]
  )

  const teachers = (res.data || []).map((row) => {
    const programmed = row.PROGRAMMED_SESSIONS || 0
    return {
      ...row,
      RATE: programmed > 0 ? row.TAKEN_SESSIONS / programmed : 0
    }
  })

  const totals = teachers.reduce(
    (sum, row) => ({
      teachers: sum.teachers + 1,
      programmed: sum.programmed + row.PROGRAMMED_SESSIONS,
      taken: sum.taken + row.TAKEN_SESSIONS,
      missed: sum.missed + row.MISSED_SESSIONS
    }),
    { teachers: 0, programmed: 0, taken: 0, missed: 0 }
  )
  totals.rate = totals.programmed > 0 ? totals.taken / totals.programmed : 0

  return { success: true, from: start, to: end, teachers, totals }
}

export { GRACE_MINUTES, LOOKBACK_DAYS, REMINDER_GRACE_MINUTES, REMINDER_LOOKBACK_DAYS }
