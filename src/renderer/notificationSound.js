// The chime that plays when a new notification arrives — one per kind.
//
// Synthesised with the Web Audio API rather than shipped as a file: there are no
// binary assets to package, no decode delay, and the tones stay quiet. Each kind
// of notification has its own short motif, so a missed class, a new message and
// a punishment recorded against you are told apart without looking at the
// screen: the family (student record, session, teaching, account, message) sets
// the register, and the kind sets the notes.
//
// Everything is best-effort. A missing audio device, a suspended context or a
// failed resume must never break the notification itself, so every failure is
// swallowed.

let context = null
let lastPlayedAt = 0

// Sound is a preference of this installation, not of the account: it belongs
// to the machine's speakers, exactly like the theme and the language. It is
// kept in localStorage and defaults to on, which is how the chime behaved
// before the switch existed.
const SOUND_KEY = 'enote-notification-sound'

export function isNotificationSoundEnabled() {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== '0'
  } catch {
    // A blocked storage must not silence the app; fall back to the default.
    return true
  }
}

export function setNotificationSoundEnabled(enabled) {
  try {
    window.localStorage.setItem(SOUND_KEY, enabled ? '1' : '0')
  } catch {
    // Nothing to do: the switch still works for this session.
  }
}

// One chime per couple of seconds, however many events the database announces
// at once (a busy save can raise several notifications in a row).
const MIN_INTERVAL_MS = 2000
const VOLUME = 0.08

// notes: [frequency in Hz, offset in seconds]; a motif is one to four notes.
const PATTERNS = {
  // Students' own records — descending, attention-getting.
  ABSENCE: { wave: 'sine', notes: [[880, 0], [587, 0.14]] },
  OBSERVATION: { wave: 'sine', notes: [[659, 0], [988, 0.12]] },
  DISCIPLINARY: { wave: 'triangle', notes: [[392, 0], [330, 0.13], [262, 0.26]] },
  ABSENCE_THRESHOLD: { wave: 'triangle', notes: [[700, 0], [700, 0.16], [880, 0.3]] },

  // Sessions — the two attendance alerts share a register but not their notes.
  TEACHER_REMINDER: { wave: 'sine', notes: [[784, 0], [1175, 0.12]] },
  TEACHER_MISSING: { wave: 'sine', notes: [[660, 0], [440, 0.15]] },
  SCHEDULE_CHANGE: { wave: 'triangle', notes: [[620, 0], [830, 0.1], [620, 0.22]] },
  SESSION_ASSIGNED: { wave: 'sine', notes: [[700, 0], [900, 0.12]] },
  EXAM_DUTY: { wave: 'sine', notes: [[520, 0], [780, 0.11], [1040, 0.22]] },

  // Teaching file.
  MARKS_MISSING: { wave: 'triangle', notes: [[840, 0], [630, 0.13], [840, 0.26]] },
  EXAM_SCHEDULED: { wave: 'triangle', notes: [[560, 0], [700, 0.1], [930, 0.2]] },
  LESSON_MATERIAL: { wave: 'sine', notes: [[600, 0], [900, 0.13]] },
  LIBRARY_REVIEW: { wave: 'sine', notes: [[620, 0], [930, 0.11], [1240, 0.22]] },
  LIBRARY_REVIEW_REQUEST: { wave: 'triangle', notes: [[700, 0], [700, 0.12], [1050, 0.24]] },
  ATTENDANCE_DIGEST: { wave: 'sine', notes: [[500, 0], [500, 0.15]] },
  ATTENDANCE_LOW: { wave: 'triangle', notes: [[330, 0], [300, 0.15], [270, 0.3]] },

  // Accounts and support.
  ACCOUNT_ALERT: { wave: 'triangle', notes: [[1000, 0], [750, 0.12], [500, 0.24]] },
  ACCOUNT_SECURITY: { wave: 'sine', notes: [[560, 0], [740, 0.1], [560, 0.2], [740, 0.3]] },
  CATEGORIES_CHANGED: { wave: 'triangle', notes: [[900, 0], [700, 0.13]] },
  DEPARTMENTS_CHANGED: { wave: 'triangle', notes: [[900, 0], [700, 0.13]] },
  BETA_PROBLEM: { wave: 'triangle', notes: [[1200, 0], [900, 0.12], [1200, 0.24]] },
  BUG_STATUS: { wave: 'sine', notes: [[700, 0], [1050, 0.11]] },

  // Messages — the softest of the family.
  DIRECT_MESSAGE: { wave: 'sine', notes: [[880, 0], [1100, 0.1]] },
  INBOX_MESSAGE: { wave: 'sine', notes: [[740, 0], [988, 0.12]] }
}

const FALLBACK_PATTERN = { wave: 'sine', notes: [[784, 0], [1175, 0.12]] }

export const notificationPattern = (recordType) => PATTERNS[recordType] || FALLBACK_PATTERN

export function playNotificationSound(recordType) {
  try {
    if (!isNotificationSoundEnabled()) return

    const now = Date.now()
    if (now - lastPlayedAt < MIN_INTERVAL_MS) return
    lastPlayedAt = now

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return

    if (!context) context = new AudioContextClass()
    // Chromium starts the context suspended until the page has been interacted
    // with; resuming on a notification is harmless when it is already running.
    if (context.state === 'suspended') context.resume().catch(() => {})

    const pattern = notificationPattern(recordType)
    const start = context.currentTime
    const master = context.createGain()
    master.gain.value = VOLUME
    master.connect(context.destination)

    for (const [frequency, offset] of pattern.notes) {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      const begins = start + offset

      oscillator.type = pattern.wave
      oscillator.frequency.value = frequency

      // Quick attack, gentle decay: a chime rather than a click.
      envelope.gain.setValueAtTime(0.0001, begins)
      envelope.gain.linearRampToValueAtTime(1, begins + 0.015)
      envelope.gain.exponentialRampToValueAtTime(0.0001, begins + 0.32)

      oscillator.connect(envelope)
      envelope.connect(master)
      oscillator.start(begins)
      oscillator.stop(begins + 0.36)
    }
  } catch {
    // No sound is a cosmetic loss, never an error worth reporting.
  }
}
