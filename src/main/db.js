import { Pool, types } from 'pg'
import { app } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { localizeRows, getLanguage } from './localization'
import { getLabelCatalog, clearLabelCatalog, invalidateLabelCatalogForSql } from './labelCatalog'
import { getDeploymentPgConfig } from './deployment'
import { cacheStats, getLastSyncAt, markServerContact, recallRead, rememberRead } from './offlineCache'

// bigint (int8) reaches node-postgres as a string. Registry keys are at most
// twelve digits — well inside Number.MAX_SAFE_INTEGER — so they are read back as
// numbers and every id comparison in the application keeps working. A value
// that would not survive the conversion stays a string rather than silently
// losing digits.
types.setTypeParser(20, (value) => {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : value
})

let pgPool = null
let initPromise = null
let currentPgConfig = null
let isDisconnecting = false

// ---- Reaching the server, and what happens when it is gone -----------------
//
// PostgreSQL is the only place records are written. When 192.214.23.15 stops
// answering, reads fall back to the local copy this workstation saved earlier
// (see offlineCache.js) and writes are refused with a sentence a person can
// act on. Nothing is queued and nothing is merged: two secretaries can never
// disagree about a record they both "saved" while disconnected.

// Errors that mean "the server did not answer", as opposed to "the server
// answered and refused the statement". Only the former may fall back to the
// cache; a constraint violation must reach the caller unchanged.
const OFFLINE_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08006' // connection_failure
])

const OFFLINE_NETWORK_PATTERN =
  /connection (?:terminated|refused|failure|error)|server closed the connection|timeout expired|the database is not connected|client has encountered a connection error|connect ETIMEDOUT|connecting to the database/i

// A dead server must fail like a dead server, not like a slow one: without a
// connect timeout every read would wait for the operating system's TCP retries
// (tens of seconds) before the cache could answer.
const CONNECT_TIMEOUT_MS = 4000
const CONNECT_COOLDOWN_MS = 15000
// A server that failed a moment ago is not asked again for every row of a page.
const OFFLINE_FAST_FAIL_MS = 10000

let connectCooldownUntil = 0
let offlineSince = null
let lastConnectionError = null

export const OFFLINE_ERROR_CODE = 'ENOTE_OFFLINE'

function offlineError(message, cause) {
  const error = new Error(message)
  error.code = OFFLINE_ERROR_CODE
  error.offline = true
  if (cause) error.cause = cause
  return error
}

// Shown to whoever tried to change a record while the server was away. The
// wording is deliberate: the change was NOT kept, so nobody assumes it is
// waiting somewhere and ready to appear later.
export function offlineWriteError(cause) {
  return offlineError(
    'The server is unreachable, so nothing was saved. Reconnect to the server and make the change again — offline changes are not queued.',
    cause
  )
}

// Shown when a page asks for something this computer has never loaded.
export function offlineReadError(cause) {
  return offlineError(
    'The server is unreachable and this record has not been saved on this computer yet. It will be available after one online visit to the page.',
    cause
  )
}

export function isConnectionError(error) {
  if (!error) return false
  if (error.code === OFFLINE_ERROR_CODE) return true
  const code = error.code || error.errno
  if (code && OFFLINE_NETWORK_CODES.has(String(code))) return true
  return OFFLINE_NETWORK_PATTERN.test(String(error.message || ''))
}

function markOffline(error) {
  if (!offlineSince) offlineSince = Date.now()
  if (error?.message) lastConnectionError = error.message
}

function markOnline() {
  if (offlineSince) {
    console.log('The server is reachable again; records are live.')
  }
  offlineSince = null
  lastConnectionError = null
}

export function isOffline() {
  return pgPool === null || offlineSince !== null
}

// What status screens report. `cache.entries` is what this workstation can
// still show, `lastSyncAt` is when those copies were last refreshed.
export function getOfflineState() {
  const cache = cacheStats()
  return {
    offline: isOffline(),
    since: offlineSince,
    error: lastConnectionError,
    lastSyncAt: cache.lastSyncAt || getLastSyncAt(),
    cache
  }
}

const cachedResult = (cached) => ({
  source: 'cache',
  data: cached.data,
  rowCount: cached.rowCount,
  cachedAt: cached.savedAt,
  stale: true
})

function normalizeRow(row) {
  const normalized = {}
  for (const key in row) {
    normalized[key.toUpperCase()] = row[key]
  }
  return normalized
}

// Labels are cached while reading; any write may change them, so the cache is
// dropped as soon as a statement other than SELECT runs (see labelCatalog.js).
// A statement is only cacheable when it cannot change anything. `WITH` starts
// plain queries and data-modifying ones alike, and a CTE write that returns rows
// must never be stored as if it were a read.
const SQL_WRITE_KEYWORDS =
  /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|call|copy|vacuum|analyze|refresh)\b/i
const isReadOnlySql = (sql) => {
  const statement = String(sql || '')
  if (!/^\s*(select|with|show|explain|values|table)\b/i.test(statement)) return false
  return !SQL_WRITE_KEYWORDS.test(statement)
}

// Raw, un-localized rows for the catalog builder. Never route this through
// query(): it must not recurse into catalog lookup.
async function runRaw(sql) {
  if (!pgPool) await initDb()
  if (!pgPool) throw new Error('The database is not connected.')
  const result = await pgPool.query(sql)
  return result.rows.map(normalizeRow)
}

async function localizeResultRows(rows) {
  // English rows are localized too: they carry the Arabic form in brackets.
  if (!Array.isArray(rows) || rows.length === 0) return rows
  const catalog = await getLabelCatalog(runRaw)
  return localizeRows(rows, catalog)
}

function getSavedPgConfigPath() {
  try {
    return join(app.getPath('userData'), 'pg_config.json')
  } catch (e) {
    return null
  }
}

export function getSavedPgConfig() {
  const path = getSavedPgConfigPath()
  if (path && fs.existsSync(path)) {
    try {
      const data = fs.readFileSync(path, 'utf8')
      return JSON.parse(data)
    } catch (e) {
      console.warn('Failed to parse saved pg_config.json:', e.message)
    }
  }
  return null
}

export function savePgConfig(config) {
  const path = getSavedPgConfigPath()
  if (path) {
    try {
      fs.writeFileSync(path, JSON.stringify(config, null, 2), 'utf8')
    } catch (e) {
      console.warn('Failed to save pg_config.json:', e.message)
    }
  }
}

// The connection currently in use. Only the main process reads it; status
// screens receive the endpoint fields, never the password.
export function getActivePgConfig() {
  return currentPgConfig ? { ...currentPgConfig } : null
}

export async function connectPostgres(config) {
  try {
    if (pgPool) {
      await pgPool.end().catch(() => {})
    }

    const testPool = new Pool({
      ...config,
      connectionTimeoutMillis: config.connectionTimeoutMillis ?? CONNECT_TIMEOUT_MS,
      application_name: config.application_name || 'eNote'
    })
    await testPool.query('SELECT NOW()')

    pgPool = testPool
    currentPgConfig = { ...config }
    connectCooldownUntil = 0
    markOnline()
    clearLabelCatalog()
    refreshNotificationListener()
    savePgConfig(config)

    console.log('Connected successfully to PostgreSQL database:', config.database || 'eNote')
    return { success: true, config: currentPgConfig }
  } catch (error) {
    console.error('PostgreSQL connection error:', error.message)
    pgPool = null
    connectCooldownUntil = Date.now() + CONNECT_COOLDOWN_MS
    markOffline(error)
    return { success: false, error: error.message }
  }
}

export function isPostgresConnected() {
  return pgPool !== null
}

export async function disconnectPostgres() {
  if (isDisconnecting || !pgPool) {
    return { success: true }
  }
  
  isDisconnecting = true
  
  try {
    await pgPool.end()
    pgPool = null
    console.log('Disconnected from PostgreSQL')
  } catch (error) {
    console.error('Error closing PostgreSQL pool:', error)
  } finally {
    isDisconnecting = false
  }
  
  return { success: true }
}

// Retry the saved connection after the database service has restarted. This is
// the action behind the "Records unavailable" chip, so a local PostgreSQL
// restart does not require quitting the application.
export async function reconnectPostgres() {
  initPromise = null
  // A person asked for this attempt, so it runs now however recently the last
  // one failed.
  connectCooldownUntil = 0
  const saved = getSavedPgConfig()
  if (saved) return connectPostgres(saved)
  const deployment = getDeploymentPgConfig()
  if (deployment) return connectPostgres(deployment)
  return { success: false, error: 'No saved database configuration' }
}

export async function initDb() {
  if (pgPool) return pgPool
  if (initPromise) return initPromise
  // While the server is away, do not make every page pay for another failed
  // connection attempt: the cached work answers immediately instead.
  if (Date.now() < connectCooldownUntil) return null

  initPromise = (async () => {
    // 1. Try saved config first
    const saved = getSavedPgConfig()
    if (saved) {
      const res = await connectPostgres(saved)
      if (res.success) return pgPool
    }

    // 2. Then the machine-wide LAN preset. If one exists, this workstation is
    // meant to talk to that server and nowhere else: do not fall through to
    // localhost or to guessed passwords after it fails. The sign-in screen
    // offers the connection panel, and the error names the unreachable host.
    const deployment = getDeploymentPgConfig()
    if (deployment) {
      const res = await connectPostgres(deployment)
      if (res.success) return pgPool
      console.warn(`Deployment database ${deployment.host}:${deployment.port} is not reachable.`)
      return null
    }

    // 3. Explicit environment configuration. A technician can point one
    // workstation at a server with PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD
    // without writing a deployment preset. Passwords are never guessed: a
    // wrong one must surface as a connection error, never as a silent
    // connection to a different database.
    const envHost = String(process.env.PGHOST || '').trim()
    if (!envHost) {
      console.warn(
        'No database configured on this workstation. Set a deployment preset or use Server settings on the sign-in screen.'
      )
      return null
    }

    const envConfig = {
      user: process.env.PGUSER || 'postgres',
      host: envHost,
      database: process.env.PGDATABASE || 'eNote',
      port: parseInt(process.env.PGPORT || '5432', 10),
      password: process.env.PGPASSWORD ?? ''
    }

    const res = await connectPostgres(envConfig)
    if (res.success) return pgPool

    console.warn(`Environment database ${envConfig.host}:${envConfig.port} is not reachable.`)
    return null
  })()

  try {
    return await initPromise
  } finally {
    initPromise = null
  }
}


export async function query(sql, params = []) {
  const readOnly = isReadOnlySql(sql)

  // Just after a failure the saved copy answers immediately: a page that fires
  // twenty queries would otherwise wait for twenty connection timeouts.
  if (offlineSince && Date.now() - offlineSince < OFFLINE_FAST_FAIL_MS) {
    if (readOnly) {
      const cached = recallRead(sql, params)
      if (cached) return cachedResult(cached)
      throw offlineReadError()
    }
    throw offlineWriteError()
  }

  if (!pgPool) {
    await initDb()
  }

  if (!pgPool) {
    markOffline(new Error('The database is not connected.'))
    if (readOnly) {
      const cached = recallRead(sql, params)
      if (cached) return cachedResult(cached)
      throw offlineReadError()
    }
    throw offlineWriteError()
  }

  try {
    const result = await pgPool.query(sql, params)
    markServerContact()
    markOnline()

    if (Array.isArray(result.rows)) {
      const rows = result.rows.map(normalizeRow)
      // The localized rows are what the cache stores: an offline window must
      // show the same labels the online one did, in the language it was read in.
      const data = readOnly ? await localizeResultRows(rows) : rows
      if (readOnly) rememberRead(sql, params, data, result.rowCount)
      else invalidateLabelCatalogForSql(sql)
      return { source: 'postgres', data, rowCount: result.rowCount }
    }

    if (!readOnly) invalidateLabelCatalogForSql(sql)
    return { source: 'postgres', data: [], rowCount: result.rowCount || 0 }
  } catch (error) {
    if (!isConnectionError(error)) {
      console.error('PostgreSQL query error:', error.message, '| SQL:', sql)
      throw error
    }

    markOffline(error)
    if (readOnly) {
      const cached = recallRead(sql, params)
      if (cached) {
        console.warn('Serving a saved copy while the server is unreachable:', error.message)
        return cachedResult(cached)
      }
    }
    console.error('PostgreSQL query error:', error.message, '| SQL:', sql)
    throw readOnly ? offlineReadError(error) : offlineWriteError(error)
  }
}

// Run several statements in a single PostgreSQL transaction. `fn` receives
// a `tx` function with the same signature as `query`, but targeting the
// transaction client. If `fn` throws (or its returned promise rejects), the
// transaction is rolled back and the error re-raised; otherwise COMMIT.
export async function withTransaction(fn) {
  if (offlineSince && Date.now() - offlineSince < OFFLINE_FAST_FAIL_MS) {
    throw offlineWriteError()
  }
  if (!pgPool) {
    await initDb()
  }
  if (!pgPool) {
    markOffline(new Error('The database is not connected.'))
    throw offlineWriteError()
  }

  let client
  try {
    client = await pgPool.connect()
  } catch (error) {
    if (isConnectionError(error)) {
      markOffline(error)
      throw offlineWriteError(error)
    }
    throw error
  }

  const tx = async (sql, params = []) => {
    const result = await client.query(sql, params)
    const rows = result.rows.map(normalizeRow)
    const readOnly = isReadOnlySql(sql)
    const data = readOnly ? await localizeResultRows(rows) : rows
    if (!readOnly) invalidateLabelCatalogForSql(sql)
    return { source: 'postgres', data, rowCount: result.rowCount }
  }

  try {
    await client.query('BEGIN')
    const result = await fn(tx)
    await client.query('COMMIT')
    markServerContact()
    markOnline()
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* connection already broken */ }
    // A transaction that lost its connection is not "partly saved": the
    // server rolled it back, and the caller must be told nothing was kept.
    if (isConnectionError(error)) {
      markOffline(error)
      throw offlineWriteError(error)
    }
    throw error
  } finally {
    client.release()
  }
}

// ---- Live notifications -----------------------------------------------------
// PostgreSQL LISTEN on a dedicated client, so the app learns about a new
// notification the moment the trigger writes it instead of polling. The client
// is kept apart from the pool's query connections and re-established if the
// database reconnects.

let listenerClient = null
let listenerHandler = null
let listenerRetry = null

function releaseListenerClient() {
  if (!listenerClient) return
  try {
    listenerClient.release(true)
  } catch {
    /* the connection may already be gone */
  }
  listenerClient = null
}

function scheduleListenerRetry() {
  if (listenerRetry || !listenerHandler) return
  listenerRetry = setTimeout(() => {
    listenerRetry = null
    ensureListener().catch(() => {})
  }, 5000)
  if (typeof listenerRetry.unref === 'function') listenerRetry.unref()
}

async function ensureListener() {
  if (!listenerHandler || listenerClient) return
  if (!pgPool) {
    try {
      await initDb()
    } catch {
      /* reported by the caller's own queries */
    }
  }
  if (!pgPool) {
    scheduleListenerRetry()
    return
  }

  try {
    const client = await pgPool.connect()
    client.on('notification', (msg) => {
      if (msg.channel !== 'app_notification' || !msg.payload) return
      try {
        listenerHandler?.(msg.payload)
      } catch (err) {
        console.warn('Notification handler failed:', err.message)
      }
    })
    client.on('error', (err) => {
      console.warn('Notification listener error:', err.message)
      listenerClient = null
      try {
        client.release(true)
      } catch {
        /* already closed */
      }
      scheduleListenerRetry()
    })
    await client.query('LISTEN app_notification')
    listenerClient = client
  } catch (err) {
    console.warn('Could not start the notification listener:', err.message)
    scheduleListenerRetry()
  }
}

// Starts (or restarts) the live notification feed. The handler receives the
// channel payload, e.g. "ABSENCE:3:28".
export async function listenForNotifications(handler) {
  listenerHandler = handler
  releaseListenerClient()
  await ensureListener()
}

// Re-establishes the LISTEN after a new database connection (the old client
// belongs to the previous pool).
export function refreshNotificationListener() {
  releaseListenerClient()
  if (listenerHandler) ensureListener().catch(() => {})
}

export function stopNotificationListener() {
  listenerHandler = null
  if (listenerRetry) {
    clearTimeout(listenerRetry)
    listenerRetry = null
  }
  releaseListenerClient()
}

export async function closeDb() {
  stopNotificationListener()
  await disconnectPostgres()
}
