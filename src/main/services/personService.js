import { query } from '../db'
import { recordAudit } from './auditService'
import { loadScope, assertStudentAllowed } from './teachingScopeService'
import { isStudentDeletionAllowed } from './settingsService'
import { normalizeLatinNames } from '../../shared/personNames'
import { personIdError, personIdValue } from '../../shared/personId'
import { birthDateError } from '../../shared/studentDetailRules'

// Person names are stored in two variants (_la / _ar). Accept the legacy
// single-name keys from older renderers and treat them as the Latin name.
function normalizeNameKeys(personData) {
  const data = { ...personData }
  const move = (from, to) => {
    if (data[from] !== undefined && data[to] === undefined) data[to] = data[from]
    delete data[from]
  }
  move('PERSON_FIRST_NAME', 'PERSON_FIRST_NAME_LA')
  move('PERSON_LAST_NAME', 'PERSON_LAST_NAME_LA')
  move('person_first_name', 'person_first_name_la')
  move('person_last_name', 'person_last_name_la')
  return data
}

// '' -> null so optional fields (e.g. an empty birthdate) don't fail INSERT/UPDATE.
function sanitizePersonData(personData) {
  const lowerCaseData = {}
  for (const key in personData) {
    const value = personData[key]
    lowerCaseData[key.toLowerCase()] = value === '' ? null : value
  }
  return lowerCaseData
}

// Give a newly enrolled student a student_detail row, so they immediately
// appear in Student Records, the rewards and punishments pickers, etc. The row is keyed by
// the person it belongs to, and its birth date is taken from the person record
// rather than passed in, so assigning the role is enough on its own.
async function bootstrapStudentDetail(personId, run = query) {
  await run(
    `INSERT INTO student_detail (person_id, student_birth_date)
     VALUES ($1, (SELECT person_birthdate FROM person WHERE person_id = $1))
     ON CONFLICT (person_id) DO NOTHING`,
    [personId]
  )
}

export async function getPersons() {
  // v_person re-exposes IS_STUDENT / IS_TEACHER, computed from active
  // person_has_role rows (see v_person in deploy/server/schema.sql).
  return await query('SELECT * FROM v_person ORDER BY person_last_name, person_first_name')
}

// One query for the whole student roster with each student's current section
// (first section per student). Replaces the per-student getStudentSections
// round-trips that made the Student Directory issue N+1 IPC calls.
// "The student's information", field by field, for the register's completion
// column and its filter. Each entry is one item on the checklist: the record is
// complete when every one of them is filled, and the percentage is how many
// are. The checks only ask whether something is recorded — a blank string is
// not a value — and they are all fields the registration form collects, so a
// student registered from the form and not filled in further shows what is
// still missing.
//
// Each item also carries the key the record summary names it by: the roster
// returns the keys that are still empty, so the office can see which fields to
// fill instead of only how many. The renderer maps a key to a field label, so a
// key is part of the interface and is not renamed on its own.
export const STUDENT_INFORMATION_ITEMS = (() => {
  const filled = (expr) => `NULLIF(btrim((${expr})::text), '') IS NOT NULL`
  return [
    // Identity (person)
    { key: 'firstName', check: filled('COALESCE(p.person_first_name_la, p.person_first_name_ar)') },
    { key: 'lastName', check: filled('COALESCE(p.person_last_name_la, p.person_last_name_ar)') },
    { key: 'birthdate', check: filled('p.person_birthdate') },
    { key: 'sex', check: filled('p.person_sex') },
    { key: 'photo', check: filled('COALESCE(p.person_photo, sd.student_photo)') },
    // Placement
    { key: 'section', check: filled('s.SECTION_ID') },
    // Personal detail
    { key: 'birthPlace', check: filled('sd.student_birth_place_id') },
    { key: 'personalPhone', check: filled('sd.student_personal_phone') },
    { key: 'nationalId', check: filled('sd.student_national_identification_number') },
    { key: 'birthCertificate', check: filled('sd.student_birthdate_certificate_number') },
    { key: 'postalAccount', check: filled('sd.student_postal_account_number') },
    { key: 'baccalaureate', check: filled('sd.student_baccalaureate_sub_number') },
    { key: 'schoolSubCard', check: filled('sd.student_school_sub_card_number') },
    { key: 'schoolSubDate', check: filled('sd.student_school_sub_date') },
    { key: 'laptopSerial', check: filled('sd.student_laptop_serial_number') },
    { key: 'insuranceCard', check: filled('sd.student_insurance_card_number') },
    { key: 'militaryCard', check: filled('sd.student_military_card_number') },
    { key: 'militaryHelmet', check: filled('sd.student_military_helmet_number') },
    { key: 'bloodType', check: filled('sd.student_blood_type') },
    { key: 'height', check: filled('sd.student_height_cm') },
    { key: 'weight', check: filled('sd.student_weight_kg') },
    { key: 'healthStatus', check: filled('sd.student_health_status_id') },
    { key: 'speciality', check: filled('sd.student_speciality_id') },
    { key: 'academicLevel', check: filled('sd.student_academic_level_id') },
    { key: 'academicAverage', check: filled('sd.student_academic_average') },
    { key: 'recruitmentSource', check: filled('sd.student_recruitment_source_id') },
    // Family
    {
      key: 'father',
      check: `EXISTS (SELECT 1 FROM student_parent_info pi
              WHERE pi.person_id = p.PERSON_ID
                AND (NULLIF(btrim(pi.father_first_name_la), '') IS NOT NULL
                     OR NULLIF(btrim(pi.father_last_name_la), '') IS NOT NULL))`
    },
    {
      key: 'mother',
      check: `EXISTS (SELECT 1 FROM student_parent_info pi
              WHERE pi.person_id = p.PERSON_ID
                AND (NULLIF(btrim(pi.mother_first_name_la), '') IS NOT NULL
                     OR NULLIF(btrim(pi.mother_last_name_la), '') IS NOT NULL))`
    },
    // A contact on file. A foreign student keeps no emergency contacts, so
    // this item never counts against them.
    {
      key: 'emergencyContact',
      check: `(sd.student_is_foreign IS TRUE
      OR EXISTS (SELECT 1 FROM student_emergency_contact c
                 WHERE c.person_id = p.PERSON_ID
                   AND NULLIF(btrim(c.contact_phone_number), '') IS NOT NULL))`
    },
    { key: 'hobbies', check: `EXISTS (SELECT 1 FROM student_hobby sh WHERE sh.person_id = p.PERSON_ID)` },
    // Kit
    {
      key: 'combatOutfit',
      check: `EXISTS (SELECT 1 FROM student_combat_outfit co
              WHERE co.person_id = p.PERSON_ID
                AND NULLIF(btrim(co.first_outfit_number), '') IS NOT NULL)`
    },
    {
      key: 'paradeUniform',
      check: `EXISTS (SELECT 1 FROM student_parade_uniform pu
              WHERE pu.person_id = p.PERSON_ID
                AND NULLIF(btrim(pu.summer_shirt_size), '') IS NOT NULL)`
    }
  ]
})()

export async function getStudentsWithSections(userId) {
  // A restricted secretary's register contains only the students inside the
  // categories an admin gave them. Students from other categories are not
  // listed at all — they are not read-only, they are absent from the query.
  const scope = await loadScope(userId)

  return await query(`
    SELECT DISTINCT ON (p.PERSON_ID)
           p.*, s.SECTION_ID, s.section_label_en, s.section_label_ar, s.section_label_fr, s.SECTION_CODE,
           mg.military_grade_name_en, mg.military_grade_name_ar, mg.military_grade_name_fr,
           s.TEACHING_CATEGORY_ID, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr,
           sd.student_insurance_card_number, sd.student_military_card_number,
           sd.student_military_helmet_number,
           -- Completion of the student's file, for the office register (an
           -- admin and a secretary both see it): how many of the checklist
           -- items are recorded, the total, and the keys of the ones that are
           -- still empty so the record summary can name them.
           ${STUDENT_INFORMATION_ITEMS.map((item) => `(CASE WHEN ${item.check} THEN 1 ELSE 0 END)`).join(' + ')}
             AS INFO_FILLED,
           ${STUDENT_INFORMATION_ITEMS.length} AS INFO_TOTAL,
           array_remove(ARRAY[
             ${STUDENT_INFORMATION_ITEMS.map((item) => `CASE WHEN ${item.check} THEN NULL ELSE '${item.key}' END`).join(',\n             ')}
           ]::text[], NULL) AS INFO_MISSING
    FROM v_person p
    LEFT JOIN military_grade mg ON mg.military_grade_id = COALESCE(p.person_grade_id, p.military_grade_id)
    LEFT JOIN student_detail sd ON sd.person_id = p.PERSON_ID
    LEFT JOIN student_section ss ON ss.PERSON_ID = p.PERSON_ID
    LEFT JOIN section s ON ss.SECTION_ID = s.SECTION_ID
    LEFT JOIN teaching_category tc ON s.TEACHING_CATEGORY_ID = tc.TEACHING_CATEGORY_ID
    LEFT JOIN LATERAL (
      SELECT sc.teaching_category_id
      FROM student_section ss2
      JOIN section sc ON sc.section_id = ss2.section_id
      WHERE ss2.person_id = p.PERSON_ID
      ORDER BY sc.section_label_en, sc.section_label_ar, sc.section_label_fr, sc.section_id
      LIMIT 1
    ) pick ON TRUE
    WHERE p.IS_STUDENT = TRUE
      AND (NOT $1::boolean
           OR COALESCE(s.teaching_category_id, pick.teaching_category_id) = ANY($2::int[]))
    ORDER BY p.PERSON_ID,
             CASE WHEN s.teaching_category_id = ANY($2::int[]) THEN 0 ELSE 1 END,
             s.section_label_en, s.section_label_ar, s.section_label_fr
  `, [!!scope.restricted, scope.categoryIds || []])
}

export async function getTeachers() {
  const result = await getPersons()
  if (!result || !result.data) return { source: 'postgres', data: [] }
  
  const teachers = result.data.filter(p => {
    const isTeacher = p.IS_TEACHER || p.is_teacher
    return isTeacher === true || isTeacher === 1 || isTeacher === '1' || isTeacher === 'true'
  })
  
  return { ...result, data: teachers }
}

// Everyone who works here: the person records that carry a teaching or a staff
// role, with the roles that are active today. A person's role lives in two
// places, so both are read: person_has_role describes the person (any role,
// including the staff ones), while the role a sign-in account holds decides
// what that login may reach. The page reports who somebody is in the
// institution, not which table happens to describe them.
//
// A person can be a student and a teacher at the same time, so studenthood
// alone does not take somebody off this page: whoever also holds a teaching
// role or an account stays, and is shown with both roles.
export async function getPersonnel() {
  const result = await query(`
    SELECT p.*,
           COALESCE(pr.role_codes, '{}') AS PERSON_ROLE_CODES,
           COALESCE(ur.role_codes, '{}') AS ACCOUNT_ROLE_CODES,
           (ur.user_id IS NOT NULL) AS HAS_ACCOUNT,
           COALESCE(ur.account_count, 0) AS EXISTING_ACCOUNTS,
           -- The department belongs to the TEACHER role row (person_has_role),
           -- not to the account: a teacher without a login still belongs to a
           -- department, and an account can carry only one role anyway.
           tdr.department_id AS TEACHER_DEPARTMENT_ID,
           d.department_code,
           d.department_label_en,
           d.department_label_ar,
           d.department_label_fr,
           dir.direction_code,
           dir.direction_label_en,
           dir.direction_label_ar,
           dir.direction_label_fr
      FROM v_person p
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT r.role_code) AS role_codes
          FROM person_has_role phr
          JOIN "role" r ON r.role_id = phr.role_id
         WHERE phr.person_id = p.person_id
           AND phr.role_end_date IS NULL
      ) pr ON TRUE
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT r.role_code) AS role_codes, max(u.user_id) AS user_id,
               count(*)::int AS account_count
          FROM "user" u
          LEFT JOIN "role" r ON r.role_id = u.role_id
         WHERE u.person_id = p.person_id
      ) ur ON TRUE
      LEFT JOIN LATERAL (
        SELECT phr.department_id
          FROM person_has_role phr
          JOIN "role" r ON r.role_id = phr.role_id
         WHERE phr.person_id = p.person_id
           AND r.role_code = 'TEACHER'
           AND phr.role_end_date IS NULL
         ORDER BY phr.role_start_date DESC
         LIMIT 1
      ) tdr ON TRUE
      LEFT JOIN department d ON d.department_id = tdr.department_id
      LEFT JOIN direction dir ON dir.direction_id = d.direction_id
     WHERE NOT p.is_student
        OR COALESCE(pr.role_codes, '{}') && ARRAY['TEACHER', 'DIRECTOR', 'SECRETARY', 'ADMIN', 'SCHEDULER', 'DEVELOPER']
        OR ur.user_id IS NOT NULL
     ORDER BY p.person_last_name, p.person_first_name`)

  // The two stores can be asked the same question and answer differently: an
  // account may carry TEACHER or STUDENT while the person's own record does not
  // have that role. The app reads whichever store the question belongs to — the
  // account role for what a login may reach, the person roles for who somebody
  // is — so the disagreement would otherwise stay invisible. The page reports
  // it, and the reader settles it on one side or the other.
  //
  // The mismatched codes travel with the row as well: the card names the exact
  // role that is on the account and missing from the record, and settles it by
  // recording that role on the person (a person-side write, so no permission
  // changes anywhere and the account keeps signing in as it does).
  for (const row of result.data || []) {
    const personRoles = row.PERSON_ROLE_CODES || []
    const accountRoles = row.ACCOUNT_ROLE_CODES || []
    row.ROLE_CONFLICT_ROLES = accountRoles.filter(
      (code) => PERSON_ROLE_CODES.includes(code) && !personRoles.includes(code)
    )
    row.ROLE_CONFLICT = row.ROLE_CONFLICT_ROLES.length > 0
  }

  return result
}

// The roles a person record can carry. They all describe who somebody is in
// the institution; none of them grants a sign-in account any authority — every
// permission is read from user.role_id.
export const PERSON_ROLE_CODES = [
  'STUDENT', 'TEACHER', 'DIRECTOR', 'SECRETARY', 'SCHEDULER', 'ADMIN', 'DEVELOPER'
]

function assertKnownRole(roleCode) {
  const code = String(roleCode || '').toUpperCase()
  if (!PERSON_ROLE_CODES.includes(code)) {
    throw new Error(`Unknown person role: ${roleCode}`)
  }
  return code
}

// Changing who somebody is in the school is an administrative act, so the
// acting account is re-read here rather than trusted from the caller. This is
// the same rule every other personnel endpoint applies to its writes.
async function requireAdminId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query(
    `SELECT 1
       FROM "user" u
       JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1 AND r.role_code = 'ADMIN'
      LIMIT 1`,
    [id]
  )
  if (res.rowCount === 0) {
    throw new Error('Not allowed: changing person roles requires the Admin role.')
  }
  return id
}

// Roles are rows, not flags: an active role is a person_has_role row with no
// end date. Assigning a role somebody already holds changes nothing, and the
// two roles are applied independently, so a person can hold both at once
// without either assignment touching the other.
//
// This is the bare write, with no permission check: the personnel page checks
// the Admin role itself before calling it, and account creation uses it to
// record the account's role on the person too, so the two stores cannot
// disagree about who somebody is.
export async function grantPersonRole(personId, roleCode, run = query) {
  const code = assertKnownRole(roleCode)
  const targetId = parseInt(personId, 10)
  if (!targetId) throw new Error('Select the person whose role you want to change.')

  // The person must exist: a sentence beats the foreign-key error the INSERT
  // would raise.
  const target = await run('SELECT 1 FROM person WHERE person_id = $1', [targetId])
  if (target.rowCount === 0) throw new Error('That person no longer exists.')

  // The NOT EXISTS keeps a second active row out on a database that predates
  // person_has_role_active_role_uniq; the ON CONFLICT covers the index once it
  // is in place.
  try {
    await run(
      `INSERT INTO person_has_role (person_id, role_id)
       SELECT $1, r.role_id
         FROM role r
        WHERE r.role_code = $2
          AND NOT EXISTS (
            SELECT 1 FROM person_has_role
             WHERE person_id = $1 AND role_id = r.role_id AND role_end_date IS NULL
          )
       ON CONFLICT DO NOTHING`,
      [targetId, code]
    )
  } catch (error) {
    // A database that has not run 27-person-roles-all-codes.sql still carries
    // the trigger that closes person_has_role to TEACHER and STUDENT; the role
    // itself is valid, the schema is simply older.
    if (error?.code === '23514' || /person roles \(STUDENT, TEACHER\)|check_violation/i.test(String(error?.message))) {
      throw new Error(
        `This database still allows only Teacher and Student as person roles. Ask the administrator to run deploy/server/27-person-roles-all-codes.sql, then save again.`
      )
    }
    throw error
  }

  // Enrolling somebody also gives them their student file, so they appear in
  // Student Records and the rewards and punishments pickers straight away.
  if (code === 'STUDENT') await bootstrapStudentDetail(targetId, run)

  return code
}

export async function assignPersonRole(userId, personId, roleCode) {
  const actorId = await requireAdminId(userId)
  const code = await grantPersonRole(personId, roleCode)
  const targetId = parseInt(personId, 10)

  await recordAudit({
    actorUserId: actorId,
    action: 'person.role_assign',
    entityType: 'person',
    entityId: targetId,
    detail: { role: code }
  })

  return { success: true }
}

// Ending a role keeps the row as history: role_end_date IS NULL is what makes a
// role active, so a closed role stops counting everywhere without the record
// losing who the person was. The student file is left in place for the same
// reason — it is the record of what happened, not a live permission.
export async function endPersonRole(userId, personId, roleCode) {
  const actorId = await requireAdminId(userId)
  const code = assertKnownRole(roleCode)
  const targetId = parseInt(personId, 10)
  if (!targetId) throw new Error('Select the person whose role you want to change.')

  await query(
    `UPDATE person_has_role
        SET role_end_date = CURRENT_DATE
      WHERE person_id = $1
        AND role_end_date IS NULL
        AND role_id = (SELECT role_id FROM role WHERE role_code = $2)`,
    [targetId, code]
  )

  await recordAudit({
    actorUserId: actorId,
    action: 'person.role_end',
    entityType: 'person',
    entityId: targetId,
    detail: { role: code }
  })

  return { success: true }
}

// The department a teacher belongs to is stored on their active TEACHER row in
// person_has_role (20-drop-service-teacher-department.sql). It is deliberately
// not read from user.role_id: that is the sign-in account's role, so it exists
// only for people who have an account and cannot describe a teacher who does
// not. Passing null clears the assignment; the row itself (and its dates) stays.
export async function setPersonDepartment(userId, personId, departmentId) {
  const actorId = await requireAdminId(userId)
  const targetId = parseInt(personId, 10)
  if (!targetId) throw new Error('Select the person whose department you want to change.')

  const empty = departmentId === null || departmentId === undefined || String(departmentId).trim() === ''
  const wanted = empty ? null : parseInt(departmentId, 10)
  if (!empty && !wanted) throw new Error('Select a valid department.')

  if (wanted !== null) {
    const department = await query('SELECT 1 FROM department WHERE department_id = $1', [wanted])
    if (department.rowCount === 0) throw new Error('That department no longer exists.')
  }

  const teacher = await query(
    `SELECT 1
       FROM person_has_role phr
       JOIN "role" r ON r.role_id = phr.role_id
      WHERE phr.person_id = $1
        AND r.role_code = 'TEACHER'
        AND phr.role_end_date IS NULL
      LIMIT 1`,
    [targetId]
  )
  if (teacher.rowCount === 0) {
    throw new Error('Only a person who currently holds the Teacher role can belong to a department.')
  }

  await query(
    `UPDATE person_has_role
        SET department_id = $2
      WHERE person_id = $1
        AND role_end_date IS NULL
        AND role_id = (SELECT role_id FROM role WHERE role_code = 'TEACHER')`,
    [targetId, wanted]
  )

  await recordAudit({
    actorUserId: actorId,
    action: 'person.department_set',
    entityType: 'person',
    entityId: targetId,
    detail: { departmentId: wanted }
  })

  return { success: true }
}

export async function createPerson(personData, run = query) {
  const lowerCaseData = sanitizePersonData(normalizeNameKeys(normalizeLatinNames(personData)))

  // is_student / is_teacher were never columns: what a person is in the school
  // is their roles, and those are rows set by assignPersonRole once the record
  // exists. An older payload still carrying the flags must not fail the INSERT,
  // and must not decide roles here either — a form that knows one role would
  // otherwise clear the other.
  delete lowerCaseData.is_student
  delete lowerCaseData.is_teacher

  // A birth date has to be a real past date. The column has no CHECK for it
  // because CURRENT_DATE is not immutable in PostgreSQL, so the rule is answered
  // here (see shared/studentDetailRules.js).
  const birthProblem = birthDateError(lowerCaseData.person_birthdate)
  if (birthProblem) throw new Error(birthProblem)

  // person_id is typed in by whoever registers the person, not generated:
  // the column has no sequence default any more (11-person-id-manual.sql).
  // Checking it here turns a missing or malformed id into a plain sentence
  // instead of the NOT NULL the INSERT would raise.
  const idError = personIdError(lowerCaseData.person_id)
  if (idError) throw new Error(idError)
  lowerCaseData.person_id = personIdValue(lowerCaseData.person_id)

  // The id is the primary key, so a number already in use is refused by the
  // database; asking first lets the message name the field that is the problem.
  const taken = await run('SELECT 1 FROM person WHERE person_id = $1', [lowerCaseData.person_id])
  if (taken.data?.length) throw new Error('A person with this ID already exists.')

  const columns = Object.keys(lowerCaseData).join(', ')
  const placeholders = Object.keys(lowerCaseData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(lowerCaseData)

  const sql = `INSERT INTO person (${columns}) VALUES (${placeholders}) RETURNING person_id`
  const result = await run(sql, values)

  return { ...personData, PERSON_ID: result.data?.[0]?.PERSON_ID }
}

export async function updatePerson(userId, id, personData) {
  // Editing a student is limited to the teaching categories the acting
  // secretary is responsible for; admins are never restricted.
  await assertStudentAllowed(await loadScope(userId), id)

  const lowerCaseData = sanitizePersonData(normalizeNameKeys(normalizeLatinNames(personData)))

  // Roles are changed with assignPersonRole / endPersonRole, never as a side
  // effect of saving the record (see createPerson).
  delete lowerCaseData.is_student
  delete lowerCaseData.is_teacher

  // A saved birth date has to be a real past date, like a new one.
  const birthProblem = birthDateError(lowerCaseData.person_birthdate)
  if (birthProblem) throw new Error(birthProblem)

  // A corrected id is saved like any other field. The foreign keys that point
  // at person cascade on update, so the person's rows follow the new number
  // (11-person-id-manual.sql). An id that did not change is left out of the
  // statement, so an ordinary save does not rewrite every child row — and a
  // record that predates the twelve-digit rule keeps its short id untouched.
  // The id the row ends up with: the one it had, unless a corrected one was
  // saved. Callers write the person's child rows after this, and they need the
  // new key rather than the one they asked with.
  let savedId = Number(id)
  if (lowerCaseData.person_id !== undefined) {
    const idError = personIdError(lowerCaseData.person_id)
    if (idError) throw new Error(idError)
    const nextId = personIdValue(lowerCaseData.person_id)
    if (nextId === Number(id)) {
      delete lowerCaseData.person_id
    } else {
      const taken = await query('SELECT 1 FROM person WHERE person_id = $1', [nextId])
      if (taken.data?.length) throw new Error('A person with this ID already exists.')
      lowerCaseData.person_id = nextId
      savedId = nextId
    }
  }

  const keys = Object.keys(lowerCaseData)
  if (keys.length > 0) {
    const pgColumns = keys.map((col, i) => `${col} = $${i + 1}`).join(', ')
    const values = [...Object.values(lowerCaseData), id]
    await query(`UPDATE person SET ${pgColumns} WHERE person_id = $${values.length}`, values)
  }

  return { ...personData, PERSON_ID: savedId }
}

export async function deletePerson(userId, id) {
  await assertStudentAllowed(await loadScope(userId), id)

  const who = await query(
    `SELECT p.person_first_name_la, p.person_last_name_la,
            (COALESCE(v.IS_STUDENT, FALSE) OR sd.person_id IS NOT NULL) AS is_student
     FROM person p
     LEFT JOIN v_person v ON v.PERSON_ID = p.person_id
     LEFT JOIN student_detail sd ON sd.person_id = p.person_id
     WHERE p.person_id = $1`,
    [id]
  )
  const label = [who.data?.[0]?.PERSON_FIRST_NAME_LA, who.data?.[0]?.PERSON_LAST_NAME_LA]
    .filter(Boolean)
    .join(' ')

  // The Admin decides on the Settings page whether students may be deleted at
  // all. Enforced here, so the rule holds even against a modified client; the
  // option covers students only — deleting a teacher or another person stays
  // possible.
  if (who.data?.[0]?.IS_STUDENT && !(await isStudentDeletionAllowed())) {
    throw new Error('Not allowed: an administrator has turned off student deletion. Ask an Admin to enable it in Settings.')
  }

  await query('DELETE FROM person WHERE person_id = $1', [id])

  await recordAudit({
    actorUserId: userId,
    action: 'person.delete',
    entityType: 'person',
    entityId: id,
    entityLabel: label || null
  })
  return { success: true }
}
