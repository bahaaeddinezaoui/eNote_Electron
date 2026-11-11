import { query } from '../db'
import { personNameColumns } from '../sqlPersonName'
import { assertTeachingGroupAllowed, assertStudySessionAllowed } from './teachingScopeService'
import { assertTeacherConstraints } from './teacherConstraintService'
import { notifySessionAssigned } from './notificationScanService'

// Common joins so every session row exposes its concrete day (date) and, via
// the day, its study week.
const sessionDayJoins = `
    LEFT JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    LEFT JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
  `

const sessionDaySelects = `
      d.STUDY_DAY_DATE,
      w.STUDY_WEEK_ID,
      w.study_week_label_en, w.study_week_label_ar, w.study_week_label_fr,
      w.STUDY_WEEK_START_DATE,
      w.STUDY_WEEK_END_DATE,
  `

// The concrete days (dates) of a study week, in calendar order. Study weeks
// run Sunday→Saturday, so date order already puts Sunday first — and a day
// can never be slotted between two later days again.
export async function getStudyWeekDays(weekId) {
  if (!weekId) return { source: 'postgres', data: [], rowCount: 0 }
  return await query(
    'SELECT * FROM study_day WHERE study_week_id = $1 ORDER BY study_day_date',
    [parseInt(weekId, 10)]
  )
}

export async function getStudySessions(weekId, teachingGroupId, scope) {
  let sql = `
    SELECT
      s.*,
      ${sessionDaySelects}
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr,
      m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr,
      st.STUDY_SESSION_TYPE_CODE,
      st.study_session_type_label_en, st.study_session_type_label_ar, st.study_session_type_label_fr,
      ${personNameColumns('p', 'INSTRUCTOR_NAME')}
    FROM study_session s
    ${sessionDayJoins}
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m ON s.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
    LEFT JOIN major tgm ON tgm.MAJOR_ID = tg.MAJOR_ID
    LEFT JOIN study_session_type st ON s.STUDY_SESSION_TYPE_ID = st.STUDY_SESSION_TYPE_ID
    LEFT JOIN person p ON s.INSTRUCTOR_ID = p.PERSON_ID
  `
  const conditions = []
  const params = []

  if (weekId) {
    params.push(parseInt(weekId, 10))
    conditions.push(`d.STUDY_WEEK_ID = $${params.length}`)
  }

  if (teachingGroupId) {
    params.push(parseInt(teachingGroupId, 10))
    conditions.push(`s.TEACHING_GROUP_ID = $${params.length}`)
  }

  // A scoped scheduler only ever reads the timetable of their own categories.
  if (scope?.restricted) {
    params.push(scope.categoryIds)
    conditions.push(`tg.TEACHING_CATEGORY_ID = ANY($${params.length}::int[])`)
  }

  // A scheduler is also responsible for departments. The department owns a major
  // category, and a session's major names one, so both halves must match.
  if (scope?.departmentRestricted) {
    params.push(scope.majorCategoryIds)
    conditions.push(`tgm.MAJOR_CATEGORY_ID = ANY($${params.length}::int[])`)
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ')
  }

  sql += ` ORDER BY d.STUDY_DAY_DATE, s.STUDY_SESSION_START_TIME`
  return await query(sql, params)
}

// Exam events for the weekly timetable: exams scheduled within the selected
// study week, flattened per exam-group room (each group's sitting is one block
// on the grid; a room shared by several groups of the same exam collapses to
// one block per room). Teaching groups "in question" = the groups of the
// exam's major; when a specific teaching group is selected, only exams of
// that group's major show (the selected week already scopes the time window,
// so no extra semester matching is needed). Exams without datetimes are
// skipped (nothing to draw); exams without seating yet still show (roomless).
export async function getExamEvents(weekId, teachingGroupId) {
  if (!weekId) return { source: 'postgres', data: [], rowCount: 0 }

  const weekRes = await query(
    `SELECT STUDY_WEEK_ID, STUDY_WEEK_START_DATE, STUDY_WEEK_END_DATE, STUDY_SEMESTER_ID
     FROM study_week WHERE STUDY_WEEK_ID = $1`,
    [parseInt(weekId, 10)]
  )
  const week = weekRes?.data?.[0]
  if (!week) return { source: 'postgres', data: [], rowCount: 0 }

  // Exam overlaps the week when it starts before the week ends and ends after
  // the week starts (same overlap rule used by the session booking checks).
  const conditions = [
    `e.EXAMINATION_START_DATETIME IS NOT NULL`,
    `e.EXAMINATION_END_DATETIME IS NOT NULL`,
    `e.EXAMINATION_START_DATETIME::date <= $2::date`,
    `e.EXAMINATION_END_DATETIME::date >= $1::date`
  ]
  const params = [week.STUDY_WEEK_START_DATE, week.STUDY_WEEK_END_DATE]

  if (teachingGroupId) {
    // The exam concerns this group when the group shares the exam's major.
    // Semester is deliberately NOT matched: teaching groups and exams may be
    // scoped to different semesters while still overlapping the same study
    // week, and an exam must not vanish from the timetable because of that.
    params.push(parseInt(teachingGroupId, 10))
    conditions.push(
      `EXISTS (
         SELECT 1 FROM teaching_group tg
          WHERE tg.TEACHING_GROUP_ID = $${params.length}
            AND tg.MAJOR_ID = e.MAJOR_ID
       )`
    )
  }

  return await query(
    `
    SELECT e.EXAMINATION_ID,
           e.EXAMINATION_CODE,
           e.examination_label_en, e.examination_label_ar, e.examination_label_fr,
           e.EXAMINATION_START_DATETIME,
           e.EXAMINATION_END_DATETIME,
           m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
           e.STUDY_SEMESTER_ID,
           c.CLASSROOM_ID,
           c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr,
           c.CLASSROOM_CODE,
           (SELECT COUNT(*) FROM examination_group eg2
             WHERE eg2.EXAMINATION_ID = e.EXAMINATION_ID
               AND eg2.CLASSROOM_ID = c.CLASSROOM_ID) AS GROUP_COUNT,
           (SELECT STRING_AGG(COALESCE(tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr), ', ' ORDER BY tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr)
              FROM teaching_group tg
             WHERE tg.MAJOR_ID = e.MAJOR_ID
               AND (e.STUDY_SEMESTER_ID IS NULL OR tg.STUDY_SEMESTER_ID = e.STUDY_SEMESTER_ID)) AS TEACHING_GROUPS,
           (SELECT STRING_AGG(COALESCE(NULLIF(tg.TEACHING_GROUP_LABEL_AR, ''), COALESCE(tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr)), ', '
                              ORDER BY COALESCE(NULLIF(tg.TEACHING_GROUP_LABEL_AR, ''), tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr))
              FROM teaching_group tg
             WHERE tg.MAJOR_ID = e.MAJOR_ID
               AND (e.STUDY_SEMESTER_ID IS NULL OR tg.STUDY_SEMESTER_ID = e.STUDY_SEMESTER_ID)) AS TEACHING_GROUPS_AR,
           (SELECT STRING_AGG(COALESCE(NULLIF(tg.TEACHING_GROUP_LABEL_FR, ''), COALESCE(tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr)), ', '
                              ORDER BY COALESCE(NULLIF(tg.TEACHING_GROUP_LABEL_FR, ''), tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr))
              FROM teaching_group tg
             WHERE tg.MAJOR_ID = e.MAJOR_ID
               AND (e.STUDY_SEMESTER_ID IS NULL OR tg.STUDY_SEMESTER_ID = e.STUDY_SEMESTER_ID)) AS TEACHING_GROUPS_FR
    FROM examination e
    LEFT JOIN major m ON m.MAJOR_ID = e.MAJOR_ID
    LEFT JOIN examination_group eg ON eg.EXAMINATION_ID = e.EXAMINATION_ID
    LEFT JOIN classroom c ON c.CLASSROOM_ID = eg.CLASSROOM_ID
    WHERE ${conditions.join(' AND ')}
    ORDER BY e.EXAMINATION_START_DATETIME`,
    params
  )
}

function durationHours(startTime, endTime) {
  const [startH, startM] = (startTime || '00:00').split(':').map(Number)
  const [endH, endM] = (endTime || '00:00').split(':').map(Number)
  const minutes = endH * 60 + endM - startH * 60 - startM
  // An end of 00:00 is midnight closing the day, not the start of it.
  return (minutes < 0 ? minutes + 24 * 60 : minutes) / 60
}

function formatDateTime(dt) {
  if (!dt) return ''
  const d = new Date(dt)
  if (Number.isNaN(d.getTime())) return String(dt)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Resolve the study_day a session is (or will be) attached to. Returns the
// day row plus the week/semester context it belongs to.
async function resolveStudyDay(studyDayId) {
  if (!studyDayId) return null
  const res = await query(
    `SELECT d.STUDY_DAY_ID, d.STUDY_DAY_DATE, d.STUDY_WEEK_ID, w.STUDY_SEMESTER_ID
     FROM study_day d
     LEFT JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
     WHERE d.STUDY_DAY_ID = $1`,
    [studyDayId]
  )
  return res?.data?.[0] || null
}

function isoDateOf(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toISOString().slice(0, 10)
}

// Look up the hourly budget of a (major, semester, session type, teaching group)
// combination. Returns null when no target row exists (no cap configured).
async function getSessionTypeBudget(sessionData) {
  const { MAJOR_ID, TEACHING_GROUP_ID, STUDY_SESSION_TYPE_ID, STUDY_DAY_ID } = sessionData
  if (!MAJOR_ID || !TEACHING_GROUP_ID || !STUDY_SESSION_TYPE_ID || !STUDY_DAY_ID) return null

  const day = await resolveStudyDay(STUDY_DAY_ID)
  const semesterId = day?.STUDY_SEMESTER_ID
  if (!semesterId) return null

  const targetRes = await query(
    `SELECT mhvst.HOURLY_VOLUME,
            sst.study_session_type_label_en, sst.study_session_type_label_ar, sst.study_session_type_label_fr,
            tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
     FROM major_hourly_volume_by_session_type mhvst
     LEFT JOIN study_session_type sst ON sst.STUDY_SESSION_TYPE_ID = mhvst.STUDY_SESSION_TYPE_ID
     LEFT JOIN teaching_group tg ON tg.TEACHING_GROUP_ID = mhvst.TEACHING_GROUP_ID
     WHERE mhvst.MAJOR_ID = $1 AND mhvst.STUDY_SEMESTER_ID = $2
       AND mhvst.STUDY_SESSION_TYPE_ID = $3 AND mhvst.TEACHING_GROUP_ID = $4`,
    [MAJOR_ID, semesterId, STUDY_SESSION_TYPE_ID, TEACHING_GROUP_ID]
  )
  const target = targetRes.data?.[0]
  if (!target) return null // no cap configured for this type/group — allow

  const usedRes = await query(
    `SELECT s.STUDY_SESSION_START_TIME, s.STUDY_SESSION_END_TIME
     FROM study_session s
     JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
     JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
     WHERE s.MAJOR_ID = $1 AND w.STUDY_SEMESTER_ID = $2
       AND s.STUDY_SESSION_TYPE_ID = $3 AND s.TEACHING_GROUP_ID = $4`,
    [MAJOR_ID, semesterId, STUDY_SESSION_TYPE_ID, TEACHING_GROUP_ID]
  )
  let used = 0
  for (const row of usedRes.data || []) {
    used += durationHours(row.STUDY_SESSION_START_TIME, row.STUDY_SESSION_END_TIME)
  }

  return {
    hasTarget: true,
    target: Number(target.HOURLY_VOLUME) || 0,
    used,
    sessionTypeLabel: target.STUDY_SESSION_TYPE_LABEL || 'this session type',
    teachingGroupLabel: target.TEACHING_GROUP_LABEL || 'teaching group'
  }
}

// Read-only lookup for the UI: how many hours remain for a (type, group) pair.
export async function getSessionTypeRemainingHours(sessionData) {
  const budget = await getSessionTypeBudget(sessionData)
  if (!budget) {
    return { hasTarget: false, remainingHours: null }
  }
  return {
    hasTarget: true,
    target: budget.target,
    scheduledHours: budget.used,
    remainingHours: Math.max(0, budget.target - budget.used),
    sessionTypeLabel: budget.sessionTypeLabel,
    teachingGroupLabel: budget.teachingGroupLabel
  }
}

// When an hourly target exists for the selected session type + teaching group,
// refuse to create a session that would exceed the remaining hours.
async function assertSessionTypeHoursRemain(sessionData) {
  const budget = await getSessionTypeBudget(sessionData)
  if (!budget) return

  const duration = durationHours(sessionData.STUDY_SESSION_START_TIME, sessionData.STUDY_SESSION_END_TIME)
  if (duration <= 0) return

  if (budget.used + duration > budget.target + 1e-9) {
    const label = `${budget.sessionTypeLabel} (${budget.teachingGroupLabel})`
    const diff = budget.target - budget.used
    const budgetNote = diff >= 0
      ? `leaving ${diff.toFixed(1)} hour(s) of the ${budget.target}-hour target`
      : `already ${(-diff).toFixed(1)} hour(s) over the ${budget.target}-hour target`
    throw new Error(
      `This session would exceed the hourly target for ${label}: ${budget.used.toFixed(1)} hour(s) are already scheduled (${budgetNote}), and this session needs ${duration.toFixed(1)} hour(s).`
    )
  }
}

export async function createStudySession(sessionData, scope, constraintChoice = {}) {
  await assertTeachingGroupAllowed(scope, sessionData.TEACHING_GROUP_ID)

  const day = await resolveStudyDay(sessionData.STUDY_DAY_ID)
  if (!day) {
    throw new Error('The selected day is not a study day of any existing week. Please pick a day from the week you are scheduling in.')
  }
  const targetDate = isoDateOf(day.STUDY_DAY_DATE)

  // Prevent scheduling conflict within the selected teaching group
  const overlapQuery = `SELECT 1 FROM study_session s
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    WHERE d.STUDY_DAY_DATE = $1
      AND s.TEACHING_GROUP_ID = $2
      AND (
        (s.STUDY_SESSION_START_TIME < $3 AND s.STUDY_SESSION_END_TIME > $4)
      )
    LIMIT 1`

  const existing = await query(overlapQuery, [
    targetDate,
    sessionData.TEACHING_GROUP_ID,
    sessionData.STUDY_SESSION_END_TIME,
    sessionData.STUDY_SESSION_START_TIME
  ])

  if (existing.data && existing.data.length > 0) {
    throw new Error('That time slot is already taken for the selected teaching group. Please choose a different time.')
  }

  // Prevent scheduling a session that overlaps any session attended by a
  // student in the target group's roster (a student attends every session of
  // every teaching group they belong to, so the roster's other groups count).
  // Single set-based query: self-join the roster to collect all teaching
  // groups its students belong to, then look for a time-overlapping session
  // in any of those groups. One round trip regardless of roster size.
  const rosterOverlapQuery = `
    SELECT s.STUDY_SESSION_ID, s.TEACHING_GROUP_ID, tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr,
           s.STUDY_SESSION_START_TIME, s.STUDY_SESSION_END_TIME
    FROM study_session s
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    LEFT JOIN teaching_group tg ON tg.TEACHING_GROUP_ID = s.TEACHING_GROUP_ID
    WHERE d.STUDY_DAY_DATE = $1
      AND s.STUDY_SESSION_START_TIME < $2
      AND s.STUDY_SESSION_END_TIME > $3
      AND s.TEACHING_GROUP_ID IN (
        SELECT DISTINCT sdg2.TEACHING_GROUP_ID
        FROM student_dynamic_group_by_major sdg1
        JOIN student_dynamic_group_by_major sdg2 ON sdg2.PERSON_ID = sdg1.PERSON_ID
        WHERE sdg1.TEACHING_GROUP_ID = $4
      )
      AND s.TEACHING_GROUP_ID <> $4
    LIMIT 1`

  const rosterOverlap = await query(rosterOverlapQuery, [
    targetDate,
    sessionData.STUDY_SESSION_END_TIME,
    sessionData.STUDY_SESSION_START_TIME,
    sessionData.TEACHING_GROUP_ID
  ])

  if (rosterOverlap.data && rosterOverlap.data.length > 0) {
    const conflict = rosterOverlap.data[0]
    const groupLabel = conflict.TEACHING_GROUP_LABEL || `teaching group #${conflict.TEACHING_GROUP_ID}`
    throw new Error(
      `This session overlaps a class that a student in this teaching group already attends ` +
      `(${groupLabel}, ${conflict.STUDY_SESSION_START_TIME}-${conflict.STUDY_SESSION_END_TIME}). Please choose a different time.`
    )
  }

  // Prevent double-booking the instructor: no other session may be taught by
  // the same instructor at an overlapping time, regardless of teaching group.
  // Skipped when the session has no instructor assigned.
  if (sessionData.INSTRUCTOR_ID) {
    const instructorOverlapQuery = `
      SELECT s.STUDY_SESSION_START_TIME, s.STUDY_SESSION_END_TIME,
             tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
      FROM study_session s
      JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
      LEFT JOIN teaching_group tg ON tg.TEACHING_GROUP_ID = s.TEACHING_GROUP_ID
      WHERE d.STUDY_DAY_DATE = $1
        AND s.INSTRUCTOR_ID = $2
        AND s.STUDY_SESSION_START_TIME < $3
        AND s.STUDY_SESSION_END_TIME > $4
      LIMIT 1`

    const instructorOverlap = await query(instructorOverlapQuery, [
      targetDate,
      sessionData.INSTRUCTOR_ID,
      sessionData.STUDY_SESSION_END_TIME,
      sessionData.STUDY_SESSION_START_TIME
    ])

    if (instructorOverlap.data && instructorOverlap.data.length > 0) {
      const conflict = instructorOverlap.data[0]
      const groupLabel = conflict.TEACHING_GROUP_LABEL || 'another teaching group'
      throw new Error(
        `This instructor is already teaching another session at this time ` +
        `(${groupLabel}, ${conflict.STUDY_SESSION_START_TIME}-${conflict.STUDY_SESSION_END_TIME}). ` +
        `Please choose a different time.`
      )
    }
  }

  // Prevent double-booking the classroom: no other session may use the same
  // classroom at an overlapping time, regardless of teaching group. Skipped
  // when the session has no classroom assigned.
  if (sessionData.CLASSROOM_ID) {
    const classroomOverlapQuery = `
      SELECT s.STUDY_SESSION_START_TIME, s.STUDY_SESSION_END_TIME,
             tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
      FROM study_session s
      JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
      LEFT JOIN teaching_group tg ON tg.TEACHING_GROUP_ID = s.TEACHING_GROUP_ID
      WHERE d.STUDY_DAY_DATE = $1
        AND s.CLASSROOM_ID = $2
        AND s.STUDY_SESSION_START_TIME < $3
        AND s.STUDY_SESSION_END_TIME > $4
      LIMIT 1`

    const classroomOverlap = await query(classroomOverlapQuery, [
      targetDate,
      sessionData.CLASSROOM_ID,
      sessionData.STUDY_SESSION_END_TIME,
      sessionData.STUDY_SESSION_START_TIME
    ])

    if (classroomOverlap.data && classroomOverlap.data.length > 0) {
      const conflict = classroomOverlap.data[0]
      const groupLabel = conflict.TEACHING_GROUP_LABEL || 'another teaching group'
      throw new Error(
        `This classroom is already booked at this time ` +
        `(${groupLabel}, ${conflict.STUDY_SESSION_START_TIME}-${conflict.STUDY_SESSION_END_TIME}). ` +
        `Please choose a different time or room.`
      )
    }

    // A room has to seat the whole class: refuse a session whose teaching group
    // has more students than the classroom's capacity. A room without a
    // capacity set carries no limit to compare the roster against.
    const roomRes = await query(
      `SELECT c.CLASSROOM_CAPACITY,
              COALESCE(c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr, c.CLASSROOM_CODE) AS classroom_label,
              (SELECT COUNT(DISTINCT sdg.PERSON_ID)
                 FROM student_dynamic_group_by_major sdg
                 JOIN person p ON p.PERSON_ID = sdg.PERSON_ID
                WHERE sdg.TEACHING_GROUP_ID = $2 AND p.IS_STUDENT = TRUE) AS student_count
         FROM classroom c
        WHERE c.CLASSROOM_ID = $1`,
      [sessionData.CLASSROOM_ID, sessionData.TEACHING_GROUP_ID]
    )
    const room = roomRes.data?.[0]
    const capacity = room?.CLASSROOM_CAPACITY
    const students = Number(room?.STUDENT_COUNT) || 0
    if (room && capacity !== null && capacity !== undefined && students > Number(capacity)) {
      throw new Error(
        `This classroom cannot seat the whole group: ${room.CLASSROOM_LABEL || 'the room'} has ${capacity} seat(s) ` +
        `but the group has ${students} student(s). Please choose a classroom with enough seats.`
      )
    }
  }

  // Prevent scheduling a session at a time when the classroom is booked by an
  // examination (exams carry an absolute start/end datetime; the rooms they
  // occupy are the rooms of their exam groups).
  if (sessionData.CLASSROOM_ID) {
    const examClassroomOverlapQuery = `
      SELECT e.EXAMINATION_ID, e.examination_label_en, e.examination_label_ar, e.examination_label_fr,
             e.EXAMINATION_START_DATETIME, e.EXAMINATION_END_DATETIME,
             c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr
      FROM examination e
      JOIN examination_group eg ON eg.EXAMINATION_ID = e.EXAMINATION_ID AND eg.CLASSROOM_ID = $1
      LEFT JOIN classroom c ON c.CLASSROOM_ID = eg.CLASSROOM_ID
      WHERE e.EXAMINATION_START_DATETIME < ($2::date + $3::time)
        AND e.EXAMINATION_END_DATETIME > ($2::date + $4::time)
      LIMIT 1`

    const examClassroomOverlap = await query(examClassroomOverlapQuery, [
      sessionData.CLASSROOM_ID,
      targetDate,
      sessionData.STUDY_SESSION_END_TIME,
      sessionData.STUDY_SESSION_START_TIME
    ])

    if (examClassroomOverlap.data && examClassroomOverlap.data.length > 0) {
      const conflict = examClassroomOverlap.data[0]
      const label = conflict.EXAMINATION_LABEL || `examination #${conflict.EXAMINATION_ID}`
      throw new Error(
        `This classroom is already booked for an examination at this time ` +
        `(${label}, ${formatDateTime(conflict.EXAMINATION_START_DATETIME)}-${formatDateTime(conflict.EXAMINATION_END_DATETIME)}). ` +
        `Please choose a different time or room.`
      )
    }
  }

  // Prevent scheduling a session when the instructor is on guard duty for an
  // examination that overlaps the session's time slot.
  if (sessionData.INSTRUCTOR_ID) {
    const examGuardOverlapQuery = `
      SELECT e.EXAMINATION_ID, e.examination_label_en, e.examination_label_ar, e.examination_label_fr,
             e.EXAMINATION_START_DATETIME, e.EXAMINATION_END_DATETIME
      FROM examination e
      JOIN person_is_guard_in_examination g ON g.EXAMINATION_ID = e.EXAMINATION_ID
      WHERE g.PERSON_ID = $1
        AND e.EXAMINATION_START_DATETIME < ($2::date + $3::time)
        AND e.EXAMINATION_END_DATETIME > ($2::date + $4::time)
      LIMIT 1`

    const examGuardOverlap = await query(examGuardOverlapQuery, [
      sessionData.INSTRUCTOR_ID,
      targetDate,
      sessionData.STUDY_SESSION_END_TIME,
      sessionData.STUDY_SESSION_START_TIME
    ])

    if (examGuardOverlap.data && examGuardOverlap.data.length > 0) {
      const conflict = examGuardOverlap.data[0]
      const label = COALESCE(conflict.examination_label_en, conflict.examination_label_ar, conflict.examination_label_fr) || `examination #${conflict.EXAMINATION_ID}`
      throw new Error(
        `This instructor is already scheduled to guard an examination at this time ` +
        `(${label}, ${formatDateTime(conflict.EXAMINATION_START_DATETIME)}-${formatDateTime(conflict.EXAMINATION_END_DATETIME)}). ` +
        `Please choose a different time.`
      )
    }
  }

  // Enforce the remaining-hours budget for the selected session type & group
  await assertSessionTypeHoursRemain(sessionData)

  // Teacher constraints for the week: hard windows always refuse the slot;
  // soft windows refuse it only when the policy in force asks the scheduler to
  // respect them (see teacherConstraintService).
  await assertTeacherConstraints(sessionData, constraintChoice)

  const clean = {}
  for (const k of Object.keys(sessionData)) {
    // Only carry columns that exist on study_session (e.g. the UI may also
    // send STUDY_WEEK_ID for convenience; it is derived from the day now).
    const col = k.toLowerCase()
    if (sessionData[k] === null || sessionData[k] === undefined) continue
    if (col === 'study_week_id' || col === 'study_session_day_of_week') continue
    clean[col] = sessionData[k]
  }

  const columns = Object.keys(clean).join(', ')
  const pgPlaceholders = Object.keys(clean).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(clean)

  const insertSql = `INSERT INTO study_session (${columns}) VALUES (${pgPlaceholders}) RETURNING study_session_id`
  const insertResult = await query(insertSql, values)
  const newSessionId = insertResult.data?.[0]?.STUDY_SESSION_ID

  const newSession = { ...sessionData, STUDY_SESSION_ID: newSessionId }

  // Update hourly volume progress for home sections in teaching group's roster
  try {
    const semesterId = day.STUDY_SEMESTER_ID

    if (semesterId && sessionData.TEACHING_GROUP_ID && sessionData.MAJOR_ID) {
      const sectionsResult = await query(`
        SELECT DISTINCT ss.SECTION_ID
        FROM student_dynamic_group_by_major sdg
        JOIN student_section ss ON ss.PERSON_ID = sdg.PERSON_ID
        WHERE sdg.TEACHING_GROUP_ID = $1
      `, [sessionData.TEACHING_GROUP_ID])

      const sessionHours = durationHours(sessionData.STUDY_SESSION_START_TIME, sessionData.STUDY_SESSION_END_TIME)

      for (const section of sectionsResult.data || []) {
        const sectionId = section.SECTION_ID

        const existingVolume = await query(`
          SELECT HOURLY_VOLUME FROM teaching_section_hourly_volume
          WHERE SECTION_ID = $1 AND MAJOR_ID = $2 AND STUDY_SEMESTER_ID = $3
        `, [sectionId, sessionData.MAJOR_ID, semesterId])

        if (existingVolume.data && existingVolume.data.length > 0) {
          const currentVolume = existingVolume.data[0].HOURLY_VOLUME || 0
          const newVolume = currentVolume + sessionHours

          await query(`
            UPDATE teaching_section_hourly_volume
            SET HOURLY_VOLUME = $1
            WHERE SECTION_ID = $2 AND MAJOR_ID = $3 AND STUDY_SEMESTER_ID = $4
          `, [newVolume, sectionId, sessionData.MAJOR_ID, semesterId])
        } else {
          await query(`
            INSERT INTO teaching_section_hourly_volume (section_id, major_id, study_semester_id, hourly_volume)
            VALUES ($1, $2, $3, $4)
          `, [sectionId, sessionData.MAJOR_ID, semesterId, sessionHours])
        }
      }
    }
  } catch (error) {
    console.error('Failed to update hourly volume progress for sections:', error)
  }

  // A class added to someone's week is news to that teacher. Best-effort: a
  // notification that fails must never undo a session that was saved.
  if (sessionData.INSTRUCTOR_ID) {
    try {
      await notifySessionAssigned({
        sessionId: newSessionId,
        instructorPersonId: sessionData.INSTRUCTOR_ID
      })
    } catch (error) {
      console.warn('Could not tell the instructor about the new session:', error.message)
    }
  }

  return newSession
}

export async function deleteStudySession(id, scope) {
  await assertStudySessionAllowed(scope, id)

  let sessionDetails = null
  try {
    const res = await query(`
      SELECT d.STUDY_WEEK_ID, d.STUDY_DAY_DATE,
             s.TEACHING_GROUP_ID, s.MAJOR_ID,
             s.STUDY_SESSION_START_TIME, s.STUDY_SESSION_END_TIME,
             w.STUDY_SEMESTER_ID
      FROM study_session s
      JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
      LEFT JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
      WHERE s.STUDY_SESSION_ID = $1
    `, [id])
    sessionDetails = res.data?.[0]
  } catch (err) {
    console.error('Failed to retrieve session details before deletion:', err)
  }

  await query('DELETE FROM study_session WHERE study_session_id = $1', [id])

  if (sessionDetails && sessionDetails.TEACHING_GROUP_ID && sessionDetails.MAJOR_ID && sessionDetails.STUDY_SEMESTER_ID) {
    try {
      const sessionHours = durationHours(sessionDetails.STUDY_SESSION_START_TIME, sessionDetails.STUDY_SESSION_END_TIME)

      const sectionsResult = await query(`
        SELECT DISTINCT ss.SECTION_ID
        FROM student_dynamic_group_by_major sdg
        JOIN student_section ss ON ss.PERSON_ID = sdg.PERSON_ID
        WHERE sdg.TEACHING_GROUP_ID = $1
      `, [sessionDetails.TEACHING_GROUP_ID])

      for (const section of sectionsResult.data || []) {
        const sectionId = section.SECTION_ID

        const existingVolume = await query(`
          SELECT HOURLY_VOLUME FROM teaching_section_hourly_volume
          WHERE SECTION_ID = $1 AND MAJOR_ID = $2 AND STUDY_SEMESTER_ID = $3
        `, [sectionId, sessionDetails.MAJOR_ID, sessionDetails.STUDY_SEMESTER_ID])

        if (existingVolume.data && existingVolume.data.length > 0) {
          const currentVolume = existingVolume.data[0].HOURLY_VOLUME || 0
          const newVolume = Math.max(0, currentVolume - sessionHours)

          await query(`
            UPDATE teaching_section_hourly_volume
            SET HOURLY_VOLUME = $1
            WHERE SECTION_ID = $2 AND MAJOR_ID = $3 AND STUDY_SEMESTER_ID = $4
          `, [newVolume, sectionId, sessionDetails.MAJOR_ID, sessionDetails.STUDY_SEMESTER_ID])
        }
      }
    } catch (error) {
      console.error('Failed to deduct hourly volume on session deletion:', error)
    }
  }

  return { success: true }
}

export async function getTeacherSessions(instructorId, weekId, teachingGroupId) {
  let sql = `
    SELECT
      s.*,
      ${sessionDaySelects}
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr,
      m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr,
      sst.study_session_type_label_en, sst.study_session_type_label_ar, sst.study_session_type_label_fr,
      ${personNameColumns('p', 'INSTRUCTOR_NAME')}
    FROM study_session s
    ${sessionDayJoins}
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m ON s.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
    LEFT JOIN study_session_type sst ON s.STUDY_SESSION_TYPE_ID = sst.STUDY_SESSION_TYPE_ID
    LEFT JOIN person p ON s.INSTRUCTOR_ID = p.PERSON_ID
    WHERE s.INSTRUCTOR_ID = $1
  `
  const params = [parseInt(instructorId, 10)]

  if (weekId) {
    params.push(parseInt(weekId, 10))
    sql += ` AND d.STUDY_WEEK_ID = $${params.length}`
  }

  if (teachingGroupId) {
    params.push(parseInt(teachingGroupId, 10))
    sql += ` AND s.TEACHING_GROUP_ID = $${params.length}`
  }

  sql += ` ORDER BY d.STUDY_DAY_DATE, s.STUDY_SESSION_START_TIME`
  return await query(sql, params)
}

export async function getStudentSessions(personId, weekId) {
  let sql = `
    SELECT DISTINCT
      s.*,
      ${sessionDaySelects}
      c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr,
      m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
      tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr,
      sst.study_session_type_label_en, sst.study_session_type_label_ar, sst.study_session_type_label_fr,
      ${personNameColumns('p', 'INSTRUCTOR_NAME')}
    FROM study_session s
    ${sessionDayJoins}
    LEFT JOIN classroom c ON s.CLASSROOM_ID = c.CLASSROOM_ID
    LEFT JOIN major m ON s.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN teaching_group tg ON s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
    LEFT JOIN study_session_type sst ON s.STUDY_SESSION_TYPE_ID = sst.STUDY_SESSION_TYPE_ID
    LEFT JOIN person p ON s.INSTRUCTOR_ID = p.PERSON_ID
    WHERE s.TEACHING_GROUP_ID IN (
      SELECT TEACHING_GROUP_ID FROM student_dynamic_group_by_major WHERE PERSON_ID = $1
    )
  `
  const params = [parseInt(personId, 10)]

  if (weekId) {
    params.push(parseInt(weekId, 10))
    sql += ` AND d.STUDY_WEEK_ID = $${params.length}`
  }

  sql += ` ORDER BY d.STUDY_DAY_DATE, s.STUDY_SESSION_START_TIME`
  return await query(sql, params)
}
