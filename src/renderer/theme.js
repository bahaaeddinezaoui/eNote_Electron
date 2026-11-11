import React, { useEffect, useState } from 'react'

// Theme preference is a device-local UI choice stored in localStorage.
// Values: 'light' | 'dark' | 'oled' | 'system' (default). The .dark class on
// <html> drives all dark-mode styling (see index.css); .oled rides alongside it
// and swaps the surfaces for true black so an OLED panel draws no light for the
// canvas. 'system' resolves to the OS preference and never to oled — pure black
// is an explicit choice.
// Every appearance the user can pick. 'system' is a choice like the others: it
// matches the operating system's light/dark setting and resolves to plain dark
// when the system is dark — pure black stays an explicit choice only.
export const THEME_CHOICES = ['light', 'dark', 'oled', 'system']
const STORAGE_KEY = 'enote-theme'
const CHANGE_EVENT = 'enote-theme-change'

// Accent: the metal the interface is drawn in. Emerald is the product default;
// red, gold, blue and pink are complete palettes (src/renderer/accents.css) that
// replace the same token family, so every control follows the choice without
// knowing the colour exists. Axes are independent — each accent carries its own
// light, dark and pure-black values.
export const ACCENT_CHOICES = ['emerald', 'red', 'gold', 'blue', 'pink']
export const DEFAULT_ACCENT = 'emerald'
const ACCENT_KEY = 'enote-accent'
const ACCENT_EVENT = 'enote-accent-change'

// The application mark, one file per palette (scripts/make-icon.cjs writes them
// into public/ and build/). The window, the taskbar and the notification popup
// use the same files from the main process.
export const ACCENT_ICONS = {
  emerald: './icon.png',
  red: './icon-red.png',
  gold: './icon-gold.png',
  blue: './icon-blue.png',
  pink: './icon-pink.png'
}

export function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function normalizeAccent(accent) {
  return ACCENT_CHOICES.includes(accent) ? accent : DEFAULT_ACCENT
}

export function getStoredAccent() {
  try {
    return normalizeAccent(localStorage.getItem(ACCENT_KEY))
  } catch {
    return DEFAULT_ACCENT
  }
}

export function accentIcon(accent = getStoredAccent()) {
  return ACCENT_ICONS[normalizeAccent(accent)]
}

export function systemPrefersDark() {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

// Resolve a stored preference to a concrete theme: 'light' | 'dark' | 'oled'.
export function resolveTheme(pref = getStoredTheme()) {
  if (pref === 'light' || pref === 'dark' || pref === 'oled') return pref
  // Default product theme is dark; 'system' opts into the OS preference.
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return 'dark'
}

// Both dark themes share the dark component styling, so anything that draws for
// dark (chart ink, icons) should ask this rather than comparing to 'dark'.
export function isDarkTheme(pref = getStoredTheme()) {
  return resolveTheme(pref) !== 'light'
}

// Select popups, date pickers and system menus are drawn by Chromium itself,
// outside the page's CSS: they follow the window's native appearance. Handing
// the resolved mode to the main process keeps those surfaces in the same mode
// as the interface, so a dark window on a light Windows session no longer opens
// a white option list. 'system' stays 'system' so the OS preference keeps
// driving both the interface and the native surfaces.
function syncNativeTheme(pref, resolved) {
  const mode = pref === 'system' ? 'system' : resolved === 'light' ? 'light' : 'dark'
  try {
    window.api?.setNativeTheme?.(mode)?.catch?.(() => {})
  } catch {
    // A missing bridge (a test harness, an older preload) must not break the UI.
  }
}

export function applyTheme(pref = getStoredTheme()) {
  const resolved = resolveTheme(pref)
  const root = document.documentElement
  root.classList.toggle('dark', resolved !== 'light')
  root.classList.toggle('oled', resolved === 'oled')
  syncNativeTheme(pref, resolved)
}

// Written as an attribute rather than a class so the palette blocks in
// accents.css can select it for both appearances at once.
export function applyAccent(accent = getStoredAccent()) {
  document.documentElement.dataset.accent = normalizeAccent(accent)
}

// A change of appearance is the one moment the whole window repaints at once,
// so it is revealed rather than snapped: the new palette grows out of the
// control that changed it as a circle, drawn by index.css over the incoming
// frame of a view transition. The circle's centre and radius travel to <html>
// as custom properties. Power save and the operating system's reduced-motion
// preference skip it and apply the palette at once.
function canReveal() {
  return (
    typeof document.startViewTransition === 'function' &&
    document.documentElement.dataset.motion !== 'powersave' &&
    !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  )
}

// The circle opens at the control that was pressed; without one (a command, a
// keyboard shortcut) it opens from the middle of the window. Its radius reaches
// the furthest corner, so the whole window is covered exactly as it ends.
function reveal(apply, origin) {
  if (!canReveal()) {
    apply()
    return
  }
  const rect = origin?.getBoundingClientRect?.()
  const x = rect ? Math.round(rect.left + rect.width / 2) : Math.round(window.innerWidth / 2)
  const y = rect ? Math.round(rect.top + rect.height / 2) : Math.round(window.innerHeight / 2)
  const radius = Math.ceil(
    Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
  )
  const root = document.documentElement
  root.style.setProperty('--reveal-x', `${x}px`)
  root.style.setProperty('--reveal-y', `${y}px`)
  root.style.setProperty('--reveal-radius', `${radius}px`)
  // The callback is where the DOM reaches its new state; the frame the browser
  // captures after it becomes the incoming layer the circle uncovers.
  document.startViewTransition(apply)
}

// `origin` is the control that was pressed, when there is one.
export function setTheme(pref, origin) {
  const before = resolveTheme(getStoredTheme())
  const after = resolveTheme(pref)

  // The choice is stored before the transition, not inside it: the menu reads
  // its selection back from storage when the event below announces the change,
  // and the update callback of a transition runs after this function returns —
  // a write in there would arrive too late and leave the previous choice marked.
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // Storage unavailable — the theme still applies for this session.
  }

  // Only a change of the resolved look redraws the window; re-picking the
  // appearance already in force just applies it again.
  if (after !== before) reveal(() => applyTheme(pref), origin)
  else applyTheme(pref)

  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: pref }))
}

// Hands the accent to the main process, which owns the window's own mark: the
// taskbar icon and the notification popup are drawn from files, not CSS.
function syncAccentToMain(accent) {
  try {
    window.api?.setAppAccent?.(accent)?.catch?.(() => {})
  } catch {
    // A missing bridge (a test harness, an older preload) must not break the UI.
  }
}

// `origin` is the swatch that was pressed, when there is one.
export function setAccent(accent, origin) {
  const next = normalizeAccent(accent)
  // Stored before the transition for the same reason as the appearance above:
  // the swatch marks itself from storage when the event below is dispatched.
  try {
    localStorage.setItem(ACCENT_KEY, next)
  } catch {
    // Storage unavailable — the palette still applies for this session.
  }
  // A palette swap repaints as much as an appearance change does.
  reveal(() => {
    applyAccent(next)
    syncAccentToMain(next)
  }, origin)
  window.dispatchEvent(new CustomEvent(ACCENT_EVENT, { detail: next }))
}

// Call once at startup. The public/theme-init.js script already applied the
// class and the accent pre-paint (no flash); this keeps 'system' live as the OS
// preference changes while the app is running.
export function initTheme() {
  applyTheme()
  applyAccent()
  // The window opens with the saved mark already (the main process reads the
  // same choice), and this keeps it in step after an update.
  syncAccentToMain(getStoredAccent())
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const pref = getStoredTheme()
      if (!pref || pref === 'system') applyTheme()
    })
  }
}

// React hook: returns [theme, setTheme] where theme is
// 'light' | 'dark' | 'oled' | 'system'.
export function useTheme() {
  const [theme, setThemeState] = useState(getStoredTheme() || 'system')

  useEffect(() => {
    const handler = () => setThemeState(getStoredTheme() || 'system')
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  return [theme, setTheme]
}

// React hook: returns [accent, setAccent] where accent is
// 'emerald' | 'red' | 'gold' | 'blue' | 'pink'.
export function useAccent() {
  const [accent, setAccentState] = useState(getStoredAccent())

  useEffect(() => {
    const handler = () => setAccentState(getStoredAccent())
    window.addEventListener(ACCENT_EVENT, handler)
    return () => window.removeEventListener(ACCENT_EVENT, handler)
  }, [])

  return [accent, setAccent]
}
