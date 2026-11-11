import { isOffline, query } from '../db'
import { basename, extname } from 'path'
import fs from 'fs'
import { newResourceFile, resourceFileName, resolveStoredResource, toStoredKey } from './resourceStorage'
import { enqueueOutbox } from '../offlineOutbox'

// Screenshots belong with the other managed files: a report is read from any
// machine, so its attachment has to live where the database does.

// Submit a new bug report (any authenticated user). Only ADMIN/DEVELOPER
// callers may set the priority; everyone else gets the default 'medium'.
export async function createBugReport(userId, data, canSetPriority) {
  const subject = (data.REPORT_SUBJECT || '').trim()
  const description = (data.REPORT_DESCRIPTION || '').trim()
  if (!subject) throw new Error('Subject is required.')
  if (!description) throw new Error('Description is required.')

  const priority = canSetPriority && ['low', 'medium', 'high', 'critical'].includes(data.REPORT_PRIORITY)
    ? data.REPORT_PRIORITY
    : 'medium'

  // Offline the report waits on this computer and is filed when the server
  // answers. Priority is never taken from a queued entry.
  if (isOffline()) {
    const id = enqueueOutbox({
      kind: 'bugReport.create',
      userId: parseInt(userId, 10) || null,
      additive: true,
      desired: {
        REPORT_SUBJECT: subject,
        REPORT_DESCRIPTION: description,
        REPORT_SCREENSHOT_PATH: data.REPORT_SCREENSHOT_PATH || null
      }
    })
    if (!id) {
      throw new Error('The server is unreachable and this computer could not store the report. Try again.')
    }
    return { success: true, queued: true, outboxId: id }
  }

  const res = await query(
    `INSERT INTO bug_report (user_id, report_subject, report_description, report_screenshot_path, report_priority)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING report_id`,
    [userId, subject, description, data.REPORT_SCREENSHOT_PATH || null, priority]
  )
  return { success: true, reportId: res.data?.[0]?.REPORT_ID }
}

// Copy a picked screenshot into the app data folder and return the stored path.
// Its name carries the reporter's account and names and the original file name,
// so a screenshot opened on the share says whose screen it is even before the
// report row is read.
export async function uploadBugScreenshot(filePath, userId = null) {
  const original = basename(filePath)
  const extension = extname(original)
  const originalStem = extension ? original.slice(0, -extension.length) : original

  const id = parseInt(userId, 10)
  let reporter = {}
  if (id) {
    const res = await query(
      `SELECT u.user_username, p.person_first_name_la, p.person_last_name_la,
              p.person_first_name_ar, p.person_last_name_ar
         FROM "user" u
         LEFT JOIN person p ON p.person_id = u.person_id
        WHERE u.user_id = $1`,
      [id]
    )
    reporter = res.data?.[0] || {}
  }

  const storedName = resourceFileName([
    reporter.USER_USERNAME,
    reporter.PERSON_FIRST_NAME_LA,
    reporter.PERSON_LAST_NAME_LA,
    reporter.PERSON_FIRST_NAME_AR,
    reporter.PERSON_LAST_NAME_AR,
    originalStem
  ], extension)
  const destPath = newResourceFile('screenshots', [], storedName)
  fs.copyFileSync(filePath, destPath)
  // The key, not the absolute path: triage may run on another machine.
  return { success: true, path: toStoredKey('screenshots', destPath) }
}

// All reports with reporter/resolver names, newest first (consult page).
export async function getBugReports() {
  return await query(`
    SELECT b.*,
           u.user_username AS reporter_username,
           COALESCE(p.person_first_name_la, p.person_first_name_ar) AS reporter_first_name,
           p.person_first_name_la AS reporter_first_name_la,
           p.person_first_name_ar AS reporter_first_name_ar,
           COALESCE(p.person_last_name_la, p.person_last_name_ar) AS reporter_last_name,
           p.person_last_name_la AS reporter_last_name_la,
           p.person_last_name_ar AS reporter_last_name_ar,
           ru.user_username AS resolver_username
    FROM bug_report b
    JOIN "user" u ON u.user_id = b.user_id
    LEFT JOIN person p ON p.person_id = u.person_id
    LEFT JOIN "user" ru ON ru.user_id = b.resolved_by
    ORDER BY b.created_at DESC`)
}

// The reports one user submitted, with the status triage gave them — the
// reporter's own view, newest first. Only the reports written by that account
// are returned, so the page cannot show anybody else's.
export async function getMyBugReports(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  return await query(
    `SELECT b.report_id, b.report_subject, b.report_description, b.report_status,
            b.report_priority, b.report_screenshot_path, b.created_at, b.updated_at,
            b.resolved_at, b.resolution_note,
            ru.user_username AS resolver_username,
            COALESCE(rp.person_first_name_la, rp.person_first_name_ar) AS resolver_first_name,
            rp.person_first_name_la AS resolver_first_name_la,
            rp.person_first_name_ar AS resolver_first_name_ar,
            COALESCE(rp.person_last_name_la, rp.person_last_name_ar) AS resolver_last_name,
            rp.person_last_name_la AS resolver_last_name_la,
            rp.person_last_name_ar AS resolver_last_name_ar
     FROM bug_report b
     LEFT JOIN "user" ru ON ru.user_id = b.resolved_by
     LEFT JOIN person rp ON rp.person_id = ru.person_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC, b.report_id DESC`,
    [id]
  )
}

// Open the attached screenshot with the OS default application.
export async function openBugScreenshot(reportId) {
  const res = await query('SELECT report_screenshot_path FROM bug_report WHERE report_id = $1', [reportId])
  const stored = res.data?.[0]?.REPORT_SCREENSHOT_PATH
  if (!stored) return { error: 'This report has no screenshot attached.' }
  const path = resolveStoredResource(stored, 'screenshots')
  if (!path || !fs.existsSync(path)) return { error: 'The screenshot file is missing on disk.' }
  const { shell } = await import('electron')
  const errorMessage = await shell.openPath(path)
  if (errorMessage) return { error: `Could not open screenshot: ${errorMessage}` }
  return { success: true }
}

// Triage/update a report (ADMIN / DEVELOPER page). Status transitions to
// solved/dismissed stamp resolved_at/resolved_by; reopening clears them.
export async function updateBugReport(reportId, data, actingUserId) {
  const allowed = ['report_status', 'report_priority', 'resolution_note']
  const sets = []
  const vals = []
  for (const key of allowed) {
    const camel = key.toUpperCase()
    if (camel in data) {
      vals.push(data[camel] === '' ? null : data[camel])
      sets.push(`${key} = $${vals.length}`)
    }
  }
  if (sets.length === 0) return { success: true }

  // The payload arrives with upper-case column keys (REPORT_STATUS), so this
  // check has to use the same form — otherwise a closed report is never stamped
  // with who closed it and when.
  if (data.REPORT_STATUS !== undefined) {
    if (data.REPORT_STATUS === 'solved' || data.REPORT_STATUS === 'dismissed') {
      vals.push(new Date())
      sets.push(`resolved_at = $${vals.length}`)
      vals.push(actingUserId || null)
      sets.push(`resolved_by = $${vals.length}`)
    } else {
      sets.push('resolved_at = NULL')
      sets.push('resolved_by = NULL')
    }
  }

  vals.push(reportId)
  await query(`UPDATE bug_report SET ${sets.join(', ')} WHERE report_id = $${vals.length}`, vals)
  return { success: true }
}
