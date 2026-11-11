import { isOffline, query } from '../db'
import { tryDdl } from '../sqlGuards'
import { app, dialog, shell } from 'electron'
import { join, basename, extname, sep } from 'path'
import fs from 'fs'
import { resourceDir, newResourceFile, resourceFileName, resolveStoredResource, toStoredKey } from './resourceStorage'
import { recallOfflineFile, removeOfflineFile, saveOfflineFile } from '../offlineFiles'

// Lesson material lives outside the database, one file per row in "document".
// A lesson can hold anything a teacher needs: slides, handouts, images and video
// recordings. The kind of a file is decided by its extension — that is what the
// page groups by, what the player uses, and what the media endpoint serves it as
// — so nothing about it has to be entered by hand.
//
// On disk a file is filed by the syllabus:
//
//   documents/<MAJOR_CODE>/<CHAPTER_CODE>/<LESSON_CODE>/
//             <codes>_<labels>_<original name>_<timestamp>
//
// so a teacher can open the share and see the material for one lesson together,
// and a file copied out of its folder still names its major, chapter, lesson
// and label.
// Resolved per call, never at import time: the folder follows the configured
// storage root — the server share when the application runs against one.
const documentsDir = () => resourceDir('documents')

const VIDEO_TYPES = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp'
}

const IMAGE_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

const OTHER_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain'
}

export const extensionOf = (value) => extname(String(value || '')).replace('.', '').toLowerCase()

export const isVideoPath = (value) => Object.prototype.hasOwnProperty.call(VIDEO_TYPES, extensionOf(value))

export const mimeTypeFor = (value) => {
  const ext = extensionOf(value)
  return VIDEO_TYPES[ext] || IMAGE_TYPES[ext] || OTHER_TYPES[ext] || 'application/octet-stream'
}

// The document_type code a file belongs to, from its extension. Only used to
// label the file (Video / PDF / Word / Image) — an unknown extension keeps the
// type the uploader chose.
const documentTypeCodeFor = (value) => {
  const ext = extensionOf(value)
  if (VIDEO_TYPES[ext]) return 'VID'
  if (IMAGE_TYPES[ext]) return 'IMG'
  if (ext === 'pdf') return 'PDF'
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'DOC'
  return null
}

// The curriculum a file is filed under, joined onto every document row so the
// page can read as the syllabus does without a second query.
const DOCUMENT_COLUMNS = `
      dt.document_type_label_en, dt.document_type_label_ar, dt.document_type_label_fr,
      lhd.LESSON_ID,
      l.LESSON_CODE,
      l.lesson_label_en, l.lesson_label_ar, l.lesson_label_fr,
      c.CHAPTER_ID,
      c.CHAPTER_CODE,
      c.chapter_label_en, c.chapter_label_ar, c.chapter_label_fr,
      m.MAJOR_ID,
      m.MAJOR_CODE,
      m.MAJOR_LABEL_EN, m.MAJOR_LABEL_AR, m.MAJOR_LABEL_FR,
      mc.MAJOR_CATEGORY_ID,
      mc.MAJOR_CATEGORY_CODE,
      mc.major_category_label_en, mc.major_category_label_ar, mc.major_category_label_fr`

// The folder a lesson's material belongs in, mirroring the syllabus:
//
//   documents/<MAJOR_CODE>/<CHAPTER_CODE>/<LESSON_CODE>/
//
// A file that is not filed under a lesson (the office may add school-wide
// material) goes to documents/GENERAL. Codes are preferred over labels because
// they survive a label being translated or corrected; an installation whose
// rows have no code yet falls back to the row id so the folder still says which
// major, chapter and lesson the file belongs to.
async function lessonFolder(lessonId) {
  const id = parseInt(lessonId, 10)
  if (!id) return { majorId: null, segments: ['GENERAL'] }

  const res = await query(
    `SELECT m.major_id, m.major_code, c.chapter_id, c.chapter_code, l.lesson_code
       FROM lesson l
       JOIN chapter c ON c.chapter_id = l.chapter_id
       JOIN major m ON m.major_id = c.major_id
      WHERE l.lesson_id = $1`,
    [id]
  )
  const row = res.data?.[0]
  if (!row) return { majorId: null, segments: ['GENERAL'] }

  return {
    majorId: parseInt(row.MAJOR_ID, 10) || null,
    segments: [
      row.MAJOR_CODE || `MAJOR_${row.MAJOR_ID}`,
      row.CHAPTER_CODE || `CHAPTER_${row.CHAPTER_ID}`,
      row.LESSON_CODE || `LESSON_${id}`
    ]
  }
}

const DOCUMENT_JOINS = `
    LEFT JOIN document_type dt ON d.DOCUMENT_TYPE_ID = dt.DOCUMENT_TYPE_ID
    LEFT JOIN lesson_has_document lhd ON d.DOCUMENT_ID = lhd.DOCUMENT_ID
    LEFT JOIN lesson l ON lhd.LESSON_ID = l.LESSON_ID
    LEFT JOIN chapter c ON l.CHAPTER_ID = c.CHAPTER_ID
    LEFT JOIN major m ON c.MAJOR_ID = m.MAJOR_ID
    LEFT JOIN major_category mc ON m.MAJOR_CATEGORY_ID = mc.MAJOR_CATEGORY_ID`

// Kind is derived, not stored: one source of truth (the extension) and no
// column to keep in step when a file is replaced.
const describeDocument = (row) => ({
  ...row,
  IS_VIDEO: isVideoPath(row.DOCUMENT_PATH),
  FILE_EXTENSION: extensionOf(row.DOCUMENT_PATH)
})

// ---- Who may reach a file --------------------------------------------------
//
// Reading rights follow the curriculum, not a list kept per file. A file is
// filed under a lesson, the lesson under a major, so the major already says
// which students and which teachers the file belongs to. The per-file column
// only narrows that for a file that must not reach students, or opens it to the
// whole school for the occasional unfiled one:
//
//   CURRICULUM  follow the major the file is filed under (the default)
//   EVERYONE    every signed-in account, whatever the major
//   TEACHERS    the staff of that major, and the school office
//   ADMINS      the school office only
//
// The office roles (ADMIN, DEVELOPER, DIRECTOR, SECRETARY, SCHEDULER) look
// after the school rather than a single major, so they reach every file.
export const DOCUMENT_VISIBILITY_CODES = ['CURRICULUM', 'EVERYONE', 'TEACHERS', 'ADMINS']

const OFFICE_ROLE_CODES = ['ADMIN', 'DEVELOPER', 'DIRECTOR', 'SECRETARY', 'SCHEDULER']

// The account behind a request, read from the database rather than trusted from
// the window: the role, and the person it belongs to.
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
    isOffice: OFFICE_ROLE_CODES.includes(roleCode)
  }
}

// The majors an account is tied to: the ones a teacher teaches, the ones a
// student is enrolled in. Both are read the same way — one row per major.
async function majorsForCaller(identity) {
  const toIds = (res) => (res?.data || []).map((row) => parseInt(row.MAJOR_ID, 10)).filter(Boolean)
  if (!identity?.personId) return { taught: [], enrolled: [] }

  const [taughtRes, enrolledRes] = await Promise.all([
    query('SELECT major_id FROM major_teacher WHERE person_id = $1', [identity.personId]),
    query('SELECT DISTINCT major_id FROM student_dynamic_group_by_major WHERE person_id = $1', [identity.personId])
  ])
  return { taught: toIds(taughtRes), enrolled: toIds(enrolledRes) }
}

// The WHERE clause that says which document rows an account may read, together
// with the parameters it needs. Built as SQL rather than a JS filter so the
// library never even leaves the database for rows the account may not see.
const readScopeSql = (identity, majors = { taught: [], enrolled: [] }, startIndex = 0) => {
  if (identity?.isOffice) return { sql: 'TRUE', params: [] }
  const params = []
  const clauses = [`d.document_visibility_code = 'EVERYONE'`]

  if (identity?.userId) {
    params.push(identity.userId)
    clauses.push(`d.document_uploaded_by_user_id = $${startIndex + params.length}`)
  }

  const readable = [...new Set([...(majors.taught || []), ...(majors.enrolled || [])])]
  if (readable.length) {
    params.push(readable)
    clauses.push(`(d.document_visibility_code = 'CURRICULUM' AND m.major_id = ANY($${startIndex + params.length}::int[]))`)
  }

  const taught = [...new Set(majors.taught || [])]
  if (taught.length) {
    params.push(taught)
    clauses.push(`(d.document_visibility_code = 'TEACHERS' AND m.major_id = ANY($${startIndex + params.length}::int[]))`)
  }

  return { sql: `(${clauses.join(' OR ')})`, params }
}

// May this account read this file? The same rule as the listing, asked of one
// row; it guards opening, downloading and the media endpoint.
export async function canReadDocument(userId, documentId) {
  const id = parseInt(documentId, 10)
  if (!id) return false

  const identity = await callerIdentity(userId)
  if (identity?.isOffice) return true

  const res = await query(
    `SELECT d.document_visibility_code, d.document_uploaded_by_user_id, m.major_id
       FROM document d ${DOCUMENT_JOINS}
      WHERE d.document_id = $1`,
    [id]
  )
  if (!res.data?.length) return false

  const majors = await majorsForCaller(identity)
  const readable = new Set([...majors.taught, ...majors.enrolled])
  const taught = new Set(majors.taught)

  return res.data.some((row) => {
    if (identity?.userId && row.DOCUMENT_UPLOADED_BY_USER_ID === identity.userId) return true
    const visibility = row.DOCUMENT_VISIBILITY_CODE || 'CURRICULUM'
    if (visibility === 'EVERYONE') return true
    if (visibility === 'ADMINS') return false
    const majorId = parseInt(row.MAJOR_ID, 10)
    if (visibility === 'TEACHERS') return taught.has(majorId)
    return readable.has(majorId)
  })
}

// ---- The media endpoint's short-lived grant ---------------------------------
//
// A <video> asks for a file itself, carrying no account — only the page does,
// and only the listing the page was given says which ids it may reach. So a
// listing hands out the ids it returned, for a while, and the endpoint serves
// nothing that was not handed out.
const mediaGrants = new Map()
const MEDIA_GRANT_MS = 6 * 60 * 60 * 1000

const grantMediaAccess = (documents) => {
  const until = Date.now() + MEDIA_GRANT_MS
  for (const doc of documents || []) {
    const id = String(doc?.DOCUMENT_ID ?? '')
    if (id) mediaGrants.set(id, until)
  }
}

export function hasMediaGrant(documentId) {
  const key = String(documentId ?? '')
  const until = mediaGrants.get(key)
  if (!until) return false
  if (until < Date.now()) {
    mediaGrants.delete(key)
    return false
  }
  return true
}

// The whole library, cut to what this account may read. Without an account the
// listing is limited to the files published to everyone.
export async function getDocuments(userId) {
  const identity = await callerIdentity(userId)
  const majors = identity ? await majorsForCaller(identity) : { taught: [], enrolled: [] }
  const scope = readScopeSql(identity, majors)

  const result = await query(
    `SELECT d.*,${DOCUMENT_COLUMNS} FROM document d ${DOCUMENT_JOINS} WHERE ${scope.sql}`,
    scope.params
  )
  const data = (result.data || []).map(describeDocument)
  // The page may now play the videos it was just given.
  grantMediaAccess(data)
  return { ...result, data }
}

// ---- Usage signal for the "Popular" shelf -----------------------------------
//
// The library keeps no analytics of its own, so opening, playing and
// downloading a file is appended to document_access. The table is created on
// first use (CREATE TABLE IF NOT EXISTS) so an existing installation needs no
// manual migration; on a database whose account may not create tables, the
// shelf is simply reported as unavailable and the page carries on.
let accessTableReady = null
let accessTableRetryAt = 0

async function ensureDocumentAccessTable() {
  if (accessTableReady) return accessTableReady
  if (Date.now() < accessTableRetryAt) return null

  accessTableReady = (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS document_access (
        document_access_id bigserial PRIMARY KEY,
        document_id integer NOT NULL,
        user_id integer,
        access_kind character varying(16) NOT NULL DEFAULT 'OPEN',
        accessed_at timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)
    // Only the table's owner may create the index; the usage signal works
    // without it, so a database owned by postgres does not lose the shelf.
    await tryDdl('CREATE INDEX IF NOT EXISTS document_access_document_idx ON document_access (document_id, accessed_at DESC)')
    return true
  })().catch((error) => {
    console.warn('Document usage will not be recorded:', error.message)
    // Try again later rather than caching the refusal for the whole session.
    accessTableReady = null
    accessTableRetryAt = Date.now() + 10 * 60 * 1000
    return null
  })

  return accessTableReady
}

// Best-effort: a failed write must never undo the open or the download it
// describes, so the problem is reported and swallowed.
export async function recordDocumentAccess(id, userId, kind = 'OPEN') {
  const documentId = parseInt(id, 10)
  if (!documentId) return
  const ready = await ensureDocumentAccessTable()
  if (!ready) return

  try {
    await query(
      'INSERT INTO document_access (document_id, user_id, access_kind) VALUES ($1, $2, $3)',
      [documentId, parseInt(userId, 10) || null, String(kind).slice(0, 16).toUpperCase()]
    )
  } catch (error) {
    console.warn('Could not record document access:', error.message)
  }
}

// The files the library reaches for most, over a rolling window. `unavailable`
// tells the page why the shelf is empty rather than pretending nothing is used.
export async function getPopularDocuments({ limit = 6, days = 90, userId } = {}) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 24)
  const window = Math.min(Math.max(parseInt(days, 10) || 90, 1), 365)

  try {
    const ready = await ensureDocumentAccessTable()
    if (!ready) return { data: [], unavailable: true }

    // The shelf reads the same library, so it is cut the same way.
    const identity = await callerIdentity(userId)
    const majors = identity ? await majorsForCaller(identity) : { taught: [], enrolled: [] }
    const scope = readScopeSql(identity, majors, 2)

    const result = await query(`
      WITH usage AS (
        SELECT document_id,
               count(*)::int AS access_count,
               max(accessed_at) AS last_accessed_at
          FROM document_access
         WHERE accessed_at >= CURRENT_TIMESTAMP - make_interval(days => $2::int)
         GROUP BY document_id
      )
      SELECT d.*,${DOCUMENT_COLUMNS},
             u.access_count, u.last_accessed_at
        FROM usage u
        JOIN document d ON d.DOCUMENT_ID = u.document_id
        ${DOCUMENT_JOINS}
       WHERE ${scope.sql}
       ORDER BY u.access_count DESC, u.last_accessed_at DESC
       LIMIT $1
    `, [max, window, ...scope.params])

    // A file may be filed under more than one lesson; the shelf lists it once.
    const seen = new Set()
    const data = (result.data || [])
      .map(describeDocument)
      .filter((row) => {
        if (seen.has(row.DOCUMENT_ID)) return false
        seen.add(row.DOCUMENT_ID)
        return true
      })

    grantMediaAccess(data)
    return { ...result, data, unavailable: false }
  } catch (error) {
    console.warn('Could not read document usage:', error.message)
    return { data: [], unavailable: true }
  }
}

export async function getDocumentTypes() {
  return await query('SELECT * FROM document_type')
}

export async function getMajorCategories() {
  return await query('SELECT * FROM major_category')
}

export async function getMajorsByCategory(categoryId) {
  return await query('SELECT * FROM major WHERE MAJOR_CATEGORY_ID = $1', [categoryId])
}

export async function getChaptersByMajor(majorId) {
  return await query('SELECT * FROM chapter WHERE MAJOR_ID = $1', [majorId])
}

export async function getLessonsByChapter(chapterId) {
  return await query('SELECT * FROM lesson WHERE CHAPTER_ID = $1', [chapterId])
}

export async function createChapter(chapterData) {
  const columns = Object.keys(chapterData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(chapterData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(chapterData)

  const res = await query(`INSERT INTO chapter (${columns}) VALUES (${pgPlaceholders}) RETURNING chapter_id`, values)
  const newId = res.data?.[0]?.CHAPTER_ID

  return { ...chapterData, CHAPTER_ID: newId }
}

export async function updateChapter(id, chapterData) {
  const pgSets = Object.keys(chapterData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(chapterData), id]

  await query(`UPDATE chapter SET ${pgSets} WHERE chapter_id = $${values.length}`, values)
  return { ...chapterData, CHAPTER_ID: id }
}

export async function deleteChapter(id) {
  await query('DELETE FROM chapter WHERE chapter_id = $1', [id])
  return { success: true }
}

export async function createLesson(lessonData) {
  const columns = Object.keys(lessonData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(lessonData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(lessonData)

  const res = await query(`INSERT INTO lesson (${columns}) VALUES (${pgPlaceholders}) RETURNING lesson_id`, values)
  const newId = res.data?.[0]?.LESSON_ID

  return { ...lessonData, LESSON_ID: newId }
}

export async function updateLesson(id, lessonData) {
  const pgSets = Object.keys(lessonData).map((key, i) => `${key.toLowerCase()} = $${i + 1}`).join(', ')
  const values = [...Object.values(lessonData), id]

  await query(`UPDATE lesson SET ${pgSets} WHERE lesson_id = $${values.length}`, values)
  return { ...lessonData, LESSON_ID: id }
}

export async function deleteLesson(id) {
  await query('DELETE FROM lesson WHERE lesson_id = $1', [id])
  return { success: true }
}

export async function uploadDocument(filePath, metadata) {
  const { lessonId, uploadedByUserId, ...rawMetadata } = metadata
  const docMetadata = { ...rawMetadata }
  // Accept the legacy single-label key from older renderers and store it in
  // the canonical English column.
  if (docMetadata.DOCUMENT_LABEL && !docMetadata.DOCUMENT_LABEL_EN) {
    docMetadata.DOCUMENT_LABEL_EN = docMetadata.DOCUMENT_LABEL
    delete docMetadata.DOCUMENT_LABEL
  }

  // Who is adding this, and where it is being filed. A teacher may only file
  // under a major they teach, and may not publish a file to the whole school;
  // the office may file anywhere and set any visibility. Checked before the
  // file is copied, so a refused upload leaves nothing behind on disk.
  const identity = await callerIdentity(uploadedByUserId)
  if (!identity) return { error: 'Sign in again before adding a file.' }

  const folder = await lessonFolder(lessonId)

  const askedVisibility = String(docMetadata.DOCUMENT_VISIBILITY_CODE || '').toUpperCase()
  docMetadata.DOCUMENT_VISIBILITY_CODE = DOCUMENT_VISIBILITY_CODES.includes(askedVisibility)
    ? askedVisibility
    : 'CURRICULUM'

  if (!identity.isOffice) {
    if (docMetadata.DOCUMENT_VISIBILITY_CODE === 'EVERYONE') {
      docMetadata.DOCUMENT_VISIBILITY_CODE = 'CURRICULUM'
    }
    if (!lessonId) {
      return { error: 'Choose the major this file belongs to.' }
    }
    const majors = await majorsForCaller(identity)
    if (!folder.majorId || !majors.taught.includes(folder.majorId)) {
      return { error: 'You can only add files to the majors you teach.' }
    }
  }

  const fileName = basename(filePath)
  const extension = extname(fileName)
  const originalStem = extension ? fileName.slice(0, -extension.length) : fileName
  // The stored name repeats what the row knows: the syllabus codes (the same
  // ones the folders use), the label in the three languages, then the original
  // name. A batch can hold two files that share a name (a handout and its copy
  // taken from another folder); newResourceFile adds the timestamp that keeps
  // the second from overwriting the first. The folder follows the syllabus:
  // documents/<major>/<chapter>/<lesson>/.
  const storedName = resourceFileName([
    ...folder.segments,
    docMetadata.DOCUMENT_LABEL_EN,
    docMetadata.DOCUMENT_LABEL_AR,
    docMetadata.DOCUMENT_LABEL_FR,
    originalStem
  ], extension)
  const destPath = newResourceFile('documents', folder.segments, storedName)

  fs.copyFileSync(filePath, destPath)
  const stats = fs.statSync(destPath)

  const documentData = {
    ...docMetadata,
    // A key relative to the storage root, so the row reads the same from every
    // machine and after the root moves.
    DOCUMENT_PATH: toStoredKey('documents', destPath),
    DOCUMENT_SIZE: stats.size,
    DOCUMENT_CODE: docMetadata.DOCUMENT_CODE || fileName,
    // Who added the file, so a teacher can find their own uploads again.
    DOCUMENT_UPLOADED_BY_USER_ID: parseInt(uploadedByUserId, 10) || null
  }

  // The type follows the file: a video is stored as a video even when the
  // caller only sent the first type it found in the list.
  const typeCode = documentTypeCodeFor(fileName)
  if (typeCode) {
    const typeRes = await query('SELECT document_type_id FROM document_type WHERE document_type_code = $1', [typeCode])
    const typeId = typeRes.data?.[0]?.DOCUMENT_TYPE_ID
    if (typeId) documentData.DOCUMENT_TYPE_ID = typeId
  }

  const columns = Object.keys(documentData).map(k => k.toLowerCase()).join(', ')
  const pgPlaceholders = Object.keys(documentData).map((_, i) => `$${i + 1}`).join(', ')
  const values = Object.values(documentData)

  const res = await query(`INSERT INTO document (${columns}) VALUES (${pgPlaceholders}) RETURNING document_id`, values)
  const docId = res.data?.[0]?.DOCUMENT_ID
  const newDoc = { ...documentData, DOCUMENT_ID: docId }

  if (lessonId && docId) {
    await query('INSERT INTO lesson_has_document (lesson_id, document_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [lessonId, docId])
  }

  return newDoc
}
// Windows treats paths as case-insensitive, and realpathSync returns the casing
// of the path it was given for the last segment: the same folder can come back as
// ...\eNote\documents or ...\enote\documents. Comparing the strings as the
// filesystem does keeps a stored file from being refused over letter case.
const isInside = (target, root) => {
  const normalise = (value) => (process.platform === 'win32' ? value.toLowerCase() : value)
  const path = normalise(target)
  const base = normalise(root)
  return path === base || path.startsWith(base.endsWith(sep) ? base : base + sep)
}

// The stored file behind a row, for the media endpoint that plays videos in the
// page. Returns null for an unknown id and for any path that is not inside the
// documents folder — the renderer only ever sends an id, never a path.
export async function resolveDocumentFile(id) {
  const documentId = parseInt(id, 10)
  if (!documentId) return null

  const res = await query(
    'SELECT document_id, document_path, COALESCE(document_label_en, document_label_ar, document_label_fr) AS document_label FROM document WHERE document_id = $1',
    [documentId]
  )
  const doc = res.data?.[0]
  if (!doc?.DOCUMENT_PATH) return null

  const stored = resolveStoredResource(doc.DOCUMENT_PATH, 'documents')
  if (!stored) return null

  let real = null
  let root = null
  try {
    real = fs.realpathSync(stored)
    root = fs.realpathSync(documentsDir())
  } catch {
    return null
  }
  if (!isInside(real, root)) return null

  return { path: real, label: doc.DOCUMENT_LABEL, mime: mimeTypeFor(real) }
}

// Remove a file. Only the account that added it, or the school office, may —
// a teacher who cannot see a file cannot remove it either.
export async function deleteDocument(id, userId) {
  const res = await query('SELECT document_path, document_uploaded_by_user_id FROM document WHERE document_id = $1', [id])
  const doc = res.data?.[0]
  if (!doc) return { error: 'Document not found.' }

  const identity = await callerIdentity(userId)
  const isUploader = identity?.userId && doc.DOCUMENT_UPLOADED_BY_USER_ID === identity.userId
  if (!identity?.isOffice && !isUploader) {
    return { error: 'Only the account that added this file, or the school office, may delete it.' }
  }

  // The stored value is a key; resolve it before touching the disk. Rows from
  // older builds hold absolute paths and still resolve.
  const stored = doc.DOCUMENT_PATH ? resolveStoredResource(doc.DOCUMENT_PATH, 'documents') : null
  if (stored && fs.existsSync(stored)) {
    try {
      fs.unlinkSync(stored)
    } catch (e) {
      console.warn('Failed to delete file from filesystem:', e.message)
    }
  }

  await query('DELETE FROM document WHERE document_id = $1', [id])
  return { success: true }
}

// Copy a stored document to a user-chosen location. Opens a native "Save As"
// dialog; returns { canceled: true } when the user aborts, otherwise the
// destination path. Returns { error } when the stored file is missing.
// A copy of this lesson file kept on this computer for an outage. Reading it
// needs the server once — the access check and the share.
export async function saveDocumentForOffline(userId, id) {
  const documentId = parseInt(id, 10)
  if (!documentId) return { error: 'Document not found.' }
  if (!(await canReadDocument(userId, documentId))) {
    return { error: 'You do not have access to this file.' }
  }

  const res = await query(
    'SELECT document_path, COALESCE(document_label_en, document_label_ar, document_label_fr) AS document_label FROM document WHERE document_id = $1',
    [documentId]
  )
  const doc = res.data?.[0]
  if (!doc?.DOCUMENT_PATH) return { error: 'Document not found.' }

  const stored = resolveStoredResource(doc.DOCUMENT_PATH, 'documents')
  if (!stored || !fs.existsSync(stored)) {
    return { error: 'The stored file is missing on disk. It may have been moved or deleted.' }
  }

  const saved = saveOfflineFile({
    kind: 'documents',
    id: documentId,
    sourcePath: stored,
    label: doc.DOCUMENT_LABEL,
    mime: mimeTypeFor(stored)
  })
  return saved.error ? saved : { success: true, ...saved }
}

export function removeDocumentOffline(id) {
  return removeOfflineFile('documents', id)
}

async function saveDocumentCopyTo(sourcePath) {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Download Document',
    defaultPath: join(app.getPath('downloads'), basename(sourcePath)),
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (canceled || !filePath) return { canceled: true }
  try {
    fs.copyFileSync(sourcePath, filePath)
    return { success: true, path: filePath }
  } catch (error) {
    return { error: `Could not save the file: ${error.message}` }
  }
}

async function openSavedDocumentCopy(saved) {
  const errorMessage = await shell.openPath(saved.path)
  if (errorMessage) return { error: `Could not open file: ${errorMessage}` }
  return { success: true, offlineCopy: true }
}

export async function downloadDocument(id, userId) {
  const documentId = parseInt(id, 10)
  if (!documentId) return { error: 'Document not found.' }

  // Offline: the copy this computer holds is the only file that can be saved.
  if (isOffline()) {
    const saved = recallOfflineFile('documents', documentId)
    if (!saved) {
      return { error: 'This file is not saved on this computer. Open it once online, or save it for offline use.' }
    }
    return await saveDocumentCopyTo(saved.path)
  }

  if (!(await canReadDocument(userId, documentId))) {
    return { error: 'You do not have access to this file.' }
  }

  const res = await query(
    'SELECT document_path, COALESCE(document_label_en, document_label_ar, document_label_fr) AS document_label FROM document WHERE document_id = $1',
    [documentId]
  )
  const doc = res.data?.[0]
  if (!doc?.DOCUMENT_PATH) return { error: 'Document not found.' }

  let source = resolveStoredResource(doc.DOCUMENT_PATH, 'documents')
  if (!source || !fs.existsSync(source)) {
    const saved = recallOfflineFile('documents', documentId)
    if (!saved) {
      return { error: 'The stored file is missing on disk. It may have been moved or deleted.' }
    }
    source = saved.path
  }

  const result = await saveDocumentCopyTo(source)
  if (result.success) await recordDocumentAccess(documentId, userId, 'DOWNLOAD')
  return result
}

// Open a stored document with the OS default application (system viewer).
export async function openDocument(id, userId) {
  const documentId = parseInt(id, 10)
  if (!documentId) return { error: 'Document not found.' }

  if (isOffline()) {
    const saved = recallOfflineFile('documents', documentId)
    if (!saved) {
      return { error: 'This file is not saved on this computer. Open it once online, or save it for offline use.' }
    }
    return await openSavedDocumentCopy(saved)
  }

  if (!(await canReadDocument(userId, documentId))) {
    return { error: 'You do not have access to this file.' }
  }

  const res = await query('SELECT document_path FROM document WHERE document_id = $1', [documentId])
  const doc = res.data?.[0]
  if (!doc?.DOCUMENT_PATH) return { error: 'Document not found.' }

  const stored = resolveStoredResource(doc.DOCUMENT_PATH, 'documents')
  if (!stored || !fs.existsSync(stored)) {
    const saved = recallOfflineFile('documents', documentId)
    if (saved) return await openSavedDocumentCopy(saved)
    return { error: 'The stored file is missing on disk. It may have been moved or deleted.' }
  }

  const errorMessage = await shell.openPath(stored)
  if (errorMessage) {
    return { error: `Could not open file: ${errorMessage}` }
  }
  await recordDocumentAccess(documentId, userId, 'OPEN')
  return { success: true }
}
