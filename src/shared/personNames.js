// Latin-script person names, written the way the registry expects:
//
//   first name  "Mohamed Amine"   every word capitalised
//   last name   "BENALI"          all capitals
//
// Words are split on spaces, hyphens and apostrophes, so "ab-del-kader",
// "o'brien" and "van dyke" come out as "Ab-Del-Kader", "O'Brien", "Van Dyke".
// Arabic names are left exactly as typed: Arabic has no letter case, and
// applying a Latin rule to them would only corrupt the value.
//
// Both the forms (while typing) and the main process (before writing) use
// these, so a record saved from any screen has the same shape.

const splitWords = /[^\s\-'’]+/g

export function formatLatinFirstName(value) {
  if (value === null || value === undefined) return value
  return String(value).replace(splitWords, (word) => {
    const lower = word.toLowerCase()
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  })
}

export function formatLatinLastName(value) {
  if (value === null || value === undefined) return value
  return String(value).toUpperCase()
}

// How a person's name is printed: the two halves and, in one bracket at the end,
// the other script's full name.
//
// Rows come back from the main process with the other language's form inside a
// bracket on one of the halves (localization.js puts the whole other-script name
// there), or — for rows resolved through the label catalog — on both halves. Some
// screens print the surname first, others the first name first, so each half's
// bracket is lifted out and the two are put back together once, after the name:
//
//   "BENALI (أمين بن علي)" + "Amine"     ->  "BENALI Amine (أمين بن علي)"
//   "BENALI (بن علي)" + "Amine (أمين)"   ->  "BENALI Amine (بن علي أمين)"

export function personNameLastFirst(lastName, firstName) {
  return joinNameParts(firstName, lastName)
}

const nameBracket = /\s*\(([^()]*)\)\s*$/

function splitNamePart(value) {
  const text = String(value ?? '').trim()
  const match = nameBracket.exec(text)
  if (!match) return { name: text, bracket: '' }
  return { name: text.slice(0, match.index).trim(), bracket: match[1].trim() }
}

function joinNameParts(firstName, lastName) {
  const first = splitNamePart(firstName)
  const last = splitNamePart(lastName)
  const name = [last.name, first.name].filter(Boolean).join(' ')
  const bracket = [last.bracket, first.bracket].filter(Boolean).join(' ')
  if (!name) return bracket ? `(${bracket})` : ''
  return bracket ? `${name} (${bracket})` : name
}

const FIRST_SUFFIX = '_FIRST_NAME_LA'
const LAST_SUFFIX = '_LAST_NAME_LA'

// Formats every Latin name field on a payload — the person's own name, the
// father's, the mother's, an emergency contact's — whichever case its keys are
// written in. Keys the caller did not send are left out, so a partial update
// still touches only what it carries.
export function normalizeLatinNames(payload) {
  if (!payload || typeof payload !== 'object') return payload
  const next = { ...payload }
  for (const key of Object.keys(next)) {
    const upper = key.toUpperCase()
    if (upper.endsWith(FIRST_SUFFIX)) next[key] = formatLatinFirstName(next[key])
    else if (upper.endsWith(LAST_SUFFIX)) next[key] = formatLatinLastName(next[key])
  }
  return next
}
