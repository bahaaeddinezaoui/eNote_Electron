import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useI18n } from '../../i18n'

const SHORTCUTS = [
  { keys: 'Ctrl/⌘ + K', label: 'Open the command palette' },
  { keys: '?', label: 'Show this shortcut sheet' },
  { keys: '↑ / ↓', label: 'Move through palette results' },
  { keys: 'Enter', label: 'Open the selected result' },
  { keys: 'Esc', label: 'Close a panel or dialog' },
  { keys: '← / →', label: 'Page the history carousel' }
]

// The keyboard reference, opened with "?" anywhere outside a text field.
export default function ShortcutsDialog({ open, onOpenChange }) {
  const { t } = useI18n()
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] anim-overlay" style={{ background: 'rgba(0,0,0,0.7)' }} />
        <Dialog.Content
          aria-label={t('Keyboard shortcuts')}
          className="anim-plate fixed inset-x-0 top-[18vh] z-[91] mx-auto w-[440px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-line-strong bg-raised"
          style={{ boxShadow: 'var(--shadow-e2)' }}
        >
          <div className="flex h-11 items-center justify-between border-b border-line px-4">
            <Dialog.Title className="text-[12.5px] font-semibold text-ink">{t('Keyboard shortcuts')}</Dialog.Title>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t('Close')}
              className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
          <dl className="divide-y divide-line">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys} className="flex items-center justify-between gap-4 px-4 py-2">
                <dt className="text-[11.5px] text-ink-2">{t(shortcut.label)}</dt>
                <dd className="mono shrink-0 rounded-[2px] border border-line bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-3">
                  {shortcut.keys}
                </dd>
              </div>
            ))}
          </dl>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
