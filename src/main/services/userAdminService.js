import bcrypt from 'bcryptjs'
import { query } from '../db'
import { recordAudit } from './auditService'
import {
  PASSWORD_MAX_BYTES,
  isPasswordValid,
  passwordBytesMessage,
  passwordPolicyMessage
} from '../../shared/passwordPolicy'

// Account tools: find a user account by username, first name, last name or
// person id, and set a new password for it. Admins and Developers may use them,
// verified against the account's role_id in the database — the renderer's claim
// is never trusted.

const MAX_RESULTS = 25

async function requireManagerId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code IN ('ADMIN', 'DEVELOPER')
     LIMIT 1`,
    [id]
  )
  if (res.rowCount === 0) throw new Error('Not allowed: managing passwords requires the Admin or Developer role.')
  return id
}

// Accounts matching a free-text term: username, first name, last name, the
// full name, or — when the term is a number — the person id. A person may hold
// several accounts, so a person-id search returns every account of that person,
// each with its own username.
export async function searchUsersForPasswordReset(userId, term) {
  await requireManagerId(userId)

  const text = String(term ?? '').trim()
  if (!text) return { success: true, users: [] }

  const personId = /^\d+$/.test(text) ? parseInt(text, 10) : null
  const like = `%${text.replace(/[%_]/g, m => `\\${m}`)}%`

  const res = await query(
    `SELECT u.user_id, u.user_username, u.user_email, u.is_active,
            p.person_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar,
            COALESCE(string_agg(r.role_code, ', ' ORDER BY r.role_code), '') AS role_codes
     FROM "user" u
     JOIN person p ON p.person_id = u.person_id
     LEFT JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_username ILIKE $1
        OR p.person_first_name_la ILIKE $1
        OR p.person_first_name_ar ILIKE $1
        OR p.person_last_name_la ILIKE $1
        OR p.person_last_name_ar ILIKE $1
        OR (COALESCE(p.person_first_name_la, p.person_first_name_ar, '') || ' ' ||
            COALESCE(p.person_last_name_la, p.person_last_name_ar, '')) ILIKE $1
        OR ($2::bigint IS NOT NULL AND p.person_id = $2::bigint)
     GROUP BY u.user_id, p.person_id
     ORDER BY COALESCE(p.person_last_name_la, p.person_last_name_ar) NULLS LAST,
              COALESCE(p.person_first_name_la, p.person_first_name_ar) NULLS LAST, u.user_username
     LIMIT ${MAX_RESULTS}`,
    [like, personId]
  )

  return { success: true, users: res.data || [], limited: (res.data || []).length === MAX_RESULTS }
}

// Sets a new password for another account. The current password is not needed
// (this is a reset, not a change) and no other account data is touched.
export async function resetUserPassword(userId, targetUserId, newPassword) {
  const actorId = await requireManagerId(userId)

  const targetId = parseInt(targetUserId, 10)
  if (!targetId) throw new Error('Select the account whose password you want to change.')

  const password = String(newPassword ?? '')
  if (!isPasswordValid(password)) {
    throw new Error(passwordPolicyMessage())
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new Error(passwordBytesMessage())
  }

  const targetRes = await query(
    `SELECT u.user_id, u.user_username,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar
     FROM "user" u
     LEFT JOIN person p ON p.person_id = u.person_id
     WHERE u.user_id = $1`,
    [targetId]
  )
  const target = targetRes.data?.[0]
  if (!target) throw new Error('User not found.')

  const hash = await bcrypt.hash(password, 10)
  await query('UPDATE "user" SET user_password_hash = $1 WHERE user_id = $2', [hash, targetId])

  const name = [target.PERSON_FIRST_NAME, target.PERSON_LAST_NAME].filter(Boolean).join(' ') || target.USER_USERNAME
  await recordAudit({
    actorUserId: actorId,
    action: 'account.password_reset',
    entityType: 'user',
    entityId: targetId,
    entityLabel: name,
    detail: { username: target.USER_USERNAME, ownAccount: targetId === actorId }
  })

  return {
    success: true,
    userId: targetId,
    username: target.USER_USERNAME,
    name: [target.PERSON_FIRST_NAME, target.PERSON_LAST_NAME].filter(Boolean).join(' ') || target.USER_USERNAME,
    changedOwnPassword: targetId === actorId
  }
}
