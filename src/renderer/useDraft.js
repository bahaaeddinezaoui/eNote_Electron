import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Work in progress that survives a window close, a crash or a power cut.
//
// This is the opposite of the offline queue. The queue holds decisions the
// application is allowed to make on its own (an absence, a comment); a draft is
// text and numbers a person typed that are not a record yet. Keeping them here
// means an outage at submit time never costs the work, without ever pretending
// the server accepted anything.
//
// Drafts live in localStorage — small, per machine — carry the account that
// wrote them (a shared staff workstation must not offer one teacher's marks to
// the next person), and expire after two weeks so an abandoned draft cannot
// resurface a term later. Nothing is applied automatically: the page offers what
// it found and a person chooses, so a stale draft never overwrites rows the
// server just returned.

const PREFIX = 'enote:draft:'
const MAX_AGE_DAYS = 14
const WRITE_DELAY_MS = 700

const keyFor = (key, userId) => `${PREFIX}${key}:${userId || 'anonymous'}`

const isEmpty = (value) => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function readDraft(key, userId) {
  try {
    const raw = localStorage.getItem(keyFor(key, userId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const savedAt = Number(parsed?.savedAt) || 0
    if (!savedAt || Date.now() - savedAt > MAX_AGE_DAYS * 86400000) {
      localStorage.removeItem(keyFor(key, userId))
      return null
    }
    return { value: parsed.value, savedAt }
  } catch {
    return null
  }
}

export function writeDraft(key, userId, value) {
  try {
    localStorage.setItem(keyFor(key, userId), JSON.stringify({ value, savedAt: Date.now() }))
    return true
  } catch {
    // A full quota or a locked profile is not a reason to fail the form.
    return false
  }
}

export function clearDraft(key, userId) {
  try {
    localStorage.removeItem(keyFor(key, userId))
  } catch {
    /* best effort */
  }
}

// `enabled` says whether the form currently holds work worth keeping. `reloadOn`
// re-reads the stored draft when its value changes (a dialog opening, another
// exam being selected). `onRestore` receives the stored value when the user
// accepts the offer.
export function useDraft({ key, userId, value, enabled = true, onRestore, reloadOn = null }) {
  const [found, setFound] = useState(() => readDraft(key, userId))
  const latest = useRef(value)
  latest.current = value
  const timer = useRef(null)

  const serialized = useMemo(() => {
    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }, [value])

  useEffect(() => {
    setFound(readDraft(key, userId))
  }, [key, userId, reloadOn])

  useEffect(() => {
    if (!enabled || serialized === null) return undefined
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const current = latest.current
      if (isEmpty(current)) clearDraft(key, userId)
      else writeDraft(key, userId, current)
    }, WRITE_DELAY_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [key, userId, enabled, serialized])

  // A window that closes in the middle of the delay still keeps the last key.
  useEffect(() => {
    if (!enabled) return undefined
    const flush = () => {
      const current = latest.current
      if (isEmpty(current)) clearDraft(key, userId)
      else writeDraft(key, userId, current)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [key, userId, enabled])

  const restore = useCallback(() => {
    if (!found) return false
    onRestore?.(found.value)
    setFound(null)
    return true
  }, [found, onRestore])

  const discard = useCallback(() => {
    clearDraft(key, userId)
    setFound(null)
  }, [key, userId])

  const clear = useCallback(() => clearDraft(key, userId), [key, userId])

  return { draft: found, restore, discard, clear }
}
