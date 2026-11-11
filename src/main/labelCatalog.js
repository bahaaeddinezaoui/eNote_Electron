// Catalog of reference labels in all supported languages.
//
// The i18n migration stores reference labels as `<base>_en` / `<base>_ar` /
// `<base>_fr` and keeps `<base>` as a generated alias (COALESCE en -> ar -> fr).
// A query that selects the alias alone (joined labels such as
// `m.SECTION_LABEL`, or an aggregate) therefore carries no language variants for
// localization.js to switch. This catalog fills that gap: it indexes every
// reference row by its primary key (preferred) and by each of its labels, so
// the localizer can resolve an alias value without every SQL statement having
// to select the explicit language columns.
//
// The catalog is derived from information_schema, so tables/attributes added by
// later migrations are picked up automatically. It is rebuilt lazily and
// dropped when a reference table is written, keeping label edits immediate.

let cachedCatalog = null
let building = null
let generation = 0
let labelTables = new Set()

export function clearLabelCatalog() {
  generation += 1
  cachedCatalog = null
  building = null
}

// Only writes to a table that owns reference labels can stale the catalog.
// Marking attendance (the most frequent write) therefore keeps it cached.
export function invalidateLabelCatalogForSql(sql) {
  if (!cachedCatalog && !building) return
  const match = /^\s*(?:insert\s+into|update|delete\s+from)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(String(sql || ''))
  // Statements whose target cannot be identified (DDL, CTEs, ...) are
  // conservative: drop the catalog.
  if (!match || labelTables.has(match[1].toLowerCase())) clearLabelCatalog()
}

// Rows must be normalized to UPPER_SNAKE keys, like db.query returns.
export async function getLabelCatalog(run) {
  if (cachedCatalog) return cachedCatalog
  if (!building) {
    const startedAt = generation
    building = buildCatalog(run)
      .then((catalog) => {
        // A write while the catalog was loading invalidates this snapshot.
        if (generation === startedAt) cachedCatalog = catalog
        return catalog
      })
      .catch((error) => {
        console.warn('Could not build the reference label catalog:', error.message)
        building = null
        return new Map()
      })
  }
  return building
}

// A label attribute is multilingual when the table has `<base>`, `<base>_en`,
// `<base>_ar` and `<base>_fr`. Person names (`_la` / `_ar`) are deliberately
// excluded: two people can share a Latin name while having different Arabic
// spellings, so they cannot be resolved from the displayed value.
async function findLabelAttributes(run) {
  const attrs = await run(`
    SELECT ar.table_name AS TABLE_NAME,
           left(ar.column_name, length(ar.column_name) - 3) AS BASE_COL
    FROM information_schema.columns ar
    JOIN information_schema.columns en
      ON en.table_schema = ar.table_schema
     AND en.table_name = ar.table_name
     AND en.column_name = left(ar.column_name, length(ar.column_name) - 3) || '_en'
    JOIN information_schema.columns fr
      ON fr.table_schema = ar.table_schema
     AND fr.table_name = ar.table_name
     AND fr.column_name = left(ar.column_name, length(ar.column_name) - 3) || '_fr'
    JOIN information_schema.columns base
      ON base.table_schema = ar.table_schema
     AND base.table_name = ar.table_name
     AND base.column_name = left(ar.column_name, length(ar.column_name) - 3)
    WHERE ar.table_schema = current_schema()
      AND ar.column_name LIKE '%\\_ar'
    ORDER BY ar.table_name, ar.column_name
  `)

  const keys = await run(`
    SELECT c.relname AS TABLE_NAME, a.attname AS PK_COL
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indisprimary
      AND array_length(i.indkey, 1) = 1
      AND c.relnamespace = current_schema()::regnamespace
  `)
  const pkByTable = new Map(keys.map(row => [row.TABLE_NAME, row.PK_COL]))

  return attrs.map(row => ({
    table: row.TABLE_NAME,
    base: row.BASE_COL.toUpperCase(),
    // Tables with a composite primary key (e.g. student_military_certificate)
    // still get a value-based index; there is no single id to look up.
    idField: (pkByTable.get(row.TABLE_NAME) || '').toUpperCase()
  }))
}

async function buildCatalog(run) {
  const attributes = await findLabelAttributes(run)
  labelTables = new Set(attributes.map(attr => attr.table.toLowerCase()))
  const catalog = new Map()

  for (const { table, base, idField } of attributes) {
    const baseCol = base.toLowerCase()
    const idCol = idField ? idField.toLowerCase() : ''
    const rows = await run(
      `SELECT ${idCol ? `"${idCol}"` : 'NULL'} AS ID,
              "${baseCol}" AS VALUE,
              "${baseCol}_en" AS EN,
              "${baseCol}_ar" AS AR,
              "${baseCol}_fr" AS FR
       FROM "${table}"`
    )

    let entry = catalog.get(base)
    if (!entry) {
      entry = { idField, byId: new Map(), byValue: new Map() }
      catalog.set(base, entry)
    }

    for (const row of rows) {
      const record = { en: row.EN, ar: row.AR, fr: row.FR }
      if (row.ID !== null && row.ID !== undefined) {
        entry.byId.set(String(row.ID), record)
      }
      for (const value of [row.VALUE, row.EN, row.AR, row.FR]) {
        if (typeof value === 'string' && value !== '' && !entry.byValue.has(value)) {
          entry.byValue.set(value, record)
        }
      }
    }
  }

  return catalog
}

// The other language shown in brackets next to the active one: Arabic in an
// English/French interface, English (then French) in an Arabic one.
const COUNTERPART = {
  en: ['ar'],
  ar: ['en', 'fr'],
  fr: ['ar']
}

// Resolve one label: prefer the row's own foreign key, then the displayed
// value. Returns null when nothing better than the current value is known.
export function resolveCatalogLabel(entry, currentValue, id, language) {
  const record =
    (id !== null && id !== undefined ? entry.byId.get(String(id)) : null) ||
    (currentValue !== null && currentValue !== undefined ? entry.byValue.get(String(currentValue)) : null)
  if (!record) return null
  const value = record[language] || record.en || record.ar || record.fr
  if (value === undefined || value === null || value === '') return null

  const shown = String(value).trim()
  for (const key of COUNTERPART[language] || []) {
    const other = record[key]
    if (typeof other === 'string' && other.trim() !== '' && other.trim() !== shown) {
      return `${value} (${other})`
    }
  }
  return value
}
