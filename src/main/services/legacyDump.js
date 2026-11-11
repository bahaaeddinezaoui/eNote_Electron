// Parser for the old application's MySQL dump (phpMyAdmin export).
//
// The importer never executes the dump: it reads it into memory and maps it onto
// the PostgreSQL schema through the reviewed table/column map in legacyImport.js.
// Only CREATE TABLE (for column names/types) and INSERT INTO (for rows) matter;
// every other statement — SET, LOCK TABLES, ALTER, DROP, comments — is skipped.
//
// Supported literal forms: quoted strings with backslash escapes and doubled
// quotes, NULL, integers/decimals, 0x… hexadecimal blobs and bare tokens such as
// true/false or unquoted dates. Rows come back keyed by the dump's own column
// names in upper case, which is how the mapper addresses them.

const IDENT = '`?([A-Za-z0-9_$.]+)`?'

function readString(text, start) {
  // start points at the opening quote.
  let value = ''
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      const next = text[i + 1]
      if (next === 'n') value += '\n'
      else if (next === 'r') value += '\r'
      else if (next === 't') value += '\t'
      else if (next === '0') value += '\0'
      else if (next === 'Z') value += '\x1a'
      else value += next ?? ''
      i++
      continue
    }
    if (ch === "'") {
      // A doubled quote is an escaped quote, not the end of the literal.
      if (text[i + 1] === "'") { value += "'"; i++; continue }
      // `end` is the position just past the closing quote; callers continue
      // scanning from there, so it must not point at the quote itself.
      return { value, end: i + 1 }
    }
    value += ch
  }
  throw new Error('Unterminated string in the dump.')
}

function readValue(text, start) {
  let i = start
  while (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t') i++
  if (text[i] === "'") {
    const { value, end } = readString(text, i)
    return { value, end }
  }
  if (/^null/i.test(text.slice(i, i + 4))) return { value: null, end: i + 4 }
  if (text[i] === '0' && (text[i + 1] === 'x' || text[i + 1] === 'X')) {
    let hex = ''
    i += 2
    while (/[0-9a-fA-F]/.test(text[i] || '')) { hex += text[i]; i++ }
    return { value: `0x${hex}`, end: i }
  }
  let raw = ''
  while (i < text.length && !',);'.includes(text[i])) { raw += text[i]; i++ }
  const trimmed = raw.trim()
  const numeric = /^-?\d+(\.\d+)?$/.test(trimmed)
  return { value: numeric ? Number(trimmed) : trimmed, end: i }
}

// Reads `(...),(...),(...)` after VALUES and calls onRow with each tuple.
function readTuples(text, start, onRow) {
  let i = start
  let count = 0
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++
    if (text[i] === ';' || text[i] === undefined) break
    if (text[i] !== '(') {
      // Not a tuple: let the caller decide (a trailing comment or statement end).
      const nextSemi = text.indexOf(';', i)
      i = nextSemi === -1 ? text.length : nextSemi
      break
    }
    i++
    const row = []
    while (i < text.length) {
      const read = readValue(text, i)
      row.push(read.value)
      i = read.end
      while (i < text.length && /\s/.test(text[i])) i++
      if (text[i] === ',') { i++; continue }
      if (text[i] === ')') { i++; break }
      // Unexpected character: stop this tuple rather than guessing.
      break
    }
    onRow(row)
    count++
  }
  return { end: i, count }
}

function stripName(raw) {
  return String(raw || '').replace(/[`"]/g, '')
}

// Splits a CREATE TABLE body on its top-level commas, so enum('a','b') and
// decimal(5,2) stay in one piece.
function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let quote = null
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      current += ch
      if (ch === quote && body[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; current += ch; continue }
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

/**
 * Parses a MySQL dump into tables.
 * @param {string} sql
 * @returns {{ tables: Map<string, { name: string, columns: string[], rows: object[], inserts: number, sourceTypes: object }>, warnings: string[] }}
 */
export function parseMysqlDump(sql) {
  const text = String(sql || '')
  const tables = new Map()
  const warnings = []

  const ensure = (name) => {
    const key = name.toLowerCase()
    if (!tables.has(key)) {
      tables.set(key, { name: key, columns: [], rows: [], inserts: 0, sourceTypes: {} })
    }
    return tables.get(key)
  }

  // ---- CREATE TABLE: column names in declaration order ----------------------
  const createRe = new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}\\s*\\(`, 'gi')
  let hit
  while ((hit = createRe.exec(text))) {
    const table = ensure(stripName(hit[1]))
    const open = hit.index + hit[0].length - 1
    let depth = 0
    let i = open
    for (; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') { depth--; if (depth === 0) break }
    }
    const body = text.slice(open + 1, i)
    for (const part of splitTopLevel(body)) {
      const col = part.trim().match(/^`?([A-Za-z0-9_$]+)`?\s+([a-zA-Z]+(?:\s*\([^)]*\))?)/)
      if (!col) continue
      const name = col[1].toUpperCase()
      if (/^(PRIMARY|UNIQUE|KEY|CONSTRAINT|INDEX|FOREIGN|FULLTEXT|SPATIAL|CHECK)$/.test(name)) continue
      if (!table.columns.includes(name)) table.columns.push(name)
      table.sourceTypes[name] = col[2].toLowerCase()
    }
  }

  // ---- INSERT INTO: rows ----------------------------------------------------
  const insertRe = new RegExp(`INSERT\\s+(?:IGNORE\\s+)?INTO\\s+${IDENT}\\s*(\\(([^)]*)\\))?\\s*VALUES`, 'gi')
  while ((hit = insertRe.exec(text))) {
    const table = ensure(stripName(hit[1]))
    // Group 2 is the whole `(a, b)` list, group 3 its contents.
    const columnList = hit[3]
      ? hit[3].split(',').map((c) => stripName(c.trim()).toUpperCase()).filter(Boolean)
      : table.columns.slice()
    if (columnList.length === 0) {
      warnings.push(`INSERT INTO ${table.name} appears before its CREATE TABLE; columns cannot be read.`)
      continue
    }
    const { end, count } = readTuples(text, insertRe.lastIndex, (row) => {
      const record = {}
      columnList.forEach((column, index) => { record[column] = row[index] === undefined ? null : row[index] })
      table.rows.push(record)
    })
    table.inserts += count
    insertRe.lastIndex = Math.max(end, insertRe.lastIndex)
  }

  // The old dump may name a table in CREATE and again in INSERT with different
  // case; keys are lower-cased above, so both land in the same entry.
  return { tables, warnings }
}

export function tableRows(parsed, name) {
  return parsed?.tables?.get(String(name).toLowerCase())?.rows || []
}

export function tableColumns(parsed, name) {
  return parsed?.tables?.get(String(name).toLowerCase())?.columns || []
}
