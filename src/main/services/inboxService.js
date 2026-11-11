import { isOffline, query, withTransaction } from '../db'
import { markMessageNotificationsRead } from './notificationService'

// One-way internal messages: an admin addresses a message to one or more
// roles, and every active account holding one of those roles receives it.
// Recipients are resolved once, at send time, so later role changes never
// rewrite who got what. There are no replies — the only per-recipient state
// is when the message was first seen.

const MAX_SUBJECT = 200
const MAX_BODY = 20000

// Every inbox call is made on behalf of a signed-in account; the id must be a
// real user row, never a renderer-supplied name or role.
async function requireUserId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query('SELECT user_id FROM "user" WHERE user_id = $1', [id])
  if (!res.data?.[0]) throw new Error('User not found.')
  return id
}

// Sending is an admin-only action, checked against the account's role_id in the
// database rather than the roles the renderer happens to hold.
async function requireAdminId(userId) {
  const id = await requireUserId(userId)
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code = 'ADMIN'
     LIMIT 1`,
    [id]
  )
  if (res.rowCount === 0) throw new Error('Not allowed: sending messages requires the Admin role.')
  return id
}

// ---- Recipient side ---------------------------------------------------------

// The caller's inbox, newest message first, with the sender's display name and
// the roles the message was addressed to.
export async function getInbox(userId) {
  const id = await requireUserId(userId)
  const res = await query(
    `SELECT m.message_id, m.message_subject, m.message_body, m.created_at,
            rec.seen_at,
            u.user_username AS sender_username,
            NULLIF(btrim(COALESCE(p.person_first_name_la, p.person_first_name_ar, '') || ' ' ||
                         COALESCE(p.person_last_name_la, p.person_last_name_ar, '')), '') AS sender_name,
            (SELECT string_agg(r.role_code, ', ' ORDER BY r.role_code)
               FROM message_target_role mt
               JOIN "role" r ON r.role_id = mt.role_id
              WHERE mt.message_id = m.message_id) AS target_roles
     FROM message_recipient rec
     JOIN message m ON m.message_id = rec.message_id
     JOIN "user" u ON u.user_id = m.sender_user_id
     LEFT JOIN person p ON p.person_id = u.person_id
     WHERE rec.user_id = $1
     ORDER BY m.created_at DESC, m.message_id DESC`,
    [id]
  )
  const messages = res.data || []
  return {
    success: true,
    messages,
    unreadCount: messages.filter(m => !m.SEEN_AT).length
  }
}

// Badge count for the sidebar.
export async function getInboxUnreadCount(userId) {
  const id = await requireUserId(userId)
  const res = await query(
    `SELECT count(*)::int AS unread
     FROM message_recipient
     WHERE user_id = $1 AND seen_at IS NULL`,
    [id]
  )
  return { success: true, unread: res.data?.[0]?.UNREAD || 0 }
}

// Records the first read. Re-opening an already-seen message keeps the
// original timestamp, so "when they saw it" stays truthful.
export async function markMessageSeen(userId, messageId) {
  // "Seen" is a fact the server records. Offline it is not claimed: the page
  // keeps the message as unread until the server can be told.
  if (isOffline()) return { success: false, offline: true }
  const id = await requireUserId(userId)
  const mid = parseInt(messageId, 10)
  if (!mid) throw new Error('Message is required.')

  const updated = await query(
    `UPDATE message_recipient SET seen_at = CURRENT_TIMESTAMP
     WHERE message_id = $1 AND user_id = $2 AND seen_at IS NULL
     RETURNING seen_at`,
    [mid, id]
  )
  const justSeen = updated.data?.[0]?.SEEN_AT
  if (justSeen) {
    await settleMessageNotification(id, mid)
    return { success: true, seenAt: justSeen, alreadySeen: false }
  }

  const existing = await query(
    'SELECT seen_at FROM message_recipient WHERE message_id = $1 AND user_id = $2',
    [mid, id]
  )
  const row = existing.data?.[0]
  if (!row) throw new Error('This message is not in your inbox.')
  return { success: true, seenAt: row.SEEN_AT, alreadySeen: !!row.SEEN_AT }
}

export async function markAllMessagesSeen(userId) {
  if (isOffline()) return { success: false, offline: true }
  const id = await requireUserId(userId)
  const res = await query(
    `UPDATE message_recipient SET seen_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND seen_at IS NULL`,
    [id]
  )

  // One statement for every mail of this account: the notification key always
  // ends with the account it belongs to.
  const personRes = await query('SELECT person_id FROM "user" WHERE user_id = $1', [id])
  const personId = personRes.data?.[0]?.PERSON_ID
  if (personId) await markMessageNotificationsRead(personId, `INBOX:%:${id}`)

  return { success: true, updated: res.rowCount }
}

// A mail that has been read should also stop counting in the bell.
async function settleMessageNotification(userId, messageId) {
  const personRes = await query('SELECT person_id FROM "user" WHERE user_id = $1', [userId])
  const personId = personRes.data?.[0]?.PERSON_ID
  if (personId) await markMessageNotificationsRead(personId, `INBOX:${messageId}:${userId}`)
}

// ---- Sender side (admin) ----------------------------------------------------

// Roles an admin can address, with the number of active accounts each role
// currently resolves to (the sender is never counted — nobody messages
// themselves).
export async function getMessageRoles(userId) {
  const adminId = await requireAdminId(userId)
  const res = await query(
    `SELECT r.role_id, r.role_code, r.role_label_en, r.role_label_ar, r.role_label_fr,
            count(DISTINCT u.user_id) FILTER (WHERE u.is_active)::int AS user_count
     FROM "role" r
     LEFT JOIN "user" u ON u.role_id = r.role_id AND u.user_id <> $1
     GROUP BY r.role_id, r.role_code, r.role_label_en, r.role_label_ar, r.role_label_fr
     ORDER BY r.role_code`,
    [adminId]
  )
  return { success: true, roles: res.data || [] }
}

// The exact accounts a message would reach with the given roles. Used to show
// the audience before sending, and again when writing the recipient rows.
async function resolveAudience(adminId, roleCodes) {
  const res = await query(
    `SELECT DISTINCT u.user_id, u.user_username,
            NULLIF(btrim(COALESCE(p.person_first_name_la, p.person_first_name_ar, '') || ' ' ||
                         COALESCE(p.person_last_name_la, p.person_last_name_ar, '')), '') AS person_name,
            (SELECT r2.role_code
               FROM "role" r2
              WHERE r2.role_id = u.role_id) AS role_codes
     FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     LEFT JOIN person p ON p.person_id = u.person_id
     WHERE r.role_code = ANY($1) AND u.is_active = true AND u.user_id <> $2
     ORDER BY person_name NULLS LAST, u.user_username`,
    [roleCodes, adminId]
  )
  return res.data || []
}

export async function getMessageAudience(userId, roleCodes) {
  const adminId = await requireAdminId(userId)
  const codes = await validateRoles(roleCodes)
  const recipients = await resolveAudience(adminId, codes)
  return { success: true, recipients, count: recipients.length }
}

// Normalises and validates the requested role codes against the role table.
async function validateRoles(roleCodes) {
  const codes = [...new Set(
    (Array.isArray(roleCodes) ? roleCodes : [])
      .map(c => String(c || '').trim().toUpperCase())
      .filter(Boolean)
  )]
  if (codes.length === 0) throw new Error('Select at least one role to send to.')

  const res = await query('SELECT role_code FROM "role" WHERE role_code = ANY($1)', [codes])
  const known = new Set((res.data || []).map(r => r.ROLE_CODE))
  const unknown = codes.filter(c => !known.has(c))
  if (unknown.length > 0) throw new Error(`Unknown role: ${unknown.join(', ')}.`)
  return codes
}

// Writes the message, the roles it targeted and one recipient row per account.
// Everything happens in one transaction: a message without its audience would
// be invisible to everyone.
export async function sendMessage(userId, data) {
  const adminId = await requireAdminId(userId)

  const subject = String(data?.subject ?? '').trim()
  const body = String(data?.body ?? '').trim()
  if (!subject) throw new Error('Subject is required.')
  if (subject.length > MAX_SUBJECT) throw new Error(`Subject cannot exceed ${MAX_SUBJECT} characters.`)
  if (!body) throw new Error('Message body is required.')
  if (body.length > MAX_BODY) throw new Error(`Message body cannot exceed ${MAX_BODY} characters.`)

  const codes = await validateRoles(data?.roles)
  const recipients = await resolveAudience(adminId, codes)
  if (recipients.length === 0) {
    throw new Error('No active users hold the selected role(s).')
  }

  const roleRes = await query('SELECT role_id, role_code FROM "role" WHERE role_code = ANY($1)', [codes])
  const roleIds = (roleRes.data || []).map(r => r.ROLE_ID)

  const result = await withTransaction(async (tx) => {
    const inserted = await tx(
      `INSERT INTO message (sender_user_id, message_subject, message_body)
       VALUES ($1, $2, $3)
       RETURNING message_id, created_at`,
      [adminId, subject, body]
    )
    const messageId = inserted.data?.[0]?.MESSAGE_ID
    if (!messageId) throw new Error('Could not save the message.')

    for (const roleId of roleIds) {
      await tx('INSERT INTO message_target_role (message_id, role_id) VALUES ($1, $2)', [messageId, roleId])
    }
    for (const recipient of recipients) {
      await tx(
        'INSERT INTO message_recipient (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [messageId, recipient.USER_ID]
      )
    }

    return {
      success: true,
      messageId,
      recipientCount: recipients.length,
      roles: codes,
      createdAt: inserted.data?.[0]?.CREATED_AT
    }
  })

  return result
}

// Every message the admin has sent, with how many recipients have seen it.
export async function getSentMessages(userId) {
  const adminId = await requireAdminId(userId)
  const res = await query(
    `SELECT m.message_id, m.message_subject, m.message_body, m.created_at,
            count(rec.message_recipient_id)::int AS recipient_count,
            count(rec.seen_at)::int AS seen_count,
            (SELECT string_agg(r.role_code, ', ' ORDER BY r.role_code)
               FROM message_target_role mt
               JOIN "role" r ON r.role_id = mt.role_id
              WHERE mt.message_id = m.message_id) AS target_roles
     FROM message m
     LEFT JOIN message_recipient rec ON rec.message_id = m.message_id
     WHERE m.sender_user_id = $1
     GROUP BY m.message_id
     ORDER BY m.created_at DESC, m.message_id DESC`,
    [adminId]
  )
  return { success: true, messages: res.data || [] }
}

// Who received one sent message, and when each of them first saw it. Unseen
// recipients come first so the admin sees what is still pending.
export async function getMessageRecipients(userId, messageId) {
  const adminId = await requireAdminId(userId)
  const mid = parseInt(messageId, 10)
  if (!mid) throw new Error('Message is required.')

  const header = await query(
    `SELECT message_id, message_subject, message_body, created_at, sender_user_id
     FROM message WHERE message_id = $1`,
    [mid]
  )
  const msg = header.data?.[0]
  if (!msg) throw new Error('Message not found.')
  if (msg.SENDER_USER_ID !== adminId) {
    throw new Error('Not allowed: you can only inspect messages you sent.')
  }

  const res = await query(
    `SELECT rec.message_recipient_id, rec.user_id, rec.seen_at,
            u.user_username, u.user_email, u.is_active,
            NULLIF(btrim(COALESCE(p.person_first_name_la, p.person_first_name_ar, '') || ' ' ||
                         COALESCE(p.person_last_name_la, p.person_last_name_ar, '')), '') AS person_name,
            (SELECT r.role_code FROM "role" r WHERE r.role_id = u.role_id) AS role_codes
     FROM message_recipient rec
     JOIN "user" u ON u.user_id = rec.user_id
     LEFT JOIN person p ON p.person_id = u.person_id
     WHERE rec.message_id = $1
     ORDER BY rec.seen_at NULLS FIRST, person_name NULLS LAST, u.user_username`,
    [mid]
  )

  const recipients = res.data || []
  const roles = await query(
    `SELECT r.role_code FROM message_target_role mt
     JOIN "role" r ON r.role_id = mt.role_id
     WHERE mt.message_id = $1
     ORDER BY r.role_code`,
    [mid]
  )

  return {
    success: true,
    message: msg,
    targetRoles: (roles.data || []).map(r => r.ROLE_CODE),
    recipients,
    seenCount: recipients.filter(r => r.SEEN_AT).length,
    unseenCount: recipients.filter(r => !r.SEEN_AT).length
  }
}
