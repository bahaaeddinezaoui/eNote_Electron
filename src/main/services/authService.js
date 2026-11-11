import bcrypt from 'bcryptjs'
import { isConnectionError, query } from '../db'
import { rememberSignIn, verifyOfflineSignIn } from '../offlineAuth'
import { recordAudit } from './auditService'

// Consecutive wrong passwords that suspend an account. A successful sign-in — or
// an administrator restoring the account — puts the counter back to zero, so it
// counts consecutive failures, not lifetime ones.
export const MAX_FAILED_LOGIN_ATTEMPTS = 5

const SUSPENDED_MESSAGE =
  'This account is suspended after too many unsuccessful sign-in attempts. An administrator can restore access.'

export async function login(username, password) {
  try {
    console.log(`Attempting login for user: ${username}`)
    // The person's own names travel with the session: the window chrome names
    // the account by them, and the username as its handle. The join is LEFT so
    // an account whose person row is missing can still sign in.
    const userResult = await query(
      `SELECT u.*,
              COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name
         FROM "user" u
         LEFT JOIN person p ON p.person_id = u.person_id
        WHERE u.user_username = $1`,
      [username]
    )
    const user = userResult.data?.[0]

    if (!user) {
      console.log('User not found in database')
      await recordAudit({
        action: 'auth.sign_in',
        actorUsername: username,
        result: 'failure',
        error: 'User not found',
        detail: { reason: 'USER_NOT_FOUND' }
      })
      // `code` lets the sign-in screen phrase the failure in the interface's own
      // language; `message` stays the English fallback for everything else.
      return { success: false, code: 'USER_NOT_FOUND', message: 'User not found' }
    }

    // A suspended account is refused before the password is even compared: the
    // suspension is the point — no further guess can succeed until an admin
    // restores it, so asking for the password again would only invite more tries.
    if (user.SUSPENDED_AT) {
      console.log('Account is suspended')
      await recordAudit({
        action: 'auth.sign_in',
        actorUserId: user.USER_ID,
        result: 'failure',
        error: SUSPENDED_MESSAGE,
        detail: { reason: 'SUSPENDED' }
      })
      return { success: false, code: 'SUSPENDED', suspended: true, message: SUSPENDED_MESSAGE }
    }

    console.log('User found, comparing password...')
    const isMatch = await bcrypt.compare(password, user.USER_PASSWORD_HASH)
    if (!isMatch) {
      console.log('Password mismatch')
      const attempts = (user.FAILED_LOGIN_ATTEMPTS || 0) + 1

      if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        await query(
          `UPDATE "user"
              SET failed_login_attempts = $2,
                  suspended_at = CURRENT_TIMESTAMP,
                  suspension_reason = 'FAILED_LOGIN',
                  unlocked_at = NULL,
                  unlocked_by_user_id = NULL
            WHERE user_id = $1`,
          [user.USER_ID, attempts]
        )
        await recordAudit({
          action: 'auth.sign_in',
          actorUserId: user.USER_ID,
          result: 'failure',
          error: SUSPENDED_MESSAGE,
          detail: { reason: 'TOO_MANY_ATTEMPTS', attempts }
        })
        return { success: false, code: 'SUSPENDED', suspended: true, attempts, message: SUSPENDED_MESSAGE }
      }

      await query('UPDATE "user" SET failed_login_attempts = $2 WHERE user_id = $1', [user.USER_ID, attempts])
      const remaining = MAX_FAILED_LOGIN_ATTEMPTS - attempts
      await recordAudit({
        action: 'auth.sign_in',
        actorUserId: user.USER_ID,
        result: 'failure',
        error: 'Invalid credentials',
        detail: { reason: 'INVALID_CREDENTIALS', attempts, remaining }
      })
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        attempts,
        remainingAttempts: remaining,
        message: `Invalid credentials. ${remaining} more attempt${remaining === 1 ? '' : 's'} before this account is suspended.`
      }
    }

    // A deactivated account keeps all of its records but may not sign in. The
    // state is checked after the password so it is never revealed to somebody
    // who does not know it.
    if (user.IS_ACTIVE === false) {
      console.log('Account is deactivated')
      await recordAudit({
        action: 'auth.sign_in',
        actorUserId: user.USER_ID,
        result: 'failure',
        error: 'This account has been deactivated.',
        detail: { reason: 'DEACTIVATED' }
      })
      return {
        success: false,
        code: 'DEACTIVATED',
        message: 'This account has been deactivated. Ask an administrator to reactivate it.'
      }
    }

    // The password was right: whatever had accumulated is no longer consecutive.
    if (user.FAILED_LOGIN_ATTEMPTS) {
      await query('UPDATE "user" SET failed_login_attempts = 0 WHERE user_id = $1', [user.USER_ID])
    }

    // Two questions, two answers, kept apart. The account role (user.role_id)
    // decides what this login may do and is the only list navigation may read;
    // the person's roles (person_has_role) say who they are in the school and
    // are content only. Merging them into one list let a person role stand in
    // for an account role, opening pages the server then refused. Server-side
    // checks never rely on this payload: each one re-reads the role itself.
    const accountRoleResult = await query(
      `SELECT r.role_code
         FROM "user" u
         JOIN "role" r ON r.role_id = u.role_id
        WHERE u.user_id = $1`,
      [user.USER_ID]
    )
    const personRoleResult = await query(
      `SELECT r.role_code
         FROM person_has_role phr
         JOIN "role" r ON r.role_id = phr.role_id
        WHERE phr.person_id = $1
          AND phr.role_end_date IS NULL`,
      [user.PERSON_ID]
    )

    // Presence: the account is active from this moment on.
    await query('UPDATE "user" SET last_seen_at = CURRENT_TIMESTAMP WHERE user_id = $1', [user.USER_ID])

    const accountRole = accountRoleResult.data?.[0]?.ROLE_CODE || null
    const personRoles = [...new Set(
      (personRoleResult.data || []).map((row) => row.ROLE_CODE).filter(Boolean)
    )]

    await recordAudit({
      action: 'auth.sign_in',
      actorUserId: user.USER_ID,
      result: 'success',
      detail: { accountRole, personRoles }
    })

    console.log('Login successful')
    // This computer keeps the credential of the last account that signed in, so
    // the same person can reach their saved records if the server goes away.
    // The password hash never leaves the main process.
    const sessionUser = {
      id: user.USER_ID,
      personId: user.PERSON_ID,
      username: user.USER_USERNAME,
      email: user.USER_EMAIL,
      firstName: user.PERSON_FIRST_NAME || null,
      lastName: user.PERSON_LAST_NAME || null,
      isBetaTester: user.IS_BETA_TESTER === true,
      // The account role alone: the access decision, and what nav reads.
      accountRole,
      roles: accountRole ? [accountRole] : [],
      // Who the person is in the school — descriptive, never a permission.
      personRoles,
      isTeacher: accountRole === 'TEACHER' || personRoles.includes('TEACHER'),
      isStudent: accountRole === 'STUDENT' || personRoles.includes('STUDENT')
    }
    rememberSignIn(sessionUser, user.USER_PASSWORD_HASH)

    return { success: true, user: sessionUser }
  } catch (error) {
    // The server did not answer. That is not a refusal: fall back to the one
    // account this computer signed in last, and only for that account.
    if (isConnectionError(error)) {
      const offline = await verifyOfflineSignIn(username, password)
      if (offline) {
        console.warn('Signed in from the credential saved on this computer while the server is unreachable.')
        return offline
      }
      return {
        success: false,
        offline: true,
        code: 'OFFLINE_NO_CREDENTIAL',
        message:
          'The server is unreachable and no account has signed in on this computer yet. Connect to the server to sign in for the first time.'
      }
    }

    console.error('Login service error:', error)
    throw error
  }
}

// A person may hold more than one account on purpose: the person is who the
// records belong to, an account is one way to sign in as them (a teacher who is
// also a director, a replacement username, a second duty with its own password
// and its own suspension state). Only the username and the email must be unique
// — the INSERT below is what enforces that, not the person.
export async function register(userData) {
  const { username, password, email, personId } = userData
  const id = parseInt(personId, 10)
  if (!id) return { success: false, message: 'Choose the person this account signs in as.' }

  // Checked here so a missing person reads as a sentence rather than as a
  // foreign-key error from the database.
  const person = await query('SELECT 1 FROM person WHERE person_id = $1', [id])
  if (person.rowCount === 0) return { success: false, message: 'That person no longer exists.' }

  const hashedPassword = await bcrypt.hash(password, 10)

  try {
    const result = await query(`
      INSERT INTO "user" (person_id, user_username, user_password_hash, user_email) 
      VALUES ($1, $2, $3, $4)
      RETURNING user_id
    `, [id, username, hashedPassword, email])
    
    const userId = result.data?.[0]?.USER_ID
    return { success: true, userId }
  } catch (error) {
    return { success: false, message: error.message }
  }
}
