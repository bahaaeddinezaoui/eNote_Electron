import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useI18n } from '../../i18n'

// Shared dialog shell built on Radix Dialog (focus trap, Escape-to-close,
// focus restore, aria wiring included). API kept stable for consumers:
//   <Modal open={open} onClose={() => setOpen(false)} title="...">
//     {children}
//   </Modal>
const Modal = ({ open, onClose, title, description, children, footer, maxWidth = 'max-w-[520px]' }) => {
  const { t } = useI18n()
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60] anim-overlay"
          style={{ background: 'rgba(0,0,0,0.7)' }}
        />
        <Dialog.Content
          aria-label={typeof title === 'string' ? title : undefined}
          className={`fixed inset-x-0 top-1/2 z-[61] mx-auto flex max-h-[90vh] w-[calc(100vw-32px)] ${maxWidth} -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-line-strong bg-raised anim-plate`}
          style={{ boxShadow: 'var(--shadow-e2)' }}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line px-4">
            <Dialog.Title className="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink">{title}</Dialog.Title>
            {description ? <Dialog.Description className="sr-only">{description}</Dialog.Description> : null}
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={t('Close')}
                className="grid h-6 w-6 place-items-center rounded-[3px] text-ink-3 hover:bg-surface-muted hover:text-ink"
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto px-4 py-3.5">{children}</div>
          {footer && (
            <div className="shrink-0 border-t border-line bg-surface-muted px-4 py-2.5">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default Modal
