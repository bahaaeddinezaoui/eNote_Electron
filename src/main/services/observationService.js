import { isConnectionError, isOffline, query } from '../db'
import { enqueueOutbox } from '../offlineOutbox'
import { personNameColumns } from '../sqlPersonName'
import { touchSessionRegister } from './teacherAttendanceService'

export async function getObservationMotifs() {
  return await query('SELECT * FROM observation_motif ORDER BY COALESCE(observation_motif_label_en, observation_motif_label_ar, observation_motif_label_fr)')
}

export async function getObservationsForSession(sessionId) {
  const sql = `
    SELECT 
      o.*, 
      m.observation_motif_label_en, m.observation_motif_label_ar, m.observation_motif_label_fr, 
      m.OBSERVATION_MOTIF_CODE,
      ${personNameColumns('p', 'STUDENT_NAME')},
      -- The same identity the notification triggers use, so a director comment
      -- written on an observation is the one seen wherever that record appears.
      'OBSERVATION:' || o.PERSON_ID || ':' || o.STUDY_SESSION_ID || ':' ||
        o.OBSERVATION_MOTIF_ID || ':' || o.PER_PERSON_ID || ':' ||
        to_char(o.OBSERVATION_DATETIME, 'YYYY-MM-DD HH24:MI:SS') as RECORD_KEY,
      (SELECT count(*)::int FROM director_comment c
        WHERE c.RECORD_KEY = 'OBSERVATION:' || o.PERSON_ID || ':' || o.STUDY_SESSION_ID || ':' ||
          o.OBSERVATION_MOTIF_ID || ':' || o.PER_PERSON_ID || ':' ||
          to_char(o.OBSERVATION_DATETIME, 'YYYY-MM-DD HH24:MI:SS')) as COMMENT_COUNT
    FROM student_undergoes_observation_by_teacher o
    JOIN observation_motif m ON o.OBSERVATION_MOTIF_ID = m.OBSERVATION_MOTIF_ID
    JOIN person p ON o.PERSON_ID = p.PERSON_ID
    WHERE o.STUDY_SESSION_ID = $1
    ORDER BY o.OBSERVATION_DATETIME DESC
  `
  return await query(sql, [sessionId])
}

// Complete observation history for one student, enriched with the full session
// context (subject, group, classroom, teacher, week). Optionally narrowed to a
// date range on the observation's own timestamp.
export async function getStudentObservationHistory(personId, { startDate, endDate } = {}) {
  const params = [personId]
  let sql = `
    SELECT 
      o.PERSON_ID,
      o.STUDY_SESSION_ID,
      o.OBSERVATION_DATETIME,
      o.TEACHER_OBSERVATION_NOTE,
      o.OBSERVATION_MOTIF_ID,
      m.observation_motif_label_en, m.observation_motif_label_ar, m.observation_motif_label_fr,
      m.OBSERVATION_MOTIF_LABEL_EN,
      m.OBSERVATION_MOTIF_LABEL_AR,
      m.OBSERVATION_MOTIF_LABEL_FR,
      m.OBSERVATION_MOTIF_CODE,
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
      m2.MAJOR_LABEL_EN,
      m2.MAJOR_LABEL_AR,
      m2.MAJOR_LABEL_FR,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr,
      tg.TEACHING_GROUP_LABEL_EN,
      tg.TEACHING_GROUP_LABEL_AR,
      tg.TEACHING_GROUP_LABEL_FR
    FROM student_undergoes_observation_by_teacher o
    JOIN observation_motif m ON o.OBSERVATION_MOTIF_ID = m.OBSERVATION_MOTIF_ID
    JOIN study_session s ON o.STUDY_SESSION_ID = s.STUDY_SESSION_ID
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    LEFT JOIN person i ON s.INSTRUCTOR_ID = i.PERSON_ID
    LEFT JOIN study_session_type st ON s.STUDY_SESSION_TYPE_ID = st.STUDY_SESSION_TYPE_ID
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m2 ON s.MAJOR_ID = m2.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
    WHERE o.PERSON_ID = $1
  `
  if (startDate) {
    params.push(startDate)
    sql += ` AND o.OBSERVATION_DATETIME >= ($${params.length}::date || ' 00:00:00')::timestamp`
  }
  if (endDate) {
    params.push(endDate)
    sql += ` AND o.OBSERVATION_DATETIME <= ($${params.length}::date || ' 23:59:59')::timestamp`
  }
  sql += ` ORDER BY o.OBSERVATION_DATETIME DESC`
  return await query(sql, params)
}

// Global (all-students) observation history for consultation/analytics.
// Optional narrowing by date range, major, teaching group, instructor or motif.
export async function getGlobalObservationHistory({ startDate, endDate, majorId, teachingGroupId, instructorId, motifId } = {}) {
  const params = []
  const conditions = []
  let sql = `
    SELECT 
      o.PERSON_ID,
      o.STUDY_SESSION_ID,
      o.OBSERVATION_DATETIME,
      o.TEACHER_OBSERVATION_NOTE,
      o.OBSERVATION_MOTIF_ID,
      m.observation_motif_label_en, m.observation_motif_label_ar, m.observation_motif_label_fr,
      m.OBSERVATION_MOTIF_CODE,
      ${personNameColumns('p', 'STUDENT_NAME')},
      ${personNameColumns('i', 'INSTRUCTOR_NAME')},
      s.STUDY_SESSION_START_TIME,
      s.STUDY_SESSION_END_TIME,
      st.study_session_type_label_en, st.study_session_type_label_ar, st.study_session_type_label_fr,
      d.STUDY_DAY_DATE,
      w.STUDY_WEEK_ID,
      w.study_week_label_en, w.study_week_label_ar, w.study_week_label_fr,
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr,
      m2.MAJOR_ID,
      m2.MAJOR_LABEL_EN, m2.MAJOR_LABEL_AR, m2.MAJOR_LABEL_FR,
      tg.TEACHING_GROUP_ID,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
    FROM student_undergoes_observation_by_teacher o
    JOIN observation_motif m ON o.OBSERVATION_MOTIF_ID = m.OBSERVATION_MOTIF_ID
    JOIN person p ON o.PERSON_ID = p.PERSON_ID
    JOIN study_session s ON o.STUDY_SESSION_ID = s.STUDY_SESSION_ID
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    LEFT JOIN person i ON s.INSTRUCTOR_ID = i.PERSON_ID
    LEFT JOIN study_session_type st ON s.STUDY_SESSION_TYPE_ID = st.STUDY_SESSION_TYPE_ID
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m2 ON s.MAJOR_ID = m2.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
  `
  if (startDate) {
    params.push(startDate)
    conditions.push(`o.OBSERVATION_DATETIME >= ($${params.length}::date || ' 00:00:00')::timestamp`)
  }
  if (endDate) {
    params.push(endDate)
    conditions.push(`o.OBSERVATION_DATETIME <= ($${params.length}::date || ' 23:59:59')::timestamp`)
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
  if (motifId) {
    params.push(motifId)
    conditions.push(`o.OBSERVATION_MOTIF_ID = $${params.length}`)
  }
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`
  }
  sql += ` ORDER BY o.OBSERVATION_DATETIME DESC`
  return await query(sql, params)
}

// The observation kept on this computer until the server answers. The timestamp
// was already fixed by the caller, and it is part of the row's key, so sending
// the same entry twice updates that record rather than adding a second one.
function queueObservation(data) {
  const personId = Number(data.PERSON_ID ?? data.person_id) || null
  const sessionId = Number(data.STUDY_SESSION_ID ?? data.study_session_id) || null
  const id = enqueueOutbox({
    kind: 'observation.create',
    personId,
    sessionId,
    additive: true,
    desired: {
      PERSON_ID: personId,
      STUDY_SESSION_ID: sessionId,
      OBSERVATION_MOTIF_ID: Number(data.OBSERVATION_MOTIF_ID ?? data.observation_motif_id) || null,
      PER_PERSON_ID: Number(data.PER_PERSON_ID ?? data.per_person_id) || null,
      TEACHER_OBSERVATION_NOTE: String(
        data.TEACHER_OBSERVATION_NOTE ?? data.teacher_observation_note ?? ''
      ),
      OBSERVATION_DATETIME: data.OBSERVATION_DATETIME ?? data.observation_datetime ?? null
    }
  })
  if (!id) {
    throw new Error(
      'The server is unreachable and this computer could not store the change. Do not close the application; try again.'
    )
  }
  // The timestamp is returned so the page can show the record exactly as it will
  // be stored.
  return {
    success: true,
    queued: true,
    outboxId: id,
    OBSERVATION_DATETIME: data.OBSERVATION_DATETIME
  }
}

export async function createObservation(observationData) {
  if (!observationData.OBSERVATION_DATETIME) {
    const d = new Date()
    const pad = (num) => String(num).padStart(2, '0')
    const year = d.getFullYear()
    const month = pad(d.getMonth() + 1)
    const date = pad(d.getDate())
    const hours = pad(d.getHours())
    const minutes = pad(d.getMinutes())
    const seconds = pad(d.getSeconds())
    observationData.OBSERVATION_DATETIME = `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`
  }

  const columns = Object.keys(observationData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(observationData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(observationData)

  // Offline: the observation is kept on this computer, with the timestamp fixed
  // above, and sent with the rest of the class register.
  if (isOffline()) return queueObservation(observationData)

  const sql = `
    INSERT INTO student_undergoes_observation_by_teacher (${columns}) 
    VALUES (${pgPlaceholders})
    ON CONFLICT (person_id, study_session_id, observation_motif_id, per_person_id, observation_datetime) 
    DO UPDATE SET 
      teacher_observation_note = EXCLUDED.teacher_observation_note
  `
  try {
    await query(sql, values)

    // An observation is only ever written by the teacher in front of the class,
    // so it registers the session as taken.
    await touchSessionRegister(
      observationData.STUDY_SESSION_ID ?? observationData.study_session_id,
      observationData.PER_PERSON_ID ?? observationData.per_person_id,
      'SAVED_OBSERVATION'
    )
  } catch (error) {
    // The connection dropped before the row landed: keep it instead of losing
    // the note the teacher just wrote.
    if (!isConnectionError(error)) throw error
    return queueObservation(observationData)
  }

  return { success: true, ...observationData }
}

// A deletion kept on this computer. The note the teacher was looking at is the
// snapshot: if that row now says something else (a colleague edited it, or an
// earlier queued note of their own landed), the replay refuses to delete and the
// two versions are shown instead.
function queueObservationDelete({ key, note }) {
  const id = enqueueOutbox({
    kind: 'observation.delete',
    personId: Number(key.PERSON_ID) || null,
    sessionId: Number(key.STUDY_SESSION_ID) || null,
    desired: {
      PERSON_ID: Number(key.PERSON_ID),
      STUDY_SESSION_ID: Number(key.STUDY_SESSION_ID),
      OBSERVATION_MOTIF_ID: Number(key.OBSERVATION_MOTIF_ID),
      PER_PERSON_ID: Number(key.PER_PERSON_ID),
      OBSERVATION_DATETIME: key.OBSERVATION_DATETIME
    },
    expected: {
      justificationId: null,
      perPersonId: Number(key.PER_PERSON_ID) || null,
      note: String(note ?? '')
    }
  })
  if (!id) {
    throw new Error(
      'The server is unreachable and this computer could not store the change. Do not close the application; try again.'
    )
  }
  return { success: true, queued: true, outboxId: id }
}

// Every note of one student in one session (the absence form removes them when a
// student is marked absent). Nothing to compare: deleting the set is the intent,
// and a second attempt finds nothing left to delete.
function queueObservationClear(personId, sessionId) {
  const id = enqueueOutbox({
    kind: 'observation.clear',
    personId: Number(personId) || null,
    sessionId: Number(sessionId) || null
  })
  if (!id) {
    throw new Error(
      'The server is unreachable and this computer could not store the change. Do not close the application; try again.'
    )
  }
  return { success: true, queued: true, outboxId: id }
}

export async function deleteObservation(observationData) {
  const { PERSON_ID, STUDY_SESSION_ID, OBSERVATION_MOTIF_ID, PER_PERSON_ID, OBSERVATION_DATETIME } = observationData
  const key = { PERSON_ID, STUDY_SESSION_ID, OBSERVATION_MOTIF_ID, PER_PERSON_ID, OBSERVATION_DATETIME }

  if (!PERSON_ID || !STUDY_SESSION_ID || !OBSERVATION_MOTIF_ID || !PER_PERSON_ID || !OBSERVATION_DATETIME) {
    throw new Error('Select an observation to delete.')
  }

  if (isOffline()) {
    return queueObservationDelete({ key, note: observationData.TEACHER_OBSERVATION_NOTE })
  }

  try {
    await query(`
      DELETE FROM student_undergoes_observation_by_teacher 
      WHERE person_id = $1 AND study_session_id = $2 AND observation_motif_id = $3 AND per_person_id = $4 AND observation_datetime = $5
    `, [PERSON_ID, STUDY_SESSION_ID, OBSERVATION_MOTIF_ID, PER_PERSON_ID, OBSERVATION_DATETIME])
  } catch (error) {
    if (!isConnectionError(error)) throw error
    return queueObservationDelete({ key, note: observationData.TEACHER_OBSERVATION_NOTE })
  }

  return { success: true }
}

export async function deleteStudentObservationsForSession(studentId, sessionId) {
  if (isOffline()) return queueObservationClear(studentId, sessionId)

  try {
    await query('DELETE FROM student_undergoes_observation_by_teacher WHERE person_id = $1 AND study_session_id = $2', [studentId, sessionId])
  } catch (error) {
    if (!isConnectionError(error)) throw error
    return queueObservationClear(studentId, sessionId)
  }

  return { success: true }
}
