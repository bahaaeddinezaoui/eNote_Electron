import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// ============================================================================
// load_location_data.js
// Replaces the geographic reference data (country, wilaya, daira, commune) in
// the PostgreSQL eNote database with the rows exported in location.sql
// (phpMyAdmin / MySQL dump).
//
// What it does:
//   1. Connects to the eNote PostgreSQL database (same connection logic as
//      the rest of the project's tooling).
//   2. Deletes the current rows: address, commune, daira, wilaya, country
//      (child tables first, respecting FKs).
//   3. Parses the INSERT INTO ... VALUES rows for those 4 tables out of
//      location.sql and bulk-inserts them into PostgreSQL, preserving the
//      original IDs from the dump (wilaya_id -> daira_id -> commune_id
//      references depend on them).
//   4. Resets each ID sequence so future app inserts continue after the
//      loaded data.
//
// The `address` table is emptied (it had no rows in the dump) but is NOT
// repopulated: it holds application-created street addresses, not reference
// data.
//
// Usage:
//   node load_location_data.js
//   PGUSER=postgres PGPASSWORD=... PGHOST=localhost PGPORT=5432 node load_location_data.js
// ============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LOCATION_SQL_PATH = path.join(__dirname, 'location.sql')

// Tries the same databases and password candidates as the rest of the
// project's tooling (create_director_account.js, src/main/db.js).
const databases = ['eNote', 'enote']
const passwordCandidates = [
  process.env.PGPASSWORD,
  '08212001',
  'postgres',
  '',
  'root',
  'admin',
  '1234',
  '123456',
  'password'
].filter(p => p !== undefined)

const baseConfig = {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10)
}

// ----------------------------------------------------------------------------
// MySQL dump value parsing
// ----------------------------------------------------------------------------

// Parse one MySQL single-quoted string, handling backslash escapes.
// Returns { value, nextIndex } where nextIndex points right after the string.
function parseQuotedString(text, start) {
  // text[start] must be "'"
  let i = start + 1
  let out = ''
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === undefined) throw new Error('Unterminated string escape in dump')
      // MySQL escape sequences that matter for this data
      if (next === 'n') out += '\n'
      else if (next === 'r') out += '\r'
      else if (next === 't') out += '\t'
      else if (next === '0') out += '\0'
      else out += next // \' \" \\ etc. -> literal char
      i += 2
      continue
    }
    if (ch === "'") {
      // '' inside a quoted string is an escaped quote
      if (text[i + 1] === "'") {
        out += "'"
        i += 2
        continue
      }
      return { value: out, nextIndex: i + 1 }
    }
    out += ch
    i += 1
  }
  throw new Error('Unterminated string in dump')
}

// Find the end of a complete INSERT statement that begins at text[start].
// INSERTs in the dump end with ");\n" (the last row ends with ");" and the
// following line starts a new statement/comment). We scan for ");\n" while
// correctly skipping over quoted strings (which may contain ");\n").
function findStatementEnd(text, start) {
  let i = start
  while (i < text.length) {
    const ch = text[i]
    if (ch === "'") {
      const r = parseQuotedString(text, i)
      i = r.nextIndex
      continue
    }
    if (ch === ')' && text[i + 1] === ';' && text[i + 2] === '\n') {
      return i + 2 // index of the ';' inclusive
    }
    i += 1
  }
  throw new Error(`Could not find end of INSERT statement starting at ${start}`)
}

// Split the row tuples part of an INSERT into top-level "(...)" tuples.
function splitTuples(tuplesText) {
  const rows = []
  let i = 0
  while (i < tuplesText.length) {
    if (tuplesText[i] === '(') {
      let depth = 0
      let j = i
      let inString = false
      while (j < tuplesText.length) {
        const ch = tuplesText[j]
        if (inString) {
          if (ch === '\\') { j += 2; continue }
          if (ch === "'") {
            if (tuplesText[j + 1] === "'") { j += 2; continue } // '' escape
            inString = false
          }
          j += 1
          continue
        }
        if (ch === "'") { inString = true; j += 1; continue }
        if (ch === '(') { depth += 1; j += 1; continue }
        if (ch === ')') {
          depth -= 1
          if (depth === 0) break
          j += 1
          continue
        }
        j += 1
      }
      if (j >= tuplesText.length) throw new Error('Unbalanced tuple in dump')
      rows.push(tuplesText.slice(i + 1, j))
      i = j + 1
    } else {
      i += 1
    }
  }
  return rows
}

// Split a tuple body into its top-level comma-separated values (quote aware).
function splitTupleValues(tupleBody) {
  const values = []
  let current = ''
  let inString = false
  let i = 0
  while (i < tupleBody.length) {
    const ch = tupleBody[i]
    if (inString) {
      current += ch
      if (ch === '\\') {
        current += tupleBody[i + 1] || ''
        i += 2
        continue
      }
      if (ch === "'") {
        if (tupleBody[i + 1] === "'") { current += "'"; i += 2; continue }
        inString = false
      }
      i += 1
      continue
    }
    if (ch === "'") { inString = true; current += ch; i += 1; continue }
    if (ch === ',') { values.push(current.trim()); current = ''; i += 1; continue }
    current += ch
    i += 1
  }
  values.push(current.trim())
  return values
}

// Convert one raw SQL value (already trimmed) into a JS value.
function parseValue(raw) {
  if (raw === 'NULL') return null
  if (raw.startsWith("'")) {
    const inner = raw.slice(1, -1)
    // Unescape MySQL string escapes
    return inner
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
  }
  return parseInt(raw, 10)
}

// Extract all rows of `INSERT INTO \`table\` (cols) VALUES ...;` from the dump.
function extractTableRows(sqlText, tableName) {
  const rows = []
  const marker = 'INSERT INTO `' + tableName + '`'
  let pos = sqlText.indexOf(marker)
  while (pos !== -1) {
    const valuesIdx = sqlText.indexOf(' VALUES', pos)
    if (valuesIdx === -1) break
    const tuplesStart = sqlText.indexOf('(', valuesIdx)
    const endIdx = findStatementEnd(sqlText, tuplesStart)
    // Keep the opening '(' of the first tuple: splitTuples matches tuples by
    // their '(', and the final ')' before the ';' is a harmless trailing char.
    const tuplesText = sqlText.slice(tuplesStart, endIdx - 1)
    for (const tupleBody of splitTuples(tuplesText)) {
      const rawValues = splitTupleValues(tupleBody)
      rows.push(rawValues.map(parseValue))
    }
    pos = sqlText.indexOf(marker, endIdx)
  }
  return rows
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function connect() {
  for (const database of databases) {
    for (const password of passwordCandidates) {
      const pool = new Pool({ ...baseConfig, database, password, connectionTimeoutMillis: 5000 })
      pool.on('error', () => {})
      try {
        await pool.query('SELECT 1')
        return { pool, database }
      } catch (e) {
        await pool.end().catch(() => {})
      }
    }
  }
  throw new Error('Could not connect to PostgreSQL with any known database/password combination')
}

async function main() {
  console.log('=== Load Location Data (from location.sql into PostgreSQL) ===\n')

  const sqlText = fs.readFileSync(LOCATION_SQL_PATH, 'utf8')

  const countries = extractTableRows(sqlText, 'country')
  const wilayas = extractTableRows(sqlText, 'wilaya')
  const dairas = extractTableRows(sqlText, 'daira')
  const communes = extractTableRows(sqlText, 'commune')

  console.log(`Parsed from location.sql:`)
  console.log(`  country: ${countries.length} rows`)
  console.log(`  wilaya:  ${wilayas.length} rows`)
  console.log(`  daira:   ${dairas.length} rows`)
  console.log(`  commune: ${communes.length} rows\n`)

  if (countries.length === 0 || wilayas.length === 0 || dairas.length === 0 || communes.length === 0) {
    throw new Error('One or more tables parsed as empty from location.sql - aborting')
  }

  const { pool, database } = await connect()
  console.log(`Connected to PostgreSQL database: ${database}\n`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Wipe current data, children first. Also clear any app rows that
    //    reference the tables we are about to reload (they would dangle).
    await client.query('DELETE FROM student_emergency_contact')
    await client.query('DELETE FROM address')
    await client.query('DELETE FROM commune')
    await client.query('DELETE FROM daira')
    await client.query('DELETE FROM wilaya')
    await client.query('DELETE FROM country')

    // 2. Insert the dump rows, parents first, preserving original IDs.
    for (const [id, code, en, ar, fr] of countries) {
      await client.query(
        `INSERT INTO country (country_id, country_code, country_name_en, country_name_ar, country_name_fr)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, code, en, ar, fr]
      )
    }
    for (const [id, countryId, code, en, ar, fr] of wilayas) {
      await client.query(
        `INSERT INTO wilaya (wilaya_id, country_id, wilaya_code, wilaya_name_en, wilaya_name_ar, wilaya_name_fr)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, countryId, code, en, ar, fr]
      )
    }
    for (const [id, wilayaId, en, ar, fr] of dairas) {
      await client.query(
        `INSERT INTO daira (daira_id, wilaya_id, daira_name_en, daira_name_ar, daira_name_fr)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, wilayaId, en, ar, fr]
      )
    }
    for (const [id, dairaId, en, ar, fr] of communes) {
      await client.query(
        `INSERT INTO commune (commune_id, daira_id, commune_name_en, commune_name_ar, commune_name_fr)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, dairaId, en, ar, fr]
      )
    }

    // 3. Reset sequences so new app-created rows continue after the loaded IDs.
    for (const [table, column, seq] of [
      ['country', 'country_id', 'country_country_id_seq'],
      ['wilaya', 'wilaya_id', 'wilaya_wilaya_id_seq'],
      ['daira', 'daira_id', 'daira_daira_id_seq'],
      ['commune', 'commune_id', 'commune_commune_id_seq'],
      ['address', 'address_id', 'address_address_id_seq']
    ]) {
      await client.query(
        `SELECT setval($1, GREATEST((SELECT COALESCE(MAX(${column}), 1) FROM ${table}), 1), true)`
        , [seq]
      )
    }

    await client.query('COMMIT')

    // 4. Report the resulting counts.
    console.log('Data loaded. Final row counts:')
    for (const t of ['country', 'wilaya', 'daira', 'commune', 'address']) {
      const r = await client.query(`SELECT COUNT(*)::int n FROM ${t}`)
      console.log(`  ${t}: ${r.rows[0].n}`)
    }
    console.log('\n=== Done ===')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(e => {
  console.error('\n❌ Load failed:', e.message)
  process.exit(1)
})
