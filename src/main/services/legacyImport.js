// Legacy (MySQL) registry import.
//
// The old eNote dump is read into memory, then mapped onto the PostgreSQL
// registry by the declarative steps below. Preview runs the very same steps with
// a writer that only counts, so the plan shown to the user cannot drift from
// what an import actually does.
//
// Each step is one table (plus the reference rows it needs). A step is blocked
// only by its own source table or by a step it depends on. The caller may
// therefore import a subset of the plan and a blocker in one table no longer
// aborts the whole registry. The selected steps still share one transaction;
// every step runs inside its own savepoint, so a row that fails at run time
// rolls back only that table and the rest of the selection still commits.
//
// Import modes (the registry may already hold rows):
//  - merge: keep the existing rows. A row that is already there is reused by
//    its stable code (or, for people and sessions, by a deterministic identity)
//    so dependants can still link, and only missing rows are inserted.
//  - replace: delete the existing rows of the selected target tables first,
//    then import, so the result mirrors the dump exactly. Because the tables
//    are cleared up front, this mode is all-or-nothing: any failure rolls the
//    whole run back and the registry is left as it was.
// Merging cannot invent an identity for a row without a natural key, so people
// are keyed on the old person id and sessions on their timetable tuple.
//
// Deliberate limits (surfaced in the plan, never silent):
//  - Accounts arrive inactive with an unusable password; an Admin sets new ones.
//  - Old profile lookups with no PostgreSQL counterpart (speciality, academic
//    level, health status, army, address, uniforms, certificates) stay behind.
//  - Photos and attachments live on the old machine and are not copied.

import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { query, withTransaction } from '../db'
import { parseMysqlDump, tableRows } from './legacyDump'
import { fitFamilyCounts } from '../../shared/studentDetailRules'

export const LEGACY_IMPORT_ROLES = ['ADMIN', 'DEVELOPER']

// Entity tables whose row counts are shown in the plan: they tell the reviewer
// whether an import merges into existing data or replaces it.
const COUNTED_TABLES = [
  ['person', 'person'],
  ['user', 'user'],
  ['study_year', 'study_year'],
  ['study_semester', 'study_semester'],
  ['study_week', 'study_week'],
  ['study_day', 'study_day'],
  ['classroom', 'classroom'],
  ['major', 'major'],
  ['section', 'section'],
  ['teaching_group', 'teaching_group'],
  ['study_session', 'study_session'],
  ['student_detail', 'student_detail'],
  ['student_section', 'student_section'],
  ['person_has_role', 'person_has_role'],
  ['person_studies_major', 'person_studies_major'],
  ['person_teaches_major', 'person_teaches_major'],
  ['student_gets_absent', 'student_gets_absent'],
  ['student_undergoes_observation_by_teacher', 'student_undergoes_observation_by_teacher']
]

const REASONS = {
  missingPerson: 'Person not in the dump',
  missingSection: 'Section not in the dump',
  missingMajor: 'Major not in the dump',
  missingSession: 'Session not in the dump',
  missingYear: 'Study year not in the dump',
  missingSemester: 'Semester not in the dump',
  missingWeek: 'Week not in the dump',
  missingDay: 'Day not in the dump',
  missingClassroom: 'Classroom not in the dump',
  missingType: 'Session type not in the dump',
  missingInstructor: 'Session has no teacher',
  missingTime: 'Session has no start or end time',
  missingStudent: 'Absence has no student',
  missingNote: 'Observation has no session or teacher',
  missingName: 'Person has no name',
  missingUsername: 'Account has no username',
  duplicateUsername: 'Duplicate username in the dump',
  duplicateEmail: 'Duplicate email in the dump',
  unknownRole: 'Role does not exist in this registry',
  duplicateAbsence: 'Absence already linked to that student',
  duplicateGroup: 'Section and major already form a group',
  duplicateLink: 'Already linked',
  duplicateSerial: 'Duplicate student serial number',
  missingJustification: 'Absence motif could not be created',
  invalidDate: 'Date could not be read'
}

const NOTE_KEYS = {
  accountsInactive: 'Imported accounts are inactive. Set new passwords under Settings → User passwords before anyone signs in.',
  photos: 'Photos and attachments are not copied: they live on the old machine.',
  profileLookups: 'Student profile fields that depend on old lookup tables (speciality, academic level, health status, army, address, uniforms, certificates) are not carried over.',
  roles: 'Roles are matched by code; accounts with an unknown role are skipped and listed here.'
}

const IMPORT_MODES = ['merge', 'replace']

// How the caller wants an already-populated registry handled. Merge is the
// default: it never deletes anything and is safe to repeat.
function normalizeMode(mode) {
  const wanted = String(mode || '').toLowerCase()
  return IMPORT_MODES.includes(wanted) ? wanted : 'merge'
}

function pick(row, ...names) {
  for (const name of names) {
    if (row && row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name]
  }
  return null
}

function text(value) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}

function intOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function decimalOrNull(value, min, max) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) return null
  return n
}

function dateOrNull(value) {
  const raw = text(value)
  if (!raw) return null
  if (/^0000-00-00/.test(raw)) return null
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

function timeOrNull(value) {
  const raw = text(value)
  if (!raw) return null
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!match) return null
  const hh = String(Math.min(23, Number(match[1]))).padStart(2, '0')
  return `${hh}:${match[2]}:${match[3] || '00'}`
}

function datetimeOrNull(value) {
  const raw = text(value)
  if (!raw || /^0000-00-00/.test(raw)) return null
  const date = dateOrNull(raw)
  if (!date) return null
  const time = timeOrNull(raw.slice(11)) || '00:00:00'
  return `${date} ${time}`
}

function slug(value, fallback) {
  const base = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || fallback
}

function keysOf(value) {
  return String(value ?? '').trim().toUpperCase()
}

function sex(value) {
  const raw = keysOf(value)
  if (raw === 'MALE' || raw === 'M') return 'M'
  if (raw === 'FEMALE' || raw === 'F') return 'F'
  return null
}

function truncate(value, length) {
  const raw = text(value)
  if (!raw) return null
  return raw.length > length ? raw.slice(0, length) : raw
}

// ---------------------------------------------------------------------------
// Reading the dump and the target's reference data
// ---------------------------------------------------------------------------

const MAX_DUMP_BYTES = 512 * 1024 * 1024

async function readDump(filePath) {
  const resolved = path.resolve(String(filePath || ''))
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('That path is not a file.')
  if (stat.size === 0) throw new Error('That file is empty.')
  if (stat.size > MAX_DUMP_BYTES) throw new Error('That dump is larger than 512 MB. Split it before importing.')
  const sql = await fs.readFile(resolved, 'utf8')
  const parsed = parseMysqlDump(sql)
  return { path: resolved, name: path.basename(resolved), bytes: stat.size, parsed }
}

async function rowsOf(sql, params = []) {
  const result = await query(sql, params)
  return result?.data || []
}

async function loadLookups() {
  const [roles, types, categories, justifications, motifs] = await Promise.all([
    rowsOf('SELECT role_id, UPPER(role_code) AS code FROM role'),
    rowsOf('SELECT study_session_type_id, UPPER(study_session_type_code) AS code FROM study_session_type'),
    rowsOf('SELECT teaching_category_id, UPPER(teaching_category_code) AS code, teaching_category_label_en AS label FROM teaching_category'),
    rowsOf('SELECT absence_justification_id, UPPER(absence_justification_code) AS code, absence_justification_label_en AS label FROM absence_justification'),
    rowsOf('SELECT observation_motif_id, UPPER(observation_motif_code) AS code, observation_motif_label_en AS label FROM observation_motif')
  ])

  const byCode = (rows) => new Map(rows.map((r) => [r.CODE, r]))
  const byLabel = (rows, idKey) => {
    const map = new Map()
    for (const row of rows) {
      const label = keysOf(row.LABEL)
      if (label && !map.has(label)) map.set(label, row)
    }
    return map
  }

  return {
    roles: new Map(roles.map((r) => [r.CODE, r.ROLE_ID])),
    sessionTypes: byCode(types),
    categories: byCode(categories),
    categoryLabels: byLabel(categories),
    justifications: byCode(justifications),
    justificationLabels: byLabel(justifications),
    motifs: byCode(motifs),
    motifLabels: byLabel(motifs)
  }
}

// The registry has a table called `user`, a reserved word that must be quoted;
// every identifier that comes from a step goes through here.
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

async function targetCounts(run) {
  const counts = []
  for (const [table, label] of COUNTED_TABLES) {
    const rows = await run(`SELECT COUNT(*)::int AS total FROM ${quoteIdent(table)}`)
    counts.push({ table, label, count: Number(rows?.[0]?.TOTAL ?? 0) })
  }
  return counts
}

async function assertCanImport(userId) {
  // ADMIN and DEVELOPER are account-level roles carried by "user".role_id, not
  // rows in person_has_role (which holds TEACHER/STUDENT); read the account's
  // role the same way every other gate in the app does.
  const rows = await rowsOf(
    `SELECT 1
       FROM "user" u
       JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1
        AND u.is_active = TRUE
        AND UPPER(r.role_code) = ANY($2::text[])
      LIMIT 1`,
    [userId, LEGACY_IMPORT_ROLES]
  )
  if (rows.length === 0) {
    throw new Error('Only an active Admin or Developer can import the old registry.')
  }
}

// ---------------------------------------------------------------------------
// Writers: a live one inside the transaction, and a counting one for preview
// ---------------------------------------------------------------------------

function normalizeTxResult(result) {
  if (Array.isArray(result)) return result
  return result?.data || []
}

function insertSql(table, row) {
  const columns = Object.keys(row)
  const placeholders = columns.map((_, index) => `$${index + 1}`)
  return {
    // `user` is a reserved word, so the table name is always quoted.
    sql: `INSERT INTO ${quoteIdent(table)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING RETURNING *`,
    values: columns.map((column) => row[column])
  }
}

function liveWriter(tx) {
  const run = async (sql, params = []) => normalizeTxResult(await tx(sql, params))
  // One savepoint per step: a row that fails at run time rolls back only that
  // table, while the rest of the selected import can still commit.
  let savepoint = null
  return {
    run,
    // Reads existing rows inside the transaction (merge mode looks them up so a
    // row that is already there is reused instead of inserted twice).
    read: run,
    async beginStep(id) {
      const name = `legacy_step_${String(id).replace(/[^A-Za-z0-9_]/g, '_')}`
      await run(`SAVEPOINT ${name}`)
      savepoint = name
    },
    async endStep() {
      if (!savepoint) return
      const name = savepoint
      savepoint = null
      await run(`RELEASE SAVEPOINT ${name}`)
    },
    async rollbackStep() {
      if (!savepoint) return
      const name = savepoint
      savepoint = null
      await run(`ROLLBACK TO SAVEPOINT ${name}`)
      await run(`RELEASE SAVEPOINT ${name}`)
    },
    async insert(table, row) {
      const { sql, values } = insertSql(table, row)
      const rows = await run(sql, values)
      return rows[0] || null
    },
    async link(table, row) {
      const { sql, values } = insertSql(table, row)
      const rows = await run(sql, values)
      // A composite primary key already present means the link is reused.
      return rows[0] || null
    },
    async updatePersonProfile(personId, profile) {
      await run(
        `UPDATE person
            SET person_birthdate = COALESCE($2::date, person_birthdate),
                person_sex = COALESCE($3, person_sex)
          WHERE person_id = $1`,
        [personId, profile.birthdate, profile.sex]
      )
    }
  }
}

function previewWriter({ keepExisting = false } = {}) {
  let placeholder = 0
  return {
    // Merge previews read the real registry so the plan counts only the rows
    // that are missing. A replace preview counts the whole dump instead.
    async read(sql, params = []) {
      if (!keepExisting) return []
      const result = await query(sql, params)
      return result?.data || []
    },
    async insert() {
      placeholder -= 1
      return { PLACEHOLDER: placeholder }
    },
    async link() {},
    async updatePersonProfile() {}
  }
}

// Some installs predate a column the importer writes (student_serial_number).
// Ask the catalog instead of failing the whole table at run time.
async function tableHasColumn(ctx, table, column) {
  const cacheKey = `${table}.${column}`
  if (ctx.columns.has(cacheKey)) return ctx.columns.get(cacheKey)
  const rows = await ctx.writer.read(
    `SELECT 1 AS present
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = $1
        AND column_name = $2
      LIMIT 1`,
    [table, column]
  )
  const present = rows.length > 0
  ctx.columns.set(cacheKey, present)
  return present
}

// ---------------------------------------------------------------------------
// The mapping itself
// ---------------------------------------------------------------------------

function makeContext(parsed, lookups, writer) {
  return {
    parsed,
    lookups,
    writer,
    disabledHash: null,
    // Existing teaching group codes, so a fallback group is reused in merge mode.
    groupCodes: new Map(),
    groupCodesLoaded: false,
    // Cached information_schema answers (see tableHasColumn).
    columns: new Map(),
    ids: {
      person: new Map(),
      year: new Map(),
      semester: new Map(),
      week: new Map(),
      day: new Map(),
      sessionType: new Map(),
      category: new Map(),
      classroom: new Map(),
      major: new Map(),
      section: new Map(),
      group: new Map(),
      groupByMajor: new Map(),
      session: new Map(),
      justification: new Map(),
      motif: new Map()
    },
    stats: new Map(),
    notes: new Map(),
    stepOrder: []
  }
}

function stepStat(ctx, id, label, source, target) {
  if (!ctx.stats.has(id)) {
    ctx.stats.set(id, {
      id,
      label,
      source,
      target,
      read: 0,
      inserted: 0,
      reused: 0,
      skipped: 0,
      reasons: new Map()
    })
    ctx.stepOrder.push(id)
  }
  return ctx.stats.get(id)
}

// A stable string key for an existing row, e.g. a code or a tuple of columns.
function rowKey(...parts) {
  return parts
    .map((part) => (part === null || part === undefined ? '' : String(part).trim().toUpperCase()))
    .join('|')
}

// Reads the existing rows once and indexes them by their natural key, so a
// merge can map an old id to the row that already holds the same data.
async function existingByKey(ctx, sql, keyOf, idOf) {
  const rows = await ctx.writer.read(sql)
  const map = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (!map.has(key)) map.set(key, idOf(row))
  }
  return map
}

async function existingByCode(ctx, table, idColumn, codeColumn) {
  return existingByKey(
    ctx,
    `SELECT ${idColumn}, ${codeColumn} FROM ${quoteIdent(table)}`,
    (row) => rowKey(row[codeColumn.toUpperCase()]),
    (row) => row[idColumn.toUpperCase()]
  )
}

function countRead(stat, amount = 1) {
  stat.read += amount
}

function countSkip(ctx, stat, reason, amount = 1) {
  stat.skipped += amount
  stat.reasons.set(reason, (stat.reasons.get(reason) || 0) + amount)
}

// Records a caveat about a row that is still imported (for example a student
// whose section is missing). It is a reason without a skip.
function countReason(ctx, stat, reason, amount = 1) {
  stat.reasons.set(reason, (stat.reasons.get(reason) || 0) + amount)
}

function note(ctx, key) {
  ctx.notes.set(key, (ctx.notes.get(key) || 0) + 1)
}

function insertedId(row, column) {
  if (!row) return null
  return row[column.toUpperCase()] ?? row[column] ?? row.PLACEHOLDER ?? null
}

function groupKey(sectionId, majorId) {
  return `${sectionId}|${majorId}`
}

// sources: dump tables the step reads. targets: PostgreSQL tables the step
// writes (reference tables are reused by code/label and are not listed; a
// replace clears only the listed tables). dependsOn: steps whose in-memory id
// map this step needs, and therefore the steps that must be imported with it.
const STEPS = [
  {
    id: 'sessionTypes',
    label: 'Session types',
    source: 'study_session_type',
    target: 'study_session_type',
    sources: ['study_session_type'],
    targets: [],
    dependsOn: [],
    run: importSessionTypes
  },
  {
    id: 'years',
    label: 'Study years',
    source: 'study_year',
    target: 'study_year',
    sources: ['study_year'],
    targets: ['study_year'],
    dependsOn: [],
    run: importYears
  },
  {
    id: 'semesters',
    label: 'Semesters',
    source: 'study_semester',
    target: 'study_semester',
    sources: ['study_semester'],
    targets: ['study_semester'],
    dependsOn: ['years'],
    run: importSemesters
  },
  {
    id: 'weeks',
    label: 'Weeks',
    source: 'study_week',
    target: 'study_week',
    sources: ['study_week'],
    targets: ['study_week'],
    dependsOn: ['semesters'],
    run: importWeeks
  },
  {
    id: 'days',
    label: 'Days',
    source: 'study_day',
    target: 'study_day',
    sources: ['study_day'],
    targets: ['study_day'],
    dependsOn: ['weeks'],
    run: importDays
  },
  {
    id: 'categories',
    label: 'Teaching categories',
    source: 'category',
    target: 'teaching_category',
    sources: ['category'],
    targets: [],
    dependsOn: [],
    run: importCategories
  },
  {
    id: 'classrooms',
    label: 'Classrooms',
    source: 'class',
    target: 'classroom',
    sources: ['class'],
    targets: ['classroom'],
    dependsOn: [],
    run: importClassrooms
  },
  {
    id: 'majors',
    label: 'Majors',
    source: 'major',
    target: 'major',
    sources: ['major'],
    targets: ['major'],
    dependsOn: [],
    run: importMajors
  },
  {
    id: 'sections',
    label: 'Sections',
    source: 'section',
    target: 'section',
    sources: ['section'],
    targets: ['section'],
    dependsOn: ['categories'],
    run: importSections
  },
  {
    id: 'groups',
    label: 'Teaching groups',
    source: 'studies',
    target: 'teaching_group',
    sources: ['studies'],
    targets: ['teaching_group'],
    dependsOn: ['sections', 'majors'],
    run: importGroups
  },
  {
    id: 'people',
    label: 'People',
    source: 'person',
    target: 'person',
    sources: ['person'],
    targets: ['person'],
    dependsOn: [],
    run: importPeople
  },
  {
    id: 'accounts',
    label: 'Accounts and roles',
    source: 'user_account',
    target: 'user',
    sources: ['user_account'],
    targets: ['user', 'person_has_role'],
    dependsOn: ['people'],
    run: importAccounts
  },
  {
    id: 'students',
    label: 'Student records',
    source: 'student_detail',
    target: 'student_detail',
    sources: ['student_detail'],
    targets: ['student_detail', 'student_section'],
    dependsOn: ['people', 'sections'],
    run: importStudents
  },
  {
    id: 'studentMajors',
    label: 'Student majors',
    source: 'studies',
    target: 'person_studies_major',
    sources: ['studies', 'student_detail'],
    targets: ['person_studies_major'],
    dependsOn: ['people', 'majors'],
    run: importStudentMajors
  },
  {
    id: 'teacherMajors',
    label: 'Teacher majors',
    source: 'teaches',
    target: 'person_teaches_major',
    sources: ['teaches'],
    targets: ['person_teaches_major'],
    dependsOn: ['people', 'majors'],
    run: importTeacherMajors
  },
  {
    id: 'sessions',
    label: 'Study sessions',
    source: 'study_session',
    target: 'study_session',
    sources: ['study_session'],
    targets: ['study_session'],
    dependsOn: ['people', 'majors', 'days', 'classrooms', 'sessionTypes'],
    run: importSessions
  },
  {
    id: 'absences',
    label: 'Absences',
    source: 'absence',
    target: 'student_gets_absent',
    sources: ['absence', 'student_gets_absent'],
    targets: ['student_gets_absent'],
    dependsOn: ['sessions', 'people'],
    run: importAbsences
  },
  {
    id: 'observations',
    label: 'Observations',
    source: 'teacher_makes_an_observation_for_a_student',
    target: 'student_undergoes_observation_by_teacher',
    sources: ['teacher_makes_an_observation_for_a_student'],
    targets: ['student_undergoes_observation_by_teacher'],
    dependsOn: ['sessions', 'people'],
    run: importObservations
  }
]

const STEP_BY_ID = new Map(STEPS.map((step) => [step.id, step]))
const ALL_STEP_IDS = STEPS.map((step) => step.id)

async function importSessionTypes(ctx) {
  const stat = stepStat(ctx, 'sessionTypes', 'Session types', 'study_session_type', 'study_session_type')
  for (const row of tableRows(ctx.parsed, 'study_session_type')) {
    countRead(stat)
    const labelEn = text(pick(row, 'STUDY_SESSION_TYPE_LABEL_EN'))
    const code = text(pick(row, 'STUDY_SESSION_TYPE_CODE')) || slug(labelEn, 'TYPE')
    const existing = ctx.lookups.sessionTypes.get(keysOf(code))
    let id = existing?.STUDY_SESSION_TYPE_ID ?? null
    // A type that is already in the registry is reused, not inserted again.
    let created = false
    if (!id) {
      const inserted = await ctx.writer.insert('study_session_type', {
        study_session_type_code: truncate(code, 20),
        study_session_type_label_en: truncate(labelEn || code, 100),
        study_session_type_label_ar: truncate(pick(row, 'STUDY_SESSION_TYPE_LABEL_AR'), 100),
        study_session_type_label_fr: truncate(pick(row, 'STUDY_SESSION_TYPE_LABEL_FR'), 100),
      })
      id = insertedId(inserted, 'study_session_type_id')
      if (id) {
        ctx.lookups.sessionTypes.set(keysOf(code), { STUDY_SESSION_TYPE_ID: id })
        created = true
      }
    }
    if (id) {
      ctx.ids.sessionType.set(String(pick(row, 'STUDY_SESSION_TYPE_ID')), id)
      if (created) stat.inserted += 1
      else stat.reused += 1
    } else {
      countSkip(ctx, stat, REASONS.missingType)
    }
  }
}

async function importYears(ctx) {
  const stat = stepStat(ctx, 'years', 'Study years', 'study_year', 'study_year')
  const existing = await existingByCode(ctx, 'study_year', 'study_year_id', 'study_year_code')
  for (const row of tableRows(ctx.parsed, 'study_year')) {
    countRead(stat)
    const labelEn = text(pick(row, 'STUDY_YEAR_LABEL_EN'))
    const code = text(pick(row, 'STUDY_YEAR_CODE')) || slug(labelEn, 'YEAR')
    const oldId = String(pick(row, 'STUDY_YEAR_ID'))
    const storedCode = truncate(code, 20)
    const key = rowKey(storedCode)
    const known = existing.get(key)
    if (known) {
      ctx.ids.year.set(oldId, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('study_year', {
      study_year_code: storedCode,
      study_year_label_en: truncate(labelEn || code, 100),
      study_year_label_ar: truncate(pick(row, 'STUDY_YEAR_LABEL_AR'), 100),
      study_year_label_fr: truncate(pick(row, 'STUDY_YEAR_LABEL_FR'), 100),
      study_year_start_date: dateOrNull(pick(row, 'START_DATE')),
      study_year_end_date: dateOrNull(pick(row, 'END_DATE'))
    })
    const id = insertedId(inserted, 'study_year_id')
    if (id) {
      ctx.ids.year.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

async function importSemesters(ctx) {
  const stat = stepStat(ctx, 'semesters', 'Semesters', 'study_semester', 'study_semester')
  const existing = await existingByKey(
    ctx,
    'SELECT study_semester_id, study_year_id, study_semester_code FROM study_semester',
    (row) => rowKey(row.STUDY_YEAR_ID, row.STUDY_SEMESTER_CODE),
    (row) => row.STUDY_SEMESTER_ID
  )
  for (const row of tableRows(ctx.parsed, 'study_semester')) {
    countRead(stat)
    const oldId = String(pick(row, 'STUDY_SEMESTER_ID'))
    const yearId = ctx.ids.year.get(String(pick(row, 'STUDY_YEAR_ID')))
    if (!yearId) { countSkip(ctx, stat, REASONS.missingYear); continue }
    const labelEn = text(pick(row, 'STUDY_SEMESTER_LABEL_EN'))
    const code = text(pick(row, 'STUDY_SEMESTER_CODE')) || slug(labelEn, 'SEM')
    const storedCode = truncate(code, 20)
    const key = rowKey(yearId, storedCode)
    const known = existing.get(key)
    if (known) {
      ctx.ids.semester.set(oldId, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('study_semester', {
      study_year_id: yearId,
      study_semester_code: storedCode,
      study_semester_label_en: truncate(labelEn || code, 100),
      study_semester_label_ar: truncate(pick(row, 'STUDY_SEMESTER_LABEL_AR'), 100),
      study_semester_label_fr: truncate(pick(row, 'STUDY_SEMESTER_LABEL_FR'), 100),
      study_semester_start_date: dateOrNull(pick(row, 'START_DATE')),
      study_semester_end_date: dateOrNull(pick(row, 'END_DATE'))
    })
    const id = insertedId(inserted, 'study_semester_id')
    if (id) {
      ctx.ids.semester.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

async function importWeeks(ctx) {
  const stat = stepStat(ctx, 'weeks', 'Weeks', 'study_week', 'study_week')
  const existing = await existingByKey(
    ctx,
    'SELECT study_week_id, study_semester_id, study_week_code FROM study_week',
    (row) => rowKey(row.STUDY_SEMESTER_ID, row.STUDY_WEEK_CODE),
    (row) => row.STUDY_WEEK_ID
  )
  for (const row of tableRows(ctx.parsed, 'study_week')) {
    countRead(stat)
    const oldId = String(pick(row, 'STUDY_WEEK_ID'))
    const semesterId = ctx.ids.semester.get(String(pick(row, 'STUDY_SEMESTER_ID')))
    if (!semesterId) { countSkip(ctx, stat, REASONS.missingSemester); continue }
    const labelEn = text(pick(row, 'STUDY_WEEK_LABEL_EN'))
    const code = text(pick(row, 'STUDY_WEEK_CODE')) || slug(labelEn, 'WEEK')
    const storedCode = truncate(code, 20)
    const key = rowKey(semesterId, storedCode)
    const known = existing.get(key)
    if (known) {
      ctx.ids.week.set(oldId, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('study_week', {
      study_semester_id: semesterId,
      study_week_code: storedCode,
      study_week_label_en: truncate(labelEn || code, 100),
      study_week_label_ar: truncate(pick(row, 'STUDY_WEEK_LABEL_AR'), 100),
      study_week_label_fr: truncate(pick(row, 'STUDY_WEEK_LABEL_FR'), 100),
      study_week_start_date: dateOrNull(pick(row, 'START_DATE')),
      study_week_end_date: dateOrNull(pick(row, 'END_DATE'))
    })
    const id = insertedId(inserted, 'study_week_id')
    if (id) {
      ctx.ids.week.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

async function importDays(ctx) {
  const stat = stepStat(ctx, 'days', 'Days', 'study_day', 'study_day')
  const existing = await existingByKey(
    ctx,
    'SELECT study_day_id, study_week_id, study_day_date::text AS study_day_date FROM study_day',
    (row) => rowKey(row.STUDY_WEEK_ID, row.STUDY_DAY_DATE),
    (row) => row.STUDY_DAY_ID
  )
  for (const row of tableRows(ctx.parsed, 'study_day')) {
    countRead(stat)
    const oldId = String(pick(row, 'STUDY_DAY_ID'))
    const weekId = ctx.ids.week.get(String(pick(row, 'STUDY_WEEK_ID')))
    if (!weekId) { countSkip(ctx, stat, REASONS.missingWeek); continue }
    const day = dateOrNull(pick(row, 'STUDY_DAY_DATE'))
    if (!day) { countSkip(ctx, stat, REASONS.invalidDate); continue }
    const key = rowKey(weekId, day)
    const known = existing.get(key)
    if (known) {
      ctx.ids.day.set(oldId, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('study_day', { study_week_id: weekId, study_day_date: day })
    const id = insertedId(inserted, 'study_day_id')
    if (id) {
      ctx.ids.day.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

async function importCategories(ctx) {
  const stat = stepStat(ctx, 'categories', 'Teaching categories', 'category', 'teaching_category')
  for (const row of tableRows(ctx.parsed, 'category')) {
    countRead(stat)
    const labelEn = text(pick(row, 'CATEGORY_NAME_EN'))
    const code = slug(labelEn, `CAT-${pick(row, 'CATEGORY_ID') || 'X'}`)
    let id = ctx.lookups.categories.get(code)?.TEACHING_CATEGORY_ID
    if (!id) id = ctx.lookups.categoryLabels.get(keysOf(labelEn))?.TEACHING_CATEGORY_ID
    // A category that is already in the registry is reused, not inserted again.
    let created = false
    if (!id) {
      const inserted = await ctx.writer.insert('teaching_category', {
        teaching_category_code: truncate(code, 20),
        teaching_category_label_en: truncate(labelEn || code, 100),
        teaching_category_label_ar: truncate(pick(row, 'CATEGORY_NAME_AR'), 100),
        teaching_category_label_fr: truncate(pick(row, 'CATEGORY_NAME_FR'), 100),
      })
      id = insertedId(inserted, 'teaching_category_id')
      if (id) {
        ctx.lookups.categories.set(code, { TEACHING_CATEGORY_ID: id })
        created = true
      }
    }
    if (id) {
      ctx.ids.category.set(String(pick(row, 'CATEGORY_ID')), id)
      if (created) stat.inserted += 1
      else stat.reused += 1
    }
  }
}

async function importClassrooms(ctx) {
  const stat = stepStat(ctx, 'classrooms', 'Classrooms', 'class', 'classroom')
  const existing = await existingByCode(ctx, 'classroom', 'classroom_id', 'classroom_code')
  for (const row of tableRows(ctx.parsed, 'class')) {
    countRead(stat)
    const oldId = String(pick(row, 'CLASS_ID'))
    const labelEn = text(pick(row, 'CLASS_NAME_EN'))
    const code = truncate(`LEGACY-CLASS-${oldId}`, 50)
    const key = rowKey(code)
    const known = existing.get(key)
    if (known) {
      ctx.ids.classroom.set(oldId, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('classroom', {
      classroom_code: code,
      classroom_label_en: truncate(labelEn || `Class ${oldId}`, 100),
      classroom_label_ar: truncate(pick(row, 'CLASS_NAME_AR'), 100),
      classroom_label_fr: truncate(pick(row, 'CLASS_NAME_FR'), 100),
      classroom_capacity: intOrNull(pick(row, 'CAPACITY'))
    })
    const id = insertedId(inserted, 'classroom_id')
    if (id) {
      ctx.ids.classroom.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

async function importMajors(ctx) {
  const stat = stepStat(ctx, 'majors', 'Majors', 'major', 'major')
  const existing = await existingByCode(ctx, 'major', 'major_id', 'major_code')
  for (const row of tableRows(ctx.parsed, 'major')) {
    countRead(stat)
    const oldId = String(pick(row, 'MAJOR_ID'))
    const labelEn = text(pick(row, 'MAJOR_NAME_EN'))
    const code = truncate(oldId, 20)
    const key = rowKey(code)
    const known = existing.get(key)
    if (known) {
      ctx.ids.major.set(oldId, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('major', {
      major_code: code,
      major_label_en: truncate(labelEn || oldId, 100),
      major_label_ar: truncate(pick(row, 'MAJOR_NAME_AR'), 100),
      major_label_fr: truncate(pick(row, 'MAJOR_NAME_FR'), 100)
    })
    const id = insertedId(inserted, 'major_id')
    if (id) {
      ctx.ids.major.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

async function importSections(ctx) {
  const stat = stepStat(ctx, 'sections', 'Sections', 'section', 'section')
  const existing = await existingByCode(ctx, 'section', 'section_id', 'section_code')
  for (const row of tableRows(ctx.parsed, 'section')) {
    countRead(stat)
    const oldId = String(pick(row, 'SECTION_ID'))
    const labelEn = text(pick(row, 'SECTION_NAME_EN'))
    const code = truncate(`LEGACY-SEC-${oldId}`, 20)
    const key = rowKey(code)
    const known = existing.get(key)
    if (known) {
      ctx.ids.section.set(oldId, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('section', {
      section_code: code,
      section_label_en: truncate(labelEn || `Section ${oldId}`, 100),
      section_label_ar: truncate(pick(row, 'SECTION_NAME_AR'), 100),
      section_label_fr: truncate(pick(row, 'SECTION_NAME_FR'), 100),
      teaching_category_id: ctx.ids.category.get(String(pick(row, 'CATEGORY_ID'))) || null
    })
    const id = insertedId(inserted, 'section_id')
    if (id) {
      ctx.ids.section.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

async function importGroups(ctx) {
  const stat = stepStat(ctx, 'groups', 'Teaching groups', 'studies', 'teaching_group')
  const existing = await existingByCode(ctx, 'teaching_group', 'teaching_group_id', 'teaching_group_code')
  ctx.groupCodes = existing
  ctx.groupCodesLoaded = true
  for (const row of tableRows(ctx.parsed, 'studies')) {
    countRead(stat)
    const sectionOld = String(pick(row, 'SECTION_ID'))
    const majorOld = String(pick(row, 'MAJOR_ID'))
    const sectionId = ctx.ids.section.get(sectionOld)
    const majorId = ctx.ids.major.get(majorOld)
    if (!sectionId) { countSkip(ctx, stat, REASONS.missingSection); continue }
    if (!majorId) { countSkip(ctx, stat, REASONS.missingMajor); continue }
    const key = groupKey(sectionOld, majorOld)
    if (ctx.ids.group.has(key)) {
      countSkip(ctx, stat, REASONS.duplicateGroup)
      continue
    }
    const code = truncate(`LEGACY-G-${sectionOld}-${majorOld}`, 20)
    const known = existing.get(rowKey(code))
    if (known) {
      ctx.ids.group.set(key, known)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('teaching_group', {
      major_id: majorId,
      teaching_group_code: code,
      teaching_group_label_en: `Section ${sectionOld} · ${majorOld}`,
    })
    const id = insertedId(inserted, 'teaching_group_id')
    if (id) {
      ctx.ids.group.set(key, id)
      existing.set(rowKey(code), id)
      stat.inserted += 1
    }
  }
}

// person_id is issued by hand and is twelve digits (11-person-id-manual.sql).
// The old roster's numbers belong to another scheme, so the importer maps them
// into a range of its own. The mapping is derived from the old id rather than
// from a counter: a repeated import then lands on the same person row instead
// of creating a twin, which is what makes merge mode safe.
const IMPORT_PERSON_ID_BASE = 900000000000
// Old ids that are not numeric are hashed into this reserved block, kept away
// from the low numbers a roster uses so the two schemes cannot overlap.
const IMPORT_PERSON_HASH_BASE = 50000000000
const IMPORT_PERSON_HASH_RANGE = 10000000000

function legacyPersonId(oldId) {
  const raw = String(oldId)
  if (/^\d{1,11}$/.test(raw)) {
    const numeric = Number(raw)
    if (numeric > 0) return IMPORT_PERSON_ID_BASE + numeric
  }
  const digest = crypto.createHash('sha1').update(raw).digest()
  const offset = IMPORT_PERSON_HASH_BASE + (digest.readUInt32BE(0) % IMPORT_PERSON_HASH_RANGE)
  return IMPORT_PERSON_ID_BASE + offset
}

async function importPeople(ctx) {
  const stat = stepStat(ctx, 'people', 'People', 'person', 'person')
  const existing = new Set(
    (await ctx.writer.read('SELECT person_id FROM person')).map((row) => String(row.PERSON_ID))
  )
  for (const row of tableRows(ctx.parsed, 'person')) {
    countRead(stat)
    const rawId = pick(row, 'PERSON_ID')
    const firstName = text(pick(row, 'FIRST_NAME_LA', 'FIRST_NAME_AR'))
    const lastName = text(pick(row, 'LAST_NAME_LA', 'LAST_NAME_AR'))
    if (!rawId || (!firstName && !lastName)) { countSkip(ctx, stat, REASONS.missingName); continue }
    const oldId = String(rawId)
    const personId = legacyPersonId(oldId)
    if (existing.has(String(personId))) {
      ctx.ids.person.set(oldId, personId)
      stat.reused += 1
      continue
    }
    const inserted = await ctx.writer.insert('person', {
      person_id: personId,
      person_first_name_la: truncate(firstName || lastName, 100),
      person_last_name_la: truncate(lastName || firstName, 100),
      person_first_name_ar: truncate(pick(row, 'FIRST_NAME_AR'), 100),
      person_last_name_ar: truncate(pick(row, 'LAST_NAME_AR'), 100)
    })
    // The mapped id is the identity even when the row already existed: the
    // insert above returned nothing only because ON CONFLICT kept it.
    ctx.ids.person.set(oldId, personId)
    existing.add(String(personId))
    if (inserted) stat.inserted += 1
    else stat.reused += 1
  }
}

async function importAccounts(ctx) {
  const stat = stepStat(ctx, 'accounts', 'Accounts and roles', 'user_account', 'user')
  const seenUsernames = new Set()
  const seenEmails = new Set()
  const existing = new Set(
    (await ctx.writer.read('SELECT user_username FROM "user"')).map((row) =>
      String(row.USER_USERNAME || '').toLowerCase()
    )
  )
  const rows = tableRows(ctx.parsed, 'user_account')
  if (rows.length > 0) note(ctx, NOTE_KEYS.accountsInactive)
  for (const row of rows) {
    countRead(stat)
    const personOld = String(pick(row, 'PERSON_ID'))
    const personId = ctx.ids.person.get(personOld)
    if (!personId) { countSkip(ctx, stat, REASONS.missingPerson); continue }

    const username = truncate(pick(row, 'USERNAME'), 50)
    if (!username) { countSkip(ctx, stat, REASONS.missingUsername); continue }
    if (seenUsernames.has(username.toLowerCase())) { countSkip(ctx, stat, REASONS.duplicateUsername); continue }
    if (existing.has(username.toLowerCase())) {
      // Already imported. Keeping the existing account also keeps its password
      // and role changes an Admin has made since.
      stat.reused += 1
      continue
    }

    let email = truncate(pick(row, 'EMAIL'), 100) || `${username}@legacy.import`
    if (seenEmails.has(email.toLowerCase())) {
      if (text(pick(row, 'EMAIL'))) { countSkip(ctx, stat, REASONS.duplicateEmail); continue }
      email = `${username}.${seenEmails.size}@legacy.import`
    }

    const roleCode = keysOf(pick(row, 'ROLE'))
    const roleId = ctx.lookups.roles.get(roleCode)
    if (!roleId) {
      note(ctx, NOTE_KEYS.roles)
      countSkip(ctx, stat, REASONS.unknownRole)
      continue
    }

    if (!ctx.disabledHash) {
      // An unusable password: nobody knows this random secret, and the account is
      // inactive until an Admin sets a real one from Settings → User passwords.
      ctx.disabledHash = bcrypt.hashSync(`legacy-import-${crypto.randomBytes(24).toString('hex')}`, 10)
    }

    const inserted = await ctx.writer.insert('user', {
      person_id: personId,
      user_username: username,
      user_password_hash: ctx.disabledHash,
      user_email: email,
      role_id: roleId,
      is_active: false,
      is_beta_tester: Number(pick(row, 'IS_BETA_TESTER')) === 1,
      last_seen_at: datetimeOrNull(pick(row, 'LAST_LOGIN_AT')),
      created_at: datetimeOrNull(pick(row, 'CREATED_AT')) || new Date()
    })
    const userId = insertedId(inserted, 'user_id')
    if (!userId) { countSkip(ctx, stat, REASONS.duplicateUsername); continue }
    seenUsernames.add(username.toLowerCase())
    seenEmails.add(email.toLowerCase())
    existing.add(username.toLowerCase())
    // person_has_role holds the person's identity roles only. A staff role
    // belongs to the account row above and is what the server checks; linking
    // it here would create an identity the database refuses
    // (15-person-role-codes.sql) and that no permission ever read.
    if (roleCode === 'STUDENT' || roleCode === 'TEACHER') {
      await ctx.writer.link('person_has_role', { person_id: personId, role_id: roleId })
    }
    stat.inserted += 1
  }
}

// Profile values that must stay unique across the roster. Duplicates in the old
// data would abort the whole import, so later repeats are dropped and counted.
const STUDENT_UNIQUE_FIELDS = [
  ['STUDENT_PERSONAL_PHONE', 'student_personal_phone', 20],
  ['STUDENT_NATIONAL_IDENTIFICATION_NUMBER', 'student_national_identification_number', 30],
  ['STUDENT_SCHOOL_SUB_CARD_NUMBER', 'student_school_sub_card_number', 30],
  ['STUDENT_LAPTOP_SERIAL_NUMBER', 'student_laptop_serial_number', 50],
  ['STUDENT_POSTAL_ACCOUNT_NUMBER', 'student_postal_account_number', 30],
  ['STUDENT_BACCALAUREATE_SUB_NUMBER', 'student_baccalaureate_sub_number', 30],
  ['STUDENT_INSURANCE_CARD_NUMBER', 'student_insurance_card_number', 20],
  ['STUDENT_MILITARY_CARD_NUMBER', 'student_military_card_number', 20],
  ['STUDENT_MILITARY_HELMET_NUMBER', 'student_military_helmet_number', 14]
]

async function importStudents(ctx) {
  const stat = stepStat(ctx, 'students', 'Student records', 'student_detail', 'student_detail')
  note(ctx, NOTE_KEYS.profileLookups)
  const seen = new Map(STUDENT_UNIQUE_FIELDS.map(([, column]) => [column, new Set()]))
  // student_serial_number is not present in every registry the importer meets;
  // the catalog check keeps the row insert working on those installs.
  const hasSerial = await tableHasColumn(ctx, 'student_detail', 'student_serial_number')
  const existing = new Set(
    (await ctx.writer.read('SELECT person_id FROM student_detail')).map((row) => String(row.PERSON_ID))
  )
  const rows = tableRows(ctx.parsed, 'student_detail')
  for (const row of rows) {
    countRead(stat)
    const serial = truncate(pick(row, 'STUDENT_SERIAL_NUMBER'), 16)
    const personId = serial ? ctx.ids.person.get(String(serial)) : null
    if (!personId) { countSkip(ctx, stat, REASONS.missingPerson); continue }
    const sectionId = ctx.ids.section.get(String(pick(row, 'SECTION_ID'))) || null
    // A student with an unknown section still arrives, just unplaced: losing the
    // person entirely would be worse than a missing placement.
    if (!sectionId) countReason(ctx, stat, REASONS.missingSection)

    if (existing.has(String(personId))) {
      // The record is already there. The placement link is idempotent, so a
      // student who is newly placed in the dump still gets the section.
      stat.reused += 1
      if (sectionId) {
        await ctx.writer.link('student_section', { person_id: personId, section_id: sectionId })
      }
      continue
    }

    const detail = {
      person_id: personId,
      section_id: sectionId,
      student_birth_date: dateOrNull(pick(row, 'STUDENT_BIRTH_DATE')),
      student_blood_type: text(pick(row, 'STUDENT_BLOOD_TYPE')),
      student_height_cm: decimalOrNull(pick(row, 'STUDENT_HEIGHT_CM'), 140, 240),
      student_weight_kg: decimalOrNull(pick(row, 'STUDENT_WEIGHT_KG'), 40, 160),
      student_is_foreign: keysOf(pick(row, 'STUDENT_IS_FOREIGN')) === 'YES',
      student_academic_average: decimalOrNull(pick(row, 'STUDENT_ACADEMIC_AVERAGE')),
      student_military_necklace:
        keysOf(pick(row, 'STUDENT_MILITARY_NECKLACE')) === 'YES' ? 'Yes' : 'No',
      // The old data can contradict itself. A total that is present is raised
      // to fit the sisters and the birth order, so the import satisfies
      // 12-student-family-counts.sql instead of aborting on it; a blank total
      // stays blank.
      ...fitFamilyCounts({
        siblings: intOrNull(pick(row, 'STUDENT_NUMBER_OF_SIBLINGS')),
        sisters: intOrNull(pick(row, 'STUDENT_NUMBER_OF_SISTERS')),
        order: intOrNull(pick(row, 'STUDENT_ORDER_AMONG_SIBLINGS'))
      }),
      student_orphan_status: text(pick(row, 'STUDENT_ORPHAN_STATUS')) || 'None'
    }
    if (hasSerial) detail.student_serial_number = serial

    for (const [source, column, length] of STUDENT_UNIQUE_FIELDS) {
      const value = truncate(pick(row, source), length)
      if (!value) continue
      if (seen.get(column).has(value)) continue
      seen.get(column).add(value)
      detail[column] = value
    }

    const inserted = await ctx.writer.insert('student_detail', detail)
    if (!inserted) {
      countSkip(ctx, stat, REASONS.duplicateSerial)
      continue
    }
    stat.inserted += 1
    existing.add(String(personId))
    if (sectionId) {
      await ctx.writer.link('student_section', { person_id: personId, section_id: sectionId })
    }
    await ctx.writer.updatePersonProfile(personId, {
      birthdate: detail.student_birth_date,
      sex: sex(pick(row, 'STUDENT_SEX'))
    })
  }
}

async function importStudentMajors(ctx) {
  const stat = stepStat(ctx, 'studentMajors', 'Student majors', 'studies', 'person_studies_major')
  const studies = tableRows(ctx.parsed, 'studies')
  const majorsBySection = new Map()
  for (const row of studies) {
    const sectionOld = String(pick(row, 'SECTION_ID'))
    if (!majorsBySection.has(sectionOld)) majorsBySection.set(sectionOld, [])
    majorsBySection.get(sectionOld).push(String(pick(row, 'MAJOR_ID')))
  }
  const seen = new Set()
  for (const row of tableRows(ctx.parsed, 'student_detail')) {
    const serial = String(pick(row, 'STUDENT_SERIAL_NUMBER'))
    const personId = ctx.ids.person.get(serial)
    if (!personId) continue
    const majors = majorsBySection.get(String(pick(row, 'SECTION_ID'))) || []
    for (const majorOld of majors) {
      const majorId = ctx.ids.major.get(majorOld)
      if (!majorId) continue
      countRead(stat)
      const key = `${personId}|${majorId}`
      if (seen.has(key)) { countSkip(ctx, stat, REASONS.duplicateLink); continue }
      seen.add(key)
      const linked = await ctx.writer.link('person_studies_major', { major_id: majorId, person_id: personId })
      if (linked === null) stat.reused += 1
      else stat.inserted += 1
    }
  }
}

async function importTeacherMajors(ctx) {
  const stat = stepStat(ctx, 'teacherMajors', 'Teacher majors', 'teaches', 'person_teaches_major')
  const seen = new Set()
  for (const row of tableRows(ctx.parsed, 'teaches')) {
    countRead(stat)
    const personId = ctx.ids.person.get(String(pick(row, 'PERSON_ID')))
    const majorId = ctx.ids.major.get(String(pick(row, 'MAJOR_ID')))
    if (!personId) { countSkip(ctx, stat, REASONS.missingPerson); continue }
    if (!majorId) { countSkip(ctx, stat, REASONS.missingMajor); continue }
    const key = `${personId}|${majorId}`
    if (seen.has(key)) { countSkip(ctx, stat, REASONS.duplicateLink); continue }
    seen.add(key)
    const linked = await ctx.writer.link('person_teaches_major', { person_id: personId, major_id: majorId })
    if (linked === null) stat.reused += 1
    else stat.inserted += 1
  }
}

async function ensureFallbackGroup(ctx, majorOld) {
  if (ctx.ids.groupByMajor.has(majorOld)) return ctx.ids.groupByMajor.get(majorOld)
  const majorId = ctx.ids.major.get(majorOld)
  if (!majorId) return null
  if (!ctx.groupCodesLoaded) {
    ctx.groupCodes = await existingByCode(ctx, 'teaching_group', 'teaching_group_id', 'teaching_group_code')
    ctx.groupCodesLoaded = true
  }
  const code = truncate(`LEGACY-GM-${majorOld}`, 20)
  const known = ctx.groupCodes.get(rowKey(code))
  if (known) {
    ctx.ids.groupByMajor.set(majorOld, known)
    return known
  }
  const inserted = await ctx.writer.insert('teaching_group', {
    major_id: majorId,
    teaching_group_code: code,
    teaching_group_label_en: `Legacy sessions · ${majorOld}`,
  })
  const id = insertedId(inserted, 'teaching_group_id')
  if (id) {
    ctx.ids.groupByMajor.set(majorOld, id)
    ctx.groupCodes.set(rowKey(code), id)
  }
  return id
}

async function importSessions(ctx) {
  const stat = stepStat(ctx, 'sessions', 'Study sessions', 'study_session', 'study_session')
  const sectionBySession = new Map()
  for (const row of tableRows(ctx.parsed, 'studies_in')) {
    const sessionOld = String(pick(row, 'STUDY_SESSION_ID'))
    if (!sectionBySession.has(sessionOld)) sectionBySession.set(sessionOld, String(pick(row, 'SECTION_ID')))
  }
  // A session has no code, so a merge recognises it by its timetable tuple.
  const existing = await existingByKey(
    ctx,
    `SELECT study_session_id, study_day_id, major_id, teaching_group_id, instructor_id, classroom_id,
            study_session_start_time::text AS study_session_start_time,
            study_session_end_time::text AS study_session_end_time
       FROM study_session`,
    (row) => rowKey(
      row.STUDY_DAY_ID,
      row.STUDY_SESSION_START_TIME,
      row.STUDY_SESSION_END_TIME,
      row.MAJOR_ID,
      row.TEACHING_GROUP_ID,
      row.INSTRUCTOR_ID,
      row.CLASSROOM_ID
    ),
    (row) => row.STUDY_SESSION_ID
  )
  for (const row of tableRows(ctx.parsed, 'study_session')) {
    countRead(stat)
    const oldId = String(pick(row, 'STUDY_SESSION_ID'))
    const instructorOld = String(pick(row, 'PERSON_ID'))
    const instructorId = ctx.ids.person.get(instructorOld)
    if (!instructorId) { countSkip(ctx, stat, REASONS.missingInstructor); continue }
    const majorOld = String(pick(row, 'MAJOR_ID'))
    const majorId = ctx.ids.major.get(majorOld)
    if (!majorId) { countSkip(ctx, stat, REASONS.missingMajor); continue }
    const dayId = ctx.ids.day.get(String(pick(row, 'STUDY_DAY_ID')))
    if (!dayId) { countSkip(ctx, stat, REASONS.missingDay); continue }
    const classroomId = ctx.ids.classroom.get(String(pick(row, 'CLASS_ID')))
    if (!classroomId) { countSkip(ctx, stat, REASONS.missingClassroom); continue }
    const typeId = ctx.ids.sessionType.get(String(pick(row, 'STUDY_SESSION_TYPE_ID')))
    if (!typeId) { countSkip(ctx, stat, REASONS.missingType); continue }
    const start = timeOrNull(pick(row, 'STUDY_SESSION_START_TIME'))
    const end = timeOrNull(pick(row, 'STUDY_SESSION_END_TIME'))
    if (!start || !end) { countSkip(ctx, stat, REASONS.missingTime); continue }

    const sectionOld = sectionBySession.get(oldId)
    let groupId = sectionOld ? ctx.ids.group.get(groupKey(sectionOld, majorOld)) : null
    if (!groupId) groupId = await ensureFallbackGroup(ctx, majorOld)
    if (!groupId) { countSkip(ctx, stat, REASONS.missingSection); continue }

    const key = rowKey(dayId, start, end, majorId, groupId, instructorId, classroomId)
    const known = existing.get(key)
    if (known) {
      ctx.ids.session.set(oldId, known)
      stat.reused += 1
      continue
    }

    const inserted = await ctx.writer.insert('study_session', {
      classroom_id: classroomId,
      study_session_type_id: typeId,
      study_day_id: dayId,
      study_session_start_time: start,
      study_session_end_time: end,
      major_id: majorId,
      teaching_group_id: groupId,
      instructor_id: instructorId
    })
    const id = insertedId(inserted, 'study_session_id')
    if (id) {
      ctx.ids.session.set(oldId, id)
      existing.set(key, id)
      stat.inserted += 1
    }
  }
}

function hasMotif(motifOld) {
  return motifOld && motifOld !== 'null' && motifOld !== 'undefined'
}

async function ensureJustification(ctx, motifOld, motifRow) {
  if (ctx.ids.justification.has(motifOld)) return ctx.ids.justification.get(motifOld)
  const known = hasMotif(motifOld)
  const labelEn = text(pick(motifRow || {}, 'ABSENCE_MOTIF_EN')) || (known ? `Legacy motif ${motifOld}` : 'Not specified')
  const existing =
    ctx.lookups.justificationLabels.get(keysOf(labelEn))?.ABSENCE_JUSTIFICATION_ID ||
    ctx.lookups.justifications.get(slug(labelEn, `LEGACY-MOTIF-${motifOld}`))?.ABSENCE_JUSTIFICATION_ID
  let id = existing || null
  if (!id) {
    const code = truncate(known ? `LEGACY-MOTIF-${motifOld}` : 'LEGACY-UNSPECIFIED', 20)
    const inserted = await ctx.writer.insert('absence_justification', {
      absence_justification_code: code,
      absence_justification_label_en: truncate(labelEn, 100),
      absence_justification_label_ar: truncate(pick(motifRow || {}, 'ABSENCE_MOTIF_AR'), 100),
      absence_justification_label_fr: truncate(pick(motifRow || {}, 'ABSENCE_MOTIF_FR'), 100),
    })
    id = insertedId(inserted, 'absence_justification_id')
  }
  if (id) ctx.ids.justification.set(motifOld, id)
  return id
}

async function ensureMotif(ctx, motifOld, motifRow) {
  if (ctx.ids.motif.has(motifOld)) return ctx.ids.motif.get(motifOld)
  const known = hasMotif(motifOld)
  const labelEn = text(pick(motifRow || {}, 'OBSERVATION_MOTIF_EN')) || (known ? `Legacy motif ${motifOld}` : 'Not specified')
  const existing =
    ctx.lookups.motifLabels.get(keysOf(labelEn))?.OBSERVATION_MOTIF_ID ||
    ctx.lookups.motifs.get(slug(labelEn, `LEGACY-MOTIF-${motifOld}`))?.OBSERVATION_MOTIF_ID
  let id = existing || null
  if (!id) {
    const code = truncate(known ? `LEGACY-MOTIF-${motifOld}` : 'LEGACY-UNSPECIFIED', 20)
    const inserted = await ctx.writer.insert('observation_motif', {
      observation_motif_code: code,
      observation_motif_label_en: truncate(labelEn, 100),
      observation_motif_label_ar: truncate(pick(motifRow || {}, 'OBSERVATION_MOTIF_AR'), 100),
      observation_motif_label_fr: truncate(pick(motifRow || {}, 'OBSERVATION_MOTIF_FR'), 100),
    })
    id = insertedId(inserted, 'observation_motif_id')
  }
  if (id) ctx.ids.motif.set(motifOld, id)
  return id
}

async function importAbsences(ctx) {
  const stat = stepStat(ctx, 'absences', 'Absences', 'absence', 'student_gets_absent')
  const absenceById = new Map(
    tableRows(ctx.parsed, 'absence').map((row) => [String(pick(row, 'ABSENCE_ID')), row])
  )
  const motifById = new Map(
    tableRows(ctx.parsed, 'absence_motif').map((row) => [String(pick(row, 'ABSENCE_MOTIF_ID')), row])
  )
  const sessionById = new Map(
    tableRows(ctx.parsed, 'study_session').map((row) => [String(pick(row, 'STUDY_SESSION_ID')), row])
  )
  const seen = new Set()

  for (const link of tableRows(ctx.parsed, 'student_gets_absent')) {
    countRead(stat)
    const absenceOld = String(pick(link, 'ABSENCE_ID'))
    const absence = absenceById.get(absenceOld)
    if (!absence) { countSkip(ctx, stat, REASONS.missingSession); continue }
    const sessionOld = String(pick(absence, 'STUDY_SESSION_ID'))
    const sessionId = ctx.ids.session.get(sessionOld)
    if (!sessionId) { countSkip(ctx, stat, REASONS.missingSession); continue }
    const personId = ctx.ids.person.get(String(pick(link, 'PERSON_ID')))
    if (!personId) { countSkip(ctx, stat, REASONS.missingStudent); continue }
    const key = `${personId}|${sessionId}`
    if (seen.has(key)) { countSkip(ctx, stat, REASONS.duplicateAbsence); continue }

    const sessionRow = sessionById.get(sessionOld)
    const instructorId = ctx.ids.person.get(String(pick(sessionRow || {}, 'PERSON_ID')))
    if (!instructorId) { countSkip(ctx, stat, REASONS.missingInstructor); continue }

    const motifOld = String(pick(absence, 'ABSENCE_MOTIF_ID'))
    const justificationId = await ensureJustification(ctx, motifOld, motifById.get(motifOld))
    if (!justificationId) { countSkip(ctx, stat, REASONS.missingJustification); continue }

    seen.add(key)
    const linked = await ctx.writer.link('student_gets_absent', {
      person_id: personId,
      study_session_id: sessionId,
      absence_justification_id: justificationId,
      per_person_id: instructorId,
      teacher_absence_note: truncate(pick(absence, 'ABSENCE_OBSERVATION'), 500)
    })
    if (linked === null) stat.reused += 1
    else stat.inserted += 1
  }
}

async function importObservations(ctx) {
  const stat = stepStat(
    ctx,
    'observations',
    'Observations',
    'teacher_makes_an_observation_for_a_student',
    'student_undergoes_observation_by_teacher'
  )
  const motifById = new Map(
    tableRows(ctx.parsed, 'observation_motif').map((row) => [String(pick(row, 'OBSERVATION_MOTIF_ID')), row])
  )
  const seen = new Set()
  for (const row of tableRows(ctx.parsed, 'teacher_makes_an_observation_for_a_student')) {
    countRead(stat)
    const personId = ctx.ids.person.get(String(pick(row, 'STUDENT_PERSON_ID')))
    const teacherId = ctx.ids.person.get(String(pick(row, 'TEACHER_PERSON_ID')))
    const sessionId = ctx.ids.session.get(String(pick(row, 'STUDY_SESSION_ID')))
    if (!personId) { countSkip(ctx, stat, REASONS.missingStudent); continue }
    if (!teacherId) { countSkip(ctx, stat, REASONS.missingInstructor); continue }
    if (!sessionId) { countSkip(ctx, stat, REASONS.missingNote); continue }
    const key = `${personId}|${sessionId}|${teacherId}|${text(pick(row, 'OBSERVATION_DATE_AND_TIME')) || ''}`
    if (seen.has(key)) { countSkip(ctx, stat, REASONS.duplicateAbsence); continue }
    const motifOld = String(pick(row, 'OBSERVATION_MOTIF_ID'))
    const motifId = await ensureMotif(ctx, motifOld, motifById.get(motifOld))
    seen.add(key)
    const observation = {
      person_id: personId,
      study_session_id: sessionId,
      observation_motif_id: motifId,
      per_person_id: teacherId,
      teacher_observation_note: truncate(pick(row, 'OBSERVATION_NOTE'), 500)
    }
    // The column is NOT NULL with a default; omitting an unreadable date lets
    // the registry fill it instead of rejecting the row.
    const observedAt = datetimeOrNull(pick(row, 'OBSERVATION_DATE_AND_TIME'))
    if (observedAt) observation.observation_datetime = observedAt
    const linked = await ctx.writer.link('student_undergoes_observation_by_teacher', observation)
    if (linked === null) stat.reused += 1
    else stat.inserted += 1
  }
}

function copyLookups(lookups) {
  const copy = {}
  for (const [key, value] of Object.entries(lookups)) {
    copy[key] = value instanceof Map ? new Map(value) : value
  }
  return copy
}

function snapshotContext(ctx) {
  // ctx.ids is a plain object of Maps, not a Map of Maps: keep that shape or
  // every step that runs after a rollback would find ctx.ids.person undefined.
  const ids = {}
  for (const [key, value] of Object.entries(ctx.ids)) ids[key] = new Map(value)
  return {
    ids,
    lookups: copyLookups(ctx.lookups),
    groupCodes: new Map(ctx.groupCodes),
    groupCodesLoaded: ctx.groupCodesLoaded,
    disabledHash: ctx.disabledHash,
    stats: new Map(ctx.stats),
    notes: new Map(ctx.notes),
    stepOrder: ctx.stepOrder.slice()
  }
}

function restoreContext(ctx, snapshot) {
  ctx.ids = snapshot.ids
  ctx.lookups = snapshot.lookups
  ctx.groupCodes = snapshot.groupCodes
  ctx.groupCodesLoaded = snapshot.groupCodesLoaded
  ctx.disabledHash = snapshot.disabledHash
  ctx.stats = snapshot.stats
  ctx.notes = snapshot.notes
  ctx.stepOrder = snapshot.stepOrder
}

async function runMapping(parsed, lookups, writer, stepIds, options = {}) {
  const ctx = makeContext(parsed, lookups, writer)
  const selected = new Set(stepIds == null ? ALL_STEP_IDS : stepIds)
  const completed = new Set()
  const failures = []

  for (const step of STEPS) {
    if (!selected.has(step.id)) continue
    // A step reads the id maps the earlier steps built in memory. If one of
    // them did not complete (blocked or failed), this step cannot be trusted.
    const failedDependency = step.dependsOn.find((id) => !completed.has(id))
    if (failedDependency) {
      failures.push({
        id: step.id,
        label: step.label,
        code: 'dependencyFailed',
        step: failedDependency,
        dependencyLabel: STEP_BY_ID.get(failedDependency)?.label || failedDependency
      })
      continue
    }

    const snapshot = options.isolateFailures ? snapshotContext(ctx) : null
    try {
      await writer.beginStep?.(step.id)
      await step.run(ctx)
      await writer.endStep?.(step.id)
      completed.add(step.id)
    } catch (error) {
      await writer.rollbackStep?.(step.id)
      // Preview has no savepoint to fall back on: a programming error must stop
      // the preview instead of hiding behind a half-built plan.
      if (!snapshot) throw error
      restoreContext(ctx, snapshot)
      failures.push({
        id: step.id,
        label: step.label,
        code: 'runtimeError',
        message: error.message
      })
    }
  }

  const steps = ctx.stepOrder.map((id) => {
    const stat = ctx.stats.get(id)
    return {
      id: stat.id,
      label: stat.label,
      source: stat.source,
      target: stat.target,
      read: stat.read,
      inserted: stat.inserted,
      reused: stat.reused,
      skipped: stat.skipped,
      reasons: [...stat.reasons.entries()].map(([reason, count]) => ({ reason, count }))
    }
  })
  return {
    steps,
    failures,
    notes: [...ctx.notes.keys()],
    totals: steps.reduce(
      (acc, step) => ({
        read: acc.read + step.read,
        inserted: acc.inserted + step.inserted,
        reused: acc.reused + step.reused,
        skipped: acc.skipped + step.skipped
      }),
      { read: 0, inserted: 0, reused: 0, skipped: 0 }
    )
  }
}

function hasDumpTable(parsed, table) {
  return parsed.tables.has(String(table).toLowerCase())
}

// `null`/`undefined` means the whole plan. An explicit empty list means none.
function expandStepSelection(selectedSteps) {
  const wanted = selectedSteps == null ? ALL_STEP_IDS : selectedSteps
  const chosen = new Set()
  const visit = (id) => {
    if (chosen.has(id)) return
    const step = STEP_BY_ID.get(id)
    if (!step) return
    chosen.add(id)
    for (const dependency of step.dependsOn) visit(dependency)
  }
  for (const id of wanted) visit(String(id))
  return ALL_STEP_IDS.filter((id) => chosen.has(id))
}

function evaluatePlan(parsed, selectedSteps) {
  const blockersById = new Map()

  for (const step of STEPS) {
    const blockers = step.sources
      .filter((source) => !hasDumpTable(parsed, source))
      .map((source) => ({ code: 'missingSource', table: source }))
    blockersById.set(step.id, blockers)
  }

  // A dependency that cannot run takes its dependents with it. Repeat until
  // stable because those dependents may themselves have dependents.
  let changed = true
  while (changed) {
    changed = false
    for (const step of STEPS) {
      const blockers = blockersById.get(step.id)
      if (blockers.length > 0) continue
      const dependency = step.dependsOn.find((id) => blockersById.get(id)?.length > 0)
      if (dependency) {
        blockers.push({
          code: 'dependencyBlocked',
          step: dependency,
          label: STEP_BY_ID.get(dependency)?.label || dependency
        })
        changed = true
      }
    }
  }

  const expanded = expandStepSelection(selectedSteps)
  const runnable = expanded.filter((id) => blockersById.get(id).length === 0)
  const blocked = expanded.filter((id) => blockersById.get(id).length > 0)
  return { blockersById, expanded, runnable, blocked }
}

function blockerMessage(blocker) {
  if (blocker.code === 'missingSource') {
    return `The dump has no \`${blocker.table}\` table.`
  }
  if (blocker.code === 'dependencyBlocked') {
    return `Blocked because \`${blocker.label || blocker.step}\` cannot be imported.`
  }
  if (blocker.code === 'dependencyFailed') {
    return `Blocked because \`${blocker.dependencyLabel || blocker.step}\` failed.`
  }
  if (blocker.code === 'runtimeError') return blocker.message
  return 'This table cannot be imported.'
}

function aggregateBlockerMessages(evaluation) {
  const messages = []
  const seen = new Set()
  for (const id of evaluation.blocked) {
    for (const blocker of evaluation.blockersById.get(id) || []) {
      const message = blockerMessage(blocker)
      if (seen.has(message)) continue
      seen.add(message)
      messages.push(message)
    }
  }
  return messages
}

function decorateSteps(planSteps, evaluation, existingByStep) {
  return planSteps.map((step) => {
    const definition = STEP_BY_ID.get(step.id)
    const blockers = evaluation.blockersById.get(step.id) || []
    return {
      ...step,
      sources: definition?.sources || [],
      targets: definition?.targets || [],
      dependsOn: definition?.dependsOn || [],
      // Rows sitting in the target tables today; replace mode will delete them.
      existingRows: existingByStep.get(step.id) || 0,
      blocked: blockers.length > 0,
      blockers
    }
  })
}

function existingRowsByStep(counts) {
  const countByTable = new Map(counts.map((row) => [row.table, row.count]))
  const byStep = new Map()
  for (const step of STEPS) {
    byStep.set(
      step.id,
      step.targets.reduce((sum, table) => sum + (countByTable.get(table) || 0), 0)
    )
  }
  return byStep
}

function blockedStep(id, evaluation) {
  return {
    id,
    label: STEP_BY_ID.get(id)?.label || id,
    blockers: evaluation.blockersById.get(id) || []
  }
}

// Child tables first, so a replace deletes its own rows without tripping over
// a foreign key. Reference tables (roles, session types, categories, absence
// justifications, observation motifs) are shared by code and never cleared.
const CLEAR_ORDER = [
  'student_undergoes_observation_by_teacher',
  'student_gets_absent',
  'person_studies_major',
  'person_teaches_major',
  'student_section',
  'student_detail',
  'person_has_role',
  'user',
  'study_session',
  'teaching_group',
  'section',
  'major',
  'classroom',
  'study_day',
  'study_week',
  'study_semester',
  'study_year',
  'person'
]

// Deletes the rows of the selected target tables inside the import transaction,
// so a failure (for example a foreign key from a table that is not selected)
// leaves the registry exactly as it was.
async function clearTargets(tx, stepIds) {
  const targets = new Set()
  for (const id of stepIds) {
    for (const table of STEP_BY_ID.get(id)?.targets || []) targets.add(table)
  }
  const cleared = []
  for (const table of CLEAR_ORDER) {
    if (!targets.has(table)) continue
    try {
      // `user` is a reserved word, so every name is quoted rather than special-casing it.
      const result = await tx(`DELETE FROM ${quoteIdent(table)}`)
      cleared.push({ table, count: Number(result?.rowCount || 0) })
    } catch (error) {
      if (error?.code === '23503') {
        // PostgreSQL names the table that still holds a reference, which tells
        // the reviewer what has to be selected too (when it is importable).
        const referrer = error.table ? `: table \`${error.table}\` still references it.` : '.'
        throw new Error(
          `Replace could not clear \`${table}\`${referrer} ` +
          'Include the tables that depend on it, or use merge mode, which never deletes.'
        )
      }
      throw error
    }
  }
  return cleared
}

/**
 * Builds the migration plan without writing anything. Every step is rated on
 * its own, so a preview shows which tables can be imported and why the others
 * are blocked. In merge mode the counts already exclude the rows that exist.
 * @param {string} userId
 * @param {string} filePath
 * @param {{ selectedSteps?: string[], mode?: 'merge' | 'replace' }} [options]
 */
export async function previewLegacyImport(userId, filePath, options = {}) {
  const mode = normalizeMode(options.mode)
  await assertCanImport(userId)
  const dump = await readDump(filePath)
  const lookups = await loadLookups()
  const counts = await targetCounts((sql) => query(sql).then((r) => r?.data || []))
  const plan = await runMapping(
    dump.parsed,
    lookups,
    previewWriter({ keepExisting: mode === 'merge' })
  )
  const evaluation = evaluatePlan(dump.parsed, options.selectedSteps)
  const steps = decorateSteps(plan.steps, evaluation, existingRowsByStep(counts))
  const insertedById = new Map(steps.map((step) => [step.id, step.inserted]))

  return {
    mode,
    file: { name: dump.name, path: dump.path, bytes: dump.bytes },
    tablesFound: dump.parsed.tables.size,
    rowsFound: [...dump.parsed.tables.values()].reduce((sum, t) => sum + t.rows.length, 0),
    parseWarnings: dump.parsed.warnings,
    target: { tables: counts, hasRows: counts.some((row) => row.count > 0) },
    blockers: aggregateBlockerMessages(evaluation),
    steps,
    notes: plan.notes,
    totals: plan.totals,
    importableSteps: evaluation.runnable,
    blockedSteps: evaluation.blocked.map((id) => blockedStep(id, evaluation)),
    selectedSteps: evaluation.expanded,
    canImport: mode === 'replace'
      ? evaluation.runnable.length > 0
      : evaluation.runnable.some((id) => (insertedById.get(id) || 0) > 0)
  }
}

/**
 * Imports the selected tables in one transaction. Blocked tables are left out
 * with their reasons instead of failing the whole run. Merge gives each table
 * its own savepoint so a run-time failure rolls back only that table; replace
 * is all-or-nothing because it clears the target tables first.
 * @param {string} userId
 * @param {string} filePath
 * @param {{ selectedSteps?: string[], mode?: 'merge' | 'replace' }} [options]
 */
export async function runLegacyImport(userId, filePath, options = {}) {
  const mode = normalizeMode(options.mode)
  await assertCanImport(userId)
  const dump = await readDump(filePath)
  const lookups = await loadLookups()
  const requested = options.selectedSteps == null ? null : options.selectedSteps

  const report = await withTransaction(async (tx) => {
    const evaluation = evaluatePlan(dump.parsed, requested)
    if (evaluation.expanded.length === 0) {
      throw new Error('Select at least one table to import.')
    }
    if (evaluation.runnable.length === 0) {
      const reasons = evaluation.blocked
        .map((id) => {
          const label = STEP_BY_ID.get(id)?.label || id
          const details = (evaluation.blockersById.get(id) || []).map(blockerMessage).join(' ')
          return `${label}: ${details}`
        })
        .join(' ')
      throw new Error(`No selected table can be imported. ${reasons}`)
    }
    const cleared = mode === 'replace'
      ? await clearTargets(tx, evaluation.runnable)
      : []
    // Merge keeps failures local to one table. Replace cleared its target
    // tables before the steps ran, so a failure must undo the whole run rather
    // than leave a half-empty registry behind.
    const mapping = await runMapping(
      dump.parsed,
      lookups,
      liveWriter(tx),
      evaluation.runnable,
      { isolateFailures: mode === 'merge' }
    )
    if (mapping.steps.length === 0) {
      const reasons = mapping.failures
        .map((failure) => `${failure.label}: ${blockerMessage(failure)}`)
        .join(' ')
      throw new Error(`Nothing was imported. ${reasons}`)
    }
    return { evaluation, mapping, cleared }
  })

  return {
    mode,
    file: { name: dump.name, path: dump.path, bytes: dump.bytes },
    steps: report.mapping.steps,
    notes: report.mapping.notes,
    totals: report.mapping.totals,
    cleared: report.cleared,
    skippedSteps: report.evaluation.blocked.map((id) => blockedStep(id, report.evaluation)),
    failedSteps: report.mapping.failures,
    selection: {
      requested: requested ?? ALL_STEP_IDS,
      expanded: report.evaluation.expanded,
      imported: report.mapping.steps.map((step) => step.id),
      skipped: report.evaluation.blocked
    }
  }
}
