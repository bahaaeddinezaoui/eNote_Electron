import { query } from '../db'
import { personNameColumns } from '../sqlPersonName'
import { startOfWeekSunday, endOfWeekSaturday, toDateOnly } from '../../shared/week'
import { loadScope, assertStudentAllowed, assertSectionsAllowed, assertMajorAllowed } from './teachingScopeService'
import { diffRow, recordAudit } from './auditService'

export async function createStudyYear(yearData) {
  const columns = Object.keys(yearData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(yearData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(yearData)

  const res = await query(`INSERT INTO study_year (${columns}) VALUES (${pgPlaceholders}) RETURNING study_year_id`, values)
  const newId = res.data?.[0]?.STUDY_YEAR_ID

  return { ...yearData, STUDY_YEAR_ID: newId }
}

export async function createStudySemester(semesterData) {
  const columns = Object.keys(semesterData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(semesterData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(semesterData)

  const res = await query(`INSERT INTO study_semester (${columns}) VALUES (${pgPlaceholders}) RETURNING study_semester_id`, values)
  const newId = res.data?.[0]?.STUDY_SEMESTER_ID

  return { ...semesterData, STUDY_SEMESTER_ID: newId }
}

export async function createStudyWeek(weekData) {
  // A study week is a Sunday→Saturday block: whatever range the form sends,
  // the week is stored as the Sunday-to-Saturday week that contains it.
  const anchor = normalizeDate(weekData.STUDY_WEEK_START_DATE) || normalizeDate(weekData.STUDY_WEEK_END_DATE)
  const data = anchor
    ? { ...weekData, STUDY_WEEK_START_DATE: startOfWeekSunday(anchor), STUDY_WEEK_END_DATE: endOfWeekSaturday(anchor) }
    : weekData

  const columns = Object.keys(data).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(data).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(data)

  const res = await query(`INSERT INTO study_week (${columns}) VALUES (${pgPlaceholders}) RETURNING study_week_id`, values)
  const newId = res.data?.[0]?.STUDY_WEEK_ID

  // A study week is made of study_day rows, one per date it covers. Sessions
  // now attach to those days (each day is stored as an actual date).
  if (newId && data.STUDY_WEEK_START_DATE && data.STUDY_WEEK_END_DATE) {
    await query(`
      INSERT INTO study_day (study_week_id, study_day_date)
      SELECT $1, d::date
      FROM generate_series(
        $2::date::timestamp,
        $3::date::timestamp,
        INTERVAL '1 day'
      ) AS d
      ON CONFLICT (study_week_id, study_day_date) DO NOTHING
    `, [newId, data.STUDY_WEEK_START_DATE, data.STUDY_WEEK_END_DATE])
  }

  return { ...data, STUDY_WEEK_ID: newId }
}

export async function getStudyYears() {
  return await query('SELECT * FROM study_year ORDER BY study_year_code DESC')
}

export async function updateStudyYear(yearId, yearData) {
  const pgSets = Object.keys(yearData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(yearData), yearId]

  await query(`UPDATE study_year SET ${pgSets} WHERE study_year_id = $${values.length}`, values)
  return { ...yearData, STUDY_YEAR_ID: yearId }
}

export async function getStudySemesters(yearId) {
  if (yearId) {
    return await query('SELECT * FROM study_semester WHERE study_year_id = $1 ORDER BY study_semester_code', [yearId])
  }
  return await query('SELECT * FROM study_semester ORDER BY study_semester_code')
}

export async function updateStudySemester(semesterId, semesterData) {
  const pgSets = Object.keys(semesterData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(semesterData), semesterId]

  await query(`UPDATE study_semester SET ${pgSets} WHERE study_semester_id = $${values.length}`, values)
  return { ...semesterData, STUDY_SEMESTER_ID: semesterId }
}

export async function getStudyWeeks(semesterId) {
  if (semesterId) {
    return await query('SELECT * FROM study_week WHERE study_semester_id = $1 ORDER BY study_week_start_date', [semesterId])
  }
  return await query('SELECT * FROM study_week ORDER BY study_week_start_date')
}

// Normalizes a renderer-supplied date ('2026-09-01' from <input type="date">,
// or a full ISO timestamp from a fetched row) to a plain YYYY-MM-DD string, or
// null when empty. Kept here so create and update share one date contract.
function normalizeDate(value) {
  return toDateOnly(value) || null
}

export async function updateStudyWeek(weekId, weekData) {
  // Weeks are Sunday→Saturday blocks, so an edited range snaps to the week
  // boundaries containing it; the study_day rows follow in the block below.
  const anchor = normalizeDate(weekData.STUDY_WEEK_START_DATE) || normalizeDate(weekData.STUDY_WEEK_END_DATE)
  const aligned = anchor
    ? { ...weekData, STUDY_WEEK_START_DATE: startOfWeekSunday(anchor), STUDY_WEEK_END_DATE: endOfWeekSaturday(anchor) }
    : weekData

  const dataToUpdate = {}
  for (const key of Object.keys(aligned)) {
    if (key === 'STUDY_WEEK_START_DATE' || key === 'STUDY_WEEK_END_DATE') {
      const normalized = normalizeDate(aligned[key])
      if (normalized) dataToUpdate[key] = normalized
    } else {
      dataToUpdate[key] = weekData[key]
    }
  }

  const start = dataToUpdate.STUDY_WEEK_START_DATE
  const end = dataToUpdate.STUDY_WEEK_END_DATE

  // Moving a week to another Sunday→Saturday block must not strand days (and
  // the sessions on them) outside the new range: they would keep showing in
  // this week's timetable beside dates from another block.
  if (start && end) {
    const stranded = await query(
      `SELECT COUNT(*) AS N
       FROM study_day d
       WHERE d.study_week_id = $1
         AND (d.study_day_date < $2::date OR d.study_day_date > $3::date)
         AND EXISTS (SELECT 1 FROM study_session s WHERE s.study_day_id = d.study_day_id)`,
      [weekId, start, end]
    )
    if (Number(stranded.data?.[0]?.N) > 0) {
      throw new Error('This week still has sessions on days outside the new date range. Move those sessions to a day inside the new range first.')
    }
  }

  const pgSets = Object.keys(dataToUpdate).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(dataToUpdate), weekId]

  await query(`UPDATE study_week SET ${pgSets} WHERE study_week_id = $${values.length}`, values)

  // The date range changed: resync the week's study_day rows so they keep
  // covering exactly the dates the week spans (same logic as on create).
  if (start && end) {
    await query(`
      INSERT INTO study_day (study_week_id, study_day_date)
      SELECT $1, d::date
      FROM generate_series(
        $2::date::timestamp,
        $3::date::timestamp,
        INTERVAL '1 day'
      ) AS d
      ON CONFLICT (study_week_id, study_day_date) DO NOTHING
    `, [weekId, start, end])
    // Drop days that fell outside the new range. Sessions hang off study_day
    // rows, so only remove days that no longer carry any session.
    await query(`
      DELETE FROM study_day
      WHERE study_week_id = $1
        AND (study_day_date < $2::date OR study_day_date > $3::date)
        AND NOT EXISTS (
          SELECT 1 FROM study_session s WHERE s.study_day_id = study_day.study_day_id
        )
    `, [weekId, start, end])
  }

  return { ...aligned, STUDY_WEEK_ID: weekId }
}

// ---- Automatic week generation -------------------------------------------
// Splits a semester's date range into Sunday→Saturday weeks (the last one
// clipped at the semester end) and creates each week with its study_day rows,
// skipping the user-chosen weekend days. Weekend days use the JS/Postgres
// convention: 0 = Sunday … 6 = Saturday.
export async function generateStudyWeeks(options) {
  const semesterId = options.STUDY_SEMESTER_ID
  const startDate = normalizeDate(options.START_DATE)
  const endDate = normalizeDate(options.END_DATE)
  const weekendDays = (options.WEEKEND_DAYS || []).map(Number).filter(d => d >= 0 && d <= 6)
  const replaceExisting = !!options.REPLACE_EXISTING

  if (!semesterId) throw new Error('A semester must be selected.')
  if (!startDate || !endDate) throw new Error('Start and end dates are required.')
  if (endDate < startDate) throw new Error('The end date must be on or after the start date.')

  // Existing weeks in this semester.
  const existing = await query('SELECT study_week_id FROM study_week WHERE study_semester_id = $1', [semesterId])
  const existingIds = (existing.data || []).map(w => Number(w.STUDY_WEEK_ID ?? w.study_week_id))

  if (existingIds.length > 0) {
    if (!replaceExisting) {
      throw new Error(`This semester already has ${existingIds.length} week${existingIds.length === 1 ? '' : 's'}. Tick "Replace existing weeks" to regenerate them.`)
    }
    // Replacing must not silently destroy scheduled sessions.
    const withSessions = await query(`
      SELECT COUNT(DISTINCT d.study_week_id) AS N
      FROM study_day d
      JOIN study_session s ON s.study_day_id = d.study_day_id
      WHERE d.study_week_id = ANY($1::int[])
    `, [existingIds])
    const blocked = Number(withSessions.data?.[0]?.N) || 0
    if (blocked > 0) {
      throw new Error(`${blocked} week${blocked === 1 ? ' has' : 's have'} scheduled sessions. Remove their sessions in the Schedule page before regenerating.`)
    }
    await query('DELETE FROM study_day WHERE study_week_id = ANY($1::int[])', [existingIds])
    await query('DELETE FROM study_week WHERE study_semester_id = $1', [semesterId])
  }

  // Walk the range in Sunday→Saturday blocks. The first block opens on the
  // Sunday on or before the semester start (and is clipped to the semester's
  // own first day, so no study day precedes the term).
  const created = []
  const startMs = Date.parse(`${startDate}T00:00:00Z`)
  const endMs = Date.parse(`${endDate}T00:00:00Z`)
  const DAY_MS = 24 * 60 * 60 * 1000
  const firstSundayMs = startMs - new Date(startMs).getUTCDay() * DAY_MS

  for (let weekStart = firstSundayMs, index = 1; weekStart <= endMs; weekStart += 7 * DAY_MS, index++) {
    // Every week is stored as a full Sunday→Saturday block, including the one
    // that holds the term's last day; its study days still stop at the term's
    // own end, so the last week never reaches into the next term.
    const blockEnd = weekStart + 6 * DAY_MS
    const ws = new Date(weekStart).toISOString().slice(0, 10)
    const we = new Date(blockEnd).toISOString().slice(0, 10)
    // The week itself opens on Sunday even when the term starts mid-week; its
    // first study day is then the term's own first day.
    const dayFrom = weekStart < startMs ? startDate : ws
    const dayTo = blockEnd > endMs ? endDate : we
    const code = `W${index}`

    const res = await query(`
      INSERT INTO study_week (study_semester_id, study_week_code, study_week_label_en, study_week_start_date, study_week_end_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING study_week_id
    `, [semesterId, code, `Week ${index}`, ws, we])
    const newId = res.data?.[0]?.STUDY_WEEK_ID

    // Study days for this week, minus the chosen weekend days.
    if (newId) {
      await query(`
        INSERT INTO study_day (study_week_id, study_day_date)
        SELECT $1, d::date
        FROM generate_series(
          $2::date::timestamp,
          $3::date::timestamp,
          INTERVAL '1 day'
        ) AS d
        WHERE NOT (EXTRACT(DOW FROM d)::int = ANY($4::int[]))
      `, [newId, dayFrom, dayTo, weekendDays])
      created.push({ STUDY_WEEK_ID: newId, STUDY_WEEK_CODE: code, STUDY_WEEK_START_DATE: ws, STUDY_WEEK_END_DATE: we })
    }
  }

  if (created.length === 0) throw new Error('No weeks could be generated from the given date range.')

  return { success: true, createdCount: created.length, created }
}

// ---- Deletes (guarded: no silent cascades of schedule-critical data) ----------

export async function deleteStudyYear(yearId) {
  const semesters = await query('SELECT COUNT(*) AS N FROM study_semester WHERE study_year_id = $1', [yearId])
  const count = Number(semesters.data?.[0]?.N) || 0
  if (count > 0) {
    throw new Error(`This year still has ${count} semester${count === 1 ? '' : 's'}. Delete its semesters first.`)
  }
  await query('DELETE FROM study_year WHERE study_year_id = $1', [yearId])
  return { success: true }
}

export async function deleteStudySemester(semesterId) {
  const weeks = await query('SELECT COUNT(*) AS N FROM study_week WHERE study_semester_id = $1', [semesterId])
  const count = Number(weeks.data?.[0]?.N) || 0
  if (count > 0) {
    throw new Error(`This semester still has ${count} week${count === 1 ? '' : 's'}. Delete its weeks first.`)
  }
  try {
    await query('DELETE FROM study_semester WHERE study_semester_id = $1', [semesterId])
  } catch (e) {
    throw new Error('This semester is referenced by teaching groups or hourly volumes. Remove those references first.')
  }
  return { success: true }
}

export async function deleteStudyWeek(weekId) {
  try {
    await query('DELETE FROM study_day WHERE study_week_id = $1', [weekId])
  } catch (e) {
    throw new Error('This week has scheduled sessions. Remove its sessions in the Schedule page before deleting it.')
  }
  await query('DELETE FROM study_week WHERE study_week_id = $1', [weekId])
  return { success: true }
}

// Sections
export async function getSections() {
  return await query(`
    SELECT s.*, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr, p.promotion_label_en, p.promotion_label_ar, p.promotion_label_fr
    FROM section s 
    LEFT JOIN teaching_category tc ON s.TEACHING_CATEGORY_ID = tc.TEACHING_CATEGORY_ID
    LEFT JOIN promotion p ON s.PROMOTION_ID = p.PROMOTION_ID
    ORDER BY s.section_label_en, s.section_label_ar, s.section_label_fr
  `)
}

export async function createSection(sectionData) {
  const columns = Object.keys(sectionData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(sectionData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(sectionData)

  const res = await query(`INSERT INTO section (${columns}) VALUES (${pgPlaceholders}) RETURNING section_id`, values)
  const newId = res.data?.[0]?.SECTION_ID

  return { ...sectionData, SECTION_ID: newId }
}

export async function updateSection(id, sectionData) {
  const pgSets = Object.keys(sectionData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(sectionData), id]

  await query(`UPDATE section SET ${pgSets} WHERE section_id = $${values.length}`, values)
  return { ...sectionData, SECTION_ID: id }
}

export async function deleteSection(id) {
  await query('DELETE FROM section WHERE section_id = $1', [id])
  return { success: true }
}

// Major Categories
export async function getMajorCategories() {
  return await query('SELECT * FROM major_category ORDER BY COALESCE(major_category_label_en, major_category_label_ar, major_category_label_fr)')
}

export async function createMajorCategory(categoryData) {
  const columns = Object.keys(categoryData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(categoryData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(categoryData)

  const res = await query(`INSERT INTO major_category (${columns}) VALUES (${pgPlaceholders}) RETURNING major_category_id`, values)
  const newId = res.data?.[0]?.MAJOR_CATEGORY_ID

  return { ...categoryData, MAJOR_CATEGORY_ID: newId }
}

export async function updateMajorCategory(id, categoryData) {
  const pgSets = Object.keys(categoryData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(categoryData), id]

  await query(`UPDATE major_category SET ${pgSets} WHERE major_category_id = $${values.length}`, values)
  return { ...categoryData, MAJOR_CATEGORY_ID: id }
}

export async function deleteMajorCategory(id) {
  // A department names the major category it is responsible for; the foreign
  // key would refuse the delete anyway, but this says why.
  const used = await query('SELECT count(*)::int AS n FROM department WHERE major_category_id = $1', [id])
  const count = Number(used.data?.[0]?.N) || 0
  if (count > 0) {
    throw new Error(
      count === 1
        ? 'A department is still responsible for this major category. Move it to another category first.'
        : `${count} departments are still responsible for this major category. Move them to another category first.`
    )
  }
  await query('DELETE FROM major_category WHERE major_category_id = $1', [id])
  return { success: true }
}

// Teaching Categories
export async function getTeachingCategories() {
  return await query('SELECT * FROM teaching_category ORDER BY COALESCE(teaching_category_label_en, teaching_category_label_ar, teaching_category_label_fr)')
}

export async function createTeachingCategory(categoryData) {
  const columns = Object.keys(categoryData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(categoryData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(categoryData)

  const res = await query(`INSERT INTO teaching_category (${columns}) VALUES (${pgPlaceholders}) RETURNING teaching_category_id`, values)
  const newId = res.data?.[0]?.TEACHING_CATEGORY_ID

  return { ...categoryData, TEACHING_CATEGORY_ID: newId }
}

export async function updateTeachingCategory(id, categoryData) {
  const pgSets = Object.keys(categoryData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(categoryData), id]

  await query(`UPDATE teaching_category SET ${pgSets} WHERE teaching_category_id = $${values.length}`, values)
  return { ...categoryData, TEACHING_CATEGORY_ID: id }
}

export async function deleteTeachingCategory(id) {
  await query('DELETE FROM teaching_category WHERE teaching_category_id = $1', [id])
  return { success: true }
}

// Majors
export async function getMajors() {
  return await query(`
    SELECT m.*, mc.major_category_label_en, mc.major_category_label_ar, mc.major_category_label_fr 
    FROM major m 
    LEFT JOIN major_category mc ON m.MAJOR_CATEGORY_ID = mc.MAJOR_CATEGORY_ID 
    ORDER BY COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr)
  `)
}

export async function getMajorTeachers() {
  return await query(`
    SELECT mt.MAJOR_ID,
      p.PERSON_ID,
      p.PERSON_FIRST_NAME_LA AS PERSON_FIRST_NAME,
      p.PERSON_FIRST_NAME_LA, p.PERSON_FIRST_NAME_AR,
      p.PERSON_LAST_NAME_LA AS PERSON_LAST_NAME,
      p.PERSON_LAST_NAME_LA, p.PERSON_LAST_NAME_AR
    FROM major_teacher mt
    LEFT JOIN person p ON mt.PERSON_ID = p.PERSON_ID
    ORDER BY mt.MAJOR_ID, p.PERSON_LAST_NAME_LA, p.PERSON_FIRST_NAME_LA
  `)
}

export async function updateMajorTeachers(majorId, teacherIds) {
  await query('DELETE FROM major_teacher WHERE major_id = $1', [majorId])

  for (const teacherId of teacherIds || []) {
    await query('INSERT INTO major_teacher (major_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [majorId, teacherId])
  }

  return { success: true }
}

// Majors a given teacher teaches (major_teacher), enriched with the category
// the major belongs to. Used to restrict teacher-facing features (e.g. document
// upload) to the categories/majors they actually teach.
export async function getMajorsTaughtByTeacher(personId) {
  return await query(`
    SELECT m.*, mc.major_category_label_en, mc.major_category_label_ar, mc.major_category_label_fr, mc.MAJOR_CATEGORY_CODE
    FROM major_teacher mt
    JOIN major m ON mt.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN major_category mc ON m.MAJOR_CATEGORY_ID = mc.MAJOR_CATEGORY_ID
    WHERE mt.PERSON_ID = $1
    ORDER BY mc.major_category_label_en, mc.major_category_label_ar, mc.major_category_label_fr NULLS LAST, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr)
  `, [personId])
}

export async function createMajor(majorData) {
  const { MAJOR_TEACHER_IDS, ...dataToInsert } = majorData
  const columns = Object.keys(dataToInsert).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(dataToInsert).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(dataToInsert)

  const res = await query(`INSERT INTO major (${columns}) VALUES (${pgPlaceholders}) RETURNING major_id`, values)
  const newId = res.data?.[0]?.MAJOR_ID

  return { ...majorData, MAJOR_ID: newId }
}

export async function updateMajor(id, majorData) {
  const { MAJOR_TEACHER_IDS, ...dataToUpdate } = majorData
  const pgSets = Object.keys(dataToUpdate).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(dataToUpdate), id]

  await query(`UPDATE major SET ${pgSets} WHERE major_id = $${values.length}`, values)
  return { ...majorData, MAJOR_ID: id }
}

export async function deleteMajor(id) {
  await query('DELETE FROM major WHERE major_id = $1', [id])
  return { success: true }
}

// Promotions
export async function getPromotions() {
  return await query(`
    SELECT p.*, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr,
           (SELECT COALESCE(array_agg(DISTINCT s.teaching_category_id), '{}')
              FROM section s
             WHERE s.promotion_id = p.promotion_id
               AND s.teaching_category_id IS NOT NULL) AS section_teaching_category_ids
    FROM promotion p
    LEFT JOIN teaching_category tc ON p.TEACHING_CATEGORY_ID = tc.TEACHING_CATEGORY_ID
    ORDER BY p.promotion_label_en, p.promotion_label_ar, p.promotion_label_fr
  `)
}

export async function createPromotion(promotionData, actorUserId) {
  const columns = Object.keys(promotionData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(promotionData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(promotionData)

  const res = await query(`INSERT INTO promotion (${columns}) VALUES (${pgPlaceholders}) RETURNING *`, values)
  const newId = res.data?.[0]?.PROMOTION_ID

  await recordAudit({
    actorUserId,
    action: 'promotion.create',
    entityType: 'promotion',
    entityId: newId,
    entityLabel: promotionData.PROMOTION_CODE || null,
    detail: promotionData
  })

  return { ...promotionData, PROMOTION_ID: newId }
}

export async function updatePromotion(id, promotionData, actorUserId) {
  const existing = await query('SELECT * FROM promotion WHERE promotion_id = $1', [id])
  const before = existing.data?.[0]
  if (!before) throw new Error('Promotion not found.')

  const pgSets = Object.keys(promotionData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(promotionData), id]

  const res = await query(`UPDATE promotion SET ${pgSets} WHERE promotion_id = $${values.length} RETURNING *`, values)
  const after = res.data?.[0]
  if (!after) throw new Error('Promotion not found.')

  await recordAudit({
    actorUserId,
    action: 'promotion.update',
    entityType: 'promotion',
    entityId: id,
    entityLabel: after.PROMOTION_CODE || before.PROMOTION_CODE || null,
    changes: diffRow(before, after)
  })

  return { ...promotionData, PROMOTION_ID: id }
}

export async function deletePromotion(id, actorUserId) {
  const existing = await query('SELECT * FROM promotion WHERE promotion_id = $1', [id])
  const promotion = existing.data?.[0]
  if (!promotion) throw new Error('Promotion not found.')

  const sections = await query(
    'SELECT COUNT(*)::int AS section_count FROM section WHERE promotion_id = $1',
    [id]
  )
  if (Number(sections.data?.[0]?.SECTION_COUNT || 0) > 0) {
    throw new Error('A promotion assigned to a section cannot be deleted. Move its sections first.')
  }

  try {
    await query('DELETE FROM promotion WHERE promotion_id = $1', [id])
  } catch (error) {
    if (error.code === '23503') {
      throw new Error('This promotion is still referenced by another record and cannot be deleted.')
    }
    throw error
  }

  await recordAudit({
    actorUserId,
    action: 'promotion.delete',
    entityType: 'promotion',
    entityId: id,
    entityLabel: promotion.PROMOTION_CODE || null,
    detail: promotion
  })

  return { success: true }
}

// Classroom Categories
export async function getClassroomCategories() {
  return await query('SELECT * FROM classroom_category ORDER BY COALESCE(classroom_category_label_en, classroom_category_label_ar, classroom_category_label_fr)')
}

export async function createClassroomCategory(categoryData) {
  const columns = Object.keys(categoryData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(categoryData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(categoryData)

  const res = await query(`INSERT INTO classroom_category (${columns}) VALUES (${pgPlaceholders}) RETURNING classroom_category_id`, values)
  const newId = res.data?.[0]?.CLASSROOM_CATEGORY_ID

  return { ...categoryData, CLASSROOM_CATEGORY_ID: newId }
}

export async function updateClassroomCategory(id, categoryData) {
  const pgSets = Object.keys(categoryData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(categoryData), id]

  await query(`UPDATE classroom_category SET ${pgSets} WHERE classroom_category_id = $${values.length}`, values)
  return { ...categoryData, CLASSROOM_CATEGORY_ID: id }
}

export async function deleteClassroomCategory(id) {
  await query('DELETE FROM classroom_category WHERE classroom_category_id = $1', [id])
  return { success: true }
}

// Classrooms
export async function getClassrooms() {
  return await query(`
    SELECT c.*, cc.classroom_category_label_en, cc.classroom_category_label_ar, cc.classroom_category_label_fr 
    FROM classroom c 
    LEFT JOIN classroom_category cc ON c.CLASSROOM_CATEGORY_ID = cc.CLASSROOM_CATEGORY_ID 
    ORDER BY c.classroom_label_en, c.classroom_label_ar, c.classroom_label_fr
  `)
}

export async function createClassroom(classroomData) {
  const columns = Object.keys(classroomData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(classroomData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(classroomData)

  const res = await query(`INSERT INTO classroom (${columns}) VALUES (${pgPlaceholders}) RETURNING classroom_id`, values)
  const newId = res.data?.[0]?.CLASSROOM_ID

  // A classroom has seats: create seats 1..capacity automatically.
  if (newId && classroomData.CLASSROOM_CAPACITY) {
    await generateClassroomSeats(newId, Number(classroomData.CLASSROOM_CAPACITY))
  }

  return { ...classroomData, CLASSROOM_ID: newId }
}

export async function updateClassroom(id, classroomData) {
  const pgSets = Object.keys(classroomData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(classroomData), id]

  await query(`UPDATE classroom SET ${pgSets} WHERE classroom_id = $${values.length}`, values)

  // Capacity changed: grow or shrink the seat list to match. Growing appends
  // the new highest numbers; shrinking only drops seats no student is seated
  // in (checked in the seat-update logic below via fk on person_has_examination).
  if (classroomData.CLASSROOM_CAPACITY !== undefined && classroomData.CLASSROOM_CAPACITY !== null && classroomData.CLASSROOM_CAPACITY !== '') {
    await syncClassroomSeats(id, Number(classroomData.CLASSROOM_CAPACITY))
  }

  return { ...classroomData, CLASSROOM_ID: id }
}

// ---- Classroom seats (every classroom has seats, each with a number) ---------

// Create seats 1..count for a room (keeps existing ones).
export async function generateClassroomSeats(classroomId, count) {
  const n = parseInt(count, 10)
  if (!n || n <= 0) return { created: 0 }
  const res = await query(
    `INSERT INTO classroom_seat (classroom_id, seat_number)
     SELECT $1, s.seat_number FROM generate_series(1, $2::int) AS s(seat_number)
     ON CONFLICT (classroom_id, seat_number) DO NOTHING`,
    [classroomId, n]
  )
  return { created: res.rowCount || 0 }
}

// Make the room's seat list exactly 1..capacity: append missing numbers and
// remove numbers beyond capacity, but never remove a seat an exam student is
// seated in (person_has_examination.seat_number + group room).
async function syncClassroomSeats(classroomId, capacity) {
  const cap = Math.max(0, Math.floor(capacity))
  await query(
    `INSERT INTO classroom_seat (classroom_id, seat_number)
     SELECT $1, s.seat_number FROM generate_series(1, $2::int) AS s(seat_number)
     ON CONFLICT (classroom_id, seat_number) DO NOTHING`,
    [classroomId, cap]
  )
  await query(
    `DELETE FROM classroom_seat cs
     WHERE cs.classroom_id = $1 AND cs.seat_number > $2
       AND NOT EXISTS (
         SELECT 1 FROM person_has_examination phe
         JOIN examination_group eg ON eg.examination_group_id = phe.examination_group_id
         WHERE eg.classroom_id = cs.classroom_id AND phe.seat_number = cs.seat_number
       )`,
    [classroomId, cap]
  )
}

export async function getClassroomSeats(classroomId) {
  return await query(
    `SELECT cs.*, phe.PERSON_ID AS OCCUPANT_PERSON_ID,
            ${personNameColumns('p', 'OCCUPANT_NAME')}
     FROM classroom_seat cs
     LEFT JOIN examination_group eg ON eg.CLASSROOM_ID = cs.CLASSROOM_ID
     LEFT JOIN person_has_examination phe
            ON phe.EXAMINATION_GROUP_ID = eg.EXAMINATION_GROUP_ID AND phe.SEAT_NUMBER = cs.SEAT_NUMBER
     LEFT JOIN person p ON p.PERSON_ID = phe.PERSON_ID
     WHERE cs.CLASSROOM_ID = $1
     ORDER BY cs.SEAT_NUMBER`,
    [classroomId]
  )
}

export async function addClassroomSeat(classroomId, seatNumber) {
  const res = await query(
    `INSERT INTO classroom_seat (classroom_id, seat_number) VALUES ($1, $2)
     ON CONFLICT (classroom_id, seat_number) DO NOTHING RETURNING classroom_seat_id`,
    [classroomId, seatNumber]
  )
  if (res.rowCount === 0) throw new Error('That seat number already exists in this classroom.')
  return { success: true }
}

export async function deleteClassroomSeat(classroomId, seatNumber) {
  const used = await query(
    `SELECT 1 FROM person_has_examination phe
     JOIN examination_group eg ON eg.examination_group_id = phe.examination_group_id
     WHERE eg.classroom_id = $1 AND phe.seat_number = $2 LIMIT 1`,
    [classroomId, seatNumber]
  )
  if (used.data?.length > 0) {
    throw new Error('This seat is occupied by an exam student. Unseat them first.')
  }
  await query('DELETE FROM classroom_seat WHERE classroom_id = $1 AND seat_number = $2', [classroomId, seatNumber])
  return { success: true }
}

export async function deleteClassroom(id) {
  await query('DELETE FROM classroom WHERE classroom_id = $1', [id])
  return { success: true }
}

// Teaching Groups
// teaching_group holds one label per language and has no single
// `teaching_group_label` column, but the pages read TEACHING_GROUP_LABEL, so
// every list resolves it to the first language that is filled.
const TEACHING_GROUP_SELECT = `
  SELECT tg.*,
         m.major_category_id,
         COALESCE(tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr) AS teaching_group_label
  FROM teaching_group tg
  LEFT JOIN major m ON m.major_id = tg.major_id`
const TEACHING_GROUP_ORDER = 'ORDER BY tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr'

// The timetable dialog needs each group's roster size next to its label: a
// classroom may only take a group whose students all fit in its seats.
const TEACHING_GROUP_SELECT_WITH_STUDENTS = `
  SELECT tg.*,
         m.major_category_id,
         COALESCE(tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr) AS teaching_group_label,
         (SELECT COUNT(DISTINCT sdg.PERSON_ID)
            FROM student_dynamic_group_by_major sdg
            JOIN person p ON p.PERSON_ID = sdg.PERSON_ID
           WHERE sdg.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
             AND p.IS_STUDENT = TRUE) AS student_count
  FROM teaching_group tg
  LEFT JOIN major m ON m.major_id = tg.major_id`

export async function getTeachingGroups() {
  return await query(`${TEACHING_GROUP_SELECT} ${TEACHING_GROUP_ORDER}`)
}

export async function createTeachingGroup(groupData, scope) {
  // A restricted scheduler may only create groups inside their own categories
  // and inside the major categories owned by their departments.
  if (scope?.restricted) {
    const categoryId = parseInt(groupData.TEACHING_CATEGORY_ID ?? groupData.teaching_category_id, 10)
    if (!categoryId || !scope.categoryIds.includes(categoryId)) {
      throw new Error('Not allowed: choose one of the teaching categories you are responsible for.')
    }
    const majorId = parseInt(groupData.MAJOR_ID ?? groupData.major_id, 10)
    await assertMajorAllowed(scope, majorId)
  }

  const columns = Object.keys(groupData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(groupData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(groupData)

  const res = await query(`INSERT INTO teaching_group (${columns}) VALUES (${pgPlaceholders}) RETURNING teaching_group_id`, values)
  const newId = res.data?.[0]?.TEACHING_GROUP_ID

  return { ...groupData, TEACHING_GROUP_ID: newId }
}

export async function updateTeachingGroup(id, groupData) {
  const pgSets = Object.keys(groupData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(groupData), id]

  await query(`UPDATE teaching_group SET ${pgSets} WHERE teaching_group_id = $${values.length}`, values)
  return { ...groupData, TEACHING_GROUP_ID: id }
}

export async function deleteTeachingGroup(id) {
  await query('DELETE FROM study_session WHERE teaching_group_id = $1', [id])
  await query('DELETE FROM student_dynamic_group_by_major WHERE teaching_group_id = $1', [id])
  await query('DELETE FROM major_hourly_volume_by_session_type WHERE teaching_group_id = $1', [id])
  await query('DELETE FROM teaching_group WHERE teaching_group_id = $1', [id])

  return { success: true }
}

// Session Types
export async function getStudySessionTypes() {
  // Labels are stored per language (label_en/ar/fr); there is no single
  // study_session_type_label column to sort by. The read-time localization
  // still exposes STUDY_SESSION_TYPE_LABEL by picking the active language.
  return await query('SELECT * FROM study_session_type ORDER BY study_session_type_label_en, study_session_type_label_ar, study_session_type_label_fr')
}

export async function createStudySessionType(typeData) {
  const columns = Object.keys(typeData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(typeData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(typeData)

  const res = await query(`INSERT INTO study_session_type (${columns}) VALUES (${pgPlaceholders}) RETURNING study_session_type_id`, values)
  const newId = res.data?.[0]?.STUDY_SESSION_TYPE_ID

  return { ...typeData, STUDY_SESSION_TYPE_ID: newId }
}

export async function updateStudySessionType(id, typeData) {
  const pgSets = Object.keys(typeData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(typeData), id]

  await query(`UPDATE study_session_type SET ${pgSets} WHERE study_session_type_id = $${values.length}`, values)
  return { ...typeData, STUDY_SESSION_TYPE_ID: id }
}

export async function deleteStudySessionType(id) {
  await query('DELETE FROM study_session_type WHERE study_session_type_id = $1', [id])
  return { success: true }
}

// Session time slots: the predefined start/end pairs an Admin maintains in
// Settings. A slot carries no label — its name is the two times themselves.
export async function getStudySessionTimeSlots() {
  return await query('SELECT * FROM study_session_time_slot ORDER BY study_session_time_slot_start_time, study_session_time_slot_end_time')
}

export async function createStudySessionTimeSlot(slotData) {
  const columns = Object.keys(slotData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(slotData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(slotData)

  const res = await query(`INSERT INTO study_session_time_slot (${columns}) VALUES (${pgPlaceholders}) RETURNING study_session_time_slot_id`, values)
  const newId = res.data?.[0]?.STUDY_SESSION_TIME_SLOT_ID

  return { ...slotData, STUDY_SESSION_TIME_SLOT_ID: newId }
}

export async function updateStudySessionTimeSlot(id, slotData) {
  const pgSets = Object.keys(slotData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(slotData), id]

  await query(`UPDATE study_session_time_slot SET ${pgSets} WHERE study_session_time_slot_id = $${values.length}`, values)
  return { ...slotData, STUDY_SESSION_TIME_SLOT_ID: id }
}

export async function deleteStudySessionTimeSlot(id) {
  await query('DELETE FROM study_session_time_slot WHERE study_session_time_slot_id = $1', [id])
  return { success: true }
}

// Groups for the Schedule page's GROUP filter dropdown: only the groups that
// belong to the selected semester (teaching_group.study_semester_id); when
// only a year is chosen, all groups of that year's semesters.
export async function getTeachingGroupsForSemester(semesterId, yearId) {
  if (semesterId) {
    return await query(
      `${TEACHING_GROUP_SELECT} WHERE tg.STUDY_SEMESTER_ID = $1 ${TEACHING_GROUP_ORDER}`,
      [semesterId]
    )
  }
  if (yearId) {
    return await query(`
      ${TEACHING_GROUP_SELECT}
      JOIN study_semester ss ON ss.study_semester_id = tg.study_semester_id
      WHERE ss.study_year_id = $1
      ${TEACHING_GROUP_ORDER}
    `, [yearId])
  }
  return await query(`${TEACHING_GROUP_SELECT} ${TEACHING_GROUP_ORDER}`)
}

export async function getTeachingGroupsByMajor(majorId, semesterId) {
  if (majorId && semesterId) {
    return await query(
      `${TEACHING_GROUP_SELECT_WITH_STUDENTS} WHERE tg.MAJOR_ID = $1 AND tg.STUDY_SEMESTER_ID = $2 ${TEACHING_GROUP_ORDER}`,
      [majorId, semesterId]
    )
  }
  if (majorId) {
    return await query(`${TEACHING_GROUP_SELECT_WITH_STUDENTS} WHERE tg.MAJOR_ID = $1 ${TEACHING_GROUP_ORDER}`, [majorId])
  }
  if (semesterId) {
    return await query(`${TEACHING_GROUP_SELECT_WITH_STUDENTS} WHERE tg.STUDY_SEMESTER_ID = $1 ${TEACHING_GROUP_ORDER}`, [semesterId])
  }
  return await query(`${TEACHING_GROUP_SELECT_WITH_STUDENTS} ${TEACHING_GROUP_ORDER}`)
}

export async function createStudentDynamicGroupByMajor(data) {
  const columns = Object.keys(data).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(data).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(data)

  await query(`
    INSERT INTO student_dynamic_group_by_major (${columns}) VALUES (${pgPlaceholders})
    ON CONFLICT (person_id, major_id, study_semester_id, teaching_group_id) DO NOTHING
  `, values)

  return { ...data }
}

// Academic Grades
export async function getAcademicGrades() {
  // Same per-language labels as study_session_type: sort on the real columns.
  return await query('SELECT * FROM academic_grade ORDER BY academic_grade_label_en, academic_grade_label_ar, academic_grade_label_fr')
}

export async function createAcademicGrade(gradeData) {
  const { ACADEMIC_GRADE_ID, ...dataToInsert } = gradeData
  const columns = Object.keys(dataToInsert).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(dataToInsert).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(dataToInsert)

  const res = await query(`INSERT INTO academic_grade (${columns}) VALUES (${pgPlaceholders}) RETURNING academic_grade_id`, values)
  const newId = res.data?.[0]?.ACADEMIC_GRADE_ID

  return { ...gradeData, ACADEMIC_GRADE_ID: newId }
}

export async function updateAcademicGrade(id, gradeData) {
  const pgSets = Object.keys(gradeData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(gradeData), id]

  await query(`UPDATE academic_grade SET ${pgSets} WHERE academic_grade_id = $${values.length}`, values)
  return { ...gradeData, ACADEMIC_GRADE_ID: id }
}

export async function deleteAcademicGrade(id) {
  await query('DELETE FROM academic_grade WHERE academic_grade_id = $1', [id])
  return { success: true }
}

// Grades (edutrack multilingual rank/grade lookup, person.person_grade_id;
// stored in the military_grade table since the old simple military_grade
// lookup was retired and this table took its name)
export async function getGrades() {
  return await query('SELECT * FROM military_grade ORDER BY military_grade_id')
}

export async function createGrade(gradeData) {
  const { GRADE_ID, ...dataToInsert } = gradeData
  const columns = Object.keys(dataToInsert).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(dataToInsert).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(dataToInsert)

  // military_grade_id is a plain int PK (seeded 1..27), not a serial:
  // generate the next free id (the caller's GRADE_ID is ignored).
  const res = await query(
    `INSERT INTO military_grade (military_grade_id, ${columns})
     SELECT COALESCE((SELECT MAX(military_grade_id) + 1 FROM military_grade), 1), ${pgPlaceholders}
     RETURNING military_grade_id`,
    values
  )
  const newId = res.data?.[0]?.MILITARY_GRADE_ID

  return { ...gradeData, GRADE_ID: newId }
}

export async function updateGrade(id, gradeData) {
  const pgSets = Object.keys(gradeData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(gradeData), id]

  await query(`UPDATE military_grade SET ${pgSets} WHERE military_grade_id = $${values.length}`, values)
  return { ...gradeData, GRADE_ID: id }
}

export async function deleteGrade(id) {
  await query('DELETE FROM military_grade WHERE military_grade_id = $1', [id])
  return { success: true }
}

// Major Hourly Volume (per major + semester + teaching group)
export async function getMajorHourlyVolumes(majorId, semesterId, teachingGroupId) {
  let sql = `
    SELECT mhv.*, m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR, s.study_semester_label_en, s.study_semester_label_ar, s.study_semester_label_fr, tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
    FROM major_hourly_volume mhv
    LEFT JOIN major m ON mhv.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN study_semester s ON mhv.STUDY_SEMESTER_ID = s.STUDY_SEMESTER_ID
    LEFT JOIN teaching_group tg ON mhv.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
  `
  const params = []

  if (majorId && semesterId && teachingGroupId) {
    sql += ` WHERE mhv.MAJOR_ID = $1 AND mhv.STUDY_SEMESTER_ID = $2 AND mhv.TEACHING_GROUP_ID = $3`
    params.push(majorId, semesterId, teachingGroupId)
  } else if (majorId && semesterId) {
    sql += ` WHERE mhv.MAJOR_ID = $1 AND mhv.STUDY_SEMESTER_ID = $2`
    params.push(majorId, semesterId)
  } else if (majorId) {
    sql += ` WHERE mhv.MAJOR_ID = $1`
    params.push(majorId)
  } else if (semesterId) {
    sql += ` WHERE mhv.STUDY_SEMESTER_ID = $1`
    params.push(semesterId)
  }

  sql += ` ORDER BY s.STUDY_SEMESTER_CODE, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr`
  return await query(sql, params)
}

export async function createMajorHourlyVolume(volumeData) {
  const columns = Object.keys(volumeData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(volumeData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(volumeData)

  const res = await query(`
    INSERT INTO major_hourly_volume (${columns}) VALUES (${pgPlaceholders}) 
    ON CONFLICT (major_id, study_semester_id, teaching_group_id) DO UPDATE SET hourly_volume = EXCLUDED.hourly_volume
    RETURNING major_hourly_volume_id
  `, values)
  const newId = res.data?.[0]?.MAJOR_HOURLY_VOLUME_ID

  return { ...volumeData, MAJOR_HOURLY_VOLUME_ID: newId }
}

export async function updateMajorHourlyVolume(majorId, semesterId, teachingGroupId, volumeData) {
  const pgSets = Object.keys(volumeData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(volumeData), majorId, semesterId, teachingGroupId]

  await query(`UPDATE major_hourly_volume SET ${pgSets} WHERE major_id = $${Object.keys(volumeData).length + 1} AND study_semester_id = $${Object.keys(volumeData).length + 2} AND teaching_group_id = $${Object.keys(volumeData).length + 3}`, values)
  return { ...volumeData, MAJOR_ID: majorId, STUDY_SEMESTER_ID: semesterId, TEACHING_GROUP_ID: teachingGroupId }
}

export async function deleteMajorHourlyVolume(majorId, semesterId, teachingGroupId) {
  await query('DELETE FROM major_hourly_volume WHERE major_id = $1 AND study_semester_id = $2 AND teaching_group_id = $3', [majorId, semesterId, teachingGroupId])
  return { success: true }
}

// Teaching volume for a major in one semester. The panel reads the whole
// picture from here so its halves agree: each teaching group's target, the
// hours its sessions put on the timetable, and how the target splits by
// session type. Scheduled hours always come from study_session, the only place
// a session exists — the per-section totals kept while saving a session are a
// cache and must not decide what the panel reports.
export async function getMajorHourlyProgress(majorId, semesterId, teachingGroupId = '') {
  const selectedGroupId = teachingGroupId ? parseInt(teachingGroupId, 10) : null
  const round2 = (value) => Math.round(value * 100) / 100

  // Groups this major has volume for in this semester: those attached to the
  // major, those with an overall target, and those already on the timetable.
  const groupsResult = await query(`
    SELECT tg.TEACHING_GROUP_ID,
           COALESCE(tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr) AS TEACHING_GROUP_LABEL,
           COALESCE(mhv.HOURLY_VOLUME, 0) AS TARGET_HOURS
    FROM teaching_group tg
    LEFT JOIN major_hourly_volume mhv
      ON mhv.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
     AND mhv.MAJOR_ID = $1
     AND mhv.STUDY_SEMESTER_ID = $2
    WHERE (tg.MAJOR_ID = $1 AND tg.STUDY_SEMESTER_ID = $2)
       OR mhv.MAJOR_HOURLY_VOLUME_ID IS NOT NULL
       OR EXISTS (
            SELECT 1
            FROM study_session s
            JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
            JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
            WHERE s.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
              AND s.MAJOR_ID = $1
              AND w.STUDY_SEMESTER_ID = $2
          )
    ORDER BY tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
  `, [majorId, semesterId])

  // Every session type is listed, even without a target, so a type that has
  // hours but no budget is visible instead of silently missing.
  const sessionTypesResult = await query(`
    SELECT STUDY_SESSION_TYPE_ID,
           COALESCE(study_session_type_label_en, study_session_type_label_ar, study_session_type_label_fr) AS STUDY_SESSION_TYPE_LABEL
    FROM study_session_type
    ORDER BY study_session_type_label_en, study_session_type_label_ar, study_session_type_label_fr
  `)

  const typeTargetsResult = await query(`
    SELECT STUDY_SESSION_TYPE_ID, TEACHING_GROUP_ID, HOURLY_VOLUME
    FROM major_hourly_volume_by_session_type
    WHERE MAJOR_ID = $1 AND STUDY_SEMESTER_ID = $2
  `, [majorId, semesterId])

  const sessionsResult = await query(`
    SELECT s.STUDY_SESSION_START_TIME, s.STUDY_SESSION_END_TIME,
           s.STUDY_SESSION_TYPE_ID, s.TEACHING_GROUP_ID
    FROM study_session s
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    WHERE s.MAJOR_ID = $1 AND w.STUDY_SEMESTER_ID = $2
  `, [majorId, semesterId])

  // The sections each group teaches: a section follows every session of its
  // teaching group, which is what the section half of the panel reports.
  const sectionsResult = await query(`
    SELECT DISTINCT sdg.TEACHING_GROUP_ID,
           s.SECTION_ID,
           COALESCE(s.section_label_en, s.section_label_ar, s.section_label_fr) AS SECTION_LABEL
    FROM student_dynamic_group_by_major sdg
    JOIN student_section ss ON ss.PERSON_ID = sdg.PERSON_ID
    JOIN section s ON ss.SECTION_ID = s.SECTION_ID
    WHERE sdg.MAJOR_ID = $1 AND sdg.STUDY_SEMESTER_ID = $2
    ORDER BY sdg.TEACHING_GROUP_ID, SECTION_LABEL
  `, [majorId, semesterId])

  const groupsById = new Map()
  for (const row of groupsResult.data || []) {
    groupsById.set(String(row.TEACHING_GROUP_ID), {
      teachingGroupId: parseInt(row.TEACHING_GROUP_ID, 10),
      teachingGroupLabel: row.TEACHING_GROUP_LABEL || '',
      targetVolume: Number(row.TARGET_HOURS) || 0,
      actualHours: 0,
      bySessionType: new Map(),
      sections: []
    })
  }

  const typeEntryOf = (group, sessionTypeId) => {
    const key = String(sessionTypeId)
    if (!group.bySessionType.has(key)) {
      group.bySessionType.set(key, { targetHours: 0, actualHours: 0 })
    }
    return group.bySessionType.get(key)
  }

  for (const row of typeTargetsResult.data || []) {
    const group = groupsById.get(String(row.TEACHING_GROUP_ID))
    if (!group) continue
    typeEntryOf(group, row.STUDY_SESSION_TYPE_ID).targetHours = Number(row.HOURLY_VOLUME) || 0
  }

  for (const session of sessionsResult.data || []) {
    const group = groupsById.get(String(session.TEACHING_GROUP_ID))
    if (!group) continue

    const [startH, startM] = (session.STUDY_SESSION_START_TIME || '00:00').split(':').map(Number)
    const [endH, endM] = (session.STUDY_SESSION_END_TIME || '00:00').split(':').map(Number)
    let minutes = endH * 60 + endM - (startH * 60 + startM)
    // 00:00 closes the timetable day at midnight rather than starting it.
    if (minutes < 0) minutes += 24 * 60
    const sessionHours = minutes / 60

    group.actualHours += sessionHours
    typeEntryOf(group, session.STUDY_SESSION_TYPE_ID).actualHours += sessionHours
  }

  for (const row of sectionsResult.data || []) {
    const group = groupsById.get(String(row.TEACHING_GROUP_ID))
    if (!group) continue
    group.sections.push({
      sectionId: parseInt(row.SECTION_ID, 10),
      label: row.SECTION_LABEL || '',
      // Filled once the group's own total is known below.
      hours: 0
    })
  }

  const sessionTypes = (sessionTypesResult.data || []).map((row) => ({
    sessionTypeId: parseInt(row.STUDY_SESSION_TYPE_ID, 10),
    label: row.STUDY_SESSION_TYPE_LABEL || ''
  }))

  const groups = []
  for (const group of groupsById.values()) {
    const progressBySessionType = []
    let allocatedHours = 0

    for (const type of sessionTypes) {
      const entry = group.bySessionType.get(String(type.sessionTypeId)) || { targetHours: 0, actualHours: 0 }
      const typeActualHours = round2(entry.actualHours)
      allocatedHours += entry.targetHours

      progressBySessionType.push({
        sessionTypeId: type.sessionTypeId,
        teachingGroupId: group.teachingGroupId,
        sessionTypeLabel: type.label,
        label: type.label,
        targetHours: entry.targetHours,
        actualHours: typeActualHours,
        progress: entry.targetHours > 0 ? Math.round((typeActualHours / entry.targetHours) * 100) : 0,
        remainingHours: Math.max(0, round2(entry.targetHours - typeActualHours))
      })
    }

    const actualHours = round2(group.actualHours)
    const targetVolume = round2(group.targetVolume)

    groups.push({
      teachingGroupId: group.teachingGroupId,
      teachingGroupLabel: group.teachingGroupLabel,
      targetVolume,
      allocatedHours: round2(allocatedHours),
      actualHours,
      progress: targetVolume > 0 ? Math.round((actualHours / targetVolume) * 100) : 0,
      remainingHours: Math.max(0, round2(targetVolume - actualHours)),
      progressBySessionType,
      sections: group.sections.map((section) => ({ ...section, hours: actualHours }))
    })
  }

  const selected = selectedGroupId
    ? groups.find((group) => group.teachingGroupId === selectedGroupId)
    : null

  // Without a group the panel reads the major as a whole: its target and its
  // scheduled hours are the sums of the groups below, never one arbitrary row.
  const totals = groups.reduce((sum, group) => ({
    targetVolume: sum.targetVolume + group.targetVolume,
    allocatedHours: sum.allocatedHours + group.allocatedHours,
    actualHours: sum.actualHours + group.actualHours
  }), { targetVolume: 0, allocatedHours: 0, actualHours: 0 })

  const targetVolume = round2(selected ? selected.targetVolume : totals.targetVolume)
  const actualHours = round2(selected ? selected.actualHours : totals.actualHours)

  return {
    majorId,
    semesterId,
    teachingGroupId: selected ? selected.teachingGroupId : '',
    teachingGroupLabel: selected ? selected.teachingGroupLabel : '',
    targetSet: selected ? selected.targetVolume > 0 : groups.some((group) => group.targetVolume > 0),
    targetVolume,
    allocatedHours: round2(selected ? selected.allocatedHours : totals.allocatedHours),
    actualHours,
    progress: targetVolume > 0 ? Math.round((actualHours / targetVolume) * 100) : 0,
    remainingHours: Math.max(0, round2(targetVolume - actualHours)),
    progressBySessionType: selected
      ? selected.progressBySessionType
      : groups.flatMap((group) => group.progressBySessionType
          .filter((row) => row.targetHours > 0 || row.actualHours > 0)
          .map((row) => ({ ...row, label: `${row.sessionTypeLabel} (${group.teachingGroupLabel})` }))),
    groups: groups.map(({ progressBySessionType, ...rest }) => rest)
  }
}

// Major Hourly Volume by Session Type
export async function getMajorHourlyVolumesBySessionType(majorId, semesterId) {
  let sql = `
    SELECT mhvst.*, m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR, s.study_semester_label_en, s.study_semester_label_ar, s.study_semester_label_fr, sst.study_session_type_label_en, sst.study_session_type_label_ar, sst.study_session_type_label_fr, tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
    FROM major_hourly_volume_by_session_type mhvst
    LEFT JOIN major m ON mhvst.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN study_semester s ON mhvst.STUDY_SEMESTER_ID = s.STUDY_SEMESTER_ID
    LEFT JOIN study_session_type sst ON mhvst.STUDY_SESSION_TYPE_ID = sst.STUDY_SESSION_TYPE_ID
    LEFT JOIN teaching_group tg ON mhvst.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
  `
  const params = []

  if (majorId && semesterId) {
    sql += ` WHERE mhvst.MAJOR_ID = $1 AND mhvst.STUDY_SEMESTER_ID = $2`
    params.push(majorId, semesterId)
  } else if (majorId) {
    sql += ` WHERE mhvst.MAJOR_ID = $1`
    params.push(majorId)
  } else if (semesterId) {
    sql += ` WHERE mhvst.STUDY_SEMESTER_ID = $1`
    params.push(semesterId)
  }

  sql += ` ORDER BY s.STUDY_SEMESTER_CODE, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr, sst.study_session_type_label_en, sst.study_session_type_label_ar, sst.study_session_type_label_fr`
  return await query(sql, params)
}

async function assertSessionTypeTargetFits(majorId, semesterId, sessionTypeId, teachingGroupId, newVolume) {
  const volume = Number(newVolume) || 0
  if (volume < 0) {
    throw new Error('Hourly volume cannot be a negative number. Please enter 0 or more.')
  }

  // The teaching group's overall target must be set before any per-session-type target.
  const targetRes = await query(
    'SELECT HOURLY_VOLUME FROM major_hourly_volume WHERE MAJOR_ID = $1 AND STUDY_SEMESTER_ID = $2 AND TEACHING_GROUP_ID = $3',
    [majorId, semesterId, teachingGroupId]
  )
  const targetRow = targetRes.data?.[0]
  if (!targetRow) {
    throw new Error('Please set the overall Target Hourly Volume for this teaching group before setting session-type targets.')
  }
  const targetVolume = Number(targetRow.HOURLY_VOLUME) || 0

  // Sum of the other session-type targets for the same teaching group (major + semester).
  const sumRes = await query(
    `SELECT COALESCE(SUM(hourly_volume), 0) AS allocated
     FROM major_hourly_volume_by_session_type
     WHERE major_id = $1 AND study_semester_id = $2 AND teaching_group_id = $3
       AND study_session_type_id <> $4`,
    [majorId, semesterId, teachingGroupId, sessionTypeId]
  )
  const allocated = Number(sumRes.data?.[0]?.ALLOCATED) || 0

  if (allocated + volume > targetVolume) {
    throw new Error(
      `The session-type targets for this group would exceed its overall target. ${allocated} hour(s) are already allocated to other session types, and adding ${volume} would exceed the ${targetVolume}-hour target.`
    )
  }
}

export async function createMajorHourlyVolumeBySessionType(volumeData) {
  await assertSessionTypeTargetFits(
    volumeData.MAJOR_ID,
    volumeData.STUDY_SEMESTER_ID,
    volumeData.STUDY_SESSION_TYPE_ID,
    volumeData.TEACHING_GROUP_ID,
    volumeData.HOURLY_VOLUME
  )

  const columns = Object.keys(volumeData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(volumeData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(volumeData)

  const res = await query(`
    INSERT INTO major_hourly_volume_by_session_type (${columns}) VALUES (${pgPlaceholders}) 
    ON CONFLICT (major_id, study_semester_id, study_session_type_id, teaching_group_id) 
    DO UPDATE SET hourly_volume = EXCLUDED.hourly_volume
    RETURNING major_hourly_volume_by_session_type_id
  `, values)
  const newId = res.data?.[0]?.MAJOR_HOURLY_VOLUME_BY_SESSION_TYPE_ID

  return { ...volumeData, MAJOR_HOURLY_VOLUME_BY_SESSION_TYPE_ID: newId }
}

export async function updateMajorHourlyVolumeBySessionType(majorId, semesterId, sessionTypeId, teachingGroupId, volumeData) {
  await assertSessionTypeTargetFits(majorId, semesterId, sessionTypeId, teachingGroupId, volumeData.HOURLY_VOLUME)

  const pgSets = Object.keys(volumeData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(volumeData), majorId, semesterId, sessionTypeId, teachingGroupId]

  await query(`
    UPDATE major_hourly_volume_by_session_type 
    SET ${pgSets} 
    WHERE major_id = $${Object.keys(volumeData).length + 1} 
      AND study_semester_id = $${Object.keys(volumeData).length + 2} 
      AND study_session_type_id = $${Object.keys(volumeData).length + 3} 
      AND teaching_group_id = $${Object.keys(volumeData).length + 4}
  `, values)

  return { ...volumeData, MAJOR_ID: majorId, STUDY_SEMESTER_ID: semesterId, STUDY_SESSION_TYPE_ID: sessionTypeId, TEACHING_GROUP_ID: teachingGroupId }
}

export async function deleteMajorHourlyVolumeBySessionType(majorId, semesterId, sessionTypeId, teachingGroupId) {
  await query(`
    DELETE FROM major_hourly_volume_by_session_type 
    WHERE major_id = $1 AND study_semester_id = $2 AND study_session_type_id = $3 AND teaching_group_id = $4
  `, [majorId, semesterId, sessionTypeId, teachingGroupId])

  return { success: true }
}

// Teaching Section Hourly Volume
export async function getTeachingSectionHourlyVolumes(sectionId, majorId, semesterId) {
  let sql = `
    SELECT tshv.*, s.section_label_en, s.section_label_ar, s.section_label_fr, m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR, sem.study_semester_label_en, sem.study_semester_label_ar, sem.study_semester_label_fr
    FROM teaching_section_hourly_volume tshv
    LEFT JOIN section s ON tshv.SECTION_ID = s.SECTION_ID
    LEFT JOIN major m ON tshv.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN study_semester sem ON tshv.STUDY_SEMESTER_ID = sem.STUDY_SEMESTER_ID
  `
  const params = []

  if (sectionId && majorId && semesterId) {
    sql += ` WHERE tshv.SECTION_ID = $1 AND tshv.MAJOR_ID = $2 AND tshv.STUDY_SEMESTER_ID = $3`
    params.push(sectionId, majorId, semesterId)
  } else if (sectionId && majorId) {
    sql += ` WHERE tshv.SECTION_ID = $1 AND tshv.MAJOR_ID = $2`
    params.push(sectionId, majorId)
  } else if (sectionId) {
    sql += ` WHERE tshv.SECTION_ID = $1`
    params.push(sectionId)
  } else if (majorId && semesterId) {
    sql += ` WHERE tshv.MAJOR_ID = $1 AND tshv.STUDY_SEMESTER_ID = $2`
    params.push(majorId, semesterId)
  } else if (majorId) {
    sql += ` WHERE tshv.MAJOR_ID = $1`
    params.push(majorId)
  } else if (semesterId) {
    sql += ` WHERE tshv.STUDY_SEMESTER_ID = $1`
    params.push(semesterId)
  }

  sql += ` ORDER BY sem.STUDY_SEMESTER_CODE, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), s.section_label_en, s.section_label_ar, s.section_label_fr`
  return await query(sql, params)
}

export async function createTeachingSectionHourlyVolume(volumeData) {
  const columns = Object.keys(volumeData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(volumeData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(volumeData)

  const res = await query(`
    INSERT INTO teaching_section_hourly_volume (${columns}) VALUES (${pgPlaceholders}) 
    ON CONFLICT (section_id, major_id, study_semester_id) DO UPDATE SET hourly_volume = EXCLUDED.hourly_volume
    RETURNING teaching_section_hourly_volume_id
  `, values)
  const newId = res.data?.[0]?.TEACHING_SECTION_HOURLY_VOLUME_ID

  return { ...volumeData, TEACHING_SECTION_HOURLY_VOLUME_ID: newId }
}

export async function updateTeachingSectionHourlyVolume(sectionId, majorId, semesterId, volumeData) {
  const pgSets = Object.keys(volumeData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(volumeData), sectionId, majorId, semesterId]

  await query(`
    UPDATE teaching_section_hourly_volume 
    SET ${pgSets} 
    WHERE section_id = $${Object.keys(volumeData).length + 1} 
      AND major_id = $${Object.keys(volumeData).length + 2} 
      AND study_semester_id = $${Object.keys(volumeData).length + 3}
  `, values)

  return { ...volumeData, SECTION_ID: sectionId, MAJOR_ID: majorId, STUDY_SEMESTER_ID: semesterId }
}

export async function deleteTeachingSectionHourlyVolume(sectionId, majorId, semesterId) {
  await query('DELETE FROM teaching_section_hourly_volume WHERE section_id = $1 AND major_id = $2 AND study_semester_id = $3', [sectionId, majorId, semesterId])
  return { success: true }
}

export async function getTeachingGroupHourlyProgress(teachingGroupId, majorId, semesterId) {
  const volumeResult = await query(
    'SELECT HOURLY_VOLUME FROM major_hourly_volume WHERE MAJOR_ID = $1 AND STUDY_SEMESTER_ID = $2 AND TEACHING_GROUP_ID = $3',
    [majorId, semesterId, teachingGroupId]
  )
  const targetVolume = volumeResult.data?.[0]?.HOURLY_VOLUME || 0

  const sessionsResult = await query(`
    SELECT s.STUDY_SESSION_START_TIME, s.STUDY_SESSION_END_TIME
    FROM study_session s
    JOIN study_day d ON s.STUDY_DAY_ID = d.STUDY_DAY_ID
    JOIN study_week w ON d.STUDY_WEEK_ID = w.STUDY_WEEK_ID
    WHERE s.TEACHING_GROUP_ID = $1 AND s.MAJOR_ID = $2 AND w.STUDY_SEMESTER_ID = $3
  `, [teachingGroupId, majorId, semesterId])

  let actualHours = 0
  for (const session of sessionsResult.data || []) {
    const [startH, startM] = (session.STUDY_SESSION_START_TIME || '00:00').split(':').map(Number)
    const [endH, endM] = (session.STUDY_SESSION_END_TIME || '00:00').split(':').map(Number)
    const duration = (endH * 60 + endM - startH * 60 - startM) / 60
    actualHours += duration
  }

  return {
    teachingGroupId,
    majorId,
    semesterId,
    targetVolume,
    actualHours: Math.round(actualHours * 100) / 100,
    progress: targetVolume > 0 ? Math.round((actualHours / targetVolume) * 100) : 0,
    remainingHours: Math.max(0, targetVolume - actualHours)
  }
}

// Student Section Assignments
export async function getStudentSections(userId, personId) {
  // Sections are student data: outside a secretary's categories there is
  // nothing to read.
  await assertStudentAllowed(await loadScope(userId), personId)

  return await query(`
    SELECT s.*, ss.PERSON_ID, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr
    FROM student_section ss
    JOIN section s ON ss.SECTION_ID = s.SECTION_ID
    LEFT JOIN teaching_category tc ON s.TEACHING_CATEGORY_ID = tc.TEACHING_CATEGORY_ID
    WHERE ss.PERSON_ID = $1
    ORDER BY s.section_label_en, s.section_label_ar, s.section_label_fr
  `, [personId])
}

// Every section the student has belonged to, newest first. The open row
// (ENDED_AT IS NULL) is the placement they hold now; earlier rows are the
// history the section editor shows beneath the picker.
export async function getStudentSectionHistory(userId, personId) {
  await assertStudentAllowed(await loadScope(userId), personId)

  return await query(`
    SELECT h.student_section_history_id, h.section_id, h.started_at, h.ended_at,
           s.section_label_en, s.section_label_ar, s.section_label_fr, s.section_code, s.teaching_category_id,
           tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr
    FROM student_section_history h
    LEFT JOIN section s ON s.section_id = h.section_id
    LEFT JOIN teaching_category tc ON tc.teaching_category_id = s.teaching_category_id
    WHERE h.person_id = $1
    ORDER BY h.started_at DESC, h.student_section_history_id DESC
  `, [personId])
}

export async function getSectionStudents(sectionId) {
  return await query(`
    SELECT p.*, ss.SECTION_ID
    FROM student_section ss
    JOIN v_person p ON ss.PERSON_ID = p.PERSON_ID
    WHERE ss.SECTION_ID = $1 AND p.IS_STUDENT = TRUE
    ORDER BY p.PERSON_LAST_NAME, p.PERSON_FIRST_NAME
  `, [sectionId])
}

export async function assignStudentToSection(userId, personId, sectionId) {
  const scope = await loadScope(userId)
  await assertStudentAllowed(scope, personId)
  await assertSectionsAllowed(scope, [sectionId])

  // The enrollment row is the placement; student_section_history opens when it
  // begins (trigger) and the teaching category is read through the open row.
  await query('INSERT INTO student_section (person_id, section_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [personId, sectionId])
  return { success: true, PERSON_ID: personId, SECTION_ID: sectionId }
}

export async function removeStudentFromSection(userId, personId, sectionId) {
  const scope = await loadScope(userId)
  await assertStudentAllowed(scope, personId)
  // Removing the section would leave the student with no teaching category,
  // which puts them outside every secretary's scope. Only an admin may do that.
  if (scope.restricted) {
    throw new Error('Not allowed: a student must keep a section inside the teaching categories you are responsible for. Ask an administrator to unassign them.')
  }

  await query('DELETE FROM student_section WHERE person_id = $1 AND section_id = $2', [personId, sectionId])
  return { success: true }
}

export async function updateStudentSections(userId, personId, sectionIds) {
  const scope = await loadScope(userId)
  await assertStudentAllowed(scope, personId)
  const sections = (sectionIds || []).filter(Boolean)
  // A restricted account must not orphan a student: with no section the student
  // has no teaching category and falls outside every secretary's scope.
  if (scope.restricted && sections.length === 0) {
    throw new Error('Not allowed: a student must keep a section inside the teaching categories you are responsible for. Move them to another of your sections instead.')
  }
  if (sections.length > 0) await assertSectionsAllowed(scope, sections)

  await query('DELETE FROM student_section WHERE person_id = $1', [personId])

  for (const sectionId of sectionIds || []) {
    await query('INSERT INTO student_section (person_id, section_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [personId, sectionId])
  }

  // Nothing is copied onto student_detail: the enrollment rows are the record,
  // and student_section_history keeps which one is current.
  return { success: true }
}

// Teaching-group roster functions
export async function getStudentsInTeachingGroup(majorId, semesterId, teachingGroupId) {
  return await query(`
    SELECT p.PERSON_ID, p.PERSON_FIRST_NAME, p.PERSON_LAST_NAME,
           s.SECTION_ID, s.section_label_en, s.section_label_ar, s.section_label_fr, s.SECTION_CODE,
           sdg.MAJOR_ID, sdg.STUDY_SEMESTER_ID, sdg.TEACHING_GROUP_ID
    FROM student_dynamic_group_by_major sdg
    JOIN v_person p ON sdg.PERSON_ID = p.PERSON_ID
    LEFT JOIN student_section ss ON ss.PERSON_ID = p.PERSON_ID
    LEFT JOIN section s ON ss.SECTION_ID = s.SECTION_ID
    WHERE sdg.MAJOR_ID = $1 AND sdg.STUDY_SEMESTER_ID = $2 AND sdg.TEACHING_GROUP_ID = $3 AND p.IS_STUDENT = TRUE
    ORDER BY p.PERSON_LAST_NAME, p.PERSON_FIRST_NAME
  `, [majorId, semesterId, teachingGroupId])
}

export async function addStudentToTeachingGroup(personId, majorId, semesterId, teachingGroupId) {
  await query(`
    INSERT INTO student_dynamic_group_by_major (person_id, major_id, study_semester_id, teaching_group_id) 
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (person_id, major_id, study_semester_id, teaching_group_id) DO NOTHING
  `, [personId, majorId, semesterId, teachingGroupId])

  return { success: true, PERSON_ID: personId, MAJOR_ID: majorId, STUDY_SEMESTER_ID: semesterId, TEACHING_GROUP_ID: teachingGroupId }
}

export async function removeStudentFromTeachingGroup(personId, majorId, semesterId, teachingGroupId) {
  await query(
    'DELETE FROM student_dynamic_group_by_major WHERE person_id = $1 AND major_id = $2 AND study_semester_id = $3 AND teaching_group_id = $4',
    [personId, majorId, semesterId, teachingGroupId]
  )

  return { success: true }
}

export async function updateTeachingGroupRoster(majorId, semesterId, teachingGroupId, personIds) {
  await query(
    'DELETE FROM student_dynamic_group_by_major WHERE major_id = $1 AND study_semester_id = $2 AND teaching_group_id = $3',
    [majorId, semesterId, teachingGroupId]
  )

  for (const personId of personIds || []) {
    await query(`
      INSERT INTO student_dynamic_group_by_major (person_id, major_id, study_semester_id, teaching_group_id) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (person_id, major_id, study_semester_id, teaching_group_id) DO NOTHING
    `, [personId, majorId, semesterId, teachingGroupId])
  }

  return { success: true }
}

export async function getTeachingGroupsForStudent(userId, personId) {
  await assertStudentAllowed(await loadScope(userId), personId)

  return await query(`
    SELECT sdg.MAJOR_ID, sdg.STUDY_SEMESTER_ID, sdg.TEACHING_GROUP_ID,
           m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR, m.MAJOR_CODE,
           sem.study_semester_label_en, sem.study_semester_label_ar, sem.study_semester_label_fr, sem.STUDY_SEMESTER_CODE,
           tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr, tg.TEACHING_GROUP_CODE
    FROM student_dynamic_group_by_major sdg
    JOIN major m ON sdg.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN study_semester sem ON sdg.STUDY_SEMESTER_ID = sem.STUDY_SEMESTER_ID
    JOIN teaching_group tg ON sdg.TEACHING_GROUP_ID = tg.TEACHING_GROUP_ID
    WHERE sdg.PERSON_ID = $1
    ORDER BY COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), sem.STUDY_SEMESTER_CODE, tg.teaching_group_label_en, tg.teaching_group_label_ar, tg.teaching_group_label_fr
  `, [personId])
}

// ---- Major semester factors --------------------------------------------------
// How heavily a major counts when averaging a student's semester mark across
// their majors, per semester. A missing row means factor 1 (unweighted).

export async function getMajorSemesterFactors(semesterId) {
  let sql = `
    SELECT msf.MAJOR_ID, msf.STUDY_SEMESTER_ID, msf.MAJOR_SEMESTER_FACTOR,
           m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR, m.MAJOR_CODE,
           s.study_semester_label_en, s.study_semester_label_ar, s.study_semester_label_fr
    FROM major_semester_factor msf
    JOIN major m ON m.MAJOR_ID = msf.MAJOR_ID
    LEFT JOIN study_semester s ON s.STUDY_SEMESTER_ID = msf.STUDY_SEMESTER_ID
  `
  const params = []
  if (semesterId) {
    params.push(semesterId)
    sql += ` WHERE msf.STUDY_SEMESTER_ID = $1`
  }
  sql += ` ORDER BY COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr)`
  return await query(sql, params)
}

// Administrative departments, each under its direction (department.direction_id
// is NOT NULL) and responsible for one major category. A person who holds the
// TEACHER role is assigned one of these: the assignment lives on the active
// person_has_role row, so a department is only ever attached to a teaching role.
export async function getDepartments() {
  return await query(`
    SELECT d.*,
           dir.direction_code,
           dir.direction_label_en,
           dir.direction_label_ar,
           dir.direction_label_fr,
           mc.major_category_code,
           mc.major_category_label_en,
           mc.major_category_label_ar,
           mc.major_category_label_fr,
           (SELECT count(*)::int
              FROM person_has_role phr
             WHERE phr.department_id = d.department_id
               AND phr.role_end_date IS NULL) AS TEACHER_COUNT
      FROM department d
      JOIN direction dir ON dir.direction_id = d.direction_id
      LEFT JOIN major_category mc ON mc.major_category_id = d.major_category_id
     ORDER BY dir.direction_label_en, dir.direction_label_ar, dir.direction_label_fr,
              d.department_label_en, d.department_label_ar, d.department_label_fr
  `)
}

// Directions, the level above departments. department.direction_id is NOT NULL,
// so a direction can only be removed once nothing sits under it.
export async function getDirections() {
  return await query(`
    SELECT dir.*,
           (SELECT count(*)::int
              FROM department d
             WHERE d.direction_id = dir.direction_id) AS DEPARTMENT_COUNT
      FROM direction dir
     ORDER BY dir.direction_label_en, dir.direction_label_ar, dir.direction_label_fr
  `)
}

// Both registers are edited from Settings, so the payload is written column by
// column rather than spread into the SQL: the renderer sends the same keys it
// displays, and a key that is not a real column is ignored instead of becoming
// part of the statement.
const DIRECTION_COLUMNS = ['direction_code', 'direction_label_en', 'direction_label_ar', 'direction_label_fr']
const DEPARTMENT_COLUMNS = ['direction_id', 'major_category_id', 'department_code', 'department_label_en', 'department_label_ar', 'department_label_fr']

function registerPayload(data, columns) {
  const payload = {}
  for (const [rawKey, value] of Object.entries(data || {})) {
    const key = rawKey.toLowerCase()
    if (!columns.includes(key)) continue
    payload[key] = value === '' ? null : value
  }
  return payload
}

function requireRegisterText(data, key, message) {
  if (!String(data[key] ?? '').trim()) throw new Error(message)
}

export async function createDirection(directionData) {
  const data = registerPayload(directionData, DIRECTION_COLUMNS)
  requireRegisterText(data, 'direction_code', 'A code is required.')
  requireRegisterText(data, 'direction_label_en', 'The English label is required.')

  const keys = Object.keys(data)
  const res = await query(
    `INSERT INTO direction (${keys.join(', ')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING direction_id`,
    Object.values(data)
  )
  return { ...data, DIRECTION_ID: res.data?.[0]?.DIRECTION_ID }
}

export async function updateDirection(id, directionData) {
  const data = registerPayload(directionData, DIRECTION_COLUMNS)
  requireRegisterText(data, 'direction_code', 'A code is required.')
  requireRegisterText(data, 'direction_label_en', 'The English label is required.')

  const keys = Object.keys(data)
  await query(
    `UPDATE direction SET ${keys.map((key, i) => `${key} = $${i + 1}`).join(', ')}
      WHERE direction_id = $${keys.length + 1}`,
    [...Object.values(data), id]
  )
  return { ...data, DIRECTION_ID: id }
}

export async function deleteDirection(id) {
  const used = await query('SELECT count(*)::int AS n FROM department WHERE direction_id = $1', [id])
  const count = Number(used.data?.[0]?.N) || 0
  if (count > 0) {
    throw new Error(
      count === 1
        ? 'This direction still has a department. Move it to another direction or delete it first.'
        : `This direction still has ${count} departments. Move them to another direction or delete them first.`
    )
  }
  await query('DELETE FROM direction WHERE direction_id = $1', [id])
  return { success: true }
}

export async function createDepartment(departmentData) {
  const data = registerPayload(departmentData, DEPARTMENT_COLUMNS)
  if (!data.direction_id) throw new Error('A direction is required.')
  if (!data.major_category_id) throw new Error('A major category is required.')
  requireRegisterText(data, 'department_code', 'A code is required.')
  requireRegisterText(data, 'department_label_en', 'The English label is required.')

  const category = await query(
    'SELECT 1 FROM major_category WHERE major_category_id = $1',
    [data.major_category_id]
  )
  if (category.rowCount === 0) throw new Error('That major category no longer exists.')

  const keys = Object.keys(data)
  const res = await query(
    `INSERT INTO department (${keys.join(', ')})
     VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
     RETURNING department_id`,
    Object.values(data)
  )
  return { ...data, DEPARTMENT_ID: res.data?.[0]?.DEPARTMENT_ID }
}

export async function updateDepartment(id, departmentData) {
  const data = registerPayload(departmentData, DEPARTMENT_COLUMNS)
  if (!data.direction_id) throw new Error('A direction is required.')
  if (!data.major_category_id) throw new Error('A major category is required.')
  requireRegisterText(data, 'department_code', 'A code is required.')
  requireRegisterText(data, 'department_label_en', 'The English label is required.')

  const category = await query(
    'SELECT 1 FROM major_category WHERE major_category_id = $1',
    [data.major_category_id]
  )
  if (category.rowCount === 0) throw new Error('That major category no longer exists.')

  const keys = Object.keys(data)
  await query(
    `UPDATE department SET ${keys.map((key, i) => `${key} = $${i + 1}`).join(', ')}
      WHERE department_id = $${keys.length + 1}`,
    [...Object.values(data), id]
  )
  return { ...data, DEPARTMENT_ID: id }
}

export async function deleteDepartment(id) {
  // person_has_role.department_id is ON DELETE SET NULL, so a teacher assigned
  // here simply loses the assignment; their TEACHER role row stays.
  await query('DELETE FROM department WHERE department_id = $1', [id])
  return { success: true }
}

// Save the factor of ONE major for ONE semester. Passing a null/empty factor
// deletes the row (back to the implicit default of 1).
export async function setMajorSemesterFactor(majorId, semesterId, factor) {
  if (!majorId || !semesterId) {
    throw new Error('A major and a semester must be selected to define a factor.')
  }
  if (factor === null || factor === undefined || String(factor).trim() === '') {
    await query(
      'DELETE FROM major_semester_factor WHERE major_id = $1 AND study_semester_id = $2',
      [majorId, semesterId]
    )
    return { majorId, semesterId, factor: null, deleted: true }
  }
  const n = Number(String(factor).trim().replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid factor "${factor}": enter a positive number, or leave the field empty to reset to the default weight (1).`)
  }
  const value = Math.round(n * 100) / 100
  await query(
    `INSERT INTO major_semester_factor (major_id, study_semester_id, major_semester_factor)
     VALUES ($1, $2, $3)
     ON CONFLICT (major_id, study_semester_id) DO UPDATE SET major_semester_factor = EXCLUDED.major_semester_factor`,
    [majorId, semesterId, value]
  )
  return { majorId, semesterId, factor: value, deleted: false }
}
