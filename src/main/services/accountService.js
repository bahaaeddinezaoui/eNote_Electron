import bcrypt from 'bcryptjs'
import { query, withTransaction } from '../db'
import { recordAudit } from './auditService'
import { createPerson, grantPersonRole, PERSON_ROLE_CODES } from './personService'
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

// The fields a new account always needs, validated in one place so the
// account-only path and the register-a-person path cannot drift apart.
function readNewAccountFields(data) {
  const username = String(data.username ?? '').trim()
  const email = String(data.email ?? '').trim()
  const password = String(data.password ?? '')
  const roleCode = String(data.roleCode ?? '').trim().toUpperCase()

  if (!username) throw new Error('Username is required.')
  if (username.length > MAX_USERNAME_LENGTH) {
    throw new Error(`Username is too long (max ${MAX_USERNAME_LENGTH} characters).`)
  }
  if (email && !EMAIL_PATTERN.test(email)) throw new Error('Enter a valid email address.')
  if (email.length > MAX_EMAIL_LENGTH) {
    throw new Error(`Email is too long (max ${MAX_EMAIL_LENGTH} characters).`)
  }
  if (!isPasswordValid(password)) throw new Error(passwordPolicyMessage())
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new Error(passwordBytesMessage())
  }
  if (!roleCode) throw new Error('Choose the account role.')

  return { username, email, password, roleCode }
}

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

// The people an account may be created for, narrowed by name, name fragment or
// person id. A person can hold more than one account on purpose (a teacher who
// is also a director, a replacement username), so nobody is excluded here: the
// row carries how many accounts already exist and the dialog reports it.
const MAX_PERSON_RESULTS = 30

export async function searchAccountCandidates(userId, term) {
  await requireManagerId(userId)

  const text = String(term ?? '').trim()
  const personId = /^\d+$/.test(text) ? parseInt(text, 10) : null
  const like = `%${text.replace(/[%_]/g, m => `\\${m}`)}%`

  const res = await query(
    `SELECT p.person_id,
            p.person_first_name_la, p.person_last_name_la,
            p.person_first_name_ar, p.person_last_name_ar,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            COALESCE(pr.role_codes, '{}') AS person_role_codes,
            COALESCE(acc.account_count, 0) AS existing_accounts
       FROM person p
       LEFT JOIN LATERAL (
         SELECT array_agg(DISTINCT r.role_code ORDER BY r.role_code) AS role_codes
           FROM person_has_role phr
           JOIN "role" r ON r.role_id = phr.role_id
          WHERE phr.person_id = p.person_id
            AND phr.role_end_date IS NULL
       ) pr ON TRUE
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS account_count
           FROM "user" u
          WHERE u.person_id = p.person_id
       ) acc ON TRUE
      WHERE $1::text = ''
         OR p.person_first_name_la ILIKE $2
         OR p.person_first_name_ar ILIKE $2
         OR p.person_last_name_la ILIKE $2
         OR p.person_last_name_ar ILIKE $2
         OR (COALESCE(p.person_first_name_la, p.person_first_name_ar, '') || ' ' ||
             COALESCE(p.person_last_name_la, p.person_last_name_ar, '')) ILIKE $2
         OR ($3::bigint IS NOT NULL AND p.person_id = $3::bigint)
      ORDER BY COALESCE(p.person_last_name_la, p.person_last_name_ar) NULLS LAST,
               COALESCE(p.person_first_name_la, p.person_first_name_ar) NULLS LAST,
               p.person_id
      LIMIT ${MAX_PERSON_RESULTS}`,
    [text, like, personId]
  )

  return {
    success: true,
    people: res.data || [],
    limited: (res.data || []).length === MAX_PERSON_RESULTS
  }
}

// Create an account for a person who is already on file. The role is chosen
// here — it is what the login may open — and it is also recorded on the
// person's own record, so the roster and the account describe the same person.
// The account starts active; its records belong to the person and are not
// touched. The same password policy as the sign-in form applies, and the
// username and email are unique across accounts, never across people.
export async function createAccount(userId, data = {}) {
  const actorId = await requireManagerId(userId)

  const personId = parseInt(data.personId, 10)
  if (!personId) throw new Error('Choose the person this account signs in as.')

  const { username, email, password, roleCode } = readNewAccountFields(data)

  const personRes = await query(
    `SELECT p.person_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name
       FROM person p
      WHERE p.person_id = $1`,
    [personId]
  )
  const person = personRes.data?.[0]
  if (!person) throw new Error('That person no longer exists.')

  // The renderer sends a role code; the id is resolved here so it can never
  // supply a role_id that does not exist.
  const roleRes = await query('SELECT role_id, role_code FROM "role" WHERE role_code = $1', [roleCode])
  const role = roleRes.data?.[0]
  if (!role) throw new Error('Choose a valid account role.')

  const nextEmail = email || null

  // Uniqueness is checked here so a duplicate reads as a sentence rather than
  // as a constraint violation; the database remains the final word.
  const takenUsername = await query(
    'SELECT 1 FROM "user" WHERE LOWER(user_username) = LOWER($1)',
    [username]
  )
  if ((takenUsername.data || []).length > 0) throw new Error('This username is already taken.')

  if (nextEmail) {
    const takenEmail = await query(
      'SELECT 1 FROM "user" WHERE user_email IS NOT NULL AND LOWER(user_email) = LOWER($1)',
      [nextEmail]
    )
    if ((takenEmail.data || []).length > 0) {
      throw new Error('This email address is already used by another account.')
    }
  }

  const hash = await bcrypt.hash(password, 10)

  let newUserId
  try {
    const inserted = await query(
      `INSERT INTO "user" (person_id, user_username, user_password_hash, user_email, role_id, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING user_id`,
      [personId, username, hash, nextEmail, role.ROLE_ID]
    )
    newUserId = inserted.data?.[0]?.USER_ID
  } catch (error) {
    if (error?.code === '23505') {
      throw new Error('This username or email address is already used by another account.')
    }
    throw error
  }
  if (!newUserId) throw new Error('The account could not be created.')

  // The person record and the account answer two different questions, but the
  // role they name should agree. If the person already holds it this changes
  // nothing; if the schema refuses it, the new account is rolled back rather
  // than left describing somebody the roster does not.
  if (PERSON_ROLE_CODES.includes(roleCode)) {
    try {
      await grantPersonRole(personId, roleCode)
    } catch (error) {
      await query('DELETE FROM "user" WHERE user_id = $1', [newUserId]).catch(() => {})
      throw error
    }
  }

  const name = [person.PERSON_FIRST_NAME, person.PERSON_LAST_NAME].filter(Boolean).join(' ')
    || username

  await recordAudit({
    actorUserId: actorId,
    action: 'account.create',
    entityType: 'user',
    entityId: newUserId,
    entityLabel: name,
    detail: { username, roleCode, personId }
  })

  return {
    success: true,
    userId: newUserId,
    personId,
    username,
    email: nextEmail,
    roleCode,
    name
  }
}

// Register a person who is not in the registry yet and create their account in
// a single transaction. In the middle of this the registry is briefly
// inconsistent (a person with no login), so a failure must leave neither half
// behind: the transaction either commits both rows or neither.
//
// The person fields are the same ones the Personnel page collects; the role is
// the account's role and is also recorded on the person, exactly as it is when
// an account is created for somebody already on file.
export async function createPersonWithAccount(userId, data = {}) {
  const actorId = await requireManagerId(userId)

  const person = data.person && typeof data.person === 'object' ? data.person : {}
  const firstName = String(person.PERSON_FIRST_NAME_LA ?? '').trim()
  const lastName = String(person.PERSON_LAST_NAME_LA ?? '').trim()
  if (!firstName) throw new Error('The first name is required.')
  if (!lastName) throw new Error('The last name is required.')

  const { username, email, password, roleCode } = readNewAccountFields(data)

  const roleRes = await query('SELECT role_id, role_code FROM "role" WHERE role_code = $1', [roleCode])
  const role = roleRes.data?.[0]
  if (!role) throw new Error('Choose a valid account role.')

  // Checked before the transaction, so a duplicate reads as a sentence and no
  // person row is created only to be rolled back. The INSERT remains the final
  // word if two administrators save at the same moment.
  const takenUsername = await query(
    'SELECT 1 FROM "user" WHERE LOWER(user_username) = LOWER($1)',
    [username]
  )
  if ((takenUsername.data || []).length > 0) throw new Error('This username is already taken.')

  if (email) {
    const takenEmail = await query(
      'SELECT 1 FROM "user" WHERE user_email IS NOT NULL AND LOWER(user_email) = LOWER($1)',
      [email]
    )
    if ((takenEmail.data || []).length > 0) {
      throw new Error('This email address is already used by another account.')
    }
  }

  const hash = await bcrypt.hash(password, 10)
  const nextEmail = email || null

  let creation
  try {
    creation = await withTransaction(async (tx) => {
      const createdPerson = await createPerson(person, tx)
      const personId = createdPerson?.PERSON_ID
      if (!personId) throw new Error('The person could not be registered.')

      // A duplicate here is a username or an email, never the person id: the
      // person was just inserted in this transaction.
      let inserted
      try {
        inserted = await tx(
          `INSERT INTO "user" (person_id, user_username, user_password_hash, user_email, role_id, is_active)
           VALUES ($1, $2, $3, $4, $5, TRUE)
           RETURNING user_id`,
          [personId, username, hash, nextEmail, role.ROLE_ID]
        )
      } catch (error) {
        if (error?.code === '23505') {
          throw new Error('This username or email address is already used by another account.')
        }
        throw error
      }

      const newUserId = inserted.data?.[0]?.USER_ID
      if (!newUserId) throw new Error('The account could not be created.')

      if (PERSON_ROLE_CODES.includes(roleCode)) await grantPersonRole(personId, roleCode, tx)

      return { personId, newUserId }
    })
  } catch (error) {
    // The only unique constraint this transaction can still violate is the
    // person key, which two administrators can race on even after the check.
    if (error?.code === '23505') throw new Error('A person with this ID already exists.')
    throw error
  }

  const name = [firstName, lastName].filter(Boolean).join(' ')

  await recordAudit({
    actorUserId: actorId,
    action: 'account.create',
    entityType: 'user',
    entityId: creation.newUserId,
    entityLabel: name,
    detail: { username, roleCode, personId: creation.personId, personCreated: true }
  })

  return {
    success: true,
    userId: creation.newUserId,
    personId: creation.personId,
    username,
    email: nextEmail,
    roleCode,
    name
  }
}
