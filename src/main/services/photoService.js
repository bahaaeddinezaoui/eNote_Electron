import { dialog } from 'electron'
import { extname, basename } from 'path'
import fs from 'fs'
import { isOffline, query } from '../db'
import { recallPhoto, rememberPhoto } from '../offlineMedia'
import { loadScope, assertStudentAllowed } from './teachingScopeService'
import { newResourceFile, resourceFileName, resolveStoredResource, toStoredKey } from './resourceStorage'

// Student photos (person.person_photo).
//
// The column holds a path, not image bytes: the file a user picks is copied
// into the app's own folder so the photo survives the original being moved or
// deleted from Downloads. The renderer never touches the filesystem — it asks
// for a data URL for the preview and gets one back over IPC.
//
// Files live under the storage root as
//   person_photos/<id>_<first name LA>_<last name LA>_<first name AR>_<last name AR>_<timestamp>.<ext>
// — this computer's user-data folder by default, the server share in a
// networked deployment. The name carries the student's number and both
// spellings of their name, so a photo opened on the share is identifiable
// without the database. The database stores the key relative to that root. A
// managed file is removed when the photo is replaced or cleared, but a path
// that points somewhere else (a record entered by hand, or a URL from the old
// system) is only ever unset, never deleted.

const MAX_PHOTO_BYTES = 4 * 1024 * 1024
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
const MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

// Where the file actually is now.
//
// A stored path is absolute, and it was written into the database while the
// application was still called iStudy: the folder was renamed to eNote and the
// files moved with it, but the rows kept the old path, so every photo read as
// missing. A path that no longer exists but names an old app-data folder is
// looked up by its file name in the current photo folder, which is where the
// migration put it. Anything else that is gone stays gone.
// The names this application gives a photo file: <person>-<timestamp>.<ext> from
// older builds, and <person>_<names>_<timestamp>.<ext> from this one. Both end
// in a timestamp, which is what tells a managed file from a hand-entered path.
const MANAGED_FILE_NAME = /^\d+[_-](?:.*[_-])?\d{10,}\.(png|jpe?g|webp)$/i

export function resolveStoredPhotoPath(value) {
  // A key ("person_photos/12_Mohamed_Benali_محمد_بن_علي_1762345678.png") resolves against the configured
  // storage root; an absolute path written by an older build is still read, and
  // a file whose folder moved is found again by its managed name.
  return resolveStoredResource(value, 'person_photos', { managedName: MANAGED_FILE_NAME })
}

// Only files this app named are ever deleted. A path entered by hand, or one
// that came from the old system, is unset in the database and left on disk.
const isManagedPath = (value) => {
  const resolved = resolveStoredPhotoPath(value)
  return !!resolved && MANAGED_FILE_NAME.test(basename(resolved))
}

// The preview the form shows. Throws on a file that is too large or is not one
// of the accepted image types, so the form can report it instead of storing it.
function dataUrlFor(filePath) {
  const mime = MIME_BY_EXTENSION[extname(filePath).toLowerCase()]
  if (!mime) throw new Error('Only PNG, JPG or WebP images can be used as a photo.')
  if (!fs.existsSync(filePath)) throw new Error('That image could not be read.')
  const { size } = fs.statSync(filePath)
  if (size > MAX_PHOTO_BYTES) throw new Error('That image is larger than 4 MB. Choose a smaller photo.')
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

function removeManagedFile(filePath) {
  const target = isManagedPath(filePath) ? resolveStoredPhotoPath(filePath) : null
  if (!target) return
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target)
  } catch (err) {
    console.warn('Could not remove the previous student photo:', err.message)
  }
}

// Native picker, filtered to the formats the app accepts. Returns the source
// path (kept by the form until the student is saved) and a preview data URL.
export async function choosePersonPhoto() {
  const result = await dialog.showOpenDialog({
    title: 'Choose a student photo',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ALLOWED_EXTENSIONS }]
  })
  if (result.canceled || !result.filePaths?.length) return { success: true, canceled: true }

  const filePath = result.filePaths[0]
  return {
    success: true,
    canceled: false,
    path: filePath,
    name: basename(filePath),
    dataUrl: dataUrlFor(filePath)
  }
}

// A data URL for a stored photo, or null when the row is empty or the file is
// gone. Never throws for a missing file: the record is still perfectly usable
// without its picture.
//
// Every photo shown is also copied to this computer (offlineMedia.js), so the
// same face is still there when the server share is unreachable — which is
// what keeps rosters and printed reports complete during an outage.
export function photoDataUrl(photoPath) {
  const savedCopy = () => {
    const cached = recallPhoto(photoPath)
    if (!cached) return null
    try {
      return dataUrlFor(cached)
    } catch {
      return null
    }
  }

  // While the server is away the share is away with it: asking it first would
  // add a network timeout to every row on the page.
  if (isOffline()) return savedCopy()

  const value = resolveStoredPhotoPath(photoPath)
  if (!value) return savedCopy()
  try {
    const dataUrl = dataUrlFor(value)
    rememberPhoto(photoPath, value)
    return dataUrl
  } catch {
    return savedCopy()
  }
}

export async function readPersonPhoto(photoPath) {
  return { success: true, dataUrl: photoDataUrl(photoPath) }
}

// The same thing for a list of rows: one data URL per path, in the order they
// were asked for. A row whose file is missing or unreadable yields null so a
// single bad photo can never break the page it is listed on.
export async function readPersonPhotos(photoPaths) {
  const paths = Array.isArray(photoPaths) ? photoPaths : []
  return { success: true, dataUrls: paths.map((photoPath) => photoDataUrl(photoPath)) }
}

// Stores the chosen file as the person's photo, or clears the photo when
// `sourcePath` is null/empty. Editing a student is limited to the teaching
// categories the acting secretary is responsible for, like every other edit.
export async function setPersonPhoto(userId, personId, sourcePath) {
  const id = parseInt(personId, 10)
  if (!id) throw new Error('A student is required.')
  await assertStudentAllowed(await loadScope(userId), id)

  const current = await query(
    `SELECT person_photo, person_first_name_la, person_last_name_la,
            person_first_name_ar, person_last_name_ar
       FROM person WHERE person_id = $1`,
    [id]
  )
  if (!current.data?.length) throw new Error('Student not found.')
  const person = current.data[0]
  const previous = person.PERSON_PHOTO || null

  if (!sourcePath) {
    await query('UPDATE person SET person_photo = NULL WHERE person_id = $1', [id])
    removeManagedFile(previous)
    return { success: true, path: null, dataUrl: null }
  }

  // Validated before anything is copied, so a rejected file leaves the record
  // exactly as it was.
  const dataUrl = dataUrlFor(sourcePath)
  const extension = extname(sourcePath).toLowerCase()

  // The number and both names, in Latin and in Arabic: the photo is the one
  // file on the share that has no other context around it.
  const storedName = resourceFileName([
    id,
    person.PERSON_FIRST_NAME_LA,
    person.PERSON_LAST_NAME_LA,
    person.PERSON_FIRST_NAME_AR,
    person.PERSON_LAST_NAME_AR
  ], extension)
  const target = newResourceFile('person_photos', [], storedName)
  fs.copyFileSync(sourcePath, target)

  // The row keeps the key, not the absolute path: every machine sharing the
  // database must resolve the same photo, and moving the storage root must not
  // invalidate the record.
  const key = toStoredKey('person_photos', target)
  await query('UPDATE person SET person_photo = $2 WHERE person_id = $1', [id, key])
  if (previous !== target) removeManagedFile(previous)

  return { success: true, path: key, dataUrl }
}
