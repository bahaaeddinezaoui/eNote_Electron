import React, { useEffect, useRef, useState } from 'react'
import { Check, Circle, Monitor, Moon, Sun } from 'lucide-react'
import { setAccent, setTheme, useAccent, useTheme } from '../../theme'
import {
  INTERFACE_SCALES,
  interfaceScalePercent,
  useInterfaceScale
} from '../../interfaceScale'
import { useI18n } from '../../i18n'

// Header control for the interface appearance and its accent colour.
//
// Two independent choices, one panel: the palette (emerald, red, gold, blue,
// pink), the appearance (light, dark, pure black, or "Match system settings",
// which follows
// the operating system's light/dark setting and never resolves to pure black —
// that one is only ever an explicit choice, see theme.js), and the scale the
// whole window is drawn at.
const APPEARANCES = [
  { id: 'light', icon: Sun, label: 'Light appearance' },
  { id: 'dark', icon: Moon, label: 'Dark appearance' },
  { id: 'oled', icon: Circle, label: 'Pure black' },
  { id: 'system', icon: Monitor, label: 'Match system settings' }
]

const ICONS = { light: Sun, dark: Moon, oled: Circle, system: Monitor }

// The swatch is the palette's own action colour at its dark-appearance value:
// it is a preview of the colour, not a themed element.
const ACCENTS = [
  { id: 'emerald', label: 'Emerald', swatch: '#3ba97d' },
  { id: 'red', label: 'Red', swatch: '#d95c64' },
  { id: 'gold', label: 'Gold', swatch: '#d9a93f' },
  { id: 'blue', label: 'Blue', swatch: '#5b93d6' },
  { id: 'pink', label: 'Pink', swatch: '#dd6f96' }
]

const ThemeToggle = () => {
  const [theme] = useTheme()
  const [accent] = useAccent()
  const [scale, setScale] = useInterfaceScale()
  const { t, dir } = useI18n()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const buttonRef = useRef(null)
  // The panel's inline offset is measured, not inferred from the language: this
  // control sits at the start of the sign-in header and at the end of the
  // landing and application headers, so a direction-only rule (start/end) opens
  // it off the window on one of them. Measuring the button keeps it attached
  // and inside the viewport wherever the control is placed.
  const [panelLeft, setPanelLeft] = useState(0)
  // Wide enough for the five palette swatches to keep their labels.
  const PANEL_WIDTH = 288

  const placePanel = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    const margin = 8
    const viewport = document.documentElement.clientWidth || window.innerWidth
    // Hang it from the button's inline end, then pull it back inside the window.
    const left = Math.max(
      margin,
      Math.min(rect.right - PANEL_WIDTH, viewport - PANEL_WIDTH - margin)
    )
    setPanelLeft(left - rect.left)
  }

  // A language switch mirrors the header; the panel follows its button.
  useEffect(() => {
    if (open) placePanel()
  }, [open, dir, accent])

  useEffect(() => {
    if (!open) return undefined
    const onResize = () => placePanel()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])
  // The stored preference is what the menu marks as chosen: the resolved look
  // can be dark under 'system', but the choice is still "match the system".
  const preference = theme === 'light' || theme === 'dark' || theme === 'oled' ? theme : 'system'
  const CurrentIcon = ICONS[preference]

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
        ref={buttonRef}
        onClick={() => {
          if (!open) placePanel()
          setOpen((value) => !value)
        }}
        aria-label={t('Appearance')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('Appearance')}
        className="grid h-8 w-8 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
      >
        {/* Not keyed: the icon changes with the reveal, so it has to be settled
            by the time the incoming frame is captured — replaying its arrival
            animation here would freeze it mid-morph inside the snapshot. */}
        <span className="motion-icon">
          <CurrentIcon
            size={15}
            strokeWidth={1.75}
            fill={preference === 'dark' || preference === 'oled' ? 'currentColor' : 'none'}
          />
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('Appearance')}
          dir={dir}
          className="absolute top-[calc(100%+6px)] z-40 w-72 rounded-md border border-line-strong bg-raised p-1 anim-plate"
          style={{ left: panelLeft, boxShadow: 'var(--shadow-e2)' }}
        >
          <p className="kicker px-2 pb-1 pt-1 text-[8.5px]">{t('Accent colour')}</p>

          {/* Colour first: it is the choice that changes the whole window, the
              icon included. Five swatches rather than a list, so every palette
              is visible while choosing. */}
          <div className="flex gap-1 px-1 pb-1.5" role="group" aria-label={t('Accent colour')}>
            {ACCENTS.map((choice) => {
              const selected = choice.id === accent
              return (
                <button
                  key={choice.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  title={t(choice.label)}
                  // The swatch is handed to setAccent so the reveal of the new
                  // palette opens under the pointer.
                  onClick={(event) => setAccent(choice.id, event.currentTarget)}
                  className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[4px] border px-1 py-1.5 text-[10px] transition-colors ${
                    selected
                      ? 'border-line-strong bg-selection text-ink'
                      : 'border-transparent text-ink-3 hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  <span
                    className="grid h-[18px] w-[18px] place-items-center rounded-full"
                    style={{
                      border: `1px solid ${choice.swatch}`,
                      background: `color-mix(in srgb, ${choice.swatch} 22%, transparent)`
                    }}
                  >
                    {selected ? (
                      <Check size={10} strokeWidth={2.4} style={{ color: choice.swatch }} />
                    ) : (
                      <span
                        className="h-[6px] w-[6px] rounded-full"
                        style={{ background: choice.swatch }}
                      />
                    )}
                  </span>
                  <span className="truncate">{t(choice.label)}</span>
                </button>
              )
            })}
          </div>

          <div className="my-1 border-t border-line" />

          <p className="kicker px-2 pb-1 pt-0.5 text-[8.5px]">{t('Appearance')}</p>

          {APPEARANCES.map((choice) => {
            const Icon = choice.icon
            const selected = choice.id === preference
            return (
              <button
                key={choice.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                // The button is handed to setTheme so the reveal of the new
                // appearance opens under the pointer, not at the window centre.
                onClick={(event) => {
                  setTheme(choice.id, event.currentTarget)
                  setOpen(false)
                }}
                className="menu-item"
                data-active={selected}
              >
                <Icon
                  size={13}
                  strokeWidth={1.75}
                  className="shrink-0"
                  fill={choice.id === 'dark' || choice.id === 'oled' ? 'currentColor' : 'none'}
                />
                <span className="truncate">{t(choice.label)}</span>
                {selected && <Check size={12} strokeWidth={2} className="ms-auto shrink-0" />}
              </button>
            )
          })}

          {preference === 'system' && (
            <p className="px-2 pb-1 pt-1.5 text-[10px] leading-snug text-ink-3">
              {t('Follows the operating system. A dark system uses the dark appearance, never pure black.')}
            </p>
          )}

          <div className="my-1 border-t border-line" />

          <p className="kicker px-2 pb-1 pt-0.5 text-[8.5px]">{t('Interface scale')}</p>
          <div
            className="flex gap-1 px-1 pb-1"
            role="group"
            aria-label={t('Interface scale')}
          >
            {INTERFACE_SCALES.map((value) => {
              const selected = Math.abs(value - scale) < 0.001
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  aria-label={`${interfaceScalePercent(value)}%`}
                  title={`${interfaceScalePercent(value)}%`}
                  onClick={() => setScale(value)}
                  className={`mono min-w-0 flex-1 rounded-[3px] border px-0 py-1 text-[9.5px] text-center transition-colors ${
                    selected
                      ? 'border-line-strong bg-selection text-ink'
                      : 'border-transparent text-ink-3 hover:bg-surface-muted hover:text-ink'
                  }`}
                >
                  {interfaceScalePercent(value)}%
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default ThemeToggle
