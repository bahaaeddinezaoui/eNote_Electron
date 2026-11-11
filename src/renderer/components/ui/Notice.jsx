import React, { useEffect } from 'react'
import { AlertCircle, Check, X } from 'lucide-react'
import { useI18n } from '../../i18n'

// Status message for export/save/background completion. Anchored to the
// bottom-inline-end above any save bar, never covering table headers.
const Notice = ({ notice, onDismiss }) => {
  const { t } = useI18n()
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => onDismiss?.(), notice.persist ? 12000 : 4200)
    return () => clearTimeout(timer)
  }, [notice, onDismiss])

  if (!notice) return null
  const isError = notice.type === 'error'
  return (
    <div
      role="status"
      aria-live={isError ? 'assertive' : 'polite'}
      className="toast-layer fixed bottom-4 end-4 z-[70] flex max-w-[360px] items-start gap-2 rounded-md border px-3 py-2.5 motion-toast"
      style={{
        background: 'var(--color-raised)',
        borderColor: isError ? 'color-mix(in srgb, var(--color-danger) 40%, transparent)' : 'var(--color-line-strong)',
        boxShadow: 'var(--shadow-e2)'
      }}
    >
      {isError ? (
        <AlertCircle size={13} className="mt-px shrink-0" style={{ color: 'var(--color-danger-ink)' }} />
      ) : (
        <Check size={13} className="mt-px shrink-0" style={{ color: 'var(--color-success-ink)' }} />
      )}
      <span className="text-[11.5px] leading-snug text-ink-2">{notice.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('Dismiss message')}
        className="ms-1 grid h-4 w-4 shrink-0 place-items-center text-ink-3 hover:text-ink"
      >
        <X size={11} strokeWidth={2} />
      </button>
    </div>
  )
}

export default Notice
