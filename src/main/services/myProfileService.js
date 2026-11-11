import bcrypt from 'bcryptjs'
import { query } from '../db'
import { recordAudit } from './auditService'
import {
  PASSWORD_MAX_BYTES,
  isPasswordValid,
  passwordBytesMessage,
  passwordPolicyMessage
} from '../../shared/passwordPolicy'

// Account + person info of the logged-in user.
export async function getMyProfile(userId) {
  const res = await query(
    `SELECT u.user_id, u.user_username, u.user_email, u.created_at,
            p.person_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar,
            p.person_birthdate, p.person_sex, p.person_photo,
            ar.role_code AS account_role,
            COALESCE(pr.person_roles, '{}') AS person_roles
     FROM "user" u
     JOIN person p ON p.person_id = u.person_id
     LEFT JOIN "role" ar ON ar.role_id = u.role_id
     LEFT JOIN LATERAL (
       -- The person's own roles only. The account role is read separately, so
       -- a refreshed session keeps the same split the sign-in made: access from
       -- user.role_id, description from person_has_role.
       SELECT array_agg(DISTINCT r3.role_code ORDER BY r3.role_code) AS person_roles
         FROM person_has_role phr
         JOIN "role" r3 ON r3.role_id = phr.role_id
        WHERE phr.person_id = u.person_id
          AND phr.role_end_date IS NULL
     ) pr ON TRUE
     WHERE u.user_id = $1`,
    [userId]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  return {
    success: true,
    profile: {
      userId: row.USER_ID,
      username: row.USER_USERNAME,
      email: row.USER_EMAIL,
      createdAt: row.CREATED_AT,
      personId: row.PERSON_ID,
      firstName: row.PERSON_FIRST_NAME,
      lastName: row.PERSON_LAST_NAME,
      birthdate: row.PERSON_BIRTHDATE,
      sex: row.PERSON_SEX,
      photo: row.PERSON_PHOTO,
      // access: the account role (one, or none). description: the person's own
      // roles. Never merged — see authService.login.
      accountRole: row.ACCOUNT_ROLE || null,
      roles: row.ACCOUNT_ROLE ? [row.ACCOUNT_ROLE] : [],
      personRoles: row.PERSON_ROLES || [],
      isTeacher: row.ACCOUNT_ROLE === 'TEACHER' || (row.PERSON_ROLES || []).includes('TEACHER'),
      isStudent: row.ACCOUNT_ROLE === 'STUDENT' || (row.PERSON_ROLES || []).includes('STUDENT')
    }
  }
}

// Change the account username (uniqueness enforced by the DB, checked here
// for a friendlier error).
export async function updateMyUsername(userId, newUsername) {
  const username = (newUsername || '').trim()
  if (!username) throw new Error('Username is required.')
  if (username.length > 60) throw new Error('Username is too long (max 60 characters).')

  const taken = await query('SELECT 1 FROM "user" WHERE user_username = $1 AND user_id <> $2', [username, userId])
  if (taken.data?.length > 0) throw new Error('This username is already taken.')

  const currentRes = await query('SELECT user_username FROM "user" WHERE user_id = $1', [userId])
  const previous = currentRes.data?.[0]?.USER_USERNAME || null

  await query('UPDATE "user" SET user_username = $1 WHERE user_id = $2', [username, userId])
  await recordAudit({
    actorUserId: userId,
    action: 'account.username_change',
    entityType: 'user',
    entityId: userId,
    entityLabel: username,
    changes: { user_username: { before: previous, after: username } }
  })
  return { success: true }
}

// Change the account password after verifying the current one.
export async function changeMyPassword(userId, currentPassword, newPassword) {
  if (!currentPassword) throw new Error('Current password is required.')
  if (!newPassword || !isPasswordValid(newPassword)) throw new Error(passwordPolicyMessage())
  if (Buffer.byteLength(newPassword, 'utf8') > PASSWORD_MAX_BYTES) throw new Error(passwordBytesMessage())

  const res = await query('SELECT user_password_hash FROM "user" WHERE user_id = $1', [userId])
  const hash = res.data?.[0]?.USER_PASSWORD_HASH
  if (!hash) throw new Error('User not found.')

  const isMatch = await bcrypt.compare(currentPassword, hash)
  if (!isMatch) throw new Error('Current password is incorrect.')

  const newHash = await bcrypt.hash(newPassword, 10)
  await query('UPDATE "user" SET user_password_hash = $1 WHERE user_id = $2', [newHash, userId])
  await recordAudit({
    actorUserId: userId,
    action: 'account.password_change',
    entityType: 'user',
    entityId: userId,
    detail: { ownAccount: true }
  })
  return { success: true }
}
