// Helpers shared by the schedule views. Sessions are attached to study_day
// rows, each of which stores the day as an actual date (STUDY_DAY_DATE).

import { getActiveLanguage } from './i18n'

// Weekday and month names follow the interface language, so an Arabic session
// does not read "Tuesday, Nov 3".
const DATE_LOCALES = { en: 'en-US', ar: 'ar-DZ', fr: 'fr-FR' }
export const dateLocale = () => DATE_LOCALES[getActiveLanguage()] || DATE_LOCALES.en

const SESSION_TYPE_LABEL_KEYS = {
  en: 'STUDY_SESSION_TYPE_LABEL_EN',
  ar: 'STUDY_SESSION_TYPE_LABEL_AR',
  fr: 'STUDY_SESSION_TYPE_LABEL_FR'
}

export function sessionTypeLabel(row) {
  if (!row) return ''
  const key = SESSION_TYPE_LABEL_KEYS[getActiveLanguage()] || SESSION_TYPE_LABEL_KEYS.en
  return row[key] || row.STUDY_SESSION_TYPE_LABEL || ''
}

// Session types arrive with the active language in STUDY_SESSION_TYPE_LABEL and
// the other language in brackets ("Examination (امتحان)"). That composite is a
// display value, not an i18n key, so tr() cannot translate it: read the column
// for the interface language instead, and fall back to the composite only when
// a row was built without its language columns.

function parseDate(dateValue) {
  if (dateValue == null || dateValue === '') return null
  const d = new Date(dateValue)
  return Number.isNaN(d.getTime()) ? null : d
}

// 'Sunday' / 'Monday' ...
export function weekdayName(dateValue) {
  const d = parseDate(dateValue)
  return d ? d.toLocaleDateString(dateLocale(), { weekday: 'long' }) : ''
}

// 'Sun' / 'Mon' ...
export function weekdayShort(dateValue) {
  const d = parseDate(dateValue)
  return d ? d.toLocaleDateString(dateLocale(), { weekday: 'short' }) : ''
}

// 'Sunday, Jul 26' — used on cards and in detail views.
export function formatDateLabel(dateValue) {
  const d = parseDate(dateValue)
  return d ? d.toLocaleDateString(dateLocale(), { weekday: 'long', month: 'short', day: 'numeric' }) : ''
}

// 'Jul 26' — compact label for grid column headers.
export function formatDayShort(dateValue) {
  const d = parseDate(dateValue)
  return d ? d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' }) : ''
}

// 'Jul 26, 2026'
export function formatDateFull(dateValue) {
  const d = parseDate(dateValue)
  return d ? d.toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

// 'Sunday, July 26, 2026'
export function formatDateLong(dateValue) {
  const d = parseDate(dateValue)
  return d ? d.toLocaleDateString(dateLocale(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''
}

// 'YYYY-MM-DD' — matches the database date format.
export function toDateString(dateValue) {
  const d = parseDate(dateValue)
  if (!d) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---------------------------------------------------------------------------
// Date-aware default selection.
//
// Pages with year/semester/week/day selectors default to "today" when a
// matching row exists: the year containing today's date, then the semester
// containing it, then the week covering it, then the exact day. When today
// falls outside every calendar row (e.g. between terms, or before the calendar
// has been filled in for the new year), the closest row is selected — the most
// recently started one, or the soonest upcoming one — so pages never open on
// an arbitrary (usually the oldest) period.
// ---------------------------------------------------------------------------

// Today as a comparable 'YYYY-MM-DD' string.
export function todayString() {
  return toDateString(new Date())
}

// Row start/end come either as 'YYYY-MM-DD' strings or as Date objects at
// local midnight (pg's date handling); toDateString normalizes both without
// any timezone shift.
function rowStartString(row, startKeys) {
  for (const key of startKeys) {
    const value = row[key]
    if (value) return toDateString(value)
  }
  return null
}

function rowEndString(row, startKeys, endKeys) {
  for (const key of endKeys) {
    const value = row[key]
    if (value) return toDateString(value)
  }
  // A row with a start but no end is treated as a single-day row for
  // containment purposes (still matches its own start date).
  return rowStartString(row, startKeys)
}

// Id of the row whose [start, end] contains today. Accepts idField names for
// both UPPER (normalized query results) and lower (raw) shapes.
export function pickCurrentId(rows, idField, startKeys, endKeys) {
  if (!Array.isArray(rows) || rows.length === 0) return ''
  const today = todayString()
  const lowerId = idField.toLowerCase()
  const idOf = (row) => row[idField] ?? row[lowerId] ?? ''

  const dated = []
  for (const row of rows) {
    const start = rowStartString(row, startKeys)
    if (!start) continue
    if (today >= start && today <= rowEndString(row, startKeys, endKeys)) {
      return idOf(row)
    }
    dated.push({ row, start })
  }

  // Today is outside every period: prefer the period that started most
  // recently, otherwise the next one that starts after today.
  const started = dated.filter(r => r.start <= today).sort((a, b) => b.start.localeCompare(a.start))
  if (started.length > 0) return idOf(started[0].row)
  const upcoming = dated.filter(r => r.start > today).sort((a, b) => a.start.localeCompare(b.start))
  if (upcoming.length > 0) return idOf(upcoming[0].row)
  return idOf(rows[0])
}

// Convenience wrappers per calendar level.
export function pickCurrentYearId(years) {
  return pickCurrentId(years || [], 'STUDY_YEAR_ID',
    ['STUDY_YEAR_START_DATE', 'study_year_start_date'],
    ['STUDY_YEAR_END_DATE', 'study_year_end_date'])
}

export function pickCurrentSemesterId(semesters) {
  return pickCurrentId(semesters || [], 'STUDY_SEMESTER_ID',
    ['STUDY_SEMESTER_START_DATE', 'study_semester_start_date'],
    ['STUDY_SEMESTER_END_DATE', 'study_semester_end_date'])
}

export function pickCurrentWeekId(weeks) {
  return pickCurrentId(weeks || [], 'STUDY_WEEK_ID',
    ['STUDY_WEEK_START_DATE', 'study_week_start_date'],
    ['STUDY_WEEK_END_DATE', 'study_week_end_date'])
}

export function pickCurrentDayId(days) {
  return pickCurrentId(days || [], 'STUDY_DAY_ID',
    ['STUDY_DAY_DATE', 'study_day_date'],
    ['STUDY_DAY_DATE', 'study_day_date'])
}

// Day to attach a new session to: today when today is a study day, otherwise
// the next study day in the week (and the last one when today is after them
// all). Never silently schedules onto a day that has already passed while a
// later one is available.
export function pickCurrentOrUpcomingDayId(days) {
  if (!Array.isArray(days) || days.length === 0) return ''
  const today = todayString()
  const dated = days
    .map(day => ({ day, date: toDateString(day.STUDY_DAY_DATE ?? day.study_day_date) }))
    .filter(item => item.date)
    .sort((a, b) => a.date.localeCompare(b.date))
  const exact = dated.find(item => item.date === today)
  if (exact) return exact.day.STUDY_DAY_ID ?? exact.day.study_day_id ?? ''
  const upcoming = dated.find(item => item.date > today)
  if (upcoming) return upcoming.day.STUDY_DAY_ID ?? upcoming.day.study_day_id ?? ''
  const last = dated[dated.length - 1]
  return last ? (last.day.STUDY_DAY_ID ?? last.day.study_day_id ?? '') : ''
}

// Session to focus on in a list: the one running now / nearest on today's
// date, else the most recent past session, else the soonest upcoming one.
export function pickCurrentSessionId(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return ''
  const today = todayString()
  const now = new Date()
  const withDay = sessions
    .map(session => ({ session, date: toDateString(session.STUDY_DAY_DATE ?? session.study_day_date) }))
    .filter(item => item.date)

  const idOf = ({ session }) => session.STUDY_SESSION_ID ?? session.study_session_id ?? ''
  const startMinutes = (session) => {
    const [h, m] = String(session.STUDY_SESSION_START_TIME ?? session.study_session_start_time ?? '').split(':')
    const hours = Number(h)
    if (Number.isNaN(hours)) return null
    return hours * 60 + (Number(m) || 0)
  }

  const todays = withDay.filter(item => item.date === today)
  if (todays.length > 0) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const sorted = [...todays].sort((a, b) => (startMinutes(a.session) ?? 0) - (startMinutes(b.session) ?? 0))
    const runningOrPast = sorted.filter(item => (startMinutes(item.session) ?? Infinity) <= nowMinutes)
    return idOf(runningOrPast.length > 0 ? runningOrPast[runningOrPast.length - 1] : sorted[0])
  }

  const past = withDay.filter(item => item.date < today).sort((a, b) => b.date.localeCompare(a.date))
  if (past.length > 0) return idOf(past[0])
  const upcoming = withDay.filter(item => item.date > today).sort((a, b) => a.date.localeCompare(b.date))
  if (upcoming.length > 0) return idOf(upcoming[0])
  return sessions[0].STUDY_SESSION_ID ?? sessions[0].study_session_id ?? ''
}
