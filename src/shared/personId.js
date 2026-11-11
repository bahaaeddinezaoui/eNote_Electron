// person.person_id is an identifier the institution issues, not a number the
// application makes up: twelve digits, typed in when the person is registered
// (see deploy/server/11-person-id-manual.sql, which removed the sequence
// default). Every write therefore has to carry it, and the same rule has to
// hold in the forms and on the server — the renderer answers while the field is
// typed, the services check again before the INSERT.

export const PERSON_ID_LENGTH = 12

// The message to show for an id that cannot be used, or null when it is usable.
export function personIdError(value) {
  const id = String(value ?? '').trim()
  if (!id) return 'The person ID is required.'
  if (!/^\d+$/.test(id) || id.length !== PERSON_ID_LENGTH) {
    return `The person ID must be exactly ${PERSON_ID_LENGTH} digits.`
  }
  // person_id is a number, so a leading zero would not survive the trip and the
  // stored id would no longer be the one that was typed. Refused rather than
  // silently changed.
  if (String(Number(id)) !== id) return 'The person ID cannot start with a zero.'
  return null
}

// The id as a number, which is the column's type. Call it once personIdError
// has returned null.
export function personIdValue(value) {
  return Number(String(value).trim())
}
