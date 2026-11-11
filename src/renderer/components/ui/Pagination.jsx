import React, { useMemo } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useI18n } from '../../i18n'

// Dense page control. `compact` drops the summary (used when the host screen
// already reports the row range) and the wrapper padding.
const Pagination = ({ page, totalItems, pageSize, onPageChange, compact = false }) => {
  const { t } = useI18n()
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, totalPages)

  const pageList = useMemo(() => {
    const pages = []
    const push = (value) => {
      if (pages[pages.length - 1] !== value) pages.push(value)
    }
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i += 1) push(i)
    } else {
      const wanted = [1, safePage - 1, safePage, safePage + 1, totalPages]
        .filter((value) => value >= 1 && value <= totalPages)
        .sort((a, b) => a - b)
      wanted.forEach(push)
    }
    return pages
  }, [totalPages, safePage])

  if (totalItems <= pageSize) return null

  const arrow = 'grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    <div className={compact ? 'flex items-center gap-1' : 'flex items-center justify-between gap-4 border-t border-line px-3 py-2'}>
      {!compact && (
        <span className="text-[10.5px] text-ink-3">
          {t('Showing {from}–{to} of {total}', {
            from: (safePage - 1) * pageSize + 1,
            to: Math.min(safePage * pageSize, totalItems),
            total: totalItems
          })}
        </span>
      )}
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => onPageChange(1)} disabled={safePage === 1} aria-label={t('First page')} className={arrow}>
          <ChevronsLeft size={12} className="rtl:rotate-180" />
        </button>
        <button type="button" onClick={() => onPageChange(Math.max(1, safePage - 1))} disabled={safePage === 1} aria-label={t('Previous page')} className={arrow}>
          <ChevronLeft size={12} className="rtl:rotate-180" />
        </button>

        {pageList.map((value, index) => (
          <React.Fragment key={value}>
            {index > 0 && value - pageList[index - 1] > 1 && (
              <span className="px-0.5 text-[10px] text-ink-3 select-none">…</span>
            )}
            <button
              type="button"
              onClick={() => onPageChange(value)}
              aria-current={value === safePage ? 'page' : undefined}
              className={`mono h-6 min-w-6 rounded-[3px] px-1 text-[10.5px] ${
                value === safePage
                  ? 'border border-line-strong bg-surface text-ink'
                  : 'text-ink-3 hover:bg-surface-muted hover:text-ink'
              }`}
            >
              {value}
            </button>
          </React.Fragment>
        ))}

        <button type="button" onClick={() => onPageChange(Math.min(totalPages, safePage + 1))} disabled={safePage === totalPages} aria-label={t('Next page')} className={arrow}>
          <ChevronRight size={12} className="rtl:rotate-180" />
        </button>
        <button type="button" onClick={() => onPageChange(totalPages)} disabled={safePage === totalPages} aria-label={t('Last page')} className={arrow}>
          <ChevronsRight size={12} className="rtl:rotate-180" />
        </button>
      </div>
    </div>
  )
}

export default Pagination
