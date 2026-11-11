import { query } from '../db'
import { recordAudit } from './auditService'
import { tryDdl } from '../sqlGuards'

// Locked pages (Settings → Locked pages). A lock is stored per route and, now,
// per role: the page stays visible to everybody who already had it, but the
// locked notice is shown only to the roles the lock names. A lock with no role
// rows closes the page for every role — that is what a lock saved before roles
// existed means, and what the page-wide switch writes — so older rows keep
// working untouched.
//
// Admins and Developers administer the locks, so they keep the keys and are not
// among the roles a lock can pick.

const ROUTE_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/

// The roles a lock can close a page for.
export const LOCKABLE_ROLES = ['TEACHER', 'STUDENT', 'DIRECTOR', 'SECRETARY', 'SCHEDULER']

let roleTableReady = null
let roleTableRetryAt = 0

// The child table is created on first use so an installation that never runs
// the SQL migration still gets per-role locks. A database whose role does not
// own the tables may refuse the optional index; that is not fatal, the table
// itself is what matters.
async function ensureRoleTable() {
  if (roleTableReady) return roleTableReady
  if (Date.now() < roleTableRetryAt) return null

  roleTableReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS app_locked_page_role (
        app_locked_page_role_id bigserial PRIMARY KEY,
        route character varying(120) NOT NULL,
        role_code character varying(24) NOT NULL,
        created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    await tryDdl(`
      CREATE UNIQUE INDEX IF NOT EXISTS app_locked_page_role_key
      ON app_locked_page_role (route, role_code)
    `)
    return true
  })().catch((error) => {
    console.warn('Per-role page locks are not available:', error.message)
    roleTableReady = null
    roleTableRetryAt = Date.now() + 10 * 60 * 1000
    return null
  })

  return roleTableReady
}

// ---- Server-side enforcement -------------------------------------------------
// The renderer draws the lock, but a modified client can call any channel it
// likes. Every read that belongs to a lockable page therefore asks here first:
// the account's role is read from the database (never from the caller), an
// Admin or a Developer keeps the keys as in the UI, and a lock with no role
// rows closes the page for every other role.
//
// A signed-out caller is refused as soon as the route carries a lock at all:
// without an account there is no role to compare, and guessing "allow" is what
// the lock exists to prevent.
export async function assertPageAccess(userId, route) {
  const path = normalizeRoute(route)

  // The lock rows live on the server, so an outage is not a lock decision:
  // refusing here would close every lockable page — including the saved file a
  // reader is trying to open — the moment the server goes away. Offline the
  // pages are read-only, and the renderer's own guard still marks them from the
  // cached lock list.
  let locked
  try {
    locked = await query('SELECT 1 FROM app_locked_page WHERE route = $1', [path])
  } catch (error) {
    if (error?.offline) return true
    throw error
  }
  if (!locked.data?.length) return true

  const id = parseInt(userId, 10)
  if (!id) {
    throw new Error(`This page is locked (${path}). Sign in with an account the lock does not block.`)
  }

  const roleRes = await query(
    `SELECT r.role_code
       FROM "user" u
       JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [id]
  )
  const roleCode = roleRes.data?.[0]?.ROLE_CODE
  if (!roleCode) throw new Error('Not allowed: this account has no role.')
  // Whoever administers the locks keeps the keys, exactly as the sidebar and
  // the page guard do.
  if (roleCode === 'ADMIN' || roleCode === 'DEVELOPER') return true

  // Read the role rows without asking ensureRoleTable to create anything: on
  // the LAN the application connects as enote_app, which does not own these
  // tables and may be refused a CREATE. Treating a refused DDL as "no roles"
  // would turn a lock that names a few roles into one that closes the page for
  // everybody, so the table's existence is checked directly instead.
  let roles = []
  const table = await query("SELECT to_regclass('public.app_locked_page_role') AS t")
  if (table.data?.[0]?.T) {
    const roleRows = await query(
      'SELECT role_code FROM app_locked_page_role WHERE route = $1',
      [path]
    )
    roles = (roleRows.data || []).map((row) => row.ROLE_CODE)
  }

  // No role rows means the page-wide lock: closed for every role but the two
  // above, which is what an older lock means too.
  if (roles.length === 0 || roles.includes(roleCode)) {
    throw new Error(
      `This page is locked for the ${roleCode} role (${path}). Ask an administrator to unlock it.`
    )
  }

  return true
}

function normalizeRoute(route) {
  const path = String(route || '').trim()
  if (path.length > 120 || !ROUTE_PATTERN.test(path)) {
    throw new Error(`Unknown page "${path}".`)
  }
  return path
}

async function assertSignedIn(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('You must be signed in to lock pages.')
  return id
}

// Every locked page with the roles it closes for ([] = every role). The flat
// `routes` list stays for callers that only need to know which pages are locked.
export async function getLockedPages() {
  const res = await query(
    `SELECT l.route, l.locked_at, u.user_username AS locked_by
       FROM app_locked_page l
       LEFT JOIN "user" u ON u.user_id = l.locked_by
      ORDER BY l.route`
  )
  const rows = res?.data || []

  const rolesByRoute = new Map()
  if (await ensureRoleTable()) {
    const roleRes = await query(
      'SELECT route, role_code FROM app_locked_page_role ORDER BY route, role_code'
    )
    for (const row of roleRes?.data || []) {
      if (!rolesByRoute.has(row.ROUTE)) rolesByRoute.set(row.ROUTE, [])
      rolesByRoute.get(row.ROUTE).push(row.ROLE_CODE)
    }
  }

  const locks = rows.map((row) => ({
    route: row.ROUTE,
    lockedBy: row.LOCKED_BY,
    lockedAt: row.LOCKED_AT,
    // An empty list reads as "every role".
    roles: rolesByRoute.get(row.ROUTE) || []
  }))

  return {
    routes: locks.map((lock) => lock.route),
    locks,
    data: locks,
    rowCount: locks.length
  }
}

// The page-wide switch: lock for every role, or lift the lock entirely. Locking
// again starts from "every role" (any role rows left from an older lock are
// cleared), and unlocking cascades to them.
export async function setPageLocked(userId, route, locked) {
  const id = await assertSignedIn(userId)
  const path = normalizeRoute(route)

  if (locked) {
    await query(
      `INSERT INTO app_locked_page (route, locked_by, locked_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (route) DO UPDATE
         SET locked_by = EXCLUDED.locked_by, locked_at = CURRENT_TIMESTAMP`,
      [path, id]
    )
    if (await ensureRoleTable()) {
      await query('DELETE FROM app_locked_page_role WHERE route = $1', [path])
    }
  } else {
    await query('DELETE FROM app_locked_page WHERE route = $1', [path])
    if (await ensureRoleTable()) {
      await query('DELETE FROM app_locked_page_role WHERE route = $1', [path])
    }
  }

  await recordAudit({
    actorUserId: id,
    action: 'permission.page_lock',
    entityType: 'page',
    entityId: path,
    entityLabel: path,
    detail: { route: path, locked: !!locked }
  })

  return { route: path, locked: !!locked, roles: [] }
}

// Which roles the lock closes the page for. An empty list is refused: "nobody"
// is an unlocked page, and that is what setPageLocked(false) is for.
export async function setPageLockRoles(userId, route, roleCodes) {
  const id = await assertSignedIn(userId)
  const path = normalizeRoute(route)

  const requested = Array.isArray(roleCodes) ? roleCodes : []
  const roles = [...new Set(
    requested.map((code) => String(code || '').trim().toUpperCase()).filter(Boolean)
  )]
  const unknown = roles.filter((code) => !LOCKABLE_ROLES.includes(code))
  if (unknown.length) {
    throw new Error(`Unknown role "${unknown[0]}".`)
  }
  if (roles.length === 0) {
    throw new Error('Choose at least one role, or unlock the page instead.')
  }

  if (!(await ensureRoleTable())) {
    throw new Error(
      'Per-role page locks are not available on this database. Ask the administrator to run deploy/server/26-page-locks-per-role.sql.'
    )
  }

  const locked = await query('SELECT 1 FROM app_locked_page WHERE route = $1', [path])
  if (!locked.data?.length) {
    throw new Error('Lock the page before choosing the roles it closes for.')
  }

  await query('DELETE FROM app_locked_page_role WHERE route = $1', [path])
  for (const code of roles) {
    await query(
      `INSERT INTO app_locked_page_role (route, role_code)
       VALUES ($1, $2)
       ON CONFLICT (route, role_code) DO NOTHING`,
      [path, code]
    )
  }

  await recordAudit({
    actorUserId: id,
    action: 'permission.page_lock',
    entityType: 'page',
    entityId: path,
    entityLabel: path,
    detail: { route: path, locked: true, roles }
  })

  return { route: path, locked: true, roles }
}
