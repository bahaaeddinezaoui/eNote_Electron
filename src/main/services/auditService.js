import { query } from '../db'

// The audit trail behind the Activity log page (Admin and Developer).
//
// Entries are written here by the service that performs the action, never by the
// renderer, and audit_log is append-only (migration_audit_log.sql). Every write
// is best-effort: an audit failure must not undo the action it describes, so
// recordAudit() reports the problem on the console and returns.
//
// Passwords and tokens are never stored. National identifiers and phone numbers
// keep only their last three digits, so the trail stays auditable without
// becoming a second copy of the registry's private data.

const RETENTION_DAYS = 365
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000
const MAX_EXPORT_ROWS = 10000
const MAX_PAGE_SIZE = 200

let appVersion = ''
let lastPruneAt = 0

export function setAuditAppVersion(version) {
  appVersion = String(version || '').slice(0, 24)
}

const SECRET_FIELD = /pass|token|secret|hash|salt|credential/i
const IDENTIFIER_FIELD = /national_identification|insurance_card|military_card|military_helmet|social_security|phone/i

function maskDigits(value) {
  const text = String(value)
  const total = (text.match(/\d/g) || []).length
  if (total === 0) return text
  let seen = 0
  return text.replace(/\d/g, (digit) => {
    seen += 1
    return seen > total - 3 ? digit : '•'
  })
}

// The single redaction point for both the diff and the detail payload.
export function maskSensitive(field, value) {
  if (value === null || value === undefined) return value
  const key = String(field || '')
  if (SECRET_FIELD.test(key)) return '[redacted]'
  if (Array.isArray(value)) return value.map((item) => maskSensitive(key, item))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = maskSensitive(k, v)
    return out
  }
  if (IDENTIFIER_FIELD.test(key)) return maskDigits(value)
  return value
}

function comparable(value) {
  if (value === null || value === undefined || value === '') return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Field-level before/after for an update. `beforeRow` is a database row (any
// key casing); `afterObject` is what the caller submitted. Only fields that
// actually changed are kept, and sensitive values are masked here so no caller
// can forget to.
export function diffRow(beforeRow, afterObject) {
  const before = {}
  for (const [key, value] of Object.entries(beforeRow || {})) {
    before[String(key).toLowerCase()] = value
  }

  const changes = {}
  for (const [rawKey, rawNext] of Object.entries(afterObject || {})) {
    const key = String(rawKey).toLowerCase()
    const next = rawNext === '' ? null : rawNext
    const prev = before[key] === undefined ? null : before[key]
    if (comparable(prev) === comparable(next)) continue
    changes[key] = { before: maskSensitive(key, prev), after: maskSensitive(key, next) }
  }
  return changes
}

const ACTOR_SELECT = `
  SELECT u.user_id, u.user_username, u.person_id,
         COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
         p.person_first_name_la AS person_first_name_la,
         p.person_first_name_ar AS person_first_name_ar,
         COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
         p.person_last_name_la AS person_last_name_la,
         p.person_last_name_ar AS person_last_name_ar,
         COALESCE(array_agg(r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
    FROM "user" u
    LEFT JOIN person p ON p.person_id = u.person_id
    LEFT JOIN "role" r ON r.role_id = u.role_id`

async function personName(personId) {
  if (!personId) return null
  const res = await query(
    'SELECT person_first_name_la, person_last_name_la FROM person WHERE person_id = $1',
    [personId]
  )
  const row = res.data?.[0]
  if (!row) return null
  return [row.PERSON_FIRST_NAME_LA, row.PERSON_LAST_NAME_LA].filter(Boolean).join(' ') || null
}

// Who did it, resolved from the account (preferred), the person, or — for a
// failed sign-in with an unknown name — the username that was attempted.
async function resolveActor(entry) {
  let row = null
  const userId = parseInt(entry.actorUserId, 10)
  const personId = parseInt(entry.actorPersonId, 10)

  if (userId) {
    const res = await query(
      `${ACTOR_SELECT} WHERE u.user_id = $1 GROUP BY u.user_id, p.person_id`,
      [userId]
    )
    row = res.data?.[0] || null
  } else if (personId) {
    const res = await query(
      `${ACTOR_SELECT} WHERE u.person_id = $1 GROUP BY u.user_id, p.person_id LIMIT 1`,
      [personId]
    )
    row = res.data?.[0] || null
  } else if (entry.actorUsername) {
    const res = await query(
      `${ACTOR_SELECT} WHERE u.user_username = $1 GROUP BY u.user_id, p.person_id LIMIT 1`,
      [entry.actorUsername]
    )
    row = res.data?.[0] || null
  }

  if (row) {
    const name = [row.PERSON_FIRST_NAME, row.PERSON_LAST_NAME].filter(Boolean).join(' ')
    return {
      userId: row.USER_ID,
      personId: row.PERSON_ID,
      username: row.USER_USERNAME,
      name: name || entry.actorName || null,
      roles: row.ROLES || []
    }
  }

  return {
    userId: null,
    personId: personId || null,
    username: entry.actorUsername || null,
    name: entry.actorName || (await personName(personId)),
    roles: []
  }
}

function errorText(error) {
  if (!error) return null
  const text = error instanceof Error ? error.message : String(error)
  return text.slice(0, 2000)
}

// Writes one entry. Never throws: the action it describes has already happened.
export async function recordAudit(entry = {}) {
  try {
    const actor = await resolveActor(entry)
    await query(
      `INSERT INTO audit_log (
         actor_user_id, actor_username, actor_person_id, actor_name, actor_roles,
         action, entity_type, entity_id, entity_label, result, error_message,
         changes, detail, app_version
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14)`,
      [
        actor.userId || null,
        actor.username || null,
        actor.personId || null,
        actor.name || null,
        actor.roles || [],
        String(entry.action || 'unknown').slice(0, 80),
        entry.entityType ? String(entry.entityType).slice(0, 40) : null,
        entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
        entry.entityLabel || null,
        entry.result === 'failure' ? 'failure' : 'success',
        errorText(entry.error),
        JSON.stringify(maskSensitive('changes', entry.changes || {})),
        JSON.stringify(maskSensitive('detail', entry.detail || {})),
        appVersion || null
      ]
    )
  } catch (error) {
    console.warn('Could not write the audit entry:', error.message)
  }
}

// Reading the trail requires the Admin or Developer role, checked against the
// account's role_id in the database — the renderer is never trusted.
async function requireAuditReader(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const res = await query(
    `SELECT u.user_id, u.is_active,
            COALESCE(array_agg(r.role_code) FILTER (WHERE r.role_code IS NOT NULL), '{}') AS roles
       FROM "user" u
       LEFT JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1
      GROUP BY u.user_id`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  if (row.IS_ACTIVE === false) throw new Error('Not allowed: this account is inactive.')

  const roles = row.ROLES || []
  if (!roles.includes('ADMIN') && !roles.includes('DEVELOPER')) {
    throw new Error('Not allowed: the activity log requires the Admin or Developer role.')
  }
  return id
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function buildFilters(filters = {}) {
  const where = []
  const values = []
  const push = (sql) => {
    values.push(sql.value)
    where.push(sql.text.replace('$?', `$${values.length}`))
  }

  if (DATE_PATTERN.test(String(filters.from || ''))) {
    push({ text: 'occurred_at >= $?::date', value: filters.from })
  }
  if (DATE_PATTERN.test(String(filters.to || ''))) {
    push({ text: "occurred_at < ($?::date + interval '1 day')", value: filters.to })
  }
  if (filters.actor) {
    values.push(`%${String(filters.actor).trim()}%`)
    where.push(`(COALESCE(actor_username, '') ILIKE $${values.length} OR COALESCE(actor_name, '') ILIKE $${values.length})`)
  }
  if (filters.action) {
    push({ text: 'action = $?', value: String(filters.action).slice(0, 80) })
  }
  if (filters.entityType) {
    push({ text: 'entity_type = $?', value: String(filters.entityType).slice(0, 40) })
  }
  if (filters.result === 'success' || filters.result === 'failure') {
    push({ text: 'result = $?', value: filters.result })
  }
  if (filters.q) {
    values.push(`%${String(filters.q).trim()}%`)
    const index = values.length
    where.push(`(
      action ILIKE $${index}
      OR COALESCE(entity_label, '') ILIKE $${index}
      OR COALESCE(entity_id, '') ILIKE $${index}
      OR COALESCE(actor_name, '') ILIKE $${index}
      OR COALESCE(actor_username, '') ILIKE $${index}
      OR COALESCE(error_message, '') ILIKE $${index}
      OR changes::text ILIKE $${index}
    )`)
  }

  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', values }
}

const ENTRY_COLUMNS = `
  audit_log_id, occurred_at, actor_user_id, actor_username, actor_person_id,
  actor_name, actor_roles, action, entity_type, entity_id, entity_label,
  result, error_message, changes, detail, app_version`

// The page: filters, one page of entries, the total, and the facets the filter
// dropdowns offer. `recordView` writes the "Activity log viewed" entry once per
// opening, not on every filter change.
export async function getAuditLog(userId, filters = {}) {
  const readerId = await requireAuditReader(userId)
  await pruneExpiredAuditLogs()

  const page = Math.max(parseInt(filters.page, 10) || 1, 1)
  const pageSize = Math.min(Math.max(parseInt(filters.pageSize, 10) || 25, 10), MAX_PAGE_SIZE)
  const { where, values } = buildFilters(filters)

  const [rowsRes, totalRes, actionRes, entityRes] = await Promise.all([
    query(
      `SELECT ${ENTRY_COLUMNS} FROM audit_log ${where}
        ORDER BY occurred_at DESC, audit_log_id DESC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      values
    ),
    query(`SELECT count(*)::int AS total FROM audit_log ${where}`, values),
    query(`SELECT action, count(*)::int AS n FROM audit_log GROUP BY action ORDER BY action`),
    query(
      `SELECT entity_type, count(*)::int AS n FROM audit_log
        WHERE entity_type IS NOT NULL GROUP BY entity_type ORDER BY entity_type`
    )
  ])

  if (filters.recordView) {
    await recordAudit({
      actorUserId: readerId,
      action: 'audit.view',
      entityType: 'audit_log',
      result: 'success',
      detail: {
        page,
        pageSize,
        filters: {
          q: filters.q || '',
          from: filters.from || '',
          to: filters.to || '',
          actor: filters.actor || '',
          action: filters.action || '',
          entityType: filters.entityType || '',
          result: filters.result || ''
        }
      }
    })
  }

  return {
    success: true,
    rows: rowsRes.data || [],
    total: Number(totalRes.data?.[0]?.TOTAL || 0),
    page,
    pageSize,
    actions: (actionRes.data || []).map((row) => row.ACTION),
    entities: (entityRes.data || []).map((row) => row.ENTITY_TYPE)
  }
}

function csvCell(value) {
  return `"${String(value === null || value === undefined ? '' : value).replace(/"/g, '""')}"`
}

function changeSummary(changes) {
  if (!changes || typeof changes !== 'object') return ''
  return Object.entries(changes)
    .map(([field, pair]) => {
      const value = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))
      return `${field}: ${value(pair?.before)} → ${value(pair?.after)}`
    })
    .join('; ')
}

// The filtered set as CSV, capped so an export cannot stall the window. The
// rendering is done here, not in the renderer, so the same filters and the same
// masking apply.
export async function exportAuditCsv(userId, filters = {}) {
  await requireAuditReader(userId)

  const { where, values } = buildFilters(filters)
  const res = await query(
    `SELECT ${ENTRY_COLUMNS} FROM audit_log ${where}
      ORDER BY occurred_at DESC, audit_log_id DESC
      LIMIT ${MAX_EXPORT_ROWS}`,
    values
  )
  const rows = res.data || []

  const header = [
    'time', 'actor', 'username', 'roles', 'action', 'entity_type', 'entity_id',
    'entity_label', 'result', 'error', 'changes', 'app_version'
  ]
  const lines = [header.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push([
      row.OCCURRED_AT ? new Date(row.OCCURRED_AT).toISOString() : '',
      row.ACTOR_NAME || '',
      row.ACTOR_USERNAME || '',
      Array.isArray(row.ACTOR_ROLES) ? row.ACTOR_ROLES.join(' ') : '',
      row.ACTION || '',
      row.ENTITY_TYPE || '',
      row.ENTITY_ID || '',
      row.ENTITY_LABEL || '',
      row.RESULT || '',
      row.ERROR_MESSAGE || '',
      changeSummary(row.CHANGES),
      row.APP_VERSION || ''
    ].map(csvCell).join(','))
  }

  const stamp = new Date().toISOString().slice(0, 10)
  return {
    success: true,
    rowCount: rows.length,
    truncated: rows.length === MAX_EXPORT_ROWS,
    filename: `activity-log-${stamp}.csv`,
    // The BOM keeps Excel from mangling Arabic and French names.
    csv: `\uFEFF${lines.join('\r\n')}`
  }
}

// Retention: entries older than 12 months are removed once a day. The delete
// goes through prune_audit_log(), the only statement the table's guard allows.
export async function pruneExpiredAuditLogs(force = false) {
  if (!force && Date.now() - lastPruneAt < PRUNE_INTERVAL_MS) {
    return { success: true, skipped: true, removed: 0 }
  }
  lastPruneAt = Date.now()

  try {
    const res = await query('SELECT prune_audit_log($1) AS removed', [RETENTION_DAYS])
    const removed = Number(res.data?.[0]?.REMOVED || 0)
    if (removed > 0) console.log(`Pruned ${removed} audit log entr${removed === 1 ? 'y' : 'ies'} older than ${RETENTION_DAYS} days.`)
    return { success: true, removed }
  } catch (error) {
    console.warn('Could not prune the audit log:', error.message)
    return { success: false, removed: 0, error: error.message }
  }
}
