// One formatting layer for every date and time the interface shows.
//
// Dates used to be formatted with `toLocaleDateString(undefined, …)` in each
// component, which follows the operating system rather than the interface: an
// Arabic or French screen still printed English month names. Everything now
// goes through dateLocale(), the same choice the schedule views use.

import { dateLocale } from './scheduleUtils'

export { dateLocale }

export function parseDateValue(value) {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// '03/11/2026' in the interface language (numeric unless options say otherwise).
export function formatDate(value, options) {
  const d = parseDateValue(value)
  if (!d) return ''
  return d.toLocaleDateString(dateLocale(), options)
}

// '14:05' by default; callers that need seconds pass their own options.
export function formatTime(value, options = { hour: '2-digit', minute: '2-digit' }) {
  const d = parseDateValue(value)
  if (!d) return ''
  return d.toLocaleTimeString(dateLocale(), options)
}

// Date and time together. Without options this keeps the old toLocaleString()
// shape (numeric date, time with seconds).
export function formatDateTime(value, options) {
  const d = parseDateValue(value)
  if (!d) return ''
  return d.toLocaleString(dateLocale(), options)
}
