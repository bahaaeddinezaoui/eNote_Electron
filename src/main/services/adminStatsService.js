import { query } from '../db'

// Admin statistics: institution-wide counts plus semester-scoped analytics
// (per-person semester averages, mark distribution, absences, gender split,
// students per major, top performers). Everything a chart needs is computed
// server-side in a handful of queries and returned as plain rows.

// Same two-level weighted computation as examinationService.getSemesterMarks:
//   major mark = exam-factor-weighted average of the student's exam marks
//   semester mark = major-factor-weighted average of the major marks
const SEMESTER_MARKS_SQL = `
  WITH exam_weights AS (
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
  )
  SELECT sm.PERSON_ID,
         p.PERSON_FIRST_NAME_LA AS PERSON_FIRST_NAME,
         p.PERSON_FIRST_NAME_LA, p.PERSON_FIRST_NAME_AR,
         p.PERSON_LAST_NAME_LA AS PERSON_LAST_NAME,
         p.PERSON_LAST_NAME_LA, p.PERSON_LAST_NAME_AR,
         sm.SEMESTER_MARK,
         sm.GRADED_MAJORS
  FROM semester_marks sm
  JOIN person p ON p.PERSON_ID = sm.PERSON_ID
  ORDER BY sm.SEMESTER_MARK DESC NULLS LAST, p.PERSON_LAST_NAME_LA, p.PERSON_FIRST_NAME_LA`

export async function getAdminStatistics(semesterId) {
  // ---- Institution-wide counts (not semester-scoped) ----
  const countOf = async (sql) => {
    try {
      const res = await query(sql)
      const v = res.data?.[0]
      return parseInt(Object.values(v ?? {})[0] ?? 0, 10) || 0
    } catch (err) {
      console.warn('adminStats count failed:', err.message)
      return 0
    }
  }

  const [
    totalStudents,
    totalTeachers,
    totalMajors,
    totalClassrooms,
    totalExams,
    totalSessions,
    totalAbsences
  ] = await Promise.all([
    countOf('SELECT COUNT(*) FROM v_person WHERE is_student = TRUE'),
    countOf('SELECT COUNT(*) FROM v_person WHERE is_teacher = TRUE'),
    countOf('SELECT COUNT(*) FROM major'),
    countOf('SELECT COUNT(*) FROM classroom'),
    countOf('SELECT COUNT(*) FROM examination'),
    countOf('SELECT COUNT(*) FROM study_session'),
    countOf('SELECT COUNT(*) FROM student_gets_absent')
  ])

  const counts = {
    totalStudents,
    totalTeachers,
    totalMajors,
    totalClassrooms,
    totalExams,
    totalSessions,
    totalAbsences
  }

  // ---- Gender split (students) ----
  let genderSplit = []
  try {
    const res = await query(
      `SELECT COALESCE(NULLIF(person_sex, ''), 'Unknown') AS SEX, COUNT(*) AS CNT
       FROM v_person WHERE is_student = TRUE
       GROUP BY person_sex ORDER BY CNT DESC`
    )
    genderSplit = (res.data || []).map(r => ({ label: r.SEX, value: parseInt(r.CNT, 10) }))
  } catch (err) {
    console.warn('adminStats gender failed:', err.message)
  }

  // ---- Absences by justification ----
  let absencesByJustification = []
  try {
    const res = await query(
      `SELECT COALESCE(j.absence_justification_label_en, j.absence_justification_label_ar, j.absence_justification_label_fr) AS LABEL, j.absence_justification_label_en AS LABEL_en, j.absence_justification_label_ar AS LABEL_ar, j.absence_justification_label_fr AS LABEL_fr,
              j.ABSENCE_JUSTIFICATION_LABEL_AR AS LABEL_AR,
              j.ABSENCE_JUSTIFICATION_LABEL_FR AS LABEL_FR,
              COUNT(*) AS CNT
       FROM student_gets_absent a
       JOIN absence_justification j ON j.ABSENCE_JUSTIFICATION_ID = a.ABSENCE_JUSTIFICATION_ID
       GROUP BY j.absence_justification_label_en, j.absence_justification_label_ar, j.absence_justification_label_fr, j.ABSENCE_JUSTIFICATION_LABEL_AR, j.ABSENCE_JUSTIFICATION_LABEL_FR
       ORDER BY CNT DESC`
    )
    absencesByJustification = (res.data || []).map(r => ({
      label: r.LABEL,
      value: parseInt(r.CNT, 10)
    }))
  } catch (err) {
    console.warn('adminStats absences failed:', err.message)
  }

  // ---- Punishments and rewards by justification ----
  // Every conduct entry is filed with the reason it was recorded, so the same
  // breakdown the absences have is available for both ledgers. Like the absence
  // chart, it covers all time, not one semester.
  const byJustification = async ({ table, idColumn, justificationTable, justificationColumn }) => {
    try {
      const res = await query(
        `SELECT COALESCE(j.${justificationColumn}_label_en, j.${justificationColumn}_label_ar, j.${justificationColumn}_label_fr) AS LABEL,
                j.${justificationColumn}_label_en AS LABEL_en, j.${justificationColumn}_label_ar AS LABEL_ar, j.${justificationColumn}_label_fr AS LABEL_fr,
                COUNT(*) AS CNT
         FROM ${table} r
         JOIN ${justificationTable} j ON j.${justificationColumn}_id = r.${idColumn}
         GROUP BY j.${justificationColumn}_label_en, j.${justificationColumn}_label_ar, j.${justificationColumn}_label_fr
         ORDER BY CNT DESC, COALESCE(j.${justificationColumn}_label_en, j.${justificationColumn}_label_ar, j.${justificationColumn}_label_fr)`
      )
      return (res.data || []).map(r => ({ label: r.LABEL, value: parseInt(r.CNT, 10) }))
    } catch (err) {
      console.warn(`adminStats ${table} by justification failed:`, err.message)
      return []
    }
  }

  const [punishmentsByJustification, rewardsByJustification] = await Promise.all([
    byJustification({
      table: 'secretary_punishes_student',
      idColumn: 'punishment_justification_id',
      justificationTable: 'punishment_justification',
      justificationColumn: 'punishment_justification'
    }),
    byJustification({
      table: 'secretary_rewards_student',
      idColumn: 'reward_justification_id',
      justificationTable: 'reward_justification',
      justificationColumn: 'reward_justification'
    })
  ])

  // ---- Everything below needs a semester ----
  if (!semesterId) {
    return {
      counts,
      genderSplit,
      absencesByJustification,
      punishmentsByJustification,
      rewardsByJustification,
      semesterScoped: false,
      overallAverage: null,
      passRate: null,
      gradedStudents: 0,
      markDistribution: [],
      studentsPerMajor: [],
      topStudents: [],
      personAverages: []
    }
  }

  // ---- Per-person semester averages (also feeds overall average / top 5) ----
  let personAverages = []
  try {
    const res = await query(SEMESTER_MARKS_SQL, [semesterId])
    personAverages = (res.data || []).map(r => ({
      PERSON_ID: r.PERSON_ID,
      PERSON_FIRST_NAME: r.PERSON_FIRST_NAME,
      PERSON_LAST_NAME: r.PERSON_LAST_NAME,
      SEMESTER_MARK: r.SEMESTER_MARK != null ? Number(r.SEMESTER_MARK) : null,
      GRADED_MAJORS: parseInt(r.GRADED_MAJORS, 10)
    }))
  } catch (err) {
    console.warn('adminStats semester averages failed:', err.message)
  }

  const graded = personAverages.filter(r => r.SEMESTER_MARK != null)
  const overallAverage = graded.length > 0
    ? graded.reduce((acc, r) => acc + r.SEMESTER_MARK, 0) / graded.length
    : null
  const passRate = graded.length > 0
    ? (graded.filter(r => r.SEMESTER_MARK >= 10).length / graded.length) * 100
    : null

  // ---- Exam mark distribution (0–5, 5–10, 10–15, 15–20) ----
  let markDistribution = []
  try {
    const res = await query(
      `SELECT CASE
                WHEN phe.FINAL_MARK < 5 THEN '0–5'
                WHEN phe.FINAL_MARK < 10 THEN '5–10'
                WHEN phe.FINAL_MARK < 15 THEN '10–15'
                ELSE '15–20'
              END AS BUCKET,
              COUNT(*) AS CNT
       FROM person_has_examination phe
       JOIN examination e ON e.EXAMINATION_ID = phe.EXAMINATION_ID
       WHERE e.STUDY_SEMESTER_ID = $1 AND phe.FINAL_MARK IS NOT NULL
       GROUP BY BUCKET`,
      [semesterId]
    )
    const byBucket = Object.fromEntries((res.data || []).map(r => [r.BUCKET, parseInt(r.CNT, 10)]))
    markDistribution = ['0–5', '5–10', '10–15', '15–20'].map(b => ({
      label: b,
      value: byBucket[b] || 0
    }))
  } catch (err) {
    console.warn('adminStats distribution failed:', err.message)
  }

  // ---- Students per major (teaching-group enrollment this semester) ----
  let studentsPerMajor = []
  try {
    const res = await query(
      `SELECT COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr) AS LABEL,
              m.MAJOR_LABEL_AR AS LABEL_AR,
              m.MAJOR_LABEL_FR AS LABEL_FR,
              COUNT(DISTINCT s.PERSON_ID) AS CNT
       FROM student_dynamic_group_by_major s
       JOIN major m ON m.MAJOR_ID = s.MAJOR_ID
       WHERE s.STUDY_SEMESTER_ID = $1
       GROUP BY COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr), m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR
       ORDER BY CNT DESC, COALESCE(m.major_label_en, m.major_label_ar, m.major_label_fr)`,
      [semesterId]
    )
    studentsPerMajor = (res.data || []).map(r => ({
      label: r.LABEL,
      value: parseInt(r.CNT, 10)
    }))
  } catch (err) {
    console.warn('adminStats studentsPerMajor failed:', err.message)
  }

  return {
    counts,
    genderSplit,
    absencesByJustification,
    punishmentsByJustification,
    rewardsByJustification,
    semesterScoped: true,
    overallAverage,
    passRate,
    gradedStudents: graded.length,
    markDistribution,
    studentsPerMajor,
    topStudents: graded.slice(0, 5),
    personAverages
  }
}
