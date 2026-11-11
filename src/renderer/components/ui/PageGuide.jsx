import React, { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import Modal from './Modal'
import { useI18n } from '../../i18n'
import { useCurrentUser } from '../../userContext'
import { getPageGuide, roleLabelFor } from '../../pageGuides'

// Step-by-step guide for the page the user is on, written for their role.
//
// Every page header renders it; a route without a guide renders nothing, so the
// header keeps its shape. The steps are filtered by the account's roles (see
// pageGuides.js), which is why the same page can read differently for an
// administrator, a secretary or a teacher.
const PageGuide = () => {
  const { t } = useI18n()
  const location = useLocation()
  const user = useCurrentUser()
  const [open, setOpen] = useState(false)

  const guide = getPageGuide(location.pathname, user)
  if (!guide) return null

  const roleLabel = roleLabelFor(user)
  const label = t('Step-by-step guide for this page')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className="inline-flex h-8 items-center gap-1.5 rounded-[4px] border border-line-strong bg-surface px-2.5 text-[11.5px] font-medium text-ink-2 hover:bg-surface-muted hover:text-ink"
      >
        <BookOpen size={12} strokeWidth={1.9} />
        {t('Guide')}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`${t(guide.title)} · ${t('step-by-step')}`}
        maxWidth="max-w-[560px]"
        footer={
          <span className="text-[10.5px] text-ink-3">
            {roleLabel ? `${t('Written for your role')}: ${t(roleLabel)}` : t('Written for your role')}
          </span>
        }
      >
        {guide.summary && (
          <p className="text-[12px] leading-relaxed text-ink-2">{t(guide.summary)}</p>
        )}

        <ol className="mt-3 space-y-3">
          {guide.steps.map((step, index) => (
            <li key={index} className="flex gap-2.5">
              <span
                className="mono mt-[1px] grid h-5 w-5 shrink-0 place-items-center rounded-[3px] border border-line-strong text-[10px] text-ink-3"
                aria-hidden="true"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <p className="min-w-0 text-[12px] leading-relaxed text-ink-2">{t(step)}</p>
            </li>
          ))}
        </ol>
      </Modal>
    </>
  )
}

export default PageGuide
