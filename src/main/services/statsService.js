import { query } from '../db'

export async function getDashboardStats() {
  try {
    const studentsResult = await query('SELECT COUNT(*) as count FROM v_person WHERE IS_STUDENT = TRUE')
    const totalStudents = parseInt(studentsResult.data?.[0]?.COUNT || studentsResult.data?.[0]?.count || 0, 10)

    const coursesResult = await query('SELECT COUNT(*) as count FROM major')
    const activeCourses = parseInt(coursesResult.data?.[0]?.COUNT || coursesResult.data?.[0]?.count || 0, 10)

    let pendingExams = 0
    try {
      const examsResult = await query("SELECT COUNT(*) as count FROM examination WHERE examination_start_datetime > CURRENT_TIMESTAMP")
      pendingExams = parseInt(examsResult.data?.[0]?.COUNT || examsResult.data?.[0]?.count || 0, 10)
    } catch (err) {
      console.warn('Error fetching pending exams:', err.message)
    }

    return {
      totalStudents,
      activeCourses,
      pendingExams
    }
  } catch (error) {
    console.error('Error fetching dashboard stats:', error)
    throw error
  }
}
