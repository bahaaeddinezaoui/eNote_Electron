import { query, withTransaction } from '../db'

const MAX_FEATURE_LENGTH = 500

// All changelog entries, newest release first, each with its ordered feature
// bullets (the `feature` table replaces the old content_en/ar/fr columns).
export async function getChangelogs() {
  const [entries, features] = await Promise.all([
    query('SELECT * FROM changelog ORDER BY release_date DESC, changelog_id DESC'),
    query('SELECT * FROM feature ORDER BY changelog_id, feature_index')
  ])

  const byEntry = new Map()
  for (const f of features.data || []) {
    if (!byEntry.has(f.CHANGELOG_ID)) byEntry.set(f.CHANGELOG_ID, [])
    byEntry.get(f.CHANGELOG_ID).push(f)
  }

  return {
    source: entries.source,
    rowCount: entries.rowCount,
    data: (entries.data || []).map(entry => ({
      ...entry,
      FEATURES: byEntry.get(entry.CHANGELOG_ID) || []
    }))
  }
}

// Features are inserted one by one in the UI; the array order becomes the
// 0-based feature_index. Blank rows are ignored, and every kept feature must
// carry its English text so the primary list is never empty.
function normalizeFeatures(raw) {
  const list = Array.isArray(raw) ? raw : []
  const features = []

  for (const item of list) {
    const en = String(item?.en ?? item?.EN ?? '').trim()
    const ar = String(item?.ar ?? item?.AR ?? '').trim()
    const fr = String(item?.fr ?? item?.FR ?? '').trim()
    if (!en && !ar && !fr) continue
    if (!en) throw new Error('Every feature needs its English text.')

    for (const [text, language] of [[en, 'English'], [ar, 'Arabic'], [fr, 'French']]) {
      if (text.length > MAX_FEATURE_LENGTH) {
        throw new Error(`${language} feature text cannot exceed ${MAX_FEATURE_LENGTH} characters.`)
      }
    }
    features.push({ en, ar: ar || null, fr: fr || null })
  }

  if (features.length === 0) throw new Error('Add at least one feature to the version.')
  return features
}

function normalizeChangelog(data) {
  const version = (data.version || '').trim()
  const releaseDate = (data.release_date || '').trim()
  const titleEn = (data.title_en || '').trim()
  const titleAr = (data.title_ar || '').trim()
  if (!version) throw new Error('Version is required.')
  if (!releaseDate) throw new Error('Release date is required.')
  if (!titleEn || !titleAr) throw new Error('English and Arabic titles are required.')
  return {
    version,
    release_date: releaseDate,
    title_en: titleEn,
    title_ar: titleAr,
    title_fr: (data.title_fr || '').trim() || null,
    features: normalizeFeatures(data.features)
  }
}

async function writeFeatures(tx, changelogId, features) {
  for (let index = 0; index < features.length; index++) {
    const f = features[index]
    await tx(
      `INSERT INTO feature (changelog_id, feature_index, feature_text_en, feature_text_ar, feature_text_fr)
       VALUES ($1, $2, $3, $4, $5)`,
      [changelogId, index, f.en, f.ar, f.fr]
    )
  }
}

export async function createChangelog(data) {
  const c = normalizeChangelog(data)
  return await withTransaction(async (tx) => {
    const res = await tx(
      `INSERT INTO changelog (version, release_date, title_en, title_ar, title_fr)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING changelog_id`,
      [c.version, c.release_date, c.title_en, c.title_ar, c.title_fr]
    )
    const changelogId = res.data?.[0]?.CHANGELOG_ID
    await writeFeatures(tx, changelogId, c.features)
    return { success: true, changelogId }
  })
}

// Updates the header and replaces the feature list atomically, so an entry can
// never end up with a half-written set of bullets.
export async function updateChangelog(id, data) {
  const c = normalizeChangelog(data)
  return await withTransaction(async (tx) => {
    const res = await tx(
      `UPDATE changelog
       SET version = $1, release_date = $2, title_en = $3, title_ar = $4, title_fr = $5
       WHERE changelog_id = $6
       RETURNING changelog_id`,
      [c.version, c.release_date, c.title_en, c.title_ar, c.title_fr, id]
    )
    const changelogId = res.data?.[0]?.CHANGELOG_ID
    if (!changelogId) throw new Error('Changelog entry not found.')

    await tx('DELETE FROM feature WHERE changelog_id = $1', [changelogId])
    await writeFeatures(tx, changelogId, c.features)
    return { success: true }
  })
}

// Features are removed by the ON DELETE CASCADE on feature.changelog_id.
export async function deleteChangelog(id) {
  await query('DELETE FROM changelog WHERE changelog_id = $1', [id])
  return { success: true }
}

// The newest release this account has not been announced yet, with its feature
// bullets. Only one entry is ever returned: when several releases were missed,
// the newest one is announced and the rest stay on the changelog page, so a
// long absence produces one dialog and not a queue of them.
export async function getPendingChangelog(userId) {
  const id = parseInt(userId, 10)
  if (!id) throw new Error('Not allowed: you must be signed in.')

  const res = await query(
    `SELECT c.*
       FROM changelog c
      WHERE NOT EXISTS (
        SELECT 1 FROM user_seen_changelog s
         WHERE s.user_id = $1 AND s.changelog_id = c.changelog_id
      )
      ORDER BY c.release_date DESC, c.changelog_id DESC
      LIMIT 1`,
    [id]
  )
  const entry = res.data?.[0]
  if (!entry) return { success: true, changelog: null }

  const features = await query(
    'SELECT * FROM feature WHERE changelog_id = $1 ORDER BY feature_index',
    [entry.CHANGELOG_ID]
  )
  return { success: true, changelog: { ...entry, FEATURES: features.data || [] } }
}

// Records that this account is up to date with the given release: the release
// itself and every older one are marked seen, so somebody who missed three
// versions is caught up by the single dialog they were shown instead of being
// walked through the backlog on the next three sign-ins. Newer releases are
// left alone. Idempotent, so closing the dialog twice is harmless.
export async function markChangelogSeen(userId, changelogId) {
  const id = parseInt(userId, 10)
  const entry = parseInt(changelogId, 10)
  if (!id || !entry) throw new Error('Not allowed: you must be signed in.')
  await query(
    `INSERT INTO user_seen_changelog (user_id, changelog_id)
     SELECT $1, c.changelog_id
       FROM changelog c
      WHERE (c.release_date, c.changelog_id) <= (
              SELECT release_date, changelog_id FROM changelog WHERE changelog_id = $2
            )
     ON CONFLICT DO NOTHING`,
    [id, entry]
  )
  return { success: true }
}

// Does the given user hold ADMIN or DEVELOPER?
export async function userCanManageChangelog(userId) {
  const res = await query(
    `SELECT 1 FROM "user" u
     JOIN "role" r ON r.role_id = u.role_id
     WHERE u.user_id = $1 AND r.role_code IN ('ADMIN', 'DEVELOPER')
     LIMIT 1`,
    [userId]
  )
  return res.rowCount > 0
}
