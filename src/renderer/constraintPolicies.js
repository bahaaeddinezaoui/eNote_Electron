// The three ways a scheduler may treat a week's teacher constraints.
// `hard` ignores soft windows, `some` respects the soft rows the scheduler
// ticks, and `all` respects every declared window. The Admin can force one of
// these in Settings, in which case the scheduler's own choice is not read.
//
// The English labels are dictionary keys; render them through tr().
export const CONSTRAINT_POLICIES = [
  {
    id: 'hard',
    label: 'Only hard constraints',
    description: 'Soft windows are ignored; only windows marked unavailable block a session.'
  },
  {
    id: 'some',
    label: 'Hard and selected soft constraints',
    description: 'Hard windows block, and so do the soft windows the scheduler ticks.'
  },
  {
    id: 'all',
    label: 'All constraints',
    description: 'Every declared window blocks a session, hard or soft.'
  }
]

export const DEFAULT_CONSTRAINT_POLICY = 'hard'

export function normalizeConstraintPolicy(value) {
  const policy = String(value || '').toLowerCase()
  return CONSTRAINT_POLICIES.some((entry) => entry.id === policy)
    ? policy
    : DEFAULT_CONSTRAINT_POLICY
}

export function constraintPolicyLabel(value) {
  const policy = normalizeConstraintPolicy(value)
  return CONSTRAINT_POLICIES.find((entry) => entry.id === policy)?.label
    || CONSTRAINT_POLICIES[0].label
}
