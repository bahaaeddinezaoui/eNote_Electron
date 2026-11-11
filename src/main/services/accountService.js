import bcrypt from 'bcryptjs'
import { query } from '../db'
import { recordAudit } from './auditService'
import {
  PASSWORD_MAX_BYTES,
  isPasswordValid,
  passwordBytesMessage,
  passwordPolicyMessage
} from '../../shared/passwordPolicy'

// Account administration: the account list and the on/off switch on
// `user.is_active`. An administrator or a developer decides whether an account
// may sign in; nothing else about the person or their records is touched, and a
// deactivated account keeps everything it produced.
//
// The gate is checked against the acting account's role in the database on
// every call — the page being hidden from other roles is a courtesy, not the
// rule.

const MANAGER_ROLES = ['ADMIN', 'DEVELOPER']
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_USERNAME_LENGTH = 60
const MAX_EMAIL_LENGTH = 120

// The acting account, with its roles. A deactivated account may not manage
// accounts even from a session that is still open, exactly like the other
// service gates that read is_active.
async function requireManagerId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const res = await query(
    `SELECT u.is_active,
            COALESCE(array_agg(r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
     FROM "user" u
     LEFT JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1
     GROUP BY u.user_id, u.is_active`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  if (row.IS_ACTIVE === false) throw new Error('Not allowed: this account is deactivated.')
  if (!(row.ROLES || []).some(code => MANAGER_ROLES.includes(code))) {
    throw new Error('Not allowed: managing accounts requires the Admin or Developer role.')
  }
  return id
}

// Every account with its person, its roles and its state. Inactive accounts
// stay listed so they can be found and switched back on.
export async function getAccounts(userId) {
  await requireManagerId(userId)

  // The roles an account may carry, read from the database so the editor never
  // invents a code. They travel with the list: the page needs them once.
  const [res, rolesRes] = await Promise.all([
    query(
    `SELECT u.user_id, u.person_id, u.user_username, u.user_email,
            u.is_active, u.last_seen_at,
            p.person_first_name_la, p.person_last_name_la,
            p.person_first_name_ar, p.person_last_name_ar,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            COALESCE(array_agg(DISTINCT r.role_code)
                     FILTER (WHERE r.role_code IS NOT NULL), '{}') AS role_codes
     FROM "user" u
     LEFT JOIN person p ON p.person_id = u.person_id
     LEFT JOIN "role" r ON r.role_id = u.role_id
     GROUP BY u.user_id, p.person_id
     ORDER BY u.is_active DESC, p.person_last_name_la NULLS LAST,
              p.person_first_name_la NULLS LAST, u.user_username`
    ),
    query('SELECT role_code FROM "role" ORDER BY role_code')
  ])

  return {
    success: true,
    accounts: res.data || [],
    roles: (rolesRes.data || []).map((row) => row.ROLE_CODE).filter(Boolean)
  }
}

// Switch one account on or off. Changing your own account is refused: a slip
// there would lock you out mid-session with no way back in. Every other account
// — an administrator's included — can be switched off by a manager.
export async function setAccountActive(userId, targetUserId, active) {
  const actorId = await requireManagerId(userId)

  const targetId = parseInt(targetUserId, 10)
  if (!targetId) throw new Error('Select an account.')

  const exists = await query('SELECT 1 FROM "user" WHERE user_id = $1', [targetId])
  if (exists.rowCount === 0) throw new Error('User not found.')

  if (targetId === actorId) {
    throw new Error('You cannot change the state of your own account.')
  }

  await query('UPDATE "user" SET is_active = $1 WHERE user_id = $2', [active === true, targetId])
  return { success: true, userId: targetId, isActive: active === true }
}

// Edit one account: its username, its email, and — when a new password is
// given — its password. A manager may do all three without knowing the current
// password (this is administration, not a personal change), but the new
// password still has to satisfy the same policy the sign-in form enforces.
//
// Uniqueness is checked here so a duplicate reads as a sentence rather than as
// a constraint violation; the database remains the final word. The role may
// also change, under the two guards below; the account state and its person
// record are never touched.
export async function updateAccount(userId, targetUserId, data = {}) {
  const actorId = await requireManagerId(userId)

  const targetId = parseInt(targetUserId, 10)
  if (!targetId) throw new Error('Select an account to edit.')

  const username = String(data.username ?? '').trim()
  const email = String(data.email ?? '').trim()
  const password = data.password ? String(data.password) : ''

  if (!username) throw new Error('Username is required.')
  if (username.length > MAX_USERNAME_LENGTH) {
    throw new Error(`Username is too long (max ${MAX_USERNAME_LENGTH} characters).`)
  }
  if (email && !EMAIL_PATTERN.test(email)) throw new Error('Enter a valid email address.')
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new Error(`Email is too long (max ${MAX_EMAIL_LENGTH} characters).`)
  }
  if (password) {
    if (!isPasswordValid(password)) throw new Error(passwordPolicyMessage())
    if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
      throw new Error(passwordBytesMessage())
    }
  }

  const targetRes = await query(
    `SELECT u.user_id, u.user_username, u.user_email, u.is_active,
            r.role_id, r.role_code,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name
       FROM "user" u
       LEFT JOIN person p ON p.person_id = u.person_id
       LEFT JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [targetId]
  )
  const target = targetRes.data?.[0]
  if (!target) throw new Error('User not found.')

  const nextEmail = email || null
  const usernameChanged = target.USER_USERNAME !== username
  const emailChanged = (target.USER_EMAIL || null) !== nextEmail

  if (usernameChanged) {
    const taken = await query(
      'SELECT 1 FROM "user" WHERE LOWER(user_username) = LOWER($1) AND user_id <> $2',
      [username, targetId]
    )
    if ((taken.data || []).length > 0) throw new Error('This username is already taken.')
  }

  if (emailChanged && nextEmail) {
    const taken = await query(
      'SELECT 1 FROM "user" WHERE user_email IS NOT NULL AND LOWER(user_email) = LOWER($1) AND user_id <> $2',
      [nextEmail, targetId]
    )
    if ((taken.data || []).length > 0) {
      throw new Error('This email address is already used by another account.')
    }
  }

  // The account role decides what the account may open. The renderer sends a
  // role code; the id is resolved here so it can never supply a role_id.
  const roleChangeRequested = data.roleCode !== undefined
  let nextRoleId = null
  let nextRoleCode = null
  if (roleChangeRequested) {
    const code = String(data.roleCode || '').trim().toUpperCase()
    if (code) {
      const roleRes = await query(
        'SELECT role_id, role_code FROM "role" WHERE role_code = $1',
        [code]
      )
      const role = roleRes.data?.[0]
      if (!role) throw new Error('Choose a valid account role.')
      nextRoleId = role.ROLE_ID
      nextRoleCode = role.ROLE_CODE
    }
  }

  const currentRoleCode = target.ROLE_CODE || null
  const roleChanged = roleChangeRequested && target.ROLE_ID !== nextRoleId

  // A role is a permission, so it follows the same rule as deactivation:
  // changing your own would strip your access mid-session with no way back.
  if (roleChanged && targetId === actorId) {
    throw new Error('You cannot change the role of your own account.')
  }

  // The last active administrator keeps the Admin role until somebody else
  // carries it: removing it would leave the installation with nobody able to
  // administer it. A deactivated administrator is already locked out, so their
  // role may be changed freely.
  if (
    roleChanged &&
    currentRoleCode === 'ADMIN' &&
    nextRoleCode !== 'ADMIN' &&
    target.IS_ACTIVE !== false
  ) {
    const others = await query(
      `SELECT count(*)::int AS n
         FROM "user" u
         JOIN "role" r ON r.role_id = u.role_id
        WHERE r.role_code = 'ADMIN' AND u.is_active = true AND u.user_id <> $1`,
      [targetId]
    )
    if (Number(others.data?.[0]?.N || 0) === 0) {
      throw new Error('This is the last active administrator. Give another account the Admin role before changing this one.')
    }
  }

  const assignments = ['user_username = $1', 'user_email = $2']
  const values = [username, nextEmail]
  if (password) {
    values.push(await bcrypt.hash(password, 10))
    assignments.push(`user_password_hash = $${values.length}`)
  }
  if (roleChanged) {
    values.push(nextRoleId)
    assignments.push(`role_id = $${values.length}`)
  }
  values.push(targetId)

  await query(
    `UPDATE "user" SET ${assignments.join(', ')} WHERE user_id = $${values.length}`,
    values
  )

  const name = [target.PERSON_FIRST_NAME, target.PERSON_LAST_NAME].filter(Boolean).join(' ')
    || username
  const changes = {}
  if (usernameChanged) changes.user_username = { before: target.USER_USERNAME, after: username }
  if (emailChanged) changes.user_email = { before: target.USER_EMAIL || null, after: nextEmail }
  if (roleChanged) changes.role_code = { before: currentRoleCode, after: nextRoleCode }

  await recordAudit({
    actorUserId: actorId,
    action: 'account.update',
    entityType: 'user',
    entityId: targetId,
    entityLabel: name,
    changes,
    detail: {
      username,
      // Named so the audit redaction does not hide the boolean itself.
      authChanged: !!password,
      ownAccount: targetId === actorId
    }
  })

  return {
    success: true,
    userId: targetId,
    username,
    email: nextEmail,
    roleCode: nextRoleCode,
    passwordChanged: !!password
  }
}
