import React, { useEffect, useState } from 'react'
import { tr } from '../../i18n'

// Caption buttons for the frameless window. The glyphs are drawn at 10px so
// they stay crisp; the bar they sit in is the app's own title bar.
const Glyph = ({ children }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    shapeRendering="crispEdges"
    aria-hidden="true"
  >
    {children}
  </svg>
)

const WindowControls = () => {
  const [maximized, setMaximized] = useState(false)
  const available = typeof window !== 'undefined' && !!window.api?.minimizeWindow

  useEffect(() => {
    if (!available) return undefined
    let alive = true
    window.api
      .isWindowMaximized()
      .then((value) => {
        if (alive) setMaximized(!!value)
      })
      .catch(() => {})
    const unsubscribe = window.api.onWindowMaximized((value) => setMaximized(!!value))
    return () => {
      alive = false
      if (typeof unsubscribe === 'function') unsubscribe()
    }
  }, [available])

  if (!available) return null

  return (
    <div className="flex h-full shrink-0 items-stretch border-s border-line" role="group" aria-label={tr('Window controls')}>
      <button
        type="button"
        className="win-btn"
        title={tr('Minimize')}
        aria-label={tr('Minimize window')}
        onClick={() => window.api.minimizeWindow()}
      >
        <Glyph>
          <path d="M1.5 6.5h7" />
        </Glyph>
      </button>

      <button
        type="button"
        className="win-btn"
        title={maximized ? tr('Restore') : tr('Maximize')}
        aria-label={maximized ? tr('Restore window') : tr('Maximize window')}
        onClick={async () => {
          try {
            const next = await window.api.toggleMaximizeWindow()
            if (typeof next === 'boolean') setMaximized(next)
          } catch {
            /* the window may already be closing */
          }
        }}
      >
        {maximized ? (
          <Glyph>
            <rect x="0.5" y="3.5" width="6" height="6" />
            <path d="M3.5 3.5v-3h6v6h-3" />
          </Glyph>
        ) : (
          <Glyph>
            <rect x="1.5" y="1.5" width="7" height="7" />
          </Glyph>
        )}
      </button>

      <button
        type="button"
        className="win-btn win-btn--close"
        title={tr('Close')}
        aria-label={tr('Close window')}
        onClick={() => window.api.closeWindow()}
      >
        <Glyph>
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </Glyph>
      </button>
    </div>
  )
}

export default WindowControls
