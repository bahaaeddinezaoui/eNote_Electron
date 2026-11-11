import { query, withTransaction } from '../db'
import { diffRow, recordAudit } from './auditService'
import { loadScope, assertSectionsAllowed, assertStudentAllowed } from './teachingScopeService'
import { formatLatinFirstName, formatLatinLastName, normalizeLatinNames } from '../../shared/personNames'
import { personIdError, personIdValue } from '../../shared/personId'
import { familyCountErrors, birthDateError, schoolSubDateError } from '../../shared/studentDetailRules'
import { COMBAT_UNIFORM_FIELDS, PARADE_UNIFORM_FIELDS, FEMALE_ONLY_UNIFORM_KEYS } from '../../shared/uniformSizes'
import { assertUniformSizes, requireUniformSizeSchema } from './uniformSizeService'

// ============================================================================
// Student personal-information service. Backs the secretary's profile editor.
// Tables were introduced by migration_student_profile.sql.
// ============================================================================

// The student's administrative identifiers are unique across the roster (see
// migration_student_unique_identifiers.sql). Each entry maps the column to the
// wording used when telling the user a value is already taken.
const UNIQUE_IDENTIFIER_COLUMNS = [
  ['student_personal_phone', 'personal phone number'],
  ['student_baccalaureate_sub_number', 'baccalaureate file number'],
  ['student_school_sub_card_number', 'school submission card number'],
  ['student_laptop_serial_number', 'laptop serial number'],
  ['student_national_identification_number', 'national identification number'],
  ['student_postal_account_number', 'postal account number'],
  ['student_insurance_card_number', 'insurance card number'],
  ['student_military_card_number', 'military card number'],
  ['student_military_helmet_number', 'military helmet number']
]

// The combat outfit numbers are issued per student and must not repeat either
// (see migration_student_unique_identifiers_extra.sql).
const UNIQUE_OUTFIT_COLUMNS = [
  ['first_outfit_number', 'first outfit number'],
  ['second_outfit_number', 'second outfit number']
]

const cleanIdentifier = v => (typeof v === 'string' ? v.trim() || null : v ?? null)

// Measurement ranges enforced by the database
// (migration_student_measurement_ranges.sql). Both fields are optional, but a
// recorded value has to be plausible.
const MEASUREMENT_RANGES = [
  ['STUDENT_HEIGHT_CM', 'Height', 140, 240, 'cm'],
  ['STUDENT_WEIGHT_KG', 'Weight', 40, 160, 'kg']
]

function assertMeasurements(detail) {
  for (const [key, label, min, max, unit] of MEASUREMENT_RANGES) {
    const raw = detail?.[key]
    if (raw === undefined || raw === null || raw === '') continue
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      throw new Error(`${label} must be a number between ${min} and ${max} ${unit}.`)
    }
    if (value < min || value > max) {
      throw new Error(`${label} must be between ${min} and ${max} ${unit}.`)
    }
  }
}

// The family counts have to agree with each other (see
// shared/studentDetailRules.js and 12-student-family-counts.sql). A save can
// carry only some of the three, so the ones it leaves out are read from the row
// already stored before the combination is judged.
function assertFamilyCounts(detail, current = null) {
  const merged = {
    STUDENT_NUMBER_OF_SIBLINGS: current?.STUDENT_NUMBER_OF_SIBLINGS ?? null,
    STUDENT_NUMBER_OF_SISTERS: current?.STUDENT_NUMBER_OF_SISTERS ?? null,
    STUDENT_ORDER_AMONG_SIBLINGS: current?.STUDENT_ORDER_AMONG_SIBLINGS ?? null
  }
  for (const key of Object.keys(merged)) {
    if (detail?.[key] !== undefined) merged[key] = detail[key]
  }
  const errors = familyCountErrors(merged)
  const key = Object.keys(errors)[0]
  if (key) throw new Error(errors[key])
}

// A birth date has to be a real past date. The column cannot carry this rule —
// CURRENT_DATE is not immutable, so PostgreSQL refuses it in a CHECK — which is
// why the service answers first, for both copies of the date.
function assertBirthDate(value) {
  const problem = birthDateError(value)
  if (problem) throw new Error(problem)
}

function assertSchoolSubDate(value, birthdate) {
  const problem = schoolSubDateError(value, birthdate)
  if (problem) throw new Error(problem)
}

// Identifiers that are digits and nothing else. The personal phone and the
// military helmet number are the two written with spaces or codes, so they stay
// free text; 13-student-detail-values.sql keeps the same list as CHECK
// constraints.
const DIGIT_IDENTIFIERS = [
  ['STUDENT_BACCALAUREATE_SUB_NUMBER', 'student_baccalaureate_sub_number', 'baccalaureate file number'],
  ['STUDENT_SCHOOL_SUB_CARD_NUMBER', 'student_school_sub_card_number', 'school submission card number'],
  ['STUDENT_LAPTOP_SERIAL_NUMBER', 'student_laptop_serial_number', 'laptop serial number'],
  ['STUDENT_NATIONAL_IDENTIFICATION_NUMBER', 'student_national_identification_number', 'national identification number'],
  ['STUDENT_POSTAL_ACCOUNT_NUMBER', 'student_postal_account_number', 'postal account number'],
  ['STUDENT_INSURANCE_CARD_NUMBER', 'student_insurance_card_number', 'insurance card number'],
  ['STUDENT_MILITARY_CARD_NUMBER', 'student_military_card_number', 'military card number']
]

function assertIdentifierFormats(detail) {
  for (const [key, , label] of DIGIT_IDENTIFIERS) {
    const raw = detail?.[key]
    if (raw === undefined || raw === null) continue
    const text = String(raw).trim()
    if (text === '') continue
    if (!/^\d+$/.test(text)) {
      throw new Error(`The ${label} must be digits only (it can be left blank).`)
    }
  }
}

// The academic average is a mark out of twenty. The column has a CHECK; saying
// it here gives the same sentence before the INSERT.
function assertAcademicAverage(detail) {
  const raw = detail?.STUDENT_ACADEMIC_AVERAGE
  if (raw === undefined || raw === null || raw === '') return
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 20) {
    throw new Error('The academic average must be between 0 and 20.')
  }
}

// A parent's name is a first name and a last name, so half a pair is not a name.
// A parent left entirely blank stays allowed: the family may not be known yet.
const PARENT_NAME_PAIRS = [
  ['FATHER_FIRST_NAME_LA', 'FATHER_LAST_NAME_LA', "father's Latin name"],
  ['FATHER_FIRST_NAME_AR', 'FATHER_LAST_NAME_AR', "father's Arabic name"],
  ['MOTHER_FIRST_NAME_LA', 'MOTHER_LAST_NAME_LA', "mother's Latin name"],
  ['MOTHER_FIRST_NAME_AR', 'MOTHER_LAST_NAME_AR', "mother's Arabic name"]
]

function assertParentNamePairs(data) {
  for (const [first, last, label] of PARENT_NAME_PAIRS) {
    const hasFirst = String(data?.[first] ?? '').trim() !== ''
    const hasLast = String(data?.[last] ?? '').trim() !== ''
    if (hasFirst !== hasLast) {
      throw new Error(`Record both the first name and the last name of the ${label}, or leave both blank.`)
    }
  }
}

// Educational certificates live in student_educational_certificate (a link
// table) instead of a column on student_detail. The forms offer one choice;
// an array is accepted too, so the table can hold several later.
function normalizeCertificateIds(value) {
  const raw = Array.isArray(value) ? value : [value]
  return [...new Set(
    raw.map(v => parseInt(v, 10)).filter(v => Number.isInteger(v) && v > 0)
  )]
}

// Replace the student's certificates with exactly this set. `run` is either
// the query helper or a transaction-aware counterpart.
async function setStudentEducationalCertificates(run, personId, value) {
  await run('DELETE FROM student_educational_certificate WHERE person_id = $1', [personId])
  for (const certificateId of normalizeCertificateIds(value)) {
    await run(
      `INSERT INTO student_educational_certificate (person_id, educational_certificate_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [personId, certificateId]
    )
  }
}

// Backstop for the check constraints: turn the PostgreSQL message into the
// same wording the validation above uses.
function translateCheckViolation(error) {
  if (!error || error.code !== '23514') return error
  const constraint = String(error.constraint || '')
  if (constraint.includes('student_height_cm')) {
    return new Error('Height must be between 140 and 240 cm.')
  }
  if (constraint.includes('student_weight_kg')) {
    return new Error('Weight must be between 40 and 160 kg.')
  }
  if (constraint.includes('student_detail_sisters_within_siblings')) {
    return new Error('The number of sisters cannot exceed the number of siblings.')
  }
  if (constraint.includes('student_detail_order_within_siblings')) {
    return new Error('The order among siblings cannot exceed the number of siblings plus one.')
  }
  if (constraint.includes('student_detail_sibling_order')) {
    return new Error('The order among siblings must be a whole number, 1 or more.')
  }
  if (constraint.includes('student_detail_sisters_count')) {
    return new Error('The number of sisters must be a whole number, 0 or more.')
  }
  if (constraint.includes('student_detail_siblings_count')) {
    return new Error('The number of siblings must be a whole number, 0 or more.')
  }
  if (constraint.includes('student_academic_average')) {
    return new Error('The academic average must be between 0 and 20.')
  }
  const digitHit = DIGIT_IDENTIFIERS.find(([, column]) => constraint.includes(column))
  if (digitHit) {
    return new Error(`The ${digitHit[2]} must be digits only (it can be left blank).`)
  }
  return error
}

// student_is_foreign is a boolean column. Older renderers sent 'Yes' / 'No';
// accept those (and 1/0) so a stale client cannot write text into a boolean.
const toBool = v =>
  v === true || v === 1 || v === 1n ||
  (typeof v === 'string' && ['yes', 'y', 'true', 't', '1'].includes(v.trim().toLowerCase()))

// A duplicate identifier is a user mistake, not a crash: say which number is
// already recorded instead of leaking the PostgreSQL constraint text.
function translateUniqueViolation(error) {
  if (!error || error.code !== '23505') return error
  const constraint = String(error.constraint || '')
  const hit = [...UNIQUE_IDENTIFIER_COLUMNS, ...UNIQUE_OUTFIT_COLUMNS]
    .find(([column]) => constraint.includes(column))
  if (!hit) return error
  const value = String(error.detail || '').match(/\)=\((.*)\)/)?.[1]
  return new Error(`This ${hit[1]}${value ? ` (${value})` : ''} already belongs to another student.`)
}

// Older renderers still send the pre-rename key; treat it as the new column.
function normalizeIdentifierKeys(detail) {
  if (!detail || detail.STUDENT_ID_CARD_NUMBER === undefined) return detail
  const next = { ...detail }
  if (next.STUDENT_NATIONAL_IDENTIFICATION_NUMBER === undefined) {
    next.STUDENT_NATIONAL_IDENTIFICATION_NUMBER = next.STUDENT_ID_CARD_NUMBER
  }
  delete next.STUDENT_ID_CARD_NUMBER
  return next
}

// The detail payload as the write path wants it: canonical key, trimmed value.
function normalizeIdentifierValues(detail) {
  const next = { ...detail }
  for (const [column] of UNIQUE_IDENTIFIER_COLUMNS) {
    const key = column.toUpperCase()
    if (key in next) next[key] = cleanIdentifier(next[key])
  }
  return next
}

// ---- Lookups ---------------------------------------------------------------

export async function getHealthStatuses() {
  return await query('SELECT * FROM health_status ORDER BY health_status_en')
}

export async function getHobbies() {
  return await query('SELECT * FROM hobby ORDER BY hobby_name_en')
}

export async function getProfessions() {
  return await query('SELECT * FROM profession ORDER BY profession_name_en')
}

export async function getRelations() {
  return await query('SELECT * FROM relation ORDER BY relation_name_en')
}

export async function getStudentSpecialities() {
  return await query('SELECT * FROM student_speciality ORDER BY speciality_name_en')
}

export async function getAcademicLevels() {
  return await query('SELECT * FROM academic_level ORDER BY academic_level_id')
}

export async function getEducationalCertificates() {
  return await query('SELECT * FROM educational_certificate ORDER BY educational_certificate_id')
}

export async function getArmies() {
  return await query('SELECT * FROM army ORDER BY army_id')
}

// How the student joined the school (Civil, ECN, ...); the student row keeps
// only student_recruitment_source_id, so this is the list every picker uses.
export async function getRecruitmentSources() {
  return await query(
    'SELECT * FROM recruitment_source ORDER BY recruitment_source_label_en'
  )
}

// ---- Geographic cascade ----------------------------------------------------

export async function getCountries() {
  return await query('SELECT * FROM country ORDER BY country_name_en')
}

export async function getWilayas(countryId) {
  if (countryId) {
    return await query('SELECT * FROM wilaya WHERE country_id = $1 ORDER BY wilaya_code', [countryId])
  }
  return await query('SELECT * FROM wilaya ORDER BY wilaya_code')
}

export async function getDairas(wilayaId) {
  return await query('SELECT * FROM daira WHERE wilaya_id = $1 ORDER BY daira_name_en', [wilayaId])
}

export async function getCommunes(dairaId) {
  return await query('SELECT * FROM commune WHERE daira_id = $1 ORDER BY commune_name_en', [dairaId])
}

// Enriched per-student rows for the Student Records picker/filter bar:
// person fields + the detail fields worth filtering on, in one query.
export async function getStudentRecordOptions() {
  return await query(`
    SELECT p.person_id, p.person_first_name, p.person_last_name, p.person_birthdate,
           p.person_sex, p.is_student,
           sd.student_blood_type, sd.student_is_foreign,
           sd.student_speciality_id, sd.student_academic_level_id,
           sd.student_personal_phone,
           bw.wilaya_id AS birth_wilaya_id,
           bw.wilaya_name_en AS birth_wilaya_name,
           bw.wilaya_name_en AS birth_wilaya_name_en,
           bw.wilaya_name_ar AS birth_wilaya_name_ar,
           bw.wilaya_name_fr AS birth_wilaya_name_fr
    FROM v_person p
    LEFT JOIN student_detail sd ON sd.person_id = p.person_id
    LEFT JOIN commune bc ON bc.commune_id = sd.student_birth_place_id
    LEFT JOIN daira bd ON bd.daira_id = bc.daira_id
    LEFT JOIN wilaya bw ON bw.wilaya_id = bd.wilaya_id
    WHERE p.is_student = TRUE
    ORDER BY p.person_last_name, p.person_first_name`)
}

// Creates (or updates the street of) an address row for the given commune.
export async function upsertAddress({ streetLa, streetAr, communeId }) {
  const result = await query(
    `INSERT INTO address (address_street_la, address_street_ar, commune_id)
     VALUES ($1, $2, $3)
     RETURNING address_id`,
    [streetLa || '', streetAr || null, communeId || null]
  )
  return result.data?.[0]?.ADDRESS_ID || null
}

// ---- Student detail ---------------------------------------------------------  // Full profile for the editor: person + detail (with the teaching category
  // derived from the student's section) + parents + contacts + lists.
export async function getStudentProfile(userId, personId) {
  // Reading a student is limited to the categories the acting secretary is
  // responsible for; a student outside them cannot be opened at all.
  await assertStudentAllowed(await loadScope(userId), personId)

  // The teaching category is not stored on student_detail: it is derived from
  // the student's section (section.teaching_category_id), and the current
  // section is the open row in student_section_history.
  const detailResult = await query(
    `SELECT sd.*, p.person_birthdate, p.person_sex, p.person_grade_id,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar,
            p.person_photo,
            g.military_grade_name_en AS person_grade_label,
            g.military_grade_name_en AS person_grade_label_en,
            g.military_grade_name_ar AS person_grade_label_ar,
            g.military_grade_name_fr AS person_grade_label_fr,
            COALESCE(s.section_label_en, s.section_label_ar, s.section_label_fr) AS section_label, s.section_label_en AS section_label_en, s.section_label_ar AS section_label_ar, s.section_label_fr AS section_label_fr,
            tc.teaching_category_id AS TEACHING_CATEGORY_ID,
            COALESCE(tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr) AS TEACHING_CATEGORY_LABEL, tc.teaching_category_label_en AS TEACHING_CATEGORY_LABEL_en, tc.teaching_category_label_ar AS TEACHING_CATEGORY_LABEL_ar, tc.teaching_category_label_fr AS TEACHING_CATEGORY_LABEL_fr,
            sec.educational_certificate_id AS educational_certificate_id
     FROM student_detail sd
     JOIN person p ON p.person_id = sd.person_id
     LEFT JOIN military_grade g ON g.military_grade_id = p.person_grade_id
     LEFT JOIN student_section_history h
            ON h.person_id = sd.person_id AND h.ended_at IS NULL
     LEFT JOIN section s ON s.section_id = h.section_id
     LEFT JOIN teaching_category tc ON tc.teaching_category_id = s.teaching_category_id
     LEFT JOIN LATERAL (
       SELECT educational_certificate_id
       FROM student_educational_certificate
       WHERE person_id = sd.person_id
       ORDER BY educational_certificate_id
       LIMIT 1
     ) sec ON TRUE
     WHERE sd.person_id = $1`,
    [personId]
  )
  const detail = detailResult.data?.[0] || null
  if (!detail) {
    return { detail: null, parents: null, emergencyContacts: [], hobbies: [], combatOutfit: null, paradeUniform: null }
  }

  const [parentsRes, contactsRes, hobbiesRes, combatRes, paradeRes, birthPlaceRes, personalAddressRes] = await Promise.all([
    query('SELECT * FROM student_parent_info WHERE person_id = $1', [personId]),
    query(
      `SELECT c.*, r.relation_name_en AS CONTACT_RELATION_NAME,
              r.relation_name_en AS CONTACT_RELATION_NAME_EN,
              r.relation_name_ar AS CONTACT_RELATION_NAME_AR,
              r.relation_name_fr AS CONTACT_RELATION_NAME_FR,
              cc.country_name_en AS CONSULATE_COUNTRY_NAME_EN,
              cc.country_name_ar AS CONSULATE_COUNTRY_NAME_AR,
              cc.country_name_fr AS CONSULATE_COUNTRY_NAME_FR
       FROM student_emergency_contact c
       LEFT JOIN relation r ON r.relation_id = c.contact_relation_id
       LEFT JOIN country cc ON cc.country_id = c.consulate_country_id
       WHERE c.person_id = $1
       ORDER BY c.emergency_contact_id`,
      [personId]
    ),
    query(
      `SELECT h.hobby_id, h.hobby_name_en AS hobby_name,
              h.hobby_name_en AS hobby_name_en,
              h.hobby_name_ar AS hobby_name_ar,
              h.hobby_name_fr AS hobby_name_fr
       FROM student_hobby sh
       JOIN hobby h ON h.hobby_id = sh.hobby_id
       WHERE sh.person_id = $1 ORDER BY h.hobby_name_en`,
      [personId]
    ),
    query('SELECT * FROM student_combat_outfit WHERE person_id = $1', [personId]),
    query('SELECT * FROM student_parade_uniform WHERE person_id = $1', [personId]),
    detail.STUDENT_BIRTH_PLACE_ID
      ? query(
        `SELECT c.commune_id, c.daira_id, d.wilaya_id
         FROM commune c JOIN daira d ON d.daira_id = c.daira_id
         WHERE c.commune_id = $1`,
        [detail.STUDENT_BIRTH_PLACE_ID]
      )
      : Promise.resolve({ data: [] }),
    detail.STUDENT_PERSONAL_ADDRESS_ID
      ? query(
        `SELECT a.address_id, a.address_street_la, a.address_street_ar,
                c.commune_id, c.daira_id, d.wilaya_id
         FROM address a
         LEFT JOIN commune c ON c.commune_id = a.commune_id
         LEFT JOIN daira d ON d.daira_id = c.daira_id
         WHERE a.address_id = $1`,
        [detail.STUDENT_PERSONAL_ADDRESS_ID]
      )
      : Promise.resolve({ data: [] })
  ])

  return {
    detail,
    parents: parentsRes.data?.[0] || null,
    emergencyContacts: contactsRes.data || [],
    hobbies: hobbiesRes.data || [],
    combatOutfit: combatRes.data?.[0] || null,
    paradeUniform: paradeRes.data?.[0] || null,
    birthPlace: birthPlaceRes.data?.[0] || null,
    personalAddress: personalAddressRes.data?.[0] || null
  }
}

// Create, update or clear the student's personal address (the `address` table
// is referenced by student_detail.student_personal_address_id). The address
// row is private to the student, so it is edited in place — or deleted when
// every field is emptied.
// Foreign-student data rule (enforced in one transaction):
//   A foreign student has NO emergency contacts on file — not a personal
//   contact and not a consular one. Their personal address is left alone.
export async function enforceForeignStudentRules(personId) {
  return await withTransaction(async (tx) => {
    const existing = await tx(
      'SELECT person_id FROM student_detail WHERE person_id = $1',
      [personId]
    )
    if (!existing.data?.[0]) throw new Error('Student record not found.')

    await tx('DELETE FROM student_emergency_contact WHERE person_id = $1', [personId])
    return { success: true }
  })
}

export async function updateStudentPersonalAddress(userId, personId, data) {
  // Editing a student's address is limited to the teaching categories the
  // acting secretary is responsible for (admins are unrestricted).
  await assertStudentAllowed(await loadScope(userId), personId)

  const streetLa = (data?.ADDRESS_STREET_LA || '').trim()
  const streetAr = (data?.ADDRESS_STREET_AR || '').trim()
  const communeId = data?.COMMUNE_ID ? parseInt(data.COMMUNE_ID, 10) : null

  const existing = await query(
    'SELECT student_personal_address_id FROM student_detail WHERE person_id = $1',
    [personId]
  )
  const addressId = existing.data?.[0]?.STUDENT_PERSONAL_ADDRESS_ID
  if (!existing.data?.[0]) throw new Error('Student record not found.')

  return await withTransaction(async (tx) => {
    // Everything cleared: detach and delete the private address row.
    if (!streetLa && !streetAr && !communeId) {
      if (addressId) {
        await tx('UPDATE student_detail SET student_personal_address_id = NULL WHERE person_id = $1', [personId])
        await tx('DELETE FROM address WHERE address_id = $1', [addressId])
      }
      return { success: true, cleared: true }
    }

    if (addressId) {
      await tx(
        `UPDATE address
         SET address_street_la = $1, address_street_ar = $2, commune_id = $3
         WHERE address_id = $4`,
        [streetLa, streetAr || null, communeId, addressId]
      )
      return { success: true, addressId }
    }

    const created = await tx(
      `INSERT INTO address (address_street_la, address_street_ar, commune_id)
       VALUES ($1, $2, $3)
       RETURNING address_id`,
      [streetLa, streetAr || null, communeId]
    )
    const newAddressId = created.data?.[0]?.ADDRESS_ID
    await tx(
      'UPDATE student_detail SET student_personal_address_id = $1 WHERE person_id = $2',
      [newAddressId, personId]
    )
    return { success: true, addressId: newAddressId }
  })
}

// Create a student end-to-end inside ONE transaction:
//   person (with birthdate, sex, section) + student_detail (full personal
//   info) + student_section + student_parent_info + emergency contacts +
//   hobbies. Any failure rolls everything back, so we never leave a half-
//   registered student (e.g. a person row with no student_detail row).
export async function createStudentProfile(userId, data) {
  const d = data || {}
  const identity = d.identity || {}
  const detail = normalizeIdentifierValues(normalizeIdentifierKeys(d.detail || {}))
  assertMeasurements(detail)
  assertFamilyCounts(detail)
  assertBirthDate(identity.birthdate)
  assertIdentifierFormats(detail)
  assertAcademicAverage(detail)
  assertSchoolSubDate(detail.STUDENT_SCHOOL_SUB_DATE, identity.birthdate)
  const parents = d.parents || {}
  const contacts = Array.isArray(d.emergencyContacts) ? d.emergencyContacts : []
  const hobbyIds = Array.isArray(d.hobbyIds) ? d.hobbyIds : []
  const sectionIds = Array.isArray(d.sectionIds) ? d.sectionIds : []

  const firstName = formatLatinFirstName((identity.firstName || '').trim())
  const lastName = formatLatinLastName((identity.lastName || '').trim())
  const firstNameAr = (identity.firstNameAr || '').trim() || null
  const lastNameAr = (identity.lastNameAr || '').trim() || null
  if (!firstName || !lastName) {
    throw new Error('First name and last name are required.')
  }

  // The person's twelve-digit id comes from the registration form: person_id is
  // typed in, it is not generated (11-person-id-manual.sql).
  const idError = personIdError(identity.personId)
  if (idError) throw new Error(idError)
  const declaredPersonId = personIdValue(identity.personId)

  // A secretary may only register students into their own teaching categories
  // (and therefore must pick a section); an admin is unrestricted.
  await assertSectionsAllowed(await loadScope(userId), sectionIds)

  return await withTransaction(async (tx) => {
    // 1. Person row; studenthood is expressed as an active STUDENT role row
    //    (person_has_role), not a flag column. The id is the primary key, so a
    //    repeated number is refused by the database; asking first names the
    //    field that is the problem.
    const taken = await tx('SELECT 1 FROM person WHERE person_id = $1', [declaredPersonId])
    if (taken.data?.length) throw new Error('A person with this ID already exists.')

    const personRes = await tx(
      `INSERT INTO person (person_id, person_first_name_la, person_first_name_ar, person_last_name_la, person_last_name_ar, person_birthdate, person_sex, person_photo, person_grade_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING person_id`,
      [declaredPersonId, firstName, firstNameAr, lastName, lastNameAr, identity.birthdate || null, identity.sex || 'M', identity.photo || null, detail.PERSON_GRADE_ID || identity.gradeId || null]
    )
    const personId = personRes.data?.[0]?.PERSON_ID

    await tx(
      `INSERT INTO person_has_role (person_id, role_id)
       SELECT $1, r.role_id FROM role r WHERE r.role_code = 'STUDENT'
       ON CONFLICT DO NOTHING`,
      [personId]
    )

    // 2. student_detail, keyed by the person it belongs to.
    const detailColumns = {
      student_birth_date: detail.STUDENT_BIRTH_DATE || identity.birthdate || null,
      student_blood_type: detail.STUDENT_BLOOD_TYPE || null,
      student_personal_phone: detail.STUDENT_PERSONAL_PHONE || null,
      student_height_cm: detail.STUDENT_HEIGHT_CM || null,
      student_weight_kg: detail.STUDENT_WEIGHT_KG || null,
      student_is_foreign: toBool(detail.STUDENT_IS_FOREIGN),
      student_academic_average: detail.STUDENT_ACADEMIC_AVERAGE || null,
      student_speciality_id: detail.STUDENT_SPECIALITY_ID || null,
      student_academic_level_id: detail.STUDENT_ACADEMIC_LEVEL_ID || null,
      student_baccalaureate_sub_number: detail.STUDENT_BACCALAUREATE_SUB_NUMBER || null,
      student_school_sub_date: detail.STUDENT_SCHOOL_SUB_DATE || null,
      student_school_sub_card_number: detail.STUDENT_SCHOOL_SUB_CARD_NUMBER || null,
      student_laptop_serial_number: detail.STUDENT_LAPTOP_SERIAL_NUMBER || null,
      student_birthdate_certificate_number: detail.STUDENT_BIRTHDATE_CERTIFICATE_NUMBER || null,
      student_national_identification_number: detail.STUDENT_NATIONAL_IDENTIFICATION_NUMBER || null,
      student_postal_account_number: detail.STUDENT_POSTAL_ACCOUNT_NUMBER || null,
      student_insurance_card_number: detail.STUDENT_INSURANCE_CARD_NUMBER || null,
      student_military_card_number: detail.STUDENT_MILITARY_CARD_NUMBER || null,
      student_military_helmet_number: detail.STUDENT_MILITARY_HELMET_NUMBER || null,
      student_health_status_id: detail.STUDENT_HEALTH_STATUS_ID || null,
      student_military_necklace: detail.STUDENT_MILITARY_NECKLACE || 'No',
      student_number_of_siblings: detail.STUDENT_NUMBER_OF_SIBLINGS || null,
      student_number_of_sisters: detail.STUDENT_NUMBER_OF_SISTERS || null,
      student_order_among_siblings: detail.STUDENT_ORDER_AMONG_SIBLINGS || null,
      student_army_id: detail.STUDENT_ARMY_ID || null,
      student_orphan_status: detail.STUDENT_ORPHAN_STATUS || 'None',
      student_parents_situation: detail.STUDENT_PARENTS_SITUATION || 'Married',
      student_recruitment_source_id: detail.STUDENT_RECRUITMENT_SOURCE_ID || null,
      student_birth_place_id: detail.STUDENT_BIRTH_PLACE_ID || null,
      student_photo: identity.photo || detail.STUDENT_PHOTO || null
    }

    const dCols = Object.keys(detailColumns)
    const dVals = dCols.map(k => detailColumns[k])
    const dPlaceholders = dCols.map((_, i) => `$${i + 2}`).join(', ')
    try {
      await tx(
        `INSERT INTO student_detail (person_id, ${dCols.join(', ')})
         VALUES ($1, ${dPlaceholders})`,
        [personId, ...dVals]
      )
    } catch (err) {
      // Rolls the whole registration back; the message names the problem.
      throw translateCheckViolation(translateUniqueViolation(err))
    }

    // 3. Section assignment(s)
    for (const sectionId of sectionIds) {
      if (!sectionId) continue
      await tx(
        'INSERT INTO student_section (person_id, section_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [personId, sectionId]
      )
    }

    // 3b. Educational certificate(s): one link row per certificate.
    for (const certificateId of normalizeCertificateIds(detail.EDUCATIONAL_CERTIFICATE_ID)) {
      await tx(
        `INSERT INTO student_educational_certificate (person_id, educational_certificate_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [personId, certificateId]
      )
    }

    // 4. Parents (row cannot exist yet — plain insert)
    const hasAnyParent = Object.values(parents).some(v => v !== undefined && v !== null && v !== '')
    if (hasAnyParent) {
      await tx(
        `INSERT INTO student_parent_info (
           person_id,
           father_first_name_la, father_last_name_la, father_first_name_ar, father_last_name_ar,
           father_profession_id,
           mother_first_name_la, mother_last_name_la, mother_first_name_ar, mother_last_name_ar,
           mother_profession_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          personId,
          parents.FATHER_FIRST_NAME_LA || null, parents.FATHER_LAST_NAME_LA || null,
          parents.FATHER_FIRST_NAME_AR || null, parents.FATHER_LAST_NAME_AR || null,
          parents.FATHER_PROFESSION_ID || null,
          parents.MOTHER_FIRST_NAME_LA || null, parents.MOTHER_LAST_NAME_LA || null,
          parents.MOTHER_FIRST_NAME_AR || null, parents.MOTHER_LAST_NAME_AR || null,
          parents.MOTHER_PROFESSION_ID || null
        ]
      )
    }

    // 5. Emergency contacts (each may carry an optional relation). A foreign
    //    student keeps none on file.
    if (!toBool(detail.STUDENT_IS_FOREIGN)) {
      for (const c of contacts) {
        if (!c || (!c.CONTACT_FIRST_NAME_LA && !c.CONTACT_LAST_NAME_LA && !c.CONTACT_PHONE_NUMBER)) continue
        await tx(
          `INSERT INTO student_emergency_contact (
             person_id,
             contact_first_name_la, contact_last_name_la,
             contact_first_name_ar, contact_last_name_ar,
             contact_relation_id, contact_phone_number, consulate_number
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            personId,
            c.CONTACT_FIRST_NAME_LA || null, c.CONTACT_LAST_NAME_LA || null,
            c.CONTACT_FIRST_NAME_AR || null, c.CONTACT_LAST_NAME_AR || null,
            c.CONTACT_RELATION_ID || null, c.CONTACT_PHONE_NUMBER || null,
            c.CONSULATE_NUMBER || null
          ]
        )
      }
    }

    // 6. Hobbies
    for (const hobbyId of hobbyIds) {
      if (!hobbyId) continue
      await tx(
        'INSERT INTO student_hobby (person_id, hobby_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [personId, hobbyId]
      )
    }

    return { success: true, PERSON_ID: personId }
  })
}

// Update (or insert) the student_detail row. Only known columns are written;
// birth date is mirrored to person.birthdate by the sync_student_birthdate
// trigger, and we also mirror it explicitly on insert.
export async function updateStudentDetail(userId, personId, data) {
  // Editing a student's detail record is limited to the teaching categories the
  // acting secretary is responsible for (admins are unrestricted).
  await assertStudentAllowed(await loadScope(userId), personId)

  // The ID card column was renamed; accept the old key and trim the unique
  // identifiers so a stray space cannot slip past the uniqueness check.
  data = normalizeIdentifierValues(normalizeIdentifierKeys(data || {}))
  // The foreign flag is a boolean column; coerce the old 'Yes' / 'No' strings.
  if ('STUDENT_IS_FOREIGN' in data) {
    data = { ...data, STUDENT_IS_FOREIGN: toBool(data.STUDENT_IS_FOREIGN) }
  }
  assertMeasurements(data)
  assertBirthDate(data.STUDENT_BIRTH_DATE)
  assertIdentifierFormats(data)
  assertAcademicAverage(data)

  const allowed = [
    'STUDENT_BIRTH_DATE', 'STUDENT_BLOOD_TYPE', 'STUDENT_PERSONAL_PHONE',
    'STUDENT_HEIGHT_CM', 'STUDENT_WEIGHT_KG', 'STUDENT_IS_FOREIGN',
    'STUDENT_ACADEMIC_AVERAGE', 'STUDENT_SPECIALITY_ID', 'STUDENT_ACADEMIC_LEVEL_ID',
    'STUDENT_BACCALAUREATE_SUB_NUMBER', 'STUDENT_SCHOOL_SUB_DATE',
    'STUDENT_SCHOOL_SUB_CARD_NUMBER', 'STUDENT_LAPTOP_SERIAL_NUMBER',
    'STUDENT_BIRTHDATE_CERTIFICATE_NUMBER', 'STUDENT_NATIONAL_IDENTIFICATION_NUMBER',
    'STUDENT_POSTAL_ACCOUNT_NUMBER', 'STUDENT_INSURANCE_CARD_NUMBER',
    'STUDENT_MILITARY_CARD_NUMBER', 'STUDENT_MILITARY_HELMET_NUMBER',
    'STUDENT_HEALTH_STATUS_ID',
    'STUDENT_MILITARY_NECKLACE', 'STUDENT_NUMBER_OF_SIBLINGS',
    'STUDENT_NUMBER_OF_SISTERS', 'STUDENT_ORDER_AMONG_SIBLINGS',
    'STUDENT_ARMY_ID', 'STUDENT_ORPHAN_STATUS', 'STUDENT_PARENTS_SITUATION',
    'STUDENT_BIRTH_PLACE_ID', 'STUDENT_PHOTO',
    'STUDENT_RECRUITMENT_SOURCE_ID'
  ]

  const cols = []
  const vals = []
  for (const key of allowed) {
    if (key in data) {
      cols.push(key)
      vals.push(data[key] === '' ? null : data[key])
    }
  }

  const existing = await query(
    'SELECT * FROM student_detail WHERE person_id = $1',
    [personId]
  )
  assertFamilyCounts(data, existing.data?.[0] || null)
  if ('STUDENT_SCHOOL_SUB_DATE' in data) {
    assertSchoolSubDate(
      data.STUDENT_SCHOOL_SUB_DATE,
      data.STUDENT_BIRTH_DATE !== undefined
        ? data.STUDENT_BIRTH_DATE
        : existing.data?.[0]?.STUDENT_BIRTH_DATE
    )
  }

  // A person who is not a student yet gets their detail row here (the person
  // service only bootstraps students).
  if (!existing.data?.[0]) {
    await query(
      'INSERT INTO student_detail (person_id, student_birth_date) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [personId, data.STUDENT_BIRTH_DATE || null]
    )
  }

  if (cols.length > 0) {
    const setSql = cols.map((c, i) => `${c.toLowerCase()} = $${i + 1}`).join(', ')
    try {
      await query(`UPDATE student_detail SET ${setSql} WHERE person_id = $${cols.length + 1}`,
        [...vals, personId])
    } catch (err) {
      // A duplicate identifier or an out-of-range measurement: say so plainly.
      throw translateCheckViolation(translateUniqueViolation(err))
    }
  }
  // The certificate is a link-table row now, so it is written separately;
  // sending the key at all means "this is the certificate" (empty clears it).
  if ('EDUCATIONAL_CERTIFICATE_ID' in data) {
    await setStudentEducationalCertificates(query, personId, data.EDUCATIONAL_CERTIFICATE_ID)
  }
  await applyForeignStudentRules(personId, data)

  // Only the columns this function is allowed to write are compared, so an
  // ignored key cannot appear in the audit trail as a change that never happened.
  const submitted = {}
  for (const key of allowed) {
    if (key in data) submitted[key] = data[key]
  }
  const changes = diffRow(existing.data?.[0] || null, submitted)
  if (Object.keys(changes).length > 0) {
    const who = await query(
      'SELECT person_first_name_la, person_last_name_la FROM person WHERE person_id = $1',
      [personId]
    )
    const label = [who.data?.[0]?.PERSON_FIRST_NAME_LA, who.data?.[0]?.PERSON_LAST_NAME_LA]
      .filter(Boolean)
      .join(' ')
    await recordAudit({
      actorUserId: userId,
      action: 'student.update',
      entityType: 'person',
      entityId: personId,
      entityLabel: label || null,
      changes
    })
  }

  return { success: true }
}

// Foreign-student side effects whenever the foreign flag is saved:
//   true -> every emergency contact on the student is dropped.
async function applyForeignStudentRules(personId, data) {
  if (toBool(data.STUDENT_IS_FOREIGN)) {
    await enforceForeignStudentRules(personId)
  }
}

// Identity fields living on person (editable alongside the detail row).
export async function updateStudentIdentity(userId, personId, { personId: newPersonId, firstName, lastName, firstNameAr, lastNameAr, birthdate, sex, gradeId }) {
  // Same rule as every other student write: the acting secretary only edits
  // students inside the categories the admin gave them.
  await assertStudentAllowed(await loadScope(userId), personId)
  if (birthdate !== undefined) assertBirthDate(birthdate)

  // person_id is typed in, so it can be corrected here like any other identity
  // field. The foreign keys that point at person cascade on update, so the
  // student's rows follow the new number (11-person-id-manual.sql).
  let savedId = Number(personId)
  const idChanged = newPersonId !== undefined && String(newPersonId).trim() !== String(personId)
  if (idChanged) {
    const idError = personIdError(newPersonId)
    if (idError) throw new Error(idError)
    savedId = personIdValue(newPersonId)
    const taken = await query('SELECT 1 FROM person WHERE person_id = $1', [savedId])
    if (taken.data?.length) throw new Error('A person with this ID already exists.')
  }

  // Latin names are stored in a fixed shape: the first name capitalised word by
  // word, the last name in capitals (see shared/personNames.js).
  if (firstName !== undefined) firstName = formatLatinFirstName(firstName)
  if (lastName !== undefined) lastName = formatLatinLastName(lastName)

  // Read before writing: the audit entry reports what actually changed.
  const beforeRes = await query(
    `SELECT person_first_name_la, person_last_name_la, person_first_name_ar, person_last_name_ar,
            person_birthdate, person_sex, person_grade_id
       FROM person WHERE person_id = $1`,
    [personId]
  )
  const before = beforeRes.data?.[0] || null

  const sets = []
  const vals = []
  if (idChanged) { vals.push(savedId); sets.push(`person_id = $${vals.length}`) }
  if (firstName !== undefined) { vals.push(firstName); sets.push(`person_first_name_la = $${vals.length}`) }
  if (firstNameAr !== undefined) { vals.push(firstNameAr || null); sets.push(`person_first_name_ar = $${vals.length}`) }
  if (lastName !== undefined) { vals.push(lastName); sets.push(`person_last_name_la = $${vals.length}`) }
  if (lastNameAr !== undefined) { vals.push(lastNameAr || null); sets.push(`person_last_name_ar = $${vals.length}`) }
  if (birthdate !== undefined) { vals.push(birthdate || null); sets.push(`person_birthdate = $${vals.length}`) }
  if (sex !== undefined) { vals.push(sex || null); sets.push(`person_sex = $${vals.length}`) }
  if (gradeId !== undefined) { vals.push(gradeId || null); sets.push(`person_grade_id = $${vals.length}`) }
  if (sets.length === 0) return { success: true, PERSON_ID: savedId }
  vals.push(personId)
  await query(`UPDATE person SET ${sets.join(', ')} WHERE person_id = $${vals.length}`, vals)

  // Turning a record male removes the two skirt sizes: they do not belong to a
  // male student's uniform, and leaving them behind would keep values the forms
  // no longer show. Only the transition writes, so saving an already-male
  // record never needs the uniform table.
  if (sex === 'M' && before?.PERSON_SEX !== 'M') {
    await requireUniformSizeSchema()
    await query(
      `UPDATE student_parade_uniform
          SET summer_skirt_size = NULL, winter_skirt_size = NULL
        WHERE person_id = $1`,
      [savedId]
    )
  }

  const submitted = {}
  if (firstName !== undefined) submitted.person_first_name_la = firstName
  if (firstNameAr !== undefined) submitted.person_first_name_ar = firstNameAr
  if (lastName !== undefined) submitted.person_last_name_la = lastName
  if (lastNameAr !== undefined) submitted.person_last_name_ar = lastNameAr
  if (birthdate !== undefined) submitted.person_birthdate = birthdate
  if (sex !== undefined) submitted.person_sex = sex
  if (gradeId !== undefined) submitted.person_grade_id = gradeId

  const changes = diffRow(before, submitted)
  if (Object.keys(changes).length > 0) {
    const label = [submitted.person_first_name_la ?? before?.PERSON_FIRST_NAME_LA, submitted.person_last_name_la ?? before?.PERSON_LAST_NAME_LA]
      .filter(Boolean)
      .join(' ')
    await recordAudit({
      actorUserId: userId,
      action: 'student.identity_update',
      entityType: 'person',
      entityId: savedId,
      entityLabel: label || null,
      changes
    })
  }

  return { success: true, PERSON_ID: savedId }
}

// ---- Parents -----------------------------------------------------------------

export async function updateStudentParents(userId, personId, data) {
  await assertStudentAllowed(await loadScope(userId), personId)
  data = normalizeLatinNames(data || {})
  assertParentNamePairs(data)

  await query(
    `INSERT INTO student_parent_info (
       person_id,
       father_first_name_la, father_last_name_la, father_first_name_ar, father_last_name_ar,
       father_profession_id,
       mother_first_name_la, mother_last_name_la, mother_first_name_ar, mother_last_name_ar,
       mother_profession_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (person_id) DO UPDATE SET
       father_first_name_la = EXCLUDED.father_first_name_la,
       father_last_name_la = EXCLUDED.father_last_name_la,
       father_first_name_ar = EXCLUDED.father_first_name_ar,
       father_last_name_ar = EXCLUDED.father_last_name_ar,
       father_profession_id = EXCLUDED.father_profession_id,
       mother_first_name_la = EXCLUDED.mother_first_name_la,
       mother_last_name_la = EXCLUDED.mother_last_name_la,
       mother_first_name_ar = EXCLUDED.mother_first_name_ar,
       mother_last_name_ar = EXCLUDED.mother_last_name_ar,
       mother_profession_id = EXCLUDED.mother_profession_id`,
    [
      personId,
      data.FATHER_FIRST_NAME_LA || null, data.FATHER_LAST_NAME_LA || null,
      data.FATHER_FIRST_NAME_AR || null, data.FATHER_LAST_NAME_AR || null,
      data.FATHER_PROFESSION_ID || null,
      data.MOTHER_FIRST_NAME_LA || null, data.MOTHER_LAST_NAME_LA || null,
      data.MOTHER_FIRST_NAME_AR || null, data.MOTHER_LAST_NAME_AR || null,
      data.MOTHER_PROFESSION_ID || null
    ]
  )
  return { success: true }
}

// ---- Emergency contacts --------------------------------------------------------

// The student an emergency-contact row belongs to (contact ids are not person ids).
async function contactPersonId(contactId) {
  const res = await query(
    'SELECT person_id FROM student_emergency_contact WHERE emergency_contact_id = $1',
    [parseInt(contactId, 10) || 0]
  )
  const personId = res.data?.[0]?.PERSON_ID
  if (!personId) throw new Error('Emergency contact not found.')
  return personId
}

export async function addEmergencyContact(userId, personId, data) {
  await assertStudentAllowed(await loadScope(userId), personId)
  data = normalizeLatinNames(data || {})

  // Foreign students keep no emergency contacts on file.
  const foreignCheck = await query(
    'SELECT student_is_foreign FROM student_detail WHERE person_id = $1',
    [personId]
  )
  if (foreignCheck.data?.[0]?.STUDENT_IS_FOREIGN === true) {
    throw new Error('Foreign students do not keep emergency contacts.')
  }

  const result = await query(
    `INSERT INTO student_emergency_contact (
       person_id,
       contact_first_name_la, contact_last_name_la,
       contact_first_name_ar, contact_last_name_ar,
       contact_relation_id, contact_phone_number, consulate_number,
       consulate_country_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING emergency_contact_id`,
    [
      personId,
      data.CONTACT_FIRST_NAME_LA || null, data.CONTACT_LAST_NAME_LA || null,
      data.CONTACT_FIRST_NAME_AR || null, data.CONTACT_LAST_NAME_AR || null,
      data.CONTACT_RELATION_ID || null, data.CONTACT_PHONE_NUMBER || null,
      data.CONSULATE_NUMBER || null, data.CONSULATE_COUNTRY_ID || null
    ]
  )
  return { success: true, emergencyContactId: result.data?.[0]?.EMERGENCY_CONTACT_ID }
}

export async function updateEmergencyContact(userId, contactId, data) {
  // Contact ids are not person ids, so the student behind the row is resolved
  // first and then checked like any other edit.
  await assertStudentAllowed(await loadScope(userId), await contactPersonId(contactId))

  data = normalizeLatinNames(data || {})

  const sets = []
  const vals = []
  const map = {
    CONTACT_FIRST_NAME_LA: 'contact_first_name_la',
    CONTACT_LAST_NAME_LA: 'contact_last_name_la',
    CONTACT_FIRST_NAME_AR: 'contact_first_name_ar',
    CONTACT_LAST_NAME_AR: 'contact_last_name_ar',
    CONTACT_RELATION_ID: 'contact_relation_id',
    CONTACT_PHONE_NUMBER: 'contact_phone_number',
    CONSULATE_NUMBER: 'consulate_number',
    CONSULATE_COUNTRY_ID: 'consulate_country_id'
  }
  for (const [key, col] of Object.entries(map)) {
    if (key in data) {
      vals.push(data[key] === '' ? null : data[key])
      sets.push(`${col} = $${vals.length}`)
    }
  }
  if (sets.length === 0) return { success: true }
  vals.push(contactId)
  await query(`UPDATE student_emergency_contact SET ${sets.join(', ')} WHERE emergency_contact_id = $${vals.length}`, vals)
  return { success: true }
}

export async function deleteEmergencyContact(userId, contactId) {
  await assertStudentAllowed(await loadScope(userId), await contactPersonId(contactId))

  await query('DELETE FROM student_emergency_contact WHERE emergency_contact_id = $1', [contactId])
  return { success: true }
}

// ---- Hobbies -----------------------------------------------------------------

export async function setStudentHobbies(userId, personId, hobbyIds) {
  await assertStudentAllowed(await loadScope(userId), personId)

  await query('DELETE FROM student_hobby WHERE person_id = $1', [personId])
  for (const id of hobbyIds || []) {
    await query(
      'INSERT INTO student_hobby (person_id, hobby_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [personId, id]
    )
  }
  return { success: true }
}

// ---- Live uniqueness check ------------------------------------------------------

// The forms ask this while a number is being typed, so a duplicate is refused
// before Save instead of after it. Same allow-lists as the constraints: no
// caller-supplied column reaches the SQL.
const DETAIL_IDENTIFIER_KEYS = new Set(UNIQUE_IDENTIFIER_COLUMNS.map(([col]) => col.toUpperCase()))
const OUTFIT_IDENTIFIER_KEYS = new Set(UNIQUE_OUTFIT_COLUMNS.map(([col]) => col.toUpperCase()))

function identifierLookups(values) {
  const lookups = []
  for (const [key, value] of Object.entries(values || {})) {
    if (key === 'PERSON_ID') {
      // The person id is the primary key of the person table, shared by staff
      // and students: a duplicate here would be a different record entirely.
      lookups.push({ key, table: 'person', column: 'person_id', value })
    } else if (DETAIL_IDENTIFIER_KEYS.has(key)) {
      lookups.push({ key, table: 'student_detail', column: key.toLowerCase(), value })
    } else if (OUTFIT_IDENTIFIER_KEYS.has(key)) {
      lookups.push({ key, table: 'student_combat_outfit', column: key.toLowerCase(), value })
    }
  }
  return lookups
}

export async function checkStudentIdentifiers(userId, personId, values) {
  // Same gate as a write: a signed-in account with a resolvable scope.
  await loadScope(userId)
  const id = personId ? parseInt(personId, 10) : null
  const conflicts = {}

  for (const { key, table, column, value } of identifierLookups(values)) {
    const clean = cleanIdentifier(value)
    if (!clean) continue
    const res = await query(
      `SELECT t.person_id, p.person_first_name_la, p.person_last_name_la
         FROM ${table} t
         LEFT JOIN person p ON p.person_id = t.person_id
        WHERE t.${column} = $1
          AND ($2::bigint IS NULL OR t.person_id <> $2::bigint)
        LIMIT 1`,
      [clean, id]
    )
    const row = res?.data?.[0]
    if (!row) continue
    conflicts[key] = {
      personId: row.PERSON_ID,
      name: [row.PERSON_LAST_NAME_LA, row.PERSON_FIRST_NAME_LA].filter(Boolean).join(' ')
    }
  }

  return { conflicts, rowCount: Object.keys(conflicts).length }
}

// ---- Uniforms -----------------------------------------------------------------

// A uniform size is chosen from the values the administration defined, so the
// write path checks every submitted size against that list instead of storing
// free text. A value already on the student's row is accepted as-is.
export async function updateCombatOutfit(userId, personId, data) {
  // Secretaries may only edit students inside their teaching categories.
  await assertStudentAllowed(await loadScope(userId), personId)
  await requireUniformSizeSchema()

  const existing = await query('SELECT * FROM student_combat_outfit WHERE person_id = $1', [personId])
  const current = existing.data?.[0] || {}
  const sizes = {
    FIRST_OUTFIT_SIZE: cleanIdentifier(data.FIRST_OUTFIT_SIZE),
    SECOND_OUTFIT_SIZE: cleanIdentifier(data.SECOND_OUTFIT_SIZE),
    COMBAT_SHOE_SIZE: cleanIdentifier(data.COMBAT_SHOE_SIZE)
  }
  await assertUniformSizes(COMBAT_UNIFORM_FIELDS, sizes, current)

  try {
    await query(
      `INSERT INTO student_combat_outfit (
         person_id, first_outfit_number, first_outfit_size,
         second_outfit_number, second_outfit_size, combat_shoe_size
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (person_id) DO UPDATE SET
         first_outfit_number = EXCLUDED.first_outfit_number,
         first_outfit_size = EXCLUDED.first_outfit_size,
         second_outfit_number = EXCLUDED.second_outfit_number,
         second_outfit_size = EXCLUDED.second_outfit_size,
         combat_shoe_size = EXCLUDED.combat_shoe_size`,
      [
        personId,
        cleanIdentifier(data.FIRST_OUTFIT_NUMBER), sizes.FIRST_OUTFIT_SIZE,
        cleanIdentifier(data.SECOND_OUTFIT_NUMBER), sizes.SECOND_OUTFIT_SIZE,
        sizes.COMBAT_SHOE_SIZE
      ]
    )
  } catch (err) {
    // A number another student already wears: name it instead of leaking SQL.
    throw translateUniqueViolation(err)
  }
  return { success: true }
}

export async function updateParadeUniform(userId, personId, data) {
  // Secretaries may only edit students inside their teaching categories.
  await assertStudentAllowed(await loadScope(userId), personId)
  await requireUniformSizeSchema()

  const existing = await query('SELECT * FROM student_parade_uniform WHERE person_id = $1', [personId])
  const current = existing.data?.[0] || {}

  // A male student has no skirt: the columns are left empty whether or not a
  // stale client still sends a value.
  const person = await query('SELECT person_sex FROM person WHERE person_id = $1', [personId])
  const isMale = person.data?.[0]?.PERSON_SEX === 'M'

  const sizes = {}
  for (const field of PARADE_UNIFORM_FIELDS) {
    sizes[field.key] = cleanIdentifier(data[field.key])
    if (isMale && FEMALE_ONLY_UNIFORM_KEYS.includes(field.key)) sizes[field.key] = null
  }
  await assertUniformSizes(PARADE_UNIFORM_FIELDS, sizes, current)

  await query(
    `INSERT INTO student_parade_uniform (
       person_id, summer_jacket_size, winter_jacket_size,
       summer_trousers_size, winter_trousers_size,
       summer_shirt_size, winter_shirt_size,
       summer_hat_size, winter_hat_size,
       summer_skirt_size, winter_skirt_size
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (person_id) DO UPDATE SET
       summer_jacket_size = EXCLUDED.summer_jacket_size,
       winter_jacket_size = EXCLUDED.winter_jacket_size,
       summer_trousers_size = EXCLUDED.summer_trousers_size,
       winter_trousers_size = EXCLUDED.winter_trousers_size,
       summer_shirt_size = EXCLUDED.summer_shirt_size,
       winter_shirt_size = EXCLUDED.winter_shirt_size,
       summer_hat_size = EXCLUDED.summer_hat_size,
       winter_hat_size = EXCLUDED.winter_hat_size,
       summer_skirt_size = EXCLUDED.summer_skirt_size,
       winter_skirt_size = EXCLUDED.winter_skirt_size`,
    [
      personId,
      sizes.SUMMER_JACKET_SIZE, sizes.WINTER_JACKET_SIZE,
      sizes.SUMMER_TROUSERS_SIZE, sizes.WINTER_TROUSERS_SIZE,
      sizes.SUMMER_SHIRT_SIZE, sizes.WINTER_SHIRT_SIZE,
      sizes.SUMMER_HAT_SIZE, sizes.WINTER_HAT_SIZE,
      sizes.SUMMER_SKIRT_SIZE, sizes.WINTER_SKIRT_SIZE
    ]
  )
  return { success: true }
}
