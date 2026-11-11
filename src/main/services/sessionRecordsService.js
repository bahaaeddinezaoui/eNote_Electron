import { query } from '../db'
import { getStudySessions } from './scheduleService'

// Study-session consultation for the people who oversee teaching.
//
// One week at a time: every scheduled session with its subject, group,
// classroom, teacher and type, plus the absences and observations recorded
// against it. The lists come back nested so the page renders a session and its
// records together instead of issuing a query per row.
//
// Reading is limited to ADMIN and DIRECTOR, checked against the acting
// account's role_id rather than the renderer's idea of the signed-in roles.

const OVERSIGHT_ROLES = ['ADMIN', 'DIRECTOR']

async function requireOversight(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const res = await query(
    `SELECT u.is_active,
            COALESCE(array_agg(DISTINCT r.role_code), '{}') AS roles
     FROM "user" u
     LEFT JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1
     GROUP BY u.user_id, u.is_active`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  if (row.IS_ACTIVE === false) throw new Error('Not allowed: this account is inactive.')

  const roles = row.ROLES || []
  if (!OVERSIGHT_ROLES.some((code) => roles.includes(code))) {
    throw new Error('Not allowed: requires the Admin or Director role.')
  }
  return { userId: id, roles }
}

// Who the session's teaching group contains, so an absence can be read against
// the size of the class it happened in.
async function loadRosterSizes(weekId) {
  const res = await query(
    `SELECT s.teaching_group_id,
            count(DISTINCT sdg.person_id)::int AS roster
     FROM study_session s
     JOIN study_day d ON d.study_day_id = s.study_day_id
     JOIN student_dynamic_group_by_major sdg ON sdg.teaching_group_id = s.teaching_group_id
     WHERE d.study_week_id = $1 AND s.teaching_group_id IS NOT NULL
     GROUP BY s.teaching_group_id`,
    [weekId]
  )
  const sizes = new Map()
  for (const row of res.data || []) sizes.set(Number(row.TEACHING_GROUP_ID), row.ROSTER)
  return sizes
}

// Each record carries the key the director comments are stored under — the
// same expression the absence and observation screens and the notification
// triggers use, so a comment written from here is the one seen everywhere
// else — and the number already written against it.
const ABSENCE_KEY = `'ABSENCE:' || a.person_id || ':' || a.study_session_id`

async function loadWeekAbsences(weekId) {
  const res = await query(
    `SELECT a.study_session_id,
            a.person_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) || ' ' ||
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS student_name,
            j.absence_justification_label_en, j.absence_justification_label_ar, j.absence_justification_label_fr,
            j.absence_justification_code,
            a.teacher_absence_note,
            ${ABSENCE_KEY} AS record_key,
            (SELECT count(*)::int FROM director_comment c
              WHERE c.record_key = ${ABSENCE_KEY}) AS comment_count
     FROM student_gets_absent a
     JOIN person p ON p.person_id = a.person_id
     JOIN absence_justification j ON j.absence_justification_id = a.absence_justification_id
     JOIN study_session s ON s.study_session_id = a.study_session_id
     JOIN study_day d ON d.study_day_id = s.study_day_id
     WHERE d.study_week_id = $1
     ORDER BY COALESCE(p.person_last_name_la, p.person_last_name_ar),
              COALESCE(p.person_first_name_la, p.person_first_name_ar)`,
    [weekId]
  )
  return res.data || []
}

const OBSERVATION_KEY = `'OBSERVATION:' || o.person_id || ':' || o.study_session_id || ':' ||
  o.observation_motif_id || ':' || o.per_person_id || ':' ||
  to_char(o.observation_datetime, 'YYYY-MM-DD HH24:MI:SS')`

async function loadWeekObservations(weekId) {
  const res = await query(
    `SELECT o.study_session_id,
            o.person_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) || ' ' ||
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS student_name,
            m.observation_motif_label_en, m.observation_motif_label_ar, m.observation_motif_label_fr,
            m.observation_motif_code,
            o.teacher_observation_note,
            o.observation_datetime,
            ${OBSERVATION_KEY} AS record_key,
            (SELECT count(*)::int FROM director_comment c
              WHERE c.record_key = ${OBSERVATION_KEY}) AS comment_count
     FROM student_undergoes_observation_by_teacher o
     JOIN person p ON p.person_id = o.person_id
     JOIN observation_motif m ON m.observation_motif_id = o.observation_motif_id
     JOIN study_session s ON s.study_session_id = o.study_session_id
     JOIN study_day d ON d.study_day_id = s.study_day_id
     WHERE d.study_week_id = $1
     ORDER BY o.observation_datetime`,
    [weekId]
  )
  return res.data || []
}

// Compact identity card for one student, shown from an absence or observation
// line without leaving the week. Nothing here is editable: it is the context a
// reader needs to judge the record, plus how often this student appears in each
// list overall.
export async function getSessionStudentInfo(userId, personId) {
  await requireOversight(userId)

  const id = parseInt(personId, 10)
  if (!id) throw new Error('Choose a student.')

  const res = await query(
    `SELECT p.person_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar,
            p.person_sex,
            p.person_birthdate, p.person_photo,
            sd.student_personal_phone, sd.student_blood_type, sd.student_academic_average,
            sec.section_label_en, sec.section_label_ar, sec.section_label_fr, sec.section_code, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr,
            (SELECT count(*)::int FROM student_gets_absent a
              WHERE a.person_id = p.person_id) AS absence_total,
            (SELECT count(*)::int FROM student_undergoes_observation_by_teacher o
              WHERE o.person_id = p.person_id) AS observation_total
     FROM person p
     LEFT JOIN student_detail sd ON sd.person_id = p.person_id
     LEFT JOIN LATERAL (
       SELECT s.section_label_en, s.section_label_ar, s.section_label_fr, s.section_code, s.teaching_category_id
       FROM student_section ss
       JOIN section s ON s.section_id = ss.section_id
       WHERE ss.person_id = p.person_id
       ORDER BY s.section_label_en, s.section_label_ar, s.section_label_fr, s.section_id
       LIMIT 1
     ) sec ON TRUE
     LEFT JOIN teaching_category tc ON tc.teaching_category_id = sec.teaching_category_id
     WHERE p.person_id = $1`,
    [id]
  )
  const student = res.data?.[0]
  if (!student) throw new Error('Student not found.')
  return { success: true, student }
}

export async function getWeekSessionRecords(userId, weekId) {
  await requireOversight(userId)

  const id = parseInt(weekId, 10)
  if (!id) throw new Error('Choose a study week.')

  const [sessionsRes, absences, observations, rosterSizes] = await Promise.all([
    getStudySessions(id),
    loadWeekAbsences(id),
    loadWeekObservations(id),
    loadRosterSizes(id)
  ])

  const sessions = (sessionsRes?.data || []).map((session) => ({
    ...session,
    ROSTER: rosterSizes.get(Number(session.TEACHING_GROUP_ID)) || 0,
    ABSENCES: [],
    OBSERVATIONS: []
  }))
  const bySession = new Map(sessions.map((session) => [Number(session.STUDY_SESSION_ID), session]))

  for (const absence of absences) {
    bySession.get(Number(absence.STUDY_SESSION_ID))?.ABSENCES.push(absence)
  }
  for (const observation of observations) {
    bySession.get(Number(observation.STUDY_SESSION_ID))?.OBSERVATIONS.push(observation)
  }

  const totals = sessions.reduce(
    (acc, session) => {
      acc.sessions += 1
      acc.absences += session.ABSENCES.length
      acc.unexcused += session.ABSENCES.filter((a) => a.ABSENCE_JUSTIFICATION_CODE === 'UNEXCUSED').length
      acc.observations += session.OBSERVATIONS.length
      if (session.ABSENCES.length || session.OBSERVATIONS.length) acc.withRecords += 1
      return acc
    },
    { sessions: 0, absences: 0, unexcused: 0, observations: 0, withRecords: 0 }
  )

  return { success: true, sessions, totals }
}
