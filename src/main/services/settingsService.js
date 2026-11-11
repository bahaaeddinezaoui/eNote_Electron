import { query } from '../db'
import { recordAudit } from './auditService'

// Global application settings (key/value), managed by the admin on the
// Settings page. Unknown keys are rejected on write so typos can't silently
// create junk rows; every reader treats a missing row as its documented
// default.

// The option registry: every writable key with its allowed values and the
// default returned when the row is absent. A definition with `allowed` is a
// fixed set of values; one with `kind: 'version'` takes a free-form version
// string (or an empty string, which clears the gate).
const OPTION_DEFINITIONS = {
  exam_marks_locked: {
    label: 'Lock exam marks editing',
    allowed: ['0', '1'],
    default: '0'
  },
  student_deletion_allowed: {
    label: 'Allow deleting students',
    allowed: ['0', '1'],
    default: '1'
  },
  // Minutes after a session's start during which a teacher may not remove a
  // recorded absence. '0' turns the lock off; the value is a whole number of
  // minutes (absenceService reads it on every removal attempt).
  absence_removal_lock_minutes: {
    label: 'Lock absence removal after the session starts',
    kind: 'minutes',
    default: '0'
  },
  // The oldest client version allowed to use this server (updateGateService).
  // Empty means no gate; a version such as "4.0.1" makes every older client
  // show the update screen until it is replaced.
  required_client_version: {
    label: 'Required client version',
    kind: 'version',
    default: ''
  },
  // The Library. Uploads and teacher uploads decide who may add a document;
  // review makes an Admin approval the last step before publication; student
  // downloads is a distribution restriction; a mandatory category keeps the
  // shelves organised; the size limit protects the shared storage root.
  library_uploads_enabled: {
    label: 'Allow Library uploads',
    allowed: ['0', '1'],
    default: '1'
  },
  library_teacher_uploads_enabled: {
    label: 'Allow teachers to add Library documents',
    allowed: ['0', '1'],
    default: '1'
  },
  library_review_required: {
    label: 'Review Library documents before publishing',
    allowed: ['0', '1'],
    default: '1'
  },
  library_student_downloads: {
    label: 'Allow students to download Library documents',
    allowed: ['0', '1'],
    default: '1'
  },
  library_require_category: {
    label: 'Require a category for every Library document',
    allowed: ['0', '1'],
    default: '1'
  },
  library_max_file_mb: {
    label: 'Largest Library document (MB)',
    kind: 'size',
    default: '512'
  },
  // Weekly teacher constraints. Enabled, teachers may declare hard (unavailable)
  // and soft (not recommended) windows for each study week. Forced makes the
  // chosen policy binding on every scheduler; otherwise each scheduler picks
  // between hard only, hard + selected soft, and all constraints.
  teacher_constraints_enabled: {
    label: 'Weekly teacher constraints',
    allowed: ['0', '1'],
    default: '1'
  },
  teacher_constraints_forced: {
    label: 'Force the constraint policy on schedulers',
    allowed: ['0', '1'],
    default: '0'
  },
  teacher_constraints_policy: {
    label: 'Teacher constraint policy',
    allowed: ['hard', 'some', 'all'],
    default: 'hard'
  },
  // Whether the Developer role may list and end other accounts' sessions. Off
  // by default: an administrator grants that reach explicitly. Every account
  // keeps its own sessions either way.
  developer_session_management: {
    label: 'Allow developers to manage user sessions',
    allowed: ['0', '1'],
    default: '0'
  }
}

export async function getAppOptions() {
  const res = await query('SELECT option_key, option_value, updated_at FROM app_option')
  const values = {}
  for (const key of Object.keys(OPTION_DEFINITIONS)) {
    values[key] = OPTION_DEFINITIONS[key].default
  }
  for (const row of res?.data || []) {
    if (OPTION_DEFINITIONS[row.OPTION_KEY]) {
      values[row.OPTION_KEY] = row.OPTION_VALUE
    }
  }
  return {
    data: Object.keys(OPTION_DEFINITIONS).map(key => ({
      OPTION_KEY: key,
      OPTION_VALUE: values[key],
      OPTION_LABEL: OPTION_DEFINITIONS[key].label,
      IS_DEFAULT: values[key] === OPTION_DEFINITIONS[key].default
    })),
    rowCount: Object.keys(OPTION_DEFINITIONS).length
  }
}

// The account's sign-in role, used to name the authority behind a decision.
// The exam marks lock is an academic act, so its entry records whether a
// Director or an Admin closed (or reopened) marks editing.
async function actorRoleCode(userId) {
  const id = parseInt(userId, 10)
  if (!id) return null
  const res = await query(
    `SELECT r.role_code
       FROM "user" u
       JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [id]
  )
  return res.data?.[0]?.ROLE_CODE || null
}

export async function setAppOption(key, value, userId = null) {
  const def = OPTION_DEFINITIONS[key]
  if (!def) {
    throw new Error(`Unknown setting "${key}".`)
  }

  // Locking or unlocking exam marks is never written anonymously: the audit
  // entry has to name the Director or Admin who decided it. The IPC handler
  // checks the same thing; this check keeps the guarantee if the option is
  // ever written from another path.
  const actorRole = key === 'exam_marks_locked' ? await actorRoleCode(userId) : null
  if (key === 'exam_marks_locked' && !['ADMIN', 'DIRECTOR'].includes(actorRole)) {
    throw new Error('Not allowed: the exam marks lock is changed by a signed-in Director or Admin.')
  }
  const v = String(value ?? '').trim()
  if (def.allowed) {
    if (!def.allowed.includes(v)) {
      throw new Error(`Invalid value "${v}" for "${key}": allowed values are ${def.allowed.join(', ')}.`)
    }
  } else if (def.kind === 'minutes' && (!/^\d+$/.test(v) || Number(v) > 1440)) {
    throw new Error(`Invalid value "${v}" for "${key}": use a whole number of minutes between 0 and 1440.`)
  } else if (def.kind === 'version' && v !== '' && !/^\d+(\.\d+){0,2}$/.test(v)) {
    throw new Error(`Invalid version "${v}" for "${key}": use a version such as 4.0.1, or leave it empty.`)
  } else if (def.kind === 'size' && (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 4096)) {
    throw new Error(`Invalid value "${v}" for "${key}": use a whole number of megabytes between 1 and 4096.`)
  }
  const prevRes = await query('SELECT option_value FROM app_option WHERE option_key = $1', [key])
  const before = prevRes.data?.[0]?.OPTION_VALUE ?? def.default

  await query(
    `INSERT INTO app_option (option_key, option_value, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (option_key) DO UPDATE SET option_value = EXCLUDED.option_value, updated_at = CURRENT_TIMESTAMP`,
    [key, v]
  )

  await recordAudit({
    actorUserId: userId,
    action: 'settings.option_change',
    entityType: 'setting',
    entityId: key,
    entityLabel: def.label,
    // The entry carries the account (resolved by recordAudit) and, for the
    // exam marks lock, the role that held the decision as well.
    ...(actorRole ? { detail: { option_key: key, actor_role: actorRole } } : {}),
    changes: { option_value: { before, after: v } }
  })
  return { key, value: v }
}

// ---- Beta testers -----------------------------------------------------------

// Every user account with its person name and roles, plus whether the account
// takes part in beta testing. Managed by an admin on the Options page.
export async function getBetaTesterUsers() {
  return await query(`
    SELECT u.user_id, u.user_username, u.user_email, u.is_active, u.is_beta_tester,
           u.created_at,
           COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
           p.person_first_name_la AS person_first_name_la,
           p.person_first_name_ar AS person_first_name_ar,
           COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
           p.person_last_name_la AS person_last_name_la,
           p.person_last_name_ar AS person_last_name_ar,
           COALESCE(string_agg(r.role_code, ', ' ORDER BY r.role_code), '') AS role_codes
    FROM "user" u
    LEFT JOIN person p ON p.person_id = u.person_id
    LEFT JOIN "role" r ON r.role_id = u.role_id
    GROUP BY u.user_id, COALESCE(p.person_first_name_la, p.person_first_name_ar),
             p.person_first_name_la, p.person_first_name_ar,
             COALESCE(p.person_last_name_la, p.person_last_name_ar),
             p.person_last_name_la, p.person_last_name_ar
    ORDER BY COALESCE(p.person_last_name_la, p.person_last_name_ar) NULLS LAST,
             COALESCE(p.person_first_name_la, p.person_first_name_ar), u.user_username`)
}

export async function setBetaTester(userId, enabled) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('User is required.')
  const res = await query(
    `UPDATE "user" SET is_beta_tester = $1 WHERE user_id = $2
     RETURNING user_id, is_beta_tester`,
    [!!enabled, id]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  return { success: true, isBetaTester: row.IS_BETA_TESTER }
}

// Fast internal reader for services: is exam marks editing locked?
// Whether a Developer may list and end every account's sessions. The user
// session service reads this on every management call, so revoking the switch
// takes effect immediately.
export async function isDeveloperSessionManagementAllowed() {
  const res = await query(
    `SELECT option_value FROM app_option
      WHERE option_key = 'developer_session_management'`
  )
  return res.data?.[0]?.OPTION_VALUE === '1'
}

export async function isExamMarksLocked() {
  const res = await query(
    `SELECT option_value FROM app_option WHERE option_key = 'exam_marks_locked'`
  )
  const v = res?.data?.[0]?.OPTION_VALUE
  return v === '1' || v === 'true'
}

// Fast internal reader for services: may a student record be deleted? The
// option is off only when an administrator set it to '0'; a missing row keeps
// the historical behaviour (deletion allowed).
export async function isStudentDeletionAllowed() {
  const res = await query(
    `SELECT option_value FROM app_option WHERE option_key = 'student_deletion_allowed'`
  )
  const v = res?.data?.[0]?.OPTION_VALUE
  return !(v === '0' || v === 'false')
}

// Minutes after a session begins during which a teacher may not remove a
// recorded absence. A missing row, 0 or an unreadable value all mean "no lock".
export async function getAbsenceRemovalLockMinutes() {
  const res = await query(
    `SELECT option_value FROM app_option WHERE option_key = 'absence_removal_lock_minutes'`
  )
  const minutes = Number(res?.data?.[0]?.OPTION_VALUE)
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.min(Math.floor(minutes), 1440)
}
