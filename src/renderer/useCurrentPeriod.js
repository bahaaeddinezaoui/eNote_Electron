import { useEffect, useRef, useState } from 'react'
import { todayString } from './scheduleUtils'

// The calendar screens default to the period that contains today. That answer
// changes without any user action: at local midnight (a new day, possibly a new
// week / semester / year), and after the machine sleeps or its clock changes.
// This module keeps those pages honest while they stay open.

// ---------------------------------------------------------------------------
// One shared clock for the whole renderer (all pages share the same day).
// ---------------------------------------------------------------------------

const listeners = new Set()
let midnightTimer = null
let pollTimer = null
let lastToday = todayString()

function notifyToday() {
  const next = todayString()
  if (next === lastToday) return
  lastToday = next
  listeners.forEach(listener => listener(next))
}

function msUntilNextMidnight() {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 50)
  return Math.max(1000, next.getTime() - now.getTime())
}

function scheduleMidnight() {
  if (midnightTimer) clearTimeout(midnightTimer)
  midnightTimer = setTimeout(() => {
    notifyToday()
    scheduleMidnight()
  }, msUntilNextMidnight())
}

function handleWake() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  // Re-read the clock now (it may have crossed midnight while suspended/away),
  // then re-arm the timer from the new "now".
  notifyToday()
  scheduleMidnight()
}

function startClock() {
  if (midnightTimer) return
  // The app may have sat on a non-calendar screen across midnight: refresh the
  // stored day before any page reads it, then arm the timer.
  notifyToday()
  scheduleMidnight()
  // Safety net: late/early timers and system clock changes still roll the
  // page over within a minute.
  pollTimer = setInterval(notifyToday, 60 * 1000)
  window.addEventListener('focus', handleWake)
  document.addEventListener('visibilitychange', handleWake)
}

function stopClock() {
  if (midnightTimer) clearTimeout(midnightTimer)
  if (pollTimer) clearInterval(pollTimer)
  midnightTimer = null
  pollTimer = null
  window.removeEventListener('focus', handleWake)
  document.removeEventListener('visibilitychange', handleWake)
}

// Local calendar date ('YYYY-MM-DD'), refreshed at midnight and on wake-up.
export function useLocalToday() {
  const [today, setToday] = useState(lastToday)

  useEffect(() => {
    const listener = value => setToday(value)
    listeners.add(listener)
    if (listeners.size === 1) startClock()
    // The day may have rolled over between the render and this effect.
    setToday(lastToday)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) stopClock()
    }
  }, [])

  return today
}

// ---------------------------------------------------------------------------
// Keeps a page's year/semester/week (or session) selection on "now".
// ---------------------------------------------------------------------------

// `levels` is a fixed-length list of
//   { rows, pickId, selectedId, setSelectedId }
// one per calendar level, in parent → child order (year, semester, week, ...).
//
// A selection is moved to the current row only while the page is still
// following the current period: when the user has picked another year/week we
// leave their choice alone (until they pick the current one again). That way a
// page left open overnight rolls over, while browsing history does not get
// yanked away.
export function useCurrentPeriodSync(levels) {
  const today = useLocalToday()
  const levelsRef = useRef(levels)
  levelsRef.current = levels
  const previousCurrent = useRef([])

  useEffect(() => {
    const updates = resolveCurrentSelections(levelsRef.current, previousCurrent.current)
    updates.forEach(({ index, id }) => levelsRef.current[index].setSelectedId(id))
  }, [today, ...levels.flatMap(level => [level.rows, level.selectedId])])

  return today
}

// Pure decision step (exported for tests): for each level, remember the current
// row and return the selections that must move to it. A level whose selection
// no longer matches the previously-current row is being browsed by the user and
// is left alone.
export function resolveCurrentSelections(levels, previousCurrent = []) {
  const updates = []
  levels.forEach((level, index) => {
    const rows = level.rows || []
    if (rows.length === 0) return
    const current = level.pickId(rows)
    if (!current) return

    const previous = previousCurrent[index]
    if (String(current) === String(previous ?? '')) return
    previousCurrent[index] = current

    const selected = level.selectedId
    if (!selected || String(selected) === String(previous ?? '')) {
      updates.push({ index, id: current })
    }
  })
  return updates
}
