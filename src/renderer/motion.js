import { useEffect, useState } from 'react'

// Interface motion is a device-local UI choice stored in localStorage, exactly
// like the theme and the language. Two modes:
//   'performance' — the crafted animations and transitions (default)
//   'powersave'   — none at all: every state change is immediate
// The `data-motion` attribute on <html> is what index.css keys off, so the mode
// reaches every element without threading a prop through the tree.
const STORAGE_KEY = 'enote-motion'
const CHANGE_EVENT = 'enote-motion-change'

export const MOTION_MODES = ['performance', 'powersave']

export function getStoredMotion() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function systemPrefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// An explicit choice always wins. Before one is made, the operating system's
// reduced-motion preference decides, so somebody who asked the OS for less
// motion is not handed the animated mode on first launch.
export function resolveMotion(pref = getStoredMotion()) {
  if (pref === 'performance' || pref === 'powersave') return pref
  return systemPrefersReducedMotion() ? 'powersave' : 'performance'
}

export function applyMotion(pref = getStoredMotion()) {
  const mode = resolveMotion(pref)
  document.documentElement.dataset.motion = mode
  return mode
}

export function setMode(pref) {
  const next = pref === 'powersave' ? 'powersave' : 'performance'
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Storage unavailable — the mode still applies for this session.
  }
  applyMotion(next)
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }))
}

// Call once at startup. public/theme-init.js has already set the attribute
// before first paint, so nothing animates in a mode it is about to leave.
export function initMotion() {
  applyMotion()
  if (window.matchMedia) {
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
      // Only follow the OS while no explicit choice has been stored.
      if (!getStoredMotion()) applyMotion()
    })
  }
}

// React hook: returns [mode, setMode] where mode is 'performance' | 'powersave'.
export function useMotion() {
  const [mode, setModeState] = useState(() => resolveMotion())

  useEffect(() => {
    const handler = () => setModeState(resolveMotion())
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  return [mode, setMode]
}
