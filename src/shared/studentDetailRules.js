// The three family counts describe one family, so they have to agree with each
// other: the sisters are among the siblings, and the student's rank among them
// cannot be later than one place after the last sibling.
//
// A blank field means "not recorded" and is left alone — only a value that is
// actually there has to make sense. The same rules exist as CHECK constraints on
// student_detail (deploy/server/12-student-family-counts.sql), which is the
// backstop for anything that does not pass through these forms.

const toCount = (value) => {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (text === '') return null
  const number = Number(text)
  return Number.isFinite(number) ? number : NaN
}

const isWholeFrom = (value, min) =>
  value !== null && !Number.isNaN(value) && Number.isInteger(value) && value >= min

// { STUDENT_NUMBER_OF_...: message } for every field that cannot be used, so a
// form can show each fault under the field that holds it.
export function familyCountErrors(detail = {}) {
  const errors = {}
  const siblings = toCount(detail.STUDENT_NUMBER_OF_SIBLINGS)
  const sisters = toCount(detail.STUDENT_NUMBER_OF_SISTERS)
  const order = toCount(detail.STUDENT_ORDER_AMONG_SIBLINGS)

  // A blank field is "not recorded" and is left alone: only a value that is
  // actually there has to be a usable number, so each check is asked only when
  // the field was filled in.
  if (siblings !== null && !isWholeFrom(siblings, 0)) {
    errors.STUDENT_NUMBER_OF_SIBLINGS = 'The number of siblings must be a whole number, 0 or more.'
  }
  if (sisters !== null && !isWholeFrom(sisters, 0)) {
    errors.STUDENT_NUMBER_OF_SISTERS = 'The number of sisters must be a whole number, 0 or more.'
  }
  if (order !== null && !isWholeFrom(order, 1)) {
    errors.STUDENT_ORDER_AMONG_SIBLINGS = 'The order among siblings must be a whole number, 1 or more.'
  }

  // The two rules below are only judged against the total, so they are asked
  // only when a total was recorded and each field is a usable number on its own.
  // The total itself is optional: a blank one is left blank.
  if (!errors.STUDENT_NUMBER_OF_SISTERS && siblings !== null && sisters !== null && sisters > siblings) {
    errors.STUDENT_NUMBER_OF_SISTERS = 'The number of sisters cannot exceed the number of siblings.'
  }
  if (!errors.STUDENT_ORDER_AMONG_SIBLINGS && siblings !== null && order !== null && order > siblings + 1) {
    errors.STUDENT_ORDER_AMONG_SIBLINGS = 'The order among siblings cannot exceed the number of siblings plus one.'
  }

  return errors
}

// The first message, for a caller that reports one error rather than a map.
export function firstFamilyCountError(detail) {
  const errors = familyCountErrors(detail)
  const key = Object.keys(errors)[0]
  return key ? errors[key] : null
}

// Carried-over data (the legacy importer) can disagree with itself. A total that
// is present is raised to fit the sisters and the birth order rather than losing
// them; the total is optional, so a blank one stays blank. A count that is not a
// usable number becomes "not recorded". Returns the three snake_case columns the
// importer writes.
export function fitFamilyCounts({ siblings, sisters, order }) {
  const clean = (value, min) => (isWholeFrom(toCount(value), min) ? toCount(value) : null)
  const total = clean(siblings, 0)
  const girlCount = clean(sisters, 0)
  const rank = clean(order, 1)
  const implied = Math.max(girlCount ?? 0, rank === null ? 0 : rank - 1)
  return {
    student_number_of_siblings: total === null ? null : Math.max(total, implied),
    student_number_of_sisters: girlCount,
    student_order_among_siblings: rank
  }
}

// ---- Dates ----------------------------------------------------------------

// A birth date, and the date a student's school subscription started, are both
// entered on more than one form. The rules live here so every form and the
// service answer the same way. The database cannot hold the "not in the future"
// half — CURRENT_DATE is not immutable, so PostgreSQL refuses it in a CHECK —
// which is why these are enforced in the service as well.

export const EARLIEST_BIRTH_YEAR = 1900

// 'YYYY-MM-DD' (as an <input type="date"> gives it) or a Date, read as a local
// calendar day. Anything else is not a date this app wrote.
const parseDate = (value) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const text = String(value ?? '').trim()
  if (!text) return null
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

// A blank birth date stays blank: "not recorded" is not a claim.
export function birthDateError(value, today = new Date()) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const date = parseDate(value)
  if (!date) return 'The birthdate is not a valid date.'
  if (date > startOfDay(today)) return 'The birthdate cannot be in the future.'
  if (date.getFullYear() < EARLIEST_BIRTH_YEAR) {
    return `The birthdate cannot be before ${EARLIEST_BIRTH_YEAR}.`
  }
  return null
}

// The subscription is the yearly enrolment: it cannot start after today, and it
// cannot start before the student was born.
export function schoolSubDateError(value, birthdate, today = new Date()) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const date = parseDate(value)
  if (!date) return 'The school subscription date is not a valid date.'
  if (date > startOfDay(today)) return 'The school subscription date cannot be in the future.'
  const birth = parseDate(birthdate)
  if (birth && date < birth) {
    return 'The school subscription date cannot be before the birthdate.'
  }
  return null
}
