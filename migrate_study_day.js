// Migration: replace study_session.study_session_day_of_week (+ study_week_id)
// with a dedicated study_day table whose PK (study_day_id) is referenced by
// study_session. Each study_day stores the day as an actual date.
//
// Usage:
//   node migrate_study_day.js
//   PGUSER=... PGPASSWORD=... node migrate_study_day.js
import { Pool } from 'pg'

const config = {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  password: process.env.PGPASSWORD || '08212001',
  database: process.env.PGDATABASE || 'eNote'
}

const statements = [
  // 1. Create the study_day table (same shape as eNote_pg.sql)
  `
  CREATE TABLE IF NOT EXISTS study_day (
    study_day_id SERIAL PRIMARY KEY,
    study_week_id int NOT NULL,
    study_day_date date NOT NULL,
    CONSTRAINT uq_study_day_week_date UNIQUE (study_week_id, study_day_date)
  )
  `,
  `CREATE INDEX IF NOT EXISTS idx_study_day_date ON study_day (study_day_date)`,

  // 2. Backfill one study_day row per date covered by each study week
  `
  INSERT INTO study_day (study_week_id, study_day_date)
  SELECT w.study_week_id, d::date
  FROM study_week w
  CROSS JOIN LATERAL generate_series(
    w.study_week_start_date::timestamp,
    w.study_week_end_date::timestamp,
    INTERVAL '1 day'
  ) AS d
  WHERE w.study_week_start_date IS NOT NULL AND w.study_week_end_date IS NOT NULL
  ON CONFLICT (study_week_id, study_day_date) DO NOTHING
  `,

  // 3. Add the FK column to study_session
  `ALTER TABLE study_session ADD COLUMN IF NOT EXISTS study_day_id int`,

  // 4. Relink every session to the study_day matching its old
  //    (week start date + day-of-week offset - 1) slot.
  `
  UPDATE study_session s
  SET study_day_id = d.study_day_id
  FROM study_day d
  JOIN study_week w ON d.study_week_id = w.study_week_id
  WHERE s.study_day_id IS NULL
    AND d.study_day_date = w.study_week_start_date + (s.study_session_day_of_week - 1)
    AND s.study_week_id = w.study_week_id
  `,

  // 5. Enforce the new relationship and retire the old columns
  `
  ALTER TABLE study_session
    DROP CONSTRAINT IF EXISTS fk_study_session_week
  `,
  `
  ALTER TABLE study_session
    ADD CONSTRAINT fk_study_session_day
    FOREIGN KEY (study_day_id) REFERENCES study_day (study_day_id) ON DELETE CASCADE
  `,
  `ALTER TABLE study_session DROP COLUMN IF EXISTS study_session_day_of_week`,
  `ALTER TABLE study_session DROP COLUMN IF EXISTS study_week_id`
]

async function migrate() {
  const pool = new Pool(config)
  const client = await pool.connect()
  try {
    console.log(`Connected to ${config.database} on ${config.host}:${config.port}`)

    const before = await client.query('SELECT COUNT(*)::int AS n FROM study_session WHERE study_session_day_of_week IS NOT NULL')
    const toMigrate = before.rows[0].n

    console.log('Starting migration (single transaction)...')
    await client.query('BEGIN')
    for (const sql of statements) {
      await client.query(sql)
    }

    const after = await client.query('SELECT COUNT(*)::int AS n FROM study_session WHERE study_day_id IS NULL')
    const unmigrated = after.rows[0].n

    if (unmigrated > 0) {
      throw new Error(
        `${unmigrated} study_session row(s) could not be linked to a study_day ` +
        `(their day-of-week offset falls outside the week's date range). ` +
        `Fix or remove those sessions, then re-run. Nothing was changed.`
      )
    }

    const orphanSessions = await client.query('SELECT COUNT(*)::int AS n FROM study_session s WHERE NOT EXISTS (SELECT 1 FROM study_day d WHERE d.study_day_id = s.study_day_id)')
    if (orphanSessions.rows[0].n > 0) {
      throw new Error(`${orphanSessions.rows[0].n} study_session row(s) reference no existing study_day. Nothing was changed.`)
    }

    await client.query('COMMIT')
    console.log(`Migration committed. Linked ${toMigrate} session(s) to study_day rows.`)
    console.log('The old study_session_day_of_week / study_week_id columns were dropped.')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('Migration failed:', error.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
