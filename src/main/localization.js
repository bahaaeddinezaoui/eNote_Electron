// Display language for database rows.
//
// Reference tables store their labels once per language (`*_en`, `*_ar`,
// `*_fr`) and person names as `*_la` + `*_ar`. Every row that carries those
// variants is rewritten in place so its base column (`section_label`,
// `person_first_name`, ...) reads in the chosen language *and* names the other
// language in brackets:
//
//   English interface: "Computer Science (علوم الحاسوب)"
//   Arabic interface:  "علوم الحاسوب (Computer Science)"
//   French interface:  "Informatique (علوم الحاسوب)"
//
// The explicit `_EN` / `_AR` / `_FR` / `_LA` keys are left untouched: forms
// read them back as the value to edit, so translating them in place would copy
// an Arabic label into the English column on the next save.
//
// Queries that select only the base column (joined labels, aggregates) do not
// carry the language columns. For those a reference catalog built from the
// migrated `_en` / `_ar` / `_fr` attributes resolves the label by the row's
// foreign key, or by the displayed value as a fallback (see labelCatalog.js).

import { resolveCatalogLabel } from './labelCatalog'

const SUPPORTED = ['en', 'ar', 'fr']
const DEFAULT = 'en'

let currentLanguage = DEFAULT

export function setLanguage(language) {
  const next = String(language || '').toLowerCase()
  currentLanguage = SUPPORTED.includes(next) ? next : DEFAULT
  return currentLanguage
}

export function getLanguage() {
  return currentLanguage
}

// Variant preference per language. 'la' is the Latin-script form of a person
// name, which is what English and French users read.
const PREFERENCE = {
  en: ['EN', 'LA', 'FR', 'AR'],
  ar: ['AR', 'EN', 'LA', 'FR'],
  fr: ['FR', 'LA', 'EN', 'AR']
}

// What stands in the brackets: the Arabic form in an English or French
// interface, the English (then Latin, then French) form in an Arabic one.
const COUNTERPART = {
  en: ['AR'],
  ar: ['EN', 'LA', 'FR'],
  fr: ['AR']
}

const SUFFIXES = ['_EN', '_AR', '_FR', '_LA']

function pick(variants, language) {
  for (const suffix of PREFERENCE[language] || PREFERENCE.en) {
    const value = variants[suffix]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

// The second form is dropped when it says nothing new: a French label that is
// spelled like the English one is not repeated in brackets.
function pickCounterpart(variants, language, primary) {
  const shown = String(primary).trim()
  for (const suffix of COUNTERPART[language] || []) {
    const value = variants[suffix]
    if (typeof value === 'string' && value.trim() !== '' && value.trim() !== shown) return value
  }
  return null
}

export function bracketCounterpart(primary, counterpart) {
  if (!primary) return primary
  return counterpart ? `${primary} (${counterpart})` : primary
}

export function localizeRow(row, language = currentLanguage, catalog = null) {
  if (!row || typeof row !== 'object') return row

  // base key -> { EN: '...', AR: '...' } from the language columns present.
  const groups = new Map()
  for (const key of Object.keys(row)) {
    const suffix = SUFFIXES.find(s => key.length > s.length && key.endsWith(s))
    if (!suffix) continue
    const base = key.slice(0, -suffix.length)
    if (!groups.has(base)) groups.set(base, {})
    groups.get(base)[suffix.slice(1)] = row[key]
  }

  // 1. Rows that carry the explicit language columns (SELECT table.*) are
  //    translated directly — the most precise source.
  const translated = new Set()
  for (const [base, variants] of groups) {
    const value = pick(variants, language)
    if (value === null) continue
    // The base is rewritten where the query returned it, and materialized where
    // the table does not store it: reference labels live only in their
    // `_en` / `_ar` / `_fr` columns (e.g. major_label), so a query that selects
    // those three still reads in the active language under the base name.
    row[base] = bracketCounterpart(value, pickCounterpart(variants, language, value))
    translated.add(base)
  }

  // 1b. A first + last name pair carries one bracket around the whole name —
  //     "Amine BENALI (أمين بن علي)" rather than "Amine (أمين) BENALI (بن علي)".
  //     The pair is only detected when the row really returns both halves; the
  //     first name keeps the primary form and the last name closes the pair
  //     with the other language's full name.
  for (const [base, variants] of groups) {
    if (!base.endsWith('_FIRST_NAME')) continue
    const lastBase = `${base.slice(0, -'_FIRST_NAME'.length)}_LAST_NAME`
    const lastVariants = groups.get(lastBase)
    if (!lastVariants) continue
    if (!Object.prototype.hasOwnProperty.call(row, base)) continue
    if (!Object.prototype.hasOwnProperty.call(row, lastBase)) continue

    const first = pick(variants, language)
    const last = pick(lastVariants, language)
    if (first === null && last === null) continue

    const otherFirst = first === null ? null : pickCounterpart(variants, language, first)
    const otherLast = last === null ? null : pickCounterpart(lastVariants, language, last)
    const counterpart = [otherFirst, otherLast].filter(Boolean).join(' ')

    row[base] = first || ''
    row[lastBase] = last ? bracketCounterpart(last, counterpart) : ''
  }

  // 2. Aliases selected without their language columns (joins, aggregates)
  //    are resolved through the reference catalog.
  if (!catalog || catalog.size === 0) return row
  for (const key of Object.keys(row)) {
    if (translated.has(key)) continue
    const entry = catalog.get(key)
    if (!entry) continue
    const value = resolveCatalogLabel(entry, row[key], row[entry.idField], language)
    if (value !== null) row[key] = value
  }
  return row
}

export function localizeRows(rows, catalog = null) {
  if (!Array.isArray(rows)) return rows
  return rows.map(row => localizeRow(row, currentLanguage, catalog))
}
