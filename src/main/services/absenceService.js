import { isConnectionError, isOffline, query } from '../db'
import { enqueueOutbox } from '../offlineOutbox'
import { personNameColumns } from '../sqlPersonName'
import { recordAudit } from './auditService'
import { getAbsenceRemovalLockMinutes } from './settingsService'
import { touchSessionRegister } from './teacherAttendanceService'

// Shared SELECT for a teacher's study session enriched with classroom, major,
// study-day, study-week and teaching-group details.
const teacherSessionDetailsSelect = `
    SELECT 
      s.*, 
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr, 
      m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
      d.STUDY_DAY_DATE,
      w.study_week_label_en, w.study_week_label_ar, w.study_week_label_fr,
      w.STUDY_WEEK_START_DATE,
      w.STUDY_WEEK_END_DATE,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
    FROM study_session s
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m ON s.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
`

// 'YYYY-MM-DD' in the app's local time, matching the naive date stored on study_day.
function formatDbDate(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 'HH:MM:SS' in the app's local time, matching the naive time columns.
function formatDbTime(d) {
  return d.toTimeString().split(' ')[0]
}

// The instant a session began, built in local time from the naive date and time
// columns. pg may hand back a Date at local midnight or a 'YYYY-MM-DD' string
// depending on the column type, so both shapes are accepted without shifting
// the day.
function sessionStartMoment(dayValue, timeValue) {
  let year, month, day
  if (dayValue instanceof Date) {
    year = dayValue.getFullYear()
    month = dayValue.getMonth()
    day = dayValue.getDate()
  } else {
    const parts = String(dayValue || '').slice(0, 10).split('-').map(Number)
    year = parts[0]
    month = (parts[1] || 1) - 1
    day = parts[2] || 1
  }
  const [hours = 0, minutes = 0, seconds = 0] = String(timeValue || '')
    .split(':')
    .map(Number)
  return new Date(year, month, day, hours || 0, minutes || 0, seconds || 0, 0)
}

// Managers keep their administrative override; the rule is about what a teacher
// may do to the register they took.
async function isManagerAccount(userId) {
  const id = parseInt(userId, 10)
  if (!id) return false
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code IN ('ADMIN', 'DEVELOPER')
     LIMIT 1`,
    [id]
  )
  return res.rowCount > 0
}

export async function getAbsenceJustifications() {
  // Justifications keep one label per language; there is no single
  // absence_justification_label column, so sort on the real columns.
  return await query('SELECT * FROM absence_justification ORDER BY absence_justification_label_en, absence_justification_label_ar, absence_justification_label_fr')
}

export async function getAbsencesForSession(sessionId) {
  const sql = `
    SELECT 
      a.*, 
      j.absence_justification_label_en, j.absence_justification_label_ar, j.absence_justification_label_fr, 
      j.ABSENCE_JUSTIFICATION_CODE,
      ${personNameColumns('p', 'STUDENT_NAME')},
      -- The same identity the notification triggers use, so a director comment
      -- written on an absence is the one seen wherever that absence appears.
      'ABSENCE:' || a.PERSON_ID || ':' || a.STUDY_SESSION_ID as RECORD_KEY,
      (SELECT count(*)::int FROM director_comment c
        WHERE c.RECORD_KEY = 'ABSENCE:' || a.PERSON_ID || ':' || a.STUDY_SESSION_ID) as COMMENT_COUNT
    FROM student_gets_absent a
    JOIN absence_justification j ON a.ABSENCE_JUSTIFICATION_ID = j.ABSENCE_JUSTIFICATION_ID
    JOIN person p ON a.PERSON_ID = p.PERSON_ID
    WHERE a.STUDY_SESSION_ID = $1
  `
  return await query(sql, [sessionId])
}

export async function getSessionStudentsForAbsence(sessionId) {
  const sessionResult = await query('SELECT * FROM study_session WHERE STUDY_SESSION_ID = $1', [sessionId])
  if (!sessionResult.data || sessionResult.data.length === 0) {
    return { source: 'postgres', data: [] }
  }
  const session = sessionResult.data[0]

  // A session's attendees are the members of its teaching group. The session's
  // MAJOR_ID is the subject taught (e.g. Algorithms 1), which is independent of
  // the major the group's students are enrolled under, so the roster is matched
  // on the teaching group alone.
  if (session.TEACHING_GROUP_ID) {
    return await query(`
      SELECT DISTINCT p.*, pp.person_photo, sdg.TEACHING_GROUP_ID
      FROM student_dynamic_group_by_major sdg
      JOIN v_person p ON sdg.PERSON_ID = p.PERSON_ID
      -- The roster is keyed on the person view; the photo is read from the
      -- table so it is available even on a view created before that column.
      JOIN person pp ON pp.person_id = p.PERSON_ID
      WHERE sdg.TEACHING_GROUP_ID = $1 AND p.IS_STUDENT = TRUE
      ORDER BY p.PERSON_LAST_NAME, p.PERSON_FIRST_NAME
    `, [session.TEACHING_GROUP_ID])
  }

  return { source: 'postgres', data: [] }
}

// The absence form's fields, accepted in either casing and stripped of anything
// else (the renderer also sends the snapshot used for conflict detection).
function normalizeAbsenceInput(data) {
  const pick = (name) => data?.[name] ?? data?.[name.toLowerCase()] ?? null
  return {
    personId: parseInt(pick('PERSON_ID'), 10) || null,
    sessionId: parseInt(pick('STUDY_SESSION_ID'), 10) || null,
    justificationId: parseInt(pick('ABSENCE_JUSTIFICATION_ID'), 10) || null,
    perPersonId: parseInt(pick('PER_PERSON_ID'), 10) || null,
    note: String(pick('TEACHER_ABSENCE_NOTE') ?? '')
  }
}

// The row the teacher was looking at when they acted (null: no absence yet).
function normalizeExpectedAbsence(value) {
  if (!value) return null
  return {
    justificationId: parseInt(value.justificationId ?? value.ABSENCE_JUSTIFICATION_ID, 10) || null,
    perPersonId: parseInt(value.perPersonId ?? value.PER_PERSON_ID, 10) || null,
    note: String(value.note ?? value.TEACHER_ABSENCE_NOTE ?? '')
  }
}

function queueOfflineChange(entry) {
  const id = enqueueOutbox(entry)
  if (!id) {
    throw new Error(
      'The server is unreachable and this computer could not store the change. Do not close the application; try again.'
    )
  }
  return { success: true, queued: true, outboxId: id }
}

export async function markStudentAbsent(absenceData) {
  const desired = normalizeAbsenceInput(absenceData)
  if (!desired.personId || !desired.sessionId) {
    throw new Error('Select a student and a session.')
  }
  const expected = normalizeExpectedAbsence(absenceData?.expectedAbsence)

  // Offline: the decision is kept on this computer and sent on reconnection.
  if (isOffline()) {
    return queueOfflineChange({
      kind: 'absence.mark',
      personId: desired.personId,
      sessionId: desired.sessionId,
      desired,
      expected
    })
  }

  const sql = `
    INSERT INTO student_gets_absent (person_id, study_session_id, absence_justification_id, per_person_id, teacher_absence_note)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (person_id, study_session_id)
    DO UPDATE SET
      absence_justification_id = EXCLUDED.absence_justification_id,
      per_person_id = EXCLUDED.per_person_id,
      teacher_absence_note = EXCLUDED.teacher_absence_note
  `
  try {
    await query(sql, [
      desired.personId,
      desired.sessionId,
      desired.justificationId,
      desired.perPersonId,
      desired.note
    ])

    // Saving an absence is this teacher taking the session: it is the strongest
    // evidence they were in front of the class, so the attendance register is
    // filled in at the same time (and any "missed class" alarm is dropped).
    await touchSessionRegister(desired.sessionId, desired.perPersonId, 'SAVED_ABSENCE')

    await recordAudit({
      actorPersonId: desired.perPersonId,
      action: 'absence.record',
      entityType: 'absence',
      entityId: `${desired.personId}:${desired.sessionId}`,
      detail: {
        studentId: desired.personId,
        sessionId: desired.sessionId,
        justificationId: desired.justificationId
      }
    })

    return { success: true, ...absenceData }
  } catch (error) {
    // The connection dropped between the check above and the write: nothing
    // reached the server, so the change is queued rather than lost.
    if (!isConnectionError(error)) throw error
    return queueOfflineChange({
      kind: 'absence.mark',
      personId: desired.personId,
      sessionId: desired.sessionId,
      desired,
      expected
    })
  }
}

// Removes a recorded absence. An admin may lock removal for the first minutes
// of a session (Settings → Absence removal lock): during that window a teacher's
// request is refused here, in the main process, so a modified renderer or a
// direct IPC call cannot bypass it. The refused attempt is recorded as a failed
// audit entry; managers are exempt, since the rule governs the teacher's
// register rather than administration.
export async function markStudentPresent(userId, studentId, sessionId, expectedAbsence = null) {
  const targetStudentId = parseInt(studentId, 10)
  const targetSessionId = parseInt(sessionId, 10)
  if (!targetStudentId || !targetSessionId) {
    throw new Error('Select a student and a session.')
  }
  const expected = normalizeExpectedAbsence(expectedAbsence)

  // Offline: "present" is queued like an absence. The removal lock is checked
  // again on the server when the queue is sent, which is the moment it applies.
  if (isOffline()) {
    return queueOfflineChange({
      kind: 'absence.clear',
      userId: parseInt(userId, 10) || null,
      personId: targetStudentId,
      sessionId: targetSessionId,
      expected
    })
  }

  const lockMinutes = await getAbsenceRemovalLockMinutes()
  if (lockMinutes > 0 && !(await isManagerAccount(userId))) {
    const sessionRes = await query(
      `SELECT s.study_session_start_time, d.study_day_date
         FROM study_session s
         JOIN study_day d ON d.study_day_id = s.study_day_id
        WHERE s.study_session_id = $1`,
      [targetSessionId]
    )
    const session = sessionRes.data?.[0]
    if (session) {
      const start = sessionStartMoment(session.STUDY_DAY_DATE, session.STUDY_SESSION_START_TIME)
      const elapsedMinutes = (Date.now() - start.getTime()) / 60000
      if (Number.isFinite(elapsedMinutes) && elapsedMinutes >= 0 && elapsedMinutes < lockMinutes) {
        const message = `Removing an absence is locked for the first ${lockMinutes} minutes of the session.`
        await recordAudit({
          actorUserId: parseInt(userId, 10) || null,
          action: 'absence.clear',
          entityType: 'absence',
          entityId: `${targetStudentId}:${targetSessionId}`,
          result: 'failure',
          error: message,
          detail: {
            studentId: targetStudentId,
            sessionId: targetSessionId,
            reason: 'ABSENCE_REMOVAL_LOCKED',
            lockMinutes
          }
        })
        throw new Error(message)
      }
    }
  }

  try {
    await query('DELETE FROM student_gets_absent WHERE person_id = $1 AND study_session_id = $2', [targetStudentId, targetSessionId])
  } catch (error) {
    if (!isConnectionError(error)) throw error
    return queueOfflineChange({
      kind: 'absence.clear',
      userId: parseInt(userId, 10) || null,
      personId: targetStudentId,
      sessionId: targetSessionId,
      expected
    })
  }

  await recordAudit({
    actorUserId: parseInt(userId, 10) || null,
    action: 'absence.clear',
    entityType: 'absence',
    entityId: `${targetStudentId}:${targetSessionId}`,
    detail: { studentId: targetStudentId, sessionId: targetSessionId }
  })
  return { success: true }
}

// Complete absence history for one student, enriched with the full session
// context (subject, group, classroom, teacher, week). Optionally narrowed to a
// date range on the session's study day.
export async function getStudentAbsenceHistory(personId, { startDate, endDate } = {}) {
  const params = [personId]
  let sql = `
    SELECT 
      a.PERSON_ID,
      a.STUDY_SESSION_ID,
      a.TEACHER_ABSENCE_NOTE,
      a.ABSENCE_JUSTIFICATION_ID,
      j.absence_justification_label_en, j.absence_justification_label_ar, j.absence_justification_label_fr,
      j.ABSENCE_JUSTIFICATION_LABEL_EN,
      j.ABSENCE_JUSTIFICATION_LABEL_AR,
      j.ABSENCE_JUSTIFICATION_LABEL_FR,
      j.ABSENCE_JUSTIFICATION_CODE,
      ${personNameColumns('i', 'INSTRUCTOR_NAME')},
      s.STUDY_SESSION_START_TIME,
      s.STUDY_SESSION_END_TIME,
      st.study_session_type_label_en, st.study_session_type_label_ar, st.study_session_type_label_fr,
      st.STUDY_SESSION_TYPE_LABEL_EN,
      st.STUDY_SESSION_TYPE_LABEL_AR,
      st.STUDY_SESSION_TYPE_LABEL_FR,
      d.STUDY_DAY_DATE,
      w.STUDY_WEEK_ID,
      w.study_week_label_en, w.study_week_label_ar, w.study_week_label_fr,
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr,
      c.CLASSROOM_LABEL_EN,
      c.CLASSROOM_LABEL_AR,
      c.CLASSROOM_LABEL_FR,
      m.MAJOR_LABEL_EN,
      m.MAJOR_LABEL_AR,
      m.MAJOR_LABEL_FR,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr,
      tg.TEACHING_GROUP_LABEL_EN,
      tg.TEACHING_GROUP_LABEL_AR,
      tg.TEACHING_GROUP_LABEL_FR
    FROM student_gets_absent a
    JOIN absence_justification j ON a.ABSENCE_JUSTIFICATION_ID = j.ABSENCE_JUSTIFICATION_ID
    JOIN study_session s ON a.STUDY_SESSION_ID = s.STUDY_SESSION_ID
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    LEFT JOIN person i ON s.INSTRUCTOR_ID = i.PERSON_ID
    LEFT JOIN study_session_type st ON s.STUDY_SESSION_TYPE_ID = st.STUDY_SESSION_TYPE_ID
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m ON s.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
    WHERE a.PERSON_ID = $1
  `
  if (startDate) {
    params.push(startDate)
    sql += ` AND d.STUDY_DAY_DATE >= $${params.length}::date`
  }
  if (endDate) {
    params.push(endDate)
    sql += ` AND d.STUDY_DAY_DATE <= $${params.length}::date`
  }
  sql += ` ORDER BY d.STUDY_DAY_DATE DESC, s.STUDY_SESSION_START_TIME DESC`
  return await query(sql, params)
}

// Global (all-students) absence history for consultation/analytics. Supports
// the same date-range narrowing as the per-student history, plus optional
// major / teaching-group / instructor narrowing on the session.
export async function getGlobalAbsenceHistory({ startDate, endDate, majorId, teachingGroupId, instructorId, justificationId } = {}) {
  const params = []
  const conditions = []
  let sql = `
    SELECT 
      a.PERSON_ID,
      a.STUDY_SESSION_ID,
      a.TEACHER_ABSENCE_NOTE,
      a.ABSENCE_JUSTIFICATION_ID,
      j.absence_justification_label_en, j.absence_justification_label_ar, j.absence_justification_label_fr,
      j.ABSENCE_JUSTIFICATION_CODE,
      ${personNameColumns('p', 'STUDENT_NAME')},
      ${personNameColumns('i', 'INSTRUCTOR_NAME')},
      s.STUDY_SESSION_START_TIME,
      s.STUDY_SESSION_END_TIME,
      st.study_session_type_label_en, st.study_session_type_label_ar, st.study_session_type_label_fr,
      d.STUDY_DAY_DATE,
      w.STUDY_WEEK_ID,
      w.study_week_label_en, w.study_week_label_ar, w.study_week_label_fr,
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr,
      m.MAJOR_ID,
      m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
      tg.TEACHING_GROUP_ID,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
    FROM student_gets_absent a
    JOIN absence_justification j ON a.ABSENCE_JUSTIFICATION_ID = j.ABSENCE_JUSTIFICATION_ID
    JOIN person p ON a.PERSON_ID = p.PERSON_ID
    JOIN study_session s ON a.STUDY_SESSION_ID = s.STUDY_SESSION_ID
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    LEFT JOIN person i ON s.INSTRUCTOR_ID = i.PERSON_ID
    LEFT JOIN study_session_type st ON s.STUDY_SESSION_TYPE_ID = st.STUDY_SESSION_TYPE_ID
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m ON s.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
  `
  if (startDate) {
    params.push(startDate)
    conditions.push(`d.STUDY_DAY_DATE >= $${params.length}::date`)
  }
  if (endDate) {
    params.push(endDate)
    conditions.push(`d.STUDY_DAY_DATE <= $${params.length}::date`)
  }
  if (majorId) {
    params.push(majorId)
    conditions.push(`s.MAJOR_ID = $${params.length}`)
  }
  if (teachingGroupId) {
    params.push(teachingGroupId)
    conditions.push(`s.TEACHING_GROUP_ID = $${params.length}`)
  }
  if (instructorId) {
    params.push(instructorId)
    conditions.push(`s.INSTRUCTOR_ID = $${params.length}`)
  }
  if (justificationId) {
    params.push(justificationId)
    conditions.push(`a.ABSENCE_JUSTIFICATION_ID = $${params.length}`)
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }
  sql += ` ORDER BY d.STUDY_DAY_DATE DESC, s.STUDY_SESSION_START_TIME DESC`
  return await query(sql, params)
}

export async function getTeacherActiveSession(instructorId, currentDate, currentTime) {
  const sql = `${teacherSessionDetailsSelect}
    WHERE s.INSTRUCTOR_ID = $1
      AND d.STUDY_DAY_DATE = $2::date
      AND s.STUDY_SESSION_START_TIME <= $3
      AND s.STUDY_SESSION_END_TIME >= $3
    LIMIT 1
  `
  return await query(sql, [instructorId, currentDate, currentTime])
}

// Detects the study session currently in progress for the instructor using the
// application machine's own clock, evaluated in the main process on every call.
// This keeps the result tied to the OS date/time at query time (not to anything
// cached in the renderer), so clock changes are honoured without restarting the
// application.
export async function getTeacherCurrentSession(instructorId) {
  const now = new Date()
  return await getTeacherActiveSession(instructorId, formatDbDate(now), formatDbTime(now))
}

export async function getTeacherSessionsForPeriod(instructorId) {
  const sql = `
    SELECT 
      s.*, 
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr, 
      m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
      d.STUDY_DAY_DATE,
      w.study_week_label_en, w.study_week_label_ar, w.study_week_label_fr,
      w.STUDY_WEEK_START_DATE,
      w.STUDY_WEEK_END_DATE,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
    FROM study_session s
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m ON s.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
    WHERE s.INSTRUCTOR_ID = $1
    ORDER BY d.STUDY_DAY_DATE DESC, s.STUDY_SESSION_START_TIME ASC
  `
  return await query(sql, [instructorId])
}
