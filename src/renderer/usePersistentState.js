// View state that survives navigation inside the session.
//
// Every list page keeps its search, sort, filters and page in sessionStorage
// under its own key, so opening a student record and coming back no longer
// drops the view. Storage is best-effort: a failure (private mode, quota) falls
// back to ordinary component state instead of breaking the page.

import { useEffect, useState } from 'react'

const PREFIX = 'enote:view:'

const read = (key, initialValue) => {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (raw == null) return initialValue
    return JSON.parse(raw)
  } catch {
    return initialValue
  }
}

export function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => read(key, initialValue))

  useEffect(() => {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
    } catch {
      // Ignore: the page still works with in-memory state.
    }
  }, [key, value])

  return [value, setValue]
}

export function clearPersistedState(key) {
  try {
    sessionStorage.removeItem(PREFIX + key)
  } catch {
    // Ignore.
  }
}
