import React from 'react'

// The single button contract for the app. Flat fills, 32/36px heights, a
// pressed state measured in shadow rather than scale.
const VARIANTS = {
  primary:
    'bg-jade-solid text-on-jade hover:brightness-110 active:brightness-95 border border-transparent font-semibold',
  secondary:
    'bg-surface text-ink-2 border border-line-strong hover:bg-surface-muted hover:text-ink',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-muted hover:text-ink',
  danger:
    'bg-transparent text-danger-ink border border-danger/40 hover:bg-danger-bg',
  'danger-solid': 'bg-danger text-[var(--color-canvas)] border border-transparent hover:brightness-110 font-semibold',
  success: 'bg-success text-[var(--color-canvas)] border border-transparent hover:brightness-110 font-semibold'
}

const SIZES = {
  sm: 'h-7 px-2 text-[11px] rounded-[3px] gap-1',
  md: 'h-8 px-2.5 text-[11.5px] rounded-[4px] gap-1.5',
  lg: 'h-9 px-3 text-[12.5px] rounded-[4px] gap-2'
}

export const Spinner = ({ size = 12 }) => (
  <span
    className="inline-block shrink-0 animate-spin rounded-full border-current border-2 border-t-transparent"
    style={{ width: size, height: size, animationDuration: '620ms' }}
    aria-hidden="true"
  />
)

const Button = ({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  children,
  ...rest
}) => (
  <button
    type={type}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    onClick={onClick}
    // A primary fill gets the light sweep of `.motion-sheen`; the flat
    // secondary variants stay flat, which is the whole point of the system.
    className={`inline-flex select-none items-center justify-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40 ${variant === 'primary' ? 'motion-sheen' : ''} ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${className}`}
    style={{ color: variant === 'primary' ? 'var(--color-on-jade)' : undefined, transition: 'background-color 120ms cubic-bezier(.2,.8,.2,1), color 120ms, border-color 120ms' }}
    {...rest}
  >
    {loading && <Spinner />}
    {children}
  </button>
)

export default Button
