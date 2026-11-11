import { query } from '../db'
import { tryDdl } from '../sqlGuards'
import { recordAudit } from './auditService'
import { isDeveloperSessionManagementAllowed } from './settingsService'

// User sessions: one row per signed-in application window.
//
// The desktop client keeps a session id from sign-in until it signs out. A
// heartbeat refreshes last_seen_at while the window is open; ending a session
// (from this account or from an administrator's list) closes it for good, and
// the next heartbeat signs that window out. Sessions are created on first use,
// like the Library tables, so an installation that has not run the SQL
// migration still gets the feature.
//
// Permissions are re-read from the database on every call:
//   - an account may always read and end its own sessions;
//   - the Admin role may read and end every session, without exclusions;
//   - the Developer role may do the same only while the administrator has
//     allowed it in Settings (app_option.developer_session_management).
//
// A session that is still open but has not been seen for ACTIVE_WINDOW_MINUTES
// is labelled inactive. It is not closed automatically: a sleeping computer or
// a short network outage must not sign anybody out.

const ACTIVE_WINDOW_MINUTES = 10
const ACTIVE_WINDOW_MS = ACTIVE_WINDOW_MINUTES * 60 * 1000
const MAX_DEVICE_NAME = 160
const MAX_PLATFORM = 80
const MAX_APP_VERSION = 40

let tableReady = null

async function userSessionTableExists() {
  const res = await query("SELECT to_regclass('public.user_session') IS NOT NULL AS present")
  return res.data?.[0]?.PRESENT === true
}

// The table and its indexes exist on a fresh installation, whether or not the
// deployment SQL was run. Indexes are optional for a role that does not own the
// table; the table itself is what matters.
async function ensureUserSessionTable() {
  if (tableReady) return tableReady

  tableReady = (async () => {
    if (!(await userSessionTableExists())) {
      await query(`
        CREATE TABLE IF NOT EXISTS user_session (
          user_session_id bigserial PRIMARY KEY,
          user_id integer NOT NULL,
          started_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          ended_at timestamp with time zone,
          ended_by_user_id integer,
          end_reason character varying(40),
          device_name character varying(160),
          device_platform character varying(80),
          app_version character varying(40)
        )
      `)
    }

    await tryDdl(
      'CREATE INDEX IF NOT EXISTS user_session_user_idx ON user_session (user_id, ended_at, last_seen_at DESC)'
    )
    await tryDdl(
      'CREATE INDEX IF NOT EXISTS user_session_open_idx ON user_session (ended_at, last_seen_at DESC)'
    )
    return true
  })().catch((error) => {
    tableReady = null
    console.warn('User sessions are not available:', error.message)
    throw error
  })

  return tableReady
}

function sessionStatus(row, currentSessionId) {
  const ended = row.ENDED_AT != null
  const lastSeen = row.LAST_SEEN_AT ? new Date(row.LAST_SEEN_AT).getTime() : 0
  const active = !ended && lastSeen > 0 && Date.now() - lastSeen <= ACTIVE_WINDOW_MS
  return {
    ...row,
    STATUS: ended ? 'ENDED' : active ? 'ACTIVE' : 'INACTIVE',
    IS_CURRENT: !!currentSessionId && Number(row.USER_SESSION_ID) === Number(currentSessionId)
  }
}

async function loadActor(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const res = await query(
    `SELECT u.user_id, u.is_active, u.suspended_at, r.role_code
       FROM "user" u
       LEFT JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')

  return {
    userId: Number(row.USER_ID),
    isActive: row.IS_ACTIVE !== false,
    isSuspended: row.SUSPENDED_AT != null,
    roleCode: row.ROLE_CODE || null
  }
}

// The role and the global switch decide together whether other accounts'
// sessions may be read or ended. A Developer without the switch is treated like
// any other role: own sessions only.
async function managerRole(actor) {
  if (!actor.isActive) throw new Error('Not allowed: this account is deactivated.')
  if (actor.isSuspended) throw new Error('Not allowed: this account is suspended.')
  if (actor.roleCode === 'ADMIN') return 'ADMIN'
  if (actor.roleCode === 'DEVELOPER' && (await isDeveloperSessionManagementAllowed())) {
    return 'DEVELOPER'
  }
  throw new Error(
    'Not allowed: managing other accounts’ sessions requires the Admin role, or a Developer account the administrator has allowed in Settings.'
  )
}

// One session's row with the account it belongs to, for a permission check and
// the audit entry written after it is ended.
async function loadSession(sessionId) {
  const id = parseInt(sessionId, 10)
  if (!id) throw new Error('Choose a session.')

  const res = await query(
    `SELECT us.user_session_id, us.user_id, us.started_at, us.last_seen_at,
            us.ended_at, us.ended_by_user_id, us.end_reason,
            us.device_name, us.device_platform, us.app_version,
            u.user_username, u.user_email, u.is_active,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name
       FROM user_session us
       JOIN "user" u ON u.user_id = us.user_id
       LEFT JOIN person p ON p.person_id = u.person_id
      WHERE us.user_session_id = $1`,
    [id]
  )
  return res.data?.[0] || null
}

// Open a session for an account. The client details arrive from the main
// process (machine name, platform, application version), never from the page.
export async function startUserSession(userId, metadata = {}) {
  await ensureUserSessionTable()

  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const userRes = await query(
    'SELECT user_id, is_active, suspended_at FROM "user" WHERE user_id = $1',
    [id]
  )
  const user = userRes.data?.[0]
  if (!user) throw new Error('User not found.')
  if (user.IS_ACTIVE === false) throw new Error('This account is deactivated.')
  if (user.SUSPENDED_AT) throw new Error('This account is suspended.')

  const res = await query(
    `INSERT INTO user_session (user_id, device_name, device_platform, app_version)
     VALUES ($1, $2, $3, $4)
     RETURNING user_session_id, started_at`,
    [
      id,
      String(metadata.deviceName || '').slice(0, MAX_DEVICE_NAME) || null,
      String(metadata.devicePlatform || '').slice(0, MAX_PLATFORM) || null,
      String(metadata.appVersion || '').slice(0, MAX_APP_VERSION) || null
    ]
  )
  const row = res.data?.[0]
  return {
    success: true,
    sessionId: row?.USER_SESSION_ID,
    startedAt: row?.STARTED_AT || null
  }
}

// The signed-in window's pulse. Returns active:false when the session was ended
// elsewhere or the account can no longer use the application, so the renderer
// can sign the window out. A thrown error means the database could not be
// reached; the caller keeps the local session rather than treating an outage as
// a sign-out.
export async function heartbeatUserSession(userId, sessionId) {
  await ensureUserSessionTable()

  const id = parseInt(userId, 10)
  const session = parseInt(sessionId, 10)
  if (!id || !session) return { active: false, reason: 'UNKNOWN' }

  const res = await query(
    `SELECT us.user_session_id, us.ended_at, us.end_reason,
            u.user_id AS account_user_id, u.is_active, u.suspended_at
       FROM user_session us
       LEFT JOIN "user" u ON u.user_id = us.user_id
      WHERE us.user_session_id = $1 AND us.user_id = $2`,
    [session, id]
  )
  const row = res.data?.[0]
  if (!row) return { active: false, reason: 'UNKNOWN' }
  if (row.ENDED_AT != null) {
    return { active: false, reason: 'ENDED', endReason: row.END_REASON || null }
  }
  if (!row.ACCOUNT_USER_ID) return { active: false, reason: 'ACCOUNT_MISSING' }
  if (row.IS_ACTIVE === false) return { active: false, reason: 'ACCOUNT_INACTIVE' }
  if (row.SUSPENDED_AT != null) return { active: false, reason: 'ACCOUNT_SUSPENDED' }

  await query(
    'UPDATE user_session SET last_seen_at = CURRENT_TIMESTAMP WHERE user_session_id = $1',
    [session]
  )
  // The same pulse keeps the account's presence fresh for messaging, so the
  // old presence heartbeat is not needed separately.
  await query(
    'UPDATE "user" SET last_seen_at = CURRENT_TIMESTAMP WHERE user_id = $1',
    [id]
  )

  return { active: true, lastSeenAt: new Date().toISOString() }
}

// This account's sessions, newest activity first. `canManageAll` tells the page
// whether to offer the all-accounts tab; the server still re-checks it on every
// call that touches somebody else's session.
export async function getUserSessions(userId, currentSessionId = null) {
  await ensureUserSessionTable()
  const actor = await loadActor(userId)

  const res = await query(
    `SELECT us.user_session_id, us.user_id, us.started_at, us.last_seen_at,
            us.ended_at, us.ended_by_user_id, us.end_reason,
            us.device_name, us.device_platform, us.app_version,
            eu.user_username AS ended_by_username
       FROM user_session us
       LEFT JOIN "user" eu ON eu.user_id = us.ended_by_user_id
      WHERE us.user_id = $1
      ORDER BY (us.ended_at IS NULL) DESC, us.last_seen_at DESC
      LIMIT 100`,
    [actor.userId]
  )

  const sessions = (res.data || []).map((row) => sessionStatus(row, currentSessionId))
  return {
    success: true,
    sessions,
    canManageAll: actor.roleCode === 'ADMIN'
      || (actor.roleCode === 'DEVELOPER' && (await isDeveloperSessionManagementAllowed())),
    activeWindowMinutes: ACTIVE_WINDOW_MINUTES,
    roleCode: actor.roleCode
  }
}

// Every account's sessions, for an Admin or a permitted Developer. The search
// term matches the account, its person name, its role, the device and the
// application version; the status filter runs after the rows are read because
// "active" depends on last_seen_at.
export async function getAllUserSessions(userId, options = {}) {
  await ensureUserSessionTable()
  const actor = await loadActor(userId)
  await managerRole(actor)

  const term = String(options.search || '').trim().slice(0, 120)
  const like = `%${term}%`
  const res = await query(
    `SELECT us.user_session_id, us.user_id, us.started_at, us.last_seen_at,
            us.ended_at, us.ended_by_user_id, us.end_reason,
            us.device_name, us.device_platform, us.app_version,
            u.user_username, u.user_email, u.is_active,
            COALESCE(p.person_first_name_la, p.person_first_name_ar) AS person_first_name,
            p.person_first_name_la AS person_first_name_la,
            p.person_first_name_ar AS person_first_name_ar,
            COALESCE(p.person_last_name_la, p.person_last_name_ar) AS person_last_name,
            p.person_last_name_la AS person_last_name_la,
            p.person_last_name_ar AS person_last_name_ar,
            r.role_code,
            eu.user_username AS ended_by_username
       FROM user_session us
       JOIN "user" u ON u.user_id = us.user_id
       LEFT JOIN person p ON p.person_id = u.person_id
       LEFT JOIN "role" r ON r.role_id = u.role_id
       LEFT JOIN "user" eu ON eu.user_id = us.ended_by_user_id
      WHERE ($1 = ''
             OR u.user_username ILIKE $2
             OR COALESCE(p.person_first_name_la, p.person_first_name_ar) ILIKE $2
             OR COALESCE(p.person_last_name_la, p.person_last_name_ar) ILIKE $2
             OR r.role_code ILIKE $2
             OR us.device_name ILIKE $2
             OR us.device_platform ILIKE $2
             OR us.app_version ILIKE $2)
      ORDER BY (us.ended_at IS NULL) DESC, us.last_seen_at DESC
      LIMIT 500`,
    [term, like]
  )

  const status = String(options.status || '').toUpperCase()
  const sessions = (res.data || [])
    .map((row) => sessionStatus(row, options.currentSessionId))
    .filter((row) => !status || status === 'ALL' || row.STATUS === status)

  return {
    success: true,
    sessions,
    canManageAll: true,
    activeWindowMinutes: ACTIVE_WINDOW_MINUTES
  }
}

// End one session. Own sessions need no role; somebody else's needs the manager
// permission above. Ending an already ended session is not an error: two windows
// can click the same row and both should see it done.
export async function endUserSession(userId, sessionId) {
  await ensureUserSessionTable()
  const actor = await loadActor(userId)
  const target = await loadSession(sessionId)
  if (!target) throw new Error('Session not found.')

  const isOwn = Number(target.USER_ID) === actor.userId
  if (!isOwn) await managerRole(actor)

  if (target.ENDED_AT != null) {
    return { success: true, alreadyEnded: true, sessionId: Number(target.USER_SESSION_ID) }
  }

  const reason = isOwn
    ? 'SIGNED_OUT'
    : actor.roleCode === 'ADMIN'
      ? 'ENDED_BY_ADMIN'
      : 'ENDED_BY_DEVELOPER'

  const res = await query(
    `UPDATE user_session
        SET ended_at = CURRENT_TIMESTAMP,
            ended_by_user_id = $1,
            end_reason = $2
      WHERE user_session_id = $3 AND ended_at IS NULL
      RETURNING user_session_id`,
    [actor.userId, reason, Number(target.USER_SESSION_ID)]
  )
  if (!res.data?.length) {
    return { success: true, alreadyEnded: true, sessionId: Number(target.USER_SESSION_ID) }
  }

  if (!isOwn) {
    const name = [target.PERSON_FIRST_NAME, target.PERSON_LAST_NAME].filter(Boolean).join(' ')
      || target.USER_USERNAME
    await recordAudit({
      actorUserId: actor.userId,
      action: 'session.end',
      entityType: 'user',
      entityId: target.USER_ID,
      entityLabel: name,
      detail: {
        sessionId: Number(target.USER_SESSION_ID),
        targetUsername: target.USER_USERNAME,
        reason,
        device: target.DEVICE_NAME || null,
        platform: target.DEVICE_PLATFORM || null
      }
    })
  }

  return {
    success: true,
    sessionId: Number(target.USER_SESSION_ID),
    userId: Number(target.USER_ID),
    reason
  }
}

// End every other session of the signed-in account. Passing the current session
// id keeps the window making the request signed in.
export async function endOtherUserSessions(userId, currentSessionId = null) {
  await ensureUserSessionTable()
  const actor = await loadActor(userId)
  const exclude = parseInt(currentSessionId, 10) || 0

  const res = await query(
    `UPDATE user_session
        SET ended_at = CURRENT_TIMESTAMP,
            ended_by_user_id = $1,
            end_reason = 'SIGNED_OUT'
      WHERE user_id = $2
        AND ended_at IS NULL
        AND ($3 = 0 OR user_session_id <> $3)`,
    [actor.userId, actor.userId, exclude]
  )

  return { success: true, ended: res.rowCount || 0 }
}

// End every other open session on the installation. Admin (and a permitted
// Developer) may do this; the caller's own window is excluded so the request
// itself cannot lock the manager out mid-action. Ending your own window is
// possible individually from the row.
export async function endAllUserSessions(userId, currentSessionId = null) {
  await ensureUserSessionTable()
  const actor = await loadActor(userId)
  const role = await managerRole(actor)
  const exclude = parseInt(currentSessionId, 10) || 0

  const res = await query(
    `UPDATE user_session
        SET ended_at = CURRENT_TIMESTAMP,
            ended_by_user_id = $1,
            end_reason = $2
      WHERE ended_at IS NULL
        AND ($3 = 0 OR user_session_id <> $3)`,
    [actor.userId, role === 'ADMIN' ? 'ENDED_BY_ADMIN' : 'ENDED_BY_DEVELOPER', exclude]
  )

  if ((res.rowCount || 0) > 0) {
    await recordAudit({
      actorUserId: actor.userId,
      action: 'session.end',
      entityType: 'session',
      entityId: 'ALL',
      entityLabel: 'All other sessions',
      detail: {
        reason: role === 'ADMIN' ? 'ENDED_BY_ADMIN' : 'ENDED_BY_DEVELOPER',
        ended: res.rowCount || 0,
        excludedSessionId: exclude || null
      }
    })
  }

  return { success: true, ended: res.rowCount || 0 }
}
