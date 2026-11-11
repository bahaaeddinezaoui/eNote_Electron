import React, { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useI18n } from '../../i18n'

// Natural size when the file is large, but a small file still opens enlarged
// instead of at its thumbnail size.
const ZOOMED_IMAGE_STYLE = {
  boxShadow: 'var(--shadow-e2)',
  minWidth: 'min(240px, 86vw)',
  minHeight: 'min(240px, 86vh)'
}

// The picture a row already shows, but clickable: it opens the same photo
// enlarged and centred over the whole interface, however small the thumbnail
// was. It is a span rather than a button because most thumbnails sit inside a
// clickable row or button of their own, and a nested button would break that
// markup; stopping the click keeps the row from also opening.
const PhotoZoom = ({ src, alt = '', className = 'h-full w-full object-cover' }) => {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  if (!src) return null
  const label = alt || t('Photo')

  return (
    <>
      <span
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        title={t('View photo')}
        className="block h-full w-full cursor-zoom-in"
      >
        <img src={src} alt={alt} draggable={false} className={className} />
      </span>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          {/* Escape closes the photo only: the page behind keeps its own Escape
              handling (a table's row selection, an open inspector). */}
          <Dialog.Content
            aria-label={label}
            onClick={() => setOpen(false)}
            onEscapeKeyDown={(event) => event.stopPropagation()}
            className="anim-overlay fixed inset-0 z-[100] grid cursor-zoom-out place-items-center p-6 focus:outline-none"
            style={{ background: 'rgba(0,0,0,0.86)' }}
          >
            <Dialog.Title className="sr-only">{label}</Dialog.Title>
            <Dialog.Description className="sr-only">{t('View photo')}</Dialog.Description>
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="anim-plate max-h-[86vh] max-w-[86vw] rounded-[4px] object-contain"
              style={ZOOMED_IMAGE_STYLE}
            />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
              }}
              aria-label={t('Close')}
              className="absolute end-4 top-4 grid h-8 w-8 place-items-center rounded-[4px] text-white/70 hover:bg-white/10 hover:text-white"
            >
              <X size={16} strokeWidth={1.9} />
            </button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  )
}

export default PhotoZoom
