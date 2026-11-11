import { query } from '../db'
import { recordAudit } from './auditService'

// Secretary and scheduler accounts, managed by an administrator.
//
// A secretary is not a separate kind of record: it is a "user" account carrying
// the SECRETARY role, linked to a person. Two things hang off that account and
// are administered here:
//
//   secretary_detail   what the account may do to the conduct ledger — add,
//                      edit and delete punishments and rewards. A missing row
//                      means no rights at all, and an ADMIN is never limited.
//   app_option         the global conduct master switches (Settings → Conduct
//                      rights): OFF closes an action for every secretary, while
//                      ON leaves each account's own right in control.
//   user_teaching_category_scope
//                      which teaching categories the account may work in:
//                      students for a secretary, weekly sessions and teaching
//                      groups for a scheduler (both saved through
//                      teachingScopeService).
//
// Every function re-checks the Admin role against the account's role_id; the
// renderer hiding the page is a courtesy, not the gate.

export const PERMISSION_KEYS = [
  'canAddPunishments',
  'canEditPunishments',
  'canDeletePunishments',
  'canAddRewards',
  'canEditRewards',
  'canDeleteRewards'
]

// An account with no row yet: no rights. Admins are unrestricted elsewhere.
const NO_RIGHTS = {
  canAddPunishments: false,
  canEditPunishments: false,
  canDeletePunishments: false,
  canAddRewards: false,
  canEditRewards: false,
  canDeleteRewards: false
}

const ALL_RIGHTS = {
  canAddPunishments: true,
  canEditPunishments: true,
  canDeletePunishments: true,
  canAddRewards: true,
  canEditRewards: true,
  canDeleteRewards: true
}

// The global master switches live in app_option, not in secretary_detail. A
// missing row means ON, so an installation that never opened the setting keeps
// the behaviour it had before these switches existed.
const GLOBAL_OPTION_KEYS = {
  canAddPunishments: 'conduct_add_punishments',
  canEditPunishments: 'conduct_edit_punishments',
  canDeletePunishments: 'conduct_delete_punishments',
  canAddRewards: 'conduct_add_rewards',
  canEditRewards: 'conduct_edit_rewards',
  canDeleteRewards: 'conduct_delete_rewards'
}

const optionIsOn = (raw) => {
  if (raw === undefined || raw === null) return true
  return !['0', 'false', 'off', 'no'].includes(String(raw).trim().toLowerCase())
}

async function readGlobalRights() {
  const res = await query(
    `SELECT option_key, option_value FROM app_option WHERE option_key = ANY($1::text[])`,
    [Object.values(GLOBAL_OPTION_KEYS)]
  )
  const stored = new Map((res.data || []).map(row => [row.OPTION_KEY, row.OPTION_VALUE]))
  const rights = {}
  for (const key of PERMISSION_KEYS) {
    rights[key] = optionIsOn(stored.get(GLOBAL_OPTION_KEYS[key]))
  }
  return rights
}

const readFlags = (row) => {
  if (!row) return { ...NO_RIGHTS }
  return {
    canAddPunishments: row.CAN_ADD_PUNISHMENTS === true,
    canEditPunishments: row.CAN_EDIT_PUNISHMENTS === true,
    canDeletePunishments: row.CAN_DELETE_PUNISHMENTS === true,
    canAddRewards: row.CAN_ADD_REWARDS === true,
    canEditRewards: row.CAN_EDIT_REWARDS === true,
    canDeleteRewards: row.CAN_DELETE_REWARDS === true
  }
}

async function requireAdmin(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code = 'ADMIN'
     LIMIT 1`,
    [id]
  )
  if (res.rowCount === 0) {
    throw new Error('Not allowed: managing secretaries requires the Admin role.')
  }
  return id
}

// Every secretary and scheduler account with its roles, its categories, its
// conduct rights and how much it has recorded so far. Inactive accounts stay
// listed so the admin can see and re-enable them.
export async function getSecretaries(adminUserId) {
  await requireAdmin(adminUserId)

  const [accountsRes, categoriesRes, departmentsRes] = await Promise.all([
    query(
      `SELECT u.user_id, u.person_id, u.user_username, u.user_email, u.is_active,
              array_agg(DISTINCT r.role_code) AS role_codes,
              p.person_first_name_la, p.person_last_name_la,
              p.person_first_name_ar, p.person_last_name_ar,
              COALESCE(bool_or(sd.can_add_punishments), FALSE) AS can_add_punishments,
              COALESCE(bool_or(sd.can_edit_punishments), FALSE) AS can_edit_punishments,
              COALESCE(bool_or(sd.can_delete_punishments), FALSE) AS can_delete_punishments,
              COALESCE(bool_or(sd.can_add_rewards), FALSE) AS can_add_rewards,
              COALESCE(bool_or(sd.can_edit_rewards), FALSE) AS can_edit_rewards,
              COALESCE(bool_or(sd.can_delete_rewards), FALSE) AS can_delete_rewards,
              COALESCE(array_agg(DISTINCT utcs.teaching_category_id)
                       FILTER (WHERE utcs.teaching_category_id IS NOT NULL), '{}') AS category_ids,
              COALESCE(array_agg(DISTINCT uds.department_id)
                       FILTER (WHERE uds.department_id IS NOT NULL), '{}') AS department_ids,
              (SELECT count(*)::int FROM secretary_punishes_student sps
                WHERE sps.person_id = u.person_id) AS punishment_count,
              (SELECT count(*)::int FROM secretary_rewards_student srs
                WHERE srs.person_id = u.person_id) AS reward_count
       FROM "user" u
       JOIN "role" r ON r.role_id = u.role_id AND r.role_code IN ('SECRETARY', 'SCHEDULER')
       LEFT JOIN person p ON p.person_id = u.person_id
       LEFT JOIN secretary_detail sd ON sd.person_id = u.person_id
       LEFT JOIN user_teaching_category_scope utcs ON utcs.user_id = u.user_id
       LEFT JOIN user_department_scope uds ON uds.user_id = u.user_id
       GROUP BY u.user_id, u.person_id, u.user_username, u.user_email, u.is_active,
                p.person_first_name_la, p.person_last_name_la,
                p.person_first_name_ar, p.person_last_name_ar
       ORDER BY p.person_last_name_la NULLS LAST, p.person_first_name_la NULLS LAST, u.user_username`
    ),
    query(
      `SELECT tc.teaching_category_id, tc.teaching_category_code, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr,
              count(DISTINCT s.section_id)::int AS section_count
       FROM teaching_category tc
       LEFT JOIN section s ON s.teaching_category_id = tc.teaching_category_id
       GROUP BY tc.teaching_category_id, tc.teaching_category_code, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr
       ORDER BY tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr`
    ),
    query(
      `SELECT d.department_id, d.department_code,
              d.department_label_en, d.department_label_ar, d.department_label_fr,
              d.major_category_id,
              mc.major_category_code,
              mc.major_category_label_en, mc.major_category_label_ar, mc.major_category_label_fr,
              (SELECT count(*)::int
                 FROM person_has_role phr
                WHERE phr.department_id = d.department_id
                  AND phr.role_end_date IS NULL) AS teacher_count
       FROM department d
       LEFT JOIN major_category mc ON mc.major_category_id = d.major_category_id
       ORDER BY d.department_label_en, d.department_label_ar, d.department_label_fr`
    )
  ])

  return {
    success: true,
    accounts: accountsRes.data || [],
    categories: categoriesRes.data || [],
    departments: departmentsRes.data || []
  }
}

// Account fields an administrator may change here. The person's names and
// details belong to the People page, not to this one.
export async function updateSecretaryAccount(adminUserId, secretaryUserId, data = {}) {
  // Scheduler accounts are edited here too: the same fields and the same gate.
  await requireAdmin(adminUserId)

  const targetId = parseInt(secretaryUserId, 10)
  if (!targetId) throw new Error('Select a secretary account.')

  const target = await query(
    `SELECT u.user_id FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id AND r.role_code IN ('SECRETARY', 'SCHEDULER')
     WHERE u.user_id = $1
     LIMIT 1`,
    [targetId]
  )
  if (target.rowCount === 0) throw new Error('That account is not a secretary or scheduler.')

  const sets = []
  const vals = []

  if (data.username !== undefined) {
    const username = String(data.username || '').trim()
    if (username.length < 3) throw new Error('The username must be at least 3 characters.')
    const clash = await query(
      'SELECT 1 FROM "user" WHERE lower(user_username) = lower($1) AND user_id <> $2 LIMIT 1',
      [username, targetId]
    )
    if (clash.rowCount > 0) throw new Error('That username is already taken.')
    vals.push(username)
    sets.push(`user_username = $${vals.length}`)
  }

  if (data.email !== undefined) {
    const email = String(data.email || '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.')
    vals.push(email)
    sets.push(`user_email = $${vals.length}`)
  }

  if (data.isActive !== undefined) {
    vals.push(data.isActive === true)
    sets.push(`is_active = $${vals.length}`)
  }

  if (sets.length === 0) return { success: true, userId: targetId, changed: false }

  vals.push(targetId)
  await query(`UPDATE "user" SET ${sets.join(', ')} WHERE user_id = $${vals.length}`, vals)
  return { success: true, userId: targetId, changed: true }
}

// Replace the six conduct rights of one secretary. A missing row is created,
// so flipping a box on an account that never had one works the first time.
export async function setSecretaryPermissions(adminUserId, secretaryUserId, permissions = {}) {
  await requireAdmin(adminUserId)

  const targetId = parseInt(secretaryUserId, 10)
  if (!targetId) throw new Error('Select a secretary account.')

  const target = await query(
    `SELECT u.user_id, u.person_id FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id AND r.role_code = 'SECRETARY'
     WHERE u.user_id = $1
     LIMIT 1`,
    [targetId]
  )
  const row = target.data?.[0]
  if (!row) throw new Error('That account is not a secretary.')
  if (!row.PERSON_ID) throw new Error('That account has no person record, so it cannot hold rights.')

  const flags = {}
  for (const key of PERMISSION_KEYS) {
    flags[key] = permissions[key] === true
  }

  await query(
    `INSERT INTO secretary_detail (
       person_id, can_add_punishments, can_edit_punishments, can_delete_punishments,
       can_add_rewards, can_edit_rewards, can_delete_rewards
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (person_id) DO UPDATE SET
       can_add_punishments = EXCLUDED.can_add_punishments,
       can_edit_punishments = EXCLUDED.can_edit_punishments,
       can_delete_punishments = EXCLUDED.can_delete_punishments,
       can_add_rewards = EXCLUDED.can_add_rewards,
       can_edit_rewards = EXCLUDED.can_edit_rewards,
       can_delete_rewards = EXCLUDED.can_delete_rewards`,
    [
      row.PERSON_ID,
      flags.canAddPunishments,
      flags.canEditPunishments,
      flags.canDeletePunishments,
      flags.canAddRewards,
      flags.canEditRewards,
      flags.canDeleteRewards
    ]
  )

  return { success: true, userId: targetId, permissions: flags }
}

// The conduct rights of the acting account. Takes the scope resolved by
// teachingScopeService, so an ADMIN (never restricted) always passes and a
// secretary needs both the account right and the matching global switch.
export async function loadRewardsPunishmentsPermissions(scope) {
  if (!scope?.restricted) return { ...ALL_RIGHTS }
  if (!scope.personId) return { ...NO_RIGHTS }

  // The global master switches and the account's own rights are both required:
  // an Admin can close an action for every secretary without clearing the
  // per-account choices, then reopen it and keep those choices intact.
  const [res, global] = await Promise.all([
    query(
      `SELECT can_add_punishments, can_edit_punishments, can_delete_punishments,
              can_add_rewards, can_edit_rewards, can_delete_rewards
       FROM secretary_detail WHERE person_id = $1`,
      [scope.personId]
    ),
    readGlobalRights()
  ])
  const own = readFlags(res.data?.[0])
  const effective = {}
  for (const key of PERMISSION_KEYS) effective[key] = own[key] && global[key]
  return effective
}

// ---- Global master switches -------------------------------------------------

// The six switches at the top of Settings → Conduct rights. They are stored in
// app_option so they are not tied to a person; an Admin saves them once and
// every secretary is affected. Missing rows are ON.
export async function getConductGlobalRights(adminUserId) {
  await requireAdmin(adminUserId)
  return { success: true, rights: await readGlobalRights() }
}

// Replace all six master switches. Sending the whole set keeps the dialog's
// switches consistent; a key that is absent is treated as ON, never as an
// accidental revocation.
export async function setConductGlobalRights(adminUserId, rights = {}) {
  const adminId = await requireAdmin(adminUserId)
  const before = await readGlobalRights()
  const flags = {}
  for (const key of PERMISSION_KEYS) flags[key] = rights[key] !== false

  const params = []
  const tuples = []
  for (const key of PERMISSION_KEYS) {
    params.push(GLOBAL_OPTION_KEYS[key], flags[key] ? '1' : '0')
    tuples.push(`($${params.length - 1}, $${params.length}, CURRENT_TIMESTAMP)`)
  }
  await query(
    `INSERT INTO app_option (option_key, option_value, updated_at)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (option_key) DO UPDATE SET
       option_value = EXCLUDED.option_value,
       updated_at = CURRENT_TIMESTAMP`,
    params
  )

  const changes = {}
  for (const key of PERMISSION_KEYS) {
    if (before[key] !== flags[key]) changes[key] = { before: before[key], after: flags[key] }
  }
  if (Object.keys(changes).length > 0) {
    await recordAudit({
      actorUserId: adminId,
      action: 'conduct.global_rights',
      entityType: 'conduct_rights',
      entityId: 'secretary',
      entityLabel: 'Conduct rights',
      changes
    })
  }
  return { success: true, rights: flags }
}
