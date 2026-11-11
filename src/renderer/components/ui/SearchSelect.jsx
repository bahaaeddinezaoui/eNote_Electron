import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { tr } from '../../i18n'

// A dropdown that carries its own search box. Long lists (majors, instructors,
// rooms, time slots) need a way to narrow them, and a single shared box left it
// unclear which list a typed word was filtering.
const SearchSelect = ({ value, onChange, options, placeholder, emptyLabel, disabled, className = '' }) => {
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

  const selected = options.find((option) => String(option.value) === String(value))
  const needle = query.trim().toLowerCase()
  const visible = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options

  const close = () => { setOpen(false); setQuery('') }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className="field flex w-full items-center justify-between gap-2 text-start disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`truncate ${selected ? '' : 'text-ink-3'}`}>
          {selected ? selected.label : (placeholder || '')}
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
          <ul role="listbox" className="max-h-[190px] overflow-y-auto py-1">
            {visible.length === 0 ? (
              <li className="px-3 py-2 text-[11.5px] text-ink-3">
                {needle ? tr('No match for this search') : (emptyLabel || tr('No options'))}
              </li>
            ) : (
              visible.map((option) => {
                const isSelected = String(option.value) === String(value)
                return (
                  <li key={option.value} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      disabled={option.disabled}
                      onClick={() => { onChange(String(option.value)); close() }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-start text-[11.5px] ${
                        option.disabled ? 'cursor-not-allowed text-ink-3' : 'text-ink hover:bg-surface-muted'
                      } ${isSelected ? 'bg-selection' : ''}`}
                    >
                      <span className="truncate">{option.label}</span>
                      {option.hint && <span className="ms-auto shrink-0 text-[10px] text-ink-3">{option.hint}</span>}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

export default SearchSelect
