import React from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useI18n } from '../../i18n'

// Inline failure state for a list that could not load. It names what failed,
// offers the one action that can recover it, and keeps the technical detail
// available without making it the message.
const ListError = ({ label = 'Could not load this list', detail, onRetry }) => {
  const { t } = useI18n()
  return (
    <div
      role="alert"
      className="m-3 rounded-md border px-4 py-3"
      style={{
        borderColor: 'color-mix(in srgb, var(--color-danger) 40%, transparent)',
        background: 'var(--color-danger-bg)'
      }}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--color-danger-ink)' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink">{t(label)}</p>
          {detail ? (
            <p className="mt-0.5 break-words text-[11px] leading-relaxed text-ink-2">{detail}</p>
          ) : null}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex h-6 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-2 text-[10.5px] text-ink-2 hover:bg-surface-muted hover:text-ink"
            >
              <RotateCw size={10} /> {t('Retry')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default ListError
