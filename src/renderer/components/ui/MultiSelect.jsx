import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { tr } from '../../i18n'

// Picking several values from one list.
//
// A native <select multiple> wants a ctrl-click per extra choice and shows the
// options as one undifferentiated column, which does not hold up against a
// faculty directory of any size. Here every row is a checkbox — a plain click
// toggles it, the list stays open while the set is built, and a search box
// narrows it. What is chosen is echoed as removable chips under the trigger, so
// the selection stays readable once the list closes.
export default function MultiSelect({
  values = [],
  onChange,
  options = [],
  placeholder,
  emptyLabel,
  disabled = false,
  className = ''
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef(null)

  // A click anywhere else closes the list; reopening starts from a clean query.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const chosen = useMemo(() => new Set(values.map((value) => String(value))), [values])
  const labels = useMemo(
    () => new Map(options.map((option) => [String(option.value), option.label])),
    [options]
  )

  const needle = query.trim().toLowerCase()
  const visible = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options

  // The result follows the order of the list the values came from, so the chips
  // never reshuffle as more are picked.
  const emit = (next) =>
    onChange(options.filter((option) => next.has(String(option.value))).map((option) => String(option.value)))

  const toggle = (value) => {
    const next = new Set(chosen)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    emit(next)
  }

  return (
    <div ref={boxRef} className={className}>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          disabled={disabled}
          className="field flex w-full items-center justify-between gap-2 text-start disabled:opacity-60"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={`truncate ${values.length ? '' : 'text-ink-3'}`}>
            {values.length
              ? tr('{count} selected', { count: values.length })
              : (placeholder || '')}
          </span>
          <ChevronDown size={14} className="shrink-0 text-ink-3" />
        </button>

        {open && (
          <div className="absolute z-20 mt-1 w-full rounded-[4px] border border-line-strong bg-surface shadow-2xl">
            <div className="relative border-b border-line p-1.5">
              <Search size={12} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tr('Search…')}
                aria-label={tr('Search this list')}
                className="field h-7 w-full ps-6 text-[11.5px]"
              />
            </div>

            <ul role="listbox" aria-multiselectable="true" className="max-h-[220px] overflow-y-auto py-1">
              {visible.length === 0 ? (
                <li className="px-3 py-2 text-[11.5px] text-ink-3">
                  {needle ? tr('No match for this search') : (emptyLabel || tr('No options'))}
                </li>
              ) : (
                visible.map((option) => {
                  const value = String(option.value)
                  const isSelected = chosen.has(value)
                  return (
                    <li key={value} role="option" aria-selected={isSelected}>
                      <button
                        type="button"
                        onClick={() => toggle(value)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-[11.5px] text-ink hover:bg-surface-muted ${
                          isSelected ? 'bg-selection' : ''
                        }`}
                      >
                        <span
                          className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                            isSelected ? 'border-jade-solid bg-jade-solid text-on-jade' : 'border-line-strong'
                          }`}
                        >
                          {isSelected && <Check size={10} strokeWidth={3} />}
                        </span>
                        <span className="truncate">{option.label}</span>
                      </button>
                    </li>
                  )
                })
              )}
            </ul>

            {/* With a directory this long, narrowing to "everyone whose name
                matches" needs a single action, and undoing it needs another. */}
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[10.5px]">
              <button
                type="button"
                onClick={() => emit(new Set([...chosen, ...visible.map((option) => String(option.value))]))}
                disabled={visible.length === 0}
                className="text-ink-2 hover:text-ink disabled:opacity-50"
              >
                {needle ? tr('Select all matches') : tr('Select all')}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={values.length === 0}
                className="text-ink-2 hover:text-ink disabled:opacity-50"
              >
                {tr('Clear')}
              </button>
            </div>
          </div>
        )}
      </div>

      {values.length > 0 && (
        <div className="mt-1.5 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {values.map((value) => {
            const key = String(value)
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-[4px] bg-surface-muted px-1.5 py-0.5 text-[10.5px] text-ink-2"
              >
                {labels.get(key) || key}
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-label={tr('Remove')}
                  className="text-ink-3 hover:text-ink"
                >
                  <X size={10} />
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
