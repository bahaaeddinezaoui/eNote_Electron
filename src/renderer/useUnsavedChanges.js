// Guards for work in progress.
//
// `useBeforeUnload` covers closing the window, and `isTypingTarget` lets a page
// ignore shortcuts while the caret is in a field. Dialogs use their own
// confirmation (ConfirmDialog) so the user stays in the application.

import { useEffect } from 'react'

export function useBeforeUnload(dirty) {
  useEffect(() => {
    if (!dirty) return
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}

export function isTypingTarget(target) {
  if (!target) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}
