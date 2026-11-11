import React from 'react'
import { accentIcon, useAccent } from '../../theme'

// The application mark in the accent currently chosen: the same PNG the window
// and taskbar carry (scripts/make-icon.cjs writes one per palette), so the brand
// block and the operating system can never disagree about the colour.
const AppMark = ({ className = 'h-6 w-6' }) => {
  const [accent] = useAccent()
  return (
    <img
      src={accentIcon(accent)}
      alt=""
      aria-hidden="true"
      className={`${className} shrink-0 rounded-full`}
    />
  )
}

export default AppMark
