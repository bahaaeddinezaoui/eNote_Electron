// Align every stored study week to the application's Sunday→Saturday week and
// re-home its study days. Sessions hang off study_day rows, so nothing that is
// scheduled moves or disappears.
//
// Legacy imports (and the old week generator) stored weeks as seven-day chunks
// starting on the term's first day — a Thursday, for example. A week could
// then contain days from two calendar weeks, and the timetable showed
// "Sunday Nov 15 … Thursday Nov 12". This script keeps each week's id, code and
// label, snaps its boundaries, and moves every day to the week that contains
// its date (creating the following week when a legacy chunk overran its
// aligned Saturday).
//
// Run from the project root:
//   node deploy/server/04-align-study-weeks.js
//
// Safe to re-run: already aligned weeks and days are left untouched.

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

const { Client } = pg
const DAY_MS = 24 * 60 * 60 * 1000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const utc = (dateStr) => Date.parse(`${dateStr}T00:00:00Z`)
const dayOfWeek = (dateStr) => new Date(utc(dateStr)).getUTCDay()
const sundayOf = (dateStr) => iso(utc(dateStr) - dayOfWeek(dateStr) * DAY_MS)

async function main() {
  const config = JSON.parse(await readFile(path.join(process.cwd(), 'pg_config.json'), 'utf8'))
  const db = new Client(config)
  await db.connect()

  let movedWeeks = 0
  let movedDays = 0
  let createdWeeks = 0

  try {
    await db.query('BEGIN')

    const { rows: semesters } = await db.query(
      `SELECT study_semester_id AS id, study_semester_code AS code
         FROM study_semester ORDER BY study_semester_id`
    )

    for (const semester of semesters) {
      const { rows: weeks } = await db.query(
        `SELECT study_week_id AS id, study_week_code AS code,
                study_week_start_date::text AS start, study_week_end_date::text AS end
           FROM study_week
          WHERE study_semester_id = $1
          ORDER BY study_week_start_date, study_week_id`,
        [semester.id]
      )
      if (weeks.length === 0) continue

      // 1. Every week becomes the Sunday→Saturday block that contains its start.
      const windows = weeks.map((week) => {
        const start = sundayOf(week.start)
        return { id: week.id, start, end: iso(utc(start) + 6 * DAY_MS) }
      })

      for (let i = 1; i < windows.length; i++) {
        if (windows[i].start <= windows[i - 1].end) {
          throw new Error(
            `Semester ${semester.code}: weeks ${windows[i - 1].id} and ${windows[i].id} ` +
              'would overlap after alignment. Fix those two weeks by hand first.'
          )
        }
      }

      for (let i = 0; i < weeks.length; i++) {
        if (weeks[i].start === windows[i].start && weeks[i].end === windows[i].end) continue
        await db.query(
          `UPDATE study_week SET study_week_start_date = $1::date, study_week_end_date = $2::date
            WHERE study_week_id = $3`,
          [windows[i].start, windows[i].end, windows[i].id]
        )
        movedWeeks += 1
      }

      // 2. Move each day to the week that contains its date. The windows are
      // contiguous seven-day blocks, so a legacy chunk that straddled two
      // calendar weeks is split between them.
      const { rows: days } = await db.query(
        `SELECT d.study_day_id AS id, d.study_day_date::text AS date, d.study_week_id AS week
           FROM study_day d
           JOIN study_week w ON w.study_week_id = d.study_week_id
          WHERE w.study_semester_id = $1
          ORDER BY d.study_day_date`,
        [semester.id]
      )

      const { rows: codeRows } = await db.query(
        'SELECT study_week_code AS code FROM study_week WHERE study_semester_id = $1',
        [semester.id]
      )
      const usedCodes = new Set(codeRows.map((row) => row.code))
      let lastEnd = windows[windows.length - 1].end

      // A legacy last chunk can run one or more days past its aligned Saturday;
      // that date opens the following Sunday→Saturday week.
      const appendWeek = async () => {
        const start = iso(utc(lastEnd) + DAY_MS)
        const end = iso(utc(start) + 6 * DAY_MS)
        let n = windows.length + 1
        while (usedCodes.has(`W${n}`)) n += 1
        usedCodes.add(`W${n}`)
        const { rows } = await db.query(
          `INSERT INTO study_week
             (study_semester_id, study_week_code, study_week_label_en, study_week_start_date, study_week_end_date)
           VALUES ($1, $2, $3, $4::date, $5::date)
           RETURNING study_week_id AS id`,
          [semester.id, `W${n}`, `Week ${n}`, start, end]
        )
        windows.push({ id: rows[0].id, start, end })
        lastEnd = end
        createdWeeks += 1
      }

      for (const day of days) {
        while (day.date > lastEnd) await appendWeek()
        const target = [...windows].reverse().find((w) => day.date >= w.start && day.date <= w.end)
        if (!target) {
          throw new Error(`Semester ${semester.code}: no aligned week covers ${day.date}.`)
        }
        if (target.id !== day.week) {
          await db.query('UPDATE study_day SET study_week_id = $1 WHERE study_day_id = $2', [
            target.id,
            day.id
          ])
          movedDays += 1
        }
      }
    }

    // 3. Verify before committing: every week Sunday→Saturday, every day inside
    // its week, and the session rows untouched.
    const { rows: badWeeks } = await db.query(
      `SELECT COUNT(*)::int AS n FROM study_week
        WHERE EXTRACT(DOW FROM study_week_start_date) <> 0
           OR study_week_end_date <> study_week_start_date + 6`
    )
    const { rows: badDays } = await db.query(
      `SELECT COUNT(*)::int AS n
         FROM study_day d
         JOIN study_week w ON w.study_week_id = d.study_week_id
        WHERE d.study_day_date < w.study_week_start_date
           OR d.study_day_date > w.study_week_end_date`
    )
    if (badWeeks[0].n > 0 || badDays[0].n > 0) {
      throw new Error(
        `Verification failed: ${badWeeks[0].n} week(s) not Sunday→Saturday, ` +
          `${badDays[0].n} day(s) outside their week. Nothing was committed.`
      )
    }

    const { rows: totals } = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM study_week) AS weeks,
              (SELECT COUNT(*)::int FROM study_day) AS days,
              (SELECT COUNT(*)::int FROM study_session) AS sessions`
    )

    await db.query('COMMIT')
    console.log(
      `Aligned ${movedWeeks} week(s), moved ${movedDays} day(s), created ${createdWeeks} week(s).`
    )
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
