// Give every study week its Friday and Saturday study days.
//
// Weeks created from legacy data (or generated with Friday/Saturday marked as
// non-teaching days) only carry Sunday–Thursday study_day rows, so the weekly
// timetable has no Friday or Saturday column and those days cannot be
// scheduled. This script inserts the missing rows for every week that runs
// Sunday→Saturday, staying inside the semester's own date range.
//
// Run from the project root (after 04-align-study-weeks.js):
//   node deploy/server/05-add-friday-saturday-days.js
//
// Safe to re-run: existing days are kept, only missing ones are inserted.

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg

const MISSING_WEEKEND_DAYS = `
  WITH cal AS (
    SELECT w.study_week_id, gs::date AS d
    FROM study_week w
    JOIN study_semester s ON s.study_semester_id = w.study_semester_id
    CROSS JOIN LATERAL generate_series(
      w.study_week_start_date::timestamp,
      w.study_week_end_date::timestamp,
      interval '1 day'
    ) gs
    WHERE gs::date BETWEEN s.study_semester_start_date AND s.study_semester_end_date
  )
  SELECT COUNT(*)::int AS n
  FROM cal c
  WHERE EXTRACT(DOW FROM c.d)::int IN (5, 6)
    AND NOT EXISTS (
      SELECT 1 FROM study_day d
      WHERE d.study_week_id = c.study_week_id AND d.study_day_date = c.d
    )
`

async function main() {
  const config = JSON.parse(await readFile(path.join(process.cwd(), 'pg_config.json'), 'utf8'))
  const db = new Client(config)
  await db.connect()

  try {
    await db.query('BEGIN')

    const inserted = await db.query(`
      INSERT INTO study_day (study_week_id, study_day_date)
      SELECT w.study_week_id, gs::date
      FROM study_week w
      JOIN study_semester s ON s.study_semester_id = w.study_semester_id
      CROSS JOIN LATERAL generate_series(
        w.study_week_start_date::timestamp,
        w.study_week_end_date::timestamp,
        interval '1 day'
      ) gs
      WHERE EXTRACT(DOW FROM gs)::int IN (5, 6)
        AND gs::date BETWEEN s.study_semester_start_date AND s.study_semester_end_date
      ON CONFLICT (study_week_id, study_day_date) DO NOTHING
    `)

    const { rows: missing } = await db.query(MISSING_WEEKEND_DAYS)
    if (missing[0].n > 0) {
      throw new Error(
        `${missing[0].n} Friday/Saturday study day(s) are still missing. Nothing was committed.`
      )
    }

    const { rows: totals } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM study_week) AS weeks,
              (SELECT COUNT(*)::int FROM study_day) AS days,
              (SELECT COUNT(*)::int FROM study_session) AS sessions`
    )

    await db.query('COMMIT')
    console.log(`Added ${inserted.rowCount} Friday/Saturday study day(s).`)
    console.log(
      `Totals: ${totals[0].weeks} weeks, ${totals[0].days} days, ${totals[0].sessions} sessions.`
    )
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  } finally {
    await db.end()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
