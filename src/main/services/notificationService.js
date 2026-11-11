import { isOffline, query } from '../db'
import { enqueueOutbox } from '../offlineOutbox'
import { FAMILY_IDS, familyOf } from '../../shared/notificationFamilies'

// Notifications, whatever their kind.
//
// app_notification holds one row per event, addressed to a role
// (audience_role_code). app_notification_read holds per-person read state.
// Rows are written by triggers on the source tables — see
// migration_app_notification.sql — so an absence or an observation raises its
// notification the instant it is recorded, and the app hears about it through
// pg_notify('app_notification') without polling.
//
// Kinds that live here: absences and observations addressed to DIRECTOR, missed
// classes (TEACHER_MISSING: a programmed session ended with no attendance taken)
// addressed to the session's own teacher through audience_person_id, plus
// DIRECTOR and ADMIN, the in-class reminder (TEACHER_REMINDER: the session has
// started and still has nothing recorded) addressed to that teacher alone, and
// the two message kinds — a direct message
// (DIRECT_MESSAGE) and inbox mail (INBOX_MESSAGE) addressed to one account. The
// shape returned here is deliberately generic: the flattened fields are
// conveniences for the current screens, while DETAIL carries the event's own
// context (student, class, teacher, session slot, room, sender) for anything
// added later.
//
// A row with audience_person_id set is shown only to that person. A row with no
// role at all (audience_role_code IS NULL) belongs to that person alone and
// ignores their roles, which is how a message reaches its recipient whatever
// roles they hold.
//
// Muting is by family (src/shared/notificationFamilies.js): a muted family is
// still listed here, flagged MUTED, but it does not count towards the unread
// badge and it never rings — the bell, the chime and the desktop popup read that
// flag. Nothing is deleted and nothing is marked read, so unmuting brings the
// waiting items back exactly as they were.

const LIST_CHANNEL = 'app_notification'

// The person behind an account plus the roles that decide what it may receive.
async function loadRecipient(userId) {
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

// Comments are still director-authored (the table says so); broadcasts are not.
async function requireDirector(userId) {
  const me = await loadRecipient(userId)
  if (!me.roles.includes('DIRECTOR')) throw new Error('Not allowed: requires the Director role.')
  return me
}

// Reading a thread is open to the oversight roles: an Admin needs to be able to
// see what was said about a record without joining the conversation, while
// posting and deleting stay director-only above.
const COMMENT_READERS = ['DIRECTOR', 'ADMIN']

async function requireCommentReader(userId) {
  const me = await loadRecipient(userId)
  if (!COMMENT_READERS.some((code) => me.roles.includes(code))) {
    throw new Error('Not allowed: reading comments requires the Director or Admin role.')
  }
  return me
}

const NOTIFICATION_SELECT = `
  SELECT n.notification_id,
         n.notification_type,
         n.record_type,
         n.record_key,
         n.study_session_id,
         n.audience_role_code,
         n.audience_person_id,
         n.title,
         n.body,
         n.detail,
         n.created_at,
         n.created_at AS event_at,
         n.student_person_id AS person_id,
         (r.person_id IS NOT NULL) AS is_read,
         COALESCE(c.comment_count, 0) AS comment_count,
         n.detail->>'student' AS student_name,
         n.detail->>'section' AS section_label,
         n.detail->>'major' AS major_label,
         n.detail->>'group' AS teaching_group_label,
         n.detail->>'classroom' AS classroom_label,
         n.detail->>'teacher' AS instructor_name,
         n.detail->>'sessionType' AS study_session_type_label,
         n.detail->>'date' AS event_date,
         n.detail->>'start' AS start_time,
         n.detail->>'end' AS end_time,
         n.detail->>'justification' AS absence_justification_label,
         n.detail->>'motif' AS observation_motif_label,
         n.detail->>'note' AS record_note,
         n.detail->>'sender' AS sender_name,
         n.detail->>'excerpt' AS message_excerpt,
         n.detail->>'subject' AS message_subject,
         n.detail->>'exam' AS exam_label,
         n.detail->>'version' AS version_label,
         n.detail->>'severity' AS severity,
         n.detail->>'status' AS record_status,
         n.detail->>'document' AS document_label,
         -- The student the record is about, so a list can show their photo.
         student.person_photo AS student_photo
  FROM app_notification n
  LEFT JOIN person student ON student.person_id = n.student_person_id
  LEFT JOIN app_notification_read r
         ON r.notification_id = n.notification_id AND r.person_id = $2
  LEFT JOIN (
    SELECT record_key, count(*)::int AS comment_count
    FROM director_comment
    GROUP BY record_key
  ) c ON c.record_key = n.record_key`

// The families this account has silenced.
async function loadMutedFamilies(userId) {
  const res = await query('SELECT family FROM user_notification_mute WHERE user_id = $1', [userId])
  return new Set((res.data || []).map((row) => row.FAMILY))
}

// Everything addressed to this account's roles, newest first, each flagged
// read/unread and muted/unmuted for this person.
export async function getNotifications(userId) {
  const me = await loadRecipient(userId)
  const muted = await loadMutedFamilies(me.userId)

  const rows = await query(
    `${NOTIFICATION_SELECT}
     WHERE (n.audience_role_code IS NULL OR n.audience_role_code = ANY($1::text[]))
       AND (n.audience_person_id IS NULL OR n.audience_person_id = $2)
     ORDER BY n.created_at DESC, n.notification_id DESC`,
    [me.roles, me.personId]
  )

  const notifications = (rows.data || []).map((row) => {
    const family = familyOf(row.NOTIFICATION_TYPE)
    return { ...row, FAMILY: family, MUTED: muted.has(family) }
  })

  return {
    success: true,
    notifications,
    // A muted family must not make the bell insist.
    unreadCount: notifications.filter(n => n.IS_READ !== true && !n.MUTED).length
  }
}

// Badge count, cheap enough to ask often. Muted families are left out of both
// numbers, so the badge and the page never disagree.
export async function getUnreadCount(userId) {
  const me = await loadRecipient(userId)
  const muted = await loadMutedFamilies(me.userId)

  const res = await query(
    `SELECT n.notification_type,
            count(*)::int AS total,
            count(r.notification_id)::int AS read
       FROM app_notification n
       LEFT JOIN app_notification_read r
              ON r.notification_id = n.notification_id AND r.person_id = $2
      WHERE (n.audience_role_code IS NULL OR n.audience_role_code = ANY($1::text[]))
        AND (n.audience_person_id IS NULL OR n.audience_person_id = $2)
      GROUP BY n.notification_type`,
    [me.roles, me.personId]
  )

  let total = 0
  let unread = 0
  for (const row of res.data || []) {
    if (muted.has(familyOf(row.NOTIFICATION_TYPE))) continue
    total += row.TOTAL
    unread += row.TOTAL - row.READ
  }
  return { success: true, total, unread: Math.max(0, unread) }
}

// ---- Muting a family --------------------------------------------------------

export async function getNotificationPreferences(userId) {
  const me = await loadRecipient(userId)
  const muted = await loadMutedFamilies(me.userId)
  return {
    success: true,
    families: FAMILY_IDS.map((id) => ({ id, muted: muted.has(id) }))
  }
}

export async function setNotificationMute(userId, family, muted) {
  const me = await loadRecipient(userId)
  const id = String(family || '')
  if (!FAMILY_IDS.includes(id)) throw new Error('Unknown notification family.')

  if (muted) {
    await query(
      'INSERT INTO user_notification_mute (user_id, family) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [me.userId, id]
    )
  } else {
    await query('DELETE FROM user_notification_mute WHERE user_id = $1 AND family = $2', [me.userId, id])
  }

  return { success: true, family: id, muted: !!muted }
}

// One notification marked read for this person. Addressed by record key so the
// screens keep using the identity they already display.
export async function markNotificationRead(userId, recordKey) {
  // Read state is per person and lives on the server. Offline the page keeps
  // what it is already showing; nothing is queued, so nothing is claimed as
  // saved when it was not.
  if (isOffline()) return { success: false, offline: true }
  const me = await loadRecipient(userId)
  if (!recordKey) throw new Error('Notification is required.')

  await query(
    `INSERT INTO app_notification_read (notification_id, person_id)
     SELECT n.notification_id, $2
       FROM app_notification n
      WHERE n.record_key = $1
        AND (n.audience_role_code IS NULL OR n.audience_role_code = ANY($3::text[]))
        AND (n.audience_person_id IS NULL OR n.audience_person_id = $2)
     ON CONFLICT DO NOTHING`,
    [String(recordKey), me.personId, me.roles]
  )
  return { success: true }
}

// Marks everything addressed to this person's roles as read.
export async function markAllNotificationsRead(userId) {
  if (isOffline()) return { success: false, offline: true }
  const me = await loadRecipient(userId)

  await query(
    `INSERT INTO app_notification_read (notification_id, person_id)
     SELECT n.notification_id, $2
       FROM app_notification n
      WHERE (n.audience_role_code IS NULL OR n.audience_role_code = ANY($1::text[]))
        AND (n.audience_person_id IS NULL OR n.audience_person_id = $2)
     ON CONFLICT DO NOTHING`,
    [me.roles, me.personId]
  )
  return { success: true }
}

// Reading the message itself settles its notification: the bell is a prompt,
// not a second inbox that has to be cleared by hand. Called by the messaging
// and inbox services when a message is marked seen.
export async function markMessageNotificationsRead(personId, pattern) {
  if (isOffline()) return { success: false, offline: true }
  const person = parseInt(personId, 10)
  if (!person || !pattern) return { success: false }

  await query(
    `INSERT INTO app_notification_read (notification_id, person_id)
     SELECT n.notification_id, $1
       FROM app_notification n
      WHERE n.audience_person_id = $1
        AND n.record_key LIKE $2
     ON CONFLICT DO NOTHING`,
    [person, pattern]
  )
  return { success: true }
}

// ---- Director comments on a notification -----------------------------------

export async function getNotificationComments(userId, recordKey) {
  await requireCommentReader(userId)
  if (!recordKey) throw new Error('Notification is required.')
  return await query(
    `SELECT c.director_comment_id, c.director_person_id, c.record_type, c.record_key,
            c.comment_text, c.created_at,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) || ' ' ||
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS director_name
     FROM director_comment c
     JOIN person p ON p.person_id = c.director_person_id
     WHERE c.record_key = $1
     ORDER BY c.created_at ASC, c.director_comment_id ASC`,
    [String(recordKey)]
  )
}

export async function addNotificationComment(userId, recordKey, commentText) {
  // Offline the comment is held here and posted when the server answers; the
  // director's role is checked again at that moment, not assumed from now.
  if (isOffline()) {
    const queuedKey = String(recordKey || '')
    const queuedText = String(commentText || '').trim()
    if (!queuedText) throw new Error('Comment cannot be empty.')
    if (queuedText.length > 2000) throw new Error('Comment cannot exceed 2000 characters.')

    const id = enqueueOutbox({
      kind: 'notification.comment',
      userId: parseInt(userId, 10) || null,
      additive: true,
      desired: { recordKey: queuedKey, text: queuedText }
    })
    if (!id) {
      throw new Error('The server is unreachable and this computer could not store the comment. Try again.')
    }
    // Shaped like a stored comment so the page can show it as written, marked
    // as not yet on the server.
    return {
      success: true,
      queued: true,
      outboxId: id,
      comment: {
        DIRECTOR_COMMENT_ID: null,
        DIRECTOR_PERSON_ID: null,
        RECORD_TYPE: queuedKey.split(':')[0],
        RECORD_KEY: queuedKey,
        COMMENT_TEXT: queuedText,
        CREATED_AT: new Date().toISOString(),
        DIRECTOR_NAME: null,
        PENDING_LOCAL: true
      }
    }
  }

  const me = await requireDirector(userId)
  const key = String(recordKey || '')
  const recordType = key.split(':')[0]
  if (recordType !== 'ABSENCE' && recordType !== 'OBSERVATION') {
    throw new Error('Unknown notification record.')
  }

  const text = String(commentText || '').trim()
  if (!text) throw new Error('Comment cannot be empty.')
  if (text.length > 2000) throw new Error('Comment cannot exceed 2000 characters.')

  const res = await query(
    `WITH ins AS (
       INSERT INTO director_comment (director_person_id, record_type, record_key, comment_text)
       VALUES ($1, $2, $3, $4)
       RETURNING *
     )
     SELECT ins.director_comment_id, ins.director_person_id, ins.record_type, ins.record_key,
            ins.comment_text, ins.created_at,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) || ' ' ||
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS director_name
     FROM ins JOIN person p ON p.person_id = ins.director_person_id`,
    [me.personId, recordType, key, text]
  )
  return { success: true, comment: res.data?.[0] || null }
}

// A director may remove only their own comment.
export async function deleteNotificationComment(userId, commentId) {
  const me = await requireDirector(userId)
  const res = await query(
    'DELETE FROM director_comment WHERE director_comment_id = $1 AND director_person_id = $2',
    [parseInt(commentId, 10), me.personId]
  )
  return { success: true, deleted: res.rowCount > 0 }
}

export { LIST_CHANNEL }
