import { isOffline, query, withTransaction } from '../db'
import { enqueueOutbox } from '../offlineOutbox'

const SEVERITIES = ['low', 'medium', 'high', 'critical']
const MAX_OVERALL_COMMENT = 10000
const MAX_DESCRIPTION = 4000
const MAX_ENVIRONMENT = 120

// Beta testing is open only to accounts an admin flagged in the options page.
// The flag is read from the database, never taken from the renderer.
async function requireBetaTesterId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')
  const res = await query('SELECT is_beta_tester FROM "user" WHERE user_id = $1', [id])
  const row = res.data?.[0]
  if (!row) throw new Error('User not found.')
  if (!row.IS_BETA_TESTER) throw new Error('Not allowed: requires a beta tester account.')
  return id
}

// Every released version with its features and this tester's existing report
// (report header + per-feature answers), newest release first.
export async function getBetaTestVersions(userId) {
  const testerId = await requireBetaTesterId(userId)

  const [entries, features, reports, answers] = await Promise.all([
    query('SELECT * FROM changelog ORDER BY release_date DESC, changelog_id DESC'),
    query('SELECT * FROM feature ORDER BY changelog_id, feature_index'),
    query('SELECT * FROM beta_test_report WHERE user_id = $1', [testerId]),
    query(
      `SELECT f.* FROM beta_test_feature f
       JOIN beta_test_report r ON r.beta_test_report_id = f.beta_test_report_id
       WHERE r.user_id = $1
       ORDER BY f.feature_index`,
      [testerId]
    )
  ])

  const featuresByEntry = new Map()
  for (const f of features.data || []) {
    if (!featuresByEntry.has(f.CHANGELOG_ID)) featuresByEntry.set(f.CHANGELOG_ID, [])
    featuresByEntry.get(f.CHANGELOG_ID).push(f)
  }

  const reportByEntry = new Map((reports.data || []).map(r => [r.CHANGELOG_ID, r]))
  const answersByReport = new Map()
  for (const a of answers.data || []) {
    if (!answersByReport.has(a.BETA_TEST_REPORT_ID)) answersByReport.set(a.BETA_TEST_REPORT_ID, [])
    answersByReport.get(a.BETA_TEST_REPORT_ID).push(a)
  }

  return {
    success: true,
    data: (entries.data || []).map(entry => {
      const report = reportByEntry.get(entry.CHANGELOG_ID) || null
      return {
        ...entry,
        FEATURES: featuresByEntry.get(entry.CHANGELOG_ID) || [],
        REPORT: report
          ? { ...report, FEATURES: answersByReport.get(report.BETA_TEST_REPORT_ID) || [] }
          : null
      }
    })
  }
}

// ---- Review (ADMIN / DEVELOPER) ---------------------------------------------
// The other side of the same data: what testers reported, per version. Only an
// administrator or a developer may read it, checked against the account's
// role_id rather than the roles the renderer claims.
async function requireReviewerId(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code IN ('ADMIN', 'DEVELOPER')
     LIMIT 1`,
    [id]
  )
  if (res.rowCount === 0) throw new Error('Not allowed: requires the Admin or Developer role.')
  return id
}

// Every version with the reports filed against it, each report carrying its
// per-feature answers (with the bullet as published) and the tester's identity.
// Versions nobody has reported on are returned too, so the page can show what is
// still untested.
export async function getBetaTestReports(userId) {
  await requireReviewerId(userId)

  const [entries, features, reports, answers] = await Promise.all([
    query('SELECT * FROM changelog ORDER BY release_date DESC, changelog_id DESC'),
    query('SELECT * FROM feature ORDER BY changelog_id, feature_index'),
    query(
      `SELECT r.*,
              u.user_username AS tester_username,
              COALESCE(p.person_first_name_la, p.person_first_name_ar) AS tester_first_name,
              p.person_first_name_la AS tester_first_name_la,
              p.person_first_name_ar AS tester_first_name_ar,
              COALESCE(p.person_last_name_la, p.person_last_name_ar) AS tester_last_name,
              p.person_last_name_la AS tester_last_name_la,
              p.person_last_name_ar AS tester_last_name_ar
       FROM beta_test_report r
       JOIN "user" u ON u.user_id = r.user_id
       LEFT JOIN person p ON p.person_id = u.person_id
       ORDER BY COALESCE(r.updated_at, r.created_at) DESC, r.beta_test_report_id DESC`
    ),
    query('SELECT * FROM beta_test_feature ORDER BY beta_test_report_id, feature_index')
  ])

  const featuresByEntry = new Map()
  for (const f of features.data || []) {
    if (!featuresByEntry.has(f.CHANGELOG_ID)) featuresByEntry.set(f.CHANGELOG_ID, [])
    featuresByEntry.get(f.CHANGELOG_ID).push(f)
  }

  const answersByReport = new Map()
  for (const a of answers.data || []) {
    if (!answersByReport.has(a.BETA_TEST_REPORT_ID)) answersByReport.set(a.BETA_TEST_REPORT_ID, [])
    answersByReport.get(a.BETA_TEST_REPORT_ID).push(a)
  }

  const reportsByEntry = new Map()
  for (const r of reports.data || []) {
    if (!reportsByEntry.has(r.CHANGELOG_ID)) reportsByEntry.set(r.CHANGELOG_ID, [])
    reportsByEntry.get(r.CHANGELOG_ID).push({
      ...r,
      FEATURES: answersByReport.get(r.BETA_TEST_REPORT_ID) || []
    })
  }

  return {
    success: true,
    data: (entries.data || []).map(entry => ({
      ...entry,
      FEATURES: featuresByEntry.get(entry.CHANGELOG_ID) || [],
      REPORTS: reportsByEntry.get(entry.CHANGELOG_ID) || []
    }))
  }
}

// Validate the submitted answers against the version's published features and
// write the report atomically. Re-saving replaces the previous set of answers
// while keeping the single report row for this tester + version.
export async function saveBetaTestReport(userId, changelogId, data) {
  const entryId = parseInt(changelogId, 10)
  if (!entryId) throw new Error('Version is required.')

  // Offline the answers are kept here and validated when the queue is sent, by
  // the same checks a direct save runs — including the tester flag and the
  // version's published features, which only the server can confirm.
  if (isOffline()) {
    const id = enqueueOutbox({
      kind: 'betaTest.save',
      userId: parseInt(userId, 10) || null,
      additive: true,
      desired: { changelogId: entryId, data }
    })
    if (!id) {
      throw new Error('The server is unreachable and this computer could not store the report. Try again.')
    }
    return { success: true, queued: true, outboxId: id }
  }

  const testerId = await requireBetaTesterId(userId)

  const overallComment = String(data?.overallComment ?? '').trim()
  if (overallComment.length > MAX_OVERALL_COMMENT) {
    throw new Error(`Overall feedback cannot exceed ${MAX_OVERALL_COMMENT} characters.`)
  }

  // Where the tester ran the build: browser, OS or device. Optional, and no
  // longer asked for in the form — when the field is absent the stored value is
  // left untouched, so re-saving an older report cannot erase it.
  const hasEnvironment = data != null && Object.prototype.hasOwnProperty.call(data, 'testEnvironment')
  const testEnvironment = hasEnvironment ? String(data.testEnvironment ?? '').trim() : ''
  if (testEnvironment.length > MAX_ENVIRONMENT) {
    throw new Error(`Test environment cannot exceed ${MAX_ENVIRONMENT} characters.`)
  }

  // Snapshot the published bullet text with the report, as the source table does.
  const featureRes = await query(
    'SELECT feature_index, feature_text_en FROM feature WHERE changelog_id = $1',
    [entryId]
  )
  const featureTexts = new Map((featureRes.data || []).map(f => [f.FEATURE_INDEX, f.FEATURE_TEXT_EN]))
  if (featureTexts.size === 0) throw new Error('This version has no features to report on.')

  const submitted = Array.isArray(data?.features) ? data.features : []
  const rows = []
  const seen = new Set()

  for (const item of submitted) {
    const index = parseInt(item?.featureIndex, 10)
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid feature in the report.')
    if (!featureTexts.has(index)) throw new Error('Unknown feature in this version.')
    if (seen.has(index)) throw new Error('A feature appears twice in the report.')
    seen.add(index)

    const isTested = !!item.isTested
    const hasProblems = !!item.hasProblems
    if (hasProblems && !isTested) throw new Error('A feature with problems must be marked as tested.')

    let severity = null
    if (hasProblems) {
      severity = String(item.problemSeverity || 'medium').toLowerCase()
      if (!SEVERITIES.includes(severity)) {
        throw new Error(`Invalid problem severity "${item.problemSeverity}".`)
      }
    }

    const description = String(item.description ?? '').trim()
    if (description.length > MAX_DESCRIPTION) {
      throw new Error(`Feature description cannot exceed ${MAX_DESCRIPTION} characters.`)
    }

    rows.push({ index, isTested, hasProblems, severity, description: description || null })
  }

  if (rows.length === 0) throw new Error('Mark at least one feature in the report.')

  return await withTransaction(async (tx) => {
    const reportRes = await tx(
      `INSERT INTO beta_test_report (user_id, changelog_id, test_environment, overall_comment, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, changelog_id)
       DO UPDATE SET test_environment = CASE WHEN $5::boolean
                                             THEN EXCLUDED.test_environment
                                             ELSE beta_test_report.test_environment END,
                     overall_comment = EXCLUDED.overall_comment,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING beta_test_report_id`,
      [testerId, entryId, testEnvironment || null, overallComment || null, hasEnvironment]
    )
    const reportId = reportRes.data?.[0]?.BETA_TEST_REPORT_ID
    if (!reportId) throw new Error('Could not save the beta test report.')

    await tx('DELETE FROM beta_test_feature WHERE beta_test_report_id = $1', [reportId])
    for (const row of rows) {
      await tx(
        `INSERT INTO beta_test_feature
           (beta_test_report_id, feature_index, feature_text, is_tested, has_problems, problem_severity, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [reportId, row.index, featureTexts.get(row.index) || null, row.isTested, row.hasProblems, row.severity, row.description]
      )
    }

    return { success: true, reportId }
  })
}
