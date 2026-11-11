import { useEffect, useRef, useState } from 'react'

// The identifiers the database keeps unique. The forms ask the main process
// about them while they are typed, so a duplicate is refused at the field
// instead of at Save.
//
// The labels are only used to point at the offending field in a summary; the
// per-field message comes from the check result.
export const IDENTIFIER_FIELDS = {
  // The person id is the key every record shares, so it is checked against
  // every person — student, teacher or staff — not only the student roster.
  PERSON_ID: 'person ID',
  STUDENT_PERSONAL_PHONE: 'personal phone number',
  STUDENT_BACCALAUREATE_SUB_NUMBER: 'baccalaureate number',
  STUDENT_SCHOOL_SUB_CARD_NUMBER: 'school submission card number',
  STUDENT_LAPTOP_SERIAL_NUMBER: 'laptop serial number',
  STUDENT_NATIONAL_IDENTIFICATION_NUMBER: 'national identification number',
  STUDENT_POSTAL_ACCOUNT_NUMBER: 'postal account number',
  STUDENT_INSURANCE_CARD_NUMBER: 'insurance card number',
  STUDENT_MILITARY_CARD_NUMBER: 'military card number',
  STUDENT_MILITARY_HELMET_NUMBER: 'military helmet number',
  FIRST_OUTFIT_NUMBER: 'first outfit number',
  SECOND_OUTFIT_NUMBER: 'second outfit number'
}

export const IDENTIFIER_KEYS = Object.keys(IDENTIFIER_FIELDS)

// The values that are actually being sent: trimmed, only non-empty ones.
export function identifierPayload(values) {
  const payload = {}
  for (const key of IDENTIFIER_KEYS) {
    const value = String(values?.[key] ?? '').trim()
    if (value) payload[key] = value
  }
  return payload
}

// Debounced so a number is checked once the typist pauses, not on every key.
// `personId` excludes the record being edited from its own conflict result.
export function useIdentifierConflicts({ userId, personId = null, values, enabled = true, delay = 320 }) {
  const [conflicts, setConflicts] = useState({})
  const [checking, setChecking] = useState(false)
  const payload = identifierPayload(values)
  // The person is part of the signature: moving to another record must not
  // leave the previous student's answer in place.
  const signature = JSON.stringify({ personId: personId ?? null, values: payload })
  const lastChecked = useRef('')

  useEffect(() => {
    if (!enabled || !userId || !window.api?.checkStudentIdentifiers) {
      setConflicts({})
      setChecking(false)
      lastChecked.current = ''
      return
    }
    if (signature === lastChecked.current) return
    if (Object.keys(payload).length === 0) {
      setConflicts({})
      setChecking(false)
      lastChecked.current = ''
      return
    }

    let cancelled = false
    lastChecked.current = signature
    setChecking(true)
    const timer = setTimeout(async () => {
      try {
        const res = await window.api.checkStudentIdentifiers(userId, personId, payload)
        if (!cancelled) setConflicts(res?.conflicts || {})
      } catch {
        // A failed lookup must not block the form: the database constraint is
        // still the backstop when the record is saved.
        if (!cancelled) setConflicts({})
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [signature, enabled, userId, personId, delay])

  return {
    conflicts,
    checking,
    hasConflicts: Object.keys(conflicts).length > 0
  }
}

// The sentence shown under the field that holds a duplicate value.
export function conflictMessage(conflicts, key, tr) {
  const hit = conflicts?.[key]
  if (!hit) return ''
  if (key === 'PERSON_ID') {
    return hit.name
      ? tr('This person ID is already used by {name}.', { name: hit.name })
      : tr('This person ID is already used by another person.')
  }
  return hit.name
    ? tr('Already recorded for {name}.', { name: hit.name })
    : tr('Already recorded for another student.')
}

