import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { useI18n } from '../../i18n'

// Top-bar language switch (English / العربية / Français). The choice is stored on
// this device and also tells the main process which language to use for database
// reference labels.
//
// Two shapes: the compact code (EN / ع / FR) used in the application's title bar,
// and `withLabel`, the globe plus the current language in its own script, used on
// the public pages where there is room for it.
const LanguageToggle = ({ withLabel = false }) => {
  const { lang, setLang, languages, t, dir } = useI18n()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const active = languages.find((language) => language.code === lang) || languages[0]

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('Change language')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('Change language')}
        className={
          withLabel
            ? 'flex h-7 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2 text-[11.5px] text-ink-2 hover:bg-surface-muted hover:text-ink'
            : 'flex h-8 items-center gap-1 rounded-[3px] px-1.5 text-ink-3 hover:bg-surface-muted hover:text-ink'
        }
      >
        {withLabel ? (
          <>
            <Globe size={12} strokeWidth={1.75} className="shrink-0 text-ink-3" />
            <span dir={active.dir} className="leading-none">{active.label}</span>
            <ChevronDown size={11} strokeWidth={1.9} className="shrink-0 text-ink-3" />
          </>
        ) : (
          <span className="mono text-[10.5px] font-medium leading-none">{active.short}</span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('Language')}
          // The title bar is laid out left-to-right, so the panel hangs towards
          // the middle of the window from whichever end the toggle sits on.
          dir={dir}
          className={`absolute top-[calc(100%+6px)] z-40 w-40 rounded-md border border-line-strong bg-raised p-1 anim-plate ${
            dir === 'rtl' ? 'start-0' : 'end-0'
          }`}
          style={{ boxShadow: 'var(--shadow-e2)' }}
        >
          {languages.map((language) => {
            const selected = language.code === lang
            return (
              <button
                key={language.code}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  setLang(language.code)
                  setOpen(false)
                }}
                className="menu-item"
                data-active={selected}
              >
                <span dir={language.dir} className="truncate">{language.label}</span>
                {selected && <Check size={12} strokeWidth={2} className="ms-auto shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default LanguageToggle
