import { query } from '../db'
import { isPrivilegeError, tryDdl } from '../sqlGuards'
import { personNameColumns } from '../sqlPersonName'
import { recordAudit } from './auditService'

// Weekly teacher constraints.
//
// A teacher declares, for one study week, the time windows they cannot teach
// (HARD: "impossible") or would rather not teach (SOFT: "not recommended").
// The scheduler then decides how much of that list the timetable should obey:
//
//   hard -> only HARD rows are enforced
//   some -> HARD rows plus the SOFT rows the scheduler ticked
//   all  -> every HARD and SOFT row is enforced
//
// An administrator can switch the whole feature off, or force one of those
// three policies for every scheduler (app_option: teacher_constraints_*).
//
// The window itself is never typed: the administration keeps a predefined list
// of hard and soft windows (teacher_constraint_option, edited in Settings ->
// Registers -> "Teacher constraint options") and a teacher only selects one of
// them for a day. The declaration copies the kind, times and note onto its own
// row, so editing the list later never rewrites what a teacher already said.
//
// The rows live in teacher_constraint, created on first use so an existing
// installation needs no manual migration. Enforcement happens here, on the
// server, on every session write; the renderer's warnings are only a courtesy.
// A missing table is an error on the write path (hard constraints must never
// be silently ignored) and an empty list on the read path.

const POLICY_IDS = ['hard', 'some', 'all']
const DEFAULT_POLICY = 'hard'
const OPTION_ENABLED = 'teacher_constraints_enabled'
const OPTION_FORCED = 'teacher_constraints_forced'
const OPTION_POLICY = 'teacher_constraints_policy'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/

function normalizeKind(value) {
  const kind = String(value || '').trim().toUpperCase()
  return kind === 'SOFT' ? 'SOFT' : kind === 'HARD' ? 'HARD' : null
}

function normalizePolicy(value) {
  const policy = String(value || '').trim().toLowerCase()
  return POLICY_IDS.includes(policy) ? policy : DEFAULT_POLICY
}

function normalizeStartTime(value) {
  const text = String(value || '').slice(0, 5)
  return TIME_RE.test(text) ? text : null
}

// 00:00 closes the timetable day: it is midnight (24:00) when used as an end.
function normalizeEndTime(value) {
  const text = normalizeStartTime(value)
  if (text === '00:00') return '24:00'
  return text
}

function noteText(value) {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, 500)
}

let tableReady = null
let tableRetryAt = 0

async function ensureTeacherConstraintTable() {
  if (tableReady) return tableReady
  if (Date.now() < tableRetryAt) return null

  tableReady = (async () => {
    // The predefined list a teacher selects from. Deleting an entry never
    // deletes a declaration: the declared row keeps its own copy of the window.
    await query(`
      CREATE TABLE IF NOT EXISTS teacher_constraint_option (
        teacher_constraint_option_id bigserial PRIMARY KEY,
        constraint_option_code character varying(40),
        constraint_kind character varying(8) NOT NULL DEFAULT 'HARD',
        constraint_start_time time without time zone NOT NULL,
        constraint_end_time time without time zone NOT NULL,
        constraint_option_label_en character varying(160),
        constraint_option_label_ar character varying(160),
        constraint_option_label_fr character varying(160),
        constraint_option_note character varying(500),
        sort_order integer NOT NULL DEFAULT 0,
        created_by_user_id integer,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await tryDdl(`
      CREATE INDEX IF NOT EXISTS teacher_constraint_option_order_idx
      ON teacher_constraint_option (constraint_kind, sort_order, constraint_start_time)
    `)
    await query(`
      CREATE TABLE IF NOT EXISTS teacher_constraint (
        teacher_constraint_id bigserial PRIMARY KEY,
        instructor_id integer NOT NULL,
        study_week_id integer NOT NULL,
        study_day_id integer NOT NULL,
        constraint_kind character varying(8) NOT NULL DEFAULT 'HARD',
        constraint_start_time time without time zone NOT NULL,
        constraint_end_time time without time zone NOT NULL,
        constraint_note character varying(500),
        created_by_user_id integer,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await tryDdl(`
      CREATE INDEX IF NOT EXISTS teacher_constraint_week_instructor_idx
      ON teacher_constraint (study_week_id, instructor_id)
    `)
    // Installations that already hold declarations get the link column on their
    // next read or write; 25-add-teacher-constraint-options.sql adds the FK.
    // The table may belong to the database owner (the migration run as postgres),
    // so a refusal is checked against the column itself rather than assumed.
    try {
      await query(
        'ALTER TABLE teacher_constraint ADD COLUMN IF NOT EXISTS teacher_constraint_option_id integer'
      )
    } catch (error) {
      if (!isPrivilegeError(error)) throw error
      const column = await query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'teacher_constraint'
            AND column_name = 'teacher_constraint_option_id'`
      )
      if (!column.data?.length) {
        throw new Error(
          'The predefined constraints need one new column. Ask the database owner to run deploy/server/25-add-teacher-constraint-options.sql.'
        )
      }
    }
    return true
  })().catch((error) => {
    console.warn('Teacher constraints are not available:', error.message)
    tableReady = null
    tableRetryAt = Date.now() + 10 * 60 * 1000
    return null
  })

  return tableReady
}

async function requireTeacherConstraintTable() {
  const ready = await ensureTeacherConstraintTable()
  if (!ready) {
    throw new Error(
      'Weekly teacher constraints are not available on this database. Ask the administrator to check the database permissions.'
    )
  }
}

export async function getTeacherConstraintSettings() {
  const res = await query(
    `SELECT option_key, option_value
       FROM app_option
      WHERE option_key = ANY($1::text[])`,
    [[OPTION_ENABLED, OPTION_FORCED, OPTION_POLICY]]
  )
  const values = {}
  for (const row of res?.data || []) values[row.OPTION_KEY] = row.OPTION_VALUE

  return {
    enabled: String(values[OPTION_ENABLED] ?? '1') !== '0',
    forced: String(values[OPTION_FORCED] ?? '0') === '1',
    policy: normalizePolicy(values[OPTION_POLICY])
  }
}

// ---- The predefined list ----------------------------------------------------

// The register posts lower-case column names (the dialog's payload is lowered
// before the call); a direct caller may send either case. Both are read alike.
function lowerCaseFields(data) {
  const fields = {}
  for (const [key, value] of Object.entries(data && typeof data === 'object' ? data : {})) {
    fields[String(key).toLowerCase()] = value
  }
  return fields
}

function optionLabelText(value, max = 160) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}

function normalizeOptionPayload(data = {}) {
  const fields = lowerCaseFields(data)
  const kind = normalizeKind(fields.constraint_kind)
  if (!kind) throw new Error('Choose whether the constraint is hard or soft.')

  const start = normalizeStartTime(fields.constraint_start_time)
  const end = normalizeEndTime(fields.constraint_end_time)
  if (!start || !end) throw new Error('Enter a valid start time and end time.')
  if (start >= end) throw new Error('The end time must be after the start time.')

  // The English label is the one every teacher sees when their interface is not
  // Arabic or French, so it is the label that cannot be empty.
  const labelEn = optionLabelText(fields.constraint_option_label_en)
  if (!labelEn) throw new Error('The English label is required.')

  const sortOrder = Number(fields.sort_order)
  return {
    code: optionLabelText(fields.constraint_option_code, 40),
    kind,
    start,
    end,
    labelEn,
    labelAr: optionLabelText(fields.constraint_option_label_ar),
    labelFr: optionLabelText(fields.constraint_option_label_fr),
    note: noteText(fields.constraint_option_note),
    sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0
  }
}

async function requireAdminRole(userId) {
  const user = await loadUser(userId)
  if (!user.roles.includes('ADMIN')) {
    throw new Error('Not allowed: only an administrator may edit the predefined constraints.')
  }
  return user
}

// Every predefined window, hard ones first then soft, in the order the
// administration arranged them. Read by the teacher's page and by the register.
export async function getTeacherConstraintOptions() {
  const ready = await ensureTeacherConstraintTable()
  if (!ready) return { data: [], available: false }

  return {
    ...(await query(
      `SELECT *
         FROM teacher_constraint_option
        ORDER BY constraint_kind, sort_order, constraint_start_time,
                 teacher_constraint_option_id`
    )),
    available: true
  }
}

// One window may be listed once per kind: the same hours as hard twice, or as
// soft twice, would only make the teacher choose between two identical rows.
// The same hours as one hard and one soft entry are allowed — they mean
// different things to the scheduler.
async function assertOptionWindowFree(kind, start, end, exceptId = null) {
  const params = [kind, start, end]
  let except = ''
  if (exceptId) {
    params.push(exceptId)
    except = ` AND teacher_constraint_option_id <> $${params.length}`
  }
  const res = await query(
    `SELECT 1
       FROM teacher_constraint_option
      WHERE constraint_kind = $1
        AND constraint_start_time = $2::time
        AND constraint_end_time = $3::time${except}
      LIMIT 1`,
    params
  )
  if (res.data?.length) {
    throw new Error('That window is already in the predefined list for this kind.')
  }
}

export async function createTeacherConstraintOption(userId, data = {}) {
  const user = await requireAdminRole(userId)
  const option = normalizeOptionPayload(data)
  await requireTeacherConstraintTable()
  await assertOptionWindowFree(option.kind, option.start, option.end)

  const insert = await query(
    `INSERT INTO teacher_constraint_option (
       constraint_option_code, constraint_kind, constraint_start_time, constraint_end_time,
       constraint_option_label_en, constraint_option_label_ar, constraint_option_label_fr,
       constraint_option_note, sort_order, created_by_user_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING teacher_constraint_option_id`,
    [
      option.code, option.kind, option.start, option.end,
      option.labelEn, option.labelAr, option.labelFr,
      option.note, option.sortOrder, user.userId
    ]
  )
  const id = insert.data?.[0]?.TEACHER_CONSTRAINT_OPTION_ID

  await recordAudit({
    actorUserId: user.userId,
    action: 'teacher_constraint.option_change',
    entityType: 'teacher_constraint_option',
    entityId: id,
    entityLabel: `${option.kind} ${option.start}-${option.end}`,
    changes: {
      constraint_kind: { before: null, after: option.kind },
      constraint_start_time: { before: null, after: option.start },
      constraint_end_time: { before: null, after: option.end },
      constraint_option_label_en: { before: null, after: option.labelEn }
    }
  })

  return { success: true, teacherConstraintOptionId: id }
}

export async function updateTeacherConstraintOption(userId, id, data = {}) {
  const user = await requireAdminRole(userId)
  const optionId = parseInt(id, 10)
  if (!optionId) throw new Error('That predefined constraint no longer exists.')
  const option = normalizeOptionPayload(data)
  await requireTeacherConstraintTable()
  await assertOptionWindowFree(option.kind, option.start, option.end, optionId)

  const updated = await query(
    `UPDATE teacher_constraint_option
        SET constraint_option_code = $1,
            constraint_kind = $2,
            constraint_start_time = $3,
            constraint_end_time = $4,
            constraint_option_label_en = $5,
            constraint_option_label_ar = $6,
            constraint_option_label_fr = $7,
            constraint_option_note = $8,
            sort_order = $9
      WHERE teacher_constraint_option_id = $10
      RETURNING teacher_constraint_option_id`,
    [
      option.code, option.kind, option.start, option.end,
      option.labelEn, option.labelAr, option.labelFr,
      option.note, option.sortOrder, optionId
    ]
  )
  if (!updated.data?.length) throw new Error('That predefined constraint no longer exists.')

  await recordAudit({
    actorUserId: user.userId,
    action: 'teacher_constraint.option_change',
    entityType: 'teacher_constraint_option',
    entityId: optionId,
    entityLabel: `${option.kind} ${option.start}-${option.end}`,
    changes: {
      constraint_kind: { before: null, after: option.kind },
      constraint_start_time: { before: null, after: option.start },
      constraint_end_time: { before: null, after: option.end },
      constraint_option_label_en: { before: null, after: option.labelEn }
    }
  })

  return { success: true }
}

export async function deleteTeacherConstraintOption(userId, id) {
  const user = await requireAdminRole(userId)
  const optionId = parseInt(id, 10)
  if (!optionId) throw new Error('That predefined constraint no longer exists.')
  await requireTeacherConstraintTable()

  const found = await query(
    `SELECT constraint_kind, constraint_start_time, constraint_end_time
       FROM teacher_constraint_option
      WHERE teacher_constraint_option_id = $1`,
    [optionId]
  )
  const row = found.data?.[0]
  if (!row) throw new Error('That predefined constraint no longer exists.')

  // Declarations already made stay untouched: the link is cleared first and the
  // row keeps the copy of the window it saved, so the timetable does not change
  // and a report still names what the teacher said.
  await query(
    'UPDATE teacher_constraint SET teacher_constraint_option_id = NULL WHERE teacher_constraint_option_id = $1',
    [optionId]
  )
  await query('DELETE FROM teacher_constraint_option WHERE teacher_constraint_option_id = $1', [optionId])

  await recordAudit({
    actorUserId: user.userId,
    action: 'teacher_constraint.option_change',
    entityType: 'teacher_constraint_option',
    entityId: optionId,
    entityLabel: `${row.CONSTRAINT_KIND} ${String(row.CONSTRAINT_START_TIME || '').slice(0, 5)}-${String(row.CONSTRAINT_END_TIME || '').slice(0, 5)}`,
    changes: { deleted: { before: true, after: null } }
  })

  return { success: true }
}

// The policy actually in force for one scheduling action. Disabled means no
// constraint is read at all; forced means the scheduler's choice is ignored.
export function resolveConstraintPolicy(settings, choice = {}) {
  if (!settings?.enabled) {
    return { enabled: false, policy: 'none', softConstraintIds: [] }
  }
  const policy = normalizePolicy(settings.forced ? settings.policy : choice?.policy)
  const rawIds = Array.isArray(choice?.softConstraintIds) ? choice.softConstraintIds : []
  const softConstraintIds = policy === 'some'
    ? [...new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))]
    : []
  return { enabled: true, policy, softConstraintIds }
}

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

// Every constraint of a week, optionally narrowed to one instructor. Used by
// the teacher page (own rows) and by the scheduler's timetable (whole week).
export async function getTeacherConstraints(weekId, instructorId) {
  const week = parseInt(weekId, 10)
  if (!week) return { data: [], available: true }

  const ready = await ensureTeacherConstraintTable()
  if (!ready) return { data: [], available: false }

  const params = [week]
  let instructorFilter = ''
  const instructor = parseInt(instructorId, 10)
  if (instructor) {
    params.push(instructor)
    instructorFilter = ` AND tc.instructor_id = $${params.length}`
  }

  const res = await query(
    `SELECT tc.*,
            d.STUDY_DAY_DATE,
            w.study_week_label_en, w.study_week_label_ar, w.study_week_label_fr,
            o.constraint_option_label_en, o.constraint_option_label_ar, o.constraint_option_label_fr,
            ${personNameColumns('p', 'INSTRUCTOR_NAME')}
       FROM teacher_constraint tc
       JOIN study_day d ON d.STUDY_DAY_ID = tc.study_day_id
       LEFT JOIN study_week w ON w.STUDY_WEEK_ID = tc.study_week_id
       LEFT JOIN teacher_constraint_option o
              ON o.teacher_constraint_option_id = tc.teacher_constraint_option_id
       LEFT JOIN person p ON p.PERSON_ID = tc.instructor_id
      WHERE tc.study_week_id = $1${instructorFilter}
      ORDER BY d.STUDY_DAY_DATE, tc.constraint_start_time, tc.teacher_constraint_id`,
    params
  )
  return { ...res, available: true }
}

// The constraints that overlap a session about to be scheduled, filtered by
// the policy in force. Throws when the table cannot exist, so a hard constraint
// is never skipped because the table could not be read.
export async function findTeacherConstraintConflicts(sessionData, choice = {}) {
  const settings = await getTeacherConstraintSettings()
  const resolved = resolveConstraintPolicy(settings, choice)
  if (!resolved.enabled) {
    return { ...resolved, conflicts: [], all: [] }
  }

  const instructorId = parseInt(sessionData?.INSTRUCTOR_ID, 10)
  const dayId = parseInt(sessionData?.STUDY_DAY_ID, 10)
  const start = normalizeStartTime(sessionData?.STUDY_SESSION_START_TIME)
  const end = normalizeEndTime(sessionData?.STUDY_SESSION_END_TIME)
  if (!instructorId || !dayId || !start || !end || start >= end) {
    return { ...resolved, conflicts: [], all: [] }
  }

  const dayRes = await query(
    'SELECT STUDY_DAY_DATE FROM study_day WHERE STUDY_DAY_ID = $1',
    [dayId]
  )
  const date = dayRes.data?.[0]?.STUDY_DAY_DATE
  if (!date) return { ...resolved, conflicts: [], all: [] }

  await requireTeacherConstraintTable()

  const res = await query(
    `SELECT tc.teacher_constraint_id, tc.instructor_id, tc.study_day_id,
            tc.constraint_kind, tc.constraint_start_time, tc.constraint_end_time,
            tc.constraint_note,
            d.STUDY_DAY_DATE,
            ${personNameColumns('p', 'INSTRUCTOR_NAME')}
       FROM teacher_constraint tc
       JOIN study_day d ON d.STUDY_DAY_ID = tc.study_day_id
       LEFT JOIN person p ON p.PERSON_ID = tc.instructor_id
      WHERE tc.instructor_id = $1
        AND d.STUDY_DAY_DATE = $2
        AND (CASE WHEN tc.constraint_start_time = '00:00'::time THEN '24:00'::time ELSE tc.constraint_start_time END) < $4::time
        AND (CASE WHEN tc.constraint_end_time = '00:00'::time THEN '24:00'::time ELSE tc.constraint_end_time END) > $3::time
      ORDER BY tc.constraint_start_time, tc.teacher_constraint_id`,
    [instructorId, date, start, end]
  )
  const all = res.data || []
  const conflicts = all.filter((row) => {
    if (row.CONSTRAINT_KIND === 'HARD') return true
    if (resolved.policy === 'all') return true
    return resolved.policy === 'some'
      && resolved.softConstraintIds.includes(Number(row.TEACHER_CONSTRAINT_ID))
  })

  return { ...resolved, conflicts, all }
}

// Server-side gate called before a session is inserted. A considered
// constraint refuses the slot with the teacher's own note, so the scheduler
// sees what they would be overriding instead of a bare "not allowed".
export async function assertTeacherConstraints(sessionData, choice = {}) {
  const result = await findTeacherConstraintConflicts(sessionData, choice)
  if (!result.enabled || result.conflicts.length === 0) return

  const conflict = result.conflicts[0]
  const kind = conflict.CONSTRAINT_KIND === 'HARD' ? 'hard' : 'soft'
  const start = String(conflict.CONSTRAINT_START_TIME || '').slice(0, 5)
  const end = String(conflict.CONSTRAINT_END_TIME || '').slice(0, 5)
  const note = conflict.CONSTRAINT_NOTE ? ` — ${conflict.CONSTRAINT_NOTE}` : ''
  const teacher = conflict.INSTRUCTOR_NAME || 'This instructor'
  throw new Error(
    `${teacher} set a ${kind} constraint for ${start}–${end}${note}. ` +
    (kind === 'hard'
      ? 'Hard constraints are binding: choose another teacher or another time.'
      : 'The current policy asks schedulers to respect this soft constraint: choose another teacher or time, or change the policy first.')
  )
}

export async function createTeacherConstraint(userId, data = {}) {
  const user = await loadUser(userId)
  const isAdmin = user.roles.includes('ADMIN')
  const isTeacher = user.roles.includes('TEACHER')
  if (!isAdmin && !isTeacher) {
    throw new Error('Only a teacher may declare weekly constraints.')
  }

  const requestedInstructor = parseInt(data.INSTRUCTOR_ID ?? data.instructorId, 10)
  const instructorId = isAdmin && requestedInstructor ? requestedInstructor : parseInt(user.personId, 10)
  if (!instructorId) throw new Error('That account is not linked to a person.')

  const weekId = parseInt(data.STUDY_WEEK_ID ?? data.weekId, 10)
  const dayId = parseInt(data.STUDY_DAY_ID ?? data.dayId, 10)
  if (!weekId || !dayId) throw new Error('Choose a day of the selected week.')

  // The window is chosen from the predefined list, never typed: the
  // administration decides which hours exist as hard or soft constraints.
  const optionId = parseInt(
    data.TEACHER_CONSTRAINT_OPTION_ID ?? data.teacherConstraintOptionId ?? data.optionId,
    10
  )
  if (!optionId) throw new Error('Choose a predefined constraint.')

  const dayRes = await query(
    `SELECT d.STUDY_DAY_ID, d.STUDY_DAY_DATE
       FROM study_day d
      WHERE d.STUDY_DAY_ID = $1 AND d.STUDY_WEEK_ID = $2`,
    [dayId, weekId]
  )
  const day = dayRes.data?.[0]
  if (!day) throw new Error('That day does not belong to the selected week.')

  await requireTeacherConstraintTable()

  const optionRes = await query(
    `SELECT constraint_kind, constraint_start_time, constraint_end_time, constraint_option_note
       FROM teacher_constraint_option
      WHERE teacher_constraint_option_id = $1`,
    [optionId]
  )
  const option = optionRes.data?.[0]
  if (!option) throw new Error('That predefined constraint no longer exists.')

  const kind = normalizeKind(option.CONSTRAINT_KIND)
  const start = normalizeStartTime(option.CONSTRAINT_START_TIME)
  const end = normalizeEndTime(option.CONSTRAINT_END_TIME)
  if (!kind || !start || !end || start >= end) {
    throw new Error('That predefined constraint has invalid hours. Ask the administrator to correct it.')
  }
  const note = noteText(option.CONSTRAINT_OPTION_NOTE)

  const overlapRes = await query(
    `SELECT 1
       FROM teacher_constraint tc
       JOIN study_day d ON d.STUDY_DAY_ID = tc.study_day_id
      WHERE tc.instructor_id = $1
        AND d.STUDY_DAY_DATE = $2
        AND (CASE WHEN tc.constraint_start_time = '00:00'::time THEN '24:00'::time ELSE tc.constraint_start_time END) < $4::time
        AND (CASE WHEN tc.constraint_end_time = '00:00'::time THEN '24:00'::time ELSE tc.constraint_end_time END) > $3::time
      LIMIT 1`,
    [instructorId, day.STUDY_DAY_DATE, start, end]
  )
  if (overlapRes.data?.length) {
    throw new Error('This constraint overlaps another time window you already declared for that day.')
  }

  const insert = await query(
    `INSERT INTO teacher_constraint (
       instructor_id, study_week_id, study_day_id, constraint_kind,
       constraint_start_time, constraint_end_time, constraint_note, created_by_user_id,
       teacher_constraint_option_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING teacher_constraint_id`,
    [instructorId, weekId, dayId, kind, start, end, note, user.userId, optionId]
  )
  const id = insert.data?.[0]?.TEACHER_CONSTRAINT_ID

  await recordAudit({
    actorUserId: user.userId,
    action: 'teacher_constraint.create',
    entityType: 'teacher_constraint',
    entityId: id,
    entityLabel: `${kind} ${start}-${end}`,
    changes: {
      instructor_id: { before: null, after: instructorId },
      study_week_id: { before: null, after: weekId },
      study_day_id: { before: null, after: dayId },
      constraint_kind: { before: null, after: kind },
      constraint_start_time: { before: null, after: start },
      constraint_end_time: { before: null, after: end },
      constraint_note: { before: null, after: note },
      teacher_constraint_option_id: { before: null, after: optionId }
    }
  })

  return { success: true, teacherConstraintId: id }
}

export async function deleteTeacherConstraint(userId, id) {
  const user = await loadUser(userId)
  const constraintId = parseInt(id, 10)
  if (!constraintId) throw new Error('That constraint no longer exists.')

  await requireTeacherConstraintTable()

  const res = await query(
    `SELECT teacher_constraint_id, instructor_id, study_week_id, study_day_id,
            constraint_kind, constraint_start_time, constraint_end_time, constraint_note
       FROM teacher_constraint
      WHERE teacher_constraint_id = $1`,
    [constraintId]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('That constraint no longer exists.')

  const isAdmin = user.roles.includes('ADMIN')
  if (!isAdmin && Number(row.INSTRUCTOR_ID) !== Number(user.personId)) {
    throw new Error('You can only remove your own constraints.')
  }

  await query('DELETE FROM teacher_constraint WHERE teacher_constraint_id = $1', [constraintId])

  await recordAudit({
    actorUserId: user.userId,
    action: 'teacher_constraint.delete',
    entityType: 'teacher_constraint',
    entityId: constraintId,
    entityLabel: `${row.CONSTRAINT_KIND} ${String(row.CONSTRAINT_START_TIME || '').slice(0, 5)}-${String(row.CONSTRAINT_END_TIME || '').slice(0, 5)}`,
    changes: {
      constraint_kind: { before: row.CONSTRAINT_KIND, after: null },
      constraint_note: { before: row.CONSTRAINT_NOTE, after: null }
    }
  })

  return { success: true }
}
