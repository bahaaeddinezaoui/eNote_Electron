import { query } from '../db'
import { loadScope, assertStudentAllowed, assertStudentsAllowed } from './teachingScopeService'
import { loadRewardsPunishmentsPermissions } from './secretaryService'

// Rights are per person and per action (secretary_detail). An ADMIN is never
// limited; a secretary without the matching right is refused, whatever the UI
// offered.
async function assertRight(scope, right, message) {
  const permissions = await loadRewardsPunishmentsPermissions(scope)
  if (!permissions[right]) throw new Error(`Not allowed: ${message}`)
}

// Students for the picker: person id and name. A restricted secretary only sees
// the students of the teaching categories they are responsible for, so the
// picker never offers somebody they are not allowed to punish.
//
// The actor is the signed-in *account*, not the person: one person may hold more
// than one account and each carries its own rights.
export async function getRewardsPunishmentsStudents(actorUserId) {
  const scope = await loadScope(actorUserId)

  // The section and category travel with each row so the register can also
  // offer "everybody in this section / category" to a bulk action, without a
  // second, separately-scoped query that could disagree with this one. The
  // current section is the open placement in student_section_history.
  return await query(`
    SELECT sd.person_id, p.person_photo,
           COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
           p.person_first_name_la AS person_first_name_la,
           p.person_first_name_ar AS person_first_name_ar,
           COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
           p.person_last_name_la AS person_last_name_la,
           p.person_last_name_ar AS person_last_name_ar,
           sec.section_id, sec.section_label_en, sec.section_label_ar, sec.section_label_fr,
           tc.teaching_category_id, tc.teaching_category_label_en, tc.teaching_category_label_ar, tc.teaching_category_label_fr
    FROM student_detail sd
    JOIN person p ON p.person_id = sd.person_id
    LEFT JOIN LATERAL (
      SELECT sc.section_id, sc.section_label_en, sc.section_label_ar, sc.section_label_fr, sc.teaching_category_id
      FROM section sc
      WHERE sc.section_id = COALESCE(
        (SELECT h.section_id
           FROM student_section_history h
          WHERE h.person_id = sd.person_id AND h.ended_at IS NULL
          LIMIT 1),
        (SELECT ss.section_id
           FROM student_section ss
          WHERE ss.person_id = sd.person_id
          ORDER BY ss.section_id
          LIMIT 1)
      )
      LIMIT 1
    ) sec ON TRUE
    LEFT JOIN teaching_category tc ON tc.teaching_category_id = sec.teaching_category_id
    WHERE NOT $1::boolean
       OR sec.teaching_category_id = ANY($2::int[])
    ORDER BY COALESCE(p.person_last_name_la, p.person_last_name_ar),
             COALESCE(p.person_first_name_la, p.person_first_name_ar)`,
    [!!scope.restricted, scope.categoryIds || []])
}

export async function getPunishmentTypes() {
  return await query('SELECT * FROM punishment_type ORDER BY punishment_type_id')
}

export async function getRewardTypes() {
  return await query('SELECT * FROM reward_type ORDER BY reward_type_id')
}

// The reasons recorded with a punishment or a reward. They are seeded reference
// data with one label per language, so they sort on the real label columns
// (there is no single justification label column).
export async function getPunishmentJustifications() {
  return await query(`
    SELECT * FROM punishment_justification
    ORDER BY punishment_justification_label_en, punishment_justification_label_ar, punishment_justification_label_fr`)
}

export async function getRewardJustifications() {
  return await query(`
    SELECT * FROM reward_justification
    ORDER BY reward_justification_label_en, reward_justification_label_ar, reward_justification_label_fr`)
}

// A rewards-and-punishments entry is either scheduled (start date + duration in days) or
// immediate (neither, which means no end date either). The end date is never
// stored and is inclusive: start + duration - 1 day, so 2026-10-10 with a
// 3-day duration ends on 2026-10-12.
function readSchedule(startRaw, durationRaw, what) {
  const startDate = startRaw ? String(startRaw).slice(0, 10) : null
  const hasDuration = durationRaw !== null && durationRaw !== undefined && String(durationRaw).trim() !== ''

  // Neither field: an immediate action, applied right away.
  if (!startDate && !hasDuration) return { startDate: null, duration: null }

  if (!startDate) throw new Error(`Start date is required for a scheduled ${what}.`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Start date must be a valid date.')
  if (!hasDuration) throw new Error(`Duration is required for a scheduled ${what}.`)

  const duration = Number(durationRaw)
  if (!Number.isInteger(duration) || duration < 1) {
    throw new Error('Duration must be a whole number of days, at least 1.')
  }
  return { startDate, duration }
}

// Applied rewards and punishments of one student, newest first. A restricted
// secretary can only open a student inside their own categories; the picker
// already hides the rest, and this closes the direct path as well.
export async function getStudentRewardsPunishments(userId, personId) {
  await assertStudentAllowed(await loadScope(userId), personId)

  const studentId = parseInt(personId, 10) || 0
  const [punishments, rewards] = await Promise.all([
    query(
      `SELECT sps.*, pt.punishment_label_en, pt.punishment_label_ar, pt.punishment_label_fr,
              pj.punishment_justification_label_en, pj.punishment_justification_label_ar,
              pj.punishment_justification_label_fr, pj.punishment_justification_code,
              (sps.punishment_start_date + sps.punishment_duration - 1) AS punishment_end_date,
              COALESCE(p.person_first_name_la, p.person_first_name_ar) AS secretary_first_name,
              p.person_first_name_la AS secretary_first_name_la,
              p.person_first_name_ar AS secretary_first_name_ar,
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS secretary_last_name,
              p.person_last_name_la AS secretary_last_name_la,
              p.person_last_name_ar AS secretary_last_name_ar
       FROM secretary_punishes_student sps
       JOIN punishment_type pt ON pt.punishment_type_id = sps.punishment_type_id
       LEFT JOIN punishment_justification pj ON pj.punishment_justification_id = sps.punishment_justification_id
       LEFT JOIN person p ON p.person_id = sps.person_id
       WHERE sps.student_person_id = $1
       ORDER BY sps.punishment_suggested_at DESC`,
      [studentId]
    ),
    query(
      `SELECT srs.*, rt.reward_label_en, rt.reward_label_ar, rt.reward_label_fr,
              rj.reward_justification_label_en, rj.reward_justification_label_ar,
              rj.reward_justification_label_fr, rj.reward_justification_code,
              (srs.reward_start_date + srs.reward_duration - 1) AS reward_end_date,
              COALESCE(p.person_first_name_la, p.person_first_name_ar) AS secretary_first_name,
              p.person_first_name_la AS secretary_first_name_la,
              p.person_first_name_ar AS secretary_first_name_ar,
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS secretary_last_name,
              p.person_last_name_la AS secretary_last_name_la,
              p.person_last_name_ar AS secretary_last_name_ar
       FROM secretary_rewards_student srs
       JOIN reward_type rt ON rt.reward_type_id = srs.reward_type_id
       LEFT JOIN reward_justification rj ON rj.reward_justification_id = srs.reward_justification_id
       LEFT JOIN person p ON p.person_id = srs.person_id
       WHERE srs.student_person_id = $1
       ORDER BY srs.reward_suggested_at DESC`,
      [studentId]
    )
  ])
  return {
    success: true,
    punishments: punishments.data || [],
    rewards: rewards.data || []
  }
}

// Every entry is filed with the reason it was recorded, like an absence: the id
// must name a row of the matching seeded vocabulary.
async function readJustificationId(table, column, raw, what) {
  const id = parseInt(raw, 10)
  if (!id) throw new Error(`Justification is required for a ${what}.`)
  const res = await query(`SELECT ${column} FROM ${table} WHERE ${column} = $1`, [id])
  if (!res.data || res.data.length === 0) throw new Error('Choose a valid justification.')
  return id
}

// Apply a punishment. secretaryUserId = the acting account, whose person is the
// secretary the record is filed against. The secretary chooses the start date
// and the duration; leaving both empty records an immediate punishment. The end
// date is derived, never stored.
export async function applyPunishment(secretaryUserId, data) {
  const studentId = parseInt(data.STUDENT_PERSON_ID, 10)
  const typeId = parseInt(data.PUNISHMENT_TYPE_ID, 10)
  if (!studentId) throw new Error('Student is required.')
  if (!typeId) throw new Error('Punishment type is required.')
  const scope = await loadScope(secretaryUserId)
  await assertStudentAllowed(scope, studentId)
  await assertRight(scope, 'canAddPunishments', 'your account may not add punishments. Ask an administrator to grant it.')

  const { startDate, duration } = readSchedule(
    data.PUNISHMENT_START_DATE,
    data.PUNISHMENT_DURATION,
    'punishment'
  )
  const justificationId = await readJustificationId(
    'punishment_justification',
    'punishment_justification_id',
    data.PUNISHMENT_JUSTIFICATION_ID,
    'punishment'
  )

  const res = await query(
    `INSERT INTO secretary_punishes_student
       (student_person_id, person_id, punishment_type_id, punishment,
        punishment_start_date, punishment_duration, punishment_note, punishment_justification_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING punishment_id`,
    [studentId, scope.personId, typeId, data.PUNISHMENT || null, startDate, duration, data.PUNISHMENT_NOTE || null, justificationId]
  )
  return { success: true, punishmentId: res.data?.[0]?.PUNISHMENT_ID, immediate: startDate === null }
}

// Apply a reward. Same schedule rules as punishments: start date + duration,
// or neither for an immediate reward.
export async function applyReward(secretaryUserId, data) {
  const studentId = parseInt(data.STUDENT_PERSON_ID, 10)
  const typeId = parseInt(data.REWARD_TYPE_ID, 10)
  if (!studentId) throw new Error('Student is required.')
  if (!typeId) throw new Error('Reward type is required.')
  const scope = await loadScope(secretaryUserId)
  await assertStudentAllowed(scope, studentId)
  await assertRight(scope, 'canAddRewards', 'your account may not add rewards. Ask an administrator to grant it.')

  const { startDate, duration } = readSchedule(
    data.REWARD_START_DATE,
    data.REWARD_DURATION,
    'reward'
  )
  const justificationId = await readJustificationId(
    'reward_justification',
    'reward_justification_id',
    data.REWARD_JUSTIFICATION_ID,
    'reward'
  )

  const res = await query(
    `INSERT INTO secretary_rewards_student
       (student_person_id, person_id, reward_type_id,
        reward_start_date, reward_duration, reward_note, reward_justification_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING reward_id`,
    [studentId, scope.personId, typeId, startDate, duration, data.REWARD_NOTE || null, justificationId]
  )
  return { success: true, rewardId: res.data?.[0]?.REWARD_ID, immediate: startDate === null }
}

// ---- Bulk -------------------------------------------------------------------
// One action applied to a whole group. The recipients are resolved in the
// renderer (by student, by section, by category) and arrive as a plain list, so
// the server checks the same things it checks for a single student: every
// student inside the account's categories, and the right to record the entry.
// One INSERT ... SELECT writes the batch atomically: a refused batch writes
// nothing at all.

function readBulkStudentIds(raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : []).map(v => parseInt(v, 10)).filter(Boolean))]
  if (ids.length === 0) throw new Error('Choose at least one student.')
  return ids
}

async function prepareBulk(secretaryUserId, data, { right, message, kind, typeId }) {
  if (!typeId) throw new Error(`${kind === 'punishment' ? 'Punishment' : 'Reward'} type is required.`)
  const studentIds = readBulkStudentIds(data.STUDENT_PERSON_IDS)

  const scope = await loadScope(secretaryUserId)
  await assertStudentsAllowed(scope, studentIds)
  await assertRight(scope, right, message)

  const prefix = kind.toUpperCase()
  const { startDate, duration } = readSchedule(
    data[`${prefix}_START_DATE`],
    data[`${prefix}_DURATION`],
    kind
  )
  const justificationId = await readJustificationId(
    `${kind}_justification`,
    `${kind}_justification_id`,
    data[`${prefix}_JUSTIFICATION_ID`],
    kind
  )

  // The entries are filed against the account's person, whatever the caller sent.
  return { studentIds, startDate, duration, justificationId, actorPersonId: scope.personId }
}

export async function applyPunishmentBulk(secretaryUserId, data = {}) {
  const typeId = parseInt(data.PUNISHMENT_TYPE_ID, 10)
  const { studentIds, startDate, duration, justificationId, actorPersonId } = await prepareBulk(secretaryUserId, data, {
    right: 'canAddPunishments',
    message: 'your account may not add punishments. Ask an administrator to grant it.',
    kind: 'punishment',
    typeId
  })

  const res = await query(
    `INSERT INTO secretary_punishes_student
       (student_person_id, person_id, punishment_type_id, punishment,
        punishment_start_date, punishment_duration, punishment_note, punishment_justification_id)
     SELECT sid, $2::bigint, $3::int, $4::text, $5::date, $6::int, $7::text, $8::int
     FROM unnest($1::bigint[]) AS sid`,
    [studentIds, actorPersonId, typeId, data.PUNISHMENT || null, startDate, duration, data.PUNISHMENT_NOTE || null, justificationId]
  )
  return { success: true, count: res.rowCount, immediate: startDate === null }
}

export async function applyRewardBulk(secretaryUserId, data = {}) {
  const typeId = parseInt(data.REWARD_TYPE_ID, 10)
  const { studentIds, startDate, duration, justificationId, actorPersonId } = await prepareBulk(secretaryUserId, data, {
    right: 'canAddRewards',
    message: 'your account may not add rewards. Ask an administrator to grant it.',
    kind: 'reward',
    typeId
  })

  const res = await query(
    `INSERT INTO secretary_rewards_student
       (student_person_id, person_id, reward_type_id,
        reward_start_date, reward_duration, reward_note, reward_justification_id)
     SELECT sid, $2::bigint, $3::int, $4::date, $5::int, $6::text, $7::int
     FROM unnest($1::bigint[]) AS sid`,
    [studentIds, actorPersonId, typeId, startDate, duration, data.REWARD_NOTE || null, justificationId]
  )
  return { success: true, count: res.rowCount, immediate: startDate === null }
}

// The student a rewards-and-punishments record belongs to. Ids are action ids, not
// person ids, so the row has to be resolved before the scope can be checked.
async function recordStudentId(table, idColumn, recordId) {
  const res = await query(
    `SELECT student_person_id FROM ${table} WHERE ${idColumn} = $1`,
    [parseInt(recordId, 10) || 0]
  )
  const studentId = res.data?.[0]?.STUDENT_PERSON_ID
  if (!studentId) throw new Error('Record not found.')
  return studentId
}

// Change an entry that is already recorded. Editing is a right of its own: an
// account may be allowed to add an entry without being allowed to change one,
// so the check is 'canEdit*' rather than the add right. Every field moves to
// the submitted value, exactly as when the entry was first recorded, and the
// student has to stay inside the account's categories.
export async function updatePunishment(secretaryUserId, punishmentId, data = {}) {
  const id = parseInt(punishmentId, 10)
  if (!id) throw new Error('Select the punishment to change.')
  const typeId = parseInt(data.PUNISHMENT_TYPE_ID, 10)
  if (!typeId) throw new Error('Punishment type is required.')

  const scope = await loadScope(secretaryUserId)
  const studentId = await recordStudentId('secretary_punishes_student', 'punishment_id', id)
  await assertStudentAllowed(scope, studentId)
  await assertRight(scope, 'canEditPunishments', 'your account may not edit punishments. Ask an administrator to grant it.')

  const { startDate, duration } = readSchedule(
    data.PUNISHMENT_START_DATE,
    data.PUNISHMENT_DURATION,
    'punishment'
  )
  const justificationId = await readJustificationId(
    'punishment_justification',
    'punishment_justification_id',
    data.PUNISHMENT_JUSTIFICATION_ID,
    'punishment'
  )

  await query(
    `UPDATE secretary_punishes_student
        SET punishment_type_id = $2, punishment = $3, punishment_start_date = $4,
            punishment_duration = $5, punishment_note = $6, punishment_justification_id = $7
      WHERE punishment_id = $1`,
    [id, typeId, data.PUNISHMENT || null, startDate, duration, data.PUNISHMENT_NOTE || null, justificationId]
  )
  return { success: true, punishmentId: id, immediate: startDate === null }
}

export async function updateReward(secretaryUserId, rewardId, data = {}) {
  const id = parseInt(rewardId, 10)
  if (!id) throw new Error('Select the reward to change.')
  const typeId = parseInt(data.REWARD_TYPE_ID, 10)
  if (!typeId) throw new Error('Reward type is required.')

  const scope = await loadScope(secretaryUserId)
  const studentId = await recordStudentId('secretary_rewards_student', 'reward_id', id)
  await assertStudentAllowed(scope, studentId)
  await assertRight(scope, 'canEditRewards', 'your account may not edit rewards. Ask an administrator to grant it.')

  const { startDate, duration } = readSchedule(
    data.REWARD_START_DATE,
    data.REWARD_DURATION,
    'reward'
  )
  const justificationId = await readJustificationId(
    'reward_justification',
    'reward_justification_id',
    data.REWARD_JUSTIFICATION_ID,
    'reward'
  )

  await query(
    `UPDATE secretary_rewards_student
        SET reward_type_id = $2, reward_start_date = $3, reward_duration = $4,
            reward_note = $5, reward_justification_id = $6
      WHERE reward_id = $1`,
    [id, typeId, startDate, duration, data.REWARD_NOTE || null, justificationId]
  )
  return { success: true, rewardId: id, immediate: startDate === null }
}

// Deleting follows the same rule as adding: only inside your categories.
export async function deletePunishment(secretaryUserId, punishmentId) {
  const scope = await loadScope(secretaryUserId)
  await assertRight(scope, 'canDeletePunishments', 'your account may not delete punishments. Ask an administrator to grant it.')

  const studentId = await recordStudentId('secretary_punishes_student', 'punishment_id', punishmentId)
  await assertStudentAllowed(scope, studentId)

  await query('DELETE FROM secretary_punishes_student WHERE punishment_id = $1', [punishmentId])
  return { success: true }
}

export async function deleteReward(secretaryUserId, rewardId) {
  const scope = await loadScope(secretaryUserId)
  await assertRight(scope, 'canDeleteRewards', 'your account may not delete rewards. Ask an administrator to grant it.')

  const studentId = await recordStudentId('secretary_rewards_student', 'reward_id', rewardId)
  await assertStudentAllowed(scope, studentId)

  await query('DELETE FROM secretary_rewards_student WHERE reward_id = $1', [rewardId])
  return { success: true }
}
