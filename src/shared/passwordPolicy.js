// One password policy for the whole application: the renderer draws the
// strength indicator from these checks and the main process enforces the same
// rules, so a valid-looking form can never save a password the server refuses.

export const PASSWORD_MIN_LENGTH = 8
// bcrypt hashes at most 72 bytes; longer input would be silently truncated.
export const PASSWORD_MAX_BYTES = 72

// The requirements a password must meet. Each one is also a line in the
// strength checklist shown under the field.
export const passwordChecks = (value = '') => ({
  length: value.length >= PASSWORD_MIN_LENGTH,
  uppercase: /[A-Z]/.test(value),
  lowercase: /[a-z]/.test(value),
  digit: /[0-9]/.test(value)
})

export const isPasswordValid = (value = '') => {
  const checks = passwordChecks(value)
  return checks.length && checks.uppercase && checks.lowercase && checks.digit
}

// 0–5: the four requirements plus an extra point for a symbol, so the meter
// can show "meets every rule" apart from "meets them and is harder to guess".
export const passwordStrength = (value = '') => {
  const passed = Object.values(passwordChecks(value)).filter(Boolean).length
  const symbol = /[^A-Za-z0-9]/.test(value)
  return Math.min(5, passed + (symbol ? 1 : 0))
}

// English message for the main process (the renderer pre-validates with its
// own translated text, so this only shows on a bypassed form).
export const passwordPolicyMessage = () =>
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a capital letter, a lowercase letter and a number.`

export const passwordBytesMessage = () =>
  `Password must be at most ${PASSWORD_MAX_BYTES} bytes.`
