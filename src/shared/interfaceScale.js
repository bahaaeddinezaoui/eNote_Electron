// The interface can be drawn at any of these scales. A factor is a browser zoom
// factor, so everything scales together — the 12.5px table labels as well as the
// rem-based headings — instead of only the parts that happen to use rem.
//
// The list is shared by the main process (which stores the choice and applies it
// to the window) and the renderer (which offers it and mirrors it in
// localStorage), so the two can never disagree about what a valid scale is.
export const INTERFACE_SCALES = [0.9, 1, 1.1, 1.25, 1.5]

export const DEFAULT_INTERFACE_SCALE = 1

export function normalizeInterfaceScale(value) {
  const scale = Number(value)
  return INTERFACE_SCALES.includes(scale) ? scale : DEFAULT_INTERFACE_SCALE
}

// The label shown on the control: a scale factor as a percentage.
export function interfaceScalePercent(value) {
  return Math.round(normalizeInterfaceScale(value) * 100)
}
