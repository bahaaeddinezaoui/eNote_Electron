import React from 'react'
import { useI18n } from '../../i18n'

// Card-grid counterparts of TableEmptyState. A loading state says what it is
// loading; an empty state says why it is empty and, when the caller passes one,
// offers the single action that fills it. Skeletons hold the layout but never
// pulse: perpetual motion in the corner of a work screen is noise, not feedback.
export const CardSkeletonGrid = ({ count = 6, loadingLabel = 'Loading...' }) => {
  const { t } = useI18n()
  return (
    <>
      <div role="status" aria-live="polite" className="px-1 pb-2 text-[11px] text-ink-3">
        {t(loadingLabel)}
      </div>
      <div
        aria-hidden="true"
        className="grid grid-cols-1 gap-px bg-line md:grid-cols-2 xl:grid-cols-3"
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="bg-surface p-3.5">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-full border border-line bg-surface-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 rounded-[2px] bg-surface-muted" />
                <div className="h-2 w-1/3 rounded-[2px] bg-surface-muted" />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-2 w-3/4 rounded-[2px] bg-surface-muted" />
              <div className="h-2 w-1/2 rounded-[2px] bg-surface-muted" />
              <div className="h-2 w-2/5 rounded-[2px] bg-surface-muted" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export const CardEmptyMessage = ({ label, hint, action }) => {
  const { t } = useI18n()
  return (
    <div className="py-10 text-center">
      <p className="text-[12.5px] font-medium text-ink-2">{t(label)}</p>
      {hint ? (
        <p className="mx-auto mt-1 max-w-sm text-[11px] leading-relaxed text-ink-3">{t(hint)}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}
