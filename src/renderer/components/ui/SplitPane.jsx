import { tr } from '../../i18n'
import React, { useCallback, useEffect, useRef, useState } from 'react'

// Horizontal split with a draggable seam. The secondary pane keeps a width
// (not a percentage) so tables and forms do not reflow while the user drags.
// Width persists per surface, and the seam is keyboard operable.
export default function SplitPane({
  children,
  aside,
  storageKey = 'enote-split',
  initial = 420,
  min = 320,
  max = 720,
  asideLabel = 'Detail panel',
  side = 'end'
}) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(storageKey))
      return Number.isFinite(stored) && stored >= min ? stored : initial
    } catch {
      return initial
    }
  })
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback(
    (next) => {
      const containerWidth = containerRef.current?.getBoundingClientRect().width || 1200
      const ceiling = Math.min(max, Math.max(min, containerWidth - 360))
      return Math.min(ceiling, Math.max(min, next))
    },
    [min, max]
  )

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(width)))
    } catch {
      // persistence is optional
    }
  }, [width, storageKey])

  useEffect(() => {
    if (!dragging) return
    const onMove = (event) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      setWidth(clamp(side === 'start' ? event.clientX - rect.left : rect.right - event.clientX))
    }
    const stop = () => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [dragging, clamp, side])

  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setWidth((w) => clamp(w + 24))
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setWidth((w) => clamp(w - 24))
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setWidth(clamp(initial))
    }
  }

  const asideNode = (
    <aside
      aria-label={asideLabel}
      className="flex min-h-0 shrink-0 flex-col overflow-hidden bg-surface"
      style={{ width: `${width}px` }}
    >
      {aside}
    </aside>
  )

  const handle = (
      <div
        key="seam"
        role="separator"
        aria-orientation="vertical"
        aria-label={asideLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        data-dragging={dragging}
        className="split-handle"
        onPointerDown={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDoubleClick={() => setWidth(clamp(initial))}
        onKeyDown={onKeyDown}
        title={tr("Drag to resize · double-click to reset")}
      />
  )

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1">
      {side === 'start' ? (
        <>
          {asideNode}
          {handle}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </>
      ) : (
        <>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
          {handle}
          {asideNode}
        </>
      )}
    </div>
  )
}
