// The server is the register. While it is unreachable, the queue holds work that
// has not reached it yet, and a page that read only the saved copy would show a
// student as present after the teacher marked them absent on the other
// attendance page. These helpers put the unsent work back on top of the saved
// rows, in the order it will be sent, so both pages agree with what the server
// will hold once the queue drains.

const asNumber = (value) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

// 'YYYY-MM-DD HH:MM:SS' for both shapes a timestamp arrives in: the string the
// queue stored and the Date a pg timestamp becomes on its way to the page.
const datetimeKey = (value) => {
  if (!value) return ''
  if (value instanceof Date) {
    const pad = (number) => String(number).padStart(2, '0')
    return (
      `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
      `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
    )
  }
  return String(value).slice(0, 19).replace('T', ' ')
}

// Rows as the page will see them after the queue is sent. A queued "mark
// present" removes the student; a queued absence adds or replaces the row with
// the justification it was recorded with. Later entries win, which mirrors the
// order the replay applies them in.
export function mergePendingAbsences(rows, pending, justificationById) {
  const merged = [...(rows || [])]
  const entries = [...(pending?.absences || [])].sort((left, right) => left.outboxId - right.outboxId)

  for (const entry of entries) {
    const personId = asNumber(entry.personId)
    if (!personId) continue
    const index = merged.findIndex((row) => asNumber(row?.PERSON_ID) === personId)

    if (entry.action === 'clear') {
      if (index >= 0) merged.splice(index, 1)
      continue
    }

    const justification = justificationById?.get?.(asNumber(entry.justificationId)) || null
    const row = {
      PERSON_ID: personId,
      STUDY_SESSION_ID: entry.sessionId ?? null,
      ABSENCE_JUSTIFICATION_ID: entry.justificationId ?? null,
      ABSENCE_JUSTIFICATION_CODE: justification?.ABSENCE_JUSTIFICATION_CODE || 'UNEXCUSED',
      ABSENCE_JUSTIFICATION_LABEL_EN: justification?.ABSENCE_JUSTIFICATION_LABEL_EN,
      ABSENCE_JUSTIFICATION_LABEL_AR: justification?.ABSENCE_JUSTIFICATION_LABEL_AR,
      ABSENCE_JUSTIFICATION_LABEL_FR: justification?.ABSENCE_JUSTIFICATION_LABEL_FR,
      TEACHER_ABSENCE_NOTE: entry.note || '',
      PER_PERSON_ID: entry.perPersonId ?? null,
      PENDING_LOCAL: true
    }
    if (index >= 0) merged[index] = row
    else merged.push(row)
  }

  return merged
}

// Queued observations are added to the saved ones, and queued deletions taken
// off them, in the order the queue will send them. A note is matched on the
// student, the motif and the timestamp — the same three values the server's
// upsert uses — so a note that has since reached the server is not shown twice.
export function mergePendingObservations(rows, pending, motifById) {
  const merged = [...(rows || [])]
  const entries = [...(pending?.observations || [])].sort((left, right) => left.outboxId - right.outboxId)

  for (const entry of entries) {
    const personId = asNumber(entry.personId)
    if (!personId) continue

    // Deletions: one row (motif and timestamp identify it), or every note the
    // student has in the session when the whole set was removed.
    if (entry.deleted) {
      const motifId = asNumber(entry.motifId)
      const key = datetimeKey(entry.datetime)
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        const row = merged[index]
        if (asNumber(row?.PERSON_ID) !== personId) continue
        if (entry.all) {
          merged.splice(index, 1)
          continue
        }
        if (
          asNumber(row?.OBSERVATION_MOTIF_ID) === motifId &&
          datetimeKey(row?.OBSERVATION_DATETIME) === key
        ) {
          merged.splice(index, 1)
        }
      }
      continue
    }

    const key = datetimeKey(entry.datetime)
    const exists = merged.some(
      (row) =>
        asNumber(row?.PERSON_ID) === personId &&
        asNumber(row?.OBSERVATION_MOTIF_ID) === asNumber(entry.motifId) &&
        datetimeKey(row?.OBSERVATION_DATETIME) === key
    )
    if (exists) continue

    const motif = motifById?.get?.(asNumber(entry.motifId)) || null
    merged.push({
      PERSON_ID: personId,
      STUDY_SESSION_ID: entry.sessionId ?? null,
      OBSERVATION_MOTIF_ID: entry.motifId ?? null,
      PER_PERSON_ID: entry.perPersonId ?? null,
      TEACHER_OBSERVATION_NOTE: entry.note || '',
      OBSERVATION_DATETIME: entry.datetime ?? null,
      OBSERVATION_MOTIF_LABEL: motif?.OBSERVATION_MOTIF_LABEL || motif?.OBSERVATION_MOTIF_LABEL_EN,
      OBSERVATION_MOTIF_CODE: motif?.OBSERVATION_MOTIF_CODE,
      PENDING_LOCAL: true
    })
  }

  return merged
}
