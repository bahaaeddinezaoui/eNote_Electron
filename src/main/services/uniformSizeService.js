import { query } from '../db'
import { recordAudit } from './auditService'
import { UNIFORM_SIZE_KINDS } from '../../shared/uniformSizes'

// The sizes a student may be issued for each uniform item, maintained by an
// administrator in Settings → Registers → Uniform sizes. The student forms read
// this list and only offer these values; the write path refuses anything else,
// so a modified client cannot store a size the administration never defined.
//
// The table is created on first use (like the predetermined teacher constraint
// windows) so an existing installation works before its owner runs
// deploy/server/29-add-uniform-size-options.sql.

const KIND_CODES = new Set(UNIFORM_SIZE_KINDS.map((kind) => kind.code))

let schemaReady = null
let schemaRetryAt = 0

async function ensureUniformSizeSchema() {
  if (schemaReady) return schemaReady
  if (Date.now() < schemaRetryAt) return null

  schemaReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS uniform_size_option (
        uniform_size_option_id bigserial PRIMARY KEY,
        uniform_size_kind character varying(32) NOT NULL,
        uniform_size_value character varying(40) NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        created_by_user_id integer,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uniform_size_option_value_key
      ON uniform_size_option (uniform_size_kind, lower(uniform_size_value))
    `)
    // The winter skirt column was missing from the table altogether. Added with
    // the same file on new installations, and here for a database whose owner
    // has not run the migration yet.
    try {
      await query(
        'ALTER TABLE student_parade_uniform ADD COLUMN IF NOT EXISTS winter_skirt_size character varying(10)'
      )
    } catch (error) {
      if (error?.code !== '42501') throw error
      const column = await query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'student_parade_uniform'
            AND column_name = 'winter_skirt_size'`
      )
      if (!column.data?.length) {
        throw new Error(
          'Uniform sizes need one new column. Ask the database owner to run deploy/server/29-add-uniform-size-options.sql.'
        )
      }
    }
    return true
  })().catch((error) => {
    console.warn('Uniform sizes are not available:', error.message)
    schemaReady = null
    schemaRetryAt = Date.now() + 10 * 60 * 1000
    return null
  })

  return schemaReady
}

export async function requireUniformSizeSchema() {
  const ready = await ensureUniformSizeSchema()
  if (!ready) {
    throw new Error(
      'Uniform sizes are not available on this database. Ask the administrator to check the database permissions.'
    )
  }
}

// Editing the enumeration is Admin work. The IPC handlers take the acting
// account from the renderer, so the role is re-read from the database instead
// of trusting the caller's claim.
async function requireAdmin(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: only an administrator may edit the uniform sizes.')
  const res = await query(
    `SELECT r.role_code
       FROM "user" u
       JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [id]
  )
  if (res.data?.[0]?.ROLE_CODE !== 'ADMIN') {
    throw new Error('Not allowed: only an administrator may edit the uniform sizes.')
  }
  return id
}

function normalizeOption(data = {}) {
  const kind = String(data.UNIFORM_SIZE_KIND ?? data.uniform_size_kind ?? '').trim().toUpperCase()
  if (!KIND_CODES.has(kind)) {
    throw new Error('Choose the uniform item this size belongs to.')
  }
  const value = String(data.UNIFORM_SIZE_VALUE ?? data.uniform_size_value ?? '').trim()
  if (!value) throw new Error('A size is required.')
  if (value.length > 40) throw new Error('That size is too long.')
  const parsed = Number.parseInt(data.SORT_ORDER ?? data.sort_order, 10)
  return { kind, value, sortOrder: Number.isFinite(parsed) ? parsed : 0 }
}

async function assertValueFree(kind, value, exceptId = null) {
  const params = [kind, value]
  let except = ''
  if (exceptId) {
    params.push(exceptId)
    except = ` AND uniform_size_option_id <> $${params.length}`
  }
  const res = await query(
    `SELECT uniform_size_option_id
       FROM uniform_size_option
      WHERE uniform_size_kind = $1
        AND lower(uniform_size_value) = lower($2)${except}
      LIMIT 1`,
    params
  )
  if (res.data?.length) {
    throw new Error('That size is already in the list for this uniform item.')
  }
}

// Every size, grouped by uniform item in the order the administration arranged
// them. Read by the student forms and by the register.
export async function getUniformSizeOptions() {
  const ready = await ensureUniformSizeSchema()
  if (!ready) return { data: [], available: false }

  return {
    ...(await query(
      `SELECT *
         FROM uniform_size_option
        ORDER BY uniform_size_kind, sort_order, lower(uniform_size_value),
                 uniform_size_option_id`
    )),
    available: true
  }
}

export async function createUniformSizeOption(userId, data = {}) {
  const adminId = await requireAdmin(userId)
  const option = normalizeOption(data)
  await requireUniformSizeSchema()
  await assertValueFree(option.kind, option.value)

  const insert = await query(
    `INSERT INTO uniform_size_option (
       uniform_size_kind, uniform_size_value, sort_order, created_by_user_id
     ) VALUES ($1,$2,$3,$4)
     RETURNING uniform_size_option_id`,
    [option.kind, option.value, option.sortOrder, adminId]
  )
  const id = insert.data?.[0]?.UNIFORM_SIZE_OPTION_ID

  await recordAudit({
    actorUserId: adminId,
    action: 'uniform_size.option_change',
    entityType: 'uniform_size_option',
    entityId: id,
    entityLabel: `${option.kind} ${option.value}`,
    changes: {
      uniform_size_kind: { before: null, after: option.kind },
      uniform_size_value: { before: null, after: option.value }
    }
  })

  return { success: true, uniformSizeOptionId: id }
}

export async function updateUniformSizeOption(userId, id, data = {}) {
  const adminId = await requireAdmin(userId)
  const optionId = parseInt(id, 10)
  if (!optionId) throw new Error('That size no longer exists.')
  const option = normalizeOption(data)
  await requireUniformSizeSchema()

  const beforeRes = await query(
    `SELECT uniform_size_kind, uniform_size_value
       FROM uniform_size_option WHERE uniform_size_option_id = $1`,
    [optionId]
  )
  const before = beforeRes.data?.[0]
  if (!before) throw new Error('That size no longer exists.')

  await assertValueFree(option.kind, option.value, optionId)

  await query(
    `UPDATE uniform_size_option
        SET uniform_size_kind = $1,
            uniform_size_value = $2,
            sort_order = $3
      WHERE uniform_size_option_id = $4`,
    [option.kind, option.value, option.sortOrder, optionId]
  )

  await recordAudit({
    actorUserId: adminId,
    action: 'uniform_size.option_change',
    entityType: 'uniform_size_option',
    entityId: optionId,
    entityLabel: `${option.kind} ${option.value}`,
    changes: {
      uniform_size_kind: { before: before.UNIFORM_SIZE_KIND, after: option.kind },
      uniform_size_value: { before: before.UNIFORM_SIZE_VALUE, after: option.value }
    }
  })

  return { success: true }
}

// Removing a size never rewrites a student: the record keeps the value it was
// saved with, and only future edits have to choose from what is left.
export async function deleteUniformSizeOption(userId, id) {
  const adminId = await requireAdmin(userId)
  const optionId = parseInt(id, 10)
  if (!optionId) throw new Error('That size no longer exists.')
  await requireUniformSizeSchema()

  const found = await query(
    `SELECT uniform_size_kind, uniform_size_value
       FROM uniform_size_option WHERE uniform_size_option_id = $1`,
    [optionId]
  )
  const row = found.data?.[0]
  if (!row) throw new Error('That size no longer exists.')

  await query('DELETE FROM uniform_size_option WHERE uniform_size_option_id = $1', [optionId])

  await recordAudit({
    actorUserId: adminId,
    action: 'uniform_size.option_change',
    entityType: 'uniform_size_option',
    entityId: optionId,
    entityLabel: `${row.UNIFORM_SIZE_KIND} ${row.UNIFORM_SIZE_VALUE}`,
    changes: {
      uniform_size_value: { before: row.UNIFORM_SIZE_VALUE, after: null }
    }
  })

  return { success: true }
}

// The write path's guard: every submitted size must be one the administrator
// defined for that uniform item. A value already stored on the student is
// always accepted, so a record written before the list existed — or before an
// entry was removed — can still be saved without silently changing it.
export async function assertUniformSizes(fields, submitted = {}, current = {}) {
  const rows = await query('SELECT uniform_size_kind, uniform_size_value FROM uniform_size_option')
  const allowed = new Map()
  for (const row of rows?.data || []) {
    const kind = row.UNIFORM_SIZE_KIND
    if (!allowed.has(kind)) allowed.set(kind, new Set())
    allowed.get(kind).add(String(row.UNIFORM_SIZE_VALUE).trim().toLowerCase())
  }

  for (const field of fields) {
    const raw = submitted?.[field.key]
    if (raw === null || raw === undefined) continue
    const value = String(raw).trim()
    if (!value) continue
    if (current?.[field.key] && String(current[field.key]).trim() === value) continue
    if (allowed.get(field.kind)?.has(value.toLowerCase())) continue
    throw new Error(
      `"${value}" is not one of the sizes the administrator defined for ${field.label}. Add it in Settings → Registers → Uniform sizes.`
    )
  }
}
