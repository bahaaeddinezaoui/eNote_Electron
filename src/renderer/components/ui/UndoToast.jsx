import React, { useEffect } from 'react'
import { Undo2, X } from 'lucide-react'
import { useI18n } from '../../i18n'

// A short-lived confirmation for an action that can be taken back. The toast
// carries the only copy of the previous state, so it is dismissed the moment the
// undo runs.
const UndoToast = ({ message, onUndo, onClose, duration = 6000 }) => {
  const { t } = useI18n()

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => onClose?.(), duration)
    return () => clearTimeout(timer)
  }, [message, duration, onClose])

  if (!message) return null

  // Centred with auto margins, not a translate: the arrival animation owns the
  // transform, so a centering transform would snap back when it ends.
  return (
    <div
      role="status"
      aria-live="polite"
      className="motion-toast fixed inset-x-0 bottom-20 z-[60] mx-auto flex w-[min(92vw,420px)] items-center gap-3 rounded-md border border-line-strong bg-raised px-3 py-2"
      style={{ boxShadow: 'var(--shadow-e2)' }}
    >
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{t(message)}</span>
      <button
        type="button"
        onClick={() => {
          onUndo?.()
          onClose?.()
        }}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-2 text-[10.5px] font-semibold text-ink hover:bg-surface-muted"
      >
        <Undo2 size={10} /> {t('Undo')}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('Dismiss')}
        className="grid h-5 w-5 shrink-0 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
      >
        <X size={11} />
      </button>
    </div>
  )
}

export default UndoToast
