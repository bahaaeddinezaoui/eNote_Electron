import { app } from 'electron'
import { join, dirname } from 'path'
import fs from 'fs'

// Deployment preset for an offline LAN installation.
//
// A workstation should not need an administrator to type the server address by
// hand. An administrator drops `deployment.json` in a machine-wide location and
// every user on that machine starts already pointed at the LAN database:
//
//   %PROGRAMDATA%\eNote\deployment.json
//
// The portable build also looks next to the executable, and a per-user copy in
// userData is accepted for testing. Environment variables win over the file, so
// a technician can override a bad preset without editing it:
//
//   ENOTE_DB_HOST, ENOTE_DB_PORT, ENOTE_DB_NAME, ENOTE_DB_USER,
//   ENOTE_DB_PASSWORD, ENOTE_DEPLOYMENT_FILE
//
// An explicit choice saved from the login screen (pg_config.json) is still
// tried before this preset, so a per-user override keeps working.

const FILE_NAME = 'deployment.json'
const MAX_PORT = 65535

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    console.warn(`Ignoring unreadable deployment preset ${file}:`, error.message)
    return null
  }
}

function candidateFiles() {
  const candidates = []
  if (process.env.ENOTE_DEPLOYMENT_FILE) candidates.push(process.env.ENOTE_DEPLOYMENT_FILE)
  if (process.env.ProgramData) candidates.push(join(process.env.ProgramData, 'eNote', FILE_NAME))
  try {
    candidates.push(join(dirname(app.getPath('exe')), FILE_NAME))
    candidates.push(join(app.getPath('userData'), FILE_NAME))
  } catch {
    // app paths are unavailable in a plain Node process (tests, scripts)
  }
  if (process.resourcesPath) candidates.push(join(process.resourcesPath, FILE_NAME))
  return [...new Set(candidates.filter(Boolean))]
}

function findPreset() {
  for (const file of candidateFiles()) {
    if (!fs.existsSync(file)) continue
    const data = readJson(file)
    if (data && typeof data === 'object') return { file, data }
  }
  return null
}

function numberOr(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 && number <= MAX_PORT ? number : fallback
}

export function getDeploymentInfo() {
  const preset = findPreset()
  const data = preset?.data || {}
  const host = process.env.ENOTE_DB_HOST || data.host
  const database = process.env.ENOTE_DB_NAME || data.database || 'eNote'
  const user = process.env.ENOTE_DB_USER || data.user || 'enote_app'
  const port = numberOr(process.env.ENOTE_DB_PORT || data.port, 5432)
  const password = process.env.ENOTE_DB_PASSWORD ?? data.password ?? ''
  // The share may be described flat or under `storage`; the account is the one
  // the machine signs in with to read \\SERVER\eNoteFiles (see smbShare.js).
  const storage = data.storage && typeof data.storage === 'object' ? data.storage : {}

  return {
    file: preset?.file || null,
    host: host ? String(host).trim() : null,
    port,
    database: String(database).trim(),
    user: String(user).trim(),
    password: String(password),
    ssl: Boolean(data.ssl),
    storageRoot: process.env.ENOTE_RESOURCE_ROOT || data.storageRoot || data.resourceRoot || storage.root || null,
    smbUser: process.env.ENOTE_SMB_USER || data.smbUser || storage.smbUser || null,
    smbPassword: process.env.ENOTE_SMB_PASSWORD ?? data.smbPassword ?? storage.smbPassword ?? ''
  }
}

// The connection preset, or null when this workstation has not been configured.
export function getDeploymentPgConfig() {
  const info = getDeploymentInfo()
  if (!info.host) return null
  return {
    host: info.host,
    port: info.port,
    database: info.database,
    user: info.user,
    password: info.password,
    ...(info.ssl ? { ssl: { rejectUnauthorized: false } } : {})
  }
}
