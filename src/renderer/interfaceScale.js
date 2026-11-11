import { useEffect, useState } from 'react'
import {
  DEFAULT_INTERFACE_SCALE,
  INTERFACE_SCALES,
  interfaceScalePercent,
  normalizeInterfaceScale
} from '../shared/interfaceScale'

// Interface scale is a device-local choice, like the theme and the motion mode:
// it says how large this window draws, not what the account may see. The factor
// is handed to the main process, which applies it with webContents.setZoomFactor
// so every pixel in the interface — text, controls, spacing and the schedule
// grid — changes together. localStorage keeps the choice for the controls; the
// main process keeps its own copy so the window opens already scaled.
const STORAGE_KEY = 'enote-interface-scale'
const CHANGE_EVENT = 'enote-interface-scale-change'

export { DEFAULT_INTERFACE_SCALE, INTERFACE_SCALES, interfaceScalePercent }

export function getStoredInterfaceScale() {
  try {
    return normalizeInterfaceScale(localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_INTERFACE_SCALE
  }
}

function sendToMain(scale) {
  try {
    window.api?.setInterfaceScale?.(scale)?.catch?.(() => {})
  } catch {
    // A missing bridge (a test harness, an older preload) must not break the UI.
  }
}

export function applyInterfaceScale(scale = getStoredInterfaceScale()) {
  const next = normalizeInterfaceScale(scale)
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // Storage unavailable — the scale still applies for this session.
  }
  sendToMain(next)
  return next
}

export function setInterfaceScale(scale) {
  const next = applyInterfaceScale(scale)
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }))
  return next
}

// Call once at startup: the main process has already applied its stored copy
// before showing the window, and this keeps both copies in step.
export function initInterfaceScale() {
  applyInterfaceScale()
}

// React hook: returns [scale, setInterfaceScale].
export function useInterfaceScale() {
  const [scale, setScale] = useState(getStoredInterfaceScale)

  useEffect(() => {
    const handler = () => setScale(getStoredInterfaceScale())
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  return [scale, setInterfaceScale]
}
