import { query } from '../db'
import { MAX_FAILED_LOGIN_ATTEMPTS } from './authService'
import { recordAudit } from './auditService'

// Suspended accounts and the way back in.
//
// Sign-in suspends an account itself after MAX_FAILED_LOGIN_ATTEMPTS wrong
// passwords (see authService); only an administrator can lift it. Both calls
// here re-check the Admin role against the account's role_id in the database,
// like the rest of the administration pages — the renderer is never trusted.
//
// Suspension is separate from deactivation: is_active is left untouched, so an
// account that was switched off before being suspended still needs reactivating
// afterwards, and the page says so.

async function requireAdminId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code = 'ADMIN'
     LIMIT 1`,
    [id]
  )
  if (res.rowCount === 0) throw new Error('Not allowed: restoring accounts requires the Admin role.')
  return id
}

// Every account currently locked out, most recently suspended first.
export async function getSuspendedAccounts(userId) {
  await requireAdminId(userId)

  const res = await query(
    `SELECT u.user_id, u.user_username, u.user_email, u.is_active,
            u.failed_login_attempts, u.suspended_at, u.suspension_reason,
            u.unlocked_at, u.last_seen_at,
            p.person_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar,
            COALESCE(array_agg(DISTINCT r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS role_codes
     FROM "user" u
     LEFT JOIN person p ON p.person_id = u.person_id
     LEFT JOIN "role" r ON r.role_id = u.role_id
     WHERE u.suspended_at IS NOT NULL
     GROUP BY u.user_id, p.person_id
     ORDER BY u.suspended_at DESC`
  )

  return { success: true, accounts: res.data || [], maxAttempts: MAX_FAILED_LOGIN_ATTEMPTS }
}

// Restores an account: the suspension is cleared and the counter is reset, so the
// next sign-in starts from zero attempts. The restoring admin is recorded.
export async function unlockAccount(userId, targetUserId) {
  const adminId = await requireAdminId(userId)

  const targetId = parseInt(targetUserId, 10)
  if (!targetId) throw new Error('Select the account to restore.')

  const res = await query(
    `UPDATE "user"
        SET suspended_at = NULL,
            failed_login_attempts = 0,
            suspension_reason = NULL,
            unlocked_at = CURRENT_TIMESTAMP,
            unlocked_by_user_id = $1
      WHERE user_id = $2 AND suspended_at IS NOT NULL
      RETURNING user_id, user_username, is_active, person_id`,
    [adminId, targetId]
  )
  const restored = res.data?.[0]

  if (!restored) {
    const exists = await query('SELECT user_id FROM "user" WHERE user_id = $1', [targetId])
    if (!exists.data?.length) throw new Error('User not found.')
    throw new Error('That account is not suspended.')
  }

  const person = await query(
    `SELECT COALESCE(person_first_name_la, person_first_name_ar) AS person_first_name,
            person_first_name_la AS person_first_name_la,
            person_first_name_ar AS person_first_name_ar,
            COALESCE(person_last_name_la, person_last_name_ar) AS person_last_name,
            person_last_name_la AS person_last_name_la,
            person_last_name_ar AS person_last_name_ar
       FROM person WHERE person_id = $1`,
    [restored.PERSON_ID]
  )
  const name = [person.data?.[0]?.PERSON_FIRST_NAME, person.data?.[0]?.PERSON_LAST_NAME]
    .filter(Boolean)
    .join(' ')

  await recordAudit({
    actorUserId: adminId,
    action: 'account.unlock',
    entityType: 'user',
    entityId: restored.USER_ID,
    entityLabel: name || restored.USER_USERNAME,
    detail: { username: restored.USER_USERNAME, stillDeactivated: restored.IS_ACTIVE === false }
  })

  return {
    success: true,
    userId: restored.USER_ID,
    username: restored.USER_USERNAME,
    name: name || restored.USER_USERNAME,
    // Restoring access is not the same as reactivating a switched-off account.
    stillDeactivated: restored.IS_ACTIVE === false
  }
}
