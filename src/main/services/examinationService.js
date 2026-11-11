import { query, withTransaction } from '../db'
import { personFullName } from '../sqlPersonName'
import { recordAudit } from './auditService'
import { notifyExamScheduled } from './notificationScanService'
import { isExamMarksLocked } from './settingsService'

// Exams belong to a major. Their type is an examination_type (a dedicated
// lookup, NOT study_session_type). Students of the major's teaching groups are
// shuffled into examination_group rows for the exam; each group sits in one
// classroom, and each seated student gets a seat_number in that room and a
// paper_code for their response paper. Saving seating no longer spawns
// study_session rows: the exam carries its own datetime + rooms, and guards
// proctor via person_is_guard_in_examination.

// ---- Examination types -------------------------------------------------------

export async function getExaminationTypes() {
  // The table keeps per-language labels (label_en/ar/fr); there is no
  // single examination_type_label column to sort by.
  return await query('SELECT * FROM examination_type ORDER BY examination_type_label_en, examination_type_id')
}

export async function createExaminationType(typeData) {
  const { EXAMINATION_TYPE_ID, ...dataToInsert } = typeData
  const columns = Object.keys(dataToInsert).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(dataToInsert).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(dataToInsert)

  const res = await query(`INSERT INTO examination_type (${columns}) VALUES (${pgPlaceholders}) RETURNING examination_type_id`, values)
  const newId = res.data?.[0]?.EXAMINATION_TYPE_ID
  return { ...typeData, EXAMINATION_TYPE_ID: newId }
}

export async function updateExaminationType(id, typeData) {
  const pgSets = Object.keys(typeData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(typeData), id]

  await query(`UPDATE examination_type SET ${pgSets} WHERE examination_type_id = $${values.length}`, values)
  return { ...typeData, EXAMINATION_TYPE_ID: id }
}

export async function deleteExaminationType(id) {
  await query('DELETE FROM examination_type WHERE examination_type_id = $1', [id])
  return { success: true }
}

// ---- Examinations ------------------------------------------------------------

export async function getExaminations(majorId) {
  let sql = `
    SELECT e.EXAMINATION_ID,
           e.EXAMINATION_TYPE_ID, e.MAJOR_ID, e.STUDY_SEMESTER_ID,
           e.EXAMINATION_CODE, e.examination_label_en, e.examination_label_ar, e.examination_label_fr, e.EXAMINATION_FACTOR,
           -- Wall-clock strings: the columns are TIMESTAMP WITHOUT TIME ZONE,
           -- so return exactly what's stored — no Date parsing in the client
           -- (parsing "2026-09-06 07:00" into a Date and formatting it shifts
           -- the time by the machine's timezone).
           to_char(e.EXAMINATION_START_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_START_DATETIME,
           to_char(e.EXAMINATION_END_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_END_DATETIME,
           m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
           et.examination_type_label_en, et.examination_type_label_ar, et.examination_type_label_fr,
           (SELECT COUNT(DISTINCT phe.PERSON_ID) FROM person_has_examination phe
            WHERE phe.EXAMINATION_ID = e.EXAMINATION_ID) AS SEEDED_COUNT,
           (SELECT COUNT(*) FROM examination_group eg
            WHERE eg.EXAMINATION_ID = e.EXAMINATION_ID) AS GROUP_COUNT,
           -- Rooms an exam uses = the rooms of its exam groups (each group sits
           -- in one room; several groups may share one, hence DISTINCT).
           (SELECT STRING_AGG(room, ', ' ORDER BY room)
              FROM (SELECT DISTINCT coalesce(COALESCE(c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr), c.CLASSROOM_CODE, 'Room #' || c.CLASSROOM_ID)
                           || ' (' || c.CLASSROOM_CODE || ')' AS room
                      FROM examination_group eg
                      JOIN classroom c ON c.CLASSROOM_ID = eg.CLASSROOM_ID
                     WHERE eg.EXAMINATION_ID = e.EXAMINATION_ID) rooms) AS ROOMS,
           (SELECT STRING_AGG(room, ', ' ORDER BY room)
              FROM (SELECT DISTINCT coalesce(NULLIF(c.CLASSROOM_LABEL_AR, ''), c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr, c.CLASSROOM_CODE, 'غرفة #' || c.CLASSROOM_ID)
                           || ' (' || c.CLASSROOM_CODE || ')' AS room
                      FROM examination_group eg
                      JOIN classroom c ON c.CLASSROOM_ID = eg.CLASSROOM_ID
                     WHERE eg.EXAMINATION_ID = e.EXAMINATION_ID) rooms) AS ROOMS_AR,
           (SELECT STRING_AGG(room, ', ' ORDER BY room)
              FROM (SELECT DISTINCT coalesce(NULLIF(c.CLASSROOM_LABEL_FR, ''), c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr, c.CLASSROOM_CODE, 'Salle #' || c.CLASSROOM_ID)
                           || ' (' || c.CLASSROOM_CODE || ')' AS room
                      FROM examination_group eg
                      JOIN classroom c ON c.CLASSROOM_ID = eg.CLASSROOM_ID
                     WHERE eg.EXAMINATION_ID = e.EXAMINATION_ID) rooms) AS ROOMS_FR,
           -- Total physical seats across the exam's DISTINCT rooms — the
           -- capacity the exam's groups can seat against.
           (SELECT COUNT(DISTINCT (cs.CLASSROOM_ID, cs.SEAT_NUMBER))
              FROM examination_group eg
              JOIN classroom_seat cs ON cs.CLASSROOM_ID = eg.CLASSROOM_ID
             WHERE eg.EXAMINATION_ID = e.EXAMINATION_ID) AS ROOM_SEAT_COUNT
    FROM examination e
    LEFT JOIN major m ON e.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN examination_type et ON e.EXAMINATION_TYPE_ID = et.EXAMINATION_TYPE_ID
  `
  const params = []
  if (majorId) {
    sql += ` WHERE e.MAJOR_ID = $1`
    params.push(majorId)
  }
  sql += ` ORDER BY e.examination_start_datetime, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), e.examination_label_en, e.examination_label_ar, e.examination_label_fr`
  return await query(sql, params)
}

export async function getExaminationById(id) {
  const result = await query(
    `SELECT e.EXAMINATION_ID,
            e.EXAMINATION_TYPE_ID, e.MAJOR_ID, e.STUDY_SEMESTER_ID,
            e.EXAMINATION_CODE, e.examination_label_en, e.examination_label_ar, e.examination_label_fr, e.EXAMINATION_FACTOR,
            to_char(e.EXAMINATION_START_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_START_DATETIME,
            to_char(e.EXAMINATION_END_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_END_DATETIME,
            m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
            et.examination_type_label_en, et.examination_type_label_ar, et.examination_type_label_fr
     FROM examination e
     LEFT JOIN major m ON e.MAJOR_ID = m.MAJOR_ID
     LEFT JOIN examination_type et ON e.EXAMINATION_TYPE_ID = et.EXAMINATION_TYPE_ID
     WHERE e.EXAMINATION_ID = $1`,
    [id]
  )
  return result
}

export async function getExaminationGuards(examinationId) {
  return await query(`
    SELECT p.PERSON_ID, p.PERSON_FIRST_NAME, p.PERSON_LAST_NAME, p.IS_TEACHER
    FROM person_is_guard_in_examination g
    JOIN v_person p ON g.PERSON_ID = p.PERSON_ID
    WHERE g.EXAMINATION_ID = $1
    ORDER BY p.PERSON_LAST_NAME, p.PERSON_FIRST_NAME
  `, [examinationId])
}

// Staff persons who may guard an exam in the given time window: excludes
// anyone already guarding or sitting an exam overlapping [start, end). With
// no window (unscheduled exam) every non-student person is offered.
export async function getFreeGuards(startDatetime, endDatetime) {
  if (!startDatetime || !endDatetime) {
    return await query(
      `SELECT p.PERSON_ID, p.PERSON_FIRST_NAME, p.PERSON_LAST_NAME
       FROM v_person p
       WHERE NOT COALESCE(p.IS_STUDENT, FALSE)
       ORDER BY p.PERSON_LAST_NAME, p.PERSON_FIRST_NAME`
    )
  }

  const overlap = `
      e2.EXAMINATION_START_DATETIME IS NOT NULL
      AND e2.EXAMINATION_END_DATETIME IS NOT NULL
      AND $1::timestamp < e2.EXAMINATION_END_DATETIME
      AND e2.EXAMINATION_START_DATETIME < $2::timestamp`

  return await query(
    `SELECT p.PERSON_ID, p.PERSON_FIRST_NAME, p.PERSON_LAST_NAME
     FROM v_person p
     WHERE NOT COALESCE(p.IS_STUDENT, FALSE)
       AND NOT EXISTS (
         SELECT 1 FROM person_is_guard_in_examination g
         JOIN examination e2 ON e2.EXAMINATION_ID = g.EXAMINATION_ID
         WHERE g.PERSON_ID = p.PERSON_ID AND ${overlap}
       )
       AND NOT EXISTS (
         SELECT 1 FROM person_has_examination phe
         JOIN examination e2 ON e2.EXAMINATION_ID = phe.EXAMINATION_ID
         WHERE phe.PERSON_ID = p.PERSON_ID AND ${overlap}
       )
     ORDER BY p.PERSON_LAST_NAME, p.PERSON_FIRST_NAME`,
    [startDatetime, endDatetime]
  )
}

export async function setExaminationGuards(examinationId, personIds) {
  await query('DELETE FROM person_is_guard_in_examination WHERE examination_id = $1', [examinationId])

  for (const personId of personIds || []) {
    const sitting = await query(
      'SELECT 1 AS x FROM person_has_examination WHERE PERSON_ID = $1 AND EXAMINATION_ID = $2',
      [personId, examinationId]
    )
    if (sitting?.data?.length > 0) {
      console.warn(`Person ${personId} cannot guard exam ${examinationId}: they are sitting it.`)
      continue
    }

    try {
      await query(
        'INSERT INTO person_is_guard_in_examination (person_id, examination_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [personId, examinationId]
      )
    } catch (error) {
      // Surface trigger violations (double-guarding, sits-vs-guards overlap)
      // as friendly errors naming the person and the conflicting exam.
      if (/scheduling conflict|conflict of interest/i.test(error.message)) {
        const who = await query(
          `SELECT ${personFullName('person')} AS name FROM person WHERE person_id = $1`,
          [personId]
        )
        const name = who?.data?.[0]?.NAME || `person ${personId}`
        throw new Error(`${name}: ${error.message}`)
      }
      throw error
    }
  }

  return { success: true }
}

// Roster for the seating editor: every student of the major's teaching groups
// (optionally scoped to a semester), joined with their saved exam group, seat
// and paper code. Exam groups can differ from teaching groups (shuffled).
export async function getExaminationSeating(examinationId) {
  const examRes = await query(
    `SELECT EXAMINATION_ID, MAJOR_ID, STUDY_SEMESTER_ID,
            COALESCE(examination_label_en, examination_label_ar, examination_label_fr) AS examination_label, EXAMINATION_CODE
     FROM examination WHERE EXAMINATION_ID = $1`,
    [examinationId]
  )
  const exam = examRes?.data?.[0]
  if (!exam) return { data: [], exam: null, groups: [] }

  const majorId = exam.MAJOR_ID
  const semesterId = exam.STUDY_SEMESTER_ID

  const groupsRes = await query(
    `SELECT eg.EXAMINATION_GROUP_ID, eg.EXAMINATION_ID, eg.CLASSROOM_ID,
            eg.examination_group_label_en, eg.examination_group_label_ar, eg.examination_group_label_fr, c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr, c.CLASSROOM_CODE,
            c.CLASSROOM_CAPACITY,
            (SELECT COUNT(*) FROM person_has_examination phe
             WHERE phe.EXAMINATION_GROUP_ID = eg.EXAMINATION_GROUP_ID) AS MEMBER_COUNT,
            (SELECT COUNT(*) FROM classroom_seat cs
             WHERE cs.CLASSROOM_ID = eg.CLASSROOM_ID) AS SEAT_COUNT
     FROM examination_group eg
     LEFT JOIN classroom c ON eg.CLASSROOM_ID = c.CLASSROOM_ID
     WHERE eg.EXAMINATION_ID = $1
     ORDER BY eg.EXAMINATION_GROUP_ID`,
    [examinationId]
  )

  // examParam: placeholder index for the examination id (1 = major-only
  // fallback with 2 params, 3 = major+semester scope with 3 params).
  // A student can belong to several teaching groups of the major, so DISTINCT
  // ON (PERSON_ID) keeps one row per student — preferring a row that already
  // has a saved exam-group assignment — and the outer query re-sorts by name.
  const rosterSql = (scopeClause, examParam) => `
    SELECT * FROM (
      SELECT DISTINCT ON (p.PERSON_ID)
             p.PERSON_ID, p.PERSON_FIRST_NAME, p.PERSON_LAST_NAME,
             sdg.TEACHING_GROUP_ID, tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr,
             s.SECTION_ID, s.section_label_en, s.section_label_ar, s.section_label_fr,
             phe.EXAMINATION_GROUP_ID, phe.SEAT_NUMBER, phe.PAPER_CODE, phe.FINAL_MARK
      FROM student_dynamic_group_by_major sdg
      JOIN v_person p ON sdg.PERSON_ID = p.PERSON_ID
      JOIN teaching_group tg ON sdg.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
      LEFT JOIN student_section ss ON ss.PERSON_ID = p.PERSON_ID
      LEFT JOIN section s ON ss.SECTION_ID = s.SECTION_ID
      LEFT JOIN person_has_examination phe
             ON phe.PERSON_ID = sdg.PERSON_ID AND phe.EXAMINATION_ID = $${examParam}::int
      WHERE ${scopeClause} AND p.IS_STUDENT = TRUE
      ORDER BY p.PERSON_ID, phe.EXAMINATION_GROUP_ID NULLS LAST, tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
    ) roster
    ORDER BY roster.PERSON_LAST_NAME, roster.PERSON_FIRST_NAME`

  let result = null
  if (majorId && semesterId) {
    result = await query(rosterSql('sdg.MAJOR_ID = $1::int AND sdg.STUDY_SEMESTER_ID = $2::int', 3), [majorId, semesterId, examinationId])
  }

  if ((!result || result.data?.length === 0) && majorId) {
    console.warn(`getExaminationSeating: no members for exam ${examinationId} under (major=${majorId}, semester=${semesterId}); falling back to major-only.`)
    result = await query(rosterSql('sdg.MAJOR_ID = $1::int', 2), [majorId, examinationId])
  }

  return { data: result?.data || [], exam, groups: groupsRes.data || [] }
}

// Free seats per classroom: every physical seat of the room minus the seats
// taken by OTHER exam groups' members in the same room. Used by the seating
// editor to offer only assignable seats.
export async function getFreeSeats(examinationId) {
  const res = await query(
    `SELECT cs.CLASSROOM_ID, cs.SEAT_NUMBER,
            phe.EXAMINATION_GROUP_ID AS TAKEN_BY_GROUP_ID,
            phe.PERSON_ID AS TAKEN_BY_PERSON_ID
     FROM classroom_seat cs
     LEFT JOIN examination_group eg ON eg.CLASSROOM_ID = cs.CLASSROOM_ID
     LEFT JOIN person_has_examination phe
            ON phe.EXAMINATION_GROUP_ID = eg.EXAMINATION_GROUP_ID AND phe.SEAT_NUMBER = cs.SEAT_NUMBER
     WHERE cs.CLASSROOM_ID IN (SELECT DISTINCT CLASSROOM_ID FROM examination_group WHERE EXAMINATION_ID = $1)
     ORDER BY cs.CLASSROOM_ID, cs.SEAT_NUMBER`,
    [examinationId]
  )
  return res
}

// The exam datetime columns are TIMESTAMP WITHOUT TIME ZONE (wall-clock).
// Payloads may arrive as a wall-clock string ("2026-09-06 08:00:00", the
// current renderer) or as an ISO instant with offset ("...T06:00:00.000Z",
// older payloads). For instants, reinterpret the same wall-clock digits the
// user typed: strip the offset instead of converting it — converting would
// shift the stored time by the machine's timezone and compound on every edit.
function normalizeExamDatetimes(data) {
  for (const key of ['EXAMINATION_START_DATETIME', 'EXAMINATION_END_DATETIME']) {
    const v = data[key]
    if (typeof v !== 'string' || !v) continue
    if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(v)) {
      // ISO instant: keep the wall-clock digits, drop the offset/Z.
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(v)
      if (m) data[key] = `${m[1]} ${m[2]}:00`
    } else {
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(v)
      if (m) data[key] = `${m[1]} ${m[2]}:00`
    }
  }
}

export async function createExamination(data, guardPersonIds = []) {
  normalizeExamDatetimes(data)
  const columns = Object.keys(data).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(data).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(data)

  const res = await query(`INSERT INTO examination (${columns}) VALUES (${pgPlaceholders}) RETURNING examination_id`, values)
  const newExamId = res.data?.[0]?.EXAMINATION_ID
  const newExamination = { ...data, EXAMINATION_ID: newExamId }

  if (guardPersonIds.length > 0 && newExamId) {
    await setExaminationGuards(newExamId, guardPersonIds)
  }

  // The teachers of the major now have an exam to prepare for and to mark.
  // Best-effort: a missing notification must not undo the exam itself.
  const majorId = data.MAJOR_ID ?? data.major_id
  if (newExamId && majorId) {
    try {
      await notifyExamScheduled({ examinationId: newExamId })
    } catch (error) {
      console.warn('Could not tell the major teachers about the new exam:', error.message)
    }
  }

  return { ...newExamination, groups: [] }
}

export async function updateExamination(id, data) {
  normalizeExamDatetimes(data)
  const pgSets = Object.keys(data).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(data), id]

  await query(`UPDATE examination SET ${pgSets} WHERE examination_id = $${values.length}`, values)

  // If the exam's time window moved, re-validate its seated students and
  // guards against every OTHER exam — the DB triggers only fire when
  // assignment rows change, not when the exam itself is rescheduled.
  if ('EXAMINATION_START_DATETIME' in data || 'EXAMINATION_END_DATETIME' in data) {
    await validateExamSchedule(id)
  }

  return { ...data, EXAMINATION_ID: id }
}

// Ensure no seated student or guard of `examinationId` overlaps in time with
// any of their other exams. Throws with a friendly message on the first
// conflict found.
async function validateExamSchedule(examinationId) {
  const res = await query(
    `SELECT 'STUDENT' AS role, p.PERSON_ID, ${personFullName('p')} AS person_name,
            COALESCE(e2.examination_label_en, e2.examination_label_ar, e2.examination_label_fr) AS other_exam, e2.examination_label_en AS other_exam_en, e2.examination_label_ar AS other_exam_ar, e2.examination_label_fr AS other_exam_fr, e2.EXAMINATION_START_DATETIME, e2.EXAMINATION_END_DATETIME
     FROM person_has_examination phe
     JOIN examination e1 ON e1.EXAMINATION_ID = phe.EXAMINATION_ID
     JOIN person p ON p.PERSON_ID = phe.PERSON_ID
     JOIN person_has_examination other ON other.PERSON_ID = phe.PERSON_ID AND other.EXAMINATION_ID <> phe.EXAMINATION_ID
     JOIN examination e2 ON e2.EXAMINATION_ID = other.EXAMINATION_ID
     WHERE phe.EXAMINATION_ID = $1
       AND e1.EXAMINATION_START_DATETIME IS NOT NULL AND e1.EXAMINATION_END_DATETIME IS NOT NULL
       AND e2.EXAMINATION_START_DATETIME IS NOT NULL AND e2.EXAMINATION_END_DATETIME IS NOT NULL
       AND e1.EXAMINATION_START_DATETIME < e2.EXAMINATION_END_DATETIME
       AND e2.EXAMINATION_START_DATETIME < e1.EXAMINATION_END_DATETIME
     UNION ALL
     SELECT 'GUARD' AS role, p.PERSON_ID, ${personFullName('p')} AS person_name,
            COALESCE(e2.examination_label_en, e2.examination_label_ar, e2.examination_label_fr) AS other_exam, e2.examination_label_en AS other_exam_en, e2.examination_label_ar AS other_exam_ar, e2.examination_label_fr AS other_exam_fr, e2.EXAMINATION_START_DATETIME, e2.EXAMINATION_END_DATETIME
     FROM person_is_guard_in_examination g
     JOIN examination e1 ON e1.EXAMINATION_ID = g.EXAMINATION_ID
     JOIN person p ON p.PERSON_ID = g.PERSON_ID
     JOIN person_is_guard_in_examination og ON og.PERSON_ID = g.PERSON_ID AND og.EXAMINATION_ID <> g.EXAMINATION_ID
     JOIN examination e2 ON e2.EXAMINATION_ID = og.EXAMINATION_ID
     WHERE g.EXAMINATION_ID = $1
       AND e1.EXAMINATION_START_DATETIME IS NOT NULL AND e1.EXAMINATION_END_DATETIME IS NOT NULL
       AND e2.EXAMINATION_START_DATETIME IS NOT NULL AND e2.EXAMINATION_END_DATETIME IS NOT NULL
       AND e1.EXAMINATION_START_DATETIME < e2.EXAMINATION_END_DATETIME
       AND e2.EXAMINATION_START_DATETIME < e1.EXAMINATION_END_DATETIME
     LIMIT 1`,
    [examinationId]
  )

  const conflict = res?.data?.[0]
  if (conflict) {
    const who = conflict.ROLE === 'GUARD' ? 'guards' : 'sits'
    throw new Error(
      `Scheduling conflict: ${conflict.PERSON_NAME} already ${who} "${conflict.OTHER_EXAM}" at the same time. Reschedule one of the exams.`
    )
  }
}

// Save the exam groups + per-student assignments in one transaction:
//   groups: [{ EXAMINATION_GROUP_ID?, EXAMINATION_GROUP_LABEL, CLASSROOM_ID }]
//   seating: [{ PERSON_ID, EXAMINATION_GROUP_ID, SEAT_NUMBER, PAPER_CODE }]
// Group rows for this exam that no longer appear are deleted (their members
// become unassigned). Every seat number must be a REAL seat of the room its
// group sits in (classroom_seat), and a seat may only host one student per
// room — enforced by the uq_person_has_exam_group index plus the seat check.
export async function saveExaminationSeating(examinationId, { groups = [], seating = [] } = {}) {
  const examRes = await query(
    'SELECT EXAMINATION_ID FROM examination WHERE EXAMINATION_ID = $1',
    [examinationId]
  )
  if (!examRes?.data?.length) throw new Error('The examination could not be found. It may have been removed.')

  return await withTransaction(async (tx) => {
    const incomingGroupIds = groups.map(g => g.EXAMINATION_GROUP_ID).filter(Boolean)

    // 1. Delete groups that were removed in the editor.
    if (incomingGroupIds.length > 0) {
      const placeholders = incomingGroupIds.map((_, i) => `$${i + 2}`).join(', ')
      await tx(
        `DELETE FROM examination_group WHERE examination_id = $1 AND examination_group_id NOT IN (${placeholders})`,
        [examinationId, ...incomingGroupIds]
      )
    } else {
      await tx('DELETE FROM examination_group WHERE examination_id = $1', [examinationId])
    }

    // 2. Upsert the group rows (label + room). New groups get their id back.
    const savedGroups = []
    for (const g of groups) {
      if (g.EXAMINATION_GROUP_ID) {
        await tx(
          `UPDATE examination_group
           SET examination_group_label_en = $2, classroom_id = $3
           WHERE examination_group_id = $1`,
          [g.EXAMINATION_GROUP_ID, g.EXAMINATION_GROUP_LABEL_EN || COALESCE(g.examination_group_label_en, g.examination_group_label_ar, g.examination_group_label_fr) || null, g.CLASSROOM_ID || null]
        )
        savedGroups.push({ ...g, EXAMINATION_GROUP_ID: g.EXAMINATION_GROUP_ID })
      } else {
        const res = await tx(
          `INSERT INTO examination_group (examination_id, classroom_id, examination_group_label_en)
           VALUES ($1, $2, $3) RETURNING examination_group_id`,
          [examinationId, g.CLASSROOM_ID || null, g.EXAMINATION_GROUP_LABEL_EN || COALESCE(g.examination_group_label_en, g.examination_group_label_ar, g.examination_group_label_fr) || null]
        )
        const newId = res.data?.[0]?.EXAMINATION_GROUP_ID
        savedGroups.push({ ...g, EXAMINATION_GROUP_ID: newId })
      }
    }

    // 3. Every assigned seat must exist in the room its group sits in.
    // Resolve each seating row's group: prefer an explicit GROUP_INDEX (the
    // client's group-array position, which works for groups created in this
    // same save), falling back to a known EXAMINATION_GROUP_ID.
    const groupIds = savedGroups.map(g => g.EXAMINATION_GROUP_ID)
    const resolveGroupId = (s) => {
      if (Number.isInteger(s?.GROUP_INDEX) && groupIds[s.GROUP_INDEX] != null) {
        return groupIds[s.GROUP_INDEX]
      }
      return s?.EXAMINATION_GROUP_ID || null
    }

    const seatList = seating.filter(s => resolveGroupId(s) && s?.SEAT_NUMBER != null)
    const roomIds = [...new Set(savedGroups.map(g => g.CLASSROOM_ID).filter(Boolean))]
    const validSeats = new Set()
    if (roomIds.length > 0) {
      const seatRes = await tx(
        `SELECT classroom_id, seat_number FROM classroom_seat WHERE classroom_id = ANY($1::int[])`,
        [roomIds]
      )
      for (const row of seatRes.data || []) {
        validSeats.add(`${row.CLASSROOM_ID}:${row.SEAT_NUMBER}`)
      }
    }
    const roomIdOfGroupIndex = savedGroups.map(g => g.CLASSROOM_ID)
    const roomIdOf = Object.fromEntries(savedGroups.map(g => [g.EXAMINATION_GROUP_ID, g.CLASSROOM_ID]))
    // Seats are unique per ROOM, not just per group: two groups can share a
    // room, and one physical seat can only host one student of this exam.
    const seatOwnerByRoom = new Map()
    for (const s of seatList) {
      const groupId = resolveGroupId(s)
      const roomId = Number.isInteger(s?.GROUP_INDEX)
        ? roomIdOfGroupIndex[s.GROUP_INDEX]
        : roomIdOf[groupId]
      if (roomId && !validSeats.has(`${roomId}:${s.SEAT_NUMBER}`)) {
        throw new Error(`Seat ${s.SEAT_NUMBER} does not exist in that classroom. Manage the room's seats in Classrooms first.`)
      }
      if (roomId) {
        const key = `${roomId}:${s.SEAT_NUMBER}`
        if (seatOwnerByRoom.has(key)) {
          throw new Error(`Seat ${s.SEAT_NUMBER} is assigned to more than one student in the same classroom. Each seat can host only one student.`)
        }
        seatOwnerByRoom.set(key, s.PERSON_ID)
      }
    }

    // 3b. Paper codes are globally unique (they identify one response paper).
    //     Nulls (no code yet) are allowed.
    const codeOwner = new Map()
    for (const s of seatList) {
      const code = s.PAPER_CODE ? String(s.PAPER_CODE).trim() : null
      if (!code) continue
      if (codeOwner.has(code)) {
        throw new Error(`Paper code "${code}" is used by more than one student. Each response paper must have its own code.`)
      }
      codeOwner.set(code, s.PERSON_ID)
    }
    const codeList = [...codeOwner.keys()]
    if (codeList.length > 0) {
      const dupRes = await tx(
        `SELECT paper_code, person_id FROM person_has_examination
         WHERE paper_code = ANY($1) AND examination_id <> $2`,
        [codeList, examinationId]
      )
      const clash = dupRes?.data?.[0]
      if (clash) {
        throw new Error(`Paper code "${clash.PAPER_CODE}" is already used by another student in a different examination.`)
      }
    }

    // 4. Rewrite the per-student assignments. Students no longer listed lose
    //    their seat (the exam-group FK cascades to SET NULL via group delete).
    await tx('DELETE FROM person_has_examination WHERE examination_id = $1', [examinationId])

    for (const s of seating) {
      const groupId = resolveGroupId(s)
      if (!s?.PERSON_ID || !groupId) continue
      await tx(
        `INSERT INTO person_has_examination (person_id, examination_id, examination_group_id, seat_number, paper_code)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (person_id, examination_id) DO UPDATE SET
           examination_group_id = EXCLUDED.examination_group_id,
           seat_number = EXCLUDED.seat_number,
           paper_code = EXCLUDED.paper_code`,
        [
          s.PERSON_ID,
          examinationId,
          groupId,
          s.SEAT_NUMBER || null,
          s.PAPER_CODE || null
        ]
      )
    }

    return { examinationId, groups: savedGroups, seated: seating.filter(s => resolveGroupId(s)).length }
  })
}

export async function deleteExamination(id) {
  // examination_group rows cascade; person_has_examination rows cascade too.
  await query('DELETE FROM examination WHERE examination_id = $1', [id])
  return { success: true }
}

// ---- Exam marks (teacher-facing) --------------------------------------------

// Exams of the majors a teacher teaches (major_teacher), scoped to a semester
// when given. Each exam row carries the mark-entering progress so the teacher
// sees at a glance which exams still need marks. Teachers may only enter
// marks for exams of their own majors — enforced by construction (the list is
// built from major_teacher) and re-checked when saving.
//
// Admins get the full list: with personId = null the major_teacher join is
// dropped and every exam of the semester is returned (the admin may enter or
// correct any mark, same as a teacher of that major).
export async function getTeacherExaminations(personId, semesterId) {
  const params = []
  const conditions = []
  if (personId != null) {
    params.push(personId)
    conditions.push(`mt.PERSON_ID = $${params.length}`)
  }
  if (semesterId) {
    params.push(semesterId)
    conditions.push(`e.STUDY_SEMESTER_ID = $${params.length}`)
  }

  return await query(
    `SELECT e.EXAMINATION_ID,
            e.EXAMINATION_CODE, e.examination_label_en, e.examination_label_ar, e.examination_label_fr, e.EXAMINATION_FACTOR,
            e.MAJOR_ID, m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
            e.STUDY_SEMESTER_ID,
            et.examination_type_label_en, et.examination_type_label_ar, et.examination_type_label_fr,
            to_char(e.EXAMINATION_START_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_START_DATETIME,
            to_char(e.EXAMINATION_END_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_END_DATETIME,
            (SELECT COUNT(*) FROM person_has_examination phe
              WHERE phe.EXAMINATION_ID = e.EXAMINATION_ID
                AND phe.FINAL_MARK IS NOT NULL) AS MARKED_COUNT,
            (SELECT COUNT(*) FROM person_has_examination phe
              WHERE phe.EXAMINATION_ID = e.EXAMINATION_ID) AS SEATED_COUNT
     FROM examination e
     LEFT JOIN major m ON m.MAJOR_ID = e.MAJOR_ID
     LEFT JOIN examination_type et ON et.EXAMINATION_TYPE_ID = e.EXAMINATION_TYPE_ID
     ${personId != null ? 'JOIN major_teacher mt ON mt.MAJOR_ID = e.MAJOR_ID' : ''}
     ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
     ORDER BY e.EXAMINATION_START_DATETIME NULLS LAST, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), e.examination_label_en, e.examination_label_ar, e.examination_label_fr`,
    params
  )
}

// Marks roster for one exam: every seated student with their group, room,
// seat, paper code and current mark. Mirrors the seating roster scoping so
// the teacher sees exactly the students who were seated for the exam.
export async function getExaminationMarks(examinationId) {
  const examRes = await query(
    `SELECT e.EXAMINATION_ID, e.EXAMINATION_CODE, e.examination_label_en, e.examination_label_ar, e.examination_label_fr,
            e.EXAMINATION_FACTOR, e.MAJOR_ID, m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
            e.STUDY_SEMESTER_ID,
            et.examination_type_label_en, et.examination_type_label_ar, et.examination_type_label_fr,
            to_char(e.EXAMINATION_START_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_START_DATETIME,
            to_char(e.EXAMINATION_END_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_END_DATETIME
     FROM examination e
     LEFT JOIN major m ON m.MAJOR_ID = e.MAJOR_ID
     LEFT JOIN examination_type et ON et.EXAMINATION_TYPE_ID = e.EXAMINATION_TYPE_ID
     WHERE e.EXAMINATION_ID = $1`,
    [examinationId]
  )
  const exam = examRes?.data?.[0]
  if (!exam) return { data: [], exam: null }

  const rowsRes = await query(
    `SELECT phe.PERSON_ID,
            COALESCE(p.PERSON_FIRST_NAME_LA, p.PERSON_FIRST_NAME_AR) AS PERSON_FIRST_NAME,
            p.PERSON_FIRST_NAME_LA AS PERSON_FIRST_NAME_LA,
            p.PERSON_FIRST_NAME_AR AS PERSON_FIRST_NAME_AR,
            COALESCE(p.PERSON_LAST_NAME_LA, p.PERSON_LAST_NAME_AR) AS PERSON_LAST_NAME,
            p.PERSON_LAST_NAME_LA AS PERSON_LAST_NAME_LA,
            p.PERSON_LAST_NAME_AR AS PERSON_LAST_NAME_AR,
            eg.EXAMINATION_GROUP_ID, eg.examination_group_label_en, eg.examination_group_label_ar, eg.examination_group_label_fr,
            c.CLASSROOM_ID, c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr, c.CLASSROOM_CODE,
            phe.SEAT_NUMBER, phe.PAPER_CODE, phe.FINAL_MARK
     FROM person_has_examination phe
     JOIN person p ON p.PERSON_ID = phe.PERSON_ID
     LEFT JOIN examination_group eg ON eg.EXAMINATION_GROUP_ID = phe.EXAMINATION_GROUP_ID
     LEFT JOIN classroom c ON c.CLASSROOM_ID = eg.CLASSROOM_ID
     WHERE phe.EXAMINATION_ID = $1
     ORDER BY eg.examination_group_label_en NULLS LAST, phe.SEAT_NUMBER NULLS LAST,
              p.PERSON_LAST_NAME_LA, p.PERSON_FIRST_NAME_LA`,
    [examinationId]
  )

  return { data: rowsRes?.data || [], exam }
}

// Validate a mark string: empty (clear) or a number in [0, 20]. Returns a
// number, or null when clearing. Throws with a friendly message otherwise.
function parseMark(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const n = Number(String(value).trim().replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 20) {
    throw new Error(`Invalid mark "${value}": enter a number between 0 and 20, or leave the field empty to clear the mark.`)
  }
  return Math.round(n * 100) / 100
}

// A single student's marks for a semester, in three levels:
//   - exam marks: every exam of the semester they were seated in, with the
//     entered mark, the exam's factor, its major and type;
//   - major marks: the exam-factor-weighted average per major;
//   - the semester mark: the major-factor-weighted average of major marks;
//   - the overall semester average: the plain average of every exam mark the
//     student has in the semester (no weighting) — a simple sanity-check
//     figure shown next to the weighted semester mark.
// The personId comes from the logged-in session on the student pages, so no
// extra authorization layer is needed (a student can only ever ask for
// themselves; admin screens would pass another id explicitly).
export async function getStudentMarks(personId, semesterId) {
  if (!personId || !semesterId) {
    throw new Error('A student and a semester must be selected to compute the marks.')
  }

  const examsRes = await query(
    `SELECT e.EXAMINATION_ID,
            e.EXAMINATION_CODE, e.examination_label_en, e.examination_label_ar, e.examination_label_fr,
            COALESCE(NULLIF(e.EXAMINATION_FACTOR, 0), 1) AS EXAMINATION_FACTOR,
            e.MAJOR_ID, m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
            et.examination_type_label_en, et.examination_type_label_ar, et.examination_type_label_fr,
            to_char(e.EXAMINATION_START_DATETIME, 'YYYY-MM-DD"T"HH24:MI') AS EXAMINATION_START_DATETIME,
            phe.FINAL_MARK
     FROM person_has_examination phe
     JOIN examination e ON e.EXAMINATION_ID = phe.EXAMINATION_ID
     LEFT JOIN major m ON m.MAJOR_ID = e.MAJOR_ID
     LEFT JOIN examination_type et ON et.EXAMINATION_TYPE_ID = e.EXAMINATION_TYPE_ID
     WHERE phe.PERSON_ID = $1 AND e.STUDY_SEMESTER_ID = $2
     ORDER BY e.EXAMINATION_START_DATETIME NULLS LAST, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr)`,
    [personId, semesterId]
  )

  const summaryRes = await query(
    `WITH exam_weights AS (
       SELECT e.EXAMINATION_ID, e.MAJOR_ID,
              COALESCE(NULLIF(e.EXAMINATION_FACTOR, 0), 1) AS W
       FROM examination e
       WHERE e.STUDY_SEMESTER_ID = $2
     ),
     major_marks AS (
       SELECT phe.PERSON_ID, ew.MAJOR_ID,
              SUM(ew.W * phe.FINAL_MARK) / NULLIF(SUM(ew.W), 0) AS MAJOR_MARK,
              COUNT(phe.FINAL_MARK) AS MARKED_EXAMS,
              COUNT(DISTINCT ew.EXAMINATION_ID) AS TOTAL_EXAMS
       FROM person_has_examination phe
       JOIN exam_weights ew ON ew.EXAMINATION_ID = phe.EXAMINATION_ID
       WHERE phe.PERSON_ID = $1 AND phe.FINAL_MARK IS NOT NULL
       GROUP BY phe.PERSON_ID, ew.MAJOR_ID
     )
     SELECT mm.MAJOR_ID, m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
            COALESCE(f.MAJOR_SEMESTER_FACTOR, 1) AS MAJOR_FACTOR,
            mm.MAJOR_MARK, mm.MARKED_EXAMS, mm.TOTAL_EXAMS
     FROM major_marks mm
     JOIN major m ON m.MAJOR_ID = mm.MAJOR_ID
     LEFT JOIN major_semester_factor f
            ON f.MAJOR_ID = mm.MAJOR_ID AND f.STUDY_SEMESTER_ID = $2
     ORDER BY COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr)`,
    [personId, semesterId]
  )

  const majorMarks = summaryRes?.data || []
  let totalWeight = 0
  let weightedSum = 0
  for (const row of majorMarks) {
    const w = Number(row.MAJOR_FACTOR) || 1
    const mark = row.MAJOR_MARK != null ? Number(row.MAJOR_MARK) : null
    if (mark != null) {
      totalWeight += w
      weightedSum += w * mark
    }
  }
  const semesterMark = totalWeight > 0 ? weightedSum / totalWeight : null

  // Overall semester average: the unweighted average of the student's exam
  // marks of the semester — every exam counts equally, whatever its factor.
  const markedExams = (examsRes?.data || []).filter(r => r.FINAL_MARK != null)
  const overallAverage = markedExams.length > 0
    ? markedExams.reduce((acc, r) => acc + Number(r.FINAL_MARK), 0) / markedExams.length
    : null

  return {
    data: examsRes?.data || [],
    majorMarks,
    semesterMark,
    overallAverage,
    gradedMajors: majorMarks.filter(r => r.MAJOR_MARK != null).length
  }
}

// Semester mark computation, in two weighted levels (plus an unweighted
// per-student overall semester average for the admin views):
//   1. Student's mark IN a major = factor-weighted average of their exam
//      marks of that major's exams for the semester (weight =
//      examination.examination_factor, defaulting to 1).
//   2. Student's SEMESTER mark = factor-weighted average of their major
//      marks (weight = major_semester_factor, defaulting to 1).
// A student's majors = the majors of the teaching groups they belong to in
// student_dynamic_group_by_major, scoped to the semester's groups when the
// group carries a semester; a major with exams but no mark yet does not count
// toward the average (no mark = not graded yet, not zero).
//
// Alongside the weighted SEMESTER_MARK, each row carries OVERALL_AVERAGE: the
// student's plain (unweighted) average of every exam mark they have in the
// semester. Admins use it on the Exam Marks page as a simple per-student
// figure that ignores factors entirely.
export async function getSemesterMarks(semesterId) {
  if (!semesterId) {
    throw new Error('A semester must be selected to compute the semester marks.')
  }

  // One set-based query: per (student, major) the weighted exam-mark average,
  // then per student the weighted major average, joined back for display.
  const res = await query(
    `WITH exam_weights AS (
       SELECT e.EXAMINATION_ID,
              e.MAJOR_ID,
              COALESCE(NULLIF(e.EXAMINATION_FACTOR, 0), 1) AS W
       FROM examination e
       WHERE e.STUDY_SEMESTER_ID = $1
     ),
     major_marks AS (
       SELECT phe.PERSON_ID,
              ew.MAJOR_ID,
              SUM(ew.W * phe.FINAL_MARK) / NULLIF(SUM(ew.W), 0) AS MAJOR_MARK,
              COUNT(phe.FINAL_MARK) AS MARKED_EXAMS,
              COUNT(DISTINCT ew.EXAMINATION_ID) AS TOTAL_EXAMS
       FROM person_has_examination phe
       JOIN exam_weights ew ON ew.EXAMINATION_ID = phe.EXAMINATION_ID
       WHERE phe.FINAL_MARK IS NOT NULL
       GROUP BY phe.PERSON_ID, ew.MAJOR_ID
     ),
     semester_marks AS (
       SELECT mm.PERSON_ID,
              SUM(COALESCE(f.MAJOR_SEMESTER_FACTOR, 1) * mm.MAJOR_MARK)
                / NULLIF(SUM(COALESCE(f.MAJOR_SEMESTER_FACTOR, 1)), 0) AS SEMESTER_MARK,
              COUNT(*) AS GRADED_MAJORS
       FROM major_marks mm
       LEFT JOIN major_semester_factor f
              ON f.MAJOR_ID = mm.MAJOR_ID AND f.STUDY_SEMESTER_ID = $1
       GROUP BY mm.PERSON_ID
     ),
     overall_averages AS (
       -- Unweighted average of every exam mark the student has this semester.
       SELECT phe.PERSON_ID,
              AVG(phe.FINAL_MARK) AS OVERALL_AVERAGE,
              COUNT(*) AS MARKED_EXAMS
       FROM person_has_examination phe
       JOIN examination e ON e.EXAMINATION_ID = phe.EXAMINATION_ID
       WHERE e.STUDY_SEMESTER_ID = $1 AND phe.FINAL_MARK IS NOT NULL
       GROUP BY phe.PERSON_ID
     )
     SELECT sm.PERSON_ID,
            p.PERSON_FIRST_NAME_LA AS PERSON_FIRST_NAME,
            p.PERSON_FIRST_NAME_LA, p.PERSON_FIRST_NAME_AR,
            p.PERSON_LAST_NAME_LA AS PERSON_LAST_NAME,
            p.PERSON_LAST_NAME_LA, p.PERSON_LAST_NAME_AR,
            sm.SEMESTER_MARK,
            sm.GRADED_MAJORS,
            oa.OVERALL_AVERAGE,
            oa.MARKED_EXAMS AS OVERALL_MARKED_EXAMS,
            -- Exam-level detail for the per-student bulletin (admin views):
            -- every exam of the semester the student sat, with mark, factor,
            -- major and type.
            (SELECT JSON_AGG(JSON_BUILD_OBJECT(
                      'EXAMINATION_ID', e.EXAMINATION_ID,
                      'EXAMINATION_CODE', e.EXAMINATION_CODE,
                      'EXAMINATION_LABEL', COALESCE(e.examination_label_en, e.examination_label_ar, e.examination_label_fr),
                      'MAJOR_ID', e.MAJOR_ID,
                      'MAJOR_LABEL', COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr),
                      'EXAMINATION_TYPE_LABEL', COALESCE(et.examination_type_label_en, et.examination_type_label_ar, et.examination_type_label_fr),
                      'EXAMINATION_FACTOR', COALESCE(NULLIF(e.EXAMINATION_FACTOR, 0), 1),
                      'EXAMINATION_START_DATETIME', to_char(e.EXAMINATION_START_DATETIME, 'YYYY-MM-DD"T"HH24:MI'),
                      'FINAL_MARK', phe.FINAL_MARK)
                      ORDER BY e.EXAMINATION_START_DATETIME NULLS LAST, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), COALESCE(e.examination_label_en, e.examination_label_ar, e.examination_label_fr))
               FROM person_has_examination phe
               JOIN examination e ON e.EXAMINATION_ID = phe.EXAMINATION_ID
               LEFT JOIN major m ON m.MAJOR_ID = e.MAJOR_ID
               LEFT JOIN examination_type et ON et.EXAMINATION_TYPE_ID = e.EXAMINATION_TYPE_ID
              WHERE phe.PERSON_ID = sm.PERSON_ID
                AND e.STUDY_SEMESTER_ID = $1) AS EXAM_MARKS,
            (SELECT JSON_AGG(JSON_BUILD_OBJECT(
                      'MAJOR_ID', mm.MAJOR_ID,
                      'MAJOR_LABEL', COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr),
                      'MAJOR_FACTOR', COALESCE(f.MAJOR_SEMESTER_FACTOR, 1),
                      'MAJOR_MARK', mm.MAJOR_MARK,
                      'MARKED_EXAMS', mm.MARKED_EXAMS,
                      'TOTAL_EXAMS', mm.TOTAL_EXAMS)
                      ORDER BY COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr))
               FROM major_marks mm
               JOIN major m ON m.MAJOR_ID = mm.MAJOR_ID
               LEFT JOIN major_semester_factor f
                      ON f.MAJOR_ID = mm.MAJOR_ID AND f.STUDY_SEMESTER_ID = $1
              WHERE mm.PERSON_ID = sm.PERSON_ID) AS MAJOR_MARKS
     FROM semester_marks sm
     JOIN person p ON p.PERSON_ID = sm.PERSON_ID
     LEFT JOIN overall_averages oa ON oa.PERSON_ID = sm.PERSON_ID
     ORDER BY p.PERSON_LAST_NAME_LA, p.PERSON_FIRST_NAME_LA`,
    [semesterId]
  )
  return res
}

// Save marks for one exam in one transaction. Only rows sent are touched —
// the teacher can save progressively (per room, per page) without wiping
// others. Rows for students no longer seated are rejected (cannot mark a
// student who is not sitting the exam).
export async function saveExaminationMarks(examinationId, marks = [], teacherPersonId) {
  // The admin can lock marks editing globally (Settings page). The check is
  // done here, server-side — the UI flag is only a courtesy hint.
  if (await isExamMarksLocked()) {
    await recordAudit({
      actorPersonId: teacherPersonId,
      action: 'exam.marks_save',
      entityType: 'examination',
      entityId: examinationId,
      result: 'failure',
      error: 'Exam marks are locked by the administration.',
      detail: { reason: 'LOCKED', attempted: marks.length }
    })
    throw new Error('Exam marks are locked by the administration. Editing is currently disabled.')
  }

  const parsed = marks.map(m => ({
    PERSON_ID: m?.PERSON_ID,
    FINAL_MARK: parseMark(m?.FINAL_MARK)
  })).filter(m => m.PERSON_ID != null)

  if (parsed.length === 0) {
    throw new Error('No marks to save: enter at least one mark (or clear marks explicitly by sending an empty value).')
  }

  const summary = await withTransaction(async (tx) => {
    // The exam must exist, and — when the caller is a teacher — belong to one
    // of the teacher's majors. Admins may pass teacherPersonId =
    // null to skip the ownership check (used by future admin screens).
    const examRes = await tx(
      'SELECT EXAMINATION_ID, MAJOR_ID FROM examination WHERE EXAMINATION_ID = $1',
      [examinationId]
    )
    if (!examRes?.data?.length) {
      throw new Error('The examination could not be found. It may have been removed.')
    }
    const exam = examRes.data[0]

    if (teacherPersonId != null) {
      const allowed = await tx(
        'SELECT 1 FROM major_teacher WHERE PERSON_ID = $1 AND MAJOR_ID = $2',
        [teacherPersonId, exam.MAJOR_ID]
      )
      if (!allowed?.data?.length) {
        throw new Error('You can only enter marks for exams of the majors you teach.')
      }
    }

    let saved = 0
    let cleared = 0
    for (const m of parsed) {
      const res = await tx(
        `UPDATE person_has_examination
         SET FINAL_MARK = $3
         WHERE EXAMINATION_ID = $1 AND PERSON_ID = $2`,
        [examinationId, m.PERSON_ID, m.FINAL_MARK]
      )
      if (res?.rowCount > 0) {
        if (m.FINAL_MARK === null) cleared++
        else saved++
      }
    }

    const skipped = parsed.length - saved - cleared
    return { examinationId, saved, cleared, skipped }
  })

  await recordAudit({
    actorPersonId: teacherPersonId,
    action: 'exam.marks_save',
    entityType: 'examination',
    entityId: examinationId,
    detail: summary
  })

  return summary
}
