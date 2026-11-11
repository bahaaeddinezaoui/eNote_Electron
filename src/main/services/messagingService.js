import { query } from '../db'
import { recordAudit } from './auditService'
import { markMessageNotificationsRead } from './notificationService'
import {
  MESSAGE_ENCRYPTION_PREFIX,
  encryptMessageBody,
  decryptMessageBody
} from '../messageCrypto'

// Direct messages between two accounts, plus the role-to-role contact matrix an
// administrator or developer controls from the Settings page.
//
// A user may contact another user when ANY of their roles is allowed to reach
// ANY of the other user's roles (message_rule). The rule is checked when a
// conversation is opened and again on every send, so revoking a pair stops new
// messages immediately while the existing thread stays readable.
//
// Presence (user.last_seen_at) is refreshed on sign-in and by the renderer's
// heartbeat, and is what the contact list shows next to each person.

const MAX_BODY = 4000
const MAX_MESSAGES = 300
const DECRYPT_FAILED = '[This message could not be decrypted]'

// Reading never lets one damaged row break a whole thread.
function readMessageBody(stored) {
  try {
    return decryptMessageBody(stored)
  } catch (err) {
    console.warn('Could not decrypt a direct message:', err.message)
    return DECRYPT_FAILED
  }
}

async function requireUserId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query('SELECT user_id, is_active FROM "user" WHERE user_id = $1', [id])
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  if (row.IS_ACTIVE === false) throw new Error('Not allowed: this account is inactive.')
  return id
}

async function requireManagerId(userId) {
  const id = await requireUserId(userId)
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code IN ('ADMIN', 'DEVELOPER')
     LIMIT 1`,
    [id]
  )
  if (res.rowCount === 0) throw new Error('Not allowed: message permissions require the Admin or Developer role.')
  return id
}

// Is any (sender role → target role) pair allowed for these two accounts?
async function canContact(senderId, targetId) {
  const res = await query(
    `SELECT 1
     FROM "user" s
     JOIN message_rule mr ON mr.sender_role_id = s.role_id
     JOIN "user" t ON t.user_id = $2 AND t.role_id = mr.target_role_id
     WHERE s.user_id = $1
     LIMIT 1`,
    [senderId, targetId]
  )
  return res.rowCount > 0
}

// ---- Contact matrix (Admin / Developer) -------------------------------------

export async function getMessagingRules(userId) {
  await requireManagerId(userId)

  const [rolesRes, rulesRes] = await Promise.all([
    query(
      `SELECT r.role_id, r.role_code, r.role_label_en, r.role_label_ar, r.role_label_fr,
              count(DISTINCT u.user_id)::int AS user_count
       FROM "role" r
       LEFT JOIN "user" u ON u.role_id = r.role_id AND u.is_active = true
       GROUP BY r.role_id, r.role_code, r.role_label_en, r.role_label_ar, r.role_label_fr
       ORDER BY r.role_code`
    ),
    query(
      `SELECT sr.role_code AS sender_role_code, tr.role_code AS target_role_code
       FROM message_rule mr
       JOIN "role" sr ON sr.role_id = mr.sender_role_id
       JOIN "role" tr ON tr.role_id = mr.target_role_id
       ORDER BY sr.role_code, tr.role_code`
    )
  ])

  return {
    success: true,
    roles: rolesRes.data || [],
    rules: rulesRes.data || []
  }
}

// Bulk switches from the same dialog: turn the whole matrix, every pair a role
// sends, or every pair a role receives on or off in one step. The individual
// role pairs remain available afterwards as exceptions.
export async function setMessagingScope(userId, scope, roleCode, allowed) {
  await requireManagerId(userId)

  const mode = String(scope || '').trim().toLowerCase()
  if (!['all', 'sender', 'target', 'both'].includes(mode)) {
    throw new Error('Unknown message-permission scope.')
  }

  let role = null
  if (mode !== 'all') {
    role = String(roleCode || '').trim().toUpperCase()
    if (!role) throw new Error('A role is required for this switch.')
    const roleRes = await query('SELECT role_code FROM "role" WHERE role_code = $1', [role])
    if (roleRes.rowCount === 0) throw new Error('Unknown role.')
  }

  const allow = !!allowed
  const senderFilter =
    mode === 'sender' || mode === 'both' ? 's.role_code = $1' : null
  const targetFilter =
    mode === 'target' || mode === 'both' ? 't.role_code = $1' : null
  const filters = [senderFilter, targetFilter].filter(Boolean)
  const where = mode === 'all' ? '' : `WHERE ${filters.join(' OR ')}`

  if (allow) {
    await query(
      `INSERT INTO message_rule (sender_role_id, target_role_id)
       SELECT s.role_id, t.role_id
       FROM "role" s CROSS JOIN "role" t
       ${where}
       ON CONFLICT DO NOTHING`,
      mode === 'all' ? [] : [role]
    )
  } else if (mode === 'all') {
    await query('DELETE FROM message_rule')
  } else {
    await query(
      `DELETE FROM message_rule mr
       USING "role" s, "role" t
       WHERE mr.sender_role_id = s.role_id
         AND mr.target_role_id = t.role_id
         AND (${filters.join(' OR ')})`,
      [role]
    )
  }

  const scopeLabel = mode === 'all'
    ? 'all role pairs'
    : mode === 'sender'
      ? `${role} → all roles`
      : mode === 'target'
        ? `all roles → ${role}`
        : `${role} → all roles and all roles → ${role}`

  await recordAudit({
    actorUserId: userId,
    action: 'permission.message_rule',
    entityType: mode === 'all' ? 'role_matrix' : 'role_scope',
    entityId: mode === 'all' ? 'ALL' : `${mode}:${role}`,
    entityLabel: scopeLabel,
    detail: { scope: mode, roleCode: role, allowed: allow }
  })

  return { success: true, scope: mode, roleCode: role, allowed: allow }
}

export async function setMessagingRule(userId, senderRoleCode, targetRoleCode, allowed) {
  await requireManagerId(userId)

  const sender = String(senderRoleCode || '').trim().toUpperCase()
  const target = String(targetRoleCode || '').trim().toUpperCase()
  if (!sender || !target) throw new Error('Both roles are required.')

  const roleRes = await query('SELECT role_code FROM "role" WHERE role_code = ANY($1)', [[sender, target]])
  const known = new Set((roleRes.data || []).map(r => r.ROLE_CODE))
  if (!known.has(sender) || !known.has(target)) throw new Error('Unknown role.')

  if (allowed) {
    await query(
      `INSERT INTO message_rule (sender_role_id, target_role_id)
       SELECT s.role_id, t.role_id
       FROM "role" s, "role" t
       WHERE s.role_code = $1 AND t.role_code = $2
       ON CONFLICT DO NOTHING`,
      [sender, target]
    )
  } else {
    await query(
      `DELETE FROM message_rule
       WHERE sender_role_id = (SELECT role_id FROM "role" WHERE role_code = $1)
         AND target_role_id = (SELECT role_id FROM "role" WHERE role_code = $2)`,
      [sender, target]
    )
  }

  await recordAudit({
    actorUserId: userId,
    action: 'permission.message_rule',
    entityType: 'role_pair',
    entityId: `${sender}>${target}`,
    entityLabel: `${sender} → ${target}`,
    detail: { senderRoleCode: sender, targetRoleCode: target, allowed: !!allowed }
  })

  return { success: true, senderRoleCode: sender, targetRoleCode: target, allowed: !!allowed }
}

// ---- Recipient side ---------------------------------------------------------

// Active accounts this user is allowed to contact, with presence, roles and
// the existing conversation (if any) so the picker can reopen a thread.
export async function getContactableUsers(userId) {
  const id = await requireUserId(userId)

  const res = await query(
    `SELECT u.user_id, u.user_username, u.last_seen_at,
            p.person_id, p.person_photo,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar,
            COALESCE(string_agg(DISTINCT r.role_code, ', ' ORDER BY r.role_code), '') AS role_codes,
            (SELECT c.conversation_id FROM direct_conversation c
              WHERE c.user_low_id = LEAST($1, u.user_id)
                AND c.user_high_id = GREATEST($1, u.user_id)) AS conversation_id,
            (SELECT count(*)::int FROM direct_message dm
              JOIN direct_conversation c2 ON c2.conversation_id = dm.conversation_id
              WHERE c2.user_low_id = LEAST($1, u.user_id)
                AND c2.user_high_id = GREATEST($1, u.user_id)
                AND dm.sender_user_id <> $1
                AND dm.seen_at IS NULL) AS unread_count
     FROM "user" u
     LEFT JOIN person p ON p.person_id = u.person_id
     LEFT JOIN "role" r ON r.role_id = u.role_id
     WHERE u.is_active = true AND u.user_id <> $1
       AND EXISTS (
         SELECT 1
         FROM "user" me
         JOIN message_rule mr ON mr.sender_role_id = me.role_id
         WHERE me.user_id = $1 AND mr.target_role_id = u.role_id
       )
     GROUP BY u.user_id, p.person_id
     ORDER BY COALESCE(p.person_last_name_la, p.person_last_name_ar) NULLS LAST,
              COALESCE(p.person_first_name_la, p.person_first_name_ar) NULLS LAST, u.user_username`,
    [id]
  )

  return { success: true, users: res.data || [] }
}

// Every thread this user takes part in, newest activity first, with the other
// participant, their presence, the last message and the unread count.
export async function getConversations(userId) {
  const id = await requireUserId(userId)

  const res = await query(
    `SELECT c.conversation_id, c.last_message_at, c.created_at,
            o.user_id AS other_user_id, o.user_username AS other_username,
            o.last_seen_at AS other_last_seen_at,
            p.person_id AS other_person_id, p.person_photo AS other_photo,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS other_first_name,
            p.person_first_name_la AS other_first_name_la,
            p.person_first_name_ar AS other_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS other_last_name,
            p.person_last_name_la AS other_last_name_la,
            p.person_last_name_ar AS other_last_name_ar,
            last_msg.message_body AS last_body,
            last_msg.created_at AS last_at,
            last_msg.sender_user_id AS last_sender_id,
            COALESCE(unread.unread_count, 0)::int AS unread_count
     FROM direct_conversation c
     JOIN "user" o ON o.user_id = CASE WHEN c.user_low_id = $1 THEN c.user_high_id ELSE c.user_low_id END
     LEFT JOIN person p ON p.person_id = o.person_id
     LEFT JOIN LATERAL (
       SELECT dm.message_body, dm.created_at, dm.sender_user_id
       FROM direct_message dm
       WHERE dm.conversation_id = c.conversation_id
       ORDER BY dm.direct_message_id DESC
       LIMIT 1
     ) last_msg ON TRUE
     LEFT JOIN LATERAL (
       SELECT count(*) AS unread_count
       FROM direct_message dm
       WHERE dm.conversation_id = c.conversation_id
         AND dm.sender_user_id <> $1
         AND dm.seen_at IS NULL
     ) unread ON TRUE
     WHERE c.user_low_id = $1 OR c.user_high_id = $1
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.conversation_id DESC`,
    [id]
  )

  const conversations = (res.data || []).map(row => ({
    ...row,
    LAST_BODY: row.LAST_BODY == null ? row.LAST_BODY : readMessageBody(row.LAST_BODY)
  }))

  return { success: true, conversations }
}

// Finds (or opens) the thread with another account, after checking that the
// contact matrix allows it right now.
export async function openConversation(userId, otherUserId) {
  const id = await requireUserId(userId)
  const otherId = parseInt(otherUserId, 10)
  if (!otherId) throw new Error('Select the person you want to message.')
  if (otherId === id) throw new Error('You cannot message yourself.')

  const otherRes = await query(
    `SELECT u.user_id, u.user_username, u.is_active, u.last_seen_at,
            p.person_id, p.person_photo,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar
     FROM "user" u LEFT JOIN person p ON p.person_id = u.person_id
     WHERE u.user_id = $1`,
    [otherId]
  )
  const other = otherRes.data?.[0]
  if (!other) throw new Error('User not found.')
  if (other.IS_ACTIVE === false) throw new Error('This account is inactive.')

  if (!(await canContact(id, otherId))) {
    throw new Error('You are not allowed to message this user.')
  }

  const res = await query(
    `INSERT INTO direct_conversation (user_low_id, user_high_id)
     VALUES (LEAST($1::int, $2::int), GREATEST($1::int, $2::int))
     ON CONFLICT (user_low_id, user_high_id)
     DO UPDATE SET user_low_id = EXCLUDED.user_low_id
     RETURNING conversation_id`,
    [id, otherId]
  )
  const conversationId = res.data?.[0]?.CONVERSATION_ID
  if (!conversationId) throw new Error('Could not open the conversation.')

  return {
    success: true,
    conversationId,
    otherUser: {
      userId: other.USER_ID,
      username: other.USER_USERNAME,
      firstName: other.PERSON_FIRST_NAME,
      lastName: other.PERSON_LAST_NAME,
      personId: other.PERSON_ID,
      photo: other.PERSON_PHOTO,
      lastSeenAt: other.LAST_SEEN_AT
    }
  }
}

// One thread's messages. Opening it marks the other participant's messages as
// seen, so their sender can see it was read.
export async function getConversation(userId, conversationId) {
  const id = await requireUserId(userId)
  const convId = parseInt(conversationId, 10)
  if (!convId) throw new Error('Conversation is required.')

  const convRes = await query(
    `SELECT c.conversation_id, c.user_low_id, c.user_high_id, c.last_message_at,
            o.user_id AS other_user_id, o.user_username AS other_username,
            o.last_seen_at AS other_last_seen_at,
            o.person_id AS other_person_id, p.person_photo AS other_photo,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS other_first_name,
            p.person_first_name_la AS other_first_name_la,
            p.person_first_name_ar AS other_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS other_last_name,
            p.person_last_name_la AS other_last_name_la,
            p.person_last_name_ar AS other_last_name_ar,
            COALESCE(string_agg(DISTINCT r.role_code, ', ' ORDER BY r.role_code), '') AS other_roles
     FROM direct_conversation c
     JOIN "user" o ON o.user_id = CASE WHEN c.user_low_id = $1 THEN c.user_high_id ELSE c.user_low_id END
     LEFT JOIN person p ON p.person_id = o.person_id
     LEFT JOIN "role" r ON r.role_id = o.role_id
     WHERE c.conversation_id = $2 AND (c.user_low_id = $1 OR c.user_high_id = $1)
     GROUP BY c.conversation_id, o.user_id, p.person_id`,
    [id, convId]
  )
  const conv = convRes.data?.[0]
  if (!conv) throw new Error('Conversation not found.')

  await query(
    `UPDATE direct_message SET seen_at = CURRENT_TIMESTAMP
     WHERE conversation_id = $1 AND sender_user_id <> $2 AND seen_at IS NULL`,
    [convId, id]
  )

  // Reading the thread settles its notifications in the bell as well.
  const meRes = await query('SELECT person_id FROM "user" WHERE user_id = $1', [id])
  const myPersonId = meRes.data?.[0]?.PERSON_ID
  if (myPersonId) await markMessageNotificationsRead(myPersonId, `DIRECT:${convId}:%`)

  const msgRes = await query(
    `SELECT * FROM (
       SELECT dm.direct_message_id, dm.sender_user_id, dm.message_body, dm.created_at, dm.seen_at
       FROM direct_message dm
       WHERE dm.conversation_id = $1
       ORDER BY dm.direct_message_id DESC
       LIMIT ${MAX_MESSAGES}
     ) t ORDER BY t.direct_message_id ASC`,
    [convId]
  )

  const canSend = await canContact(id, conv.OTHER_USER_ID)

  return {
    success: true,
    conversation: {
      conversationId: conv.CONVERSATION_ID,
      otherUser: {
        userId: conv.OTHER_USER_ID,
        username: conv.OTHER_USERNAME,
        firstName: conv.OTHER_FIRST_NAME,
        lastName: conv.OTHER_LAST_NAME,
        personId: conv.OTHER_PERSON_ID,
        photo: conv.OTHER_PHOTO,
        roles: conv.OTHER_ROLES ? conv.OTHER_ROLES.split(', ') : [],
        lastSeenAt: conv.OTHER_LAST_SEEN_AT
      },
      lastMessageAt: conv.LAST_MESSAGE_AT
    },
    messages: (msgRes.data || []).map(row => ({
      ...row,
      MESSAGE_BODY: readMessageBody(row.MESSAGE_BODY)
    })),
    canSend
  }
}

export async function sendDirectMessage(userId, conversationId, messageBody) {
  const id = await requireUserId(userId)
  const convId = parseInt(conversationId, 10)
  if (!convId) throw new Error('Conversation is required.')

  const body = String(messageBody ?? '').trim()
  if (!body) throw new Error('The message cannot be empty.')
  if (body.length > MAX_BODY) throw new Error(`The message cannot exceed ${MAX_BODY} characters.`)

  const convRes = await query(
    `SELECT conversation_id, user_low_id, user_high_id
     FROM direct_conversation
     WHERE conversation_id = $1 AND (user_low_id = $2 OR user_high_id = $2)`,
    [convId, id]
  )
  const conv = convRes.data?.[0]
  if (!conv) throw new Error('Conversation not found.')

  const otherId = conv.USER_LOW_ID === id ? conv.USER_HIGH_ID : conv.USER_LOW_ID
  if (!(await canContact(id, otherId))) {
    throw new Error('You are not allowed to message this user.')
  }

  const res = await query(
    `INSERT INTO direct_message (conversation_id, sender_user_id, message_body)
     VALUES ($1, $2, $3)
     RETURNING direct_message_id, conversation_id, sender_user_id, message_body, created_at, seen_at`,
    [convId, id, encryptMessageBody(body)]
  )
  await query('UPDATE direct_conversation SET last_message_at = CURRENT_TIMESTAMP WHERE conversation_id = $1', [convId])
  await touchLastSeen(id)

  const message = res.data?.[0]
    ? { ...res.data[0], MESSAGE_BODY: readMessageBody(res.data[0].MESSAGE_BODY) }
    : null
  return { success: true, message }
}

// One-time upgrade of messages stored before encryption was introduced. It is
// safe to run on every start: rows already carrying the prefix are skipped and
// a failed run simply leaves the remaining rows in plain text for the next
// attempt. `run` is injectable so tests can execute it inside a rollback.
let backfillInFlight = null

export function encryptStoredDirectMessages(run = query) {
  if (backfillInFlight) return backfillInFlight

  backfillInFlight = (async () => {
    const res = await run(
      `SELECT direct_message_id, message_body
       FROM direct_message
       WHERE message_body NOT LIKE $1
       ORDER BY direct_message_id`,
      [`${MESSAGE_ENCRYPTION_PREFIX}%`]
    )

    let updated = 0
    for (const row of res.data || []) {
      const encrypted = encryptMessageBody(row.MESSAGE_BODY)
      await run(
        'UPDATE direct_message SET message_body = $1 WHERE direct_message_id = $2',
        [encrypted, row.DIRECT_MESSAGE_ID]
      )
      updated += 1
    }
    return updated
  })().finally(() => {
    backfillInFlight = null
  })

  return backfillInFlight
}

// Badge count for the sidebar: unread direct messages across every thread.
export async function getUnreadDirectCount(userId) {
  const id = await requireUserId(userId)
  const res = await query(
    `SELECT count(*)::int AS unread
     FROM direct_message dm
     JOIN direct_conversation c ON c.conversation_id = dm.conversation_id
     WHERE (c.user_low_id = $1 OR c.user_high_id = $1)
       AND dm.sender_user_id <> $1
       AND dm.seen_at IS NULL`,
    [id]
  )
  return { success: true, unread: res.data?.[0]?.UNREAD || 0 }
}

// Presence heartbeat: called on sign-in and periodically while the app runs.
export async function touchLastSeen(userId) {
  const id = parseInt(userId, 10)
  if (!id) return { success: false }
  const res = await query(
    'UPDATE "user" SET last_seen_at = CURRENT_TIMESTAMP WHERE user_id = $1 RETURNING last_seen_at',
    [id]
  )
  return { success: res.rowCount > 0, lastSeenAt: res.data?.[0]?.LAST_SEEN_AT || null }
}
