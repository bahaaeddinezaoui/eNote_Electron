import React from 'react'
import { Trash2 } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import { useI18n } from '../../i18n'

// Styled replacement for the native window.confirm() dialogs. The message
// always names the object, the count and the consequence.
const ConfirmDialog = ({
  open,
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel
}) => {
  const { t } = useI18n()
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t(title)}
      maxWidth="max-w-[440px]"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            {t(cancelLabel)}
          </Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm}>
            {danger && <Trash2 size={12} strokeWidth={2} />}
            {t(confirmLabel)}
          </Button>
        </div>
      }
    >
      <p className="text-[12.5px] leading-relaxed text-ink-2">{message}</p>
    </Modal>
  )
}

export default ConfirmDialog
