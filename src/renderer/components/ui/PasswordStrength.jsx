import React from 'react'
import { Check, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PASSWORD_MIN_LENGTH, passwordChecks, passwordStrength } from '../../../shared/passwordPolicy'

// Strength meter for a password being chosen. The bars follow the policy in
// shared/passwordPolicy (the same rules the server enforces) and the checklist
// names the requirement still missing, so the reason a password is refused is
// visible while typing rather than after submitting.
//
//   <PasswordStrength value={newPassword} />
const LEVELS = [
  { key: 'Very weak', color: 'var(--color-danger)' },
  { key: 'Very weak', color: 'var(--color-danger)' },
  { key: 'Weak', color: 'var(--color-danger)' },
  { key: 'Fair', color: 'var(--color-warning)' },
  { key: 'Good', color: 'var(--color-success)' },
  { key: 'Strong', color: 'var(--color-success)' }
]

const PasswordStrength = ({ value = '', className = '' }) => {
  const { t } = useI18n()
  const checks = passwordChecks(value)
  const score = passwordStrength(value)
  const level = LEVELS[score]

  // An untouched field has nothing to report yet.
  if (!value) return null

  const requirements = [
    { key: 'length', label: t('At least {count} characters', { count: PASSWORD_MIN_LENGTH }) },
    { key: 'uppercase', label: t('One capital letter') },
    { key: 'lowercase', label: t('One lowercase letter') },
    { key: 'digit', label: t('One number') }
  ]

  return (
    <div className={`space-y-1.5 ${className}`} aria-live="polite">
      <div className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: index < score ? level.color : 'var(--color-line-strong)' }}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-ink-3">{t('Password strength')}</span>
        <span className="text-[10px] font-semibold" style={{ color: level.color }}>
          {t(level.key)}
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
        {requirements.map((requirement) => {
          const met = checks[requirement.key]
          return (
            <li key={requirement.key} className="inline-flex items-center gap-1 text-[10px] text-ink-3">
              {met
                ? <Check size={9} strokeWidth={2.6} style={{ color: 'var(--color-success)' }} aria-hidden="true" />
                : <X size={9} strokeWidth={2.6} aria-hidden="true" />}
              <span className={met ? 'text-ink-2' : undefined}>{requirement.label}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default PasswordStrength
