import { useEffect, useMemo, useState } from 'react'

// Locked pages are read by the sidebar (to draw the lock mark) and by the
// layout (to keep the page closed). A lock is per route and per role: the map a
// route returns holds the roles it closes the page for, and an empty list means
// every role (a lock saved before roles existed, or one made with the
// page-wide switch).
//
// Admins and Developers administer the locks, so they always keep access and
// are not among the roles a lock can pick.

export const PAGE_LOCKS_EVENT = 'page-locks-updated'

// The roles a lock can close a page for, in the order the dialog shows them.
export const LOCKABLE_ROLES = [
  { code: 'TEACHER', label: 'Teacher' },
  { code: 'STUDENT', label: 'Student' },
  { code: 'DIRECTOR', label: 'Director' },
  { code: 'SECRETARY', label: 'Secretary' },
  { code: 'SCHEDULER', label: 'Scheduler' }
]

export function broadcastPageLocks() {
  try {
    window.dispatchEvent(new Event(PAGE_LOCKS_EVENT))
  } catch {
    // No window (a non-browser test): there is nobody to tell.
  }
}

// Does this lock close the page for an account holding these roles? A route
// with no role restriction closes it for everyone.
export function isPageLockedFor(locks, route, roles = []) {
  if (!locks || typeof locks.get !== 'function' || !locks.has(route)) return false
  const restriction = locks.get(route)
  if (!restriction || restriction.length === 0) return true
  return (Array.isArray(roles) ? roles : []).some((role) => restriction.includes(role))
}

export function usePageLocks() {
  const [locks, setLocks] = useState([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await window.api?.getLockedPages()
        if (!cancelled) setLocks(Array.isArray(res?.locks) ? res.locks : [])
      } catch {
        // An unreadable list must not lock the whole application: treat it as
        // "nothing is locked".
        if (!cancelled) setLocks([])
      }
    }
    load()
    window.addEventListener(PAGE_LOCKS_EVENT, load)
    return () => {
      cancelled = true
      window.removeEventListener(PAGE_LOCKS_EVENT, load)
    }
  }, [])

  return useMemo(() => {
    const map = new Map()
    for (const lock of locks) {
      map.set(lock.route, Array.isArray(lock.roles) ? lock.roles : [])
    }
    return map
  }, [locks])
}
