import React from 'react'
import { useI18n } from '../../i18n'

// Skeleton bar widths (percent) cycled across the fake rows for an organic look.
const SKELETON_WIDTHS = [92, 74, 85, 63, 80, 88, 70]

// Table body row covering the three empty states:
//   loading     — data is still being fetched (says so, then holds the rows)
//   hasFilters  — a search/filter is active but nothing matches
//   otherwise   — no data at all
//
// The caller may pass `hint` (why) and `action` (the one control that resolves
// it), so "No records found" never stands alone.
//
//   <TableEmptyState
//     colSpan={8}
//     loading={loading}
//     hasFilters={!!searchTerm}
//     loadingLabel="Loading teachers..."
//     emptyLabel="No teachers found"
//     filteredLabel="No teachers match your filters"
//     hint="Add the first person from the register, or clear the filters."
//     action={<button ...>Clear filters</button>}
//   />
const TableEmptyState = ({
  colSpan,
  loading = false,
  hasFilters = false,
  loadingLabel = 'Loading...',
  emptyLabel = 'No records found',
  filteredLabel = 'No records match your filters',
  hint,
  action,
  skeletonRows = 5
}) => {
  const { t } = useI18n()

  if (loading) {
    return (
      <tr>
        <td colSpan={colSpan} className="px-4 py-4">
          <div role="status" aria-live="polite" className="mb-2 text-[11px] text-ink-3">
            {t(loadingLabel)}
          </div>
          <div aria-hidden="true" className="space-y-1.5">
            {Array.from({ length: skeletonRows }, (_, i) => (
              <div
                key={i}
                className="h-[var(--row-h)] rounded-[2px] border border-line bg-surface-muted"
                style={{ width: `${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}%` }}
              />
            ))}
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <p className="text-[12.5px] font-medium text-ink-2">
          {hasFilters ? t(filteredLabel) : t(emptyLabel)}
        </p>
        {hint ? (
          <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-ink-3">{t(hint)}</p>
        ) : null}
        {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
      </td>
    </tr>
  )
}

export default TableEmptyState
