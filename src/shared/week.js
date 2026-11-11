// The application's week runs from Sunday to Saturday. Dates are handled as
// plain 'YYYY-MM-DD' strings so the main process and the renderer agree on the
// calendar day, without a Date's time zone shifting it by one.
const DAY_MS = 24 * 60 * 60 * 1000

export const WEEK_FIRST_DAY = 0 // Sunday
export const WEEK_LAST_DAY = 6 // Saturday

// 'YYYY-MM-DD' for a date-input string, a Date (pg returns `date` columns at
// local midnight) or an ISO timestamp. '' when the value has no usable date.
export function toDateOnly(value) {
  if (!value) return ''
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const str = String(value)
  return /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : ''
}

function toUtcMs(value) {
  const date = toDateOnly(value)
  return date ? Date.parse(`${date}T00:00:00Z`) : NaN
}

function fromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

// 0 = Sunday … 6 = Saturday, or null for an unusable date.
export function weekDayIndex(value) {
  const ms = toUtcMs(value)
  return Number.isNaN(ms) ? null : new Date(ms).getUTCDay()
}

// The Sunday that opens the week containing `value`.
export function startOfWeekSunday(value) {
  const ms = toUtcMs(value)
  if (Number.isNaN(ms)) return ''
  return fromUtcMs(ms - new Date(ms).getUTCDay() * DAY_MS)
}

// The Saturday that closes the week containing `value`.
export function endOfWeekSaturday(value) {
  const ms = toUtcMs(value)
  if (Number.isNaN(ms)) return ''
  return fromUtcMs(ms + (WEEK_LAST_DAY - new Date(ms).getUTCDay()) * DAY_MS)
}

export function addDays(value, days) {
  const ms = toUtcMs(value)
  if (Number.isNaN(ms)) return ''
  return fromUtcMs(ms + days * DAY_MS)
}
