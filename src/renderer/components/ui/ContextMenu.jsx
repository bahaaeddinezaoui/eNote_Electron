import React, { useCallback, useEffect, useRef, useState } from 'react'
import { tr } from '../../i18n'

// A lightweight, native-feeling context menu: portalled to <body>, clamped to
// the viewport, keyboard navigable, dismissed by Escape, outside click, scroll
// or blur. Items: { label, icon, onSelect, shortcut, danger, disabled, sep }.
export default function ContextMenu({ open, x, y, items = [], onClose }) {
  const ref = useRef(null)
  const [active, setActive] = useState(-1)

  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.sep && !item.disabled)

  const close = useCallback(() => {
    setActive(-1)
    onClose?.()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) close()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        if (!selectable.length) return
        const current = selectable.findIndex(({ index }) => index === active)
        const step = event.key === 'ArrowDown' ? 1 : -1
        const next = (current + step + selectable.length) % selectable.length
        setActive(selectable[next].index)
      }
      if (event.key === 'Enter' && active >= 0) {
        event.preventDefault()
        const entry = items[active]
        if (entry && !entry.disabled) {
          entry.onSelect?.()
          close()
        }
      }
    }
    window.addEventListener('mousedown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    document.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open, active, items, selectable, close])

  useEffect(() => {
    if (!open) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const margin = 8
    let left = x
    let top = y
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin
    if (top + rect.height > window.innerHeight - margin) top = y - rect.height
    el.style.left = `${Math.max(margin, left)}px`
    el.style.top = `${Math.max(margin, top)}px`
  }, [open, x, y, items.length])

  if (!open) return null

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={tr('Row actions')}
      className="fixed z-[80] w-56 rounded-md border border-line-strong p-1 anim-plate"
      style={{
        left: x,
        top: y,
        background: 'var(--color-raised)',
        border: '1px solid var(--color-line-strong)',
        boxShadow: 'var(--shadow-e2)'
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) => {
        if (item.sep) return <div key={`sep-${index}`} className="menu-sep" role="separator" />
        const Icon = item.icon
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            data-active={active === index}
            data-danger={item.danger || undefined}
            className="menu-item disabled:opacity-40 disabled:cursor-not-allowed"
            onMouseEnter={() => setActive(index)}
            onClick={() => {
              if (item.disabled) return
              item.onSelect?.()
              close()
            }}
          >
            {Icon ? <Icon size={13} strokeWidth={1.75} className="shrink-0 opacity-80" /> : <span className="w-[13px]" />}
            <span className="truncate">{item.label}</span>
            {item.shortcut && <span className="kbd ms-auto">{item.shortcut}</span>}
          </button>
        )
      })}
    </div>
  )
}
