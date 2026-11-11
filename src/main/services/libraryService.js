import { isOffline, query } from '../db'
import { tryDdl } from '../sqlGuards'
import { app, dialog, shell } from 'electron'
import { join, basename, extname, sep } from 'path'
import fs from 'fs'
import { resourceDir, newResourceFile, resourceFileName, moveResourceFile, resolveStoredResource, toStoredKey } from './resourceStorage'
import { extensionOf, isVideoPath, mimeTypeFor } from './documentService'
import { recallOfflineFile, removeOfflineFile, saveOfflineFile } from '../offlineFiles'
import { recordAudit } from './auditService'
import {
  notifyLibraryReviewDecision,
  notifyLibraryReviewRequested,
  settleLibraryReviewRequests
} from './notificationScanService'

// The Library — books, novels, lessons and videos that belong to the school
// rather than to one lesson in the curriculum.
//
// A Library document is always a file. Its row keeps the catalogue entry and a
// key to the stored file; the renderer never sees a path. Videos are streamed
// through `library-media://media/<id>` (see main/index.js), so seeking works
// and the window never reads the disk itself.
//
// On disk the catalogue is mirrored as
//
//   library/<TYPE_CODE>/<CATEGORY_CODE>/
//           <TYPE>_<CATEGORY>_<title>_<original name>_<timestamp>
//
// so an administrator can find a book on the share without opening the app, and
// a file copied out of its folder still names its shelf and title.
//
// Two rules shape the service:
//   1. Nothing reaches students or other teachers until an Admin has reviewed
//      it. A submission is PENDING; only an Admin (or Developer, who maintains
//      the installation) may publish or reject it. Admins may switch the review
//      requirement off in Settings, but it is on by default.
//   2. The Admin's Settings decide the restrictions: whether the Library takes
//      uploads at all, whether teachers may add documents, whether students may
//      download, whether a category is mandatory, and the largest file allowed.
//
// The tables are created on first use, like document_access, so an existing
// installation needs no manual migration. A schema that is already complete is
// used without any DDL: creating a table asks for CREATE on the schema even when
// the table already exists, and a restored database is often used by a role
// that has the data privileges but not that one. Only a genuinely missing table
// asks for DDL, and a failure there is reported instead of presenting an empty
// library.

const LIBRARY_DEFAULTS = {
  library_uploads_enabled: '1',
  library_teacher_uploads_enabled: '1',
  library_review_required: '1',
  library_student_downloads: '1',
  library_require_category: '1',
  library_max_file_mb: '512'
}

export const LIBRARY_TYPE_CODES = ['BOOK', 'NOVEL', 'LESSON', 'VIDEO']
export const LIBRARY_AUDIENCE_CODES = ['EVERYONE', 'TEACHERS', 'STUDENTS']
export const LIBRARY_STATUS_CODES = ['PENDING', 'PUBLISHED', 'REJECTED', 'ARCHIVED']

// Roles that look after the school rather than one major. They see the whole
// catalogue and the review queue; a teacher and a student see only what has
// been published to them.
const LIBRARIAN_ROLES = ['ADMIN', 'DEVELOPER']
const OVERSIGHT_ROLES = ['DIRECTOR']
const STUDENT_DOWNLOAD_BLOCKED = 'Students are not allowed to download library documents. Ask an administrator to allow it.'

// Files that must never be handed to the operating system from a library
// upload. Documents, images, audio, video and archives are what a school puts
// on a shelf; an executable is not a book.
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'reg', 'dll', 'cpl', 'hta', 'jar', 'app', 'deb', 'rpm'
])

const MAX_TITLE = 240
const MAX_DESCRIPTION = 4000

let tablesReady = null

const libraryDir = () => resourceDir('library')

// Are all three Library tables already in place? Asking the catalogue first is
// what lets a data-only database role open the page; see the note above.
async function libraryTablesExist() {
  const res = await query(
    `SELECT (
       to_regclass('public.library_category') IS NOT NULL
       AND to_regclass('public.library_item') IS NOT NULL
       AND to_regclass('public.library_access') IS NOT NULL
     ) AS present`
  )
  return res.data?.[0]?.PRESENT === true
}

async function ensureLibraryTables() {
  if (tablesReady) return tablesReady

  tablesReady = (async () => {
    if (!(await libraryTablesExist())) {
      await query(`
        CREATE TABLE IF NOT EXISTS library_category (
          library_category_id bigserial PRIMARY KEY,
          category_code character varying(48) NOT NULL UNIQUE,
          label_en character varying(120) NOT NULL,
          label_ar character varying(120),
          label_fr character varying(120),
          sort_order integer NOT NULL DEFAULT 0,
          is_active boolean NOT NULL DEFAULT true,
          created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)

      await query(`
        CREATE TABLE IF NOT EXISTS library_item (
          library_item_id bigserial PRIMARY KEY,
          title character varying(240) NOT NULL,
          description text,
          item_type_code character varying(16) NOT NULL DEFAULT 'BOOK',
          library_category_id bigint,
          file_path text NOT NULL,
          file_name text,
          file_extension character varying(16),
          file_size bigint NOT NULL DEFAULT 0,
          mime_type character varying(160),
          uploaded_by_user_id integer,
          audience_code character varying(16) NOT NULL DEFAULT 'EVERYONE',
          status_code character varying(16) NOT NULL DEFAULT 'PENDING',
          review_note text,
          reviewed_by_user_id integer,
          reviewed_at timestamp without time zone,
          published_at timestamp without time zone,
          created_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)

      await query(`
        CREATE TABLE IF NOT EXISTS library_access (
          library_access_id bigserial PRIMARY KEY,
          library_item_id integer NOT NULL,
          user_id integer,
          access_kind character varying(16) NOT NULL DEFAULT 'OPEN',
          accessed_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `)
    }

    // Indexes are a convenience, not a requirement, and PostgreSQL only lets
    // the table's owner create one. On a database initialized by postgres and
    // used by enote_app these are skipped instead of closing the Library.
    await tryDdl('CREATE INDEX IF NOT EXISTS library_item_status_idx ON library_item (status_code, created_at DESC)')
    await tryDdl('CREATE INDEX IF NOT EXISTS library_item_category_idx ON library_item (library_category_id)')
    await tryDdl('CREATE INDEX IF NOT EXISTS library_item_uploader_idx ON library_item (uploaded_by_user_id)')
    await tryDdl('CREATE INDEX IF NOT EXISTS library_access_item_idx ON library_access (library_item_id, accessed_at DESC)')

    // One default shelf so an upload never fails on a fresh installation. An
    // Admin renames it, adds the school's own categories and archives this one.
    // A role that may read the catalogue but not write it still opens the
    // Library; the missing default is only a convenience.
    try {
      await query(`
        INSERT INTO library_category (category_code, label_en, label_ar, label_fr, sort_order)
        VALUES ('GENERAL', 'General', 'عام', 'Général', 0)
        ON CONFLICT (category_code) DO NOTHING
      `)
    } catch (error) {
      // The default shelf is a convenience: a schema that cannot take it must
      // still open so its existing categories and documents are reachable.
      console.warn('Could not seed the default Library category:', error.message)
    }
    return true
  })().catch((error) => {
    console.warn('The Library tables are not available:', error.message)
    tablesReady = null
    throw new Error(`The Library could not be opened: ${error.message}`)
  })

  return tablesReady
}

// ---- The account behind a request ------------------------------------------
// The role and person are read from the database, never trusted from the
// window, exactly as the lesson library does.
async function callerIdentity(userId) {
  const id = parseInt(userId, 10)
  if (!id) return null
  const res = await query(
    `SELECT u.user_id, u.person_id, r.role_code
       FROM "user" u
       LEFT JOIN "role" r ON r.role_id = u.role_id
      WHERE u.user_id = $1`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) return null
  const roleCode = row.ROLE_CODE || ''
  return {
    userId: row.USER_ID,
    personId: row.PERSON_ID,
    roleCode,
    isLibrarian: LIBRARIAN_ROLES.includes(roleCode),
    isOversight: OVERSIGHT_ROLES.includes(roleCode),
    isTeacher: roleCode === 'TEACHER',
    isStudent: roleCode === 'STUDENT'
  }
}

// ---- The Admin's restrictions ---------------------------------------------
// Every reader treats a missing row as its documented default, so a fresh
// installation and an installation whose Admin never opened Settings behave the
// same way. `maxFileMb` is clamped to something a share can actually take.
export async function getLibraryPolicy() {
  let stored = {}
  try {
    const res = await query(
      `SELECT option_key, option_value FROM app_option
        WHERE option_key IN (
          'library_uploads_enabled', 'library_teacher_uploads_enabled',
          'library_review_required', 'library_student_downloads',
          'library_require_category', 'library_max_file_mb'
        )`
    )
    stored = Object.fromEntries((res.data || []).map((row) => [row.OPTION_KEY, row.OPTION_VALUE]))
  } catch (error) {
    console.warn('Could not read the Library settings:', error.message)
  }

  const value = (key) => String(stored[key] ?? LIBRARY_DEFAULTS[key])
  const on = (key) => ['1', 'true', 'on'].includes(value(key).toLowerCase())
  const maxFileMb = Math.min(Math.max(parseInt(value('library_max_file_mb'), 10) || 512, 1), 4096)

  return {
    uploadsEnabled: on('library_uploads_enabled'),
    teacherUploadsEnabled: on('library_teacher_uploads_enabled'),
    reviewRequired: on('library_review_required'),
    studentDownloads: on('library_student_downloads'),
    requireCategory: on('library_require_category'),
    maxFileMb
  }
}

// ---- Reading scope ---------------------------------------------------------
// Built as SQL so the catalogue never even leaves the database for rows the
// account may not see.
const readScopeSql = (identity, startIndex = 0) => {
  if (!identity) return { sql: 'FALSE', params: [] }
  if (identity.isLibrarian || identity.isOversight) return { sql: 'TRUE', params: [] }

  const params = [identity.userId]
  const own = `li.uploaded_by_user_id = $${startIndex + 1}`

  if (identity.isTeacher) {
    return {
      sql: `(${own} OR (li.status_code = 'PUBLISHED' AND li.audience_code IN ('EVERYONE', 'TEACHERS')))`,
      params
    }
  }
  if (identity.isStudent) {
    // A student has no "own uploads" clause, so this scope binds no parameter.
    // Passing one anyway would make PostgreSQL reject the statement.
    return {
      sql: `(li.status_code = 'PUBLISHED' AND li.audience_code IN ('EVERYONE', 'STUDENTS'))`,
      params: []
    }
  }
  return { sql: 'FALSE', params: [] }
}

const ITEM_SELECT = `
  SELECT li.*,
         c.category_code,
         c.label_en AS category_label_en,
         c.label_ar AS category_label_ar,
         c.label_fr AS category_label_fr,
         u.user_username AS uploader_username,
         COALESCE(
           NULLIF(TRIM(COALESCE(p.person_first_name_la, p.person_first_name_ar, '') || ' ' ||
                       COALESCE(p.person_last_name_la, p.person_last_name_ar, '')), ''),
           u.user_username
         ) AS uploader_name,
         COALESCE(
           NULLIF(TRIM(COALESCE(rp.person_first_name_la, rp.person_first_name_ar, '') || ' ' ||
                       COALESCE(rp.person_last_name_la, rp.person_last_name_ar, '')), ''),
           ru.user_username
         ) AS reviewer_name,
         (SELECT count(*)::int FROM library_access la
           WHERE la.library_item_id = li.library_item_id
             AND la.access_kind IN ('OPEN', 'PLAY')) AS view_count,
         (SELECT count(*)::int FROM library_access la
           WHERE la.library_item_id = li.library_item_id
             AND la.access_kind = 'DOWNLOAD') AS download_count
    FROM library_item li
    LEFT JOIN library_category c ON c.library_category_id = li.library_category_id
    LEFT JOIN "user" u ON u.user_id = li.uploaded_by_user_id
    LEFT JOIN person p ON p.person_id = u.person_id
    LEFT JOIN "user" ru ON ru.user_id = li.reviewed_by_user_id
    LEFT JOIN person rp ON rp.person_id = ru.person_id`

const MEDIA_GRANT_MS = 6 * 60 * 60 * 1000
const mediaGrants = new Map()

const grantLibraryMedia = (items) => {
  const until = Date.now() + MEDIA_GRANT_MS
  for (const item of items || []) {
    const id = String(item?.LIBRARY_ITEM_ID ?? '')
    if (id) mediaGrants.set(id, until)
  }
}

export function hasLibraryMediaGrant(id) {
  const key = String(id ?? '')
  const until = mediaGrants.get(key)
  if (!until) return false
  if (until < Date.now()) {
    mediaGrants.delete(key)
    return false
  }
  return true
}

// A second reader for the same scope: opening, playing and downloading ask
// about one row, and the answer must match what the listing showed.
export async function canReadLibraryItem(userId, itemId) {
  const id = parseInt(itemId, 10)
  if (!id) return false
  const identity = await callerIdentity(userId)
  if (!identity) return false

  const res = await query(
    'SELECT library_item_id, status_code, audience_code, uploaded_by_user_id FROM library_item WHERE library_item_id = $1',
    [id]
  )
  const item = res.data?.[0]
  if (!item) return false

  if (identity.isLibrarian || identity.isOversight) return true
  if (identity.isTeacher) {
    if (String(item.UPLOADED_BY_USER_ID) === String(identity.userId)) return true
    return item.STATUS_CODE === 'PUBLISHED' && ['EVERYONE', 'TEACHERS'].includes(item.AUDIENCE_CODE)
  }
  if (identity.isStudent) {
    return item.STATUS_CODE === 'PUBLISHED' && ['EVERYONE', 'STUDENTS'].includes(item.AUDIENCE_CODE)
  }
  return false
}

// ---- Categories ------------------------------------------------------------
export async function getLibraryCategories(userId) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  const includeInactive = !!identity?.isLibrarian

  const res = await query(`
    SELECT c.*,
           (SELECT count(*)::int FROM library_item li
             WHERE li.library_category_id = c.library_category_id) AS item_count
      FROM library_category c
     ${includeInactive ? '' : 'WHERE c.is_active = TRUE'}
     ORDER BY c.sort_order, c.label_en`)
  return { data: res.data || [] }
}

const codeFromLabel = (label, taken) => {
  const base = String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 40) || 'CATEGORY'
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}_${n}`)) n += 1
  return `${base}_${n}`
}

export async function createLibraryCategory(userId, data = {}) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity?.isLibrarian) return { error: 'Only an administrator may manage library categories.' }

  const labelEn = String(data.labelEn || '').trim()
  if (labelEn.length < 2) return { error: 'Enter a name for the category.' }

  const existing = await query('SELECT category_code FROM library_category')
  const taken = new Set((existing.data || []).map((row) => row.CATEGORY_CODE))
  const sortRes = await query('SELECT COALESCE(max(sort_order), 0) + 10 AS next_order FROM library_category')
  const sortOrder = parseInt(sortRes.data?.[0]?.NEXT_ORDER, 10) || 10

  const res = await query(`
    INSERT INTO library_category (category_code, label_en, label_ar, label_fr, sort_order)
    VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      codeFromLabel(labelEn, taken),
      labelEn,
      String(data.labelAr || '').trim() || null,
      String(data.labelFr || '').trim() || null,
      sortOrder
    ]
  )

  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.category_change',
    entityType: 'library_category',
    entityId: res.data?.[0]?.LIBRARY_CATEGORY_ID,
    entityLabel: labelEn,
    changes: { created: { before: null, after: labelEn } }
  })
  return { data: res.data?.[0] }
}

export async function updateLibraryCategory(userId, categoryId, data = {}) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity?.isLibrarian) return { error: 'Only an administrator may manage library categories.' }

  const id = parseInt(categoryId, 10)
  if (!id) return { error: 'Unknown category.' }

  const labelEn = String(data.labelEn || '').trim()
  if (labelEn.length < 2) return { error: 'Enter a name for the category.' }

  const res = await query(`
    UPDATE library_category
       SET label_en = $1, label_ar = $2, label_fr = $3, is_active = $4
     WHERE library_category_id = $5
     RETURNING *`,
    [
      labelEn,
      String(data.labelAr || '').trim() || null,
      String(data.labelFr || '').trim() || null,
      data.isActive === undefined ? true : !!data.isActive,
      id
    ]
  )
  if (!res.data?.length) return { error: 'That category no longer exists.' }

  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.category_change',
    entityType: 'library_category',
    entityId: id,
    entityLabel: labelEn,
    changes: { label_en: { before: null, after: labelEn } }
  })
  return { data: res.data[0] }
}

export async function deleteLibraryCategory(userId, categoryId) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity?.isLibrarian) return { error: 'Only an administrator may manage library categories.' }

  const id = parseInt(categoryId, 10)
  if (!id) return { error: 'Unknown category.' }

  const used = await query('SELECT count(*)::int AS used FROM library_item WHERE library_category_id = $1', [id])
  if ((used.data?.[0]?.USED || 0) > 0) {
    return { error: 'This category still files documents. Move them to another category, or archive it instead.' }
  }

  const res = await query('DELETE FROM library_category WHERE library_category_id = $1 RETURNING label_en', [id])
  if (!res.data?.length) return { error: 'That category no longer exists.' }

  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.category_change',
    entityType: 'library_category',
    entityId: id,
    entityLabel: res.data[0].LABEL_EN,
    changes: { deleted: { before: res.data[0].LABEL_EN, after: null } }
  })
  return { success: true }
}

// ---- The catalogue ---------------------------------------------------------
export async function getLibraryItems(userId) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity) return { data: [], error: 'Sign in again to open the Library.' }

  const scope = readScopeSql(identity)
  const res = await query(
    `${ITEM_SELECT} WHERE ${scope.sql} ORDER BY li.created_at DESC`,
    scope.params
  )
  const data = res.data || []
  grantLibraryMedia(data)
  return { ...res, data }
}

// ---- Review queue and monitoring ------------------------------------------
export async function getLibraryReviewQueue(userId) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity?.isLibrarian) {
    return { data: [], error: 'Only an administrator may review library documents.' }
  }

  const [pendingRes, statsRes, accessRes] = await Promise.all([
    query(`${ITEM_SELECT} WHERE li.status_code = 'PENDING' ORDER BY li.created_at ASC`),
    query(`
      SELECT
        (count(*) FILTER (WHERE status_code = 'PENDING'))::int AS pending,
        (count(*) FILTER (WHERE status_code = 'PUBLISHED'))::int AS published,
        (count(*) FILTER (WHERE status_code = 'REJECTED'))::int AS rejected,
        (count(*) FILTER (WHERE status_code = 'ARCHIVED'))::int AS archived,
        COALESCE(sum(file_size), 0)::bigint AS storage
      FROM library_item`),
    query(`
      SELECT la.access_kind, la.accessed_at, li.title,
             COALESCE(
               NULLIF(TRIM(COALESCE(p.person_first_name_la, p.person_first_name_ar, '') || ' ' ||
                           COALESCE(p.person_last_name_la, p.person_last_name_ar, '')), ''),
               u.user_username
             ) AS reader_name
        FROM library_access la
        JOIN library_item li ON li.library_item_id = la.library_item_id
        LEFT JOIN "user" u ON u.user_id = la.user_id
        LEFT JOIN person p ON p.person_id = u.person_id
       ORDER BY la.accessed_at DESC
       LIMIT 10`)
  ])

  const stats = statsRes.data?.[0] || {}
  const pending = pendingRes.data || []
  grantLibraryMedia(pending)

  return {
    data: pending,
    stats: {
      pending: stats.PENDING || 0,
      published: stats.PUBLISHED || 0,
      rejected: stats.REJECTED || 0,
      archived: stats.ARCHIVED || 0,
      storage: Number(stats.STORAGE) || 0
    },
    recentActivity: accessRes.data || []
  }
}

// A light reader for the sidebar badge and the Overview work queue: the number
// of submissions waiting for an administrator, without the queue itself.
export async function getLibraryReviewCount(userId) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity?.isLibrarian) return { pending: 0 }

  const res = await query(
    "SELECT count(*)::int AS pending FROM library_item WHERE status_code = 'PENDING'"
  )
  return { pending: res.data?.[0]?.PENDING || 0 }
}

// ---- Upload ----------------------------------------------------------------
const normaliseType = (value, fileName) => {
  const asked = String(value || '').toUpperCase()
  const video = isVideoPath(fileName)
  if (video) return 'VIDEO'
  if (asked === 'VIDEO') return null
  return LIBRARY_TYPE_CODES.includes(asked) && asked !== 'VIDEO' ? asked : 'BOOK'
}

const validTitle = (value) => {
  const title = String(value || '').trim()
  if (title.length < 2) return null
  return title.slice(0, MAX_TITLE)
}

const validDescription = (value) => {
  const text = String(value || '').trim()
  return text ? text.slice(0, MAX_DESCRIPTION) : null
}

const normaliseAudience = (value) =>
  LIBRARY_AUDIENCE_CODES.includes(String(value || '').toUpperCase())
    ? String(value).toUpperCase()
    : 'EVERYONE'

export async function uploadLibraryItem(userId, filePath, metadata = {}) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity) return { error: 'Sign in again before adding a document.' }

  const policy = await getLibraryPolicy()
  if (!policy.uploadsEnabled) return { error: 'The Library is closed for uploads. An administrator has turned uploads off.' }
  if (!identity.isLibrarian) {
    if (!identity.isTeacher) return { error: 'Only a teacher or an administrator may add a document to the Library.' }
    if (!policy.teacherUploadsEnabled) return { error: 'Teachers cannot add documents right now. An administrator has turned teacher uploads off.' }
  }

  const title = validTitle(metadata.title)
  if (!title) return { error: 'Enter a title of at least two characters.' }

  const source = String(filePath || '').trim()
  if (!source || !fs.existsSync(source)) return { error: 'Choose a file to add.' }

  const fileName = basename(source)
  const extension = extensionOf(fileName)
  if (BLOCKED_EXTENSIONS.has(extension)) {
    return { error: 'That kind of file cannot be added to the Library.' }
  }

  const typeCode = normaliseType(metadata.typeCode, fileName)
  if (!typeCode) return { error: 'Choose a video file for a video document.' }

  const stats = fs.statSync(source)
  if (!stats.isFile()) return { error: 'Choose a file, not a folder.' }
  if (stats.size > policy.maxFileMb * 1024 * 1024) {
    return { error: `That file is larger than the ${policy.maxFileMb} MB limit. Ask an administrator to raise it in Settings.` }
  }

  let categoryId = parseInt(metadata.categoryId, 10) || null
  let categoryCode = 'UNCATEGORISED'
  if (policy.requireCategory && !categoryId) {
    return { error: 'Choose a category for this document.' }
  }
  if (categoryId) {
    const categoryRes = await query(
      'SELECT library_category_id, category_code, is_active FROM library_category WHERE library_category_id = $1',
      [categoryId]
    )
    const category = categoryRes.data?.[0]
    if (!category || !category.IS_ACTIVE) {
      return { error: 'That category is not available. Choose another one.' }
    }
    categoryCode = category.CATEGORY_CODE || categoryCode
  } else {
    categoryId = null
  }

  // The shelf on disk mirrors the catalogue, and the stored name repeats it so
  // a file copied out of the share still says what it is:
  //   library/<TYPE_CODE>/<CATEGORY_CODE>/<TYPE>_<CATEGORY>_<title>_<file>_<timestamp>
  const sourceExtension = extname(fileName)
  const originalStem = sourceExtension ? fileName.slice(0, -sourceExtension.length) : fileName
  const storedName = resourceFileName(
    [typeCode, categoryCode, title, originalStem],
    sourceExtension
  )
  const destination = newResourceFile('library', [typeCode, categoryCode], storedName)

  fs.copyFileSync(source, destination)

  const status = policy.reviewRequired ? 'PENDING' : 'PUBLISHED'
  const res = await query(`
    INSERT INTO library_item (
      title, description, item_type_code, library_category_id, file_path, file_name,
      file_extension, file_size, mime_type, uploaded_by_user_id, audience_code,
      status_code, published_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING library_item_id`,
    [
      title,
      validDescription(metadata.description),
      typeCode,
      categoryId,
      toStoredKey('library', destination),
      fileName,
      extension,
      stats.size,
      mimeTypeFor(fileName),
      identity.userId,
      normaliseAudience(metadata.audience),
      status,
      status === 'PUBLISHED' ? new Date() : null
    ]
  )

  const itemId = res.data?.[0]?.LIBRARY_ITEM_ID
  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.upload',
    entityType: 'library_item',
    entityId: itemId,
    entityLabel: title,
    detail: { type: typeCode, status, fileName },
    changes: { status: { before: null, after: status } }
  })

  const itemRes = await query(`${ITEM_SELECT} WHERE li.library_item_id = $1`, [itemId])
  const item = itemRes.data?.[0] || null
  if (item) grantLibraryMedia([item])

  // A submission that needs a decision goes straight into the administrators'
  // bells, not just the sidebar badge. The uploader is left out.
  if (item && status === 'PENDING') {
    try {
      await notifyLibraryReviewRequested({
        itemId,
        title: item.TITLE,
        excludeUserId: identity.userId
      })
    } catch (error) {
      console.warn('Could not notify administrators about the library submission:', error.message)
    }
  }

  return { data: item, status }
}

// ---- Editing ---------------------------------------------------------------
export async function updateLibraryItem(userId, itemId, data = {}) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity) return { error: 'Sign in again to change this document.' }

  const id = parseInt(itemId, 10)
  if (!id) return { error: 'Unknown document.' }

  const currentRes = await query('SELECT * FROM library_item WHERE library_item_id = $1', [id])
  const current = currentRes.data?.[0]
  if (!current) return { error: 'That document no longer exists.' }

  const isOwner = String(current.UPLOADED_BY_USER_ID) === String(identity.userId)
  if (!identity.isLibrarian && !isOwner) {
    return { error: 'Only the account that added this document, or an administrator, may change it.' }
  }
  if (!identity.isLibrarian && current.STATUS_CODE === 'PUBLISHED' && data.resubmit !== true) {
    return { error: 'A published document can only be edited by an administrator.' }
  }

  const title = validTitle(data.title ?? current.TITLE)
  if (!title) return { error: 'Enter a title of at least two characters.' }

  const policy = await getLibraryPolicy()
  const categoryId = data.categoryId === undefined
    ? current.LIBRARY_CATEGORY_ID
    : (parseInt(data.categoryId, 10) || null)
  if (policy.requireCategory && !categoryId) return { error: 'Choose a category for this document.' }

  const typeCode = normaliseType(data.typeCode ?? current.ITEM_TYPE_CODE, current.FILE_NAME || current.FILE_PATH)
  if (!typeCode) return { error: 'A video document needs a video file.' }

  let categoryCode = 'UNCATEGORISED'
  if (categoryId) {
    const categoryRes = await query(
      'SELECT category_code FROM library_category WHERE library_category_id = $1',
      [categoryId]
    )
    categoryCode = categoryRes.data?.[0]?.CATEGORY_CODE || categoryCode
  }

  // An edited type or category moves the file to the folder that describes it
  // now, so the shelf on disk keeps matching the catalogue. A share that cannot
  // be written leaves the old key in place rather than losing the row.
  let filePath = current.FILE_PATH
  try {
    const stored = filePath ? resolveStoredResource(filePath, 'library') : null
    if (stored) {
      const moved = moveResourceFile(stored, 'library', [typeCode, categoryCode])
      if (moved !== stored) filePath = toStoredKey('library', moved)
    }
  } catch (error) {
    console.warn('Could not move the library file into its new folder:', error.message)
  }

  const status = data.resubmit === true && current.STATUS_CODE === 'REJECTED'
    ? 'PENDING'
    : current.STATUS_CODE
  const resubmitted = status === 'PENDING' && current.STATUS_CODE === 'REJECTED'
  const reviewedAt = status === 'PENDING' ? null : current.REVIEWED_AT
  const reviewNote = status === 'PENDING' ? null : current.REVIEW_NOTE

  await query(`
    UPDATE library_item
       SET title = $1, description = $2, item_type_code = $3, library_category_id = $4,
           audience_code = $5, status_code = $6, reviewed_at = $7, review_note = $8,
           file_path = $9, updated_at = CURRENT_TIMESTAMP
     WHERE library_item_id = $10`,
    [
      title,
      validDescription(data.description ?? current.DESCRIPTION),
      typeCode,
      categoryId,
      normaliseAudience(data.audience ?? current.AUDIENCE_CODE),
      status,
      reviewedAt,
      reviewNote,
      filePath,
      id
    ]
  )

  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.update',
    entityType: 'library_item',
    entityId: id,
    entityLabel: title,
    changes: {
      status: { before: current.STATUS_CODE, after: status },
      title: { before: current.TITLE, after: title }
    }
  })

  // A corrected document back in the queue is a new request for the reviewers.
  if (resubmitted) {
    try {
      await notifyLibraryReviewRequested({
        itemId: id,
        title,
        excludeUserId: identity.userId
      })
    } catch (error) {
      console.warn('Could not notify administrators about the resubmission:', error.message)
    }
  }

  const itemRes = await query(`${ITEM_SELECT} WHERE li.library_item_id = $1`, [id])
  return { data: itemRes.data?.[0] || null }
}

// ---- Review ----------------------------------------------------------------
export async function reviewLibraryItem(userId, itemId, decision, note = '') {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity?.isLibrarian) return { error: 'Only an administrator may review library documents.' }

  const id = parseInt(itemId, 10)
  if (!id) return { error: 'Unknown document.' }

  const action = String(decision || '').toUpperCase()
  if (!['APPROVE', 'REJECT'].includes(action)) return { error: 'Choose whether to publish or reject the document.' }

  const trimmedNote = String(note || '').trim().slice(0, 1000)
  if (action === 'REJECT' && !trimmedNote) {
    return { error: 'Say why the document was rejected, so its author can correct it.' }
  }

  const currentRes = await query(
    'SELECT title, status_code, uploaded_by_user_id FROM library_item WHERE library_item_id = $1',
    [id]
  )
  const current = currentRes.data?.[0]
  if (!current) return { error: 'That document no longer exists.' }
  if (current.STATUS_CODE === 'PUBLISHED' && action === 'APPROVE') {
    return { error: 'This document is already published.' }
  }

  const status = action === 'APPROVE' ? 'PUBLISHED' : 'REJECTED'
  await query(`
    UPDATE library_item
       SET status_code = $1, review_note = $2, reviewed_by_user_id = $3,
           reviewed_at = CURRENT_TIMESTAMP,
           published_at = CASE WHEN $1 = 'PUBLISHED' THEN CURRENT_TIMESTAMP ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
     WHERE library_item_id = $4`,
    [status, trimmedNote || null, identity.userId, id]
  )

  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.review',
    entityType: 'library_item',
    entityId: id,
    entityLabel: current.TITLE,
    detail: { decision: status, note: trimmedNote || null },
    changes: { status: { before: current.STATUS_CODE, after: status } }
  })

  // The submission is no longer pending, so every reviewer's request is done.
  try {
    await settleLibraryReviewRequests(id)
  } catch (error) {
    console.warn('Could not settle the library review requests:', error.message)
  }

  // The decision is what the author is waiting for. A missing notification must
  // never undo a review that already succeeded, so it stays a warning.
  try {
    await notifyLibraryReviewDecision({
      itemId: id,
      title: current.TITLE,
      status,
      note: trimmedNote,
      authorUserId: current.UPLOADED_BY_USER_ID,
      reviewerUserId: identity.userId
    })
  } catch (error) {
    console.warn('Could not notify the author about the library review:', error.message)
  }

  return { success: true, status }
}

// Withdraw a published document, or put an archived one back on the shelf.
export async function setLibraryItemArchived(userId, itemId, archived) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity?.isLibrarian) return { error: 'Only an administrator may archive library documents.' }

  const id = parseInt(itemId, 10)
  if (!id) return { error: 'Unknown document.' }

  const status = archived ? 'ARCHIVED' : 'PUBLISHED'
  const res = await query(
    `UPDATE library_item
        SET status_code = $1, updated_at = CURRENT_TIMESTAMP,
            published_at = CASE WHEN $1 = 'PUBLISHED' THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE published_at END
      WHERE library_item_id = $2
      RETURNING title`,
    [status, id]
  )
  if (!res.data?.length) return { error: 'That document no longer exists.' }

  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.review',
    entityType: 'library_item',
    entityId: id,
    entityLabel: res.data[0].TITLE,
    detail: { decision: status },
    changes: { status: { before: null, after: status } }
  })

  // Taking a document down also answers any request still waiting on it.
  if (archived) {
    try {
      await settleLibraryReviewRequests(id)
    } catch (error) {
      console.warn('Could not settle the library review requests:', error.message)
    }
  }

  return { success: true, status }
}

// ---- Removing --------------------------------------------------------------
export async function deleteLibraryItem(userId, itemId) {
  await ensureLibraryTables()
  const identity = await callerIdentity(userId)
  if (!identity) return { error: 'Sign in again to remove this document.' }

  const id = parseInt(itemId, 10)
  if (!id) return { error: 'Unknown document.' }

  const res = await query(
    'SELECT title, file_path, status_code, uploaded_by_user_id FROM library_item WHERE library_item_id = $1',
    [id]
  )
  const item = res.data?.[0]
  if (!item) return { error: 'That document no longer exists.' }

  const isOwner = String(item.UPLOADED_BY_USER_ID) === String(identity.userId)
  if (!identity.isLibrarian) {
    if (!isOwner) return { error: 'Only the account that added this document, or an administrator, may remove it.' }
    if (item.STATUS_CODE === 'PUBLISHED') {
      return { error: 'A published document can only be removed by an administrator.' }
    }
  }

  const stored = item.FILE_PATH ? resolveStoredResource(item.FILE_PATH, 'library') : null
  if (stored && fs.existsSync(stored)) {
    try {
      fs.unlinkSync(stored)
    } catch (error) {
      console.warn('Could not delete the library file from disk:', error.message)
    }
  }

  await query('DELETE FROM library_access WHERE library_item_id = $1', [id])
  await query('DELETE FROM library_item WHERE library_item_id = $1', [id])
  mediaGrants.delete(String(id))

  await recordAudit({
    actorUserId: identity.userId,
    action: 'library.delete',
    entityType: 'library_item',
    entityId: id,
    entityLabel: item.TITLE,
    changes: { deleted: { before: item.TITLE, after: null } }
  })

  // A removed document cannot be reviewed; its request must not linger.
  try {
    await settleLibraryReviewRequests(id)
  } catch (error) {
    console.warn('Could not settle the library review requests:', error.message)
  }

  return { success: true }
}

// ---- Usage signal ----------------------------------------------------------
// Best-effort: a failed write must never block the open or the download it
// describes.
export async function recordLibraryAccess(itemId, userId, kind = 'OPEN') {
  const id = parseInt(itemId, 10)
  if (!id) return
  try {
    await query(
      'INSERT INTO library_access (library_item_id, user_id, access_kind) VALUES ($1, $2, $3)',
      [id, parseInt(userId, 10) || null, String(kind).slice(0, 16).toUpperCase()]
    )
  } catch (error) {
    console.warn('Could not record library access:', error.message)
  }
}

// ---- Serving the stored file ----------------------------------------------
const isInside = (target, root) => {
  const normalise = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  const path = normalise(target)
  const base = normalise(root)
  return path === base || path.startsWith(base.endsWith(sep) ? base : base + sep)
}

export async function resolveLibraryFile(itemId) {
  const id = parseInt(itemId, 10)
  if (!id) return null

  const res = await query(
    'SELECT library_item_id, title, file_path FROM library_item WHERE library_item_id = $1',
    [id]
  )
  const item = res.data?.[0]
  if (!item?.FILE_PATH) return null

  const stored = resolveStoredResource(item.FILE_PATH, 'library')
  if (!stored) return null

  let real = null
  let root = null
  try {
    real = fs.realpathSync(stored)
    root = fs.realpathSync(libraryDir())
  } catch {
    return null
  }
  if (!isInside(real, root)) return null

  return { path: real, label: item.TITLE, mime: mimeTypeFor(real) }
}

// A copy kept on this computer for an outage. Reading the file needs the server
// once — the access check and the share — which is what makes the copy one this
// account was allowed to make.
export async function saveLibraryItemForOffline(userId, itemId) {
  const id = parseInt(itemId, 10)
  if (!id) return { error: 'Document not found.' }
  if (!(await canReadLibraryItem(userId, id))) {
    return { error: 'You do not have access to this document.' }
  }

  const res = await query('SELECT title, file_path FROM library_item WHERE library_item_id = $1', [id])
  const item = res.data?.[0]
  if (!item?.FILE_PATH) return { error: 'Document not found.' }

  const stored = resolveStoredResource(item.FILE_PATH, 'library')
  if (!stored || !fs.existsSync(stored)) {
    return { error: 'The stored file is missing on disk. It may have been moved or deleted.' }
  }

  const saved = saveOfflineFile({
    kind: 'library',
    id,
    sourcePath: stored,
    label: item.TITLE,
    mime: mimeTypeFor(stored)
  })
  return saved.error ? saved : { success: true, ...saved }
}

export function removeLibraryItemOffline(itemId) {
  return removeOfflineFile('library', itemId)
}

// Opens a copy saved on this computer, through the system viewer.
async function openSavedLibraryCopy(saved) {
  const errorMessage = await shell.openPath(saved.path)
  if (errorMessage) return { error: `Could not open the document: ${errorMessage}` }
  return { success: true, offlineCopy: true }
}

async function saveLibraryCopyTo(sourcePath) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Download document',
    defaultPath: join(app.getPath('downloads'), basename(sourcePath)),
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (canceled || !filePath) return { canceled: true }
  try {
    fs.copyFileSync(sourcePath, filePath)
    return { success: true, path: filePath }
  } catch (error) {
    return { error: `Could not save the document: ${error.message}` }
  }
}

export async function downloadLibraryItem(userId, itemId) {
  const id = parseInt(itemId, 10)
  if (!id) return { error: 'Document not found.' }

  // Offline the share is gone and the access check cannot reach the database.
  // The copy this computer already holds is what can be saved now; it only
  // exists because an authorized account put it there.
  if (isOffline()) {
    const saved = recallOfflineFile('library', id)
    if (!saved) {
      return { error: 'This document is not saved on this computer. Open it once online, or save it for offline use.' }
    }
    return await saveLibraryCopyTo(saved.path)
  }

  if (!(await canReadLibraryItem(userId, id))) {
    return { error: 'You do not have access to this document.' }
  }

  const identity = await callerIdentity(userId)
  const policy = await getLibraryPolicy()
  if (identity?.isStudent && !policy.studentDownloads) {
    return { error: STUDENT_DOWNLOAD_BLOCKED }
  }

  const res = await query('SELECT title, file_path FROM library_item WHERE library_item_id = $1', [id])
  const item = res.data?.[0]
  if (!item?.FILE_PATH) return { error: 'Document not found.' }

  let source = resolveStoredResource(item.FILE_PATH, 'library')
  if (!source || !fs.existsSync(source)) {
    // The share could not be read: the saved copy is still this document.
    const saved = recallOfflineFile('library', id)
    if (!saved) {
      return { error: 'The stored file is missing on disk. It may have been moved or deleted.' }
    }
    source = saved.path
  }

  const result = await saveLibraryCopyTo(source)
  if (result.success) await recordLibraryAccess(id, userId, 'DOWNLOAD')
  return result
}

export async function openLibraryItem(userId, itemId) {
  const id = parseInt(itemId, 10)
  if (!id) return { error: 'Document not found.' }

  if (isOffline()) {
    const saved = recallOfflineFile('library', id)
    if (!saved) {
      return { error: 'This document is not saved on this computer. Open it once online, or save it for offline use.' }
    }
    return await openSavedLibraryCopy(saved)
  }

  if (!(await canReadLibraryItem(userId, id))) {
    return { error: 'You do not have access to this document.' }
  }

  const res = await query('SELECT file_path FROM library_item WHERE library_item_id = $1', [id])
  const item = res.data?.[0]
  if (!item?.FILE_PATH) return { error: 'Document not found.' }

  const stored = resolveStoredResource(item.FILE_PATH, 'library')
  if (!stored || !fs.existsSync(stored)) {
    const saved = recallOfflineFile('library', id)
    if (saved) return await openSavedLibraryCopy(saved)
    return { error: 'The stored file is missing on disk. It may have been moved or deleted.' }
  }

  const errorMessage = await shell.openPath(stored)
  if (errorMessage) return { error: `Could not open the document: ${errorMessage}` }

  await recordLibraryAccess(id, userId, 'OPEN')
  return { success: true }
}
