import { query } from '../db'

// The time-based notification detectors.
//
// Some news has no single write behind it: an examination that ended three days
// ago with no marks entered, a student who has now missed three classes, a
// teacher whose week went unregistered. Those are truths that become true with
// the passage of time, so the database owns the question (one function per
// kind, see migration_notification_kinds.sql) and this module asks it on a
// timer.
//
// Every detector is idempotent: each row carries a record key built from the
// record and the period it describes (MARKS_MISSING:<examination>, 
// ABSENCE_THRESHOLD:<student>:<semester>, ATTENDANCE_DIGEST:<person>:<week>), so
// running the scans hourly updates nothing and duplicates nothing.
//
// As with the attendance scans, the application passes its own clock: the
// schedule and the dates it compares are local wall-clock values, while the
// database server may well be in UTC.

// 'YYYY-MM-DD HH:MM:SS' in the application's own time zone.
function formatDbTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// An examination is "quiet" for a few days before anybody is chased: the marks
// may simply not have been entered yet on the day of the exam.
const MARKS_GRACE_DAYS = 3
const MARKS_ESCALATE_DAYS = 7

// Three absences in a semester.
const ABSENCE_THRESHOLD = 3

// A weekly digest, and the rate that makes a week worth a director's attention.
const SUMMARY_LOOKBACK_DAYS = 7
const SUMMARY_RATE_THRESHOLD = 0.8
const SUMMARY_MIN_SESSIONS = 3

export async function scanMissingExamMarks({ now = new Date() } = {}) {
  const res = await query(
    'SELECT app_notify_missing_exam_marks($1::timestamp, $2::int, $3::int, 40) AS reported',
    [formatDbTimestamp(now), MARKS_GRACE_DAYS, MARKS_ESCALATE_DAYS]
  )
  return { success: true, reported: res.data?.[0]?.REPORTED || 0 }
}

export async function scanAbsenceThresholds({ now = new Date() } = {}) {
  const res = await query(
    'SELECT app_notify_absence_thresholds($1::timestamp, $2::int, 40) AS reported',
    [formatDbTimestamp(now), ABSENCE_THRESHOLD]
  )
  return { success: true, reported: res.data?.[0]?.REPORTED || 0 }
}

export async function scanTeacherAttendanceSummary({ now = new Date() } = {}) {
  const res = await query(
    'SELECT app_notify_teacher_attendance_summary($1::timestamp, $2::int, $3::numeric, $4::int, 60) AS reported',
    [formatDbTimestamp(now), SUMMARY_LOOKBACK_DAYS, SUMMARY_RATE_THRESHOLD, SUMMARY_MIN_SESSIONS]
  )
  return { success: true, reported: res.data?.[0]?.REPORTED || 0 }
}

// A class added to a teacher's week. The schedule page shows it, but nothing
// told the person who now has to be there: the database triggers announce a
// session that moves or is cancelled, not one that appears. Written here from
// the ids the insert just returned, because the caller already has them.
//
// The key is the session and the teacher, so re-saving the same session does not
// announce it twice.
export async function notifySessionAssigned({ sessionId, instructorPersonId }) {
  const session = parseInt(sessionId, 10)
  const instructor = parseInt(instructorPersonId, 10)
  if (!session || !instructor) return { success: false }

  await query(
    `WITH slot AS (
       SELECT d.study_day_date,
              to_char(s.study_session_start_time, 'HH24:MI') AS start_time,
              to_char(s.study_session_end_time, 'HH24:MI') AS end_time,
              COALESCE(tg.teaching_group_label_en, tg.teaching_group_label_ar,
                       tg.teaching_group_label_fr) AS group_label
         FROM study_session s
         JOIN study_day d ON d.study_day_id = s.study_day_id
         LEFT JOIN teaching_group tg ON tg.teaching_group_id = s.teaching_group_id
        WHERE s.study_session_id = $1::int
     )
     SELECT app_notification_upsert_person(
       'SESSION_ASSIGNED',
       'SESSION_ASSIGNED:' || $1::int || ':' || $2::bigint,
       'SESSION_ASSIGNED', NULL,
       NULL, NULL, $1::int,
       'Class assigned',
       format('You are scheduled on %s from %s to %s%s.',
              to_char(study_day_date, 'YYYY-MM-DD'), start_time, end_time,
              CASE WHEN group_label IS NOT NULL THEN ' (' || group_label || ')' ELSE '' END),
       jsonb_build_object('session', $1::int, 'date', to_char(study_day_date, 'YYYY-MM-DD')),
       $2::bigint
     )
     FROM slot`,
    [session, instructor]
  )

  return { success: true }
}

// An examination on the calendar is news to the teachers who will have to enter
// its marks; the marks chase only starts three days after it is over, which is
// too late to plan around. One row per teacher of the exam's major, each with
// its own record key so every bell can be read on its own.
export async function notifyExamScheduled({ examinationId }) {
  const id = parseInt(examinationId, 10)
  if (!id) return { success: false }

  await query(
    `WITH sitting AS (
       SELECT e.examination_id, e.major_id,
              COALESCE(e.examination_label_en, e.examination_label_ar,
                       e.examination_label_fr, 'Examination') AS label,
              to_char(e.examination_start_datetime, 'YYYY-MM-DD HH24:MI') AS starts
         FROM examination e
        WHERE e.examination_id = $1::int
     )
     SELECT app_notification_upsert_person(
       'EXAM_SCHEDULED',
       'EXAM_SCHEDULED:' || s.examination_id || ':' || t.person_id::text,
       'EXAM_SCHEDULED', NULL,
       NULL, NULL, NULL,
       'Exam scheduled',
       format('%s is scheduled for %s. Enter the marks once it is over.', s.label, s.starts),
       jsonb_build_object('examination', s.examination_id, 'major', s.major_id),
       t.person_id
     )
     FROM sitting s
     CROSS JOIN app_teachers_of_major(s.major_id) t
     WHERE s.starts IS NOT NULL`,
    [id]
  )

  return { success: true }
}

// A secretary's editable categories are set by an administrator; the secretary
// is the one who has to know their reach changed. Written here rather than by a
// trigger because the event is a whole set (delete + insert), not a row.
export async function notifySecretaryCategoriesChanged(secretaryUserId, categoryLabels) {
  const id = parseInt(secretaryUserId, 10)
  if (!id) return { success: false }

  const labels = (categoryLabels || []).filter(Boolean)
  await query(
    `SELECT app_notification_upsert_person(
       'CATEGORIES_CHANGED',
       'CATEGORIES_CHANGED:' || $1::int || ':' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
       'CATEGORIES_CHANGED', NULL,
       NULL, NULL, NULL,
       'Your editable categories changed',
       $2::text,
       jsonb_build_object('categories', $2::text),
       u.person_id
     )
     FROM "user" u WHERE u.user_id = $1::int`,
    [
      id,
      labels.length
        ? `An administrator set your categories to: ${labels.join(', ')}.`
        : 'An administrator removed every category from your account, so you can no longer edit student records.'
    ]
  )
  return { success: true }
}

// A scheduler's departments are set by an administrator; the scheduler is the
// one who has to know their reach changed. Written here rather than by a trigger
// because the event is a whole set (delete + insert), not a row.
export async function notifySchedulerDepartmentsChanged(schedulerUserId, departmentLabels) {
  const id = parseInt(schedulerUserId, 10)
  if (!id) return { success: false }

  const labels = (departmentLabels || []).filter(Boolean)
  await query(
    `SELECT app_notification_upsert_person(
       'DEPARTMENTS_CHANGED',
       'DEPARTMENTS_CHANGED:' || $1::int || ':' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS'),
       'DEPARTMENTS_CHANGED', NULL,
       NULL, NULL, NULL,
       'Your schedule departments changed',
       $2::text,
       jsonb_build_object('departments', $2::text),
       u.person_id
     )
     FROM "user" u WHERE u.user_id = $1::int`,
    [
      id,
      labels.length
        ? `An administrator set your departments to: ${labels.join(', ')}.`
        : 'An administrator removed every department from your account, so you can no longer schedule sessions.'
    ]
  )
  return { success: true }
}

// A Library submission is waiting for an administrator. One row per active
// administrator (and maintainer), each with its own record key, so every bell
// can be read independently and a review can settle them together. The account
// that uploaded the document is left out: it already knows.
export async function notifyLibraryReviewRequested({ itemId, title, excludeUserId }) {
  const id = parseInt(itemId, 10)
  if (!id) return { success: false }

  const cleanTitle = String(title || '').trim() || 'A document'
  const body = `“${cleanTitle}” is waiting for review. Open the Library to publish it or send it back to its author.`

  await query(
    `SELECT app_notification_upsert_person(
       'LIBRARY_REVIEW_REQUEST',
       'LIBRARY_REVIEW_REQUEST:' || $1::int || ':' || u.person_id::text || ':' ||
         to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS'),
       'LIBRARY_REVIEW_REQUEST', NULL,
       NULL, NULL, NULL,
       'Library review request',
       $2::text,
       jsonb_build_object('document', $3::text, 'status', 'PENDING'),
       u.person_id
     )
     FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE r.role_code = ANY($4::text[])
       AND u.is_active = TRUE
       AND u.person_id IS NOT NULL
       AND ($5::int IS NULL OR u.user_id <> $5::int)`,
    [id, body, cleanTitle, ['ADMIN', 'DEVELOPER'], parseInt(excludeUserId, 10) || null]
  )

  return { success: true }
}

// The document has been decided, taken down or removed: the request is no
// longer pending, so every administrator's copy is settled at once. The rows
// stay on the notifications page as read history.
export async function settleLibraryReviewRequests(itemId) {
  const id = parseInt(itemId, 10)
  if (!id) return { success: false }

  await query(
    `INSERT INTO app_notification_read (notification_id, person_id)
     SELECT n.notification_id, n.audience_person_id
       FROM app_notification n
      WHERE n.notification_type = 'LIBRARY_REVIEW_REQUEST'
        AND n.record_key LIKE $1
        AND n.audience_person_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [`LIBRARY_REVIEW_REQUEST:${id}:%`]
  )

  return { success: true }
}

// A Library submission has been published or sent back. Only its author needs
// the news, so the row is addressed to that person alone. The record key carries
// the decision and its moment, so an approval and a later rejection are two
// separate notifications rather than one overwriting the other.
export async function notifyLibraryReviewDecision({
  itemId,
  title,
  status,
  note,
  authorUserId,
  reviewerUserId
}) {
  const id = parseInt(itemId, 10)
  const author = parseInt(authorUserId, 10)
  if (!id || !author) return { success: false }

  // An administrator reviewing their own upload already knows the answer.
  if (parseInt(reviewerUserId, 10) === author) return { success: true, skipped: true }

  const published = status === 'PUBLISHED'
  const heading = published ? 'Document published' : 'Document sent back'
  const reason = String(note || '').trim()
  const body = published
    ? `Your document “${title}” is now in the Library.${reason ? ` Note from the reviewer: ${reason}` : ''}`
    : `Your document “${title}” was not published. ${reason}`

  await query(
    `SELECT app_notification_upsert_person(
       'LIBRARY_REVIEW',
       'LIBRARY_REVIEW:' || $1::int || ':' ||
         to_char(clock_timestamp(), 'YYYY-MM-DD HH24:MI:SS.MS'),
       'LIBRARY_REVIEW', NULL,
       NULL, NULL, NULL,
       $2::text,
       $3::text,
       jsonb_build_object('document', $4::text, 'status', $5::text, 'note', $6::text),
       u.person_id
     )
     FROM "user" u WHERE u.user_id = $7::int`,
    [id, heading, body, title, status, reason || null, author]
  )

  return { success: true }
}

export {
  MARKS_GRACE_DAYS,
  MARKS_ESCALATE_DAYS,
  ABSENCE_THRESHOLD,
  SUMMARY_LOOKBACK_DAYS,
  SUMMARY_RATE_THRESHOLD
}
