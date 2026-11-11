import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal, X, Search } from 'lucide-react'
import { tr, useI18n } from '../../i18n'

// Shared classes for filter fields rendered inside the filter panel.
export const filterLabelCls = 'kicker mb-1 block text-[9px]'
export const filterInputCls = 'field h-7 w-full text-[11.5px]'
export const filterSearchCls = 'field h-7 w-full ps-7 text-[11.5px]'

// Ready-made search field for the panel (name-search icon + input).
//
//   <FilterField label="Search">
//     <input ... />
//   </FilterField>
export const FilterField = ({ label, children }) => (
  <div>
    <label className={filterLabelCls}>{label}</label>
    {children}
  </div>
)

export const FilterSearchField = ({ label = 'Search', placeholder, value, onChange }) => {
  const { t } = useI18n()
  return (
    <FilterField label={t(label)}>
      <div className="relative">
        <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
        <input
          type="text"
          placeholder={placeholder}
          className={filterSearchCls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </FilterField>
  )
}

// The one filter bar. An ordinary toolbar control that opens the page's
// filters in a popover, so filtering never costs a row of vertical space and
// never floats over the table (an earlier floating button covered the last
// rows and the bottom corner of split panes).
//
// Pages that treat search as a first-class control pass `search`/`onSearch`
// and get the inline search field beside the trigger; pages with a short
// filter list can keep search inside the panel with FilterSearchField.
// `onReset` adds the page's "back to the default view" action to the panel
// footer, beside "clear filters", so screens do not grow their own strip of
// active-filter chips.
//
// The panel is portalled and positioned from the trigger's rect, so it is not
// clipped by a panel that scrolls or hides its overflow.
//
//   <FilterBar
//     activeCount={activeFilterCount}
//     onClear={() => setFilters(emptyFilters)}
//     onReset={resetView}
//     matchCount={filteredRows.length}
//     matchLabel="teacher"
//     search={q} onSearch={setQ}
//     searchPlaceholder="Search name or reference"
//     searchLabel="Search teachers"
//   >
//     <FilterField label="Sex">...</FilterField>
//   </FilterBar>
const FilterBar = ({
  activeCount = 0,
  onClear,
  onReset,
  resetLabel = 'Reset view',
  matchCount,
  matchLabel = 'result',
  title = 'Filters',
  search,
  onSearch,
  searchPlaceholder = 'Search...',
  searchLabel = 'Search',
  searchInputRef,
  searchShortcut,
  searchWidthClass = 'w-[210px]',
  children
}) => {
  const { t, lang, dir } = useI18n()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const [position, setPosition] = useState(null)
  const panelId = useId()

  // Place the panel under the trigger, flipping above it when the lower half
  // of the window has no room. Everything is clamped inside the viewport, so a
  // trigger near either edge still opens fully on screen.
  const place = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const width = Math.min(320, window.innerWidth - margin * 2)
    const preferred = dir === 'rtl' ? rect.left : rect.right - width
    const left = Math.min(Math.max(margin, preferred), window.innerWidth - width - margin)
    const height = panelRef.current?.offsetHeight || 0
    const spaceBelow = window.innerHeight - rect.bottom - margin
    const spaceAbove = rect.top - margin
    const openUp = height > 0 && height > spaceBelow && spaceAbove > spaceBelow
    const top = openUp
      ? Math.max(margin, rect.top - height - 6)
      : Math.min(rect.bottom + 6, Math.max(margin, window.innerHeight - margin - height))
    setPosition({ left, top, width })
  }, [dir])

  // Escape closes the panel, like every other overlay in the app.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Keep the panel attached to its trigger while the page scrolls or the
  // window is resized; follow its own height as fields inside it change.
  useLayoutEffect(() => {
    if (!open) return
    place()
    const panel = panelRef.current
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => place()) : null
    if (panel && observer) observer.observe(panel)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  // A new page or a closing panel must not leave a stale position behind.
  useEffect(() => {
    if (!open) setPosition(null)
  }, [open])

  const panel = open ? createPortal(
    <>
      {/* Click-away layer. Same layer as the popover; the panel follows it in
          the DOM, so it paints above the layer without a second z-index. */}
      <div
        className="fixed inset-0 z-40"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        id={panelId}
        role="dialog"
        aria-label={t(title)}
        dir={dir}
        className="anim-plate fixed z-40 overflow-hidden rounded-lg border border-line-strong bg-raised"
        style={{
          left: position?.left ?? 0,
          top: position?.top ?? 0,
          width: position?.width ?? 320,
          visibility: position ? 'visible' : 'hidden',
          boxShadow: 'var(--shadow-e2)'
        }}
      >
        <div className="flex h-9 items-center justify-between border-b border-line px-3">
          <h5 className="kicker inline-flex items-center gap-1.5">
            <SlidersHorizontal size={11} /> {t(title)}
          </h5>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid h-5 w-5 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
            aria-label={t('Close filters')}
          >
            <X size={12} />
          </button>
        </div>

        <div className="anim-stagger max-h-[60vh] space-y-2.5 overflow-y-auto p-3">
          {children}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-muted px-3 py-2">
          {matchCount !== undefined && (
            <span className="mono whitespace-nowrap text-[10.5px] text-ink-3">
              {lang === 'en'
                ? `${matchCount} ${matchLabel}${matchCount === 1 ? '' : 's'} found`
                : t(matchCount === 1 ? tr('{count} result found') : tr('{count} results found'), { count: matchCount })}
            </span>
          )}
          <div className="ms-auto flex items-center gap-1.5">
            {onReset && (
              <button
                type="button"
                onClick={() => { onReset(); setOpen(false) }}
                className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line bg-surface px-2 text-[10.5px] text-ink-3 hover:bg-surface-muted hover:text-ink"
              >
                {t(resetLabel)}
              </button>
            )}
            {activeCount > 0 && onClear ? (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex h-6 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-2 text-[10.5px] text-ink-2 hover:bg-surface-muted hover:text-ink"
              >
                <X size={10} /> {t('Clear filters ({count})', { count: activeCount })}
              </button>
            ) : (
              !onReset && <span className="text-[10.5px] text-ink-3">{t('No active filters')}</span>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  ) : null

  return (
    <>
      {onSearch && (
        <div className={`relative shrink-0 ${searchWidthClass}`}>
          <Search className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={12} />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t(searchPlaceholder)}
            aria-label={t(searchLabel)}
            className={`field h-7 ps-7 text-[11.5px] ${searchShortcut ? 'pe-9' : 'pe-2'}`}
          />
          {searchShortcut && (
            <span className="kbd pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2">{searchShortcut}</span>
          )}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[4px] border px-2 text-[11px] font-medium ${
          activeCount > 0 || open
            ? 'border-jade-600 bg-selection text-ink'
            : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-muted hover:text-ink'
        }`}
        title={t(title)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <SlidersHorizontal size={11} />
        {t('Filters')}
        {activeCount > 0 && (
          <span className="mono min-w-[15px] rounded-[2px] bg-jade-solid px-1 text-[9.5px] font-semibold leading-[15px] text-on-jade">
            {activeCount}
          </span>
        )}
      </button>

      {panel}
    </>
  )
}

export default FilterBar
