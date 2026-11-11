import { query } from '../db'
import { recordAudit } from './auditService'
import { notifySecretaryCategoriesChanged, notifySchedulerDepartmentsChanged } from './notificationScanService'
import { loadRewardsPunishmentsPermissions } from './secretaryService'

// Teaching-category responsibility for secretary and scheduler accounts.
//
// A student's teaching category comes from their section
// (section.teaching_category_id). An ADMIN decides, per account, which
// categories that secretary or scheduler is responsible for; the rows live in
// user_teaching_category_scope.
//
// A secretary without the ADMIN role may then only register a student into one
// of their categories, and may only edit or delete a student who already sits in
// one of them. The rules are enforced here, on the server, and are re-checked on
// every write — the UI only filters what it offers.
//
// Accounts with no rows are responsible for nothing (they cannot add students
// until the admin gives them a category). ADMIN accounts are never restricted.

async function loadUser(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const res = await query(
    `SELECT u.user_id, u.person_id, u.is_active,
            COALESCE(array_agg(r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
     FROM "user" u
     LEFT JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1
     GROUP BY u.user_id, u.person_id, u.is_active`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  if (row.IS_ACTIVE === false) throw new Error('Not allowed: this account is inactive.')
  return { userId: row.USER_ID, personId: row.PERSON_ID, roles: row.ROLES || [] }
}

async function loadCategoryIds(userId) {
  const res = await query(
    'SELECT teaching_category_id FROM user_teaching_category_scope WHERE user_id = $1',
    [userId]
  )
  return (res.data || []).map(r => r.TEACHING_CATEGORY_ID)
}

// Scheduler department scope. The rows live in user_department_scope; a
// scheduler's department reach is combined with the teaching-category reach
// above, never substituted for it.
async function loadDepartmentIds(userId) {
  const res = await query(
    'SELECT department_id FROM user_department_scope WHERE user_id = $1',
    [userId]
  )
  return (res.data || []).map(r => r.DEPARTMENT_ID)
}

// The major categories owned by the scheduler's departments. This is the form
// the schedule checks use: a group's major names one major category.
async function loadMajorCategoryIds(userId) {
  const res = await query(
    `SELECT DISTINCT d.major_category_id
       FROM user_department_scope uds
       JOIN department d ON d.department_id = uds.department_id
      WHERE uds.user_id = $1 AND d.major_category_id IS NOT NULL`,
    [userId]
  )
  return (res.data || []).map(r => r.MAJOR_CATEGORY_ID)
}

// The acting account plus its restriction:
// { restricted, categoryIds, departmentRestricted, departmentIds, majorCategoryIds }.
export async function loadScope(userId) {
  const user = await loadUser(userId)
  const isScheduler = user.roles.includes('SCHEDULER')
  const restricted =
    !user.roles.includes('ADMIN') && (user.roles.includes('SECRETARY') || isScheduler)
  const categoryIds = restricted ? await loadCategoryIds(user.userId) : []
  const departmentRestricted = restricted && isScheduler
  const departmentIds = departmentRestricted ? await loadDepartmentIds(user.userId) : []
  const majorCategoryIds = departmentRestricted ? await loadMajorCategoryIds(user.userId) : []
  return {
    ...user,
    restricted,
    categoryIds,
    departmentRestricted,
    departmentIds,
    majorCategoryIds
  }
}

// Scope is always resolved from an account, never from a person.
//
// A person may hold several accounts (10-allow-multiple-accounts.sql),
// and the roles and teaching categories belong to the account: a director login
// and a secretary login of the same person are not interchangeable. Resolving
// "the account of this person" would therefore mean picking one arbitrarily —
// the wrong one could lift a category restriction, or apply one the signed-in
// account does not have. A caller that only knows the person id must be changed
// to pass the account id it already holds.

// What the renderer needs to filter its pickers.
export async function getMyTeachingScope(userId) {
  const scope = await loadScope(userId)

  let categories = []
  if (scope.restricted) {
    const res = await query(
      `SELECT tc.teaching_category_id, tc.teaching_category_code, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr
       FROM user_teaching_category_scope utcs
       JOIN teaching_category tc ON tc.teaching_category_id = utcs.teaching_category_id
       WHERE utcs.user_id = $1
       ORDER BY tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr`,
      [scope.userId]
    )
    categories = res.data || []
  }

  let departments = []
  if (scope.departmentRestricted) {
    const res = await query(
      `SELECT d.department_id, d.department_code,
              d.department_label_en, d.department_label_ar, d.department_label_fr,
              d.major_category_id,
              mc.major_category_code,
              mc.major_category_label_en, mc.major_category_label_ar, mc.major_category_label_fr
       FROM user_department_scope uds
       JOIN department d ON d.department_id = uds.department_id
       LEFT JOIN major_category mc ON mc.major_category_id = d.major_category_id
       WHERE uds.user_id = $1
       ORDER BY d.department_label_en, d.department_label_ar, d.department_label_fr`,
      [scope.userId]
    )
    departments = res.data || []
  }

  return {
    success: true,
    restricted: scope.restricted,
    categoryIds: scope.categoryIds,
    departmentRestricted: scope.departmentRestricted,
    departmentIds: scope.departmentIds,
    majorCategoryIds: scope.majorCategoryIds,
    categories,
    departments,
    // What this account may do to the conduct ledger (an admin: everything).
    permissions: await loadRewardsPunishmentsPermissions(scope)
  }
}

// The student's teaching category, through the open placement in
// student_section_history (falling back to the first recorded membership).
export async function getStudentCategory(personId) {
  const res = await query(
    `SELECT sd.person_id,
            COALESCE(s.teaching_category_id, pick.teaching_category_id) AS category_id,
            COALESCE(s.section_id, pick.section_id) AS section_id
     FROM student_detail sd
     LEFT JOIN student_section_history h
            ON h.person_id = sd.person_id AND h.ended_at IS NULL
     LEFT JOIN section s ON s.section_id = h.section_id
     LEFT JOIN LATERAL (
       SELECT ss.section_id, sc.teaching_category_id
       FROM student_section ss
       JOIN section sc ON sc.section_id = ss.section_id
       WHERE ss.person_id = sd.person_id
       ORDER BY sc.section_label_en, sc.section_label_ar, sc.section_label_fr, sc.section_id
       LIMIT 1
     ) pick ON TRUE
     WHERE sd.person_id = $1`,
    [parseInt(personId, 10) || 0]
  )
  const row = res.data?.[0]
  if (!row) return null
  return {
    personId: row.PERSON_ID,
    categoryId: row.CATEGORY_ID === undefined ? null : row.CATEGORY_ID,
    sectionId: row.SECTION_ID === undefined ? null : row.SECTION_ID
  }
}

function scopeError(what) {
  return new Error(`Not allowed: ${what}`)
}

// Throws unless the acting account may put a student in these sections.
// Restricted accounts must pick at least one of their own categories.
export async function assertSectionsAllowed(scope, sectionIds) {
  if (!scope?.restricted) return
  const ids = [...new Set((sectionIds || []).map(v => parseInt(v, 10)).filter(Boolean))]

  if (ids.length === 0) {
    throw scopeError('choose a section inside one of the teaching categories you are responsible for.')
  }

  const res = await query(
    `SELECT section_id, COALESCE(section_label_en, section_label_ar, section_label_fr) AS section_label, teaching_category_id FROM section
     WHERE section_id = ANY($1::int[])`,
    [ids]
  )
  const rows = res.data || []
  if (rows.length !== ids.length) throw new Error('One of the chosen sections no longer exists.')

  const outside = rows.filter(
    r => r.TEACHING_CATEGORY_ID === null || !scope.categoryIds.includes(r.TEACHING_CATEGORY_ID)
  )
  if (outside.length > 0) {
    const labels = outside.map(r => r.SECTION_LABEL || `#${r.SECTION_ID}`).join(', ')
    throw scopeError(`${labels} is outside the teaching categories you are responsible for.`)
  }
}

// Throws unless the acting account may edit this student. Non-students are not
// restricted here (the rule is about student categories).
export async function assertStudentAllowed(scope, personId) {
  if (!scope?.restricted) return
  const student = await getStudentCategory(personId)
  if (!student) return

  if (student.categoryId === null || !scope.categoryIds.includes(student.categoryId)) {
    throw scopeError(
      "this student is not in a teaching category you are responsible for. Ask an administrator to widen your scope."
    )
  }
}

// Same rule for a whole batch, in one query: a bulk action either covers every
// chosen student or none of them. Without this, one out-of-scope student in the
// list would silently write a row for everybody else.
export async function assertStudentsAllowed(scope, personIds) {
  const ids = [...new Set((personIds || []).map(v => parseInt(v, 10)).filter(Boolean))]
  if (ids.length === 0) throw new Error('Choose at least one student.')
  if (!scope?.restricted) return

  const res = await query(
    `SELECT sd.person_id,
            COALESCE(s.teaching_category_id, pick.teaching_category_id) AS category_id
     FROM student_detail sd
     LEFT JOIN student_section_history h
            ON h.person_id = sd.person_id AND h.ended_at IS NULL
     LEFT JOIN section s ON s.section_id = h.section_id
     LEFT JOIN LATERAL (
       SELECT sc.teaching_category_id
       FROM student_section ss
       JOIN section sc ON sc.section_id = ss.section_id
       WHERE ss.person_id = sd.person_id
       ORDER BY sc.section_label_en, sc.section_label_ar, sc.section_label_fr, sc.section_id
       LIMIT 1
     ) pick ON TRUE
     WHERE sd.person_id = ANY($1::bigint[])`,
    [ids]
  )

  const allowed = new Set(
    (res.data || [])
      .filter(r => r.CATEGORY_ID !== null && scope.categoryIds.includes(r.CATEGORY_ID))
      .map(r => r.PERSON_ID)
  )
  const refused = ids.filter(id => !allowed.has(id))
  if (refused.length > 0) {
    throw scopeError(
      `${refused.length === 1 ? 'one of these students is' : `${refused.length} of these students are`} outside the teaching categories you are responsible for.`
    )
  }
}

// ---- Schedule scope -------------------------------------------------------

// The teaching category and major category a group belongs to. Every weekly
// session sits in a group, so these two values tie a session to both halves of
// a scheduler's scope.
async function getTeachingGroupScope(teachingGroupId) {
  const id = parseInt(teachingGroupId, 10)
  if (!id) return null
  const res = await query(
    `SELECT tg.teaching_category_id, m.major_category_id
       FROM teaching_group tg
       LEFT JOIN major m ON m.major_id = tg.major_id
      WHERE tg.teaching_group_id = $1`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) return null
  return {
    categoryId: row.TEACHING_CATEGORY_ID === undefined ? null : row.TEACHING_CATEGORY_ID,
    majorCategoryId: row.MAJOR_CATEGORY_ID === undefined ? null : row.MAJOR_CATEGORY_ID
  }
}

// The teaching category a group belongs to; null until an administrator
// assigns one.
export async function getTeachingGroupCategory(teachingGroupId) {
  const group = await getTeachingGroupScope(teachingGroupId)
  return group ? group.categoryId : null
}

// A group being created has no row yet, so the scheduler's department reach is
// checked against the major it will be attached to.
export async function assertMajorAllowed(scope, majorId) {
  if (!scope?.departmentRestricted) return
  const id = parseInt(majorId, 10)
  if (!id) {
    throw scopeError('choose a major inside one of the departments you are responsible for.')
  }
  const res = await query('SELECT major_category_id FROM major WHERE major_id = $1', [id])
  const row = res.data?.[0]
  if (!row) throw new Error('That major no longer exists.')
  const majorCategoryId = row.MAJOR_CATEGORY_ID === undefined ? null : row.MAJOR_CATEGORY_ID
  if (majorCategoryId === null || !scope.majorCategoryIds.includes(majorCategoryId)) {
    throw scopeError('this major is outside the departments you are responsible for.')
  }
}

// Throws unless the acting account may schedule in this teaching group. A group
// with no category or no major category belongs to nobody yet, so only an
// administrator can use it. A scheduler must satisfy both scopes.
export async function assertTeachingGroupAllowed(scope, teachingGroupId) {
  if (!scope?.restricted) return
  const group = await getTeachingGroupScope(teachingGroupId)
  if (!group) throw new Error('That teaching group no longer exists.')
  if (group.categoryId === null || !scope.categoryIds.includes(group.categoryId)) {
    throw scopeError('this teaching group is outside the teaching categories you are responsible for.')
  }
  if (scope.departmentRestricted &&
      (group.majorCategoryId === null || !scope.majorCategoryIds.includes(group.majorCategoryId))) {
    throw scopeError('this teaching group is outside the departments you are responsible for.')
  }
}

// Same rule for a session that already exists (its scopes come through the
// group it sits in). Checked before a delete, so a scheduler cannot remove a
// session outside their categories or departments.
export async function assertStudySessionAllowed(scope, sessionId) {
  if (!scope?.restricted) return
  const res = await query(
    `SELECT tg.teaching_category_id, m.major_category_id
       FROM study_session s
       LEFT JOIN teaching_group tg ON tg.teaching_group_id = s.teaching_group_id
       LEFT JOIN major m ON m.major_id = tg.major_id
      WHERE s.study_session_id = $1`,
    [parseInt(sessionId, 10) || 0]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('That session no longer exists.')
  if (row.TEACHING_CATEGORY_ID === null || !scope.categoryIds.includes(row.TEACHING_CATEGORY_ID)) {
    throw scopeError('this session is outside the teaching categories you are responsible for.')
  }
  if (scope.departmentRestricted &&
      (row.MAJOR_CATEGORY_ID === null || !scope.majorCategoryIds.includes(row.MAJOR_CATEGORY_ID))) {
    throw scopeError('this session is outside the departments you are responsible for.')
  }
}

// ---- Admin: assign responsibilities -----------------------------------------

async function requireAdmin(userId) {
  const user = await loadUser(userId)
  if (!user.roles.includes('ADMIN')) {
    throw new Error('Not allowed: only an administrator can change teaching-category responsibilities.')
  }
  return user
}

// Replace one account's categories with exactly this set. The same rows scope a
// secretary's students and a scheduler's weekly schedule.
export async function setAccountCategories(adminUserId, secretaryUserId, categoryIds) {
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

  const ids = [...new Set((categoryIds || []).map(v => parseInt(v, 10)).filter(Boolean))]
  if (ids.length > 0) {
    const known = await query(
      'SELECT teaching_category_id FROM teaching_category WHERE teaching_category_id = ANY($1::int[])',
      [ids]
    )
    if ((known.data || []).length !== ids.length) {
      throw new Error('One of the chosen teaching categories no longer exists.')
    }
  }

  // Saving the same set again is not news: only a real change is announced.
  const existing = (await query(
    'SELECT teaching_category_id FROM user_teaching_category_scope WHERE user_id = $1',
    [targetId]
  )).data?.map((row) => row.TEACHING_CATEGORY_ID) || []
  const unchanged = existing.length === ids.length && existing.every((id) => ids.includes(id))
  if (unchanged) return { success: true, userId: targetId, categoryIds: ids }

  await query('DELETE FROM user_teaching_category_scope WHERE user_id = $1', [targetId])
  for (const categoryId of ids) {
    await query(
      'INSERT INTO user_teaching_category_scope (user_id, teaching_category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [targetId, categoryId]
    )
  }

  // The secretary's reach changed, and they are the one who has to know.
  const labels = ids.length
    ? (await query(
        'SELECT COALESCE(teaching_category_label_en, teaching_category_label_ar, teaching_category_label_fr) AS teaching_category_label FROM teaching_category WHERE teaching_category_id = ANY($1::int[]) ORDER BY 1',
        [ids]
      )).data?.map((row) => row.TEACHING_CATEGORY_LABEL)
    : []
  await notifySecretaryCategoriesChanged(targetId, labels)

  await recordAudit({
    actorUserId: adminUserId,
    action: 'permission.teaching_scope',
    entityType: 'user',
    entityId: targetId,
    entityLabel: labels.length ? labels.join(', ') : null,
    changes: { teaching_category_ids: { before: existing, after: ids } }
  })

  return { success: true, userId: targetId, categoryIds: ids }
}

// Replace one scheduler's departments with exactly this set. Department scope is
// combined with the teaching-category scope above: both must allow a group.
export async function setAccountDepartments(adminUserId, schedulerUserId, departmentIds) {
  const admin = await requireAdmin(adminUserId)

  const targetId = parseInt(schedulerUserId, 10)
  if (!targetId) throw new Error('Select a scheduler account.')

  const target = await query(
    `SELECT u.user_id FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id AND r.role_code = 'SCHEDULER'
     WHERE u.user_id = $1
     LIMIT 1`,
    [targetId]
  )
  if (target.rowCount === 0) throw new Error('That account is not a scheduler.')

  const ids = [...new Set((departmentIds || []).map(v => parseInt(v, 10)).filter(Boolean))]
  if (ids.length > 0) {
    const known = await query(
      'SELECT department_id FROM department WHERE department_id = ANY($1::int[])',
      [ids]
    )
    if ((known.data || []).length !== ids.length) {
      throw new Error('One of the chosen departments no longer exists.')
    }
  }

  const existing = (await query(
    'SELECT department_id FROM user_department_scope WHERE user_id = $1',
    [targetId]
  )).data?.map((row) => row.DEPARTMENT_ID) || []
  const unchanged = existing.length === ids.length && existing.every((id) => ids.includes(id))
  if (unchanged) return { success: true, userId: targetId, departmentIds: ids }

  await query('DELETE FROM user_department_scope WHERE user_id = $1', [targetId])
  for (const departmentId of ids) {
    await query(
      `INSERT INTO user_department_scope (user_id, department_id, granted_by_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [targetId, departmentId, admin.userId]
    )
  }

  const labels = ids.length
    ? (await query(
        `SELECT COALESCE(department_label_en, department_label_ar, department_label_fr) AS department_label
           FROM department
          WHERE department_id = ANY($1::int[])
          ORDER BY 1`,
        [ids]
      )).data?.map((row) => row.DEPARTMENT_LABEL)
    : []
  await notifySchedulerDepartmentsChanged(targetId, labels)

  await recordAudit({
    actorUserId: adminUserId,
    action: 'permission.department_scope',
    entityType: 'user',
    entityId: targetId,
    entityLabel: labels.length ? labels.join(', ') : null,
    changes: { department_ids: { before: existing, after: ids } }
  })

  return { success: true, userId: targetId, departmentIds: ids }
}
